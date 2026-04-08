import type { RideListItem } from '../types/api';
import { pickPreferredBookingForUser } from './bookingStatus';
import { getRideArrivalDate } from './rideDisplay';

/**
 * Chat is tied to a single ride; when the ride (or the viewer’s booking) is completed,
 * sending new messages should stop. History stays readable.
 */
export function isRideCompletedForChat(ride: RideListItem, viewerUserId: string): boolean {
  const st = (ride.status ?? '').trim().toLowerCase();
  if (st === 'completed' || st === 'complete') return true;
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

/**
 * Local fallback send policy when backend chat-lock flags are absent.
 * - cancelled ride -> closed immediately
 * - completed (or effectively completed by arrival window) -> allow for 2 hours, then close
 */
export function canSendRideChatByLocalPolicy(ride: RideListItem, viewerUserId: string): boolean {
  const st = (ride.status ?? '').trim().toLowerCase();
  if (st === 'cancelled' || st === 'canceled') return false;
  if (!isRideCompletedForChat(ride, viewerUserId)) return true;

  const GRACE_MS = 2 * 60 * 60 * 1000;
  const completedAtMs = (() => {
    if (ride.completedAt) {
      const t = Date.parse(String(ride.completedAt));
      if (!Number.isNaN(t)) return t;
    }
    const arrival = getRideArrivalDate(ride);
    if (!arrival || Number.isNaN(arrival.getTime())) return NaN;
    return arrival.getTime();
  })();
  if (Number.isNaN(completedAtMs)) return true;
  return Date.now() <= completedAtMs + GRACE_MS;
}
