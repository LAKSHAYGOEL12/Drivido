import { CommonActions } from '@react-navigation/native';
import type { NavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';
import type { RideListItem } from '../types/api';
import { fetchRideDetailRaw } from '../services/rideDetailCache';
import { unwrapRideFromDetailResponse } from '../utils/unwrapRideDetail';
import { rootNavigationRef } from './rootNavigationRef';

function pickRideId(data: Record<string, unknown>): string {
  const v = data.rideId ?? data.ride_id;
  return typeof v === 'string' ? v.trim() : '';
}

function pickType(data: Record<string, unknown>): string {
  const raw = data.type ?? data.notificationType ?? data.event;
  return String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/-/g, '_');
}

function pickOtherUserName(data: Record<string, unknown>): string {
  const v = data.otherUserName ?? data.senderName ?? data.fromName ?? data.other_user_name;
  return typeof v === 'string' && v.trim() ? v.trim() : 'Chat';
}

function pickOtherUserId(data: Record<string, unknown>): string | undefined {
  const v = data.otherUserId ?? data.senderId ?? data.other_user_id;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

async function loadRide(
  rideId: string,
  viewerUserId: string
): Promise<ReturnType<typeof unwrapRideFromDetailResponse>> {
  try {
    const raw = await fetchRideDetailRaw(rideId, { force: true, viewerUserId });
    return unwrapRideFromDetailResponse(raw);
  } catch {
    return null;
  }
}

const INBOX_TAB_INDEX = 3;

/**
 * Replace entire Main tab state so Inbox is exactly InboxList → Chat (no stale Chat / RideDetail).
 * Matches tab order in `BottomTabs.tsx`.
 */
function dispatchOpenChatFromNotification(
  ride: RideListItem,
  otherUserName: string,
  otherUserId: string | undefined
): void {
  if (!rootNavigationRef.isReady()) return;
  const chatParams = {
    ride,
    otherUserName,
    ...(otherUserId ? { otherUserId } : {}),
  };
  rootNavigationRef.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [
        {
          name: 'Main',
          state: {
            routes: [
              {
                name: 'SearchStack',
                state: { routes: [{ name: 'SearchRides' as const }], index: 0 },
              },
              {
                name: 'PublishStack',
                state: { routes: [{ name: 'PublishRide' as const }], index: 0 },
              },
              {
                name: 'YourRides',
                state: { routes: [{ name: 'YourRidesList' as const }], index: 0 },
              },
              {
                name: 'Inbox',
                state: {
                  routes: [
                    { name: 'InboxList' as const },
                    { name: 'Chat' as const, params: chatParams },
                  ],
                  index: 1,
                },
              },
              { name: 'Profile' as const },
            ],
            index: INBOX_TAB_INDEX,
          },
        },
      ],
    })
  );
}

/** Passed to chat refresh so open chat can match route + show preview before HTTP returns. */
export type ChatNotificationPayload = {
  rideId: string;
  otherUserId: string;
  otherUserName: string;
  raw: Record<string, unknown>;
};

/**
 * Callback to trigger immediate chat message refresh after notification navigation.
 * Set by usePushNotifications → ChatScreen listens and calls on mount when notified.
 */
let chatRefreshCallback: ((payload: ChatNotificationPayload) => Promise<boolean>) | null = null;
let inboxRefreshCallback: ((rideId: string, otherUserId: string, otherUserName: string) => Promise<boolean>) | null = null;

export function setChatRefreshCallback(
  cb: ((payload: ChatNotificationPayload) => Promise<boolean>) | null
): void {
  chatRefreshCallback = cb;
}

export function setInboxRefreshCallback(
  cb: ((rideId: string, otherUserId: string, otherUserName: string) => Promise<boolean>) | null
): void {
  inboxRefreshCallback = cb;
}

