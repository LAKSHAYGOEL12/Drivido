/**
 * Reduces redundant GET /chat/messages calls when users open/close chat quickly.
 * Module-level state — keyed by thread key from chat-storage `threadKey(rideId, userId, otherId)`.
 */

const lastSuccessfulFetchAt = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();

/** Skip refetch if we successfully loaded this thread within this window. */
export const THREAD_MESSAGES_FETCH_TTL_MS = 45_000;

export function shouldSkipThreadMessagesFetch(threadKey: string, now: number = Date.now()): boolean {
  const last = lastSuccessfulFetchAt.get(threadKey) ?? 0;
  return last > 0 && now - last < THREAD_MESSAGES_FETCH_TTL_MS;
}

export function markThreadMessagesFetchedOk(threadKey: string, now: number = Date.now()): void {
  lastSuccessfulFetchAt.set(threadKey, now);
}

/** If a fetch for this thread is already running, await it instead of starting another. */
export function getInFlightThreadFetch(threadKey: string): Promise<void> | undefined {
  return inFlight.get(threadKey);
}

export function setInFlightThreadFetch(threadKey: string, p: Promise<void>): void {
  inFlight.set(threadKey, p);
}

export function clearInFlightThreadFetch(threadKey: string): void {
  inFlight.delete(threadKey);
}
