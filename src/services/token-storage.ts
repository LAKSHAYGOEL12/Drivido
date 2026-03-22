/**
 * Secure token storage (Keychain on iOS, EncryptedSharedPreferences on Android).
 * Used for accessToken and refreshToken to support persistent login.
 */
import * as SecureStore from 'expo-secure-store';

const KEY_ACCESS_TOKEN = 'drivido_access_token';
const KEY_REFRESH_TOKEN = 'drivido_refresh_token';

export async function getAccessToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY_ACCESS_TOKEN);
  } catch {
    return null;
  }
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY_REFRESH_TOKEN);
  } catch {
    return null;
  }
}

export async function getStoredTokens(): Promise<{ accessToken: string; refreshToken: string } | null> {
  const [accessToken, refreshToken] = await Promise.all([
    getAccessToken(),
    getRefreshToken(),
  ]);
  if (accessToken && refreshToken) {
    return { accessToken, refreshToken };
  }
  return null;
}

export async function setStoredTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEY_ACCESS_TOKEN, accessToken),
    SecureStore.setItemAsync(KEY_REFRESH_TOKEN, refreshToken),
  ]);
}

export async function clearStoredTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_ACCESS_TOKEN),
    SecureStore.deleteItemAsync(KEY_REFRESH_TOKEN),
  ]);
}
