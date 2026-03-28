import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import type { RootStackParamList } from './types';

export type GuestLoginReason = 'book' | 'tab';

/**
 * Open root `Login` modal from any nested navigator.
 */
export function navigateToGuestLogin(
  navigation: NavigationProp<ParamListBase>,
  params?: { reason?: GuestLoginReason }
): void {
  (navigation as NavigationProp<RootStackParamList>).navigate('Login', params);
}
