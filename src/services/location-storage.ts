/**
 * Persist location-permission UX flags.
 * - DENIED_AT_SIGNUP: user denied at signup / first post-login prompt → ask again when they tap "Use current location"
 * - DENIED_FROM_PICKER: user denied again from picker → hide "Use current location" until logout+login
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_DENIED_AT_SIGNUP = 'drivido_location_denied_at_signup';
const KEY_DENIED_FROM_PICKER = 'drivido_location_denied_from_picker';

export async function getLocationDeniedAtSignup(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(KEY_DENIED_AT_SIGNUP);
    return v === '1';
  } catch {
    return false;
  }
}

export async function setLocationDeniedAtSignup(value: boolean): Promise<void> {
  try {
    if (value) await AsyncStorage.setItem(KEY_DENIED_AT_SIGNUP, '1');
    else await AsyncStorage.removeItem(KEY_DENIED_AT_SIGNUP);
  } catch {}
}

export async function getLocationDeniedFromPicker(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(KEY_DENIED_FROM_PICKER);
    return v === '1';
  } catch {
    return false;
  }
}

export async function setLocationDeniedFromPicker(value: boolean): Promise<void> {
  try {
    if (value) await AsyncStorage.setItem(KEY_DENIED_FROM_PICKER, '1');
    else await AsyncStorage.removeItem(KEY_DENIED_FROM_PICKER);
  } catch {}
}

/** Call on logout so user can be asked again after next login. */
export async function clearLocationDeniedFlags(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([KEY_DENIED_AT_SIGNUP, KEY_DENIED_FROM_PICKER]);
  } catch {}
}
