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
  pickup: string;
  destination: string;
  pickupLatitude: number;
  pickupLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  /** YYYY-MM-DD */
  dateYmd: string;
  hour: number;
  minute: number;
  seats: number;
  rate: string;
  instantBooking: boolean;
};

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
  const dateYmd = String(r.dateYmd ?? r.date_ymd ?? '').trim();
  if (!pickup || !destination || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
  const plat = asNum(r.pickupLatitude ?? r.pickup_latitude);
  const plon = asNum(r.pickupLongitude ?? r.pickup_longitude);
  const dlat = asNum(r.destinationLatitude ?? r.destination_latitude);
  const dlon = asNum(r.destinationLongitude ?? r.destination_longitude);
  if (plat == null || plon == null || dlat == null || dlon == null) return null;
  if (isSamePickupAndDestination(pickup, destination, plat, plon, dlat, dlon)) return null;
  const hour = Math.max(0, Math.min(23, Math.floor(Number(r.hour ?? 0))));
  const minute = Math.max(0, Math.min(59, Math.floor(Number(r.minute ?? 0))));
  const seats = Math.max(1, Math.min(6, Math.floor(Number(r.seats)) || 1));
  return {
    id: String(r.id ?? r._id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
    pickup,
    destination,
    pickupLatitude: plat,
    pickupLongitude: plon,
    destinationLatitude: dlat,
    destinationLongitude: dlon,
    dateYmd,
    hour,
    minute,
    seats,
    rate: String(r.rate ?? '').trim(),
    instantBooking: Boolean(r.instantBooking ?? r.instant_booking),
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
  return [
    e.pickup.toLowerCase(),
    e.destination.toLowerCase(),
    e.dateYmd,
    e.hour,
    e.minute,
    e.seats,
    e.rate,
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
    await saveLocal(normalized, userKey);
    return normalized;
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

  const snapshot: Omit<RecentPublishedEntry, 'id'> = {
    pickup,
    destination,
    pickupLatitude: entry.pickupLatitude,
    pickupLongitude: entry.pickupLongitude,
    destinationLatitude: entry.destinationLatitude,
    destinationLongitude: entry.destinationLongitude,
    dateYmd: entry.dateYmd.trim(),
    hour: Math.max(0, Math.min(23, Math.floor(entry.hour))),
    minute: Math.max(0, Math.min(59, Math.floor(entry.minute))),
    seats: Math.max(1, Math.min(6, Math.floor(entry.seats) || 1)),
    rate: entry.rate.trim(),
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

  try {
    const local = await loadLocal(userKey);
    const key = dedupeKeyFromSnapshot(snapshot);
    const alreadyExists = local.some((x) => dedupeKeyFromSnapshot(x) === key);
    if (alreadyExists) {
      return local;
    }

    await api.post(API.endpoints.recentPublished.upsert, snapshot);
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
