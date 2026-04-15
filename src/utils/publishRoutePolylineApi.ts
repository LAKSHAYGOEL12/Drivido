import { getDirectionsAlternatives } from '../services/places';
import { isPublishStopsComplete } from './publishFare';
import { encodePolyline, normalizeEncodedPolyline } from './routePolyline';

/**
 * Builds `{ routePolylineEncoded }` for POST /rides (and PATCH when you add route updates).
 * Callers merge this into the body so Mongo and GET ride detail can expose the same line.
 * Uses an existing encoded line from the publish flow when present; otherwise one Directions request.
 */
export async function buildRidePolylinePersistPayload(opts: {
  existingEncoded: string | null | undefined;
  pickupLocationName: string;
  destinationLocationName: string;
  pickupLatitude: number;
  pickupLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
}): Promise<{ routePolylineEncoded: string } | Record<string, never>> {
  const fromExisting = normalizeEncodedPolyline(
    typeof opts.existingEncoded === 'string' ? opts.existingEncoded : undefined
  );
  if (fromExisting) return { routePolylineEncoded: fromExisting };

  if (
    !isPublishStopsComplete({
      selectedFrom: opts.pickupLocationName,
      selectedTo: opts.destinationLocationName,
      pickupLatitude: opts.pickupLatitude,
      pickupLongitude: opts.pickupLongitude,
      destinationLatitude: opts.destinationLatitude,
      destinationLongitude: opts.destinationLongitude,
    })
  ) {
    return {};
  }

  const alts = await getDirectionsAlternatives(
    { latitude: opts.pickupLatitude, longitude: opts.pickupLongitude },
    { latitude: opts.destinationLatitude, longitude: opts.destinationLongitude },
    { alternatives: false }
  );
  const first = alts[0];
  const fromGoogle = normalizeEncodedPolyline(first?.overviewPolylineEncoded);
  if (fromGoogle) return { routePolylineEncoded: fromGoogle };
  const pts = first?.overviewPolyline;
  if (!pts?.length) return {};
  const enc = normalizeEncodedPolyline(encodePolyline(pts));
  if (!enc) return {};
  return { routePolylineEncoded: enc };
}
