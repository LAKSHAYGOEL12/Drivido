/**
 * Contract for POST /bookings when the user already has a conflicting booking
 * (same route + overlapping time window). Backend should enforce; app maps this to the same UX as the client-side guard.
 */

/** Preferred: JSON body `{ code: "BOOKING_ROUTE_TIME_OVERLAP", message?: string }` with HTTP 409. */
export const BOOKING_ROUTE_TIME_OVERLAP_CODE = 'BOOKING_ROUTE_TIME_OVERLAP';

/** POST /bookings retry cooldown (HTTP 429). */
export const BOOKING_RETRY_COOLDOWN_CODE = 'BOOKING_RETRY_COOLDOWN';

/** Instant book seat cap (HTTP 409). */
export const INSUFFICIENT_SEATS_CODE = 'INSUFFICIENT_SEATS';

export const INVALID_PREVIOUS_BOOKING_CODE = 'INVALID_PREVIOUS_BOOKING';

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

export function pickApiErrorCode(e: unknown): string {
  if (!e || typeof e !== 'object') return '';
  const data = (e as ApiThrownError).data;
  if (data && typeof data === 'object') {
    return String((data as Record<string, unknown>).code ?? '').trim();
  }
  return '';
}

export function pickCooldownEndsAtFromError(e: unknown): string | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const data = (e as ApiThrownError).data;
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Record<string, unknown>;
  const raw = d.cooldownEndsAt ?? d.cooldown_ends_at;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

export function isBookingRetryCooldownError(e: unknown): boolean {
  const err = e as ApiThrownError;
  return err.status === 429 && pickApiErrorCode(e) === BOOKING_RETRY_COOLDOWN_CODE;
}

export function isInsufficientSeatsBookingError(e: unknown): boolean {
  const err = e as ApiThrownError;
  return err.status === 409 && pickApiErrorCode(e) === INSUFFICIENT_SEATS_CODE;
}

export function isInvalidPreviousBookingError(e: unknown): boolean {
  return pickApiErrorCode(e) === INVALID_PREVIOUS_BOOKING_CODE;
}

export function bookingRetryCooldownUserMessage(e: unknown): string {
  const body = pickApiErrorBodyMessage(e);
  const until = pickCooldownEndsAtFromError(e);
  if (until) {
    const t = Date.parse(until);
    if (!Number.isNaN(t)) {
      const diff = t - Date.now();
      if (diff > 0) {
        const mins = Math.ceil(diff / 60000);
        if (mins < 60) {
          return body ?? `You can try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
        }
        const h = Math.ceil(mins / 60);
        return body ?? `You can try again in about ${h} hour${h === 1 ? '' : 's'}.`;
      }
    }
  }
  return body ?? 'Please wait before requesting again.';
}