export function pickNotificationMessageId(data: Record<string, unknown>): string | undefined {
  const v = data.messageId ?? data.message_id ?? data.id;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function pickNotificationMessageText(data: Record<string, unknown>): string | undefined {
  const v =
    data.body ?? data.message ?? data.text ?? data.messageText ?? data.preview ?? data.lastMessage;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function pickNotificationSenderId(data: Record<string, unknown>): string | undefined {
  const v = data.senderUserId ?? data.senderId ?? data.fromUserId ?? data.from_user_id;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export async function triggerChatRefreshFromPayload(
  data: Record<string, unknown> | undefined | null
): Promise<void> {
  if (!data) return;
  const type = pickType(data);
  const isChat =
    type === 'chat_message' ||
    type === 'message' ||
    type === 'chat' ||
    type === 'new_message';
  if (!isChat) return;
  const rideId = pickRideId(data);
  const otherUserId = pickOtherUserId(data);
  const otherUserName = pickOtherUserName(data);
  if (!rideId || !otherUserId) return;
  const payload: ChatNotificationPayload = { rideId, otherUserId, otherUserName, raw: data };
  let handledByOpenChat = false;
  if (chatRefreshCallback) {
    handledByOpenChat = await chatRefreshCallback(payload);
  }
  if (!handledByOpenChat && inboxRefreshCallback) {
    await inboxRefreshCallback(rideId, otherUserId, otherUserName);
  }
}

/** After opening chat from a push, callbacks may not be registered yet — retry refresh. */
function scheduleChatRefreshFromNotificationData(data: Record<string, unknown>): void {
  const run = () => void triggerChatRefreshFromPayload(data);
  run();
  setTimeout(run, 350);
  setTimeout(run, 900);
}

/**
 * Navigate from notification `data` (Expo `content.data`). Requires auth + Navigation ready.
 * Pre-loads ride details and ensures thread exists in InboxContext for instant display.
 */
export async function navigateFromNotificationPayload(
  navigationRef: NavigationContainerRef<RootStackParamList> | null,
  data: Record<string, unknown> | undefined | null,
  viewerUserId: string
): Promise<void> {
  if (!data || !navigationRef?.isReady()) return;
  const rideId = pickRideId(data);
  const type = pickType(data);

  const isChat =
    type === 'chat_message' ||
    type === 'message' ||
    type === 'chat' ||
    type === 'new_message';

  const isRideEvent =
    type === 'ride_booked' ||
    type === 'booking_confirmed' ||
    type === 'ride_cancelled' ||
    type === 'ride_canceled' ||
    type === 'ride_cancel' ||
    type === 'booking_cancelled';

  if (!rideId) {
    if (isChat || isRideEvent) {
      navigationRef.navigate('Main', {
        screen: 'YourRides',
        params: { screen: 'YourRidesList' },
      });
    }
    return;
  }

  const ride = await loadRide(rideId, viewerUserId);
  if (!ride) {
    navigationRef.navigate('Main', {
      screen: 'YourRides',
      params: { screen: 'YourRidesList' },
    });
    return;
  }

  if (isChat) {
    const otherUserName = pickOtherUserName(data);
    const otherUserId = pickOtherUserId(data);
    console.log('[Notification] Opening chat for ride:', rideId, 'other user:', otherUserId);
    if (rootNavigationRef.isReady()) {
      dispatchOpenChatFromNotification(ride, otherUserName, otherUserId);
    } else {
      navigationRef.navigate('Main', {
        screen: 'Inbox',
        params: {
          screen: 'Chat',
          params: {
            ride,
            otherUserName,
            otherUserId,
          },
        },
      });
    }
    scheduleChatRefreshFromNotificationData(data);
    return;
  }

  if (isRideEvent || type === '') {
    navigationRef.navigate('Main', {
      screen: 'YourRides',
      params: {
        screen: 'RideDetail',
        params: { ride },
      },
    });
    return;
  }

  // Unknown type but we have a ride — open detail
  navigationRef.navigate('Main', {
    screen: 'YourRides',
    params: {
      screen: 'RideDetail',
      params: { ride },
    },
  });
}
