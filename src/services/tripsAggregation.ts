import type { RideListItem } from '../types/api';
import api from './api';
import { API } from '../constants/API';
import {
  extractRideListFromResponse,
  normalizeRideListItemFromApi,
  fetchPassengerBookedRidesForOverlap,
  invalidatePassengerBookedRidesCache,
} from './fetchPassengerBookedRides';
import { bookingIsCancelled, bookingIsCancelledByOwner } from '../utils/bookingStatus';
import {
  getRideArrivalDate,
  getRideScheduledAt,
  isRideCancelledByOwner,
  userIdsMatch,
} from '../utils/rideDisplay';
import { distanceKm } from '../utils/calculateDistance';

export type TripLedgerKind = 'completed' | 'cancelled';
export type TripLedgerRole = 'driver' | 'passenger';

export type TripLedgerEntry = {
  key: string;
  kind: TripLedgerKind;
  role: TripLedgerRole;
  at: number;
  ride: RideListItem;
};

export type UserTripsAggregate = {
  entries: TripLedgerEntry[];
  completedThisMonth: number;
  totalTrips: number;
  completedAllTime: number;
  cancelledAllTime: number;
  lastTripAt: number;
  totalCompletedDistanceKm: number;
};

/** Profile / owner modal: total terminal trips, or 0 when none / unknown aggregate. */
export function formatTripsProfileStat(agg: UserTripsAggregate | null | undefined): string {
  if (!agg) return '0';
  const terminal = Math.max(0, agg.completedAllTime) + Math.max(0, agg.cancelledAllTime);
  return String(terminal);
}

export function tripCountsFromAggregate(
  agg: UserTripsAggregate | null | undefined
): { completed: number; cancelled: number } {
  return {
    completed: Math.max(0, agg?.completedAllTime ?? 0),
    cancelled: Math.max(0, agg?.cancelledAllTime ?? 0),
  };
}

/** Own profile / edit profile: total terminal trips only (not completed/cancelled breakdown). */
export function formatOwnProfileTripsLine(
  loading: boolean,
  completed: number,
  cancelled: number
): string {
  if (loading) return '—';
  return String(Math.max(0, completed) + Math.max(0, cancelled));
}

