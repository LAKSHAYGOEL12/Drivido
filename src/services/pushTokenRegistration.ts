import { Linking, Platform } from 'react-native';
import { Alert } from '../utils/themedAlert';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import type { DevicePushToken } from 'expo-notifications';
import { API } from '../constants/API';
import api from './api';
import { buildRegisterBodyFromNativeToken, registerPushTokenWithBackend } from './pushTokenApi';
import { clearLastRegisteredPushToken, getLastRegisteredPushToken, setLastRegisteredPushToken } from './pushTokenMemory';

const ANDROID_CHANNELS: { id: string; name: string }[] = [
  { id: 'default', name: 'General' },
  { id: 'messages', name: 'Messages' },
  { id: 'rides', name: 'Ride updates' },
];

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

function deleteBodyForToken(token: string, kind: 'expo' | 'fcm' | 'apns'): Record<string, string> {
  if (kind === 'expo') return { expoPushToken: token };
  if (kind === 'fcm') return { fcmToken: token };
  return { apnsToken: token };
}

async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  for (const ch of ANDROID_CHANNELS) {
    await Notifications.setNotificationChannelAsync(ch.id, {
      name: ch.name,
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
}

export type RegisterPushTokenOptions = {
  /** Required for dedupe by session owner. */
  userId: string;
  /**
   * If false, do not show the "Open Settings" alert when permission is denied
   * (e.g. token refresh / listener callbacks).
   */
  showPermissionDeniedAlert?: boolean;
  /**
   * From `addPushTokenListener` — pass through so `getExpoPushTokenAsync` uses it and does not
   * call `getDevicePushTokenAsync` again (avoids listener re-entry / loops per Expo docs).
   */
  devicePushTokenFromListener?: DevicePushToken;
};

let permissionDeniedAlertShown = false;
let lastPostedKey: string | null = null;
let registerInFlight: Promise<void> | null = null;

/**
 * Obtain current device push token (Expo or native) and POST /api/user/push-token.
 * Call after login when session + Bearer token are active.
 */
export async function registerCurrentDevicePushToken(
  options: RegisterPushTokenOptions
): Promise<void> {
  if (!options.userId) return;
  if (registerInFlight) return registerInFlight;
  registerInFlight = registerCurrentDevicePushTokenInternal(options);
  try {
    await registerInFlight;
  } finally {
    registerInFlight = null;
  }
}

async function registerCurrentDevicePushTokenInternal(
  options: RegisterPushTokenOptions
): Promise<void> {
  const showPermissionDeniedAlert = options.showPermissionDeniedAlert !== false;
  const devicePushTokenFromListener = options.devicePushTokenFromListener;

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
        '[push] Notification permission not granted — open Settings → Apps → EcoPickO → Notifications:',
        final
      );
      if (showPermissionDeniedAlert && !permissionDeniedAlertShown) {
        permissionDeniedAlertShown = true;
        Alert.alert(
          'Notifications are off',
          'Enable notifications for EcoPickO to get ride updates and messages.',
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
        const tokenRes = await Notifications.getExpoPushTokenAsync(
          devicePushTokenFromListener
            ? { projectId, devicePushToken: devicePushTokenFromListener }
            : { projectId }
        );
        const token = tokenRes.data;
        if (token) {
          const key = `${options.userId}:expo:${token}`;
          if (lastPostedKey === key) return;
          await registerPushTokenWithBackend(buildRegisterBodyFromNativeToken(token, 'expo'));
          setLastRegisteredPushToken(token, 'expo');
          lastPostedKey = key;
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

    if (devicePushTokenFromListener) {
      const raw = nativeDeviceTokenString(devicePushTokenFromListener);
      if (!raw) return;
      const kind = Platform.OS === 'android' ? 'fcm' : 'apns';
      const key = `${options.userId}:${kind}:${raw}`;
      if (lastPostedKey === key) return;
      await registerPushTokenWithBackend(buildRegisterBodyFromNativeToken(raw, kind));
      setLastRegisteredPushToken(raw, kind);
      lastPostedKey = key;
      console.warn(`[push] Registered native ${kind} token with backend (provider=${kind}).`);
      return;
    }

    const device = await Notifications.getDevicePushTokenAsync();
    const raw = nativeDeviceTokenString(device);
    if (!raw) return;

    const kind = Platform.OS === 'android' ? 'fcm' : 'apns';
    const key = `${options.userId}:${kind}:${raw}`;
    if (lastPostedKey === key) return;
    await registerPushTokenWithBackend(buildRegisterBodyFromNativeToken(raw, kind));
    setLastRegisteredPushToken(raw, kind);
    lastPostedKey = key;
    console.warn(`[push] Registered native ${kind} token with backend (provider=${kind}).`);
  } catch (e) {
    console.warn(
      '[push] Registration error (check API URL, auth, and POST /api/user/push-token):',
      e instanceof Error ? e.message : e
    );
  }
}

/**
 * Resolve FCM/Expo/APNs token for DELETE when in-memory registration is missing
 * (e.g. user logs out before first POST completed).
 */
export async function resolveCurrentDeviceTokenForUnregister(): Promise<{
  token: string;
  kind: 'expo' | 'fcm' | 'apns';
} | null> {
  if (!Device.isDevice) return null;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return null;

    const projectId = resolveExpoProjectId();
    if (projectId) {
      try {
        const tokenRes = await Notifications.getExpoPushTokenAsync({ projectId });
        const token = tokenRes.data;
        if (token) return { token, kind: 'expo' };
      } catch {
        // fall through to native
      }
    }

    const device = await Notifications.getDevicePushTokenAsync();
    const raw = nativeDeviceTokenString(device);
    if (!raw) return null;
    const kind = Platform.OS === 'android' ? 'fcm' : 'apns';
    return { token: raw, kind };
  } catch {
    return null;
  }
}

/**
 * Remove this device's push token for the current user **before** clearing the session.
 * Uses last POSTed token when possible; otherwise resolves the live device token.
 */
export async function unregisterPushTokenWithBackend(): Promise<void> {
  let last = getLastRegisteredPushToken();
  if (!last) {
    const resolved = await resolveCurrentDeviceTokenForUnregister();
    if (resolved) last = resolved;
  }
  try {
    if (last) {
      await api.delete(API.endpoints.user.pushToken, {
        body: JSON.stringify(deleteBodyForToken(last.token, last.kind)),
      });
    } else {
      await api.delete(API.endpoints.user.pushToken);
    }
  } finally {
    clearLastRegisteredPushToken();
    /** Same token string after DELETE — must allow POST again or backend never re-stores the device. */
    lastPostedKey = null;
  }
}

/** Reset alert flag when a new session starts (new user id). */
export function resetPushPermissionDeniedAlertFlag(): void {
  permissionDeniedAlertShown = false;
  lastPostedKey = null;
}
