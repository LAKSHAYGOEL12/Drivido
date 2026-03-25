import { Platform } from 'react-native';
import { API } from '../constants/API';
import api from './api';

/**
 * POST /user/push-token body.
 * Send **one** token field: Expo push token **or** native FCM/APNs (Firebase direct — no Expo projectId).
 */
export type RegisterPushTokenBody = {
  platform: 'ios' | 'android';
  /** Expo Push (`ExponentPushToken[...]`). */
  expoPushToken?: string;
  /** Same as `expoPushToken` — optional alias some backends expect. */
  pushToken?: string;
  /** Native FCM (Android) — server uses Firebase Admin. */
  fcmToken?: string;
  /** Native APNs device token (iOS) — server uses APNs provider. */
  apnsToken?: string;
};

/**
 * Register push token with backend.
 * Prefer Expo token when available; otherwise native FCM (Android) / APNs (iOS).
 * Backend may respond with **204 No Content** — `api.post` treats any 2xx as success.
 */
export async function registerPushTokenWithBackend(body: RegisterPushTokenBody): Promise<void> {
  await api.post(API.endpoints.user.pushToken, body);
}

export function buildRegisterBodyFromNativeToken(
  token: string,
  kind: 'expo' | 'fcm' | 'apns'
): RegisterPushTokenBody {
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  if (kind === 'expo') return { platform, expoPushToken: token, pushToken: token };
  if (kind === 'fcm') return { platform, fcmToken: token };
  return { platform, apnsToken: token };
}