function parseMs(iso: string | undefined): number {
  if (!iso?.trim()) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Trip stats: count as completed only when the server marks completion — not merely “past arrival time”. */
function rideMarkedCompleted(ride: RideListItem): boolean {
  const s = (ride.status ?? '').trim().toLowerCase();
  if (s === 'completed' || s === 'complete') return true;
  const ext = ride as RideListItem & { completedAt?: string };
  return Boolean(ext.completedAt?.trim());
}

function bookingMarkedCompleted(status: string | undefined): boolean {
  const s = (status ?? '').trim().toLowerCase();
  return s === 'completed' || s === 'complete';
}

export function estimateRideDistanceKm(ride: RideListItem): number {
  const lat1 = ride.pickupLatitude;
  const lng1 = ride.pickupLongitude;
  const lat2 = ride.destinationLatitude;
  const lng2 = ride.destinationLongitude;
  if (
    typeof lat1 !== 'number' ||
    typeof lng1 !== 'number' ||
    typeof lat2 !== 'number' ||
    typeof lng2 !== 'number'
  ) {
    return 0;
  }
  return distanceKm({ latitude: lat1, longitude: lng1 }, { latitude: lat2, longitude: lng2 });
}

async function fetchOwnerPublishedRides(): Promise<RideListItem[]> {
  try {
    const data = await api.get<unknown>(API.endpoints.rides.myPublished);
    return extractRideListFromResponse(data)
      .map((raw) => normalizeRideListItemFromApi(raw))
      .filter((r) => r.id.trim() !== '')
      .map((r) => ({ ...r, viewerIsOwner: true as const }));
  } catch {
    return [];
  }
}

function ownerLedgerEntries(ride: RideListItem): TripLedgerEntry[] {
  const r: RideListItem = { ...ride, viewerIsOwner: true };
  if (isRideCancelledByOwner(r)) {
    const ext = r as RideListItem & { cancelledAt?: string; cancelled_at?: string };
    const at =
      parseMs(ext.cancelledAt) ||
      parseMs(ext.cancelled_at) ||
      parseMs(r.createdAt) ||
      parseMs(r.scheduledAt) ||
      getRideScheduledAt(r)?.getTime() ||
      0;
    return [
      {
        key: `${r.id}|driver|cancelled`,
        kind: 'cancelled',
        role: 'driver',
        at: at || Date.now(),
        ride: r,
      },
    ];
  }
  if (rideMarkedCompleted(r)) {
    let at = parseMs(r.completedAt);
    if (!at) {
      const arrival = getRideArrivalDate(r);
      at = arrival ? arrival.getTime() : getRideScheduledAt(r)?.getTime() || 0;
    }
    return [
      {
        key: `${r.id}|driver|completed`,
        kind: 'completed',
        role: 'driver',
        at: at || Date.now(),
        ride: r,
      },
    ];
  }
  return [];
}

type BookingRow = NonNullable<RideListItem['bookings']>[number];

function passengerRows(ride: RideListItem, userId: string): BookingRow[] {
  const uid = userId.trim();
  const mine = (ride.bookings ?? [])
    .filter((b) => (b.userId ?? '').trim() === uid)
    .sort((a, b) => parseMs(a.bookedAt) - parseMs(b.bookedAt));
  if (mine.length > 0) return mine;
  const mbs = ride.myBookingStatus?.trim();
  if (!mbs) return [];
  return [
    {
      id: `__inline_${ride.id}`,
      userId: uid,
      seats: 1,
      status: mbs,
      bookedAt: ride.createdAt?.trim() || ride.scheduledAt?.trim() || '',
    },
  ];
}

function passengerLedgerForRide(ride: RideListItem, userId: string): TripLedgerEntry[] {
  const rows = passengerRows(ride, userId);
  const out: TripLedgerEntry[] = [];
  for (const b of rows) {
    const hist = b.bookingHistory ?? [];
    const st = (b.status ?? '').trim().toLowerCase();
    const activeRow = !bookingIsCancelled(b.status) && !bookingIsCancelledByOwner(b.status);

    if (hist.length > 0) {
      const chron = [...hist].sort((x, y) => parseMs(x.bookedAt) - parseMs(y.bookedAt));
      let hi = 0;
      for (const h of chron) {
        if (bookingIsCancelled(h.status)) {
          out.push({
            key: `${ride.id}|passenger|${b.id}|h${hi++}`,
            kind: 'cancelled',
            role: 'passenger',
            at: parseMs(h.bookedAt) || parseMs(b.bookedAt) || Date.now(),
            ride,
          });
        }
      }
      if (activeRow && isRideCancelledByOwner(ride)) {
        out.push({
          key: `${ride.id}|passenger|${b.id}|ride_cancelled`,
          kind: 'cancelled',
          role: 'passenger',
          at: parseMs(b.bookedAt) || Date.now(),
          ride,
        });
      } else if (
        activeRow &&
        (st === 'confirmed' || st === 'accepted' || bookingMarkedCompleted(b.status)) &&
        (rideMarkedCompleted(ride) || bookingMarkedCompleted(b.status))
      ) {
        const at =
          parseMs(ride.completedAt) ||
          getRideArrivalDate(ride)?.getTime() ||
          getRideScheduledAt(ride)?.getTime() ||
          parseMs(b.bookedAt) ||
          Date.now();
        out.push({
          key: `${ride.id}|passenger|${b.id}|completed`,
          kind: 'completed',
          role: 'passenger',
          at,
          ride,
        });
      }
      continue;
    }

    if (bookingIsCancelled(b.status) || bookingIsCancelledByOwner(b.status)) {
      out.push({
        key: `${ride.id}|passenger|${b.id}|row_cancelled`,
        kind: 'cancelled',
        role: 'passenger',
        at: parseMs(b.bookedAt) || getRideScheduledAt(ride)?.getTime() || Date.now(),
        ride,
      });
      continue;
    }
    if (isRideCancelledByOwner(ride)) {
      out.push({
        key: `${ride.id}|passenger|${b.id}|owner_cancelled_ride`,
        kind: 'cancelled',
        role: 'passenger',
        at: parseMs(b.bookedAt) || Date.now(),
        ride,
      });
      continue;
    }
    if (
      (st === 'confirmed' || st === 'accepted' || bookingMarkedCompleted(b.status)) &&
      (rideMarkedCompleted(ride) || bookingMarkedCompleted(b.status))
    ) {
      const at =
        parseMs(ride.completedAt) ||
        getRideArrivalDate(ride)?.getTime() ||
        getRideScheduledAt(ride)?.getTime() ||
        parseMs(b.bookedAt) ||
        Date.now();
      out.push({
        key: `${ride.id}|passenger|${b.id}|completed`,
        kind: 'completed',
        role: 'passenger',
        at,
        ride,
      });
    }
  }
  return out;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function pickNonNegInt(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return Math.max(0, Math.floor(n));
  }
  return 0;
}

/**
 * Maps public trip-summary JSON (several possible keys) into the same shape as the local ledger aggregate.
 */
export function aggregateFromPublicTripsPayload(raw: unknown): UserTripsAggregate {
  const root = asRecord(raw) ?? {};
  const data = asRecord(root.data) ?? root;
  const completed = pickNonNegInt(
    data.completedAllTime ??
      data.completed_all_time ??
      data.completedCount ??
      data.completed_count ??
      data.completed
  );
  const cancelled = pickNonNegInt(
    data.cancelledAllTime ??
      data.cancelled_all_time ??
      data.cancelledCount ??
      data.cancelled_count ??
      data.cancelled
  );
  /** Profile total must be terminal trips only — never trust API “total” that might include live/upcoming rides. */
  const total = completed + cancelled;
  const lastRaw = data.lastTripAt ?? data.last_trip_at ?? data.lastTripMs;
  let lastTripAt = 0;
  if (typeof lastRaw === 'string' && lastRaw.trim()) {
    const t = new Date(lastRaw).getTime();
    if (!Number.isNaN(t)) lastTripAt = t;
  } else if (typeof lastRaw === 'number' && Number.isFinite(lastRaw)) {
    lastTripAt = lastRaw > 1e12 ? lastRaw : lastRaw * 1000;
  }
  const kmRaw = data.totalCompletedDistanceKm ?? data.total_completed_distance_km ?? data.totalDistanceKm;
  let totalKm = 0;
  if (typeof kmRaw === 'number' && kmRaw > 0) totalKm = kmRaw;
  else if (typeof kmRaw === 'string') {
    const n = Number(kmRaw);
    if (!Number.isNaN(n) && n > 0) totalKm = n;
  }
  const completedThisMonth = pickNonNegInt(data.completedThisMonth ?? data.completed_this_month);
  return {
    entries: [],
    completedThisMonth,
    totalTrips: total,
    completedAllTime: completed,
    cancelledAllTime: cancelled,
    lastTripAt,
    totalCompletedDistanceKm: totalKm,
  };
}

async function fetchPublicUserTripsSummary(userId: string): Promise<UserTripsAggregate> {
  const id = userId.trim();
  if (!id) return buildAggregate([]);
  const paths = [
    API.endpoints.rides.userTripsSummary(id),
    API.endpoints.rides.tripsSummaryByUserId(id),
    `/trips/summary/${encodeURIComponent(id)}`,
    `/rides/trips-summary?userId=${encodeURIComponent(id)}`,
  ];
  for (const path of paths) {
    try {
      const raw = await api.get<unknown>(path, {
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
      return aggregateFromPublicTripsPayload(raw);
    } catch {
      /* try next path */
    }
  }
  return buildAggregate([]);
}

function buildAggregate(entries: TripLedgerEntry[]): UserTripsAggregate {
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const completedAll = entries.filter((e) => e.kind === 'completed');
  const cancelledAll = entries.filter((e) => e.kind === 'cancelled');
  const completedThisMonth = completedAll.filter((e) => {
    const d = new Date(e.at);
    return d.getFullYear() === y && d.getMonth() === mo;
  }).length;
  const lastTripAt = entries.reduce((max, e) => Math.max(max, e.at), 0);
  const totalKm = completedAll.reduce((sum, e) => sum + estimateRideDistanceKm(e.ride), 0);
  const completedAllTime = completedAll.length;
  const cancelledAllTime = cancelledAll.length;
  return {
    entries,
    completedThisMonth,
    totalTrips: completedAllTime + cancelledAllTime,
    completedAllTime,
    cancelledAllTime,
    lastTripAt,
    totalCompletedDistanceKm: totalKm,
  };
}

/**
 * Merges rides you published (driver ledger) with rides you booked (passenger ledger).
 * When the same ride id appears as both, only the driver-side ledger is used.
 */
export async function fetchUserTripsAggregate(
  userId: string,
  opts?: { forcePassengerCache?: boolean }
): Promise<UserTripsAggregate> {
  if (opts?.forcePassengerCache) {
    invalidatePassengerBookedRidesCache();
  }
  const uid = userId.trim();
  if (!uid) {
    return buildAggregate([]);
  }
  const [ownerList, passengerList] = await Promise.all([
    fetchOwnerPublishedRides(),
    fetchPassengerBookedRidesForOverlap(uid, opts?.forcePassengerCache ? { force: true } : {}),
  ]);
  const ownerIds = new Set(ownerList.map((r) => r.id));
  const entries: TripLedgerEntry[] = [];
  for (const ride of ownerList) {
    entries.push(...ownerLedgerEntries(ride));
  }
  for (const ride of passengerList) {
    if (ownerIds.has(ride.id)) continue;
    entries.push(...passengerLedgerForRide(ride, uid));
  }
  entries.sort((a, b) => b.at - a.at);
  return buildAggregate(entries);
}

/**
 * Signed-in viewer’s own profile: full ledger from `/my-rides` + `/rides/booked`.
 * Another user’s profile: GET public summary (`/users/:id/trips-summary` or `/trips/summary/:id`).
 */
export async function fetchTripsForProfileSubject(
  subjectUserId: string,
  viewerUserId: string | undefined,
  opts?: { forcePassengerCache?: boolean }
): Promise<UserTripsAggregate> {
  const sid = subjectUserId.trim();
  if (!sid) return buildAggregate([]);
  if (userIdsMatch(viewerUserId, sid)) {
    return fetchUserTripsAggregate(sid, opts);
  }
  return fetchPublicUserTripsSummary(sid);
}
