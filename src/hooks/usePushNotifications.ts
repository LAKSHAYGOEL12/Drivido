import { useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import type { NavigationContainerRef } from '@react-navigation/native';
import type { MainTabParamList } from '../navigation/types';
import { navigateFromNotificationPayload } from '../navigation/handleNotificationNavigation';
import { registerPushTokenWithBackend } from '../services/pushTokenApi';

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

const ANDROID_CHANNELS: { id: string; name: string }[] = [
  { id: 'default', name: 'General' },
  { id: 'messages', name: 'Messages' },
  { id: 'rides', name: 'Ride updates' },
];

function resolveExpoProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/**
 * When authenticated: request permission, register Expo token with backend, Android channels,
 * and handle notification taps (chat + ride events).
 */
export function usePushNotifications(
  navigationRef: NavigationContainerRef<MainTabParamList> | null,
  navigationReady: boolean,
  shouldRegister: boolean,
  userId: string | null
): void {
  const lastRegisteredTokenRef = useRef<string | null>(null);
  const coldStartHandledRef = useRef(false);

  useEffect(() => {
    lastRegisteredTokenRef.current = null;
  }, [userId]);

  const ensureAndroidChannels = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    for (const ch of ANDROID_CHANNELS) {
      await Notifications.setNotificationChannelAsync(ch.id, {
        name: ch.name,
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }
  }, []);

  const registerToken = useCallback(async () => {
    if (!Device.isDevice) {
      if (__DEV__) console.warn('[push] Use a physical device for push notifications.');
      return;
    }
    try {
      const { status: existing } = await Notifications.getPermissionsAsync();
      let final = existing;
      if (existing !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        final = status;
      }
      if (final !== 'granted') return;

      await ensureAndroidChannels();

      const projectId = resolveExpoProjectId();
      const tokenRes = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : {}
      );
      const token = tokenRes.data;
      if (!token || lastRegisteredTokenRef.current === token) return;
      lastRegisteredTokenRef.current = token;

      try {
        await registerPushTokenWithBackend(token);
      } catch (e) {
        if (__DEV__) {
          console.warn(
            '[push] Backend POST /api/user/push-token failed — implement or fix server:',
            e instanceof Error ? e.message : e
          );
        }
      }
    } catch (e) {
      if (__DEV__) console.warn('[push] Registration error:', e);
    }
  }, [ensureAndroidChannels]);

  useEffect(() => {
    if (!shouldRegister || !userId) return;
    void registerToken();
  }, [shouldRegister, userId, registerToken]);

  useEffect(() => {
    if (!shouldRegister || !userId || !navigationReady) return;

    const onResponse = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      void navigateFromNotificationPayload(navigationRef, data, userId);
    };

    const sub = Notifications.addNotificationResponseReceivedListener(onResponse);

    if (!coldStartHandledRef.current) {
      coldStartHandledRef.current = true;
      void Notifications.getLastNotificationResponseAsync().then((last) => {
        if (last && shouldRegister && userId) {
          onResponse(last);
        }
      });
    }

    return () => sub.remove();
  }, [shouldRegister, userId, navigationReady, navigationRef]);
}
