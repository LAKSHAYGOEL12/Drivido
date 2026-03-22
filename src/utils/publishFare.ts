import { distanceKm } from './calculateDistance';

/** Same rules as {@link PublishPriceScreen} — keep in sync for “estimated fare” copy. */
export const PUBLISH_FARE_BASE_PER_KM = 2;

function validLat(v: number): boolean {
  return typeof v === 'number' && !Number.isNaN(v) && v >= -90 && v <= 90;
}
function validLon(v: number): boolean {
  return typeof v === 'number' && !Number.isNaN(v) && v >= -180 && v <= 180;
}

/** Stable key for comparing pickup/destination coords (avoids ref vs state float string mismatches). */
export function publishStopsCoordKey(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): string {
  return [lat1, lon1, lat2, lon2].map((n) => Number(n.toFixed(6))).join(',');
}

/** Non-empty pickup & destination names plus valid, non-zero coordinates (publish / price flows). */
export function isPublishStopsComplete(params: {
  selectedFrom?: string;
  selectedTo?: string;
  pickupLatitude?: number;
  pickupLongitude?: number;
  destinationLatitude?: number;
  destinationLongitude?: number;
}): boolean {
  if (!params.selectedFrom?.trim() || !params.selectedTo?.trim()) return false;
  const lat1 = params.pickupLatitude;
  const lon1 = params.pickupLongitude;
  const lat2 = params.destinationLatitude;
  const lon2 = params.destinationLongitude;
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return false;
  const pickupSet = (lat1 !== 0 || lon1 !== 0) && validLat(lat1) && validLon(lon1);
  const destinationSet = (lat2 !== 0 || lon2 !== 0) && validLat(lat2) && validLon(lon2);
  return pickupSet && destinationSet;
}

/**
 * Straight-line km between pickup and destination when coordinates are set (publish flow).
 * Returns null if coords are missing or invalid (e.g. still 0,0).
 */
export function straightLineKmBetweenStops(params: {
  pickupLatitude?: number;
  pickupLongitude?: number;
  destinationLatitude?: number;
  destinationLongitude?: number;
}): number | null {
  const lat1 = params.pickupLatitude;
  const lon1 = params.pickupLongitude;
  const lat2 = params.destinationLatitude;
  const lon2 = params.destinationLongitude;
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  if (!validLat(lat1) || !validLon(lon1) || !validLat(lat2) || !validLon(lon2)) return null;
  if ((lat1 === 0 && lon1 === 0) || (lat2 === 0 && lon2 === 0)) return null;
  const km = distanceKm(
    { latitude: lat1, longitude: lon1 },
    { latitude: lat2, longitude: lon2 }
  );
  return Math.max(0.1, Math.round(km * 10) / 10);
}

/**
 * Distance to use for fare recommendations: prefers Directions/road km from the flow when plausible;
 * if merged navigation params are stale vs current coords, falls back to straight-line km.
 */
export function effectivePublishDistanceKm(params: {
  selectedDistanceKm?: number;
  pickupLatitude?: number;
  pickupLongitude?: number;
  destinationLatitude?: number;
  destinationLongitude?: number;
  /**
   * When set (e.g. Directions / confirmed price flow), trust `selectedDistanceKm` and skip the
   * “stale merged param” heuristic so reopening the price screen doesn’t fall back to straight-line km.
   */
  preferStoredRouteDistance?: boolean;
}): number {
  const straight = straightLineKmBetweenStops(params);
  const raw = params.selectedDistanceKm;
  const passed = typeof raw === 'number' && !Number.isNaN(raw) && raw > 0 ? raw : null;

  if (straight != null && passed != null) {
    if (params.preferStoredRouteDistance) {
      return Math.max(1, Math.round(passed * 10) / 10);
    }
    // Road distance is usually >= straight-line; tiny merged values vs current coords are stale.
    if (passed < straight * 0.65) return Math.max(1, straight);
    return Math.max(1, Math.round(passed * 10) / 10);
  }
  if (straight != null) return Math.max(1, straight);
  if (passed != null) return Math.max(1, Math.round(passed * 10) / 10);
  return 1;
}

export function recommendedFareRange(distanceKm: number): {
  minRecommended: number;
  maxRecommended: number;
} {
  const d = Math.max(1, Number(distanceKm) || 1);
  const minRecommended = Math.max(10, Math.round(d * PUBLISH_FARE_BASE_PER_KM));
  const maxRecommended = Math.max(minRecommended + 5, Math.round(d * 2.5));
  return { minRecommended, maxRecommended };
}
