/**
 * Exchange Firebase ID token for Drivido API JWTs.
 * The backend verifies the token with Firebase Admin and returns `{ token, refreshToken, user }`.
 */
import { resolveApiBaseOrigin } from '../config/apiBaseUrl';
import { API } from '../constants/API';
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
  gender?: string;
  createdAt?: string;
  created_at?: string;
  avatarUrl?: string | null;
  avatar_url?: string | null;
};

export type BackendAuthExchangeResult = {
  token: string;
  refreshToken: string;
  user: BackendAuthUser;
};

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
