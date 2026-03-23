import { useEffect, useRef, useCallback } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import type { DevicePushToken } from 'expo-notifications';
import type { NavigationContainerRef } from '@react-navigation/native';
import type { MainTabParamList } from '../navigation/types';
import { navigateFromNotificationPayload } from '../navigation/handleNotificationNavigation';
import {
  registerPushTokenWithBackend,
  buildRegisterBodyFromNativeToken,
} from '../services/pushTokenApi';
import {
  clearLastRegisteredPushToken,
  setLastRegisteredPushToken,
} from '../services/pushTokenMemory';

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

/** Expo project UUID — optional. If unset, we use native FCM/APNs only (Firebase direct; no EAS / Expo Push API). */
function resolveExpoProjectId(): string | undefined {
  const fromEnv =
    typeof process.env.EXPO_PUBLIC_EAS_PROJECT_ID === 'string'
      ? process.env.EXPO_PUBLIC_EAS_PROJECT_ID.trim()
      : '';
  if (fromEnv) return fromEnv;
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

function nativeDeviceTokenString(device: DevicePushToken): string {
  const d = device.data;
  return typeof d === 'string' ? d : JSON.stringify(d);
}

/**
 * When authenticated: request permission, register push token with backend, Android channels,
 * and handle notification taps (chat + ride events).
 *
 * **Push modes**
 * - If `EXPO_PUBLIC_EAS_PROJECT_ID` / `extra.eas.projectId` is set: tries **Expo Push** token first.
 * - Otherwise (or if Expo fails): **native FCM (Android)** / **APNs (iOS)** — backend must send via Firebase, not Expo Push API.
 *
 * **Re-register on every session:** We POST whenever auth is active and we obtain a token — not only on first install — so the correct user owns the device token after each login (backend dedupes).
 */
export function usePushNotifications(
  navigationRef: NavigationContainerRef<MainTabParamList> | null,
  navigationReady: boolean,
  shouldRegister: boolean,
  userId: string | null
): void {
  const lastRegisteredTokenRef = useRef<string | null>(null);
  const coldStartHandledRef = useRef(false);
  const permissionDeniedAlertShownRef = useRef(false);

  useEffect(() => {
    lastRegisteredTokenRef.current = null;
    permissionDeniedAlertShownRef.current = false;
    clearLastRegisteredPushToken();
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
      if (final !== 'granted') {
        console.warn(
          '[push] Notification permission not granted — open Settings → Apps → Drivido → Notifications:',
          final
        );
        if (!permissionDeniedAlertShownRef.current) {
          permissionDeniedAlertShownRef.current = true;
          Alert.alert(
            'Notifications are off',
            'Enable notifications for Drivido to get ride updates and messages.',
            [
              { text: 'Not now', style: 'cancel' },
              {
                text: 'Open Settings',
                onPress: () => {
                  void Linking.openSettings();
                },
              },
            ]
          );
        }
        return;
      }

      await ensureAndroidChannels();

      const projectId = resolveExpoProjectId();

      if (projectId) {
        try {
          const tokenRes = await Notifications.getExpoPushTokenAsync({ projectId });
          const token = tokenRes.data;
          if (token) {
            lastRegisteredTokenRef.current = token;
            await registerPushTokenWithBackend(buildRegisterBodyFromNativeToken(token, 'expo'));
            setLastRegisteredPushToken(token, 'expo');
            console.warn('[push] Registered Expo push token with backend (provider=expo).');
          }
          return;
        } catch (e) {
          console.warn(
            '[push] Expo Push token failed — falling back to native FCM/APNs. Server must use Firebase/APNs for these tokens:',
            e instanceof Error ? e.message : e
          );
        }
      } else {
        console.warn(
          '[push] No EXPO_PUBLIC_EAS_PROJECT_ID — registering native FCM/APNs only. Server must send via Firebase Admin (Android) / APNs (iOS), not Expo Push API.'
        );
      }

      const device = await Notifications.getDevicePushTokenAsync();
      const raw = nativeDeviceTokenString(device);
      if (!raw) return;
      lastRegisteredTokenRef.current = raw;

      const kind = Platform.OS === 'android' ? 'fcm' : 'apns';
      await registerPushTokenWithBackend(buildRegisterBodyFromNativeToken(raw, kind));
      setLastRegisteredPushToken(raw, kind);
      console.warn(`[push] Registered native ${kind} token with backend (provider=${kind}).`);
    } catch (e) {
      console.warn(
        '[push] Registration error (check API URL, auth, and POST /api/user/push-token):',
        e instanceof Error ? e.message : e
      );
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
