import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { hasAuthAccessToken } from './api';
import { API } from '../constants/API';

const KEY = 'drivido_recent_published_v1';
const GUEST_USER_KEY = 'guest';
const MAX_ENTRIES = 3;

function scopedKey(userKey?: string): string {
  const normalized = (userKey ?? '').trim().toLowerCase();
  return `${KEY}:${normalized || GUEST_USER_KEY}`;
}

export type RecentPublishedEntry = {
  id: string;
  /** Canonical backend identity of the ride this recent row represents. */
  rideId?: string;
  pickup: string;
  destination: string;
  pickupLatitude: number;
  pickupLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  /**
   * Canonical UTC instant for the ride's departure (ISO 8601 with Z suffix).
   * When present this is the SINGLE source of truth for the displayed wall-clock
   * time — `dateYmd`, `hour`, `minute` below are derived from it in the device's
   * local timezone on every read. Kept optional for backward compatibility with
   * legacy rows written before this field existed.
   */
  scheduledAt?: string;
  /** YYYY-MM-DD in the device's local timezone (derived from `scheduledAt` when present). */
  dateYmd: string;
  /** 0–23 in the device's local timezone (derived from `scheduledAt` when present). */
  hour: number;
  /** 0–59 in the device's local timezone (derived from `scheduledAt` when present). */
  minute: number;
  seats: number;
  rate: string;
  /** Optional ride notes shown to passengers on detail screen. */
  rideDescription?: string;
  /** Canonical backend key for recent-published rows. */
  description?: string;
  instantBooking: boolean;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * Build a canonical UTC ISO instant from local wall-clock parts. Returns `undefined`
 * if the inputs aren't a valid calendar moment.
 *
 * Why it lives here: every caller has (dateYmd + hour + minute) in the device's
 * local zone; the storage layer is the one place that needs the instant. Doing
 * the conversion here keeps the three publish call sites symmetrical.
 */
function buildScheduledAtIsoFromLocal(
  dateYmd: string,
  hour: number,
  minute: number
): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd.trim());
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (!y || !mo || !da) return undefined;
  const d = new Date(y, mo - 1, da, hour, minute, 0, 0);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/**
 * Inverse of the above: given a canonical UTC ISO instant, return the wall-clock
 * parts in the DEVICE'S local timezone. This is what guarantees the round-trip
 * matches what the user saw on the clock, regardless of what timezone the server
 * was in when it echoed back (`hour`, `minute`) fields — those are intrinsically
 * zone-ambiguous and must never be trusted over `scheduledAt`.
 */
function localPartsFromIso(
  iso: string
): { dateYmd: string; hour: number; minute: number } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return {
    dateYmd: `${y}-${mo}-${da}`,
    hour: d.getHours(),
    minute: d.getMinutes(),
  };
}

