export type LatLngPoint = { latitude: number; longitude: number };

/** Match Ride schema maxlength for encoded route polylines (`routePolylineEncoded`). */
const MAX_ENCODED_POLYLINE_CHARS = 16384;

export function normalizeEncodedPolyline(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (!v) return undefined;
  if (v.length > MAX_ENCODED_POLYLINE_CHARS) return undefined;
  return v;
}

export function decodePolyline(encoded: string): LatLngPoint[] {
  const points: LatLngPoint[] = [];
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

export function encodePolyline(points: LatLngPoint[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let result = '';

  const encodeSigned = (num: number): string => {
    let v = num < 0 ? ~(num << 1) : num << 1;
    let out = '';
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
    return out;
  };

  for (const p of points) {
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
    const lat = Math.round(p.latitude * 1e5);
    const lng = Math.round(p.longitude * 1e5);
    const dLat = lat - lastLat;
    const dLng = lng - lastLng;
    result += encodeSigned(dLat);
    result += encodeSigned(dLng);
    lastLat = lat;
    lastLng = lng;
  }

  return result;
}
