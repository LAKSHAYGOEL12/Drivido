import type { RideListItem } from '../types/api';

function firstNonEmptyString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '') return c.trim();
  }
  return undefined;
}

/**
 * Encoded route polyline from GET ride payloads. Prefer API `routePolylineEncoded` / `route_polyline_encoded`.
 * Legacy keys are still read for older documents until data is migrated.
 */
export function pickRoutePolylineEncodedFromRecord(r: Record<string, unknown>): string | undefined {
  return firstNonEmptyString(
    r.routePolylineEncoded,
    r.route_polyline_encoded,
    r.selectedRoutePolylineEncoded,
    r.selected_route_polyline_encoded,
    r.routeOverviewPolyline,
    r.route_overview_polyline
  );
}

export function pickRoutePolylineEncoded(ride: RideListItem): string | undefined {
  return pickRoutePolylineEncodedFromRecord(ride as Record<string, unknown>);
}

/** Use before merging polyline from `route.params` so tab/partial navigations do not wipe state when the key was omitted. */
export function routeParamsIncludePolylineField(p: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(p, 'routePolylineEncoded') ||
    Object.prototype.hasOwnProperty.call(p, 'route_polyline_encoded') ||
    Object.prototype.hasOwnProperty.call(p, 'selectedRoutePolylineEncoded') ||
    Object.prototype.hasOwnProperty.call(p, 'selected_route_polyline_encoded') ||
    Object.prototype.hasOwnProperty.call(p, 'routeOverviewPolyline') ||
    Object.prototype.hasOwnProperty.call(p, 'route_overview_polyline')
  );
}

/** Coordinates the publisher saved for pickup → drop-off (for maps / directions). */
export function getPublisherRouteCoords(ride: RideListItem): {
  pickupLatitude: number;
  pickupLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
} | null {
  const pLat = ride.pickupLatitude;
  const pLon = ride.pickupLongitude;
  const dLat = ride.destinationLatitude;
  const dLon = ride.destinationLongitude;
  if (
    typeof pLat !== 'number' ||
    typeof pLon !== 'number' ||
    typeof dLat !== 'number' ||
    typeof dLon !== 'number' ||
    !Number.isFinite(pLat) ||
    !Number.isFinite(pLon) ||
    !Number.isFinite(dLat) ||
    !Number.isFinite(dLon)
  ) {
    return null;
  }
  if (pLat === 0 && pLon === 0 && dLat === 0 && dLon === 0) return null;
  return {
    pickupLatitude: pLat,
    pickupLongitude: pLon,
    destinationLatitude: dLat,
    destinationLongitude: dLon,
  };
}
