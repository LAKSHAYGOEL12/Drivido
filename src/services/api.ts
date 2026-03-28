/**
 * API client for the backend.
 *
 * Base URL: set **only** in `.env` as `EXPO_PUBLIC_API_URL` (see `src/config/apiBaseUrl.ts`).
 * Origin only — no `/api`, no trailing slash. After edits: `npx expo start --clear`.
 * Emulator: `http://10.0.2.2:3000` · Simulator: `http://localhost:3000` · Device: your LAN IP.
 *
 * - Sends Authorization: Bearer <accessToken> on every request (GET/POST /rides, GET /auth/me, etc.).
 *   If the backend requires this header and it's missing, you get 401 Unauthorized (not 404).
 * - 404 = route/URL not found on the backend. 401 = missing or invalid token.
 * - On 401: calls /auth/refresh with refreshToken, retries the request once; if refresh fails, clears tokens and triggers onSessionExpired.
 *
 * Sign-in troubleshooting:
 * - App calls POST /api/auth/login (with /api prefix). Restart backend and try again.
 * - 401 "Invalid email or password" = backend reached but credentials don't match; check password and that user exists (e.g. register then login).
 * - CORS/network: in dev tools Network tab check the login request (status and response body) to see if the issue is no token in response, 401, or something else.
 * - "Aborted" = request timed out (default 15s) or connection failed; we surface a clearer "Connection timed out" message.
 */
import { Platform } from 'react-native';
import { resolveApiBaseOrigin } from '../config/apiBaseUrl';
import { API } from '../constants/API';
import { setStoredTokens, clearStoredTokens } from './token-storage';

/** Hint for "cannot reach server" based on run environment. */
function getConnectionHint(): string {
  if (Platform.OS === 'android') {
    return ' On Android emulator, set EXPO_PUBLIC_API_URL=http://10.0.2.2:3000 in .env (10.0.2.2 is the host).';
  }
  if (Platform.OS === 'ios') {
    return ' On iOS Simulator, set EXPO_PUBLIC_API_URL=http://localhost:3000 in .env.';
  }
  return ' On a physical device use your Mac IP (same WiFi) and allow port 3000 in Mac firewall.';
}

/**
 * GET `/api/rides/:id` can 404 when the ride was deleted/expired but bookings or list payloads
 * still mention the id — expected; Your Rides merges several sources. Don’t spam dev logs.
 */
