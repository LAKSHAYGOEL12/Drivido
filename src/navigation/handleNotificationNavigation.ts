import type { NavigationContainerRef } from '@react-navigation/native';
import type { MainTabParamList } from './types';
import { fetchRideDetailRaw } from '../services/rideDetailCache';
import { unwrapRideFromDetailResponse } from '../utils/unwrapRideDetail';

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

/**
 * Navigate from notification `data` (Expo `content.data`). Requires auth + Navigation ready.
 */
export async function navigateFromNotificationPayload(
  navigationRef: NavigationContainerRef<MainTabParamList> | null,
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
      navigationRef.navigate('YourRides', { screen: 'YourRidesList' });
    }
    return;
  }

  const ride = await loadRide(rideId, viewerUserId);
  if (!ride) {
    navigationRef.navigate('YourRides', { screen: 'YourRidesList' });
    return;
  }

  if (isChat) {
    navigationRef.navigate('Inbox', {
      screen: 'Chat',
      params: {
        ride,
        otherUserName: pickOtherUserName(data),
        otherUserId: pickOtherUserId(data),
      },
    });
    return;
  }

  if (isRideEvent || type === '') {
    navigationRef.navigate('YourRides', {
      screen: 'RideDetail',
      params: { ride },
    });
    return;
  }

  // Unknown type but we have a ride — open detail
  navigationRef.navigate('YourRides', {
    screen: 'RideDetail',
    params: { ride },
  });
}
