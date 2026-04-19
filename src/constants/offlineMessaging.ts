/**
 * Single source of truth for “no usable network” copy in the UI.
 * Use these anywhere the user should see the same offline messaging.
 */
export const OFFLINE_HEADLINE = "You're offline";

/** Full-screen / alerts / API errors when the device cannot reach the server. */
export const OFFLINE_SUBTITLE_RETRY = 'Check your connection, then try again.';

/** Shorter hint under lists or compact empty states. */
export const OFFLINE_SUBTITLE_REFRESH = 'Connect to refresh.';

/** One line for thrown errors, alerts, and single `Text` fields. */
export const OFFLINE_USER_MESSAGE = `${OFFLINE_HEADLINE}. ${OFFLINE_SUBTITLE_RETRY}`;

/** Screen reader when cached rides are shown (Your Rides). */
export const OFFLINE_A11Y_CACHED_LIST =
  'You are offline. Showing saved trips from this device.';

/** Heuristic: error message likely means no network / unreachable host (not HTTP 4xx body). */
export function isLikelyOfflineErrorMessage(message: string): boolean {
  const m = String(message ?? '').toLowerCase();
  return (
    m.includes('network request failed') ||
    m.includes('network error') ||
    m.includes('failed to fetch') ||
    m.includes('no internet') ||
    m.includes('internet connection') ||
    m.includes('could not reach') ||
    m.includes('cannot reach server') ||
    m.includes('check your connection') ||
    m.includes('connection timed out') ||
    m.includes('err_network') ||
    m.includes('econnaborted') ||
    m.includes('aborted') ||
    m.includes('load failed') ||
    m.includes('the internet connection appears to be offline') ||
    m.includes('backend running on port') ||
    m === 'network error – is the backend running on port 3000?'
  );
}
