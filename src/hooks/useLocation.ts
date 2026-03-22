import { useCallback, useMemo } from 'react';
import { useLocation as useLocationContext } from '../contexts/LocationContext';
import type { LocationCoords } from '../contexts/LocationContext';

const EARTH_RADIUS_KM = 6371;

/**
 * Haversine distance in km between two points.
 */
function distanceKm(a: LocationCoords, b: LocationCoords): number {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/**
 * GPS state from LocationContext + geofencing helpers.
 */
export function useLocation() {
  const ctx = useLocationContext();

  const isWithinRadius = useCallback(
    (center: LocationCoords, radiusKm: number): boolean => {
      if (!ctx.location) return false;
      return distanceKm(ctx.location, center) <= radiusKm;
    },
    [ctx.location]
  );

  const distanceFrom = useCallback(
    (point: LocationCoords): number | null => {
      if (!ctx.location) return null;
      return distanceKm(ctx.location, point);
    },
    [ctx.location]
  );

  const helpers = useMemo(
    () => ({
      isWithinRadius,
      distanceFrom,
      distanceKm,
    }),
    [isWithinRadius, distanceFrom]
  );

  return {
    ...ctx,
    ...helpers,
  };
}

export type { LocationCoords } from '../contexts/LocationContext';
