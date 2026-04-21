import type { RideListItem } from '../types/api';
import { bookingIsCancelled, bookingIsPendingLike } from './bookingStatus';
import { bookingPassengerDisplayName } from './displayNames';
import { distanceKm } from './calculateDistance';

export const RIDE_MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export const RIDE_WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Publish / edit ride date row: "Today, Jan 3" · "Tomorrow, …" · "Mon, Jan 5".
 * Matches calendar-day semantics (local midnight boundaries).
 */
export function formatPublishStyleDateLabel(d: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dNorm = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (dNorm.getTime() === today.getTime()) {
    return `Today, ${RIDE_MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
  }
  if (dNorm.getTime() === tomorrow.getTime()) {
    return `Tomorrow, ${RIDE_MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
  }
  return `${RIDE_WEEKDAYS_SHORT[d.getDay()]}, ${RIDE_MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** Card header: "Oct 24" style (no year). */
export function getRideCardDateShort(ride: RideListItem): string {
  if (ride.scheduledAt) {
    const d = new Date(ride.scheduledAt);
    if (!isNaN(d.getTime())) {
      return `${RIDE_MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
    }
  }
  const raw = ride.scheduledDate ?? ride.rideDate ?? ride.date;
  if (raw && typeof raw === 'string') {
    const parts = raw.split(/[-/]/);
    if (parts.length >= 3) {
      const y = Number(parts[0]);
      const m = Number(parts[1]);
      const day = Number(parts[2]);
      if (!Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(day) && m >= 1 && m <= 12) {
        return `${RIDE_MONTHS_SHORT[m - 1]} ${day}`;
      }
    }
    return raw;
  }
  return '—';
}

export function formatRidePrice(ride: RideListItem): string {
  const anyRide = ride as RideListItem & {
    fare?: unknown;
    amount?: unknown;
    pricePerSeat?: unknown;
    price_per_seat?: unknown;
  };
  const raw =
    ride.price ??
    (anyRide.fare as string | undefined) ??
    (anyRide.amount as string | undefined) ??
    (anyRide.pricePerSeat as string | undefined) ??
    (anyRide.price_per_seat as string | undefined);
  if (raw == null || String(raw).trim() === '') return '—';
  const cleaned = String(raw).replace(/[₹$,]/g, '').trim();
  const n = Number(cleaned);
  if (!Number.isNaN(n)) {
    const pretty = Number.isInteger(n)
      ? String(n)
      : String(Number(n.toFixed(2)));
    return `₹${pretty}`;
  }
  return `₹ ${String(raw).trim()}`;
}

/** For UI: large main amount + smaller decimal (paise), e.g. BlaBlaCar-style price row. */
export function formatRidePriceParts(ride: RideListItem): {
  rupee: string;
  integerPart: string;
  decimalPart: string;
} | null {
  const anyRide = ride as RideListItem & {
    fare?: unknown;
    amount?: unknown;
    pricePerSeat?: unknown;
    price_per_seat?: unknown;
  };
  const raw =
    ride.price ??
    (anyRide.fare as string | undefined) ??
    (anyRide.amount as string | undefined) ??
    (anyRide.pricePerSeat as string | undefined) ??
    (anyRide.price_per_seat as string | undefined);
  if (raw == null || String(raw).trim() === '') return null;
  const cleaned = String(raw).replace(/[₹$,]/g, '').trim();
  const n = Number(cleaned);
  if (Number.isNaN(n)) {
    return { rupee: '₹ ', integerPart: String(raw).trim(), decimalPart: '' };
  }
  const fixed = n.toFixed(2);
  const [intRaw, dec] = fixed.split('.');
  const intPart = Number(intRaw).toLocaleString('en-IN');
  return { rupee: '₹ ', integerPart: intPart, decimalPart: dec };
}

