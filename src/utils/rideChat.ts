import type { RideListItem } from '../types/api';
import { pickPreferredBookingForUser } from './bookingStatus';

/**
 * Chat is tied to a single ride; when the ride (or the viewer’s booking) is completed,
 * sending new messages should stop. History stays readable.
 */
export function isRideCompletedForChat(ride: RideListItem, viewerUserId: string): boolean {
  const st = (ride.status ?? '').trim().toLowerCase();
  if (st === 'completed') return true;
  /** `completedAt` alone can be noisy; don't lock chat while ride is clearly still open. */
  if (ride.completedAt && st !== 'open' && st !== 'full' && st !== '') {
    const t = Date.parse(String(ride.completedAt));
    if (!Number.isNaN(t)) return true;
  }
  const uid = viewerUserId.trim();
  if (uid && ride.bookings?.length) {
    const mine = pickPreferredBookingForUser(ride.bookings, uid);
    const bs = (mine?.status ?? '').trim().toLowerCase();
    if (bs === 'completed') return true;
  }
  const my = (ride.myBookingStatus ?? '').trim().toLowerCase();
  if (my === 'completed') return true;
  return false;
}
