import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { User as FirebaseUser } from '@firebase/auth';
import { onAuthStateChanged, reload } from '@firebase/auth';
import {
  setAuthToken,
  setRefreshToken,
  clearAuth,
  setOnSessionExpired,
  api,
} from '../services/api';
import { clearStoredTokens, setStoredTokens } from '../services/token-storage';
import { clearLocationDeniedFlags } from '../services/location-storage';
import { clearRideDetailCache } from '../services/rideDetailCache';
import { unregisterPushTokenWithBackend } from '../services/pushTokenRegistration';
import { getFirebaseAuth, isFirebaseAuthConfigured } from '../config/firebase';
import { API } from '../constants/API';
import { phoneDigitsFromFirebasePhone } from '../services/firestoreUser';
import { firebaseSignOutSafe } from '../services/firebaseAuthBridge';
import {
  AuthExchangeError,
  exchangeFirebaseIdTokenForBackendSession,
  type BackendAuthUser,
} from '../services/backendAuthExchange';

export type User = {
  id: string;
  /** Legacy; empty if not set */
  phone: string;
  email?: string;
  name?: string;
  /** ISO YYYY-MM-DD from backend user document */
  dateOfBirth?: string;
  gender?: string;
  createdAt?: string;
  /** Profile photo URL from Firebase Auth or Firestore. */
  avatarUrl?: string;
};

type AuthState = {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** True while POST /auth/firebase is in flight after Firebase sign-in (for UI to wait). */
  isAwaitingBackendSession: boolean;
  /** Password sign-in succeeded in Firebase but API rejected until `email_verified` is true. */
  needsEmailVerification: boolean;
  pendingVerificationEmail: string | null;
};

type AuthContextValue = AuthState & {
  login: (user: User, accessToken: string, refreshToken?: string | null) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  /** Reload Firebase user + GET /api/auth/me (e.g. after avatar or profile change). */
  refreshUser: () => Promise<void>;
  patchUser: (patch: Partial<User>) => void;
  /** After user taps the Firebase verification link, reload + exchange for JWT. */
  retrySessionAfterEmailVerified: () => Promise<{ ok: boolean; message?: string }>;
};

