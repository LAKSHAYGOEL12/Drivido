/**
 * In-memory cache + in-flight dedupe for GET /api/rides/:id.
 * - Stale time: skip network if loaded recently (same session).
 * - Same ride requested twice at once → one HTTP call.
 * - After stale: sends If-None-Match when server returned ETag → 304 saves JSON.
 *
 * Cache keys are rideId + viewer userId so User A’s response is never reused for User B
 * after logout/login (ETag/304 must not return another viewer’s JSON).
 */
import { API } from '../constants/API';
import { getJsonWithEtag } from './api';

/** If we fetched this ride within this window, reuse cache (same session). */
export const RIDE_DETAIL_STALE_MS = 45_000;

type Entry = { data: unknown; etag: string | null; fetchedAt: number };

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();

/** Cache key: same ride for different logged-in users must not share entries. */
function detailCacheKey(rideId: string, viewerUserId: string): string {
  const uid = (viewerUserId ?? '').trim() || 'anon';
  return `${rideId}::${uid}`;
}

export function invalidateRideDetailCache(rideId: string): void {
  const prefix = `${rideId}::`;
  for (const k of [...cache.keys()]) {
    if (k === rideId || k.startsWith(prefix)) {
      cache.delete(k);
    }
  }
  for (const k of [...inFlight.keys()]) {
    if (k === rideId || k.startsWith(prefix)) {
      inFlight.delete(k);
    }
  }
}

/** Clear all cached ride details — call on logout / account switch. */
export function clearRideDetailCache(): void {
  cache.clear();
  inFlight.clear();
}

export async function fetchRideDetailRaw(
  rideId: string,
  opts?: { force?: boolean; viewerUserId?: string }
): Promise<unknown> {
  const viewerUserId = (opts?.viewerUserId ?? '').trim();
  const key = detailCacheKey(rideId, viewerUserId);

  if (!opts?.force) {
    const c = cache.get(key);
    if (c && Date.now() - c.fetchedAt < RIDE_DETAIL_STALE_MS) {
      return c.data;
    }
  }

  let p = inFlight.get(key);
  if (!p) {
    p = (async () => {
      try {
        return await loadRideDetail(rideId, key, opts);
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, p);
  }
  return p;
}

async function loadRideDetail(
  rideId: string,
  cacheKey: string,
  opts?: { force?: boolean; viewerUserId?: string }
): Promise<unknown> {
  const path = API.endpoints.rides.detail(rideId);
  const entry = cache.get(cacheKey);

  const extraHeaders =
    opts?.force || !entry?.etag ? undefined : { 'If-None-Match': entry.etag };

  const result = await getJsonWithEtag<unknown>(path, extraHeaders);

  if (result.status === 304) {
    if (entry) {
      cache.set(cacheKey, {
        data: entry.data,
        etag: result.etag ?? entry.etag,
        fetchedAt: Date.now(),
      });
      return entry.data;
    }
    throw new Error('Server returned 304 but no cached ride detail');
  }

  cache.set(cacheKey, {
    data: result.data,
    etag: result.etag,
    fetchedAt: Date.now(),
  });
  return result.data;
}