/** Scheduled departure as `Date`, or `null` if unknown. */
export function getRideScheduledAt(ride: RideListItem): Date | null {
  if (ride.scheduledAt) {
    const d = new Date(ride.scheduledAt);
    if (!isNaN(d.getTime())) return d;
  }
  const dateStr = ride.scheduledDate ?? ride.rideDate ?? ride.date;
  const timeStr = ride.scheduledTime ?? ride.rideTime ?? ride.time;
  if (!dateStr || !timeStr) return null;
  const datePart = String(dateStr).trim();
  const timePart = String(timeStr).trim();
  const [h, m] = timePart.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  const [y, mo, day] = datePart.split('-').map(Number);
  if (Number.isNaN(y) || Number.isNaN(mo) || Number.isNaN(day)) return null;
  const d = new Date(y, (mo ?? 1) - 1, day ?? 1, h ?? 0, m ?? 0, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

export function isRidePast(ride: RideListItem): boolean {
  const at = getRideScheduledAt(ride);
  if (!at) return false;
  return at.getTime() < Date.now();
}

/**
 * True once the listed departure date+time is **now or earlier** (`now >= scheduled pickup`).
 * Use to lock **owner** cancel/edit — distinct from {@link isRidePastArrivalWindow} (end of trip + grace).
 */
export function isRideScheduledDepartureReached(ride: RideListItem): boolean {
  const at = getRideScheduledAt(ride);
  if (!at) return false;
  return Date.now() >= at.getTime();
}

/** Grace after estimated arrival before a ride is treated as “past / completed” (30 minutes). */
export const PAST_GRACE_MS_AFTER_ARRIVAL = 30 * 60 * 1000;

/**
 * Estimated arrival time (pickup + route duration). If duration unknown, assumes +1h from pickup.
 */
export function getRideArrivalDate(ride: RideListItem): Date | null {
  const start = getRideScheduledAt(ride);
  if (!start) return null;
  const mins = getRouteDurationMinutes(ride);
  if (mins == null) {
    return new Date(start.getTime() + 60 * 60 * 1000);
  }
  return new Date(start.getTime() + mins * 60 * 1000);
}

/**
 * True when now is after (estimated destination arrival + 1 hour).
 * Use for Past rides tab and “Completed” instead of pickup-only `isRidePast`.
 */
export function isRidePastArrivalWindow(ride: RideListItem): boolean {
  const arrival = getRideArrivalDate(ride);
  if (!arrival) return isRidePast(ride);
  return Date.now() > arrival.getTime() + PAST_GRACE_MS_AFTER_ARRIVAL;
}

/** Ride cancelled by publisher — tolerate API spelling and boolean flags. */
export function isRideCancelledByOwner(ride: RideListItem): boolean {
  const r = ride as RideListItem & {
    cancelled?: boolean;
    isCancelled?: boolean;
    is_cancelled?: boolean;
    cancelled_at?: unknown;
    cancelledAt?: unknown;
  };
  if (r.cancelled === true || r.isCancelled === true || r.is_cancelled === true) return true;
  const ca = r.cancelled_at ?? r.cancelledAt;
  if (ca != null && String(ca).trim() !== '') return true;
  const s = (ride.status ?? '').trim().toLowerCase();
  return s === 'cancelled' || s === 'canceled';
}

/**
 * True for published rows that are still “live”: not terminal/cancelled and not past the arrival window.
 * Matches driver “live” rides in Your Rides (used for edit rules, dev logging, etc.).
 */
export function isPublishedRideLiveNow(r: RideListItem): boolean {
  if (!String(r.id ?? '').trim()) return false;
  if (isRideCancelledByOwner(r)) return false;
  const st = String(r.status ?? '').trim().toLowerCase();
  if (st === 'completed' || st === 'complete' || st === 'cancelled' || st === 'canceled') return false;
  if (isRidePastArrivalWindow(r)) return false;
  return true;
}

/**
 * Show “Completed” on past cards: past arrival window, and not cancelled (ride or user booking).
 */
export function isRideCompletedForDisplay(ride: RideListItem): boolean {
  if (isRideCancelledByOwner(ride)) return false;
  if (bookingIsCancelled(ride.myBookingStatus)) return false;
  return isRidePastArrivalWindow(ride);
}

/**
 * Total booking rows for this ride (any status). Prefer `totalBookings` from GET /rides or detail;
 * fall back to `bookings.length` when the array is present.
 */
export function getRideTotalBookingCount(ride: RideListItem): number {
  const n = ride.totalBookings;
  if (typeof n === 'number' && !Number.isNaN(n) && n >= 0) return Math.floor(n);
  return (ride.bookings ?? []).length;
}

/**
 * Owner “pending request” line on ride cards: pending-like `bookings[]` rows, numeric aggregate,
 * or owner-only `hasPendingRequests` / `has_pending_requests` from GET /rides, /my-rides, /rides/booked.
 */
export function readPendingSeatRequestCount(
  ride: RideListItem,
  bookings: { status?: string }[] | undefined
): number {
  const fromRows = (bookings ?? []).filter((b) => bookingIsPendingLike(b.status)).length;
  const r = ride as RideListItem & Record<string, unknown>;
  const raw =
    r.pendingRequests ??
    r.pending_requests ??
    r.pendingRequestCount ??
    r.pending_request_count ??
    r.requestsPending ??
    r.requests_pending;
  let fromField = 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    fromField = Math.max(0, Math.floor(raw));
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    const p = parseInt(raw, 10);
    if (!Number.isNaN(p)) fromField = Math.max(0, p);
  }
  const hp = r.hasPendingRequests ?? r.has_pending_requests;
  const fromBool = hp === true || hp === 'true' ? 1 : 0;
  return Math.max(fromRows, fromField, fromBool);
}

/** Compare user ids (trimmed, case-insensitive) to avoid ObjectId string mismatches. */
export function userIdsMatch(a: string | undefined, b: string | undefined): boolean {
  const x = (a ?? '').trim();
  const y = (b ?? '').trim();
  if (!x || !y) return false;
  return x === y || x.toLowerCase() === y.toLowerCase();
}

/**
 * Driver-only UI from API: **true** only when the backend says so.
 * Use for Edit ride / Cancel ride — never infer from `userId` alone.
 */
export function isViewerOwnerStrict(ride: RideListItem): boolean {
  if (ride.viewerIsOwner === true) return true;
  const snake = (ride as { viewer_is_owner?: unknown }).viewer_is_owner;
  return snake === true || snake === 'true';
}

/**
 * Whether the viewer is this ride’s publisher and there is at least one pending seat request
 * (aligned with ride list cards — `hasPendingRequests`, `bookings[]`, or numeric aggregates).
 */
export function ownerHasPendingSeatRequests(ride: RideListItem, currentUserId: string | undefined): boolean {
  const uid = currentUserId?.trim();
  if (!uid) return false;
  const isPublisher = userIdsMatch(uid, ride.userId) || isViewerOwnerStrict(ride);
  if (!isPublisher) return false;
  return readPendingSeatRequestCount(ride, ride.bookings) > 0;
}

/**
 * Whether the current viewer is the ride publisher (driver). Prefer API `viewerIsOwner`;
 * when `false`, never treat the viewer as owner. When omitted, fall back to `userId` match.
 */
export function isViewerRideOwner(ride: RideListItem, currentUserId?: string): boolean {
  if (ride.viewerIsOwner === true) return true;
  if (ride.viewerIsOwner === false) return false;
  return userIdsMatch(currentUserId, ride.userId);
}

/** Context for {@link isViewerRidePublisher} when `viewerIsOwner` is missing on the ride object. */
export type RidePublisherViewerContext = {
  /** Confirmed passenger booking (from bookings[] and/or merged myBookingStatus). */
  hasActivePassengerBooking: boolean;
  /** Any booking row for this user (incl. cancelled) — you are a passenger, not the driver. */
  hasPassengerBookingRowForUser: boolean;
};

/**
 * Driver vs passenger for ride detail / destructive actions. Prefer `viewerIsOwner` from API.
 * When it is missing, **do not** treat the viewer as the driver if they have a passenger booking
 * (avoids wrong owner UI when `userId` matching misfires).
 */
export function isViewerRidePublisher(
  ride: RideListItem,
  currentUserId: string | undefined,
  ctx: RidePublisherViewerContext
): boolean {
  if (ride.viewerIsOwner === true) return true;
  if (ride.viewerIsOwner === false) return false;
  if (ctx.hasActivePassengerBooking || ctx.hasPassengerBookingRowForUser) return false;
  return userIdsMatch(currentUserId, ride.userId);
}

/**
 * Edit ride / Cancel ride — driver-only actions. **Only** when API sets `viewerIsOwner` /
 * `viewer_is_owner` to true (no `userId` fallback).
 */
export function canShowOwnerRidePublisherActions(ride: RideListItem, _currentUserId?: string): boolean {
  return isViewerOwnerStrict(ride);
}

/** Title for ride card / detail when viewer is the publisher: who booked (not driver name). */
export function formatBookersCardTitle(
  bookings: Array<{ name?: string; userName?: string }> | undefined
): string {
  const list = bookings ?? [];
  if (!list.length) return 'No bookings yet';
  const names = list.map((b) => bookingPassengerDisplayName(b));
  const unique = [...new Set(names)];
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} & ${unique[1]}`;
  return `${unique[0]} +${unique.length - 1} more`;
}

/**
 * Owner card title: names from `bookings[]`, or “Had N passengers” when the API sent
 * `totalBookings` but no rows. Returns empty string when there’s nothing to show (no “No bookings yet” on cards).
 */
export function formatOwnerRideCardTitle(ride: RideListItem): string {
  const bookings = ride.bookings ?? [];
  const total = getRideTotalBookingCount(ride);
  if (bookings.length > 0) return formatBookersCardTitle(bookings);
  if (total > 0) return `Had ${total} passenger${total !== 1 ? 's' : ''}`;
  return '';
}

export function getRidePickupTime(ride: RideListItem): string {
  if (ride.scheduledAt) {
    const d = new Date(ride.scheduledAt);
    if (!isNaN(d.getTime())) {
      const h = d.getHours();
      const m = d.getMinutes();
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }
  const timeStr = ride.scheduledTime ?? ride.rideTime ?? ride.time;
  if (timeStr) {
    const part = String(timeStr).trim().slice(0, 5);
    return part.length >= 4 ? part : '—';
  }
  return '—';
}

/** Heuristic when API/Google duration missing: ~2 minutes per km (e.g. 40 km → 80 min). */
const FALLBACK_MINUTES_PER_KM = 2;

/**
 * Total travel time in minutes: prefers `estimatedDurationSeconds` from publish/route;
 * otherwise estimates from straight-line distance between pickup and destination.
 */
export function getRouteDurationMinutes(ride: RideListItem): number | null {
  const sec = ride.estimatedDurationSeconds;
  if (typeof sec === 'number' && !Number.isNaN(sec) && sec > 0) {
    return Math.max(1, Math.round(sec / 60));
  }
  const lat1 = ride.pickupLatitude;
  const lon1 = ride.pickupLongitude;
  const lat2 = ride.destinationLatitude;
  const lon2 = ride.destinationLongitude;
  if (
    lat1 != null &&
    lon1 != null &&
    lat2 != null &&
    lon2 != null &&
    !Number.isNaN(lat1) &&
    !Number.isNaN(lon1) &&
    !Number.isNaN(lat2) &&
    !Number.isNaN(lon2)
  ) {
    const km = distanceKm(
      { latitude: lat1, longitude: lon1 },
      { latitude: lat2, longitude: lon2 }
    );
    if (km > 0) {
      return Math.max(1, Math.round(km * FALLBACK_MINUTES_PER_KM));
    }
  }
  return null;
}

/** e.g. 40 → "0h40", 80 → "1h20" (matches ride-card style) */
export function formatDurationShort(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

function formatClockHHMM(d: Date): string {
  const h = d.getHours();
  const min = d.getMinutes();
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Pickup clock, trip duration label, and arrival clock for list cards.
 * Arrival = scheduled departure + route duration.
 */
export function getRideDepartureArrivalRow(ride: RideListItem): {
  departure: string;
  durationLabel: string;
  arrival: string;
} | null {
  const start = getRideScheduledAt(ride);
  if (!start) return null;
  const mins = getRouteDurationMinutes(ride);
  if (mins == null) {
    return {
      departure: formatClockHHMM(start),
      durationLabel: '',
      arrival: '',
    };
  }
  const end = new Date(start.getTime() + mins * 60 * 1000);
  return {
    departure: formatClockHHMM(start),
    durationLabel: formatDurationShort(mins),
    arrival: formatClockHHMM(end),
  };
}

/**
 * When the API embeds a publisher/driver phone on ride list/detail (any of several keys).
 */
export function pickPublisherPhoneFromRide(ride: RideListItem | undefined): string | undefined {
  if (!ride) return undefined;
  const r = ride as Record<string, unknown>;
  const pub = r.publisher && typeof r.publisher === 'object' ? (r.publisher as Record<string, unknown>) : null;
  const candidates = [r.publisherPhone, r.publisher_phone, r.driverPhone, r.driver_phone, pub?.phone];
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return undefined;
}

/**
 * When the API embeds passenger contact on a booking row (list/detail).
 */
export function pickPassengerPhoneFromBooking(booking: unknown): string | undefined {
  if (!booking || typeof booking !== 'object') return undefined;
  const b = booking as Record<string, unknown>;
  const user = b.user && typeof b.user === 'object' ? (b.user as Record<string, unknown>) : null;
  const candidates = [
    b.phone,
    b.phoneNumber,
    b.phone_number,
    b.mobile,
    b.passengerPhone,
    b.passenger_phone,
    user?.phone,
    user?.mobile,
    user?.phoneNumber,
    user?.phone_number,
  ];
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return undefined;
}
