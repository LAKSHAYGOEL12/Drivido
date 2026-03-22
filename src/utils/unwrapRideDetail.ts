import type { RideListItem } from '../types/api';

/**
 * Extract a ride object from GET /rides/:id (or similar) JSON for navigation / chat.
 * Mirrors the candidate resolution used in RideDetailScreen.
 */
export function unwrapRideFromDetailResponse(res: unknown): RideListItem | null {
  if (!res || typeof res !== 'object') return null;
  const root = res as Record<string, unknown>;
  const candidate =
    (root.ride && typeof root.ride === 'object' ? (root.ride as Record<string, unknown>) : null) ??
    (root.data && typeof root.data === 'object'
      ? (((root.data as Record<string, unknown>).ride &&
          typeof (root.data as Record<string, unknown>).ride === 'object')
          ? ((root.data as Record<string, unknown>).ride as Record<string, unknown>)
          : (root.data as Record<string, unknown>))
      : null) ??
    root;
  if (!candidate || typeof candidate !== 'object') return null;
  const raw = candidate as Record<string, unknown>;
  const idRaw = raw.id ?? raw._id;
  const id = typeof idRaw === 'string' ? idRaw : idRaw != null ? String(idRaw) : '';
  if (!id.trim()) return null;
  const list = Array.isArray(raw.bookings)
    ? (raw.bookings as NonNullable<RideListItem['bookings']>)
    : [];
  return {
    ...(candidate as unknown as RideListItem),
    id,
    bookings: list,
  };
}
