import type { RideListItem } from '../types/api';
import { bookingIsCancelled } from './bookingStatus';
import { getRideScheduledAt, isRideCancelledByOwner, isRidePastArrivalWindow } from './rideDisplay';

/** Inbox row shape for sorting / visibility (avoids circular import from InboxContext). */
export type InboxListRow = {
  lastMessageAt: number;
  ride: RideListItem;
};

/** Target max visible rows (5–7); future rides may push total above this. */
export const INBOX_VISIBLE_CHAT_MAX = 6;

/**
 * Max inbox threads subscribed on the global chat WebSocket at once.
 * Matches production practice: realtime only for recent/active threads; older threads still update via REST/inbox refresh.
 */
export const MAX_CHAT_WS_SUBSCRIPTIONS = 24;

/**
 * Sort key: max(last message time, trip scheduled start).
 * @deprecated Prefer {@link compareInboxByLastMessageAtDesc} for Chats tab ordering.
 */
export function getInboxActivitySortKey(conv: InboxListRow): number {
  const msg = conv.lastMessageAt ?? 0;
  const trip = getRideScheduledAt(conv.ride)?.getTime() ?? 0;
  return Math.max(msg, trip);
}

/** Chats tab: newest message first only — ride date does not change order. */
export function compareInboxByLastMessageAtDesc(a: InboxListRow, b: InboxListRow): number {
  const bt = b.lastMessageAt ?? 0;
  const at = a.lastMessageAt ?? 0;
  if (bt !== at) return bt - at;
  return String(b.ride?.id ?? '').localeCompare(String(a.ride?.id ?? ''));
}

/** Ride is upcoming (scheduled in the future). */
export function isFutureRideForInbox(ride: RideListItem): boolean {
  const at = getRideScheduledAt(ride);
  if (!at) return false;
  return at.getTime() > Date.now();
}

/**
 * Live WebSocket subscribe only for trips that are still “active” (not cancelled/completed and not past
 * the arrival + grace window). Past threads still update via inbox HTTP refresh / opening chat.
 */
export function isRideEligibleForChatWebSocketSubscription(ride: RideListItem | null | undefined): boolean {
  if (!ride || !String(ride.id ?? '').trim()) return false;
  if (isRideCancelledByOwner(ride)) return false;
  if (bookingIsCancelled(ride.myBookingStatus)) return false;
  const st = String(ride.status ?? '').trim().toLowerCase();
  if (st === 'completed' || st === 'cancelled' || st === 'canceled') return false;
  if (isRidePastArrivalWindow(ride)) return false;
  return true;
}

/**
 * UI-only: show the first `maxTotal` chats by last message time (newest first).
 * Does not delete data — only selects which rows to render when not searching.
 */
export function applyInboxVisibilityLimit<T extends InboxListRow>(
  conversations: T[],
  maxTotal: number = INBOX_VISIBLE_CHAT_MAX
): T[] {
  if (conversations.length === 0) return [];
  return [...conversations].sort(compareInboxByLastMessageAtDesc).slice(0, maxTotal);
}
