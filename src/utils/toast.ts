export type ToastVariant = 'error' | 'info' | 'success' | 'overlap';

export type ToastPayload = {
  title?: string;
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
};

type ToastListener = (payload: ToastPayload) => void;

let emit: ToastListener | null = null;

export function registerToastListener(fn: ToastListener | null): void {
  emit = fn;
}

export function showToast(payload: ToastPayload): void {
  emit?.(payload);
}
