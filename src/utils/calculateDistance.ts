/**
 * Haversine distance between two lat/lng points. Returns human-readable string or number in km.
 */

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Distance in kilometres between two coordinates.
 */
export function distanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
): number {
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Format distance for display. 2.5 → "2.5 km", 0.3 → "300 m"
 */
export function formatDistance(km: number): string {
  if (km < 1) {
    const m = Math.round(km * 1000);
    return `${m} m`;
  }
  const value = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
  return `${value} km`;
}

/**
 * Lat/lng → "2.5 km" (convenience: distance + format)
 */
export function calculateDistance(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
): string {
  return formatDistance(distanceKm(from, to));
}