const initialState: AuthState = {
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  isAwaitingBackendSession: false,
  needsEmailVerification: false,
  pendingVerificationEmail: null,
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Merge Mongo user from POST /auth/firebase (or GET /auth/me) with Firebase Auth display/photo. */
function buildSessionUser(fbUser: FirebaseUser, backendUser: BackendAuthUser): User {
  const mongoId = String(backendUser.id || backendUser._id || '').trim();
  if (!mongoId) {
    throw new Error('Backend user missing id');
  }
  const beEmail = backendUser.email != null ? String(backendUser.email).trim() : '';
  const beName = backendUser.name != null ? String(backendUser.name).trim() : '';
  const bePhone = backendUser.phone != null ? String(backendUser.phone).trim() : '';
  const beDob =
    backendUser.dateOfBirth != null && String(backendUser.dateOfBirth).trim() !== ''
      ? String(backendUser.dateOfBirth).trim()
      : '';
  const beGender =
    backendUser.gender != null && String(backendUser.gender).trim() !== ''
      ? String(backendUser.gender).trim()
      : '';
  const beAvatar =
    backendUser.avatarUrl != null && String(backendUser.avatarUrl).trim() !== ''
      ? String(backendUser.avatarUrl).trim()
      : backendUser.avatar_url != null && String(backendUser.avatar_url).trim() !== ''
        ? String(backendUser.avatar_url).trim()
        : '';
  const beCreated = backendUser.createdAt || backendUser.created_at;
  const fbPhone = phoneDigitsFromFirebasePhone(fbUser.phoneNumber);
  const fbPhoto = fbUser.photoURL?.trim() ? fbUser.photoURL.trim() : '';
  const fbName = fbUser.displayName?.trim() || '';
  const fbEmail = fbUser.email?.trim() || '';
  return {
    id: mongoId,
    phone: bePhone || fbPhone,
    email: beEmail || fbEmail || undefined,
    name: beName || fbName || undefined,
    ...(beDob ? { dateOfBirth: beDob } : {}),
    ...(beGender ? { gender: beGender } : {}),
    createdAt: beCreated || fbUser.metadata.creationTime || undefined,
    ...(beAvatar ? { avatarUrl: beAvatar } : fbPhoto ? { avatarUrl: fbPhoto } : {}),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = useState<AuthState>(initialState);

  const logout = useCallback(() => {
    void (async () => {
      try {
        await unregisterPushTokenWithBackend();
      } catch {
        // Endpoint may be missing or session already invalid — still log out locally.
      }
      await firebaseSignOutSafe();
      clearRideDetailCache();
      clearAuth();
      clearStoredTokens();
      clearLocationDeniedFlags();
      setState({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
        isAwaitingBackendSession: false,
        needsEmailVerification: false,
        pendingVerificationEmail: null,
      });
    })();
  }, []);

  const login = useCallback((user: User, accessToken: string, refreshTokenValue?: string | null) => {
    clearRideDetailCache();
    setAuthToken(accessToken);
    setRefreshToken(refreshTokenValue?.trim() ?? '');
    if (refreshTokenValue?.trim()) {
      void setStoredTokens(accessToken, refreshTokenValue.trim());
    }
    setState({
      user,
      token: accessToken,
      isAuthenticated: true,
      isLoading: false,
      isAwaitingBackendSession: false,
      needsEmailVerification: false,
      pendingVerificationEmail: null,
    });
  }, []);

  const setLoading = useCallback((isLoading: boolean) => {
    setState((prev) => ({ ...prev, isLoading }));
  }, []);

  const patchUser = useCallback((patch: Partial<User>) => {
    setState((prev) =>
      prev.user ? { ...prev, user: { ...prev.user, ...patch } } : prev
    );
  }, []);

  const refreshUser = useCallback(async () => {
    const auth = getFirebaseAuth();
    const u = auth?.currentUser;
    if (!u) return;
    try {
      await reload(u);
      const path = API.endpoints.auth.me.startsWith('/')
        ? API.endpoints.auth.me
        : `/${API.endpoints.auth.me}`;
      const { user: me } = await api.get<{ user: BackendAuthUser }>(path);
      const next = buildSessionUser(u, me);
      setState((prev) => {
        if (!prev.isAuthenticated || !prev.token || !prev.user) return prev;
        return {
          ...prev,
          user: { ...next, id: prev.user.id },
        };
      });
    } catch {
      // Leave existing user snapshot
    }
  }, []);

  const retrySessionAfterEmailVerified = useCallback(async (): Promise<{
    ok: boolean;
    message?: string;
  }> => {
    const auth = getFirebaseAuth();
    const fbUser = auth?.currentUser;
    if (!fbUser) {
      return { ok: false, message: 'No active session. Sign in again.' };
    }
    try {
      await reload(fbUser);
      const idToken = await fbUser.getIdToken(true);
      const exchanged = await exchangeFirebaseIdTokenForBackendSession(idToken);
      await setStoredTokens(exchanged.token, exchanged.refreshToken);
      setAuthToken(exchanged.token);
      setRefreshToken(exchanged.refreshToken);
      const user = buildSessionUser(fbUser, exchanged.user);
      setState({
        user,
        token: exchanged.token,
        isAuthenticated: true,
        isLoading: false,
        isAwaitingBackendSession: false,
        needsEmailVerification: false,
        pendingVerificationEmail: null,
      });
      return { ok: true };
    } catch (e) {
      if (e instanceof AuthExchangeError && e.code === 'EMAIL_NOT_VERIFIED') {
        return {
          ok: false,
          message: 'Email is still not verified. Open the link in your inbox, then try again.',
        };
      }
      const msg = e instanceof Error ? e.message : 'Could not sign in.';
      return { ok: false, message: msg };
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    setOnSessionExpired(() => {
      if (!cancelled) logout();
    });

    if (!isFirebaseAuthConfigured()) {
      if (__DEV__) {
        console.warn(
          '[Auth] Firebase env missing — set EXPO_PUBLIC_FIREBASE_* in .env (see .env.example).'
        );
      }
      setState((s) => ({
        ...s,
        isLoading: false,
        isAuthenticated: false,
        isAwaitingBackendSession: false,
        needsEmailVerification: false,
        pendingVerificationEmail: null,
      }));
      return () => {
        cancelled = true;
      };
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      setState((s) => ({
        ...s,
        isLoading: false,
        isAwaitingBackendSession: false,
      }));
      return () => {
        cancelled = true;
      };
    }

    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (cancelled) return;
      if (!fbUser) {
        clearAuth();
        clearRideDetailCache();
        setState({
          user: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
          isAwaitingBackendSession: false,
          needsEmailVerification: false,
          pendingVerificationEmail: null,
        });
        return;
      }
      setState((s) => ({
        ...s,
        isAwaitingBackendSession: true,
      }));
      try {
        const idToken = await fbUser.getIdToken();
        const exchanged = await exchangeFirebaseIdTokenForBackendSession(idToken);
        await setStoredTokens(exchanged.token, exchanged.refreshToken);
        setAuthToken(exchanged.token);
        setRefreshToken(exchanged.refreshToken);

        const user = buildSessionUser(fbUser, exchanged.user);
        setState({
          user,
          token: exchanged.token,
          isAuthenticated: true,
          isLoading: false,
          isAwaitingBackendSession: false,
          needsEmailVerification: false,
          pendingVerificationEmail: null,
        });
      } catch (e) {
        if (e instanceof AuthExchangeError && e.code === 'EMAIL_NOT_VERIFIED') {
          if (__DEV__) {
            console.warn('[Auth] Email not verified — open Firebase verification link, then Continue.');
          }
          clearAuth();
          await clearStoredTokens();
          setState({
            user: null,
            token: null,
            isAuthenticated: false,
            isLoading: false,
            isAwaitingBackendSession: false,
            needsEmailVerification: true,
            pendingVerificationEmail: fbUser.email ?? null,
          });
          return;
        }
        if (__DEV__) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(
            '[Auth] Session failed — if not a network issue: check EXPO_PUBLIC_API_URL and backend POST /api/auth/firebase (+ Firebase Admin).',
            msg
          );
        }
        clearAuth();
        await clearStoredTokens();
        await firebaseSignOutSafe();
        setState({
          user: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
          isAwaitingBackendSession: false,
          needsEmailVerification: false,
          pendingVerificationEmail: null,
        });
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [logout]);

  const value: AuthContextValue = {
    ...state,
    login,
    logout,
    setLoading,
    refreshUser,
    patchUser,
    retrySessionAfterEmailVerified,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx == null) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
