/** Normalized check for cancelled booking (API may use canceled / cancelled). */
export function bookingIsCancelled(status: string | undefined | null): boolean {
  const s = (status ?? '').trim().toLowerCase();
  return s === 'cancelled' || s === 'canceled';
}

/**
 * When GET /bookings returns multiple rows for the same ride+user (e.g. cancelled then re-booked),
 * prefer any non-cancelled status so lists move the ride from Past → My rides.
 */
export function pickPreferredBookingStatus(statuses: string[]): string {
  const list = statuses.map((s) => (s ?? '').trim()).filter((s) => s.length > 0);
  if (list.length === 0) return '';
  const active = list.find((s) => !bookingIsCancelled(s));
  return active ?? list[list.length - 1] ?? '';
}

/** Same ride may list cancelled + active rows for one user (re-book) — use the active row for UI and cancel. */
export function pickPreferredBookingForUser<T extends { userId?: string; status?: string }>(
  bookings: T[],
  userId: string
): T | undefined {
  const uid = userId.trim();
  if (!uid) return undefined;
  const mine = bookings.filter((b) => (b.userId ?? '').trim() === uid);
  if (mine.length === 0) return undefined;
  const active = mine.find((b) => !bookingIsCancelled(b.status));
  if (active) return active;
  return mine[mine.length - 1];
}
