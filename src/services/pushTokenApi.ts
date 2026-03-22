import { Platform } from 'react-native';
import { API } from '../constants/API';
import api from './api';

export type RegisterPushTokenBody = {
  expoPushToken: string;
  platform: 'ios' | 'android';
};

/**
 * Register Expo push token with backend so server can send notifications (messages, ride events).
 * Safe to call repeatedly — backend should upsert by user + device.
 */
export async function registerPushTokenWithBackend(expoPushToken: string): Promise<void> {
  const body: RegisterPushTokenBody = {
    expoPushToken,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  };
  await api.post(API.endpoints.user.pushToken, body);
}

/**
 * Remove push registration for the current user (call before clearing auth on logout).
 */
export async function unregisterPushTokenWithBackend(): Promise<void> {
  await api.delete(API.endpoints.user.pushToken);
}
