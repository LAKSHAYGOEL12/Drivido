import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import { API } from '../constants/API';

const KEY = 'drivido_recent_searches_v1';
const GUEST_USER_KEY = 'guest';

function scopedKey(userKey?: string): string {
  const normalized = (userKey ?? '').trim().toLowerCase();
  return `${KEY}:${normalized || GUEST_USER_KEY}`;
}

export type RecentSearchEntry = {
  id: string;
  from: string;
  to: string;
  date: string;
  passengers: string;
  fromLatitude?: number;
  fromLongitude?: number;
  toLatitude?: number;
  toLongitude?: number;
};

function asNum(v: unknown): number | undefined {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

function normalizeRecent(raw: unknown): RecentSearchEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const from = String(r.from ?? '').trim();
  const to = String(r.to ?? '').trim();
  const date = String(r.date ?? '').trim();
  if (!from || !to || !date) return null;
  return {
    id: String(r.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
    from,
    to,
    date,
    passengers: String(r.passengers ?? '1'),
    fromLatitude: asNum(r.fromLatitude),
    fromLongitude: asNum(r.fromLongitude),
    toLatitude: asNum(r.toLatitude),
    toLongitude: asNum(r.toLongitude),
  };
}

async function loadLocal(userKey?: string): Promise<RecentSearchEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(scopedKey(userKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentSearchEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
  } catch {
    return [];
  }
}

async function saveLocal(list: RecentSearchEntry[], userKey?: string): Promise<void> {
  await AsyncStorage.setItem(scopedKey(userKey), JSON.stringify(list.slice(0, 3)));
}

export async function loadRecentSearches(userKey?: string): Promise<RecentSearchEntry[]> {
  const local = await loadLocal(userKey);
  try {
    const res = await api.get<unknown>(API.endpoints.recentSearches.list);
    const arr = Array.isArray(res)
      ? res
      : (res as { recents?: unknown[]; data?: { recents?: unknown[] } })?.recents ??
        (res as { recents?: unknown[]; data?: { recents?: unknown[] } })?.data?.recents ??
        [];
    const normalized = (arr as unknown[])
      .map(normalizeRecent)
      .filter((x): x is RecentSearchEntry => Boolean(x))
      .slice(0, 3);
    await saveLocal(normalized, userKey);
    return normalized;
  } catch {
    return local;
  }
}

/** Add to top; dedupe same route+date; keep last 3. */
export async function addRecentSearch(
  entry: Omit<RecentSearchEntry, 'id'>,
  userKey?: string
): Promise<RecentSearchEntry[]> {
  try {
    // Frontend de-dupe: don't call backend if the same recent already exists locally.
    // This prevents the "same from/to again" action from creating additional rows.
    const local = await loadLocal(userKey);
    const fromN = entry.from.trim().toLowerCase();
    const toN = entry.to.trim().toLowerCase();
    const paxN = String(entry.passengers ?? '1').trim();
    const alreadyExists = local.some((x) => {
      const xf = x.from.trim().toLowerCase();
      const xt = x.to.trim().toLowerCase();
      return xf === fromN && xt === toN && String(x.passengers ?? '1').trim() === paxN;
    });
    if (alreadyExists) return local;

    await api.post(API.endpoints.recentSearches.upsert, entry);
    return loadRecentSearches(userKey);
  } catch {
    const list = await loadLocal(userKey);
    // Local fallback de-dupe should not depend on date; user wants "same route" to stay one row.
    const dedupeKey = `${entry.from.trim().toLowerCase()}|${entry.to.trim().toLowerCase()}|${String(entry.passengers ?? '1').trim()}`;
    const filtered = list.filter(
      (x) =>
        `${x.from.trim().toLowerCase()}|${x.to.trim().toLowerCase()}|${String(x.passengers ?? '1').trim()}` !== dedupeKey
    );
    const next: RecentSearchEntry[] = [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        ...entry,
      },
      ...filtered,
    ].slice(0, 3);
    await saveLocal(next, userKey);
    return next;
  }
}

export async function removeRecentSearch(id: string, userKey?: string): Promise<void> {
  try {
    await api.delete(API.endpoints.recentSearches.remove(id));
  } catch {
    const list = await loadLocal(userKey);
    await saveLocal(
      list.filter((x) => x.id !== id),
      userKey
    );
  }
}

export async function clearRecentSearches(userKey?: string): Promise<void> {
  try {
    await api.delete(API.endpoints.recentSearches.clear);
  } catch {
    await AsyncStorage.removeItem(scopedKey(userKey));
  }
}
