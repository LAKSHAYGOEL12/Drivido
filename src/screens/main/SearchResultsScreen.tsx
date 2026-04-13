import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  Modal,
  Animated,
  useWindowDimensions,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { Alert } from '../../utils/themedAlert';
import { useNavigation, useRoute, useFocusEffect, type RouteProp } from '@react-navigation/native';
import type { SearchStackParamList } from '../../navigation/types';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { API } from '../../constants/API';
import { geocodeAddressWithFallbacks } from '../../services/places';
import type { PlacePrediction } from '../../services/places';
import type { RideListItem } from '../../types/api';
import { COLORS } from '../../constants/colors';
import RideListCard from '../../components/rides/RideListCard';
import {
  getRideScheduledAt as rideScheduledAt,
  isRideCancelledByOwner,
  isViewerRideOwner,
} from '../../utils/rideDisplay';
import { isRideSeatsFull } from '../../utils/rideSeats';
import { addRecentSearch } from '../../services/recent-search-storage';
import DatePickerModal from '../../components/common/DatePickerModal';
import PassengersPickerModal from '../../components/common/PassengersPickerModal';
import {
  extractBookingsListArray,
  mapRawToBookingRow,
  rideIdFromBookingListRow,
} from '../../utils/bookingNormalize';
import { bookingIsCancelled } from '../../utils/bookingStatus';
import { showToast } from '../../utils/toast';
import {
  loadPlaceRecents,
  upsertPlaceRecent,
  type PlaceRecentEntry,
  type PlaceRecentFieldType,
} from '../../services/place-recent-storage';
import { pickPublisherAvatarUrl } from '../../utils/avatarUrl';
import RideCardSkeleton from '../../components/rides/RideCardSkeleton';
import {
  getSearchResultsCache,
  setSearchResultsCache,
  searchResultsCacheKey,
} from '../../utils/searchResultsCache';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Point-to-point “same or near” (pickup/destination): 4 km. */
const RANGE_KM = 4;
/** Legacy “on route” = distance to segment (base corridor, km). */
const ROUTE_NEAR_KM = 10;
/** Min fraction along segment from each endpoint so drop-off counts as “between” pickup and destination. */
const SEGMENT_END_MARGIN = 0.04;
/** If published ride is shorter than this (km), relax “between” to any interior point on segment. */
const SHORT_SEGMENT_KM = 3;
/**
 * Perpendicular distance budget (km) from the pickup→destination chord.
 * Long real-world routes deviate from a straight line; a fixed 10 km rejects valid mid-route towns.
 */
function onRouteCorridorKm(segmentLenKm: number): number {
  return Math.max(ROUTE_NEAR_KM, Math.min(55, segmentLenKm * 0.38));
}

/** Min t along segment (0 = at pickup) so drop-off is not treated as “at driver pickup”. Max is 1 (at published destination). */
const ALONG_SEGMENT_T_MIN = 0.008;

const MINUTES_AHEAD = 15;
const MIN_MS = MINUTES_AHEAD * 60 * 1000;
/** Throttle rapid re-fetches; keep low enough that repeat visits don’t feel stuck (was 3500ms). */
const RIDES_FETCH_MIN_GAP_MS = 900;

function toStr(v: unknown): string | undefined {
  return v === undefined || v === null ? undefined : String(v);
}

function formatDateSectionLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return '';
  const selected = new Date(y, m - 1, d);
  const selectedNorm = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate());

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (selectedNorm.getTime() === today.getTime()) return 'Today';
  if (selectedNorm.getTime() === tomorrow.getTime()) return 'Tomorrow';

  return `${WEEKDAYS[selectedNorm.getDay()]}, ${MONTHS[selectedNorm.getMonth()]} ${selectedNorm.getDate()}`;
}

