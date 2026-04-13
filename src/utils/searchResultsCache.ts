import type { RideListItem } from '../types/api';

/** Stale-while-revalidate: show cached results while refetching (reduces skeleton time on repeat searches). */
const TTL_MS = 90_000;
const MAX_ENTRIES = 16;

type CacheEntry = {
  rides: RideListItem[];
  myConfirmedIds: string[];
  storedAt: number;
};

const store = new Map<string, CacheEntry>();

export function searchResultsCacheKey(args: {
  searchFrom: string;
  searchTo: string;
  searchDate: string;
  searchPassengers: string;
  fromLat?: number;
  fromLon?: number;
  toLat?: number;
  toLon?: number;
}): string {
  return [
    args.searchFrom.trim().toLowerCase(),
    args.searchTo.trim().toLowerCase(),
    args.searchDate,
    args.searchPassengers,
    args.fromLat ?? '',
    args.fromLon ?? '',
    args.toLat ?? '',
    args.toLon ?? '',
  ].join('\t');
}

export function getSearchResultsCache(key: string): CacheEntry | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() - e.storedAt > TTL_MS) {
    store.delete(key);
    return null;
  }
  return e;
}

export function setSearchResultsCache(
  key: string,
  rides: RideListItem[],
  myConfirmedIds: Iterable<string>
): void {
  while (store.size >= MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of store) {
      if (v.storedAt < oldestAt) {
        oldestAt = v.storedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) store.delete(oldestKey);
    else break;
  }
  store.set(key, {
    rides,
    myConfirmedIds: [...myConfirmedIds],
    storedAt: Date.now(),
  });
}
