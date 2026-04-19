import React, { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  SectionList,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Animated,
  Modal,
  Pressable,
  TextInput,
  Platform,
  Keyboard,
  BackHandler,
  DeviceEventEmitter,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Alert } from '../../utils/themedAlert';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RidesStackParamList } from '../../navigation/types';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useOwnerPendingRequests } from '../../contexts/OwnerPendingRequestsContext';
import api from '../../services/api';
import { extractRideListFromResponse } from '../../services/fetchPassengerBookedRides';
import { clearRideDetailCache, fetchRideDetailRaw } from '../../services/rideDetailCache';
import {
  mergeRideListRowWithDetailSnapshot,
  rideListItemFromDetailApiPayload,
  RIDE_LIST_MERGE_FROM_DETAIL,
  type RideListMergeFromDetailPayload,
} from '../../services/rideListFromDetailSync';
import {
  REQUEST_MY_RIDES_LIST_REFRESH,
  type MyRidesRefreshRequestPayload,
} from '../../services/myRidesListRefreshEvents';
import { loadOwnerCancelledRides } from '../../services/ownerCancelledRidesStorage';
import { API } from '../../constants/API';
import type { RideListItem } from '../../types/api';
import { COLORS } from '../../constants/colors';
import {
  OFFLINE_A11Y_CACHED_LIST,
  OFFLINE_HEADLINE,
  OFFLINE_SUBTITLE_REFRESH,
  OFFLINE_SUBTITLE_RETRY,
  OFFLINE_USER_MESSAGE,
} from '../../constants/offlineMessaging';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import RideListCard from '../../components/rides/RideListCard';
import {
  getRideScheduledAt,
  isPublishedRideLiveNow,
  isRideCancelledByOwner,
  isRideCompletedForDisplay,
  isRidePastArrivalWindow,
  isViewerRideOwner,
} from '../../utils/rideDisplay';
import { pickRoutePolylineEncodedFromRecord } from '../../utils/ridePublisherCoords';
import {
  extractBookingsListArray,
  groupBookingListByRideId,
  mapRawToBookingRow,
  mergeBookingsMapOntoRides,
  normalizeBookingsFromDetailResponse,
  rideIdFromBookingListRow,
  type RideBookingRow,
} from '../../utils/bookingNormalize';
import {
  bookingIsCancelled,
  bookingIsCancelledByOwner,
  bookingIsPendingLike,
  pickPreferredBookingStatus,
} from '../../utils/bookingStatus';
import { isRideSeatsFull } from '../../utils/rideSeats';
import {
  buildDrivingPassengerSections,
  countForTab,
  matchesAllRidesTab,
  matchesMyRidesTab,
  matchesPastRidesTab,
  passengerHasBookingRowOnRide,
  sortRidesForYourRides,
  type YourRidesFilterTab,
  type YourRidesListContext,
} from '../../utils/yourRidesList';
import { showToast } from '../../utils/toast';
import { hasCurrentUserRatedRide, submitRideRating } from '../../services/ratings';
import { hasHandledRatingPrompt, markRatingPromptHandled } from '../../services/ratingPromptStorage';
import {
  loadRatedRidesCache,
  mergeOwnerRatedPassenger,
  mergePassengerRatedRide,
} from '../../services/ratedRidesStorage';
import { pickPublisherAvatarUrl } from '../../utils/avatarUrl';
import { findMainTabNavigatorWithOptions } from '../../navigation/findMainTabNavigator';
import { useMainTabScrollBottomInset } from '../../navigation/useMainTabScrollBottomInset';
import RideCardSkeleton from '../../components/rides/RideCardSkeleton';
import type { RecentPublishedEntry } from '../../services/recent-published-storage';
import { loadYourRidesListCache, saveYourRidesListCache } from '../../services/yourRidesListCache';

type FilterTab = YourRidesFilterTab;

/** Normalize API ride item: use rideDate/rideTime or scheduledDate/scheduledTime; derive from scheduledAt if needed. Never use createdAt for "when". */
function normalizeRideItem(raw: Record<string, unknown>): RideListItem {
  const r = raw as Record<string, unknown>;
  const toStr = (v: unknown): string | undefined =>
    v === undefined || v === null ? undefined : String(v);
  const rideDate = toStr(r.rideDate ?? r.ride_date);
  const rideTime = toStr(r.rideTime ?? r.ride_time);
  const scheduledDate = toStr(r.scheduledDate ?? r.scheduled_date ?? r.date);
  const scheduledTime = toStr(r.scheduledTime ?? r.scheduled_time ?? r.time);
  const scheduledAt = toStr(r.scheduledAt ?? r.scheduled_at);
  let outDate = rideDate || scheduledDate;
  let outTime = rideTime || scheduledTime;
  if ((!outDate || !outTime) && scheduledAt) {
    const d = new Date(scheduledAt);
    if (!isNaN(d.getTime())) {
      outDate = outDate || `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      outTime = outTime || `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  }
  const rawSeats = r.seats;
  const seats =
    typeof rawSeats === 'number'
      ? rawSeats
      : rawSeats != null && rawSeats !== ''
        ? Number(rawSeats)
        : undefined;
  const outSeats =
    typeof seats === 'number' && !Number.isNaN(seats) && seats >= 0 ? Math.floor(seats) : undefined;
  const rawBooked = r.bookedSeats ?? r.booked_seats;
  const bookedSeatsNum =
    typeof rawBooked === 'number' && !Number.isNaN(rawBooked)
      ? Math.max(0, Math.floor(rawBooked))
      : undefined;
  const rawTotalBk = r.totalBookings ?? r.total_bookings;
  const totalBookingsNum =
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
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && !Number.isNaN(v) ? v : v != null && v !== '' ? Number(v) : undefined;
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
  const out: RideListItem = {
    id: String(r.id ?? r._id ?? ''),
    userId: toStr(r.userId ?? r.user_id ?? r.driverId ?? r.driver_id),
    pickupLocationName: toStr(r.pickupLocationName ?? r.pickup_location_name ?? r.from),
    destinationLocationName: toStr(r.destinationLocationName ?? r.destination_location_name ?? r.to),
    pickupLatitude: num(r.pickupLatitude ?? r.pickup_latitude),
    pickupLongitude: num(r.pickupLongitude ?? r.pickup_longitude),
    destinationLatitude: num(r.destinationLatitude ?? r.destination_latitude),
    destinationLongitude: num(r.destinationLongitude ?? r.destination_longitude),
    from: toStr(r.from),
    to: toStr(r.to),
    username: toStr(r.username ?? r.user_name ?? nestedUser?.username),
    ...(driverDisplayName ? { name: driverDisplayName } : {}),
    seats: outSeats,
    ...(bookedSeatsNum !== undefined ? { bookedSeats: bookedSeatsNum } : {}),
    ...(totalBookingsNum !== undefined ? { totalBookings: totalBookingsNum } : {}),
    ...(pendingRequestsNum !== undefined ? { pendingRequests: pendingRequestsNum } : {}),
    ...(hasPendingRequestsFlag !== undefined ? { hasPendingRequests: hasPendingRequestsFlag } : {}),
    ...(availableSeatsNum !== undefined ? { availableSeats: availableSeatsNum } : {}),
    rideDate: outDate,
    rideTime: outTime,
    scheduledDate: scheduledDate || outDate,
    scheduledTime: scheduledTime || outTime,
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
      const st = toStr(r.status ?? r.ride_status ?? r.state ?? r.rideState);
      if (st) return st;
      if (r.cancelled_at != null || r.cancelledAt != null || r.deleted_at != null || r.deletedAt != null) {
        return 'cancelled';
      }
      return undefined;
    })(),
    myBookingStatus: toStr(r.myBookingStatus ?? r.my_booking_status),
    myBookingStatusReason: toStr(
      r.myBookingStatusReason ??
        r.my_booking_status_reason ??
        r.statusReason ??
        r.status_reason
    ),
  };
  const estDur = num(r.estimatedDurationSeconds ?? r.estimated_duration_seconds);
  const routePolyRaw = pickRoutePolylineEncodedFromRecord(r as Record<string, unknown>);
  if (estDur !== undefined && estDur > 0) {
    out.estimatedDurationSeconds = Math.floor(estDur);
  }
  if (routePolyRaw) {
    out.routePolylineEncoded = routePolyRaw;
  }
  const rawBookings = r.bookings;
  if (Array.isArray(rawBookings)) {
    const rows = rawBookings
      .map((b) => mapRawToBookingRow(b as Record<string, unknown>))
      .filter((row): row is NonNullable<RideListItem['bookings']>[number] => row != null);
    if (rows.length > 0) out.bookings = rows;
  }
  const rawVi = r.viewerIsOwner ?? r.viewer_is_owner;
  if (typeof rawVi === 'boolean') out.viewerIsOwner = rawVi;
  else if (rawVi === 'true') out.viewerIsOwner = true;
  else if (rawVi === 'false') out.viewerIsOwner = false;
  const pubAvatar = pickPublisherAvatarUrl(r);
  if (pubAvatar) out.publisherAvatarUrl = pubAvatar;
  const rideDesc = toStr(
    r.description ??
      r.rideDescription ??
      r.ride_description ??
      r.driverNotes ??
      r.driver_notes ??
      r.notes
  )?.trim();
  if (rideDesc) out.description = rideDesc;
  const vbc = r.viewer_booking_context;
  if (vbc && typeof vbc === 'object') {
    out.viewer_booking_context = vbc as NonNullable<RideListItem['viewer_booking_context']>;
  }
  const bm = toStr(r.bookingMode ?? r.booking_mode)?.trim().toLowerCase();
  if (bm === 'instant' || bm === 'request') out.bookingMode = bm as RideListItem['bookingMode'];
  if (typeof r.instantBooking === 'boolean') out.instantBooking = r.instantBooking;
  else if (typeof r.instant_booking === 'boolean') out.instantBooking = r.instant_booking;
  return out;
}

/**
 * GET /rides may omit owner-cancelled rides; GET /bookings still has rows. Build list items from
 * embedded `ride` on each booking when the ride id is not already in the list.
 */
function appendMissingRidesFromEmbeddedBookings(
  list: RideListItem[],
  bookingsArr: Record<string, unknown>[],
  byRide: Map<string, RideBookingRow[]>,
  myBookingStatusByRideId: Map<string, string>
): RideListItem[] {
  const existing = new Set(list.map((r) => r.id));
  const extras: RideListItem[] = [];
  byRide.forEach((rideBookings, rideId) => {
    if (existing.has(rideId)) return;
    const raw = bookingsArr.find((b) => rideIdFromBookingListRow(b) === rideId);
    if (!raw || !raw.ride || typeof raw.ride !== 'object') return;
    const stub = normalizeRideItem(raw.ride as Record<string, unknown>);
    const st = myBookingStatusByRideId.get(rideId);
    extras.push({
      ...stub,
      id: rideId,
      bookings: rideBookings,
      ...(st !== undefined ? { myBookingStatus: st } : {}),
      viewerIsOwner: false,
    });
  });
  return [...list, ...extras];
}

