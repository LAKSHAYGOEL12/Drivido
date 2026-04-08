import type { RideListItem } from '../types/api';
import type { StoredThreads } from '../services/chat-storage';
import { bookingIsCancelled, pickPreferredBookingForUser } from './bookingStatus';
import {
  getRideArrivalDate,
  getRideScheduledAt,
  isRideCancelledByOwner,
  isRideCompletedForDisplay,
  PAST_GRACE_MS_AFTER_ARRIVAL,
} from './rideDisplay';
import { isRideCompletedForChat } from './rideChat';

/** Hide and drop local threads for completed/cancelled rides after this window. */
export const INBOX_TERMINAL_CHAT_RETENTION_MS = 15 * 24 * 60 * 60 * 1000;

function parseIsoMs(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** Ride is finished from the viewer’s perspective (completed trip or cancelled). */
export function rideIsTerminalForInboxRetention(ride: RideListItem, viewerUserId: string): boolean {
  if (isRideCancelledByOwner(ride)) return true;
  if (bookingIsCancelled(ride.myBookingStatus)) return true;

  const uid = viewerUserId.trim();
  const mine =
    uid && ride.bookings?.length ? pickPreferredBookingForUser(ride.bookings, uid) : undefined;
  if (mine && bookingIsCancelled(mine.status)) return true;

  if (isRideCompletedForChat(ride, viewerUserId)) return true;
  if (isRideCompletedForDisplay(ride)) return true;
  return false;
}

/**
 * Best-effort time when the ride became “terminal” for retention (cancel vs complete).
 * Used as the start of the 15-day countdown.
 */
function completedLikeAnchorMs(ride: RideListItem): number | null {
  const scheduledMs = getRideScheduledAt(ride)?.getTime() ?? null;
  const c = parseIsoMs(ride.completedAt);
  if (c != null) return c;
  const arr = getRideArrivalDate(ride);
  if (arr) return arr.getTime() + PAST_GRACE_MS_AFTER_ARRIVAL;
  return scheduledMs;
}

function terminalEventAnchorMs(ride: RideListItem, viewerUserId: string): number | null {
  const scheduledMs = getRideScheduledAt(ride)?.getTime() ?? null;

  if (isRideCancelledByOwner(ride)) {
    const r = ride as RideListItem & { cancelledAt?: string; cancelled_at?: string };
    return parseIsoMs(r.cancelledAt ?? r.cancelled_at) ?? scheduledMs;
  }

  const uid = viewerUserId.trim();
  const mine =
    uid && ride.bookings?.length ? pickPreferredBookingForUser(ride.bookings, uid) : undefined;
  if (mine && bookingIsCancelled(mine.status)) {
    const m = mine as { updatedAt?: string };
    return parseIsoMs(m.updatedAt) ?? parseIsoMs(mine.bookedAt) ?? scheduledMs;
  }

  if (bookingIsCancelled(ride.myBookingStatus)) {
    return scheduledMs;
  }

  if (isRideCompletedForChat(ride, viewerUserId)) return completedLikeAnchorMs(ride);
  if (isRideCompletedForDisplay(ride)) return completedLikeAnchorMs(ride);

  return null;
}

/** True when this thread should be removed from Chats and local storage. */
export function shouldPruneInboxChatForRide(
  ride: RideListItem | null | undefined,
  viewerUserId: string,
  nowMs: number = Date.now()
): boolean {
  if (!ride || !viewerUserId.trim()) return false;
  if (!rideIsTerminalForInboxRetention(ride, viewerUserId)) return false;
  const anchor = terminalEventAnchorMs(ride, viewerUserId);
  if (anchor == null) return false;
  return nowMs - anchor >= INBOX_TERMINAL_CHAT_RETENTION_MS;
}

/** Drops threads past retention; returns the same map reference if nothing removed. */
export function pruneStaleTerminalChatThreads(
  threads: StoredThreads,
  viewerUserId: string,
  nowMs: number = Date.now()
): StoredThreads {
  if (!viewerUserId.trim()) return threads;
  let changed = false;
  const next: StoredThreads = { ...threads };
  for (const key of Object.keys(next)) {
    const t = next[key];
    if (!t?.ride) continue;
    if (shouldPruneInboxChatForRide(t.ride, viewerUserId, nowMs)) {
      delete next[key];
      changed = true;
    }
  }
  return changed ? next : threads;
}
