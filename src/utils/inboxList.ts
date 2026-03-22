import type { RideListItem } from '../types/api';
import { isChatInactiveForRide } from './chatAccess';
import { getRideScheduledAt } from './rideDisplay';

/** Inbox row shape for sorting / visibility (avoids circular import from InboxContext). */
export type InboxListRow = {
  lastMessageAt: number;
  ride: RideListItem;
};

/** Target max visible rows (5–7); future rides may push total above this. */
export const INBOX_VISIBLE_CHAT_MAX = 6;

/**
 * Sort key: latest activity = max(last message time, trip scheduled start).
 * Ensures upcoming rides stay relevant even with few messages.
 */
export function getInboxActivitySortKey(conv: InboxListRow): number {
  const msg = conv.lastMessageAt ?? 0;
  const trip = getRideScheduledAt(conv.ride)?.getTime() ?? 0;
  return Math.max(msg, trip);
}

/** Ride is upcoming (scheduled in the future). Used to always show in inbox list. */
export function isFutureRideForInbox(ride: RideListItem): boolean {
  const at = getRideScheduledAt(ride);
  if (!at) return false;
  return at.getTime() > Date.now();
}

/**
 * UI-only visibility: never hide future-ride chats; cap non-future to fill remaining slots.
 * Does not delete data — only selects which rows to render.
 */
export function applyInboxVisibilityLimit<T extends InboxListRow>(
  conversations: T[],
  maxTotal: number = INBOX_VISIBLE_CHAT_MAX
): T[] {
  if (conversations.length === 0) return [];

  const sorted = [...conversations].sort(
    (a, b) => getInboxActivitySortKey(b) - getInboxActivitySortKey(a)
  );

  const future: T[] = [];
  const nonFuture: T[] = [];
  for (const c of sorted) {
    if (isFutureRideForInbox(c.ride)) future.push(c);
    else nonFuture.push(c);
  }

  const slotsForNonFuture = Math.max(0, maxTotal - future.length);
  /** Prefer keeping chats that are still writable; drop inactive (completed + 2h, or cancelled) first when capped. */
  const nonFuturePrioritized = [...nonFuture].sort((a, b) => {
    const aIn = isChatInactiveForRide(a.ride) ? 1 : 0;
    const bIn = isChatInactiveForRide(b.ride) ? 1 : 0;
    if (aIn !== bIn) return aIn - bIn;
    return getInboxActivitySortKey(b) - getInboxActivitySortKey(a);
  });
  const nonFutureVisible = nonFuturePrioritized.slice(0, slotsForNonFuture);

  return [...future, ...nonFutureVisible];
}
