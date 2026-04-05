/**
 * Exchange Firebase ID token for Drivido API JWTs.
 * The backend verifies the token with Firebase Admin and returns `{ token, refreshToken, user }`.
 */
import { resolveApiBaseOrigin } from '../config/apiBaseUrl';
import { API } from '../constants/API';
import { pickAvatarUrlFromRecord } from '../utils/avatarUrl';
import {
  peekPendingFirebaseProfileForExchange,
  clearPendingFirebaseProfilePatch,
} from './pendingFirebaseProfile';

const API_PREFIX = (process.env.EXPO_PUBLIC_API_PREFIX ?? '/api').replace(/\/$/, '') || '';

export class AuthExchangeError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'AuthExchangeError';
    this.code = code;
  }
}

export type BackendAuthUser = {
  id?: string;
  _id?: string;
  phone?: string;
  name?: string;
  email?: string;
  /** ISO YYYY-MM-DD from Mongo (signup / PATCH profile). */
  dateOfBirth?: string;
  date_of_birth?: string;
  dob?: string;
  gender?: string;
  createdAt?: string;
  created_at?: string;
  avatarUrl?: string | null;
  avatar_url?: string | null;
  vehicleModel?: string;
  vehicle_name?: string;
  vehicle_model?: string;
  licensePlate?: string;
  license_plate?: string;
  vehicleNumber?: string;
  vehicle_number?: string;
  vehicleColor?: string;
  vehicle_color?: string;
  /** Up to 2 vehicles; same shape as GET /user/vehicles. */
  vehicles?: unknown[];
};

export type BackendAuthExchangeResult = {
  token: string;
  refreshToken: string;
  user: BackendAuthUser;
};

/**
 * GET /auth/me (and similar) may return `{ user }`, `{ data: { user } }`, or `{ data: user }`.
 * Avatar may sit on the envelope (e.g. `data.avatarUrl` next to `data.user`) — merge that in.
 */
export function parseAuthMePayload(raw: unknown): BackendAuthUser | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  let me: BackendAuthUser | null = null;
  if (o.user && typeof o.user === 'object' && !Array.isArray(o.user)) {
    me = o.user as BackendAuthUser;
  } else {
    const d = o.data;
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      const dr = d as Record<string, unknown>;
      if (dr.user && typeof dr.user === 'object' && !Array.isArray(dr.user)) {
        me = dr.user as BackendAuthUser;
      } else {
        me = d as BackendAuthUser;
      }
    } else {
      me = o as BackendAuthUser;
    }
  }

  if (!me || !String(me.id ?? me._id ?? '').trim()) return null;

  const onUser = pickAvatarUrlFromRecord(me as unknown as Record<string, unknown>);
  if (onUser) return me;

  const fromRoot = pickAvatarUrlFromRecord(o);
  const d = o.data;
  const fromData =
    d && typeof d === 'object' && !Array.isArray(d)
      ? pickAvatarUrlFromRecord(d as Record<string, unknown>)
      : undefined;
  const fromEnv = fromRoot || fromData;
  if (fromEnv) {
    return { ...me, avatarUrl: fromEnv };
  }
  return me;
}

/**
 * POST `/api/auth/firebase` — body JSON:
 * - `idToken` (required): Firebase ID token
 * - `dateOfBirth` (optional): `YYYY-MM-DD` — legacy; Register no longer sets pending patch (use Complete Profile / PATCH).
 * - `gender` (optional): e.g. `male`, `female`, `non_binary`, `prefer_not_to_say`
 *
 * **Backend (MongoDB):** Save profile fields from `PATCH /user/update` (Complete Profile) and/or this exchange.
 * Include `dateOfBirth`, `gender`, `phone` on `user` in responses and on `GET /api/auth/me`.
 *
 * **Deferring a “real” user row until Complete Profile (server-side only):** This app always exchanges
 * after Firebase sign-in so it can call authenticated `PATCH /user/update`. To avoid committing a full
 * user until DOB/gender/phone exist, the API can (for example) create a **provisional** user on this
 * endpoint, mark `profileComplete: false`, and only promote or unlock features after the first
 * successful profile PATCH — or return JWT tied to Firebase uid while persisting the Mongo user on
 * that PATCH. The mobile client cannot skip this exchange without losing an access token for PATCH.
 */
export async function exchangeFirebaseIdTokenForBackendSession(
  idToken: string
): Promise<BackendAuthExchangeResult> {
  const base = resolveApiBaseOrigin().trim();
  if (!base) {
    throw new Error('EXPO_PUBLIC_API_URL is not set — cannot reach Drivido API.');
  }
  const path = API.endpoints.auth.firebase.startsWith('/')
    ? API.endpoints.auth.firebase
    : `/${API.endpoints.auth.firebase}`;
  const url = `${base}${API_PREFIX}${path}`;
  const pending = peekPendingFirebaseProfileForExchange();
  const body: Record<string, string> = { idToken: idToken.trim() };
  if (pending.dateOfBirth) body.dateOfBirth = pending.dateOfBirth;
  if (pending.gender) body.gender = pending.gender;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as BackendAuthExchangeResult & {
    message?: string;
    hint?: string;
    code?: string;
  };
  if (!res.ok) {
    const detail = [data.message, data.hint].filter(Boolean).join(' ');
    const code = typeof data.code === 'string' ? data.code : undefined;
    throw new AuthExchangeError(detail || `Auth exchange failed (${res.status})`, code);
  }
  if (!data.token || !data.refreshToken || !data.user) {
    throw new Error('Invalid auth exchange response from server');
  }
  clearPendingFirebaseProfilePatch();
  return {
    token: data.token,
    refreshToken: data.refreshToken,
    user: data.user,
  };
}
