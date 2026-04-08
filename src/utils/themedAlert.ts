/**
 * Drop-in replacement for `Alert` from react-native: same `Alert.alert(title, message?, buttons?)` shape,
 * rendered as a themed in-app modal (Drivido colors, dark mode, iOS/Android-friendly layout).
 */
import { showAppAlert, type AppAlertButton, type AppAlertOptions } from './appAlert';

export type { AppAlertButton, AppAlertOptions };

function normalizeButtons(buttons?: AppAlertButton[]): AppAlertButton[] {
  if (buttons && buttons.length > 0) return buttons;
  return [{ text: 'OK', style: 'default' }];
}

/** Matches `Alert.alert` — optional 4th arg like RN (`cancelable`, `onDismiss`). */
export function showThemedAlert(
  title: string,
  message?: string,
  buttons?: AppAlertButton[],
  options?: { cancelable?: boolean; onDismiss?: () => void }
): void {
  showAppAlert({
    title,
    ...(message !== undefined && message !== '' ? { message } : {}),
    buttons: normalizeButtons(buttons),
    ...(options?.cancelable ? { cancelable: true } : {}),
    ...(options?.onDismiss ? { onDismiss: options.onDismiss } : {}),
  });
}

/** Same API as React Native `Alert` (only `.alert` is implemented). */
export const Alert = {
  alert: showThemedAlert,
};
