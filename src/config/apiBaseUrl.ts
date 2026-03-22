/**
 * Backend API base URL — single source of truth.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Set ONLY in project root `.env`:                              │
 * │                                                                  │
 * │    EXPO_PUBLIC_API_URL=http://YOUR_IP_OR_HOST:3000               │
 * │                                                                  │
 * │  Rules: origin only — no `/api`, no trailing slash.              │
 * │  After changing:  npx expo start --clear                         │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Do not hardcode URLs elsewhere; import `resolveApiBaseOrigin` from this file
 * or use `getApiBaseUrl()` from `services/api.ts` (which uses this module).
 */
import Constants from 'expo-constants';

/** Env key — must match `app.config.js` / Expo public env. */
export const API_BASE_URL_ENV_KEY = 'EXPO_PUBLIC_API_URL' as const;

/** Normalize user/env value: trim, strip trailing slash, strip trailing `/api`. */
export function normalizeApiOrigin(raw: string): string {
  let u = raw.trim();
  if (!u) return '';
  u = u.replace(/\/$/, '');
  if (u.endsWith('/api')) u = u.slice(0, -4);
  return u;
}

/** Raw value from Metro-inlined `process.env.EXPO_PUBLIC_API_URL`. */
export function readApiBaseUrlFromEnv(): string {
  const v = process.env.EXPO_PUBLIC_API_URL;
  return typeof v === 'string' ? normalizeApiOrigin(v) : '';
}

/** Fallback from `app.config.js` → `expo.extra.apiUrl` (same .env at prebuild time). */
export function readApiBaseUrlFromExpoExtra(): string {
  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
  const fromConfig = typeof extra?.apiUrl === 'string' ? extra.apiUrl.trim() : '';
  return normalizeApiOrigin(fromConfig);
}

/**
 * Resolved API origin for all HTTP calls. Prefer `.env` (Metro bundle), then `extra`.
 * Returns empty string if unset — callers should treat as misconfiguration.
 */
export function resolveApiBaseOrigin(): string {
  const fromEnv = readApiBaseUrlFromEnv();
  const fromExtra = readApiBaseUrlFromExpoExtra();

  if (__DEV__ && fromEnv && fromExtra && fromEnv !== fromExtra) {
    console.warn(
      `[API] EXPO_PUBLIC_API_URL (${fromEnv}) ≠ expo.extra.apiUrl (${fromExtra}). Using .env (Metro). ` +
        'If the app still hits the wrong host, stop Metro and run: npx expo start --clear. ' +
        'For dev builds (expo run:ios/android), rebuild so extra.apiUrl matches .env.'
    );
  }
  if (__DEV__ && !fromEnv && fromExtra) {
    console.warn(
      '[API] EXPO_PUBLIC_API_URL is empty in the JS bundle; using expo.extra.apiUrl from the native app. ' +
        'That value is from the last prebuild/run — update .env then run `npx expo start --clear` ' +
        'or `npx expo run:ios` / `expo run:android` again.'
    );
  }

  if (fromEnv) return fromEnv;
  if (fromExtra) return fromExtra;
  return '';
}

/** Dev-only: both URL sources (Metro-inlined .env vs native manifest). */
export function getApiBaseUrlDebug(): { fromEnv: string; fromExtra: string; resolved: string } {
  const fromEnv = readApiBaseUrlFromEnv();
  const fromExtra = readApiBaseUrlFromExpoExtra();
  return {
    fromEnv,
    fromExtra,
    resolved: fromEnv || fromExtra || '',
  };
}
