/**
 * Themed modal alerts (see AppAlertProvider). Register listener from the provider; use showAppAlert / themedAlert.
 */

export type AppAlertButtonStyle = 'default' | 'cancel' | 'destructive';

export type AppAlertButton = {
  text: string;
  onPress?: () => void;
  style?: AppAlertButtonStyle;
};

export type AppAlertOptions = {
  title: string;
  message?: string;
  buttons?: AppAlertButton[];
  /** When true, Android back / scrim tap can dismiss (see `onDismiss`). */
  cancelable?: boolean;
  /** Called when the dialog is dismissed without a button (back button, scrim). */
  onDismiss?: () => void;
};

type AppAlertListener = ((options: AppAlertOptions) => void) | null;

let listener: AppAlertListener = null;

export function registerAppAlertListener(fn: AppAlertListener): void {
  listener = fn;
}

export function showAppAlert(options: AppAlertOptions): void {
  listener?.(options);
}