function asNum(v: unknown): number | undefined {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

/** Same place: matching labels (case-insensitive) or ~same coordinates (~11 m). */
export function isSamePickupAndDestination(
  pickup: string,
  destination: string,
  pickupLatitude: number,
  pickupLongitude: number,
  destinationLatitude: number,
  destinationLongitude: number
): boolean {
  const p = pickup.trim().toLowerCase();
  const d = destination.trim().toLowerCase();
  if (p.length > 0 && p === d) return true;
  const eps = 1e-4;
  return (
    Math.abs(pickupLatitude - destinationLatitude) < eps &&
    Math.abs(pickupLongitude - destinationLongitude) < eps
  );
}

/** Normalize GET /recent-published rows (camelCase and snake_case). */
function normalizePublished(raw: unknown): RecentPublishedEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const pickup = String(r.pickup ?? r.pickup_location_name ?? '').trim();
  const destination = String(r.destination ?? r.destination_location_name ?? '').trim();
  const plat = asNum(r.pickupLatitude ?? r.pickup_latitude);
  const plon = asNum(r.pickupLongitude ?? r.pickup_longitude);
  const dlat = asNum(r.destinationLatitude ?? r.destination_latitude);
  const dlon = asNum(r.destinationLongitude ?? r.destination_longitude);
  if (!pickup || !destination) return null;
  if (plat == null || plon == null || dlat == null || dlon == null) return null;
  if (isSamePickupAndDestination(pickup, destination, plat, plon, dlat, dlon)) return null;

  /**
   * TIMEZONE-SAFE WALL CLOCK ─────────────────────────────────────────────────
   * The backend can (and today does) return `hour`/`minute`/`dateYmd` derived
   * from `scheduledAt` in its own timezone (usually UTC on a Node server),
   * which does NOT match the user's local wall clock. If the server echoes a
   * canonical instant via `scheduledAt`, ALWAYS re-derive wall-clock parts
   * from it using device-local getters — that is the only source of truth
   * the client can fully own.
   *
   * Fallback: for legacy rows written before this migration (no `scheduledAt`),
   * trust the sent `hour`/`minute`/`dateYmd` as a best effort. These rows age
   * out quickly given `MAX_ENTRIES = 3`.
   */
  const scheduledAtRaw = String(r.scheduledAt ?? r.scheduled_at ?? '').trim();
  let dateYmd = String(r.dateYmd ?? r.date_ymd ?? '').trim();
  let hour = Math.max(0, Math.min(23, Math.floor(Number(r.hour ?? 0))));
  let minute = Math.max(0, Math.min(59, Math.floor(Number(r.minute ?? 0))));
  let scheduledAtIso: string | undefined;
  if (scheduledAtRaw) {
    const local = localPartsFromIso(scheduledAtRaw);
    if (local) {
      dateYmd = local.dateYmd;
      hour = local.hour;
      minute = local.minute;
      scheduledAtIso = new Date(scheduledAtRaw).toISOString();
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;

  const seats = Math.max(1, Math.min(6, Math.floor(Number(r.seats)) || 1));
  return {
    id: String(r.id ?? r._id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
    rideId: String(r.rideId ?? r.ride_id ?? r.ride ?? '').trim() || undefined,
    pickup,
    destination,
    pickupLatitude: plat,
    pickupLongitude: plon,
    destinationLatitude: dlat,
    destinationLongitude: dlon,
    scheduledAt: scheduledAtIso,
    dateYmd,
    hour,
    minute,
    seats,
    rate: String(r.rate ?? '').trim(),
    rideDescription: String(r.rideDescription ?? r.ride_description ?? r.description ?? '').trim(),
    description: String(r.description ?? r.rideDescription ?? r.ride_description ?? '').trim(),
    instantBooking: Boolean(r.instantBooking ?? r.instant_booking),
    createdAt: String(r.createdAt ?? '').trim() || undefined,
    updatedAt: String(r.updatedAt ?? '').trim() || undefined,
  };
}

async function loadLocal(userKey?: string): Promise<RecentPublishedEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(scopedKey(userKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizePublished)
      .filter((x): x is RecentPublishedEntry => Boolean(x))
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

async function saveLocal(list: RecentPublishedEntry[], userKey?: string): Promise<void> {
  await AsyncStorage.setItem(scopedKey(userKey), JSON.stringify(list.slice(0, MAX_ENTRIES)));
}

function dedupeKeyFromSnapshot(
  e: Omit<RecentPublishedEntry, 'id'> | RecentPublishedEntry
): string {
  const canonicalRideId = (e.rideId ?? '').trim();
  if (canonicalRideId) return `ride:${canonicalRideId}`;
  return [
    e.pickup.toLowerCase(),
    e.destination.toLowerCase(),
    e.dateYmd,
    e.hour,
    e.minute,
    e.seats,
    e.rate,
    (e.rideDescription ?? e.description ?? '').trim(),
    e.instantBooking ? '1' : '0',
    e.pickupLatitude,
    e.pickupLongitude,
    e.destinationLatitude,
    e.destinationLongitude,
  ].join('|');
}

export async function loadRecentPublished(userKey?: string): Promise<RecentPublishedEntry[]> {
  const local = await loadLocal(userKey);
  if (!hasAuthAccessToken()) {
    return local;
  }
  try {
    const res = await api.get<unknown>(API.endpoints.recentPublished.list);
    const arr = Array.isArray(res)
      ? res
      : (res as { recents?: unknown[]; published?: unknown[]; data?: { recents?: unknown[] } })?.recents ??
        (res as { published?: unknown[] }).published ??
        (res as { data?: { recents?: unknown[] } })?.data?.recents ??
        [];
    const normalized = (arr as unknown[])
      .map(normalizePublished)
      .filter((x): x is RecentPublishedEntry => Boolean(x))
      .slice(0, MAX_ENTRIES);

    /**
     * SCHEDULED-AT BACKFILL (defense in depth) ────────────────────────────
     * The server is authoritative on list membership/order and most fields,
     * but the ride's departure instant is something the client computed
     * perfectly from the user's own clock tap. If the current server build
     * strips `scheduledAt` from the response (or echoes a zone-ambiguous
     * wall clock), restore the correct instant from the local cache matched
     * by `rideId` and re-derive the displayed wall clock from it.
     *
     * This means: once a ride has been locally persisted with a correct
     * `scheduledAt`, no subsequent server refresh can silently shift its
     * displayed time by a timezone offset.
     */
    const localByRide = new Map<string, RecentPublishedEntry>();
    for (const l of local) {
      if (l.rideId) localByRide.set(l.rideId, l);
    }
    const merged = normalized.map((row) => {
      if (row.scheduledAt) return row;
      const localMatch = row.rideId ? localByRide.get(row.rideId) : undefined;
      if (!localMatch?.scheduledAt) return row;
      const parts = localPartsFromIso(localMatch.scheduledAt);
      if (!parts) return row;
      return {
        ...row,
        scheduledAt: localMatch.scheduledAt,
        dateYmd: parts.dateYmd,
        hour: parts.hour,
        minute: parts.minute,
      };
    });

    await saveLocal(merged, userKey);
    return merged;
  } catch {
    return local;
  }
}

/** Add to top; dedupe identical snapshot; keep last 3. */
export async function addRecentPublished(
  entry: Omit<RecentPublishedEntry, 'id'>,
  userKey?: string
): Promise<RecentPublishedEntry[]> {
  const pickup = entry.pickup.trim();
  const destination = entry.destination.trim();
  if (!pickup || !destination || !/^\d{4}-\d{2}-\d{2}$/.test(entry.dateYmd.trim())) {
    return loadRecentPublished(userKey);
  }
  if (
    isSamePickupAndDestination(
      pickup,
      destination,
      entry.pickupLatitude,
      entry.pickupLongitude,
      entry.destinationLatitude,
      entry.destinationLongitude
    )
  ) {
    return loadRecentPublished(userKey);
  }

  const normalizedDateYmd = entry.dateYmd.trim();
  const normalizedHour = Math.max(0, Math.min(23, Math.floor(entry.hour)));
  const normalizedMinute = Math.max(0, Math.min(59, Math.floor(entry.minute)));
  /**
   * Canonical instant built from the local wall-clock the user actually picked.
   * Sent to the server so it never has to guess a zone, and stored locally so
   * an offline/guest round-trip is identical to an online one.
   */
  const scheduledAt =
    entry.scheduledAt?.trim() ||
    buildScheduledAtIsoFromLocal(normalizedDateYmd, normalizedHour, normalizedMinute);

  const snapshot: Omit<RecentPublishedEntry, 'id'> = {
    rideId: (entry.rideId ?? '').trim() || undefined,
    pickup,
    destination,
    pickupLatitude: entry.pickupLatitude,
    pickupLongitude: entry.pickupLongitude,
    destinationLatitude: entry.destinationLatitude,
    destinationLongitude: entry.destinationLongitude,
    scheduledAt,
    dateYmd: normalizedDateYmd,
    hour: normalizedHour,
    minute: normalizedMinute,
    seats: Math.max(1, Math.min(6, Math.floor(entry.seats) || 1)),
    rate: entry.rate.trim(),
    rideDescription: (entry.rideDescription ?? entry.description ?? '').trim(),
    description: (entry.description ?? entry.rideDescription ?? '').trim(),
    instantBooking: Boolean(entry.instantBooking),
  };

  const mergeLocalOnly = async (): Promise<RecentPublishedEntry[]> => {
    const list = await loadLocal(userKey);
    const key = dedupeKeyFromSnapshot(snapshot);
    const filtered = list.filter((x) => dedupeKeyFromSnapshot(x) !== key);
    const next: RecentPublishedEntry[] = [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        ...snapshot,
      },
      ...filtered,
    ].slice(0, MAX_ENTRIES);
    await saveLocal(next, userKey);
    return next;
  };

  if (!hasAuthAccessToken()) {
    return mergeLocalOnly();
  }

  /**
   * Persist the snapshot locally FIRST so its canonical `scheduledAt` is
   * available to the backfill step inside `loadRecentPublished` below. Without
   * this, the subsequent GET would see an empty local cache for the freshly
   * published ride and — if the server strips `scheduledAt` from its response —
   * would fall back to the server's zone-ambiguous hour/minute for the one
   * row that matters most to the user right now.
   */
  await mergeLocalOnly();

  /**
   * WIRE PAYLOAD (UTC-first) ──────────────────────────────────────────────
   * The backend contract is strictly `scheduledAt`-only for write. We keep
   * `dateYmd`/`hour`/`minute` in the on-disk snapshot because they're the
   * derived views used for local display, dedupe, and legacy-cache reads,
   * but they must never leak onto the wire — sending them would re-introduce
   * a timezone-ambiguous field into the request body and invite future
   * server changes to trust the wrong source again.
   */
  const wirePayload = {
    rideId: snapshot.rideId,
    pickup: snapshot.pickup,
    destination: snapshot.destination,
    pickupLatitude: snapshot.pickupLatitude,
    pickupLongitude: snapshot.pickupLongitude,
    destinationLatitude: snapshot.destinationLatitude,
    destinationLongitude: snapshot.destinationLongitude,
    scheduledAt: snapshot.scheduledAt,
    seats: snapshot.seats,
    rate: snapshot.rate,
    rideDescription: snapshot.rideDescription,
    description: snapshot.description,
    instantBooking: snapshot.instantBooking,
  };

  try {
    if (snapshot.rideId) {
      await api.put(API.endpoints.recentPublished.upsertByRide(snapshot.rideId), wirePayload);
    } else {
      await api.post(API.endpoints.recentPublished.upsert, wirePayload);
    }
    return loadRecentPublished(userKey);
  } catch {
    return mergeLocalOnly();
  }
}

export async function removeRecentPublished(id: string, userKey?: string): Promise<void> {
  if (!hasAuthAccessToken()) {
    const list = await loadLocal(userKey);
    await saveLocal(
      list.filter((x) => x.id !== id),
      userKey
    );
    return;
  }
  try {
    await api.delete(API.endpoints.recentPublished.remove(id));
  } catch {
    const list = await loadLocal(userKey);
    await saveLocal(
      list.filter((x) => x.id !== id),
      userKey
    );
  }
}

export async function clearRecentPublished(userKey?: string): Promise<void> {
  if (!hasAuthAccessToken()) {
    await AsyncStorage.removeItem(scopedKey(userKey));
    return;
  }
  try {
    await api.delete(API.endpoints.recentPublished.clear);
  } catch {
    await AsyncStorage.removeItem(scopedKey(userKey));
  }
}
