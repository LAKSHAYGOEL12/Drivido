/**
 * Google Places Autocomplete (legacy) for address suggestions.
 * In Google Cloud Console, enable "Places API" for the same key used for Maps
 * (EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY). Otherwise suggestions will stay empty.
 */
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
  if (trimmed.length < 2 || !API_KEY) return [];

  try {
    const tokenPart = opts?.sessionToken ? `&sessiontoken=${encodeURIComponent(opts.sessionToken)}` : '';
    const url =
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(trimmed)}&key=${API_KEY}` +
      tokenPart;
    const res = await fetch(url);
    const data = await res.json();
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
  return geocodeInternal(address, { restrictCountry: 'IN' });
}

/**
 * Same as {@link geocodeAddress}, then if needed appends `", India"` and retries (helps very short queries).
 * If those fail, one last try without country filter (full address pasted by user).
 */
export async function geocodeAddressWithFallbacks(address: string): Promise<PlaceCoords | null> {
  const trimmed = address?.trim() || '';
  if (!trimmed) return null;

  const first = await geocodeInternal(trimmed, { restrictCountry: 'IN' });
  if (first) return first;

  const alreadyHasIndia = /,\s*india\b/i.test(trimmed);
  if (!alreadyHasIndia) {
    const second = await geocodeInternal(`${trimmed}, India`, { restrictCountry: 'IN' });
    if (second) return second;
  }

  const last = await geocodeInternal(trimmed, { restrictCountry: null });
  if (__DEV__ && !last) {
    console.warn(
      '[Geocode] all attempts failed for:',
      trimmed.length > 40 ? `${trimmed.slice(0, 37)}…` : trimmed,
      '→ ride search will use TEXT matching only (no map distance rules).'
    );
  }
  return last;
}

type GeocodeOpts = { restrictCountry: string | null };

async function geocodeInternal(address: string, opts: GeocodeOpts): Promise<PlaceCoords | null> {
  const trimmed = address?.trim() || '';
  if (!trimmed) {
    if (__DEV__) console.log('[Geocode] skipped — empty address');
    return null;
  }
  if (!API_KEY) {
    if (__DEV__) {
      console.warn(
        '[Geocode] NOT WORKING — EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY is empty. Set it in .env and run: npx expo start --clear'
      );
    }
    return null;
  }
  try {
    let url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(trimmed)}&key=${API_KEY}`;
    if (opts.restrictCountry) {
      url += `&components=country:${encodeURIComponent(opts.restrictCountry)}`;
    }
    const res = await fetch(url);
    const data = (await res.json()) as {
      status?: string;
      error_message?: string;
      results?: { geometry?: { location?: { lat: number; lng: number } } }[];
    };
    const status = data.status ?? 'UNKNOWN';
    const loc = data.results?.[0]?.geometry?.location;

    if (status !== 'OK' || !loc) {
      if (__DEV__) {
        console.warn('[Geocode] failed', {
          query: trimmed.length > 55 ? `${trimmed.slice(0, 52)}…` : trimmed,
          countryFilter: opts.restrictCountry ?? 'off',
          status,
          error_message: data.error_message,
        });
      }
      return null;
    }

    const coords = { latitude: Number(loc.lat), longitude: Number(loc.lng) };
    if (__DEV__) {
      console.log('[Geocode] OK', {
        query: trimmed.length > 45 ? `${trimmed.slice(0, 42)}…` : trimmed,
        lat: coords.latitude.toFixed(5),
        lng: coords.longitude.toFixed(5),
      });
    }
    return coords;
  } catch (e) {
    if (__DEV__) console.warn('[Geocode] request error', e);
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
  if (!placeId || !API_KEY) return null;
  try {
    const tokenPart = opts?.sessionToken ? `&sessiontoken=${encodeURIComponent(opts.sessionToken)}` : '';
    const url =
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}` +
      `&fields=geometry,name,formatted_address&key=${API_KEY}` +
      tokenPart;
    const res = await fetch(url);
    const data = await res.json();
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
  radiusMeters = 1400
): Promise<NearbyPlace[]> {
  if (!API_KEY) return [];
  try {
    const url =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
      `?location=${latitude},${longitude}` +
      `&radius=${Math.min(Math.max(radiusMeters, 200), 5000)}` +
      `&key=${API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
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
