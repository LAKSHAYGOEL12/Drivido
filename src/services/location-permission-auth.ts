/**
 * Request foreground location once after successful signup/login so the app can
 * prefetch when possible. If denied, we persist via setLocationDeniedAtSignup;
 * user can still be prompted again when they tap "Use current location" (LocationContext).
 */
import { setLocationDeniedAtSignup } from './location-storage';

export async function requestForegroundLocationAfterAuth(): Promise<void> {
  try {
    const Location = await import('expo-location');
    const { status } = await Location.requestForegroundPermissionsAsync();
    await setLocationDeniedAtSignup(status !== 'granted');
  } catch {
    // Don't mark denied on module/load errors — user can retry from Search/Publish.
  }
}
