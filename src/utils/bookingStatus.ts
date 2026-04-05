/**
 * Driver removed this passenger from the ride — not eligible to book this ride again
 * (backend must enforce; client blocks UX). API may use canceled / removed variants.
 */
export function bookingIsCancelledByOwner(status: string | undefined | null): boolean {
  const s = (status ?? '').trim().toLowerCase();
  return (
    s === 'cancelled_by_owner' ||
    s === 'canceled_by_owner' ||
    s === 'removed_by_owner' ||
    s === 'cancelled_by_driver' ||
    s === 'canceled_by_driver'
  );
}

/** Normalized check for cancelled booking (API may use canceled / cancelled). Includes owner-initiated removal. */
export function bookingIsCancelled(status: string | undefined | null): boolean {
  const s = (status ?? '').trim().toLowerCase();
  if (bookingIsCancelledByOwner(status)) return true;
  return s === 'cancelled' || s === 'canceled';
}

/**
 * Seats that still count toward “booked” on ride cards / capacity (confirmed/accepted,
 * or partial owner-remove row that still holds seats with cancelled_by_owner).
 */
export function effectiveOccupiedSeatsFromBookingRow(b: {
  status?: string;
  seats?: number;
  /** Rare: owner removed only some seats; booking row still holds remainder. */
  ownerPartialSeatRemoval?: boolean;
}): number {
  const seats =
    typeof b.seats === 'number' && Number.isFinite(b.seats) ? Math.max(0, Math.floor(b.seats)) : 0;
  if (seats <= 0) return 0;
  const s = String(b.status ?? '').trim().toLowerCase();
  if (s === 'pending' || s === 'rejected') return 0;
  if (bookingIsCancelledByOwner(b.status)) {
    // Backend often keeps `seats` as last booked count for display after full removal — do not count toward capacity.
    if (b.ownerPartialSeatRemoval === true) return seats;
    return 0;
  }
  if (bookingIsCancelled(b.status)) return 0;
  if (s === 'confirmed' || s === 'accepted') return seats;
  return seats;
}

/** True if this booking row still holds at least one seat on the ride (for lists / detail). */
export function bookingRowHoldsOccupiedSeats(b: { status?: string; seats?: number }): boolean {
  return effectiveOccupiedSeatsFromBookingRow(b) > 0;
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
  const active =
    mine.find((b) => !bookingIsCancelled(b.status)) ??
    mine.find((b) => bookingRowHoldsOccupiedSeats(b));
  if (active) return active;
  return mine[mine.length - 1];
}

function bookingTimelineMsForHistory(b: {
  bookedAt?: string;
  status?: string;
  updatedAt?: string;
  createdAt?: string;
}): number {
  const ext = b as { bookedAt?: string; updatedAt?: string; createdAt?: string };
  const raw = ext.bookedAt ?? ext.updatedAt ?? ext.createdAt ?? '';
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function bookingSeatCountLocal(b: { seats?: number }): number {
  const raw = typeof b.seats === 'number' && Number.isFinite(b.seats) ? b.seats : 0;
  return Math.max(0, Math.floor(raw));
}

/**
 * When API sends status `cancelled` only (not `cancelled_by_owner`), infer driver/owner removal
 * from same-user history: another row still holds seats (confirmed or partial owner-remove).
 * Handles both orderings: removal row may be timestamped before or after the active row.
 */
export function bookingHistoryTreatAsCancelledByOwner(
  h: { id?: string; status?: string; seats?: number; bookedAt?: string },
  sameUserHistoryChronological: Array<{
    id?: string;
    status?: string;
    seats?: number;
    bookedAt?: string;
  }>
): boolean {
  if (bookingIsCancelledByOwner(h.status)) return true;
  if (!bookingIsCancelled(h.status)) return false;

  const hId = String(h.id ?? '').trim();
  const hMs = bookingTimelineMsForHistory(h);
  const seatsH = bookingSeatCountLocal(h);
  if (seatsH <= 0) return false;

  const REBOOK_GAP_MS = 48 * 60 * 60 * 1000;

  for (const other of sameUserHistoryChronological) {
    if (String(other.id ?? '').trim() === hId) continue;
    const s = String(other.status ?? '').trim().toLowerCase();
    const otherStillBooked =
      s === 'confirmed' ||
      s === 'accepted' ||
      (bookingIsCancelledByOwner(other.status) && bookingSeatCountLocal(other) > 0);
    if (!otherStillBooked) continue;

    const om = bookingTimelineMsForHistory(other);

    // Active row is later in time (e.g. confirmed after a cancelled snapshot).
    if (om > hMs) {
      if (om - hMs <= REBOOK_GAP_MS) return true;
      continue;
    }

    // Active row is earlier: h is often a removal record with a newer timestamp than the live booking row.
    if (om < hMs && (s === 'confirmed' || s === 'accepted')) return true;
  }

  return false;
}