/**
 * Merge GET /my-rides (driver) with GET /rides/booked (passenger, incl. owner-cancelled).
 * Published entries win on conflict; counts may be filled from the booked response.
 */
function mergePublishedAndBookedRideLists(
  published: RideListItem[],
  bookedAsPassenger: RideListItem[]
): RideListItem[] {
  const pickDescription = (row: RideListItem): string =>
    String(row.description ?? row.rideDescription ?? row.ride_description ?? '').trim();
  const map = new Map<string, RideListItem>();
  for (const r of published) {
    if (!r.id) continue;
    // /my-rides = rides you published; treat as yours unless API explicitly says otherwise.
    map.set(r.id, { ...r, viewerIsOwner: r.viewerIsOwner !== false });
  }
  for (const r of bookedAsPassenger) {
    if (!r.id) continue;
    const existing = map.get(r.id);
    const fromBooked = { ...r, viewerIsOwner: r.viewerIsOwner ?? false };
    if (!existing) {
      map.set(r.id, fromBooked);
      continue;
    }
    const existingDescription = pickDescription(existing);
    const bookedDescription = pickDescription(fromBooked);
    const mergedDescription = existingDescription || bookedDescription;
    map.set(r.id, {
      ...existing,
      totalBookings: fromBooked.totalBookings ?? existing.totalBookings,
      bookedSeats: fromBooked.bookedSeats ?? existing.bookedSeats,
      bookings:
        (existing.bookings?.length ?? 0) >= (fromBooked.bookings?.length ?? 0)
          ? existing.bookings
          : fromBooked.bookings,
      viewerIsOwner: existing.viewerIsOwner === true || fromBooked.viewerIsOwner === true,
      ...(mergedDescription
        ? {
            description: mergedDescription,
            rideDescription: mergedDescription,
            ride_description: mergedDescription,
          }
        : {}),
    });
  }
  return Array.from(map.values());
}

/**
 * Union in rides from GET /rides (browse catalog) for “All rides”.
 * Existing rows win on id. For **new** rows: never set `viewerIsOwner: false` by default —
 * public lists often send false/omit for everyone, which blocks isViewerRideOwner’s
 * userId fallback so real owners disappear from “My rides”.
 */
function mergeBrowseCatalogIntoList(list: RideListItem[], browse: RideListItem[]): RideListItem[] {
  const map = new Map<string, RideListItem>();
  for (const r of list) {
    if (r.id) map.set(r.id, r);
  }
  for (const r of browse) {
    if (!r.id) continue;
    if (!map.has(r.id)) {
      const next: RideListItem = { ...r };
      if (next.viewerIsOwner !== true) {
        delete next.viewerIsOwner;
      }
      map.set(r.id, next);
    }
  }
  return Array.from(map.values());
}

type RidesResponse = { rides?: RideListItem[] } | RideListItem[];

/** Space out ride-list calls so strict backends don’t return 429 for 3× parallel GET /rides*. */
const RIDE_LIST_STAGGER_MS = 90;

function rideListStagger(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RIDE_LIST_STAGGER_MS));
}

function apiErrorStatus(e: unknown): number | undefined {
  if (e && typeof e === 'object') {
    const o = e as { status?: unknown; statusCode?: unknown };
    if (typeof o.status === 'number') return o.status;
    if (typeof o.statusCode === 'number') return o.statusCode;
  }
  return undefined;
}

/** True when the transport layer failed (offline, DNS, refused, timeout) — not HTTP 4xx/5xx bodies. */
function isLikelyNetworkFailure(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as {
    message?: unknown;
    code?: unknown;
    response?: unknown;
  };
  if (err.response != null) return false;
  const code = String(err.code ?? '');
  if (code === 'ERR_NETWORK' || code === 'ECONNABORTED') return true;
  const msg = String(err.message ?? '').toLowerCase();
  return (
    msg.includes('network request failed') ||
    msg.includes('network error') ||
    msg.includes('failed to fetch') ||
    msg.includes('aborted') ||
    msg.includes('load failed') ||
    msg.includes('internet connection appears') ||
    (msg.includes('connection') && msg.includes('refused')) ||
    (msg.includes('could not connect') && msg.includes('server')) ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('the internet connection appears to be offline')
  );
}

type ApiGetOrNullResult = {
  data: unknown | null;
  status?: number;
  /** Request never reached a JSON body (offline / DNS / timeout / connection reset). */
  networkError: boolean;
};

/** GET without throwing — used to combine results and avoid parallel rate-limit bursts. */
async function apiGetOrNull(path: string): Promise<ApiGetOrNullResult> {
  try {
    const data = await api.get<unknown>(path);
    return { data, networkError: false };
  } catch (e: unknown) {
    return {
      data: null,
      status: apiErrorStatus(e),
      networkError: isLikelyNetworkFailure(e),
    };
  }
}

/**
 * Dev-only: why “My rides” shows N cards vs how many came from GET /my-rides.
 * Logs each tab-visible row with route + schedule; second line is driver-endpoint rows only.
 */
function devLogYourRidesMyTabScheduleBreakdown(
  mergedList: RideListItem[],
  publishedFromDriverEndpoint: RideListItem[],
  devCtx: YourRidesListContext,
  ownerId: string
): void {
  if (!__DEV__) return;
  const scheduleIso = (r: RideListItem): string | undefined => {
    const d = getRideScheduledAt(r);
    return d && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined;
  };
  const summarize = (r: RideListItem, role: 'driving' | 'passenger') => ({
    role,
    id: r.id,
    pickup: (r.pickupLocationName ?? r.from ?? '').trim() || undefined,
    destination: (r.destinationLocationName ?? r.to ?? '').trim() || undefined,
    rideDate: r.rideDate ?? r.scheduledDate,
    rideTime: r.rideTime ?? r.scheduledTime,
    scheduledAt: r.scheduledAt,
    scheduleIso,
    status: r.status,
    viewerIsOwner: r.viewerIsOwner,
    userId: r.userId,
  });
  const myTab = mergedList.filter((r) => matchesMyRidesTab(r, devCtx));
  console.log(
    '[YourRides] My rides tab (same filter as UI) — each card:',
    myTab.map((r) => summarize(r, isViewerRideOwner(r, ownerId) ? 'driving' : 'passenger'))
  );
  console.log(
    '[YourRides] Published driver list only (GET /my-rides or /rides/mine), after normalize:',
    publishedFromDriverEndpoint
      .filter((r) => String(r.id ?? '').trim() !== '')
      .map((r) => summarize(r, 'driving'))
  );
}

function rawRideListRowId(raw: Record<string, unknown>): string {
  return String(raw.id ?? raw._id ?? '').trim();
}

/** Dev-only: full JSON for every published ride that is still live (driver list only). */
function devLogLivePublishedRidePayloads(
  published: RideListItem[],
  publishedRaw: Record<string, unknown>[]
): void {
  if (!__DEV__) return;
  const live = published.filter(isPublishedRideLiveNow);
  const liveIds = new Set(live.map((r) => r.id));
  const liveRaw = publishedRaw.filter((row) => {
    const id = rawRideListRowId(row);
    return id !== '' && liveIds.has(id);
  });
  console.log(
    `[YourRides] LIVE published only — normalized (${live.length} rides, RideListItem shape):`,
    JSON.stringify(live, null, 2)
  );
  console.log(
    `[YourRides] LIVE published only — raw API rows from driver list (${liveRaw.length} rows):`,
    JSON.stringify(liveRaw, null, 2)
  );
}

type YourRidesNavProp = NativeStackNavigationProp<RidesStackParamList, 'YourRidesList'>;

