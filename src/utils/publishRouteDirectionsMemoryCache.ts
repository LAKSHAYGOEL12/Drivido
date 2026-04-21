import type { DirectionAlternative } from '../services/places';

/** Same stops: skip Directions re-fetch if we already loaded recently (avoids hammering API on every revisit). */
export const ROUTE_PREVIEW_FETCH_COOLDOWN_MS = 10 * 60 * 1000;

export type PublishRouteDirectionsCache = {
  stopsKey: string;
  fetchedAt: number;
  list: DirectionAlternative[];
  /** Last focused alternative for this `stopsKey` (restored within cooldown). */
  selectedRouteIndex: number;
};

let publishRouteDirectionsMemoryCache: PublishRouteDirectionsCache | null = null;

export function getPublishRouteDirectionsMemoryCache(): PublishRouteDirectionsCache | null {
  return publishRouteDirectionsMemoryCache;
}

export function setPublishRouteDirectionsMemoryCache(next: PublishRouteDirectionsCache): void {
  publishRouteDirectionsMemoryCache = next;
}

export function patchPublishRouteDirectionsMemoryCacheSelectedRoute(
  stopsKey: string,
  selectedRouteIndex: number
): void {
  const mem = publishRouteDirectionsMemoryCache;
  if (mem?.stopsKey === stopsKey) {
    publishRouteDirectionsMemoryCache = { ...mem, selectedRouteIndex };
  }
}

/** Call when starting an empty publish wizard (e.g. FAB new ride) so route alternatives are not reused from a prior trip. */
export function clearPublishRouteDirectionsMemoryCache(): void {
  publishRouteDirectionsMemoryCache = null;
}
