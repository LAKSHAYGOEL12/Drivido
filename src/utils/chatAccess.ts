import type { RideListItem } from '../types/api';
import { getRideScheduledAt } from './rideDisplay';

/** After the ride is marked completed, chat stays writable for this long, then read-only. */
export const CHAT_ACTIVE_MS_AFTER_COMPLETION = 2 * 60 * 60 * 1000;

function norm(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

function isRideCancelled(ride: RideListItem): boolean {
  if (norm((ride as RideListItem & { status?: string }).status) === 'cancelled') return true;
  if (norm(ride.myBookingStatus) === 'cancelled') return true;
  return false;
}

function isRideCompleted(ride: RideListItem): boolean {
  if (norm((ride as RideListItem & { status?: string }).status) === 'completed') return true;
  if (norm(ride.myBookingStatus) === 'completed') return true;
  return false;
}

/**
 * When chat becomes read-only / inactive for messaging.
 * - Cancelled rides: effectively immediately (returns 0).
 * - Completed rides: `completedAt` (or scheduled time fallback) + 2 hours.
 * - Otherwise: `null` (no automatic lock; still allow messaging).
 */
export function getChatInactiveAtMs(ride: RideListItem): number | null {
  if (isRideCancelled(ride)) return 0;

  if (!isRideCompleted(ride)) return null;

  const r = ride as RideListItem & { completedAt?: string };
  let completionMs: number | null = null;
  if (r.completedAt) {
    const d = new Date(r.completedAt);
    if (!isNaN(d.getTime())) completionMs = d.getTime();
  }
  if (completionMs == null) {
    const sched = getRideScheduledAt(ride);
    if (sched) completionMs = sched.getTime();
  }
  if (completionMs == null) return null;

  return completionMs + CHAT_ACTIVE_MS_AFTER_COMPLETION;
}

export function isChatSendingAllowed(ride: RideListItem, now: number = Date.now()): boolean {
  const inactiveAt = getChatInactiveAtMs(ride);
  if (inactiveAt == null) return true;
  if (inactiveAt === 0) return false;
  return now < inactiveAt;
}

/** Inbox: treat thread as inactive when messaging is closed (completed + grace elapsed, or cancelled). */
export function isChatInactiveForRide(ride: RideListItem, now: number = Date.now()): boolean {
  return !isChatSendingAllowed(ride, now);
}
