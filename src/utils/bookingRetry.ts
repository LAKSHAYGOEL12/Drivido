import { bookingIsAcceptedLike, bookingIsPendingLike } from './bookingStatus';
import type { RideListItem } from '../types/api';

type BookingRow = NonNullable<RideListItem['bookings']>[number];

function rowTimeMs(b: BookingRow): number {
  const raw = b.updatedAt ?? (b as { updated_at?: string }).updated_at ?? b.bookedAt;
  const t = new Date(String(raw ?? '').trim()).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function isActiveBookingAttempt(status: string | undefined): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  return bookingIsPendingLike(s) || bookingIsAcceptedLike(s);
}

/**
 * Id of the viewer's most recent terminal (non-active) booking row on this ride, for `previousBookingId`
 * on POST /bookings. Backend validates. Returns undefined if the latest row is still active.
 */
export function pickPreviousBookingIdForRetry(rows: BookingRow[] | undefined, userId: string): string | undefined {
  const uid = userId.trim();
  if (!uid || !rows?.length) return undefined;
  const mine = rows.filter((b) => (b.userId ?? '').trim() === uid);
  if (mine.length === 0) return undefined;
  mine.sort((a, b) => rowTimeMs(b) - rowTimeMs(a));
  const latest = mine[0];
  if (!latest?.id?.trim()) return undefined;
  if (isActiveBookingAttempt(latest.status)) return undefined;
  return latest.id.trim();
}
