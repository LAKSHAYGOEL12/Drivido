import type { RideListItem } from '../types/api';

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
