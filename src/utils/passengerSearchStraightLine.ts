import type { RideListItem } from '../types/api';
import { distanceKm, formatDistance } from './calculateDistance';

function isFiniteLatLon(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon)
  );
}

/** Ride has both endpoints with usable (non-zero) coordinates. */
export function rideHasStraightLineEndpoints(ride: RideListItem): boolean {
  const {
    pickupLatitude: pickupLat,
    pickupLongitude: pickupLon,
    destinationLatitude: destinationLat,
    destinationLongitude: destinationLon,
  } = ride;
  if (!isFiniteLatLon(pickupLat, pickupLon) || !isFiniteLatLon(destinationLat, destinationLon)) {
    return false;
  }
  if (pickupLat === 0 && pickupLon === 0) return false;
  if (destinationLat === 0 && destinationLon === 0) return false;
  return true;
}

export type PassengerSearchStraightLinePayload = {
  /** Shown under the ride pickup line (search "from" -> ride pickup). */
  pickupLine: string;
  /** Shown under the ride destination line (search "to" -> ride destination). */
  destinationLine: string;
  pickupAccessibilityLabel: string;
  destinationAccessibilityLabel: string;
};

/**
 * Straight-line (Haversine) offsets from passenger search pins to ride endpoints.
 * Returns null when either search or ride coordinates are missing.
 */
export function buildPassengerSearchStraightLinePayload(
  ride: RideListItem,
  search: {
    fromLatitude?: number;
    fromLongitude?: number;
    toLatitude?: number;
    toLongitude?: number;
  }
): PassengerSearchStraightLinePayload | null {
  if (!rideHasStraightLineEndpoints(ride)) return null;
  if (
    !isFiniteLatLon(search.fromLatitude, search.fromLongitude) ||
    !isFiniteLatLon(search.toLatitude, search.toLongitude)
  ) {
    return null;
  }

  const ridePickup = { latitude: ride.pickupLatitude!, longitude: ride.pickupLongitude! };
  const rideDestination = { latitude: ride.destinationLatitude!, longitude: ride.destinationLongitude! };
  const searchFrom = { latitude: search.fromLatitude!, longitude: search.fromLongitude! };
  const searchTo = { latitude: search.toLatitude!, longitude: search.toLongitude! };

  const pickupKm = distanceKm(searchFrom, ridePickup);
  const destinationKm = distanceKm(searchTo, rideDestination);

  const pickupText = formatDistance(pickupKm);
  const destinationText = formatDistance(destinationKm);

  return {
    pickupLine: `~${pickupText} from your start`,
    destinationLine: `~${destinationText} from your end`,
    pickupAccessibilityLabel: `Straight line, about ${pickupText} from your search start to this ride pickup.`,
    destinationAccessibilityLabel:
      `Straight line, about ${destinationText} from your search destination to this ride drop-off.`,
  };
}
