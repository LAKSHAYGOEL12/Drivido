import type { RideListItem } from '../types/api';
import { API } from '../constants/API';
import api from './api';
import { mapRawToBookingRow } from '../utils/bookingNormalize';
import { pickPreferredBookingStatus } from '../utils/bookingStatus';
import { pickPublisherAvatarUrl } from '../utils/avatarUrl';
import { pickRoutePolylineEncodedFromRecord } from '../utils/ridePublisherCoords';

type Cached = { userId: string; at: number; list: RideListItem[] };
let cache: Cached | null = null;
const TTL_MS = 45_000;

/** Coalesce concurrent GETs per user (e.g. rapid focus + taps). */
let inFlight: { userId: string; promise: Promise<RideListItem[]> } | null = null;

export function invalidatePassengerBookedRidesCache(): void {
  cache = null;
}

/** Parse list payloads: `{ rides }`, `{ data }`, top-level array, etc. */
export function extractRideListFromResponse(res: unknown): Record<string, unknown>[] {
  if (res == null) return [];
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const d = res as Record<string, unknown>;
  const topArrays: unknown[] = [
    d.rides,
    d.items,
    d.results,
    d.publishedRides,
    d.published_rides,
    d.myRides,
    d.my_rides,
  ];
  for (const a of topArrays) {
    if (Array.isArray(a)) return a as Record<string, unknown>[];
  }
  const data = d.data;
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    const inner = data as Record<string, unknown>;
    const innerArrays: unknown[] = [
      inner.rides,
      inner.items,
      inner.results,
      inner.publishedRides,
      inner.published_rides,
      inner.myRides,
      inner.my_rides,
      inner.data,
    ];
    for (const a of innerArrays) {
      if (Array.isArray(a)) return a as Record<string, unknown>[];
    }
  }
  return [];
}

/** Normalize ride list row (aligned with YourRides / search) for schedule + route overlap logic. */
export function normalizeRideListItemFromApi(raw: Record<string, unknown>): RideListItem {
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
      outDate =
        outDate ||
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    ...(availableSeatsNum !== undefined ? { availableSeats: availableSeatsNum } : {}),
    ...(pendingRequestsNum !== undefined ? { pendingRequests: pendingRequestsNum } : {}),
    ...(hasPendingRequestsFlag !== undefined ? { hasPendingRequests: hasPendingRequestsFlag } : {}),
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
        (typeof r.pricing === 'object' && r.pricing
          ? (r.pricing as Record<string, unknown>).price
          : undefined)
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
  };
  const completedAt = toStr(r.completedAt ?? r.completed_at);
  if (completedAt) out.completedAt = completedAt;
  const mbs = toStr(r.myBookingStatus ?? r.my_booking_status ?? r.bookingStatus ?? r.booking_status);
  if (mbs) out.myBookingStatus = mbs;
  const mbr = toStr(
    r.myBookingStatusReason ?? r.my_booking_status_reason ?? r.statusReason ?? r.status_reason
  );
  if (mbr) out.myBookingStatusReason = mbr;
  const vbc = r.viewer_booking_context;
  if (vbc && typeof vbc === 'object') {
    out.viewer_booking_context = vbc as NonNullable<RideListItem['viewer_booking_context']>;
  }
  const bm = toStr(r.bookingMode ?? r.booking_mode)?.trim().toLowerCase();
  if (bm === 'instant' || bm === 'request') out.bookingMode = bm as RideListItem['bookingMode'];
  if (typeof r.instantBooking === 'boolean') out.instantBooking = r.instantBooking;
  else if (typeof r.instant_booking === 'boolean') out.instantBooking = r.instant_booking;
  const estDur = num(r.estimatedDurationSeconds ?? r.estimated_duration_seconds);
  if (estDur !== undefined && estDur > 0) {
    out.estimatedDurationSeconds = Math.floor(estDur);
  }
  const routePoly = pickRoutePolylineEncodedFromRecord(r as Record<string, unknown>);
  if (routePoly) {
    out.routePolylineEncoded = routePoly;
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
  const rideDesc = toStr(r.description ?? r.rideDescription ?? r.ride_description)?.trim();
  if (rideDesc) out.description = rideDesc;
  return out;
}

function enrichMyBookingStatus(ride: RideListItem, userId: string): RideListItem {
  const uid = userId.trim();
  if (!uid) return ride;
  const existing = String(ride.myBookingStatus ?? '').trim();
  if (existing) return ride;
  const mine = (ride.bookings ?? []).filter((b) => (b.userId ?? '').trim() === uid);
  if (mine.length === 0) return ride;
  return {
    ...ride,
    myBookingStatus: pickPreferredBookingStatus(mine.map((b) => b.status ?? '')),
  };
}

/**
 * GET `/rides/booked` for overlap checks on ride detail. Short TTL cache per user.
 */
export async function fetchPassengerBookedRidesForOverlap(
  userId: string,
  opts?: { force?: boolean }
): Promise<RideListItem[]> {
  const uid = userId.trim();
  if (!uid) return [];
  const now = Date.now();
  if (!opts?.force && cache && cache.userId === uid && now - cache.at < TTL_MS) {
    return cache.list;
  }
  if (inFlight?.userId === uid) {
    return inFlight.promise;
  }
  const promise = (async () => {
    try {
      const data = await api.get<unknown>(API.endpoints.rides.booked);
      const rows = extractRideListFromResponse(data);
      const list = rows
        .map((raw) => normalizeRideListItemFromApi(raw))
        .filter((r) => r.id.trim() !== '')
        .map((r) => enrichMyBookingStatus(r, uid));
      cache = { userId: uid, at: Date.now(), list };
      return list;
    } catch {
      return cache?.userId === uid ? cache.list : [];
    } finally {
      if (inFlight?.userId === uid) inFlight = null;
    }
  })();
  inFlight = { userId: uid, promise };
  return promise;
}