function isExpectedRideDetail404(url: string, status: number): boolean {
  if (status !== 404) return false;
  const m = url.match(/\/rides\/([^/?#]+)$/);
  if (!m) return false;
  const seg = m[1].toLowerCase();
  const reserved = ['search', 'booked', 'mine', 'my-rides'];
  return !reserved.includes(seg);
}

/** Backend origin from `.env` only (`EXPO_PUBLIC_API_URL`) — see `src/config/apiBaseUrl.ts`. */
const getBaseUrl = (): string => {
  const base = resolveApiBaseOrigin();
  if (!base && __DEV__) {
    console.warn(
      '[API] Missing EXPO_PUBLIC_API_URL in .env — add e.g. EXPO_PUBLIC_API_URL=http://YOUR_IP:3000 then npx expo start --clear'
    );
  }
  return base;
};

/** API path prefix. Backend serves auth at /api/auth/register, /api/auth/login, etc. */
const API_PREFIX = (process.env.EXPO_PUBLIC_API_PREFIX ?? '/api').replace(/\/$/, '') || '';

/** Current API origin (call each time — not cached at module load). */
export function getApiBaseUrl(): string {
  return getBaseUrl();
}

/** @deprecated Prefer `getApiBaseUrl()` — same value at module load; avoids missing-export crashes in old bundles. */
export const API_BASE_URL = getApiBaseUrl();

let authToken: string | null = null;
let refreshToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

/** Set access token for Authorization header. */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** Set refresh token (used on 401 to get new access token). */
export function setRefreshToken(token: string | null): void {
  refreshToken = token;
}

/** Clear in-memory tokens. Call on logout; persisted tokens are cleared separately. */
export function clearAuth(): void {
  authToken = null;
  refreshToken = null;
}

/** True when a session access token is set (guest / logged-out flows should skip auth-only API routes). */
export function hasAuthAccessToken(): boolean {
  return Boolean(authToken?.trim());
}

/** Register callback when refresh fails (e.g. redirect to login). Call from AuthProvider. */
export function setOnSessionExpired(callback: () => void): void {
  onSessionExpired = callback;
}

function getHeaders(includeJsonContentType = true): HeadersInit {
  const headers: Record<string, string> = {
    ...(includeJsonContentType ? { 'Content-Type': 'application/json' } : {}),
  };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  return headers;
}

const DEFAULT_TIMEOUT_MS = 15000;

type RequestConfig = RequestInit & { timeout?: number; /** When true, GET 404 returns null instead of throwing (no console.warn). */ silentNotFound?: boolean };

/** Refresh token response from backend. */
interface RefreshResponse {
  token: string;
  refreshToken?: string;
}

async function doRefreshToken(): Promise<{ accessToken: string; refreshToken: string }> {
  if (!refreshToken) throw new Error('No refresh token');
  if (!getApiBaseUrl()) {
    throw new Error(
      'EXPO_PUBLIC_API_URL is not set in .env. See src/config/apiBaseUrl.ts — then npx expo start --clear.'
    );
  }
  const path = API.endpoints.auth.refresh.startsWith('/') ? API.endpoints.auth.refresh : '/' + API.endpoints.auth.refresh;
  const url = `${getApiBaseUrl()}${API_PREFIX}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  const data = (await res.json().catch(() => ({}))) as RefreshResponse & { message?: string };
  if (!res.ok) {
    if (__DEV__ && res.status !== 404) console.warn('[API] refresh failed', res.status, data);
    throw new Error(data?.message ?? 'Session expired');
  }
  const newAccess = data.token;
  const newRefresh = data.refreshToken ?? refreshToken;
  if (!newAccess) throw new Error('Invalid refresh response');
  return { accessToken: newAccess, refreshToken: newRefresh };
}

async function request<T>(
  path: string,
  options: RequestConfig = {},
  isRetryAfterRefresh = false
): Promise<T> {
  if (!path.startsWith('http') && !getApiBaseUrl()) {
    throw new Error(
      'EXPO_PUBLIC_API_URL is not set in .env. See src/config/apiBaseUrl.ts — then npx expo start --clear.'
    );
  }
  const { timeout = DEFAULT_TIMEOUT_MS, headers: optHeaders, silentNotFound, ...init } = options;
  const isFormDataBody = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const pathWithPrefix = path.startsWith('http')
    ? path
    : `${getApiBaseUrl()}${API_PREFIX}${path.startsWith('/') ? path : '/' + path}`;
  const url = path.startsWith('http') ? path : pathWithPrefix;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { ...getHeaders(!isFormDataBody), ...optHeaders } as HeadersInit,
    });
    clearTimeout(timeoutId);

    const data =
      res.status === 204 || (res.headers.get('content-length') === '0')
        ? {}
        : await res.json().catch(() => ({}));

    if (res.status === 401 && !isRetryAfterRefresh && refreshToken) {
      try {
        const { accessToken: newAccess, refreshToken: newRefresh } = await doRefreshToken();
        authToken = newAccess;
        refreshToken = newRefresh;
        await setStoredTokens(newAccess, newRefresh);
        return request<T>(path, options, true);
      } catch (refreshErr) {
        await clearStoredTokens();
        clearAuth();
        onSessionExpired?.();
        throw refreshErr;
      }
    }

    if (!res.ok) {
      if (silentNotFound === true && res.status === 404) {
        return null as T;
      }
      const msg = getErrorMessage(data, res.status, res.statusText);
      const isChat404 = res.status === 404 && url.includes('/chat/');
      const isAuth404 = res.status === 404 && url.includes('/auth/');
      const isRide404 = isExpectedRideDetail404(url, res.status);
      if (__DEV__ && !isChat404 && !isAuth404 && !isRide404) console.warn('[API]', res.status, url, data);
      throw Object.assign(new Error(msg), { status: res.status, data });
    }
    return data as T;
  } catch (e) {
    clearTimeout(timeoutId);
    const status = e && typeof e === 'object' && 'status' in e ? (e as { status: number }).status : undefined;
    const isAuth404 = status === 404 && url.includes('/auth/');
    const isRide404 = status === 404 && isExpectedRideDetail404(url, 404);
    if (__DEV__ && e instanceof Error && !isAuth404 && !isRide404) {
      console.warn('[API] Error', url, e.message);
    }
    if (e instanceof Error) {
      const isAborted = e.name === 'AbortError' || e.message === 'Aborted';
      const isNetworkFailed =
        e.message === 'Network request failed' ||
        e.message.includes('Network request failed');
      if (isAborted) {
        throw new Error(
          'Connection timed out. Check that the backend is running and your device can reach ' +
            (getApiBaseUrl() || 'the server') +
            '. Same WiFi may be required.'
        );
      }
      if (isNetworkFailed) {
        const base = getApiBaseUrl() || 'backend';
        const testUrl = base + (API_PREFIX || '/api') + '/health';
        throw new Error(
          'Cannot reach server at ' +
            base +
            '.' +
            getConnectionHint() +
            ' Checklist: (1) Backend running on Mac. (2) Phone & Mac on same WiFi, VPN off. (3) Mac Firewall: allow port 3000. (4) On phone browser open ' +
            testUrl +
            ' – if it fails, fix network first. Then: npx expo start --clear'
        );
      }
      throw e;
    }
    throw new Error('Network error – is the backend running on port 3000?');
  }
}

function getErrorMessage(
  data: unknown,
  status: number,
  statusText: string
): string {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (typeof d.message === 'string') return d.message;
    if (typeof d.error === 'string') return d.error;
    if (typeof d.msg === 'string') return d.msg;
    if (Array.isArray(d.errors) && d.errors[0] && typeof d.errors[0] === 'string')
      return d.errors[0];
  }
  if (status === 404) return 'Endpoint not found. Check that the backend implements this route.';
  if (status === 429) {
    return 'Too many requests (429). Wait a minute and try again, or raise/disable rate limits on the server for development.';
  }
  if (status >= 500) return `Server error (${status}). Check backend logs.`;
  return statusText || 'Request failed';
}

/**
 * GET with ETag support for conditional requests (If-None-Match → 304 Not Modified).
 * Use for ride detail caching; normal `api.get` does not handle 304.
 */
async function getJsonWithEtagImpl<T>(
  path: string,
  extraHeaders: Record<string, string> | undefined,
  isRetryAfterRefresh: boolean
): Promise<{ status: 200; data: T; etag: string | null } | { status: 304; etag: string | null }> {
  if (!path.startsWith('http') && !getApiBaseUrl()) {
    throw new Error(
      'EXPO_PUBLIC_API_URL is not set in .env. See src/config/apiBaseUrl.ts — then npx expo start --clear.'
    );
  }
  const pathWithPrefix = path.startsWith('http')
    ? path
    : `${getApiBaseUrl()}${API_PREFIX}${path.startsWith('/') ? path : '/' + path}`;
  const url = path.startsWith('http') ? path : pathWithPrefix;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { ...getHeaders(), ...extraHeaders } as HeadersInit,
    });
    clearTimeout(timeoutId);

    const etagHeader = res.headers.get('etag') ?? res.headers.get('ETag');

    if (res.status === 401 && !isRetryAfterRefresh && refreshToken) {
      try {
        const { accessToken: newAccess, refreshToken: newRefresh } = await doRefreshToken();
        authToken = newAccess;
        refreshToken = newRefresh;
        await setStoredTokens(newAccess, newRefresh);
        return getJsonWithEtagImpl<T>(path, extraHeaders, true);
      } catch (refreshErr) {
        await clearStoredTokens();
        clearAuth();
        onSessionExpired?.();
        throw refreshErr;
      }
    }

    if (res.status === 304) {
      return { status: 304, etag: etagHeader };
    }

    const data =
      res.status === 204 || res.headers.get('content-length') === '0'
        ? {}
        : await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = getErrorMessage(data, res.status, res.statusText);
      const isChat404 = res.status === 404 && url.includes('/chat/');
      const isAuth404 = res.status === 404 && url.includes('/auth/');
      const isRide404 = isExpectedRideDetail404(url, res.status);
      if (__DEV__ && !isChat404 && !isAuth404 && !isRide404) console.warn('[API]', res.status, url, data);
      throw Object.assign(new Error(msg), { status: res.status, data });
    }

    return { status: 200, data: data as T, etag: etagHeader };
  } catch (e) {
    clearTimeout(timeoutId);
    const status = e && typeof e === 'object' && 'status' in e ? (e as { status: number }).status : undefined;
    const isAuth404 = status === 404 && url.includes('/auth/');
    const isRide404 = status === 404 && isExpectedRideDetail404(url, 404);
    if (__DEV__ && e instanceof Error && !isAuth404 && !isRide404) {
      console.warn('[API] Error', url, e.message);
    }
    if (e instanceof Error) {
      const isAborted = e.name === 'AbortError' || e.message === 'Aborted';
      const isNetworkFailed =
        e.message === 'Network request failed' || e.message.includes('Network request failed');
      if (isAborted) {
        throw new Error(
          'Connection timed out. Check that the backend is running and your device can reach ' +
            (getApiBaseUrl() || 'the server') +
            '. Same WiFi may be required.'
        );
      }
      if (isNetworkFailed) {
        const base = getApiBaseUrl() || 'backend';
        const testUrl = base + (API_PREFIX || '/api') + '/health';
        throw new Error(
          'Cannot reach server at ' +
            base +
            '.' +
            getConnectionHint() +
            ' Checklist: (1) Backend running on Mac. (2) Phone & Mac on same WiFi, VPN off. (3) Mac Firewall: allow port 3000. (4) On phone browser open ' +
            testUrl +
            ' – if it fails, fix network first. Then: npx expo start --clear'
        );
      }
      throw e;
    }
    throw new Error('Network error – is the backend running on port 3000?');
  }
}

export async function getJsonWithEtag<T>(
  path: string,
  extraHeaders?: Record<string, string>
): Promise<{ status: 200; data: T; etag: string | null } | { status: 304; etag: string | null }> {
  return getJsonWithEtagImpl<T>(path, extraHeaders, false);
}

export const api = {
  get: <T>(path: string, config?: RequestConfig) =>
    request<T>(path, { ...config, method: 'GET' }),

  /** GET that returns null on 404 (for probing optional public-user routes). */
  getOptional: <T>(path: string, config?: Omit<RequestConfig, 'method' | 'silentNotFound'>) =>
    request<T | null>(path, { ...config, method: 'GET', silentNotFound: true }),

  /** Multipart upload — do not JSON.stringify body. */
  postForm: <T>(path: string, formData: FormData, config?: RequestConfig) =>
    request<T>(path, { ...config, method: 'POST', body: formData }),

  post: <T>(path: string, body?: unknown, config?: RequestConfig) =>
    request<T>(path, { ...config, method: 'POST', body: body ? JSON.stringify(body) : undefined }),

  put: <T>(path: string, body?: unknown, config?: RequestConfig) =>
    request<T>(path, { ...config, method: 'PUT', body: body ? JSON.stringify(body) : undefined }),

  patch: <T>(path: string, body?: unknown, config?: RequestConfig) =>
    request<T>(path, { ...config, method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),

  delete: <T>(path: string, config?: RequestConfig) =>
    request<T>(path, { ...config, method: 'DELETE' }),
};

/**
 * Test if the backend is reachable (for dev troubleshooting).
 * Tries GET /api/health. Returns ok: true if server responds (even 404); ok: false if network failed.
 */
export async function testServerConnection(): Promise<{ ok: boolean; message: string }> {
  if (!getApiBaseUrl()) {
    return {
      ok: false,
      message:
        'EXPO_PUBLIC_API_URL is not set in .env. See src/config/apiBaseUrl.ts — then npx expo start --clear.',
    };
  }
  const url = `${getApiBaseUrl()}${API_PREFIX}/health`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(t);
    if (res.ok) return { ok: true, message: `Server OK at ${getApiBaseUrl()}` };
    return { ok: true, message: `Server reached (${res.status}) at ${getApiBaseUrl()}` };
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : 'Request failed';
    return { ok: false, message: `Cannot reach server: ${msg}` };
  }
}

export default api;
