/**
 * Contract for POST /bookings when the user already has a conflicting booking
 * (same route + overlapping time window). Backend should enforce; app maps this to the same UX as the client-side guard.
 */

/** Preferred: JSON body `{ code: "BOOKING_ROUTE_TIME_OVERLAP", message?: string }` with HTTP 409. */
export const BOOKING_ROUTE_TIME_OVERLAP_CODE = 'BOOKING_ROUTE_TIME_OVERLAP';

export type ApiThrownError = Error & { status?: number; data?: unknown };

export function isRouteTimeOverlapBookingError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as ApiThrownError;
  const data = err.data;
  if (data && typeof data === 'object') {
    const code = String((data as Record<string, unknown>).code ?? '').trim();
    if (code === BOOKING_ROUTE_TIME_OVERLAP_CODE) return true;
  }
  return false;
}

/** Prefer API `data.message` for error toasts (e.g. 409 booking conflict). */
export function pickApiErrorBodyMessage(e: unknown): string | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const data = (e as ApiThrownError).data;
  if (data && typeof data === 'object') {
    const m = (data as Record<string, unknown>).message;
    if (typeof m === 'string' && m.trim()) return m.trim();
  }
  return undefined;
}