function truncateRouteLabel(s: string | undefined, max = 22): string {
  const t = (s ?? '').trim();
  if (!t) return '';
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function formatPassengerLabel(passengers: string | undefined): string {
  const n = Math.max(1, parseInt(String(passengers ?? '1'), 10) || 1);
  return n === 1 ? '1 passenger' : `${n} passengers`;
}


function normalizeRideItem(raw: Record<string, unknown>): RideListItem {
  const r = raw as Record<string, unknown>;
  const rideDate = toStr(r.rideDate ?? r.ride_date);
  const scheduledDate = toStr(r.scheduledDate ?? r.scheduled_date ?? r.date);
  const scheduledTime = toStr(r.scheduledTime ?? r.scheduled_time ?? r.time);
  const scheduledAt = toStr(r.scheduledAt ?? r.scheduled_at);
  let outDate = rideDate || scheduledDate;
  let outTime = toStr(r.rideTime ?? r.ride_time) || toStr(r.time);
  if ((!outDate || !outTime) && scheduledAt) {
    const d = new Date(scheduledAt);
    if (!isNaN(d.getTime())) {
      outDate = outDate || `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      outTime = outTime || `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  }
  const rawSeats = r.seats;
  const seats = typeof rawSeats === 'number' ? rawSeats : rawSeats != null && rawSeats !== '' ? Number(rawSeats) : undefined;
  const outSeats = typeof seats === 'number' && !Number.isNaN(seats) && seats >= 0 ? Math.floor(seats) : undefined;
  const rawBooked = r.bookedSeats ?? r.booked_seats;
  const bookedSeats =
    typeof rawBooked === 'number' && !Number.isNaN(rawBooked)
      ? Math.max(0, Math.floor(rawBooked))
      : undefined;
  const rawTotalBk = r.totalBookings ?? r.total_bookings;
  const totalBookings =
    typeof rawTotalBk === 'number' && !Number.isNaN(rawTotalBk)
      ? Math.max(0, Math.floor(rawTotalBk))
      : undefined;
  const rawAvail = r.availableSeats ?? r.seatsAvailable ?? r.seats_available;
  const availableSeatsNum =
    typeof rawAvail === 'number' && !Number.isNaN(rawAvail)
      ? Math.max(0, Math.floor(rawAvail))
      : undefined;
  const rawPendingReq =
    r.pendingRequests ??
    r.pending_requests ??
    r.pendingRequestCount ??
    r.pending_request_count ??
    r.requestsPending ??
    r.requests_pending;
  const pendingRequestsNum =
    typeof rawPendingReq === 'number' && !Number.isNaN(rawPendingReq)
      ? Math.max(0, Math.floor(rawPendingReq))
      : undefined;
  const rawHasPending = r.hasPendingRequests ?? r.has_pending_requests;
  let hasPendingRequestsFlag: boolean | undefined;
  if (typeof rawHasPending === 'boolean') hasPendingRequestsFlag = rawHasPending;
  else if (rawHasPending === 'true') hasPendingRequestsFlag = true;
  else if (rawHasPending === 'false') hasPendingRequestsFlag = false;
  const num = (v: unknown): number | undefined => {
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    if (v != null && v !== '') return Number(v);
    return undefined;
  };
  const pickupLat = num(r.pickupLatitude ?? r.pickup_latitude);
  const pickupLon = num(r.pickupLongitude ?? r.pickup_longitude);
  const destLat = num(r.destinationLatitude ?? r.destination_latitude);
  const destLon = num(r.destinationLongitude ?? r.destination_longitude);
  const estDur = num(r.estimatedDurationSeconds ?? r.estimated_duration_seconds);
  const nestedUser =
    r.user && typeof r.user === 'object' ? (r.user as Record<string, unknown>) : undefined;
  const driverDisplayName = toStr(
    r.name ??
      r.driverName ??
      r.driver_name ??
      r.publisherName ??
      r.publisher_name ??
      nestedUser?.name
  );
  const pubAvatar = pickPublisherAvatarUrl(r);
  return {
    id: String(r.id ?? ''),
    userId: toStr(r.userId ?? r.user_id ?? r.driverId ?? r.driver_id),
    pickupLocationName: toStr(r.pickupLocationName ?? r.pickup_location_name ?? r.from),
    destinationLocationName: toStr(r.destinationLocationName ?? r.destination_location_name ?? r.to),
    pickupLatitude: pickupLat,
    pickupLongitude: pickupLon,
    destinationLatitude: destLat,
    destinationLongitude: destLon,
    from: toStr(r.from),
    to: toStr(r.to),
    username: toStr(r.username ?? r.user_name ?? nestedUser?.username),
    ...(driverDisplayName ? { name: driverDisplayName } : {}),
    seats: outSeats,
    ...(bookedSeats !== undefined ? { bookedSeats } : {}),
    ...(totalBookings !== undefined ? { totalBookings } : {}),
    ...(availableSeatsNum !== undefined ? { availableSeats: availableSeatsNum } : {}),
    ...(pendingRequestsNum !== undefined ? { pendingRequests: pendingRequestsNum } : {}),
    ...(hasPendingRequestsFlag !== undefined ? { hasPendingRequests: hasPendingRequestsFlag } : {}),
    rideDate: outDate,
    rideTime: outTime,
    scheduledDate: scheduledDate || outDate,
    scheduledTime: scheduledTime,
    scheduledAt: scheduledAt || undefined,
    date: toStr(r.date),
    time: toStr(r.time),
    createdAt: toStr(r.createdAt ?? r.created_at),
    price: toStr(
      r.price ??
      r.fare ??
      r.amount ??
      r.pricePerSeat ??
      r.price_per_seat ??
      r.farePerSeat ??
      r.fare_per_seat ??
      (typeof r.pricing === 'object' && r.pricing ? (r.pricing as Record<string, unknown>).price : undefined)
    ),
    vehicleModel: toStr(r.vehicleModel ?? r.vehicle_model),
    licensePlate: toStr(r.licensePlate ?? r.license_plate),
    vehicleNumber: toStr(r.vehicleNumber ?? r.vehicle_number),
    vehicleColor: toStr(r.vehicleColor ?? r.vehicle_color),
    status: (() => {
      const st = toStr(r.status ?? r.ride_status);
      if (st) return st;
      if (r.cancelled_at != null || r.cancelledAt != null || r.deleted_at != null || r.deletedAt != null) {
        return 'cancelled';
      }
      return undefined;
    })(),
    ...(estDur !== undefined && estDur > 0 ? { estimatedDurationSeconds: Math.floor(estDur) } : {}),
    ...(function (): { viewerIsOwner?: boolean } {
      const rawVi = r.viewerIsOwner ?? r.viewer_is_owner;
      if (typeof rawVi === 'boolean') return { viewerIsOwner: rawVi };
      if (rawVi === 'true') return { viewerIsOwner: true };
      if (rawVi === 'false') return { viewerIsOwner: false };
      return {};
    })(),
    ...(function (): { description?: string } {
      const desc = toStr(r.description ?? r.rideDescription ?? r.ride_description)?.trim();
      return desc ? { description: desc } : {};
    })(),
    ...(pubAvatar ? { publisherAvatarUrl: pubAvatar } : {}),
    ...(function (): Partial<RideListItem> {
      const mbs = toStr(r.myBookingStatus ?? r.my_booking_status);
      const mbr = toStr(r.myBookingStatusReason ?? r.my_booking_status_reason);
      const vbc = r.viewer_booking_context;
      const bm = toStr(r.bookingMode ?? r.booking_mode)?.trim().toLowerCase();
      const o: Partial<RideListItem> = {};
      if (mbs) o.myBookingStatus = mbs;
      if (mbr) o.myBookingStatusReason = mbr;
      if (vbc && typeof vbc === 'object') {
        o.viewer_booking_context = vbc as NonNullable<RideListItem['viewer_booking_context']>;
      }
      if (bm === 'instant' || bm === 'request') o.bookingMode = bm as RideListItem['bookingMode'];
      if (typeof r.instantBooking === 'boolean') o.instantBooking = r.instantBooking;
      else if (typeof r.instant_booking === 'boolean') o.instantBooking = r.instant_booking;
      return o;
    })(),
  };
}

/** Ride date as YYYY-MM-DD for comparison. */
function getRideDateYMD(ride: RideListItem): string | undefined {
  if (ride.scheduledAt) {
    const d = new Date(ride.scheduledAt);
    if (!isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const dateStr = ride.scheduledDate ?? ride.rideDate ?? ride.date;
  if (!dateStr) return undefined;
  const s = String(dateStr).trim();
  if (s.includes('T')) return s.slice(0, s.indexOf('T'));
  return s;
}

/** True if ride is scheduled at least 15 minutes after now (for search results only). */
function isAtLeast15MinsLater(ride: RideListItem): boolean {
  const at = rideScheduledAt(ride);
  if (!at) return false;
  return at.getTime() >= Date.now() + MIN_MS;
}

/** Haversine distance in km between two points. */
function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Distance from point P to segment A-B and projection parameter t (0 = at A, 1 = at B).
 * Used to enforce same direction: user's destination must be along the ride (t > 0), not at ride's pickup.
 */
function distanceToSegmentKmWithT(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): { distanceKm: number; t: number } {
  const dx = bLat - aLat;
  const dy = bLon - aLon;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) {
    return { distanceKm: distanceKm(pLat, pLon, aLat, aLon), t: 0 };
  }
  let t = ((pLat - aLat) * dx + (pLon - aLon) * dy) / lenSq;
  const tClamped = Math.max(0, Math.min(1, t));
  t = tClamped;
  const qLat = aLat + t * dx;
  const qLon = aLon + t * dy;
  return { distanceKm: distanceKm(pLat, pLon, qLat, qLon), t: tClamped };
}

/** Distance from point P to segment A–B (km), for legacy “on route” checks. */
function distanceToSegmentKm(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const { distanceKm: d } = distanceToSegmentKmWithT(pLat, pLon, aLat, aLon, bLat, bLon);
  return d;
}

/** True if ride has non-zero coordinates (for coordinate-based matching). */
function rideHasCoordinates(ride: RideListItem): boolean {
  const a = ride.pickupLatitude != null && ride.pickupLongitude != null
    && ride.pickupLatitude !== 0 && ride.pickupLongitude !== 0;
  const b = ride.destinationLatitude != null && ride.destinationLongitude != null
    && ride.destinationLatitude !== 0 && ride.destinationLongitude !== 0;
  return Boolean(a && b);
}

/**
 * Legacy coordinate rules (any one matches):
 * 1. User pickup within 4 km of ride pickup AND user destination within 4 km of ride destination.
 * 2. User pickup within 4 km of ride destination AND user destination within 4 km of ride pickup (opposite).
 * 3. User pickup near start/end/on route AND user destination on route or near ride destination.
 */
function routeMatchesLegacyByCoordinates(
  ride: RideListItem,
  searchFromLat: number,
  searchFromLon: number,
  searchToLat: number,
  searchToLon: number
): boolean {
  const rP = { lat: ride.pickupLatitude!, lon: ride.pickupLongitude! };
  const rD = { lat: ride.destinationLatitude!, lon: ride.destinationLongitude! };
  const uFrom = { lat: searchFromLat, lon: searchFromLon };
  const uTo = { lat: searchToLat, lon: searchToLon };

  const d = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    distanceKm(a.lat, a.lon, b.lat, b.lon);
  const toSeg = (p: { lat: number; lon: number }) =>
    distanceToSegmentKm(p.lat, p.lon, rP.lat, rP.lon, rD.lat, rD.lon);

  const case1 = d(uFrom, rP) <= RANGE_KM && d(uTo, rD) <= RANGE_KM;
  const case2 = d(uFrom, rD) <= RANGE_KM && d(uTo, rP) <= RANGE_KM;

  const segmentLenKm = d(rP, rD);
  const corridorKm = onRouteCorridorKm(segmentLenKm);
  const pickupNearStart = d(uFrom, rP) <= RANGE_KM;
  const pickupNearEnd = d(uFrom, rD) <= RANGE_KM;
  const pickupOnRoute = toSeg(uFrom) <= corridorKm;
  const destOnRoute = toSeg(uTo) <= corridorKm;
  const destNearEnd = d(uTo, rD) <= RANGE_KM;
  const case3 =
    (pickupNearStart || pickupNearEnd || pickupOnRoute) && (destOnRoute || destNearEnd);

  return case1 || case2 || case3;
}

/**
 * Additional rule: passenger pickup within 4 km of published DESTINATION (“opposite” end)
 * AND passenger destination strictly between published pickup and destination along the segment.
 */
function routeMatchesOppositePickupBetweenDestination(
  ride: RideListItem,
  searchFromLat: number,
  searchFromLon: number,
  searchToLat: number,
  searchToLon: number
): boolean {
  const rPLat = ride.pickupLatitude!;
  const rPLon = ride.pickupLongitude!;
  const rDLat = ride.destinationLatitude!;
  const rDLon = ride.destinationLongitude!;

  const pickupNearOpposite =
    distanceKm(searchFromLat, searchFromLon, rDLat, rDLon) <= RANGE_KM;

  const { distanceKm: perpKm, t } = distanceToSegmentKmWithT(
    searchToLat,
    searchToLon,
    rPLat,
    rPLon,
    rDLat,
    rDLon
  );
  if (perpKm > RANGE_KM) return false;

  const segmentLenKm = distanceKm(rPLat, rPLon, rDLat, rDLon);
  const low = segmentLenKm < SHORT_SEGMENT_KM ? 1e-6 : SEGMENT_END_MARGIN;
  const high = segmentLenKm < SHORT_SEGMENT_KM ? 1 - 1e-6 : 1 - SEGMENT_END_MARGIN;
  const destinationBetween = t > low && t < high;

  return pickupNearOpposite && destinationBetween;
}

/**
 * Pickup within RANGE_KM of published pickup; drop-off within a corridor of the pickup→destination
 * chord (scales with segment length) and along the segment from just past pickup through to destination (t≤1).
 */
function routeMatchesNearPublishedPickupDestinationBetweenOnRoute(
  ride: RideListItem,
  searchFromLat: number,
  searchFromLon: number,
  searchToLat: number,
  searchToLon: number
): boolean {
  const rPLat = ride.pickupLatitude!;
  const rPLon = ride.pickupLongitude!;
  const rDLat = ride.destinationLatitude!;
  const rDLon = ride.destinationLongitude!;

  if (distanceKm(searchFromLat, searchFromLon, rPLat, rPLon) > RANGE_KM) return false;

  const { distanceKm: perpKm, t } = distanceToSegmentKmWithT(
    searchToLat,
    searchToLon,
    rPLat,
    rPLon,
    rDLat,
    rDLon
  );
  const segmentLenKm = distanceKm(rPLat, rPLon, rDLat, rDLon);
  const corridorKm = onRouteCorridorKm(segmentLenKm);
  if (perpKm > corridorKm) return false;

  // Allow drop-off up to the published destination (t → 1). Old rule used t < 0.96 which
  // excluded valid “on the way to driver’s end” stops (e.g. last 10–30 km of a long ride).
  const tMin = segmentLenKm < SHORT_SEGMENT_KM ? 1e-6 : ALONG_SEGMENT_T_MIN;
  return t > tMin && t <= 1;
}

/**
 * Local tangent-plane dot product (lat° vs lon° scaled by cos(lat)) for direction agreement.
 * Used to reject “same pickup, opposite destination” (e.g. Modinagar→Meerut vs ride Modinagar→Gurugram).
 */
function directionalDotFromOriginToward(
  oLat: number,
  oLon: number,
  targetLat: number,
  targetLon: number,
  uToLat: number,
  uToLon: number
): number {
  const latRad = ((oLat + uToLat) / 2) * (Math.PI / 180);
  const cosLat = Math.cos(latRad);
  const vx = targetLat - oLat;
  const vy = (targetLon - oLon) * cosLat;
  const ux = uToLat - oLat;
  const uy = (uToLon - oLon) * cosLat;
  return vx * ux + vy * uy;
}

/**
 * When the passenger starts near the published pickup or near the published destination,
 * their destination must lie in the same general direction as that leg (not opposite), without
 * hardcoding any city names — pure geometry.
 */
function passDirectionalConsistencyWithRide(
  ride: RideListItem,
  uFromLat: number,
  uFromLon: number,
  uToLat: number,
  uToLon: number
): boolean {
  const rPLat = ride.pickupLatitude!;
  const rPLon = ride.pickupLongitude!;
  const rDLat = ride.destinationLatitude!;
  const rDLon = ride.destinationLongitude!;
  const segKm = distanceKm(rPLat, rPLon, rDLat, rDLon);
  if (segKm < 0.3) return true;

  const near = (lat: number, lon: number, latB: number, lonB: number) =>
    distanceKm(lat, lon, latB, lonB) <= RANGE_KM;

  // Projection of passenger points on published pickup -> destination segment.
  // t=0 means at published pickup, t=1 means at published destination.
  const { t: fromAlongRideT } = distanceToSegmentKmWithT(
    uFromLat,
    uFromLon,
    rPLat,
    rPLon,
    rDLat,
    rDLon
  );
  const { t: toAlongRideT } = distanceToSegmentKmWithT(
    uToLat,
    uToLon,
    rPLat,
    rPLon,
    rDLat,
    rDLon
  );
  const progressMin = segKm < SHORT_SEGMENT_KM ? 1e-6 : ALONG_SEGMENT_T_MIN;
  const forwardProgress = toAlongRideT - fromAlongRideT;

  // Global direction check (applies even when passenger start isn't near an endpoint):
  // passenger direction must align with ride direction and make meaningful forward progress.
  const latRad = ((rPLat + rDLat + uFromLat + uToLat) / 4) * (Math.PI / 180);
  const cosLat = Math.cos(latRad);
  const rideVecX = rDLat - rPLat;
  const rideVecY = (rDLon - rPLon) * cosLat;
  const userVecX = uToLat - uFromLat;
  const userVecY = (uToLon - uFromLon) * cosLat;
  const dirDot = rideVecX * userVecX + rideVecY * userVecY;
  if (dirDot <= 0) return false;
  if (forwardProgress <= progressMin) return false;

  // Same published pickup: passenger destination must trend toward the published destination, not the opposite way.
  if (near(uFromLat, uFromLon, rPLat, rPLon)) {
    const dot = directionalDotFromOriginToward(rPLat, rPLon, rDLat, rDLon, uToLat, uToLon);
    // Reject "no forward movement" results (e.g. destination still at/behind published pickup).
    // Also require destination to be meaningfully ahead of passenger pickup along the ride segment.
    return dot > 0 && toAlongRideT > progressMin && toAlongRideT > fromAlongRideT + progressMin;
  }

  // Starting near published destination (reverse / second-leg searches): destination must trend toward published pickup.
  if (near(uFromLat, uFromLon, rDLat, rDLon)) {
    const dot = directionalDotFromOriginToward(rDLat, rDLon, rPLat, rPLon, uToLat, uToLon);
    // In reverse starts, destination must move meaningfully away from published destination
    // and be ahead of passenger pickup in reverse direction (lower t).
    return dot > 0 && toAlongRideT < 1 - progressMin && toAlongRideT < fromAlongRideT - progressMin;
  }

  return true;
}

/** True if legacy, opposite/between, or near-pickup / between-on-route rule matches. */
function routeMatchesByCoordinates(
  ride: RideListItem,
  searchFromLat: number,
  searchFromLon: number,
  searchToLat: number,
  searchToLon: number
): boolean {
  const base =
    routeMatchesLegacyByCoordinates(ride, searchFromLat, searchFromLon, searchToLat, searchToLon) ||
    routeMatchesOppositePickupBetweenDestination(ride, searchFromLat, searchFromLon, searchToLat, searchToLon) ||
    routeMatchesNearPublishedPickupDestinationBetweenOnRoute(ride, searchFromLat, searchFromLon, searchToLat, searchToLon);
  if (!base) return false;
  return passDirectionalConsistencyWithRide(ride, searchFromLat, searchFromLon, searchToLat, searchToLon);
}

/** Loose pickup/destination string match (same as legacy search before coords-only mode). */
function routeMatchesByPlaceText(ride: RideListItem, userFrom: string, userTo: string): boolean {
  const rideFrom = (ride.pickupLocationName ?? ride.from ?? '').trim().toLowerCase();
  const rideTo = (ride.destinationLocationName ?? ride.to ?? '').trim().toLowerCase();
  const from = userFrom.trim().toLowerCase();
  const to = userTo.trim().toLowerCase();
  const fromOk = !rideFrom || rideFrom.includes(from) || from.includes(rideFrom);
  const toOk = !rideTo || rideTo.includes(to) || to.includes(rideTo);
  return fromOk && toOk;
}

/** Match route: coords → legacy + extra rules; else loose text match. */
function routeMatches(
  ride: RideListItem,
  userFrom: string,
  userTo: string,
  searchFromCoords: { latitude: number; longitude: number } | null,
  searchToCoords: { latitude: number; longitude: number } | null
): boolean {
  if (!userFrom.trim() || !userTo.trim()) return true;
  // When both ride and search have coordinates, try geometry first. If it fails, still try text:
  // geocoded "Ghaziabad"/"Noida" are often city centers while the publisher pinned a sector — 4 km geometry then wrongly hides valid rides.
  if (rideHasCoordinates(ride) && searchFromCoords && searchToCoords) {
    if (
      routeMatchesByCoordinates(
        ride,
        searchFromCoords.latitude,
        searchFromCoords.longitude,
        searchToCoords.latitude,
        searchToCoords.longitude
      )
    ) {
      return true;
    }
    return routeMatchesByPlaceText(ride, userFrom, userTo);
  }
  return routeMatchesByPlaceText(ride, userFrom, userTo);
}

type SearchResultsRouteProp = RouteProp<SearchStackParamList, 'SearchResults'>;

type RidesResponse = { rides?: unknown[] } | unknown[];

export default function SearchResultsScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const route = useRoute<SearchResultsRouteProp>();
  const { user, isAuthenticated, needsProfileCompletion } = useAuth();
  const sessionReady = isAuthenticated && !needsProfileCompletion;
  const recentUserKey = (user?.id ?? user?.phone ?? '').trim();
  const {
    from,
    to,
    date,
    passengers: passengersParam,
    fromLatitude,
    fromLongitude,
    toLatitude,
    toLongitude,
  } = route.params;
  const [searchFrom, setSearchFrom] = useState(from);
  const [searchTo, setSearchTo] = useState(to);
  const [searchDate, setSearchDate] = useState(date);
  const [searchPassengers, setSearchPassengers] = useState(passengersParam ?? '1');
  const [searchFromLat, setSearchFromLat] = useState<number | undefined>(fromLatitude);
  const [searchFromLon, setSearchFromLon] = useState<number | undefined>(fromLongitude);
  const [searchToLat, setSearchToLat] = useState<number | undefined>(toLatitude);
  const [searchToLon, setSearchToLon] = useState<number | undefined>(toLongitude);
  const sameRouteWarning =
    searchFrom.trim().length > 0 &&
    searchTo.trim().length > 0 &&
    searchFrom.trim().toLowerCase() === searchTo.trim().toLowerCase();

  const [showEditModal, setShowEditModal] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [draftDate, setDraftDate] = useState(date);
  const [draftPassengers, setDraftPassengers] = useState(passengersParam ?? '1');
  const [draftFromLat, setDraftFromLat] = useState<number | undefined>(fromLatitude);
  const [draftFromLon, setDraftFromLon] = useState<number | undefined>(fromLongitude);
  const [draftToLat, setDraftToLat] = useState<number | undefined>(toLatitude);
  const [draftToLon, setDraftToLon] = useState<number | undefined>(toLongitude);
  const [showDraftDatePicker, setShowDraftDatePicker] = useState(false);
  const [showDraftPassengersPicker, setShowDraftPassengersPicker] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [locationField, setLocationField] = useState<'from' | 'to'>('from');
  const [locationQuery, setLocationQuery] = useState('');
  const [locationSuggestions, setLocationSuggestions] = useState<PlacePrediction[]>([]);
  const [locationRecents, setLocationRecents] = useState<PlaceRecentEntry[]>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const sessionTokenRef = useRef<string | null>(null);
  const editAnim = useRef(new Animated.Value(0)).current;
  const isClosingRef = useRef(false);
  const { width: windowWidth } = useWindowDimensions();
  const MODAL_PADDING_X = 12;
  const MODAL_TOP = 56;

  const pillRef = useRef<View>(null);
  const [pillFrame, setPillFrame] = useState<null | {
    pageX: number;
    pageY: number;
    width: number;
    height: number;
  }>(null);
  const [sheetFrame, setSheetFrame] = useState<null | { width: number; height: number }>(null);

  const openDraftLocationPicker = React.useCallback(
    (field: 'from' | 'to') => {
      setLocationField(field);
      // Keep search field empty on open so the first letters are never visually clipped.
      setLocationQuery('');
      setLocationSuggestions([]);
      sessionTokenRef.current = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      setShowLocationModal(true);
    },
    []
  );

  useEffect(() => {
    if (!showLocationModal) return;
    const fieldType: PlaceRecentFieldType = locationField === 'from' ? 'pickup' : 'destination';
    void loadPlaceRecents(fieldType, recentUserKey).then(setLocationRecents);
  }, [showLocationModal, locationField, recentUserKey]);

  useEffect(() => {
    if (!showLocationModal) return;
    const q = locationQuery.trim();
    if (q.length < 3) {
      setLocationSuggestions([]);
      setLocationLoading(false);
      return;
    }
    setLocationLoading(true);
    const token = sessionTokenRef.current ?? undefined;
    const t = setTimeout(() => {
      import('../../services/places')
        .then(({ getPlaceSuggestions }) => getPlaceSuggestions(q, { sessionToken: token }))
        .then(setLocationSuggestions)
        .catch(() => setLocationSuggestions([]))
        .finally(() => setLocationLoading(false));
    }, 320);
    return () => clearTimeout(t);
  }, [showLocationModal, locationQuery]);

  const applyLocationSelection = useCallback(async (item: {
    label: string;
    placeId?: string;
    latitude?: number;
    longitude?: number;
  }) => {
    let label = item.label;
    let lat = item.latitude;
    let lon = item.longitude;
    if ((lat == null || lon == null) && item.placeId) {
      const { getPlaceDetails } = await import('../../services/places');
      const details = await getPlaceDetails(item.placeId, {
        sessionToken: sessionTokenRef.current ?? undefined,
      });
      if (details) {
        label = details.formattedAddress || item.label;
        lat = details.latitude;
        lon = details.longitude;
      }
    }
    if (locationField === 'from') {
      setDraftFrom(label);
      setDraftFromLat(lat);
      setDraftFromLon(lon);
    } else {
      setDraftTo(label);
      setDraftToLat(lat);
      setDraftToLon(lon);
    }
    if (lat != null && lon != null) {
      const fieldType: PlaceRecentFieldType = locationField === 'from' ? 'pickup' : 'destination';
      const rec = await upsertPlaceRecent(
        {
          placeId: item.placeId || `${lat},${lon}`,
          title: label,
          formattedAddress: label,
          latitude: lat,
          longitude: lon,
          fieldType,
        },
        recentUserKey
      );
      setLocationRecents(rec);
    }
    sessionTokenRef.current = null;
    setShowLocationModal(false);
  }, [locationField, recentUserKey]);

  useFocusEffect(
    React.useCallback(() => {
      const p = route.params as SearchStackParamList['SearchResults'] & {
        selectedFrom?: string;
        selectedTo?: string;
        preservedDate?: string;
        preservedPassengers?: string;
        fromLatitude?: number;
        fromLongitude?: number;
        toLatitude?: number;
        toLongitude?: number;
      };
      if (!p) return;
      let touched = false;
      if (p.selectedFrom !== undefined) {
        setDraftFrom(String(p.selectedFrom ?? ''));
        if (typeof p.fromLatitude === 'number') setDraftFromLat(p.fromLatitude);
        if (typeof p.fromLongitude === 'number') setDraftFromLon(p.fromLongitude);
        touched = true;
      }
      if (p.selectedTo !== undefined) {
        setDraftTo(String(p.selectedTo ?? ''));
        if (typeof p.toLatitude === 'number') setDraftToLat(p.toLatitude);
        if (typeof p.toLongitude === 'number') setDraftToLon(p.toLongitude);
        touched = true;
      }
      if (typeof p.preservedDate === 'string' && p.preservedDate.trim()) {
        setDraftDate(p.preservedDate);
        touched = true;
      }
      if (typeof p.preservedPassengers === 'string' && p.preservedPassengers.trim()) {
        setDraftPassengers(p.preservedPassengers);
        touched = true;
      }
      if (!touched) return;
      (navigation as { setParams: (params: Record<string, unknown>) => void }).setParams({
        selectedFrom: undefined,
        selectedTo: undefined,
        preservedDate: undefined,
        preservedPassengers: undefined,
        fromLatitude: undefined,
        fromLongitude: undefined,
        toLatitude: undefined,
        toLongitude: undefined,
      });
      setShowEditModal(true);
    }, [route.params, navigation])
  );


  const passengersForRecent = searchPassengers;
  const [rides, setRides] = useState<RideListItem[]>([]);
  /** Rides where the current user has a confirmed booking (GET /bookings). */
  const [myConfirmedRideIds, setMyConfirmedRideIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [listRefreshing, setListRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trailingNeededRef = useRef(false);

  const currentUserId = (user?.id ?? '').trim();
  const currentUserName = (user?.name ?? '').trim();
  const viewerAvatarUrl = user?.avatarUrl?.trim();

  /** Only persist after results load successfully — not when tapping Search on the previous screen. */
  const recentSavedSigRef = useRef<string | null>(null);
  useEffect(() => {
    if (sameRouteWarning) return;
    if (!sessionReady || loading || error) return;
    const sig = `${searchFrom}|${searchTo}|${searchDate}|${passengersForRecent}|${searchFromLat ?? ''}|${searchFromLon ?? ''}|${searchToLat ?? ''}|${searchToLon ?? ''}`;
    if (recentSavedSigRef.current === sig) return;
    recentSavedSigRef.current = sig;
    void addRecentSearch(
      {
        from: searchFrom.trim(),
        to: searchTo.trim(),
        date: searchDate,
        passengers: passengersForRecent,
        ...(searchFromLat != null && searchFromLon != null
          ? { fromLatitude: searchFromLat, fromLongitude: searchFromLon }
          : {}),
        ...(searchToLat != null && searchToLon != null
          ? { toLatitude: searchToLat, toLongitude: searchToLon }
          : {}),
      },
      recentUserKey
    );
  }, [
    sameRouteWarning,
    sessionReady,
    loading,
    error,
    searchFrom,
    searchTo,
    searchDate,
    passengersForRecent,
    searchFromLat,
    searchFromLon,
    searchToLat,
    searchToLon,
    recentUserKey,
  ]);

  const performFetchRides = useCallback(
    async (silent: boolean) => {
      setError(null);
      if (silent) {
        setListRefreshing(true);
      } else {
        setLoading(true);
      }
      try {
        const fromCoordsFromParams =
          searchFromLat != null && searchFromLon != null
            ? { latitude: searchFromLat, longitude: searchFromLon }
            : null;
        const toCoordsFromParams =
          searchToLat != null && searchToLon != null
            ? { latitude: searchToLat, longitude: searchToLon }
            : null;
        const [data, geocodedFrom, geocodedTo, bookingsRes] = await Promise.all([
          api.get<RidesResponse>(API.endpoints.rides.list),
          fromCoordsFromParams ? null : (searchFrom.trim() ? geocodeAddressWithFallbacks(searchFrom) : Promise.resolve(null)),
          toCoordsFromParams ? null : (searchTo.trim() ? geocodeAddressWithFallbacks(searchTo) : Promise.resolve(null)),
          api.get<unknown>(API.endpoints.bookings.list).catch(() => null),
        ]);
        const myConfirmedRideIds = new Set<string>();
        if (bookingsRes) {
          const arr = extractBookingsListArray(bookingsRes);
          for (const raw of arr) {
            const rideId = rideIdFromBookingListRow(raw as Record<string, unknown>);
            const row = mapRawToBookingRow(raw as Record<string, unknown>);
            if (!rideId || !row || bookingIsCancelled(row.status)) continue;
            myConfirmedRideIds.add(rideId);
          }
        }
        const searchFromCoords = fromCoordsFromParams ?? geocodedFrom ?? null;
        const searchToCoords = toCoordsFromParams ?? geocodedTo ?? null;
        const d = data as Record<string, unknown> | unknown[];
        const rawList = Array.isArray(d)
          ? d
          : (d?.rides as unknown[] | undefined) ?? (d?.data as Record<string, unknown> | undefined)?.rides ?? [];
        const all = (rawList as Record<string, unknown>[]).map(normalizeRideItem);
        const filtered = all.filter((ride) => {
          const rideDate = getRideDateYMD(ride);
          if (rideDate !== searchDate) return false;
          if (!routeMatches(ride, searchFrom, searchTo, searchFromCoords, searchToCoords)) return false;
          if (currentUserId && isViewerRideOwner(ride, currentUserId)) return false;
          if (isRideCancelledByOwner(ride)) return false;
          if (!isAtLeast15MinsLater(ride)) return false;
          return true;
        });
        setMyConfirmedRideIds(myConfirmedRideIds);
        setRides(filtered);
        setSearchResultsCache(
          searchResultsCacheKey({
            searchFrom,
            searchTo,
            searchDate,
            searchPassengers,
            fromLat: searchFromLat,
            fromLon: searchFromLon,
            toLat: searchToLat,
            toLon: searchToLon,
          }),
          filtered,
          myConfirmedRideIds
        );
      } catch (e: unknown) {
        const message =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: unknown }).message)
            : 'Failed to load rides.';
        setError(message);
      } finally {
        setLoading(false);
        setListRefreshing(false);
      }
    },
    [
      searchFrom,
      searchTo,
      searchDate,
      searchPassengers,
      searchFromLat,
      searchFromLon,
      searchToLat,
      searchToLon,
      currentUserId,
    ]
  );

  const fetchRides = useCallback(() => {
    const run = async () => {
      if (inFlightRef.current) {
        trailingNeededRef.current = true;
        return;
      }
      inFlightRef.current = true;
      try {
        await performFetchRides(false);
        lastFetchAtRef.current = Date.now();
      } finally {
        inFlightRef.current = false;
      }

      if (trailingNeededRef.current) {
        trailingNeededRef.current = false;
        const wait = Math.max(0, RIDES_FETCH_MIN_GAP_MS - (Date.now() - lastFetchAtRef.current));
        if (trailingTimerRef.current) clearTimeout(trailingTimerRef.current);
        trailingTimerRef.current = setTimeout(() => {
          trailingTimerRef.current = null;
          void fetchRides();
        }, wait);
      }
    };

    const elapsed = Date.now() - lastFetchAtRef.current;
    if (elapsed >= RIDES_FETCH_MIN_GAP_MS) {
      void run();
      return;
    }
    trailingNeededRef.current = true;
    if (trailingTimerRef.current) return;
    trailingTimerRef.current = setTimeout(() => {
      trailingTimerRef.current = null;
      void run();
    }, RIDES_FETCH_MIN_GAP_MS - elapsed);
  }, [performFetchRides]);

  React.useEffect(() => {
    if (sameRouteWarning) {
      setLoading(false);
      setListRefreshing(false);
      setError(null);
      setRides([]);
      setMyConfirmedRideIds(new Set());
      return;
    }
    const key = searchResultsCacheKey({
      searchFrom,
      searchTo,
      searchDate,
      searchPassengers,
      fromLat: searchFromLat,
      fromLon: searchFromLon,
      toLat: searchToLat,
      toLon: searchToLon,
    });
    const cached = getSearchResultsCache(key);
    if (cached) {
      setRides(cached.rides);
      setMyConfirmedRideIds(new Set(cached.myConfirmedIds));
      setError(null);
      setLoading(false);
      void performFetchRides(true);
      return;
    }
    fetchRides();
  }, [
    sameRouteWarning,
    fetchRides,
    performFetchRides,
    searchFrom,
    searchTo,
    searchDate,
    searchPassengers,
    searchFromLat,
    searchFromLon,
    searchToLat,
    searchToLon,
  ]);

  React.useEffect(() => {
    return () => {
      if (trailingTimerRef.current) clearTimeout(trailingTimerRef.current);
    };
  }, []);

  const openEditSheet = () => {
    setDraftFrom(searchFrom);
    setDraftTo(searchTo);
    setDraftDate(searchDate);
    setDraftPassengers(searchPassengers);
    setDraftFromLat(searchFromLat);
    setDraftFromLon(searchFromLon);
    setDraftToLat(searchToLat);
    setDraftToLon(searchToLon);
    isClosingRef.current = false;
    setSheetFrame(null);
    setPillFrame(null);
    setShowEditModal(true);
    editAnim.setValue(0);

    // Measure pill position/sizing (used to animate from the pill into the sheet).
    const node: any = pillRef.current;
    node?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
      setPillFrame({ pageX: x, pageY: y, width: w, height: h });
    });
  };

  const closeEditSheet = () => {
    isClosingRef.current = true;
    Animated.timing(editAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setShowEditModal(false);
        setPillFrame(null);
        setSheetFrame(null);
        isClosingRef.current = false;
      }
    });
  };

  useEffect(() => {
    if (!showEditModal) return;
    if (isClosingRef.current) return;
    // When returning from full-screen LocationPicker there is no pill re-measure context.
    // Open the edit modal fully visible without the pill->sheet animation.
    if (!pillFrame) {
      editAnim.setValue(1);
      return;
    }
    if (!sheetFrame) return;

    Animated.timing(editAnim, {
      toValue: 1,
      duration: 320,
      useNativeDriver: true,
    }).start();
  }, [showEditModal, pillFrame, sheetFrame, editAnim]);

  const finalLeft = MODAL_PADDING_X;
  const finalTop = MODAL_TOP;
  const finalWidth = windowWidth - MODAL_PADDING_X * 2;
  const targetWidth = sheetFrame?.width ?? finalWidth;
  const targetHeight = sheetFrame?.height ?? 420;
  const startDx = pillFrame ? pillFrame.pageX - finalLeft : 0;
  const startDy = pillFrame ? pillFrame.pageY - finalTop : 0;
  const startScaleX = pillFrame ? pillFrame.width / Math.max(1, targetWidth) : 0.9;
  const startScaleY = pillFrame ? pillFrame.height / Math.max(1, targetHeight) : 0.9;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topHeader}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={22} color={COLORS.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          ref={pillRef}
          style={[styles.pill, styles.pillTap]}
          activeOpacity={0.75}
          onPress={openEditSheet}
        >
          <View style={styles.pillLine1}>
            <Text style={styles.pillRouteText} numberOfLines={1}>
              {truncateRouteLabel(searchFrom, 22)}
            </Text>
            <Ionicons name="arrow-forward" size={18} color={COLORS.textMuted} />
            <Text style={styles.pillRouteText} numberOfLines={1}>
              {truncateRouteLabel(searchTo, 22)}
            </Text>
          </View>
          <Text style={styles.pillLine2} numberOfLines={1}>
            {[formatDateSectionLabel(searchDate ?? ''), formatPassengerLabel(passengersForRecent)]
              .filter(Boolean)
              .join(', ')}
          </Text>
        </TouchableOpacity>
      </View>

      {sameRouteWarning ? (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={48} color={COLORS.warning} />
          <Text style={styles.emptyTitle}>Invalid route</Text>
          <Text style={styles.emptySubtitle}>
            Pickup and destination are same, select different destination.
          </Text>
        </View>
      ) : loading && rides.length === 0 ? (
        <View style={styles.skeletonListWrap}>
          {Array.from({ length: 4 }).map((_, idx) => (
            <RideCardSkeleton key={`ride-skeleton-${idx}`} />
          ))}
        </View>
      ) : error && rides.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchRides}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {error ? (
            <View style={styles.staleBanner}>
              <Ionicons name="cloud-offline-outline" size={14} color={COLORS.warning} />
              <Text style={styles.staleBannerText}>{error}</Text>
            </View>
          ) : null}
          <FlatList
            data={rides}
            keyExtractor={(item) => item.id}
            contentContainerStyle={rides.length === 0 ? styles.emptyList : styles.list}
            refreshControl={
              <RefreshControl
                refreshing={loading || listRefreshing}
                onRefresh={fetchRides}
                colors={[COLORS.primary]}
              />
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="car-outline" size={56} color={COLORS.textMuted} />
                <Text style={styles.emptyTitle}>No rides found</Text>
                <Text style={styles.emptySubtitle}>No rides match this date and route. Try another date or locations.</Text>
              </View>
            }
            renderItem={({ item }) => {
              const isOwner = isViewerRideOwner(item, currentUserId);
              const hasMyBooking =
                myConfirmedRideIds.has(item.id) ||
                ((item.bookings ?? []).some(
                  (b) => (b.userId ?? '').trim() === currentUserId && !bookingIsCancelled(b.status)
                )) ||
                Boolean(
                  item.myBookingStatus &&
                    String(item.myBookingStatus).trim() &&
                    !bookingIsCancelled(String(item.myBookingStatus))
                );
              const seatFullBlocked =
                !isOwner && isRideSeatsFull(item) && !hasMyBooking;
              return (
                <RideListCard
                  ride={item}
                  currentUserId={currentUserId}
                  currentUserName={currentUserName}
                  viewerAvatarUrl={viewerAvatarUrl}
                  seatFullUnavailable={seatFullBlocked}
                  onPress={() => {
                    if (seatFullBlocked) {
                      showToast({
                        title: 'Ride full',
                        message: 'All seats on this ride are booked.',
                        variant: 'info',
                      });
                      return;
                    }
                    navigation.navigate('RideDetail', {
                      ride: item,
                      passengerSearch: {
                        from: searchFrom,
                        to: searchTo,
                        fromLatitude: searchFromLat,
                        fromLongitude: searchFromLon,
                        toLatitude: searchToLat,
                        toLongitude: searchToLon,
                      },
                    });
                  }}
                />
              );
            }}
          />
        </>
      )}

      <Modal visible={showEditModal} transparent animationType="none" onRequestClose={closeEditSheet}>
        <Animated.View
          style={[
            styles.modalOverlay,
            {
              opacity: editAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 1],
              }),
            },
          ]}
        >
          <Animated.View
            style={[
              styles.modalCard,
              {
                position: 'absolute',
                left: MODAL_PADDING_X,
                top: MODAL_TOP,
                width: finalWidth,
                opacity: editAnim,
                transform: [
                  {
                    translateX: editAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [startDx, 0],
                    }),
                  },
                  {
                    translateY: editAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [startDy, 0],
                    }),
                  },
                  {
                    scaleX: editAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [startScaleX, 1],
                    }),
                  },
                  {
                    scaleY: editAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [startScaleY, 1],
                    }),
                  },
                ],
              },
            ]}
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              if (height > 0 && width > 0) setSheetFrame({ width, height });
            }}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit search</Text>
              <TouchableOpacity onPress={closeEditSheet} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Update pickup, destination and date</Text>

            <View style={styles.editCard}>
              <View style={styles.editRow}>
                <View style={styles.editIconCol}>
                  <Ionicons name="navigate-circle-outline" size={16} color={COLORS.primary} />
                  <View style={styles.greenDot} />
                  <View style={styles.dottedLine} />
                </View>
                <View style={styles.editInputWrap}>
                  <Text style={styles.editLabel}>Pickup</Text>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    onPress={() => openDraftLocationPicker('from')}
                    style={styles.editTextTap}
                  >
                    <Text
                      style={[styles.editTextInput, !draftFrom.trim() && styles.editTextPlaceholder]}
                      numberOfLines={1}
                    >
                      {draftFrom || 'Where from?'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={styles.swapButton}
                  onPress={() => {
                    const prevFrom = draftFrom;
                    const prevTo = draftTo;
                    setDraftFrom(prevTo);
                    setDraftTo(prevFrom);

                    const prevFromLat = draftFromLat;
                    const prevFromLon = draftFromLon;
                    const prevToLat = draftToLat;
                    const prevToLon = draftToLon;
                    setDraftFromLat(prevToLat);
                    setDraftFromLon(prevToLon);
                    setDraftToLat(prevFromLat);
                    setDraftToLon(prevFromLon);
                  }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  activeOpacity={0.75}
                >
                  <Ionicons name="swap-vertical" size={22} color={COLORS.primary} />
                </TouchableOpacity>
              </View>

              <View style={styles.editRow}>
                <View style={styles.editIconCol}>
                  <Ionicons name="location-outline" size={16} color={COLORS.error} />
                  <View style={styles.redPin} />
                </View>
                <View style={styles.editInputWrap}>
                  <Text style={styles.editLabel}>Destination</Text>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    onPress={() => openDraftLocationPicker('to')}
                    style={styles.editTextTap}
                  >
                    <Text
                      style={[styles.editTextInput, !draftTo.trim() && styles.editTextPlaceholder]}
                      numberOfLines={1}
                    >
                      {draftTo || 'Add destination'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.cardDivider} />

              <TouchableOpacity
                style={styles.editRow}
                activeOpacity={0.75}
                onPress={() => setShowDraftDatePicker(true)}
              >
                <View style={styles.editIconCol}>
                  <Ionicons name="calendar-outline" size={20} color={COLORS.textSecondary} />
                </View>
                <View style={styles.editInputWrap}>
                  <Text style={styles.editLabel}>Date</Text>
                  <Text style={styles.editTextValue}>
                    {draftDate ? formatDateSectionLabel(draftDate) : 'Select date'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.editRow}
                activeOpacity={0.75}
                onPress={() => setShowDraftPassengersPicker(true)}
              >
                <View style={styles.editIconCol}>
                  <Ionicons name="people-outline" size={20} color={COLORS.textSecondary} />
                </View>
                <View style={styles.editInputWrap}>
                  <Text style={styles.editLabel}>Passengers</Text>
                  <Text style={styles.editTextValue}>{formatPassengerLabel(draftPassengers)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.applyButton}
              onPress={() => {
                const f = draftFrom.trim();
                const t = draftTo.trim();
                const d = draftDate.trim();
                const p = Math.min(4, Math.max(1, parseInt(draftPassengers, 10) || 1));
                if (!f || !t || !d) {
                  Alert.alert('Missing fields', 'Please fill pickup, destination and date.');
                  return;
                }
                setSearchFrom(f);
                setSearchTo(t);
                setSearchDate(d);
                setSearchPassengers(String(p));
                setSearchFromLat(draftFromLat);
                setSearchFromLon(draftFromLon);
                setSearchToLat(draftToLat);
                setSearchToLon(draftToLon);
                closeEditSheet();
              }}
            >
              <Text style={styles.applyButtonText}>Update results</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </Modal>

      <DatePickerModal
        visible={showDraftDatePicker}
        onClose={() => setShowDraftDatePicker(false)}
        selectedDate={
          draftDate
            ? (() => {
                const [y, m, d] = draftDate.split('-').map(Number);
                return new Date(y, m - 1, d);
              })()
            : null
        }
        onSelectDate={(d) => {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const dayStr = String(d.getDate()).padStart(2, '0');
          setDraftDate(`${y}-${m}-${dayStr}`);
          setShowDraftDatePicker(false);
        }}
        title="When are you going? Select date."
      />

      <PassengersPickerModal
        visible={showDraftPassengersPicker}
        onClose={() => setShowDraftPassengersPicker(false)}
        value={Math.min(4, Math.max(1, parseInt(draftPassengers, 10) || 1))}
        onDone={(n) => setDraftPassengers(String(n))}
      />

      <Modal visible={showLocationModal} animationType="slide" presentationStyle="fullScreen">
        <SafeAreaView style={styles.locationModalContainer} edges={['top']}>
          <View style={styles.locationModalHeader}>
            <TouchableOpacity
              onPress={() => setShowLocationModal(false)}
              style={styles.locationBackBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="chevron-back" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.locationModalTitle}>
              {locationField === 'from' ? 'Select pickup' : 'Select destination'}
            </Text>
            <View style={styles.locationBackBtn} />
          </View>
          <View style={styles.locationSearchWrap}>
            <TextInput
              style={styles.locationSearchInput}
              placeholder={locationField === 'from' ? 'Search pickup' : 'Search destination'}
              placeholderTextColor={COLORS.textMuted}
              autoFocus
              value={locationQuery}
              onChangeText={setLocationQuery}
              autoCorrect={false}
            />
          </View>
          {locationLoading ? (
            <View style={styles.locationLoadingRow}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.locationLoadingText}>Searching...</Text>
            </View>
          ) : null}
          {locationQuery.trim().length < 3 ? (
            <View style={styles.locationListWrap}>
              <Text style={styles.locationSectionTitle}>Recent Searches</Text>
              <FlatList
                data={locationRecents}
                keyExtractor={(item) => item.placeId}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.locationRow}
                    onPress={() =>
                      void applyLocationSelection({
                        label: item.formattedAddress || item.title,
                        placeId: item.placeId,
                        latitude: item.latitude,
                        longitude: item.longitude,
                      })
                    }
                  >
                    <Ionicons name="time-outline" size={16} color={COLORS.textMuted} />
                    <View style={styles.locationRowTextWrap}>
                      <Text style={styles.locationRowTitle} numberOfLines={1}>{item.title}</Text>
                      <Text style={styles.locationRowSubtitle} numberOfLines={1}>{item.formattedAddress}</Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
            </View>
          ) : (
            <View style={styles.locationListWrap}>
              <Text style={styles.locationSectionTitle}>Search Results</Text>
              <FlatList
                data={locationSuggestions}
                keyExtractor={(item) => item.placeId}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.locationRow}
                    onPress={() => void applyLocationSelection({ label: item.description, placeId: item.placeId })}
                  >
                    <Ionicons name="location-outline" size={16} color={COLORS.textSecondary} />
                    <View style={styles.locationRowTextWrap}>
                      <Text style={styles.locationRowTitle} numberOfLines={2}>{item.description}</Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  errorText: {
    marginTop: 12,
    fontSize: 15,
    color: COLORS.error,
    textAlign: 'center',
  },
  staleBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fed7aa',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  staleBannerText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  retryButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 32,
  },
  skeletonListWrap: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
  },
  topHeader: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 26,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: {
        elevation: 3,
      },
      default: {},
    }),
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  pill: {
    flex: 1,
    backgroundColor: 'transparent',
    borderRadius: 22,
  },
  pillTap: {
    flex: 1,
  },
  pillLine1: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pillRouteText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.text,
  },
  pillLine2: {
    marginTop: 6,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  emptyList: {
    flexGrow: 1,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-start',
    paddingTop: 0,
    paddingHorizontal: 0,
  },
  modalCard: {
    backgroundColor: COLORS.background,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 18,
    paddingHorizontal: 18,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
  },
  modalSubtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 14,
  },
  editCard: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    marginBottom: 4,
  },
  editIconCol: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  greenDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.background,
    marginTop: 3,
  },
  dottedLine: {
    width: 2,
    flex: 1,
    minHeight: 18,
    marginVertical: 4,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.border,
    borderStyle: 'dashed',
  },
  redPin: {
    width: 12,
    height: 16,
    backgroundColor: COLORS.error,
    borderRadius: 6,
    marginTop: 3,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 10,
    marginLeft: 44,
  },
  editInputWrap: {
    flex: 1,
    marginLeft: 14,
  },
  editLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
    marginTop: 3,
  },
  editTextInput: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
    paddingVertical: 0,
    paddingHorizontal: 0,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  editTextTap: {
    minHeight: 24,
    justifyContent: 'center',
  },
  editTextPlaceholder: {
    color: COLORS.textMuted,
  },
  editTextValue: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
  },
  swapButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  applyButton: {
    marginTop: 14,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  applyButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
  },
  locationModalContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  locationModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  locationBackBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  locationSearchWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  locationSearchInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.backgroundSecondary,
  },
  locationLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  locationLoadingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  locationListWrap: {
    flex: 1,
    marginTop: 10,
  },
  locationSectionTitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '700',
    letterSpacing: 0.3,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  locationRowTextWrap: {
    flex: 1,
  },
  locationRowTitle: {
    fontSize: 15,
    color: COLORS.text,
    fontWeight: '600',
  },
  locationRowSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
});