function YourRidesRideCard({
  item,
  filter,
  currentUserId,
  currentUserName,
  viewerAvatarUrl,
  bookedRideIds,
  ratedRideIds,
  ratedTargetsByRide,
  onNavigateDetail,
  onRateRide,
  showRepublishAction,
  onRepublishPress,
}: {
  item: RideListItem;
  filter: FilterTab;
  currentUserId: string;
  currentUserName: string;
  viewerAvatarUrl?: string;
  bookedRideIds: Set<string>;
  ratedRideIds: Set<string>;
  ratedTargetsByRide: Record<string, string[]>;
  onNavigateDetail: (ride: RideListItem) => void;
  onRateRide: (ride: RideListItem) => void;
  showRepublishAction?: boolean;
  onRepublishPress?: (ride: RideListItem) => void;
}): React.JSX.Element {
  const isPassengerContext =
    (item.userId ?? '').trim() !== currentUserId && bookedRideIds.has(item.id);
  const isOwnerView = isViewerRideOwner(item, currentUserId);
  const isDrivingRideByUserId =
    currentUserId.length > 0 && (item.userId ?? '').trim() === currentUserId;
  const isDrivingPastCancelledOrCompleted =
    filter === 'pastRides' &&
    (isOwnerView || isDrivingRideByUserId) &&
    (isRideCancelledByOwner(item) || String(item.status ?? '').trim().toLowerCase() === 'completed');
  const hasMyActiveBooking =
    (item.bookings ?? []).some(
      (b) => (b.userId ?? '').trim() === currentUserId && !bookingIsCancelled(b.status)
    ) ||
    Boolean(
      item.myBookingStatus &&
        String(item.myBookingStatus).trim() &&
        !bookingIsCancelled(String(item.myBookingStatus))
    );
  const seatFullBlocked = !isOwnerView && isRideSeatsFull(item) && !hasMyActiveBooking;
  const removedByDriverInPast =
    filter === 'pastRides' && isPassengerContext && bookingIsCancelledByOwner(item.myBookingStatus);
  const cancelledByYouInPast =
    filter === 'pastRides' &&
    isPassengerContext &&
    bookingIsCancelled(item.myBookingStatus) &&
    !bookingIsCancelledByOwner(item.myBookingStatus);
  const rejectedByYouInPast =
    filter === 'pastRides' &&
    isPassengerContext &&
    String(item.myBookingStatus ?? '').trim().toLowerCase() === 'rejected';
  const myBookingStatusReasonLower = String(item.myBookingStatusReason ?? '').trim().toLowerCase();
  const rejectedDueToRideStarted = rejectedByYouInPast && myBookingStatusReasonLower === 'ride_started';
  const hideRatingForNoAcceptedTrip =
    isPassengerContext &&
    (String(item.myBookingStatus ?? '').trim().toLowerCase() === 'rejected' ||
      bookingIsPendingLike(item.myBookingStatus));
  const showCancelledBadgePast =
    filter === 'pastRides' &&
    !removedByDriverInPast &&
    (bookingIsCancelled(item.myBookingStatus) ||
      (isRideCancelledByOwner(item) && (isOwnerView || bookedRideIds.has(item.id))));
  const isCompletedByBackendStatus = String(item.status ?? '').trim().toLowerCase() === 'completed';
  const isCompletedByTimeWindow = isRideCompletedForDisplay(item);
  const showRatePromptPast =
    filter === 'pastRides' &&
    isCompletedByTimeWindow &&
    !hideRatingForNoAcceptedTrip &&
    !bookingIsCancelled(item.myBookingStatus) &&
    !isRideCancelledByOwner(item) &&
    (() => {
      if (!isOwnerView) return !ratedRideIds.has(item.id);
      const activePassengerIds = (item.bookings ?? [])
        .filter((b) => !bookingIsCancelled(b.status))
        .map((b) => (b.userId ?? '').trim())
        .filter((uid) => uid && uid !== currentUserId);
      if (activePassengerIds.length === 0) return false;
      const ratedSet = new Set(ratedTargetsByRide[item.id] ?? []);
      return activePassengerIds.some((uid) => !ratedSet.has(uid));
    })();
  const showRatedStatePast =
    filter === 'pastRides' &&
    isCompletedByTimeWindow &&
    !hideRatingForNoAcceptedTrip &&
    !bookingIsCancelled(item.myBookingStatus) &&
    !isRideCancelledByOwner(item) &&
    (() => {
      if (!isOwnerView) return ratedRideIds.has(item.id);
      const activePassengerIds = (item.bookings ?? [])
        .filter((b) => !bookingIsCancelled(b.status))
        .map((b) => (b.userId ?? '').trim())
        .filter((uid) => uid && uid !== currentUserId);
      if (activePassengerIds.length === 0) return false;
      const ratedSet = new Set(ratedTargetsByRide[item.id] ?? []);
      return activePassengerIds.every((uid) => ratedSet.has(uid));
    })();
  const pastCancelledAndRideFull = cancelledByYouInPast && isRideSeatsFull(item);
  if (showRepublishAction) {
    const from = (item.pickupLocationName ?? item.from ?? 'Pickup').trim();
    const to = (item.destinationLocationName ?? item.to ?? 'Destination').trim();
    return (
      <TouchableOpacity
        style={styles.republishOnlyCard}
        activeOpacity={0.85}
        onPress={() => onRepublishPress?.(item)}
      >
        <View style={styles.republishOnlyTop}>
          <Ionicons name="refresh-circle-outline" size={18} color={COLORS.primary} />
          <Text style={styles.republishOnlyTitle}>Republish this ride</Text>
        </View>
        <Text style={styles.republishOnlyRoute} numberOfLines={1}>
          {`${from} → ${to}`}
        </Text>
        <Text style={styles.republishOnlyHint}>
          Update details and publish as a new ride
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View>
      <RideListCard
        ride={item}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        viewerAvatarUrl={viewerAvatarUrl}
        showCancelledBadge={showCancelledBadgePast}
        showRejectedBadge={rejectedByYouInPast}
        rejectedBadgeText={rejectedDueToRideStarted ? 'Not approved' : undefined}
        showRemovedByDriverBadge={removedByDriverInPast}
        showCompletedBadge={filter === 'pastRides' && isCompletedByTimeWindow}
        seatFullUnavailable={seatFullBlocked || pastCancelledAndRideFull}
        hideSeatAvailability={filter === 'pastRides'}
        myRidesOwnerSummary={filter === 'myRides'}
        ownerUseSelfIdentity={isDrivingPastCancelledOrCompleted}
        showRatePrompt={showRatePromptPast}
        showRatedState={showRatedStatePast}
        onRatePress={() => onRateRide(item)}
        onPress={() => {
          if (seatFullBlocked || pastCancelledAndRideFull) {
            showToast({
              title: 'Ride full',
              message: 'All seats on this ride are booked.',
              variant: 'info',
            });
            return;
          }
          onNavigateDetail(item);
        }}
      />
    </View>
  );
}

function rideToRepublishEntry(ride: RideListItem): RecentPublishedEntry | null {
  const pickup = (ride.pickupLocationName ?? ride.from ?? '').trim();
  const destination = (ride.destinationLocationName ?? ride.to ?? '').trim();
  const plat = ride.pickupLatitude;
  const plon = ride.pickupLongitude;
  const dlat = ride.destinationLatitude;
  const dlon = ride.destinationLongitude;
  if (!pickup || !destination) return null;
  if ([plat, plon, dlat, dlon].some((n) => typeof n !== 'number' || Number.isNaN(n))) return null;
  const scheduled = ride.scheduledAt ? new Date(ride.scheduledAt) : null;
  const dateYmd =
    scheduled && !Number.isNaN(scheduled.getTime())
      ? `${scheduled.getFullYear()}-${String(scheduled.getMonth() + 1).padStart(2, '0')}-${String(scheduled.getDate()).padStart(2, '0')}`
      : String(ride.scheduledDate ?? ride.rideDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
  const hour =
    scheduled && !Number.isNaN(scheduled.getTime())
      ? scheduled.getHours()
      : Math.max(0, Math.min(23, parseInt(String(ride.scheduledTime ?? ride.rideTime ?? '09:00').split(':')[0] ?? '9', 10) || 9));
  const minute =
    scheduled && !Number.isNaN(scheduled.getTime())
      ? scheduled.getMinutes()
      : Math.max(0, Math.min(59, parseInt(String(ride.scheduledTime ?? ride.rideTime ?? '09:00').split(':')[1] ?? '0', 10) || 0));
  const seats = Math.max(1, Math.min(6, Math.floor(Number(ride.seats) || 1)));
  const bookingModeRaw = String((ride as RideListItem & { bookingMode?: string; booking_mode?: string; instantBooking?: boolean }).bookingMode ?? '').trim().toLowerCase();
  const instantBooking = bookingModeRaw ? bookingModeRaw === 'instant' : Boolean((ride as RideListItem & { instantBooking?: boolean }).instantBooking ?? true);
  return {
    id: `republish-${ride.id}`,
    pickup,
    destination,
    pickupLatitude: plat as number,
    pickupLongitude: plon as number,
    destinationLatitude: dlat as number,
    destinationLongitude: dlon as number,
    dateYmd,
    hour,
    minute,
    seats,
    rate: String(ride.price ?? '').trim(),
    rideDescription: String(ride.description ?? '').trim(),
    description: String(ride.description ?? '').trim(),
    instantBooking,
  };
}

export default function YourRides(): React.JSX.Element {
  const navigation = useNavigation<YourRidesNavProp>();
  const route = useRoute<RouteProp<RidesStackParamList, 'YourRidesList'>>();
  const insets = useSafeAreaInsets();
  const listContentBottomPad = useMainTabScrollBottomInset();
  const { user } = useAuth();
  const { syncFromRideList } = useOwnerPendingRequests();
  const currentUserId = (user?.id ?? '').trim();
  const currentUserName = (user?.name ?? '').trim();
  const viewerAvatarUrl = user?.avatarUrl?.trim();
  const [rides, setRides] = useState<RideListItem[]>([]);
  const [bookedRideIds, setBookedRideIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterTab>('myRides');
  const ridesRef = useRef(rides);
  ridesRef.current = rides;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Empty list because requests failed at the network layer (not “you have no trips”). */
  const [offlineEmpty, setOfflineEmpty] = useState(false);
  /** `null` until first NetInfo read — avoids treating “unknown” as offline. */
  const [netConnected, setNetConnected] = useState<boolean | null>(null);
  /** List was restored from AsyncStorage while offline. */
  const [showingStaleFromCache, setShowingStaleFromCache] = useState(false);
  /** Softer copy + animation right after booking navigates here. */
  const [justBookedWelcome, setJustBookedWelcome] = useState(false);
  /** Soft / focus refetch: keep filters + list chrome; show spinner in list area instead of empty state. */
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [blockingRefreshLoading, setBlockingRefreshLoading] = useState(false);
  const [blockingExpectedRemovedRideId, setBlockingExpectedRemovedRideId] = useState('');
  const blockingRefreshStartedAtRef = useRef(0);
  /** Last accurate “All rides” count (browse merged). Live count drops on my/past-only refetches without catalog. */
  const [cachedAllRidesCount, setCachedAllRidesCount] = useState(0);
  const [ratingRide, setRatingRide] = useState<RideListItem | null>(null);
  const [showRatingSheet, setShowRatingSheet] = useState(false);
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingReview, setRatingReview] = useState('');
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const ratingBehaviorCheckpoints = ['Safe driving', 'Punctual', 'Polite', 'Clean vehicle'];
  const ratingExperienceCheckpoints = useMemo(() => {
    if (ratingStars >= 5) return ['Outstanding', 'Excellent ride', 'Highly recommended'];
    if (ratingStars === 4) return ['Good driving experience', 'Comfortable ride', 'Smooth route'];
    if (ratingStars === 3) return ['Average experience', 'Can improve timing', 'Okay overall'];
    if (ratingStars === 2) return ['Needs improvement', 'Driving can be smoother', 'Better communication needed'];
    if (ratingStars === 1) return ['Poor experience', 'Very late', 'Unsafe behavior'];
    return [];
  }, [ratingStars]);
  const addRatingCheckpoint = useCallback(
    (label: string) => {
      if (ratingSubmitting) return;
      const nextLabel = label.trim();
      if (!nextLabel) return;
      const tokens = ratingReview
        .split('•')
        .map((t) => t.trim())
        .filter(Boolean);
      if (tokens.some((t) => t.toLowerCase() === nextLabel.toLowerCase())) return;
      const next = [...tokens, nextLabel].join(' • ');
      setRatingReview(next);
    },
    [ratingReview, ratingSubmitting]
  );
  const [selectedRateTargetUserId, setSelectedRateTargetUserId] = useState('');
  const [selectedRateTargetName, setSelectedRateTargetName] = useState('');
  const [ratedTargetsByRide, setRatedTargetsByRide] = useState<Record<string, string[]>>({});
  const [ratingKeyboardVisible, setRatingKeyboardVisible] = useState(false);
  const ratingKeyboardOffset = useRef(new Animated.Value(0)).current;
  const [ratedRideIds, setRatedRideIds] = useState<Set<string>>(new Set());
  const ratingCheckInFlightRef = useRef<Set<string>>(new Set());

  // Block "navigate back" while the initial loader is visible.
  // Prevents accidental stack pops if the user taps back during refresh/loading.
  const isInitialLoaderVisible = loading && rides.length === 0;
  useEffect(() => {
    if (!isInitialLoaderVisible) return;

    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      e.preventDefault();
    });

    const backSub = BackHandler.addEventListener('hardwareBackPress', () => true);

    return () => {
      unsubscribe();
      backSub.remove();
    };
  }, [isInitialLoaderVisible, navigation]);

  useEffect(() => {
    setCachedAllRidesCount(0);
  }, [currentUserId]);

  useEffect(() => {
    syncFromRideList(rides, currentUserId);
  }, [rides, currentUserId, syncFromRideList]);

  /** Detail screen GET is authoritative after approve/reject — merge before list refetch catches up. */
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      RIDE_LIST_MERGE_FROM_DETAIL,
      (payload: RideListMergeFromDetailPayload) => {
        const detail = payload?.ride;
        if (!detail?.id) return;
        setRides((prev) => {
          const idx = prev.findIndex((r) => r.id === detail.id);
          if (idx >= 0) {
            return prev.map((r) => (r.id === detail.id ? mergeRideListRowWithDetailSnapshot(r, detail) : r));
          }
          if (payload.insertIfMissing) {
            const row: RideListItem = {
              ...detail,
              viewerIsOwner: detail.viewerIsOwner === false ? false : true,
            };
            return [row, ...prev];
          }
          return prev;
        });
      }
    );
    return () => sub.remove();
  }, []);

  /** Restore “already rated” from device so past rides don’t prompt again after app reload (GET /ratings/check still confirms). */
  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;
    void (async () => {
      const cache = await loadRatedRidesCache(currentUserId);
      if (cancelled) return;
      setRatedRideIds((prev) => {
        const next = new Set(prev);
        for (const rid of cache.passengerRideIds) {
          if (rid.trim()) next.add(rid.trim());
        }
        return next;
      });
      setRatedTargetsByRide((prev) => {
        const out: Record<string, string[]> = { ...prev };
        for (const [rid, uids] of Object.entries(cache.ownerByRide)) {
          const cur = out[rid] ?? [];
          out[rid] = [...new Set([...cur, ...(Array.isArray(uids) ? uids : [])])];
        }
        return out;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId || filter !== 'pastRides') return;
    const candidates = rides.filter((r) => {
      const completed = String(r.status ?? '').trim().toLowerCase() === 'completed';
      return completed && !bookingIsCancelled(r.myBookingStatus) && !isRideCancelledByOwner(r);
    });
    if (candidates.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const ride of candidates) {
        if (cancelled) break;
        const isOwner = isViewerRideOwner(ride, currentUserId);

        if (isOwner) {
          const activePassengerIds = (ride.bookings ?? [])
            .filter((b) => !bookingIsCancelled(b.status))
            .map((b) => (b.userId ?? '').trim())
            .filter((uid) => uid && uid !== currentUserId);
          for (const uid of activePassengerIds) {
            if (cancelled) break;
            if ((ratedTargetsByRide[ride.id] ?? []).includes(uid)) continue;
            const inflightKey = `owner:${ride.id}:${uid}`;
            if (ratingCheckInFlightRef.current.has(inflightKey)) continue;
            ratingCheckInFlightRef.current.add(inflightKey);
            try {
              const rated = await hasCurrentUserRatedRide(ride.id, currentUserId, uid);
              if (cancelled) break;
              if (rated) {
                setRatedTargetsByRide((prev) => {
                  const existing = prev[ride.id] ?? [];
                  if (existing.includes(uid)) return prev;
                  return { ...prev, [ride.id]: [...existing, uid] };
                });
                void mergeOwnerRatedPassenger(currentUserId, ride.id, uid);
              }
            } catch {
              // ignore
            } finally {
              ratingCheckInFlightRef.current.delete(inflightKey);
            }
            await rideListStagger();
          }
          continue;
        }

        if (ratedRideIds.has(ride.id)) continue;
        const inflightKey = `passenger:${ride.id}`;
        if (ratingCheckInFlightRef.current.has(inflightKey)) continue;
        ratingCheckInFlightRef.current.add(inflightKey);
        try {
          const driverId = (ride.userId ?? '').trim() || undefined;
          const rated = await hasCurrentUserRatedRide(ride.id, currentUserId, driverId);
          if (cancelled) break;
          if (rated) {
            setRatedRideIds((prev) => {
              const next = new Set(prev);
              next.add(ride.id);
              return next;
            });
            void mergePassengerRatedRide(currentUserId, ride.id);
          }
        } catch {
          // ignore pre-check failures; submit path remains backend-protected
        } finally {
          ratingCheckInFlightRef.current.delete(inflightKey);
        }
        await rideListStagger();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rides, filter, currentUserId, ratedRideIds, ratedTargetsByRide]);

  useEffect(() => {
    const onShow = (e: { endCoordinates?: { height?: number } }) => {
      setRatingKeyboardVisible(true);
      const h = Math.max(0, e?.endCoordinates?.height ?? 0);
      Animated.timing(ratingKeyboardOffset, {
        toValue: h,
        duration: 220,
        useNativeDriver: true,
      }).start();
    };
    const onHide = () => {
      setRatingKeyboardVisible(false);
      Animated.timing(ratingKeyboardOffset, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    };
    const showSub = Keyboard.addListener('keyboardDidShow', onShow);
    const hideSub = Keyboard.addListener('keyboardDidHide', onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [ratingKeyboardOffset]);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      setNetConnected(online);
      if (online) {
        setShowingStaleFromCache(false);
      }
    });
    void NetInfo.fetch().then((s) => {
      const online = s.isConnected === true && s.isInternetReachable !== false;
      setNetConnected(online);
    });
    return () => unsub();
  }, []);

  const fetchRides = useCallback(async (softRefresh = false) => {
    setError(null);

    const netState = await NetInfo.fetch();
    const online = netState.isConnected === true && netState.isInternetReachable !== false;
    setNetConnected(online);

    if (!online && softRefresh && ridesRef.current.length > 0) {
      setBackgroundRefreshing(false);
      setLoading(false);
      setJustBookedWelcome(false);
      return;
    }

    if (!online && !softRefresh && ridesRef.current.length > 0) {
      setLoading(false);
      setBackgroundRefreshing(false);
      setJustBookedWelcome(false);
      return;
    }

    const ownerId = currentUserId.trim();

    if (!online && ridesRef.current.length === 0) {
      if (ownerId) {
        const cached = await loadYourRidesListCache(ownerId);
        if (cached && cached.rides.length > 0) {
          setRides(cached.rides);
          setBookedRideIds(new Set(cached.bookedIds));
          setCachedAllRidesCount(cached.allRidesCount);
          setOfflineEmpty(false);
          setError(null);
          setShowingStaleFromCache(true);
          setLoading(false);
          setBackgroundRefreshing(false);
          setJustBookedWelcome(false);
          return;
        }
      }
      setOfflineEmpty(true);
      setError(null);
      setLoading(false);
      setBackgroundRefreshing(false);
      setJustBookedWelcome(false);
      return;
    }

    setOfflineEmpty(false);

    if (softRefresh) {
      setBackgroundRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      let saw429 = false;

      /**
       * GET /my-rides + GET /rides (catalog) in parallel — catalog used to run only after two round-trips
       * and two staggers, so “All rides” felt like it hung. Booked stays staggered after to limit 429 bursts.
       */
      const [myPublishedRes, browseListResult] = await Promise.all([
        apiGetOrNull(API.endpoints.rides.myPublished),
        apiGetOrNull(API.endpoints.rides.list),
      ]);
      if (myPublishedRes.status === 429) saw429 = true;
      if (browseListResult.status === 429) saw429 = true;

      /** Driver’s published rides only — never treat full GET /rides as “published” (would mark everyone as owner). */
      let publishedRaw: Record<string, unknown>[] = [];
      if (myPublishedRes.data != null) {
        publishedRaw = extractRideListFromResponse(myPublishedRes.data);
        if (__DEV__) {
          console.log('========== GET /my-rides – API response ==========');
          console.log(JSON.stringify(myPublishedRes.data, null, 2));
          console.log('================================================');
        }
      } else if (__DEV__) {
        console.log('========== GET /my-rides failed — driver list empty; catalog still from GET /rides ==========');
      }

      /** Legacy backends: driver list only on GET /rides/mine when /my-rides errors out. */
      let mineResMeta: ApiGetOrNullResult = { data: null, networkError: false };
      if (publishedRaw.length === 0 && myPublishedRes.data == null) {
        mineResMeta = await apiGetOrNull(API.endpoints.rides.mine);
        if (mineResMeta.data != null) {
          publishedRaw = extractRideListFromResponse(mineResMeta.data);
        }
      }

      let browseRaw: Record<string, unknown>[] = [];
      if (browseListResult.data != null) {
        browseRaw = extractRideListFromResponse(browseListResult.data);
        if (__DEV__) {
          console.log('========== GET /rides (browse catalog) – API response ==========');
          console.log(JSON.stringify(browseListResult.data, null, 2));
          console.log('================================================');
        }
      } else if (browseListResult.status !== 429) {
        /** Don’t retry immediately after 429 — same bucket, makes things worse. */
        try {
          await rideListStagger();
          const ridesRes = await api.get<RidesResponse>(API.endpoints.rides.list);
          browseRaw = extractRideListFromResponse(ridesRes);
          if (__DEV__) {
            console.log('========== GET /rides (browse retry) – API response ==========');
            console.log(JSON.stringify(ridesRes, null, 2));
            console.log('================================================');
          }
        } catch {
          /* ignore */
        }
      }

      await rideListStagger();
      const [bookedResult, bookingsWrap] = await Promise.all([
        apiGetOrNull(API.endpoints.rides.booked),
        apiGetOrNull(API.endpoints.bookings.list),
      ]);
      if (bookedResult.status === 429) saw429 = true;
      let bookedRaw: Record<string, unknown>[] = [];
      if (bookedResult.data != null) {
        bookedRaw = extractRideListFromResponse(bookedResult.data);
        if (__DEV__) {
          console.log('========== GET /rides/booked – API response ==========');
          console.log(JSON.stringify(bookedResult.data, null, 2));
          console.log('================================================');
        }
      }

      const published = publishedRaw.map(normalizeRideItem);
      const bookedPassenger = bookedRaw.map(normalizeRideItem);
      const browseCatalog = browseRaw.map(normalizeRideItem);
      let list = mergePublishedAndBookedRideLists(published, bookedPassenger);
      list = mergeBrowseCatalogIntoList(list, browseCatalog);

      let bookedIds = new Set<string>();
      const myBookingStatusByRideId = new Map<string, string>();
      let bookingsPayloadRowCount = 0;
      if (bookingsWrap.status === 429) saw429 = true;
      try {
        if (bookingsWrap.data == null) {
          bookedIds = new Set();
        } else {
          const arr = extractBookingsListArray(bookingsWrap.data);
          bookingsPayloadRowCount = arr.length;
          bookedIds = new Set<string>();
        /** Same ride may appear twice after re-book (cancelled + active) — prefer active status. */
        const myStatusesPerRide = new Map<string, string[]>();
        arr.forEach((raw) => {
          const rideId = rideIdFromBookingListRow(raw);
          if (rideId) bookedIds.add(rideId);
          const row = mapRawToBookingRow(raw);
          if (!row || !rideId || !ownerId) return;
          if ((row.userId ?? '').trim() === ownerId) {
            const acc = myStatusesPerRide.get(rideId) ?? [];
            acc.push(row.status ?? '');
            myStatusesPerRide.set(rideId, acc);
          }
        });
        myStatusesPerRide.forEach((statuses, rideId) => {
          myBookingStatusByRideId.set(rideId, pickPreferredBookingStatus(statuses));
        });
        const byRide = groupBookingListByRideId(arr);
        list = mergeBookingsMapOntoRides(list, byRide);
        list = list.map((r) => {
          const st = myBookingStatusByRideId.get(r.id);
          if (st !== undefined) return { ...r, myBookingStatus: st };
          return r;
        });
        // Passenger rides dropped from GET /rides (e.g. owner cancelled) — still in GET /bookings.
        list = appendMissingRidesFromEmbeddedBookings(list, arr, byRide, myBookingStatusByRideId);
        const idsKnown = new Set(list.map((r) => r.id));
        const missingRideIds = [...byRide.keys()].filter((id) => !idsKnown.has(id));
        if (missingRideIds.length > 0 && ownerId) {
          const fetched = await Promise.all(
            missingRideIds.map(async (rideId) => {
              try {
                const res = await fetchRideDetailRaw(rideId, {
                  force: true,
                  viewerUserId: ownerId,
                });
                const item = rideListItemFromDetailApiPayload(res);
                if (!item) return null;
                const rows = byRide.get(rideId) ?? [];
                const st = myBookingStatusByRideId.get(rideId);
                return {
                  ...item,
                  id: rideId,
                  bookings: rows,
                  ...(st !== undefined ? { myBookingStatus: st } : {}),
                  viewerIsOwner: false,
                } as RideListItem;
              } catch {
                return null;
              }
            })
          );
          list = [...list, ...fetched.filter((x): x is RideListItem => x != null)];
        }
        }
      } catch {
        bookedIds = new Set();
      }

      /** GET /rides/booked — always treat these ride ids as passenger-side “mine” for filters. */
      bookedPassenger.forEach((r) => {
        if (r.id) bookedIds.add(r.id);
      });

      // List responses often omit bookings; load passengers for your published rides (same as ride detail).
      if (ownerId) {
        const ownedMissing = list.filter(
          (r) => (r.userId ?? '').trim() === ownerId && (!r.bookings || r.bookings.length === 0)
        );
        if (ownedMissing.length > 0) {
          const detailResults = await Promise.all(
            ownedMissing.map(async (r) => {
              try {
                const res = (await fetchRideDetailRaw(r.id, {
                  viewerUserId: ownerId,
                })) as RideListItem & {
                  bookings?: unknown[];
                };
                const rawBk =
                  res && typeof res === 'object'
                    ? (res as RideListItem).bookings
                    : undefined;
                const bookings = normalizeBookingsFromDetailResponse(rawBk);
                return { id: r.id, bookings };
              } catch {
                return { id: r.id, bookings: [] as NonNullable<RideListItem['bookings']> };
              }
            })
          );
          const detailMap = new Map(detailResults.map((x) => [x.id, x.bookings]));
          list = list.map((r) => {
            const b = detailMap.get(r.id);
            if (b && b.length > 0) return { ...r, bookings: b };
            return r;
          });
        }
      }

      // If ride.bookings has several rows for this user (cancel + rebook), prefer active over cancelled.
      if (ownerId) {
        list = list.map((r) => {
          const mine = (r.bookings ?? []).filter((b) => (b.userId ?? '').trim() === ownerId);
          if (mine.length === 0) return r;
          const fromBookings = pickPreferredBookingStatus(mine.map((b) => b.status ?? ''));
          const prev = r.myBookingStatus;
          if (prev === undefined || prev === '') return { ...r, myBookingStatus: fromBookings };
          return { ...r, myBookingStatus: pickPreferredBookingStatus([prev, fromBookings]) };
        });
      }

      // Owner-cancelled rides: many APIs omit them from GET /rides — merge local snapshots.
      if (ownerId) {
        try {
          const localRaw = await loadOwnerCancelledRides(ownerId);
          for (const raw of localRaw) {
            const local = normalizeRideItem(raw as Record<string, unknown>);
            const idx = list.findIndex((x) => x.id === local.id);
            if (idx >= 0) {
              const cur = list[idx];
              if (isRideCancelledByOwner(local) && !isRideCancelledByOwner(cur)) {
                list[idx] = { ...cur, status: 'cancelled' };
              }
            } else {
              list.push(local);
            }
          }
        } catch {
          /* ignore */
        }
      }

      const networkHitCount = [
        myPublishedRes.networkError,
        browseListResult.networkError,
        bookedResult.networkError,
        bookingsWrap.networkError,
        mineResMeta.networkError,
      ].filter(Boolean).length;

      if (list.length === 0 && saw429) {
        setError(
          'Too many requests (429): your backend is rate-limiting. Wait 30–60 seconds, pull to refresh, or raise limits for development.'
        );
        setOfflineEmpty(false);
      } else {
        setError(null);
        /** Don’t replace a populated list with an empty merge on pull-to-refresh while offline. */
        setOfflineEmpty(!softRefresh && list.length === 0 && networkHitCount >= 1);
      }

      /** Keep passenger ride ids for filters when owner cancels but list still has booking/status merge. */
      if (ownerId) {
        for (const r of list) {
          if (passengerHasBookingRowOnRide(r, ownerId)) bookedIds.add(r.id);
          const st = r.myBookingStatus;
          if (
            st != null &&
            String(st).trim() !== '' &&
            !isViewerRideOwner(r, ownerId)
          ) {
            bookedIds.add(r.id);
          }
        }
      }

      const preserveListOnSoftNetworkEmpty =
        softRefresh && list.length === 0 && networkHitCount >= 1 && ridesRef.current.length > 0;

      if (!preserveListOnSoftNetworkEmpty) {
        setCachedAllRidesCount(list.filter(matchesAllRidesTab).length);
        if (__DEV__) {
          const devCtx: YourRidesListContext = { userId: ownerId, bookedRideIds: bookedIds };
          const mergedWithId = list.filter((r) => (r.id ?? '').trim() !== '').length;
          console.log('[YourRides] ride payload / display counts', {
            payloadRowsFromMyRidesOrMine: publishedRaw.length,
            payloadRowsFromRidesBooked: bookedRaw.length,
            payloadRowsFromRidesBrowse: browseRaw.length,
            payloadRowsFromBookingsList: bookingsPayloadRowCount,
            normalizedDriverRides: published.filter((r) => (r.id ?? '').trim() !== '').length,
            normalizedBookedRides: bookedPassenger.filter((r) => (r.id ?? '').trim() !== '').length,
            normalizedBrowseRides: browseCatalog.filter((r) => (r.id ?? '').trim() !== '').length,
            mergedUniqueRidesInList: list.length,
            mergedRidesWithNonEmptyId: mergedWithId,
            cardsShownMyRidesTab: countForTab(list, 'myRides', devCtx),
            cardsShownAllRidesTab: countForTab(list, 'allRides', devCtx),
            cardsShownPastRidesTab: countForTab(list, 'pastRides', devCtx),
          });
          devLogYourRidesMyTabScheduleBreakdown(list, published, devCtx, ownerId);
          devLogLivePublishedRidePayloads(published, publishedRaw);
        }
        setRides(list);
        setBookedRideIds(bookedIds);
        setShowingStaleFromCache(false);
        if (ownerId && list.length > 0) {
          void saveYourRidesListCache(ownerId, {
            rides: list,
            bookedIds: [...bookedIds],
            allRidesCount: list.filter(matchesAllRidesTab).length,
            savedAt: Date.now(),
          });
        }
      }
    } catch (e: unknown) {
      let message = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : 'Failed to load rides.';
      if (message === 'Network request failed' || message === 'Aborted' || message.includes('timed out')) {
        message = OFFLINE_USER_MESSAGE;
      }
      const networkish =
        isLikelyNetworkFailure(e) ||
        message.toLowerCase().includes('could not reach the server') ||
        message.toLowerCase().includes('check your connection');
      if (!softRefresh) {
        if (networkish) {
          setOfflineEmpty(ridesRef.current.length === 0);
          setError(null);
        } else {
          setOfflineEmpty(false);
          setError(message);
        }
        const keepExistingList = ridesRef.current.length > 0 && networkish;
        if (!keepExistingList) {
          setRides([]);
          setBookedRideIds(new Set());
        }
      } else if (!networkish) {
        setError(message);
      }
    } finally {
      setLoading(false);
      setBackgroundRefreshing(false);
      setJustBookedWelcome(false);
    }
  }, [currentUserId]);

  /** Login/sign-up/session restore and app foreground — reload merged list (My rides driver + booked data). */
  const myRidesExternalRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!currentUserId) return;
    const sub = DeviceEventEmitter.addListener(
      REQUEST_MY_RIDES_LIST_REFRESH,
      (payload?: MyRidesRefreshRequestPayload) => {
      const requestedBlocking = payload?.blocking === true;
      const expectedId = String(payload?.expectedRemovedRideId ?? '').trim();
      if (requestedBlocking) {
        blockingRefreshStartedAtRef.current = Date.now();
        setBlockingExpectedRemovedRideId(expectedId);
        setBlockingRefreshLoading(true);
        setFilter('myRides');
      }
      if (myRidesExternalRefreshTimerRef.current) {
        clearTimeout(myRidesExternalRefreshTimerRef.current);
      }
      myRidesExternalRefreshTimerRef.current = setTimeout(() => {
        myRidesExternalRefreshTimerRef.current = null;
        void fetchRides(!requestedBlocking && ridesRef.current.length > 0);
      }, 150);
      }
    );
    return () => {
      sub.remove();
      if (myRidesExternalRefreshTimerRef.current) {
        clearTimeout(myRidesExternalRefreshTimerRef.current);
      }
    };
  }, [currentUserId, fetchRides]);

  useEffect(() => {
    if (!blockingRefreshLoading) return;
    if (loading) return;
    const expectedId = blockingExpectedRemovedRideId.trim();
    const target = expectedId ? rides.find((r) => (r.id ?? '').trim() === expectedId) : undefined;
    const staleStillVisible = Boolean(
      target &&
        !isRideCancelledByOwner(target) &&
        !bookingIsCancelled(target.myBookingStatus) &&
        String(target.status ?? '').trim().toLowerCase() !== 'cancelled'
    );
    const elapsed = Date.now() - blockingRefreshStartedAtRef.current;
    // Keep loader until stale row is no longer active in My Rides; fallback timeout avoids hangs.
    if (!staleStillVisible || elapsed > 12000) {
      setBlockingRefreshLoading(false);
      setBlockingExpectedRemovedRideId('');
    }
  }, [blockingRefreshLoading, blockingExpectedRemovedRideId, loading, rides]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const run = async () => {
        const afterBook = route.params?._afterBookRefresh;
        if (afterBook != null) {
          setJustBookedWelcome(true);
          setFilter('myRides');
          navigation.setParams({ _afterBookRefresh: undefined });
          setRides([]);
          setBookedRideIds(new Set());
          setCachedAllRidesCount(0);
          setError(null);
          setShowingStaleFromCache(false);
          setLoading(true);
          await fetchRides(false);
          return;
        }
        const net = await NetInfo.fetch();
        if (cancelled) return;
        const online = net.isConnected === true && net.isInternetReachable !== false;
        setNetConnected(online);
        if (!online && currentUserId.trim()) {
          const cached = await loadYourRidesListCache(currentUserId.trim());
          if (cancelled) return;
          if (cached && cached.rides.length > 0) {
            setRides(cached.rides);
            setBookedRideIds(new Set(cached.bookedIds));
            setCachedAllRidesCount(cached.allRidesCount);
            setOfflineEmpty(false);
            setError(null);
            setShowingStaleFromCache(true);
            setLoading(false);
            void fetchRides(true);
            return;
          }
          void fetchRides(false);
          return;
        }
        void fetchRides(ridesRef.current.length > 0);
      };
      void run();
      return () => {
        cancelled = true;
      };
    }, [fetchRides, navigation, route.params, currentUserId])
  );

  const goRideDetail = useCallback(
    (ride: RideListItem) => {
      (
        navigation as unknown as {
          push: (name: 'RideDetail', params: { ride: RideListItem }) => void;
        }
      ).push('RideDetail', { ride });
    },
    [navigation]
  );

  const republishFromPastRide = useCallback(
    (ride: RideListItem) => {
      const entry = rideToRepublishEntry(ride);
      if (!entry) {
        showToast({
          title: 'Cannot republish',
          message: 'Ride data is incomplete. Open ride detail and try again.',
          variant: 'info',
        });
        return;
      }
      const mainTabs = findMainTabNavigatorWithOptions(navigation as { getParent?: () => unknown });
      (mainTabs as { navigate?: (name: string, params?: object) => void } | null)?.navigate?.(
        'PublishStack',
        {
          screen: 'PublishRecentEdit',
          params: { entry },
        }
      );
    },
    [navigation]
  );

  const closeRatingSheet = useCallback(() => {
    Keyboard.dismiss();
    setShowRatingSheet(false);
    setRatingStars(0);
    setRatingReview('');
    setRatingSubmitting(false);
    setSelectedRateTargetUserId('');
    setSelectedRateTargetName('');
    setRatingRide(null);
    setRatingKeyboardVisible(false);
    ratingKeyboardOffset.setValue(0);
  }, [ratingKeyboardOffset]);

  const handleSkipRating = useCallback(async () => {
    if (currentUserId && ratingRide?.id) {
      await markRatingPromptHandled(currentUserId, ratingRide.id);
    }
    closeRatingSheet();
  }, [closeRatingSheet, currentUserId, ratingRide?.id]);

  const openRateSheet = useCallback(
    async (ride: RideListItem) => {
      if (!currentUserId) return;
      if (String(ride.status ?? '').trim().toLowerCase() !== 'completed') {
        showToast({
          title: 'Rating unavailable',
          message: 'Ratings are available only after the ride is marked completed.',
          variant: 'info',
        });
        return;
      }
      const isOwner = isViewerRideOwner(ride, currentUserId);
      const activePassengers = (ride.bookings ?? []).filter(
        (b) => !bookingIsCancelled(b.status) && (b.userId ?? '').trim() && (b.userId ?? '').trim() !== currentUserId
      );
      const rideOwnerId = (ride.userId ?? '').trim();
      if (!isOwner && rideOwnerId) {
        try {
          const alreadyRated = await hasCurrentUserRatedRide(ride.id, currentUserId, rideOwnerId);
          if (alreadyRated) {
            setRatedRideIds((prev) => {
              const next = new Set(prev);
              next.add(ride.id);
              return next;
            });
            void mergePassengerRatedRide(currentUserId, ride.id);
            showToast({
              title: 'Already rated',
              message: 'You have already rated this ride.',
              variant: 'info',
            });
            return;
          }
        } catch {
          // Non-blocking fallback: allow opening; backend duplicate guard still protects POST.
        }
      }

      if (isOwner && activePassengers.length > 0) {
        // Do not block opening with pre-check calls for owner flow.
        // Some backends may return broad "rated" results, which can falsely mark all passengers as rated.
        // Duplicate submissions are still guarded by backend (409) in submit handler.
        const ratedForRide = new Set(ratedTargetsByRide[ride.id] ?? []);
        if (ratedForRide.size >= activePassengers.length) {
          showToast({
            title: 'Already rated',
            message: 'You have already rated all passengers for this ride.',
            variant: 'info',
          });
          return;
        }
      }

      setRatingRide(ride);
      if (isOwner && activePassengers.length === 1) {
        const p = activePassengers[0];
        setSelectedRateTargetUserId((p.userId ?? '').trim());
        setSelectedRateTargetName((p.name ?? p.userName ?? 'Passenger').trim() || 'Passenger');
      } else {
        setSelectedRateTargetUserId('');
        setSelectedRateTargetName('');
      }
      setShowRatingSheet(true);
    },
    [currentUserId, ratedTargetsByRide]
  );

  const handleSubmitRating = useCallback(async () => {
    if (!ratingRide || !currentUserId) return;
    if (ratingSubmitting) return;
    if (ratingStars < 1 || ratingStars > 5) {
      Alert.alert('Select rating', 'Please select 1 to 5 stars.');
      return;
    }

    const rideOwnerId = (ratingRide.userId ?? '').trim();
    const isOwner = isViewerRideOwner(ratingRide, currentUserId);
    const activePassenger = (ratingRide.bookings ?? []).find(
      (b) => !bookingIsCancelled(b.status) && (b.userId ?? '').trim() && (b.userId ?? '').trim() !== currentUserId
    );
    const ownerCandidatesCount = isOwner
      ? (ratingRide.bookings ?? []).filter(
          (b) =>
            !bookingIsCancelled(b.status) &&
            (b.userId ?? '').trim() &&
            (b.userId ?? '').trim() !== currentUserId
        ).length
      : 0;
    const toUserId = isOwner
      ? (selectedRateTargetUserId || (activePassenger?.userId ?? '').trim())
      : rideOwnerId;
    if (!toUserId) {
      Alert.alert(
        'Select passenger',
        'Please select a passenger to rate for this completed ride.'
      );
      return;
    }

    // Targeted duplicate guard for owner flow:
    // check only the selected passenger to avoid backend 409/noisy network warnings.
    if (isOwner && toUserId) {
      try {
        const alreadyRatedSelected = await hasCurrentUserRatedRide(ratingRide.id, currentUserId, toUserId);
        if (alreadyRatedSelected) {
          setRatedTargetsByRide((prev) => {
            const existing = prev[ratingRide.id] ?? [];
            if (existing.includes(toUserId)) return prev;
            return { ...prev, [ratingRide.id]: [...existing, toUserId] };
          });
          const existingRated = new Set(ratedTargetsByRide[ratingRide.id] ?? []);
          existingRated.add(toUserId);
          if (existingRated.size >= ownerCandidatesCount) {
            closeRatingSheet();
            showToast({
              title: 'Already rated',
              message: 'All passengers for this ride are rated.',
              variant: 'info',
            });
            return;
          }
          showToast({
            title: 'Already rated',
            message: selectedRateTargetName
              ? `${selectedRateTargetName} is already rated for this ride.`
              : 'This passenger is already rated for this ride.',
            variant: 'info',
          });
          if (ownerCandidatesCount > 1) {
            setSelectedRateTargetUserId('');
            setSelectedRateTargetName('');
          } else {
            closeRatingSheet();
          }
          return;
        }
      } catch {
        // Non-blocking: continue and let submit endpoint enforce dedupe.
      }
    }

    setRatingSubmitting(true);
    try {
      await submitRideRating({
        rideId: ratingRide.id,
        toUserId,
        rating: ratingStars,
        review: ratingReview.trim() || undefined,
      });
      if (isOwner && toUserId) {
        setRatedTargetsByRide((prev) => {
          const existing = prev[ratingRide.id] ?? [];
          if (existing.includes(toUserId)) return prev;
          return { ...prev, [ratingRide.id]: [...existing, toUserId] };
        });
      }
      setRatedRideIds((prev) => {
        const next = new Set(prev);
        if (!isOwner) next.add(ratingRide.id);
        return next;
      });
      if (!isOwner) {
        void mergePassengerRatedRide(currentUserId, ratingRide.id);
      } else if (toUserId) {
        void mergeOwnerRatedPassenger(currentUserId, ratingRide.id, toUserId);
      }
      await markRatingPromptHandled(currentUserId, ratingRide.id);
      if (isOwner && ownerCandidatesCount > 1) {
        const existingRated = new Set(ratedTargetsByRide[ratingRide.id] ?? []);
        existingRated.add(toUserId);
        if (existingRated.size >= ownerCandidatesCount) {
          closeRatingSheet();
          showToast({
            title: 'Thanks for your feedback',
            message: 'All passengers for this ride are rated.',
            variant: 'success',
          });
          return;
        }
        setRatingStars(0);
        setRatingReview('');
        setSelectedRateTargetUserId('');
        setSelectedRateTargetName('');
        showToast({
          title: 'Thanks for your feedback',
          message: 'You can rate other passengers too.',
          variant: 'success',
        });
      } else {
        closeRatingSheet();
        showToast({
          title: 'Thanks for your feedback',
          message: '',
          variant: 'success',
        });
      }
    } catch (e: unknown) {
      const statusCode = apiErrorStatus(e);
      const message =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : 'Could not submit rating right now.';
      if (statusCode === 409) {
        if (isOwner && toUserId) {
          setRatedTargetsByRide((prev) => {
            const existing = prev[ratingRide.id] ?? [];
            if (existing.includes(toUserId)) return prev;
            return { ...prev, [ratingRide.id]: [...existing, toUserId] };
          });
          void mergeOwnerRatedPassenger(currentUserId, ratingRide.id, toUserId);
          const existingRated = new Set(ratedTargetsByRide[ratingRide.id] ?? []);
          existingRated.add(toUserId);
          if (existingRated.size >= ownerCandidatesCount) {
            closeRatingSheet();
            showToast({
              title: 'Already rated',
              message: 'All passengers for this ride are rated.',
              variant: 'info',
            });
            return;
          }
          setRatingStars(0);
          setRatingReview('');
          setSelectedRateTargetUserId('');
          setSelectedRateTargetName('');
        } else {
          setRatedRideIds((prev) => {
            const next = new Set(prev);
            next.add(ratingRide.id);
            return next;
          });
          void mergePassengerRatedRide(currentUserId, ratingRide.id);
          closeRatingSheet();
        }
        showToast({ title: 'Already rated', message, variant: 'info' });
        return;
      }
      Alert.alert('Error', message);
    } finally {
      setRatingSubmitting(false);
    }
  }, [
    ratingRide,
    currentUserId,
    ratingSubmitting,
    ratingStars,
    ratingReview,
    closeRatingSheet,
    ratedTargetsByRide,
  ]);

  const handleRatingModalRequestClose = useCallback(() => {
    if (ratingKeyboardVisible) {
      Keyboard.dismiss();
      return;
    }
    void handleSkipRating();
  }, [ratingKeyboardVisible, handleSkipRating]);

  const ownerRateCandidates = useMemo(() => {
    if (!ratingRide || !currentUserId) return [];
    if (!isViewerRideOwner(ratingRide, currentUserId)) return [];
    return (ratingRide.bookings ?? []).filter(
      (b) => !bookingIsCancelled(b.status) && (b.userId ?? '').trim() && (b.userId ?? '').trim() !== currentUserId
    );
  }, [ratingRide, currentUserId]);
  const isOwnerRatingFlow = Boolean(
    ratingRide && currentUserId && isViewerRideOwner(ratingRide, currentUserId)
  );
  const ownerHasMultipleCandidates = isOwnerRatingFlow && ownerRateCandidates.length > 1;
  const showOwnerPickerOnly = ownerHasMultipleCandidates && !selectedRateTargetUserId;

  const listCtx = useMemo<YourRidesListContext>(
    () => ({ userId: currentUserId, bookedRideIds }),
    [currentUserId, bookedRideIds]
  );

  const tabCounts = useMemo(
    () => ({
      myRides: countForTab(rides, 'myRides', listCtx),
      allRides: countForTab(rides, 'allRides', listCtx),
      pastRides: countForTab(rides, 'pastRides', listCtx),
    }),
    [rides, listCtx]
  );

  const allRidesTabLabelCount = Math.max(tabCounts.allRides, cachedAllRidesCount);

  const allRidesFlat = useMemo(
    () => sortRidesForYourRides(rides.filter(matchesAllRidesTab), 'upcoming'),
    [rides]
  );

  const myRidesSections = useMemo(
    () =>
      buildDrivingPassengerSections(
        rides.filter((r) => matchesMyRidesTab(r, listCtx)),
        currentUserId,
        'upcoming'
      ),
    [rides, listCtx, currentUserId]
  );

  const pastRidesSections = useMemo(
    () =>
      buildDrivingPassengerSections(
        rides.filter((r) => matchesPastRidesTab(r, listCtx)),
        currentUserId,
        'past'
      ),
    [rides, listCtx, currentUserId]
  );

  const showOfflineInTabEmpty = netConnected === false && !backgroundRefreshing;

  const staleTripsBanner =
    rides.length > 0 && (netConnected === false || showingStaleFromCache) ? (
      <View
        style={styles.staleTripsBanner}
        accessibilityRole="alert"
        accessibilityLabel={OFFLINE_A11Y_CACHED_LIST}
      >
        <Ionicons name="cloud-offline-outline" size={16} color={COLORS.textSecondary} />
        <Text style={styles.staleTripsBannerText}>{OFFLINE_HEADLINE}</Text>
      </View>
    ) : null;

  const initialLoadBlock =
    loading && rides.length === 0 && !error && netConnected !== false ? (
      <View style={styles.skeletonListWrap}>
        {Array.from({ length: 4 }).map((_, idx) => (
          <RideCardSkeleton key={`your-rides-skeleton-${idx}`} />
        ))}
        <View style={styles.skeletonHint}>
          <Text style={styles.skeletonHintText}>
            {justBookedWelcome ? 'Updating your bookings…' : 'Loading trips…'}
          </Text>
        </View>
      </View>
    ) : null;

  const initialOfflineBlock =
    rides.length === 0 && !loading && !error && (offlineEmpty || netConnected === false) ? (
      <View style={styles.offlineFullBleed}>
        <View style={[styles.offlineCard, styles.offlineCardCompact]}>
          <View style={[styles.offlineIconWrap, styles.offlineIconWrapCompact]}>
            <Ionicons name="cloud-offline-outline" size={28} color={COLORS.textSecondary} />
          </View>
          <Text style={[styles.offlineTitle, styles.offlineTitleCompact]}>{OFFLINE_HEADLINE}</Text>
          <Text style={[styles.offlineSubtitle, styles.offlineSubtitleCompact]}>{OFFLINE_SUBTITLE_RETRY}</Text>
          <TouchableOpacity
            style={styles.offlineRetryBtn}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={() => {
              clearRideDetailCache();
              void fetchRides(false);
            }}
          >
            <Ionicons name="refresh" size={20} color={COLORS.white} />
            <Text style={styles.offlineRetryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    ) : null;

  const initialErrorBlock =
    !offlineEmpty && error && rides.length === 0 ? (
      <View style={styles.offlineFullBleed}>
        <View style={styles.offlineCard}>
          <View style={[styles.offlineIconWrap, styles.offlineIconWrapDanger]}>
            <Ionicons name="alert-circle-outline" size={38} color={COLORS.error} />
          </View>
          <Text style={styles.offlineTitle}>{`Couldn't load trips`}</Text>
          <Text style={styles.offlineErrorDetail}>{error}</Text>
          <TouchableOpacity
            style={styles.offlineRetryBtn}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={() => {
              clearRideDetailCache();
              void fetchRides(false);
            }}
          >
            <Ionicons name="refresh" size={20} color={COLORS.white} />
            <Text style={styles.offlineRetryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    ) : null;
  const blockingRefreshBlock = blockingRefreshLoading ? (
    <View style={styles.listBody}>
      <LoadingSpinner inline size="lg" label="Refreshing trips…" style={{ padding: 12 }} />
    </View>
  ) : null;

  const renderTripsEmptyCard = useCallback((variant: 'upcoming' | 'past') => {
    const isPast = variant === 'past';
    return (
      <View style={styles.tripsEmptyRoot}>
        <View style={styles.tripsEmptyCard}>
          <View style={styles.tripsEmptyMark} accessibilityRole="image" accessibilityLabel={isPast ? 'No past trips' : 'No upcoming trips'}>
            <MaterialCommunityIcons
              name={isPast ? 'history' : 'car-off'}
              size={isPast ? 34 : 38}
              color={COLORS.error}
            />
          </View>
          <Text style={styles.tripsEmptyTitle}>{isPast ? 'No past trips' : 'No upcoming trips'}</Text>
          <Text style={styles.tripsEmptyBody}>
            {isPast
              ? 'Ended or cancelled trips appear here after the ride is complete.'
              : 'Publish or book a ride to see it here. Pull to refresh.'}
          </Text>
        </View>
      </View>
    );
  }, []);

  return (
    <View style={styles.wrapper}>
      <View style={styles.filterRow}>
      <View style={styles.filterTabsInner}>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'myRides' && styles.filterTabActive]}
          onPress={() => setFilter('myRides')}
          activeOpacity={0.8}
        >
          <Text style={[styles.filterTabText, filter === 'myRides' && styles.filterTabTextActive]}>
            My rides{tabCounts.myRides > 0 ? ` (${tabCounts.myRides})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'allRides' && styles.filterTabActive]}
          onPress={() => {
            if (filter === 'allRides') {
              void fetchRides(ridesRef.current.length > 0);
              return;
            }
            setFilter('allRides');
          }}
          activeOpacity={0.8}
        >
          <Text style={[styles.filterTabText, filter === 'allRides' && styles.filterTabTextActive]}>
            All rides{allRidesTabLabelCount > 0 ? ` (${allRidesTabLabelCount})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'pastRides' && styles.filterTabActive]}
          onPress={() => setFilter('pastRides')}
          activeOpacity={0.8}
        >
          <Text style={[styles.filterTabText, filter === 'pastRides' && styles.filterTabTextActive]}>
            Past rides{tabCounts.pastRides > 0 ? ` (${tabCounts.pastRides})` : ''}
          </Text>
        </TouchableOpacity>
      </View>
      </View>
      {staleTripsBanner}
      {initialLoadBlock ?? initialOfflineBlock ?? initialErrorBlock ?? blockingRefreshBlock ?? (
        filter === 'allRides' ? (
          <FlatList
            data={allRidesFlat}
            keyExtractor={(item) => item.id}
            contentContainerStyle={
              allRidesFlat.length === 0
                ? [styles.emptyList, { paddingBottom: listContentBottomPad }]
                : [styles.list, { paddingBottom: listContentBottomPad }]
            }
            refreshControl={
              <RefreshControl
                refreshing={loading}
                onRefresh={() => {
                  clearRideDetailCache();
                  void fetchRides(false);
                }}
                colors={[COLORS.primary]}
              />
            }
            ListEmptyComponent={
              backgroundRefreshing ? (
                <LoadingSpinner inline size="md" label="Loading trips…" style={{ paddingVertical: 28 }} />
              ) : showOfflineInTabEmpty ? (
                <View style={[styles.empty, styles.emptyOffline]}>
                  <Ionicons name="cloud-offline-outline" size={40} color={COLORS.textMuted} />
                  <Text style={styles.emptyTitle}>{OFFLINE_HEADLINE}</Text>
                  <Text style={styles.emptySubtitle}>{OFFLINE_SUBTITLE_REFRESH}</Text>
                </View>
              ) : (
                renderTripsEmptyCard('upcoming')
              )
            }
            renderItem={({ item }) => (
              <YourRidesRideCard
                item={item}
                filter={filter}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
                viewerAvatarUrl={viewerAvatarUrl}
                bookedRideIds={bookedRideIds}
                ratedRideIds={ratedRideIds}
                ratedTargetsByRide={ratedTargetsByRide}
                onNavigateDetail={goRideDetail}
                onRateRide={openRateSheet}
                showRepublishAction={false}
                onRepublishPress={republishFromPastRide}
              />
            )}
          />
        ) : (
          <SectionList
            sections={filter === 'myRides' ? myRidesSections : pastRidesSections}
            keyExtractor={(item) => item.id}
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionHeader}>{section.title}</Text>
            )}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={
              (filter === 'myRides' ? myRidesSections : pastRidesSections).length === 0
                ? [styles.emptyList, { paddingBottom: listContentBottomPad }]
                : [styles.list, { paddingBottom: listContentBottomPad }]
            }
            refreshControl={
              <RefreshControl
                refreshing={loading}
                onRefresh={() => {
                  clearRideDetailCache();
                  void fetchRides(false);
                }}
                colors={[COLORS.primary]}
              />
            }
            ListEmptyComponent={
              backgroundRefreshing ? (
                <LoadingSpinner inline size="md" label="Loading trips…" style={{ paddingVertical: 28 }} />
              ) : showOfflineInTabEmpty ? (
                <View style={[styles.empty, styles.emptyOffline]}>
                  <Ionicons name="cloud-offline-outline" size={40} color={COLORS.textMuted} />
                  <Text style={styles.emptyTitle}>{OFFLINE_HEADLINE}</Text>
                  <Text style={styles.emptySubtitle}>{OFFLINE_SUBTITLE_REFRESH}</Text>
                </View>
              ) : (
                renderTripsEmptyCard(filter === 'pastRides' ? 'past' : 'upcoming')
              )
            }
            renderItem={({ item }) => (
              <YourRidesRideCard
                item={item}
                filter={filter}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
                viewerAvatarUrl={viewerAvatarUrl}
                bookedRideIds={bookedRideIds}
                ratedRideIds={ratedRideIds}
                ratedTargetsByRide={ratedTargetsByRide}
                onNavigateDetail={goRideDetail}
                onRateRide={openRateSheet}
                showRepublishAction={false}
                onRepublishPress={republishFromPastRide}
              />
            )}
          />
        )
      )}
      <Modal visible={showRatingSheet} transparent animationType="slide" onRequestClose={handleRatingModalRequestClose}>
        <View
          style={styles.ratingOverlay}
        >
          <Pressable style={styles.ratingOverlayPressable} onPress={() => void handleSkipRating()} />
          <Animated.View
            style={[
              styles.ratingSheet,
              { paddingBottom: 16 + Math.max(insets.bottom, 10) },
              { transform: [{ translateY: Animated.multiply(ratingKeyboardOffset, -1) }] },
            ]}
          >
            <View style={styles.ratingHandle} />
            <TouchableOpacity style={styles.ratingCloseBtn} onPress={() => void handleSkipRating()} hitSlop={8}>
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
            <Text style={styles.ratingTitle}>Rate your ride</Text>
            <Text style={styles.ratingSubtitle}>Tap a star to rate your experience</Text>

            {ownerRateCandidates.length > 1 ? (
              <View style={styles.rateTargetBlock}>
                <Text style={styles.rateTargetHeading}>Select passenger</Text>
                <View style={styles.rateTargetList}>
                  {ownerRateCandidates.map((p) => {
                    const uid = (p.userId ?? '').trim();
                    const name = (p.name ?? p.userName ?? 'Passenger').trim() || 'Passenger';
                    const selected = selectedRateTargetUserId === uid;
                    const isRated = Boolean(
                      ratingRide?.id && (ratedTargetsByRide[ratingRide.id] ?? []).includes(uid)
                    );
                    return (
                      <TouchableOpacity
                        key={`${ratingRide?.id}-${uid}`}
                        style={[
                          styles.rateTargetRow,
                          selected && !isRated && styles.rateTargetRowSelected,
                          isRated && styles.rateTargetRowRated,
                        ]}
                        onPress={() => {
                          if (isRated) return;
                          setSelectedRateTargetUserId(uid);
                          setSelectedRateTargetName(name);
                          // Reset inputs when changing target passenger.
                          setRatingStars(0);
                          setRatingReview('');
                        }}
                        disabled={isRated}
                        activeOpacity={isRated ? 1 : 0.75}
                      >
                        <View style={styles.rateTargetIcon}>
                          <Ionicons
                            name={isRated ? 'checkmark-circle' : 'person-outline'}
                            size={18}
                            color={isRated ? COLORS.success : selected ? COLORS.primary : COLORS.textSecondary}
                          />
                        </View>
                        <Text
                          style={[
                            styles.rateTargetName,
                            selected && styles.rateTargetNameSelected,
                            isRated && styles.rateTargetNameRated,
                          ]}
                          numberOfLines={1}
                        >
                          {name}
                        </Text>
                        {ownerRateCandidates.length > 1 ? (
                          <View style={styles.rateTargetActionWrap}>
                            <Text style={[styles.rateTargetActionText, isRated && styles.rateTargetActionRatedText]}>
                              {isRated ? 'Rated' : 'Rate'}
                            </Text>
                            <Ionicons
                              name={isRated ? 'checkmark' : 'chevron-forward'}
                              size={14}
                              color={isRated ? COLORS.success : COLORS.textMuted}
                            />
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : selectedRateTargetName ? (
              <View style={styles.rateTargetChosenPill}>
                <Text style={styles.rateTargetChosenText}>Rating: {selectedRateTargetName}</Text>
              </View>
            ) : null}

            {!showOwnerPickerOnly ? (
              <>
                <View style={styles.ratingStarsRow}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <TouchableOpacity key={s} onPress={() => setRatingStars(s)} disabled={ratingSubmitting} hitSlop={8}>
                      <Ionicons
                        name={ratingStars >= s ? 'star' : 'star-outline'}
                        size={34}
                    color={COLORS.warning}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
                {ratingStars > 0 ? (
                  <View style={styles.ratingCheckpointBlock}>
                    <Text style={styles.ratingCheckpointHeading}>Experience</Text>
                    <View style={styles.ratingCheckpointWrap}>
                      {ratingExperienceCheckpoints.map((label) => (
                        <TouchableOpacity
                          key={`exp-${label}`}
                          style={styles.ratingCheckpointChip}
                          onPress={() => addRatingCheckpoint(label)}
                          disabled={ratingSubmitting}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.ratingCheckpointChipText}>{label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={styles.ratingCheckpointHeading}>Behavior</Text>
                    <View style={styles.ratingCheckpointWrap}>
                      {ratingBehaviorCheckpoints.map((label) => (
                        <TouchableOpacity
                          key={`beh-${label}`}
                          style={styles.ratingCheckpointChip}
                          onPress={() => addRatingCheckpoint(label)}
                          disabled={ratingSubmitting}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.ratingCheckpointChipText}>{label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ) : null}

                <Text style={styles.ratingInputLabel}>Write your review (optional)</Text>
                <TextInput
                  style={styles.ratingInput}
                  placeholder="Tell us about the driver, the vehicle, or the route..."
                  placeholderTextColor={COLORS.textMuted}
                  value={ratingReview}
                  onChangeText={setRatingReview}
                  multiline
                  editable={!ratingSubmitting}
                />

                <TouchableOpacity
                  style={[
                    styles.ratingSubmitBtn,
                    (ratingStars < 1 || ratingSubmitting || (ownerRateCandidates.length > 0 && !selectedRateTargetUserId)) &&
                      styles.ratingSubmitBtnDisabled,
                  ]}
                  onPress={() => void handleSubmitRating()}
                  disabled={ratingStars < 1 || ratingSubmitting || (ownerRateCandidates.length > 0 && !selectedRateTargetUserId)}
                >
                  {ratingSubmitting ? (
                    <ActivityIndicator size="small" color={COLORS.white} />
                  ) : (
                    <Text style={styles.ratingSubmitText}>Submit Feedback</Text>
                  )}
                </TouchableOpacity>
                {ownerHasMultipleCandidates ? (
                  <TouchableOpacity
                    style={styles.ratingCancelBtn}
                    onPress={() => {
                      setSelectedRateTargetUserId('');
                      setSelectedRateTargetName('');
                      setRatingStars(0);
                      setRatingReview('');
                    }}
                  >
                    <Text style={styles.ratingCancelText}>Back to passengers</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            ) : null}
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  /** List / loading / error area below filter tabs (tabs stay mounted). */
  listBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    padding: 24,
  },
  skeletonListWrap: {
    flex: 1,
    padding: 16,
    backgroundColor: COLORS.background,
  },
  skeletonHint: {
    marginTop: 6,
    alignItems: 'center',
  },
  skeletonHintText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  filterRow: {
    backgroundColor: COLORS.background,
  },
  filterTabsInner: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
    gap: 6,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 4,
    marginBottom: 8,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterTabActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  filterTabTextActive: {
    color: COLORS.white,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    padding: 24,
  },
  loaderInner: {
    alignItems: 'center',
    maxWidth: 280,
  },
  loadingTitle: {
    marginTop: 20,
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  staleTripsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 14,
    backgroundColor: COLORS.backgroundSecondary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  staleTripsBannerText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  offlineFullBleed: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundSecondary,
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
  offlineCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  offlineCardCompact: {
    paddingVertical: 22,
    paddingHorizontal: 22,
    borderRadius: 16,
  },
  offlineIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  offlineIconWrapCompact: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  offlineIconWrapDanger: {
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
  },
  offlineTitle: {
    marginTop: 16,
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    letterSpacing: -0.35,
  },
  offlineTitleCompact: {
    marginTop: 12,
    fontSize: 18,
    letterSpacing: -0.28,
  },
  offlineSubtitle: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  offlineSubtitleCompact: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
  },
  offlineErrorDetail: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 21,
    color: COLORS.error,
    textAlign: 'center',
  },
  emptyOffline: {
    paddingVertical: 32,
  },
  offlineRetryBtn: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 8,
  },
  offlineRetryText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  list: {
    padding: 16,
  },
  emptyList: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 24,
    justifyContent: 'center',
  },
  tripsEmptyRoot: {
    width: '100%',
    alignItems: 'center',
  },
  tripsEmptyCard: {
    width: '100%',
    maxWidth: 360,
    alignSelf: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 18,
    paddingVertical: 18,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  tripsEmptyMark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
    backgroundColor: 'rgba(220, 38, 38, 0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(220, 38, 38, 0.22)',
  },
  tripsEmptyTitle: {
    marginTop: 6,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: COLORS.text,
    textAlign: 'center',
  },
  tripsEmptyBody: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '500',
    color: COLORS.textSecondary,
    textAlign: 'center',
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
  },
  republishOnlyCard: {
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundSecondary,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
  },
  republishOnlyTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  republishOnlyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
  },
  republishOnlyRoute: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  republishOnlyHint: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  ratingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  ratingOverlayPressable: {
    flex: 1,
  },
  ratingSheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    maxHeight: '84%',
  },
  ratingHandle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  ratingCloseBtn: {
    position: 'absolute',
    right: 14,
    top: 12,
    zIndex: 2,
    padding: 4,
  },
  ratingTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginTop: 4,
  },
  ratingSubtitle: {
    marginTop: 3,
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  ratingStarsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginTop: 18,
    marginBottom: 14,
  },
  ratingInputLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  ratingCheckpointBlock: {
    marginBottom: 10,
    gap: 8,
  },
  ratingCheckpointHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  ratingCheckpointWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ratingCheckpointChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#eef8f4',
    borderWidth: 1,
    borderColor: '#d7efe4',
  },
  ratingCheckpointChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  rateTargetBlock: {
    marginTop: 10,
    marginBottom: 8,
  },
  rateTargetHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  rateTargetList: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundSecondary,
    overflow: 'hidden',
  },
  rateTargetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    gap: 8,
  },
  rateTargetRowSelected: {
    backgroundColor: '#eef8f4',
  },
  rateTargetRowRated: {
    backgroundColor: '#f0fdf4',
  },
  rateTargetIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  rateTargetName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  rateTargetNameSelected: {
    color: COLORS.primary,
  },
  rateTargetNameRated: {
    color: COLORS.success,
  },
  rateTargetActionWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  rateTargetActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  rateTargetActionRatedText: {
    color: COLORS.success,
  },
  rateTargetChosenPill: {
    marginTop: 10,
    marginBottom: 8,
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#eef8f4',
  },
  rateTargetChosenText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  ratingInput: {
    minHeight: 92,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: 'top',
    color: COLORS.text,
    backgroundColor: COLORS.backgroundSecondary,
  },
  ratingSubmitBtn: {
    marginTop: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  ratingSubmitBtnDisabled: {
    backgroundColor: 'rgba(34,197,94,0.45)',
  },
  ratingSubmitText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
  ratingCancelBtn: {
    alignSelf: 'center',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  ratingCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
});
