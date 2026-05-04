import { distanceKm } from './calculateDistance';

/**
 * Per-km anchor used to compute the "fair fare" for every publish / edit flow.
 * The recommended range is then this anchor ±{@link PUBLISH_FARE_BAND_BELOW}/
 * +{@link PUBLISH_FARE_BAND_ABOVE} — a fixed ~₹70 wide band that does NOT scale with
 * distance, so a 1000 km route shows e.g. ₹2480–₹2550 instead of a confusing ₹2000–₹2500
 * spread.
 */
export const PUBLISH_FARE_BASE_PER_KM = 2.5;

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

/** Hard cap for per-seat fare input (matches {@link PublishPriceScreen}). */
export const PUBLISH_FARE_INPUT_MAX = 99999;

/**
 * Absolute lower bound for any per-seat fare. Below this is treated as a typo
 * (₹0–₹9 wouldn't even cover a 1 km ride at fuel cost) and hard-blocks Continue / Save
 * across publish, edit, and republish flows. Anything ≥ this and below
 * {@link recommendedFareRange} is shown with an amber warning but allowed.
 */
export const PUBLISH_FARE_ABSOLUTE_MIN = 10;

/** Width of the recommended fare band BELOW the per-km anchor (₹). */
export const PUBLISH_FARE_BAND_BELOW = 20;

/** Width of the recommended fare band ABOVE the per-km anchor (₹). */
export const PUBLISH_FARE_BAND_ABOVE = 50;

/**
 * @deprecated Kept for backward compatibility — alias of {@link PUBLISH_FARE_BAND_BELOW}.
 * The "below recommended but still allowed" soft band was collapsed into the recommended
 * range itself in v2 of the fare model.
 */
export const PUBLISH_FARE_MAX_BELOW_MIN_RECOMMENDED = PUBLISH_FARE_BAND_BELOW;

/**
 * @deprecated Kept for backward compatibility — alias of {@link PUBLISH_FARE_BAND_ABOVE}.
 * See {@link PUBLISH_FARE_MAX_BELOW_MIN_RECOMMENDED}.
 */
export const PUBLISH_FARE_MAX_ABOVE_MAX_RECOMMENDED = PUBLISH_FARE_BAND_ABOVE;

/**
 * Recommended fare range for a given distance. Anchored at `km × ₹2.5`, padded by
 * ₹{@link PUBLISH_FARE_BAND_BELOW} on the low side and ₹{@link PUBLISH_FARE_BAND_ABOVE}
 * on the high side. The pad is **constant**, not proportional, so the band stays
 * predictable at any distance:
 *
 * - 5 km:    anchor ₹13   → range ₹1 – ₹63
 * - 50 km:   anchor ₹125  → range ₹105 – ₹175
 * - 100 km:  anchor ₹250  → range ₹230 – ₹300
 * - 250 km:  anchor ₹625  → range ₹605 – ₹675
 * - 500 km:  anchor ₹1250 → range ₹1230 – ₹1300
 * - 1000 km: anchor ₹2500 → range ₹2480 – ₹2550
 */
export function recommendedFareRange(distanceKm: number): {
  minRecommended: number;
  maxRecommended: number;
} {
  const d = Math.max(1, Number(distanceKm) || 1);
  const anchor = Math.max(1, Math.round(d * PUBLISH_FARE_BASE_PER_KM));
  const minRecommended = Math.max(1, anchor - PUBLISH_FARE_BAND_BELOW);
  const maxRecommended = Math.min(
    PUBLISH_FARE_INPUT_MAX,
    Math.max(minRecommended + 1, anchor + PUBLISH_FARE_BAND_ABOVE)
  );
  return { minRecommended, maxRecommended };
}

/**
 * Enforced limits for publish / price.
 *
 * - **Lower bound (`minAllowed === PUBLISH_FARE_ABSOLUTE_MIN`)**: fares below ₹10 are
 *   blocked — anything that low can't cover even a single km of fuel and is virtually
 *   always a typo.
 * - **Upper bound (`maxAllowed === PUBLISH_FARE_INPUT_MAX`)**: anything up to the
 *   absolute input cap is allowed.
 *
 * The recommended band sits *inside* this allowed range. Outside the band but inside the
 * allowed range is a soft warning, not a block — driver retains full agency on either
 * side, the UI just nudges them toward the recommendation.
 *
 * UI tri-state for callers:
 * - `price < minAllowed || price > maxAllowed` → red, "Price out of range" (block).
 * - `minRecommended ≤ price ≤ maxRecommended` → green, "Great choice" (preferred).
 * - `minAllowed ≤ price < minRecommended` → amber, "Below suggested range" (warn but
 *   allow Continue / Save).
 * - `maxRecommended < price ≤ maxAllowed` → amber, "Above suggested range" (warn but
 *   allow Continue / Save).
 */
export function allowedPublishFareRange(distanceKm: number): {
  minRecommended: number;
  maxRecommended: number;
  minAllowed: number;
  maxAllowed: number;
} {
  const { minRecommended, maxRecommended } = recommendedFareRange(distanceKm);
  return {
    minRecommended,
    maxRecommended,
    minAllowed: PUBLISH_FARE_ABSOLUTE_MIN,
    maxAllowed: PUBLISH_FARE_INPUT_MAX,
  };
}
