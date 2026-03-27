import api from './api';

/** Still used for direct Directions fallback flow. */
const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY || '';

export type PlacePrediction = {
  description: string;
  placeId: string;
};

export type PlaceCoords = { latitude: number; longitude: number };

export async function getPlaceSuggestions(
  input: string,
  opts?: { sessionToken?: string }
): Promise<PlacePrediction[]> {
  const trimmed = input?.trim() || '';
  if (trimmed.length < 2) return [];

  try {
    const tokenPart = opts?.sessionToken ? `&sessiontoken=${encodeURIComponent(opts.sessionToken)}` : '';
    const data = await api.get<any>(
      `/places/autocomplete?query=${encodeURIComponent(trimmed)}${tokenPart}`
    );
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') return [];
    const predictions = data.predictions || [];
    return predictions.map((p: { description: string; place_id: string }) => ({
      description: p.description,
      placeId: p.place_id,
    }));
  } catch {
    return [];
  }
}

/**
 * Geocode a free-text address to lat/lng.
 * Uses `components=country:IN` so short or ambiguous names resolve within India (no city/state hardcoding).
 *
 * Google Cloud (same key as `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` unless you split keys):
 * - Enable **Geocoding API**
 * - Billing enabled on the project
 * - For search/autocomplete: **Places API** (optional but recommended)
 */
export async function geocodeAddress(address: string): Promise<PlaceCoords | null> {
  const trimmed = address?.trim() || '';
  if (!trimmed) return null;
  try {
    const data = (await api.get<any>(
      `/places/geocode?query=${encodeURIComponent(trimmed)}`
    )) as {
      status?: string;
      results?: { geometry?: { location?: { lat: number; lng: number } } }[];
    };
    const loc = data?.results?.[0]?.geometry?.location;
    if (data?.status !== 'OK' || !loc) return null;
    const latitude = Number(loc.lat);
    const longitude = Number(loc.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  } catch {
    return null;
  }
}

/**
 * Same as {@link geocodeAddress}, then if needed appends `", India"` and retries (helps very short queries).
 * If those fail, one last try without country filter (full address pasted by user).
 */
export async function geocodeAddressWithFallbacks(address: string): Promise<PlaceCoords | null> {
  const trimmed = address?.trim() || '';
  if (!trimmed) return null;
  try {
    const data = (await api.get<any>(
      `/places/geocode-with-fallbacks?query=${encodeURIComponent(trimmed)}`
    )) as {
      status?: string;
      results?: { geometry?: { location?: { lat: number; lng: number } } }[];
    };
    const loc = data.results?.[0]?.geometry?.location;
    if (data.status !== 'OK' || !loc) {
      if (__DEV__) console.warn('[Geocode] all attempts failed for:', trimmed);
      return null;
    }
    const coords = { latitude: Number(loc.lat), longitude: Number(loc.lng) };
    if (__DEV__) console.log('[Geocode] OK', { lat: coords.latitude, lng: coords.longitude });
    return coords;
  } catch {
    return null;
  }
}

/** Get lat/lng for a place (for Publish ride coordinates). Requires Places API. */
export type PlaceDetails = {
  name: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
};

export async function getPlaceDetails(
  placeId: string,
  opts?: { sessionToken?: string }
): Promise<PlaceDetails | null> {
  if (!placeId) return null;
  try {
    const tokenPart = opts?.sessionToken ? `&sessiontoken=${encodeURIComponent(opts.sessionToken)}` : '';
    const data = await api.get<any>(
      `/places/place-details?placeId=${encodeURIComponent(placeId)}${tokenPart}`
    );
    if (data.status !== 'OK' || !data.result?.geometry?.location) return null;
    const loc = data.result.geometry.location;
    const latitude = Number(loc.lat);
    const longitude = Number(loc.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      name: String(data.result?.name ?? '').trim(),
      formattedAddress: String(data.result?.formatted_address ?? '').trim(),
      latitude,
      longitude,
    };
  } catch {
    return null;
  }
}

export async function getPlaceCoordinates(
  placeId: string,
  opts?: { sessionToken?: string }
): Promise<PlaceCoords | null> {
  const details = await getPlaceDetails(placeId, opts);
  if (!details) return null;
  return { latitude: details.latitude, longitude: details.longitude };
}

export type NearbyPlace = {
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
};

export type DirectionAlternative = {
  overviewPolyline: { latitude: number; longitude: number }[];
  distanceMeters: number;
  durationSeconds: number;
  summary: string;
};

/**
 * POIs near a point (easier pick on map). Enable Places API (Nearby Search).
 */
export async function nearbyPlaces(
  latitude: number,
  longitude: number,
  radiusMeters = 1400,
  opts?: { keyword?: string; type?: string }
): Promise<NearbyPlace[]> {
  try {
    const radius = Math.min(Math.max(radiusMeters, 200), 5000);
    const keywordPart = opts?.keyword ? `&keyword=${encodeURIComponent(opts.keyword)}` : '';
    const typePart = opts?.type ? `&type=${encodeURIComponent(opts.type)}` : '';
    const data = await api.get<any>(
      `/places/nearby?lat=${encodeURIComponent(String(latitude))}` +
        `&lng=${encodeURIComponent(String(longitude))}` +
        `&radius=${encodeURIComponent(String(radius))}` +
        keywordPart +
        typePart
    );
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') return [];
    const results = data.results || [];
    return results.slice(0, 18).map(
      (r: { place_id: string; name: string; geometry?: { location?: { lat: number; lng: number } } }) => ({
        placeId: r.place_id,
        name: r.name || 'Place',
        latitude: Number(r.geometry?.location?.lat),
        longitude: Number(r.geometry?.location?.lng),
      })
    ).filter((p: NearbyPlace) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  } catch {
    return [];
  }
}

function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
  const points: { latitude: number; longitude: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
    });
  }

  return points;
}

/**
 * Google Directions alternatives for pickup -> destination.
 * Requires Directions API enabled on same Maps key.
 */
export async function getDirectionsAlternatives(
  origin: PlaceCoords,
  destination: PlaceCoords
): Promise<DirectionAlternative[]> {
  if (!API_KEY) return [];
  try {
    const url =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${origin.latitude},${origin.longitude}` +
      `&destination=${destination.latitude},${destination.longitude}` +
      `&mode=driving` +
      `&alternatives=true` +
      `&departure_time=now` +
      `&key=${API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== 'OK' || !Array.isArray(data.routes)) return [];

    return data.routes
      .map((r: any) => {
        const leg = r?.legs?.[0];
        const poly = r?.overview_polyline?.points;
        if (!leg || !poly) return null;
        return {
          overviewPolyline: decodePolyline(String(poly)),
          distanceMeters: Number(leg?.distance?.value ?? 0),
          durationSeconds: Number(leg?.duration?.value ?? 0),
          summary: String(r?.summary ?? ''),
        } as DirectionAlternative;
      })
      .filter((x: DirectionAlternative | null): x is DirectionAlternative => Boolean(x));
  } catch {
    return [];
  }
}
