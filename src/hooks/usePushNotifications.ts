import { useEffect, useRef, useCallback } from 'react';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import type { NavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import {
  navigateFromNotificationPayload,
  triggerChatRefreshFromPayload,
} from '../navigation/handleNotificationNavigation';
import {
  registerCurrentDevicePushToken,
  resetPushPermissionDeniedAlertFlag,
} from '../services/pushTokenRegistration';

// Foreground presentation (Expo SDK 50+)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * When authenticated: request permission, register push token with backend, Android channels,
 * listen for native token rotation, and handle notification taps (chat + ride events).
 *
 * **Re-register on every session:** POST runs when auth is active so the logged-in user owns the device token.
 */
export function usePushNotifications(
  navigationRef: NavigationContainerRef<RootStackParamList> | null,
  navigationReady: boolean,
  shouldRegister: boolean,
  userId: string | null
): void {
  const coldStartHandledRef = useRef(false);

  useEffect(() => {
    coldStartHandledRef.current = false;
    resetPushPermissionDeniedAlertFlag();
    // Do not clear pushTokenMemory here — logout runs DELETE first; clearing here caused races
    // with in-flight registration and wrong user–token mapping.
  }, [userId]);

  const registerToken = useCallback(async () => {
    if (!Device.isDevice || !userId) return;
    await registerCurrentDevicePushToken({ userId });
  }, [userId]);

  useEffect(() => {
    if (!shouldRegister || !userId) return;
    void registerToken();
  }, [shouldRegister, userId, registerToken]);

  /** FCM/APNs can rotate while the app runs — re-POST so backend stays valid. Pass device token from listener into Expo/native paths (avoids re-entrant getDevicePushTokenAsync). */
  useEffect(() => {
    if (!shouldRegister || !userId) return;
    const sub = Notifications.addPushTokenListener((devicePushToken) => {
      void registerCurrentDevicePushToken({
        userId,
        showPermissionDeniedAlert: false,
        devicePushTokenFromListener: devicePushToken,
      });
    });
    return () => sub.remove();
  }, [shouldRegister, userId]);

  useEffect(() => {
    if (!shouldRegister || !userId || !navigationReady) return;

    const onReceive = (notification: Notifications.Notification) => {
      const data = notification.request.content.data as Record<string, unknown>;
      void triggerChatRefreshFromPayload(data);
    };

    const onResponse = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      void navigateFromNotificationPayload(navigationRef, data, userId);
    };

    const recvSub = Notifications.addNotificationReceivedListener(onReceive);
    const sub = Notifications.addNotificationResponseReceivedListener(onResponse);

    if (!coldStartHandledRef.current) {
      coldStartHandledRef.current = true;
      void Notifications.getLastNotificationResponseAsync().then((last) => {
        if (last && shouldRegister && userId) {
          onResponse(last);
        }
      });
    }

    return () => {
      recvSub.remove();
      sub.remove();
    };
  }, [shouldRegister, userId, navigationReady, navigationRef]);
}
