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
  parseAuthMePayload,
  type BackendAuthUser,
} from '../services/backendAuthExchange';
import { pickAvatarUrlFromRecord } from '../utils/avatarUrl';
import { normalizeVehiclesFromRecord, type UserProfileVehicle } from '../utils/userVehicle';
import { validation, normalizePhoneForValidation } from '../constants/validation';

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
  /** Vehicle display name / model (e.g. Toyota Innova). */
  vehicleModel?: string;
  /** Alias some APIs use for model name */
  vehicleName?: string;
  licensePlate?: string;
  vehicleColor?: string;
  /** From GET /auth/me — up to 2 vehicles (see POST /user/vehicles). */
  vehicles?: UserProfileVehicle[];
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
  /** JWT is valid but required profile fields (DOB, gender, phone) are missing — block main app until Complete Profile. */
  needsProfileCompletion: boolean;
};

type AuthContextValue = AuthState & {
  login: (user: User, accessToken: string, refreshToken?: string | null) => void;
  /** Ends Firebase + API session; returns a promise that resolves when local state is cleared. */
  logout: () => Promise<void>;
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
  needsProfileCompletion: false,
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Backend Mongo `user.id`, cleared when logged out. Updated **synchronously** whenever session
 * user is set (before React re-renders). Used by guest-login callbacks that may run before
 * screen refs/context receive the new user — e.g. when a nav overlay would otherwise unmount.
 */
export const authBackendUserIdRef = { current: '' as string };

function syncAuthBackendUserIdRef(user: User | null): void {
  authBackendUserIdRef.current = user ? String(user.id ?? '').trim() : '';
}

/** Merge GET /auth/me into local user; drop mirrored legacy vehicle fields when the API reports no vehicles. */
function mergeUserWithMe(prev: User, next: User): User {
  const user: User = { ...prev, ...next, id: prev.id };
  if (Array.isArray(next.vehicles) && next.vehicles.length === 0) {
    return {
      ...user,
      vehicles: [],
      vehicleModel: undefined,
      vehicleName: undefined,
      licensePlate: undefined,
      vehicleColor: undefined,
    };
  }
  return user;
}

function strField(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'object' && v !== null && '$date' in (v as object)) {
    const d = (v as { $date?: string }).$date;
    return typeof d === 'string' ? d.trim() : '';
  }
  return '';
}

/** Merge Mongo user from POST /auth/firebase (or GET /auth/me) with Firebase Auth display/photo. */
function buildSessionUser(fbUser: FirebaseUser, backendUser: BackendAuthUser): User {
  const mongoId = String(backendUser.id || backendUser._id || '').trim();
  if (!mongoId) {
    throw new Error('Backend user missing id');
  }
  const rec = backendUser as unknown as Record<string, unknown>;
  const beEmail = backendUser.email != null ? String(backendUser.email).trim() : '';
  const beName = backendUser.name != null ? String(backendUser.name).trim() : '';
  const bePhone = backendUser.phone != null ? String(backendUser.phone).trim() : '';
  const beDob =
    strField(rec.dateOfBirth) ||
    strField(rec.date_of_birth) ||
    strField(rec.dob) ||
    '';
  const beGender =
    strField(rec.gender) ||
    strField(rec.userGender) ||
    strField(rec.user_gender) ||
    '';
  const beAvatar =
    (pickAvatarUrlFromRecord(backendUser as unknown as Record<string, unknown>) ?? '').trim();
  const beCreated = backendUser.createdAt || backendUser.created_at;
  const fbPhone = phoneDigitsFromFirebasePhone(fbUser.phoneNumber);
  const fbName = fbUser.displayName?.trim() || '';
  const fbEmail = fbUser.email?.trim() || '';
  const beVehicleModel =
    strField(rec.vehicleModel) ||
    strField(rec.vehicle_name) ||
    strField(rec.vehicle_model) ||
    '';
  const beLicense =
    strField(rec.licensePlate) ||
    strField(rec.license_plate) ||
    strField(rec.vehicleNumber) ||
    strField(rec.vehicle_number) ||
    '';
  const beVehicleColor = strField(rec.vehicleColor) || strField(rec.vehicle_color) || '';
  const vehicleListKeyPresent =
    Object.prototype.hasOwnProperty.call(rec, 'vehicles') ||
    Object.prototype.hasOwnProperty.call(rec, 'userVehicles') ||
    Object.prototype.hasOwnProperty.call(rec, 'user_vehicles');
  const beVehicles = vehicleListKeyPresent ? normalizeVehiclesFromRecord(rec) : [];

  const baseUser: User = {
    id: mongoId,
    phone: bePhone || fbPhone,
    email: beEmail || fbEmail || undefined,
    name: beName || fbName || undefined,
    ...(beDob ? { dateOfBirth: beDob } : {}),
    ...(beGender ? { gender: beGender } : {}),
    createdAt: beCreated || fbUser.metadata.creationTime || undefined,
    /** Only backend/Mongo avatar — Firebase `photoURL` was overwriting uploaded profile photos on refresh. */
    ...(beAvatar ? { avatarUrl: beAvatar } : {}),
  };

  /** No `vehicles` array on payload — legacy flat fields only (do not set `vehicles`; Profile uses them). */
  if (!vehicleListKeyPresent) {
    if (beVehicleModel && beLicense) {
      return {
        ...baseUser,
        vehicleModel: beVehicleModel,
        licensePlate: beLicense,
        ...(beVehicleColor ? { vehicleColor: beVehicleColor } : {}),
      };
    }
    return baseUser;
  }

  const primary = beVehicles[0];
  const withList: User = { ...baseUser, vehicles: beVehicles };
  if (beVehicles.length === 0) {
    return withList;
  }
  const legacyModel = primary?.vehicleModel || beVehicleModel;
  const legacyLicense = primary?.licensePlate || beLicense;
  const legacyColor = primary?.vehicleColor || beVehicleColor;
  return {
    ...withList,
    ...(legacyModel ? { vehicleModel: legacyModel } : {}),
    ...(legacyLicense ? { licensePlate: legacyLicense } : {}),
    ...(legacyColor ? { vehicleColor: legacyColor } : {}),
  };
}

export function isUserProfileComplete(user: User | null): boolean {
  if (!user) return false;
  const dob = (user.dateOfBirth ?? '').trim();
  const g = (user.gender ?? '').trim();
  if (!validation.dateOfBirth(dob)) return false;
  if (!validation.gender(g)) return false;
  return normalizePhoneForValidation(user.phone ?? '').length === 10;
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = useState<AuthState>(initialState);

  const logout = useCallback((): Promise<void> => {
    return (async () => {
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
      syncAuthBackendUserIdRef(null);
      setState({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
        isAwaitingBackendSession: false,
        needsEmailVerification: false,
        pendingVerificationEmail: null,
        needsProfileCompletion: false,
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
    syncAuthBackendUserIdRef(user);
    const profileComplete = isUserProfileComplete(user);
    setState({
      user,
      token: accessToken,
      isAuthenticated: true,
      isLoading: false,
      isAwaitingBackendSession: false,
      needsEmailVerification: false,
      pendingVerificationEmail: null,
      needsProfileCompletion: !profileComplete,
    });
  }, []);

  const setLoading = useCallback((isLoading: boolean) => {
    setState((prev) => ({ ...prev, isLoading }));
  }, []);

  const patchUser = useCallback((patch: Partial<User>) => {
    setState((prev) => {
      if (!prev.user) return prev;
      const user: User = { ...prev.user, ...patch };
      return {
        ...prev,
        user,
        needsProfileCompletion: !isUserProfileComplete(user),
      };
    });
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
      const body = await api.get<unknown>(path);
      const me = parseAuthMePayload(body);
      if (!me || !(String(me.id ?? me._id ?? '').trim())) return;
      const next = buildSessionUser(u, me);
      setState((prev) => {
        if (!prev.isAuthenticated || !prev.token || !prev.user) return prev;
        /** Merge so a just-uploaded `avatarUrl` is not wiped when GET /auth/me omits photo fields. */
        const user = mergeUserWithMe(prev.user, next);
        return {
          ...prev,
          user,
          needsProfileCompletion: !isUserProfileComplete(user),
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
      syncAuthBackendUserIdRef(user);
      const profileComplete = isUserProfileComplete(user);
      setState({
        user,
        token: exchanged.token,
        isAuthenticated: true,
        isLoading: false,
        isAwaitingBackendSession: false,
        needsEmailVerification: false,
        pendingVerificationEmail: null,
        needsProfileCompletion: !profileComplete,
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
      syncAuthBackendUserIdRef(null);
      setState((s) => ({
        ...s,
        isLoading: false,
        isAuthenticated: false,
        isAwaitingBackendSession: false,
        needsEmailVerification: false,
        pendingVerificationEmail: null,
        needsProfileCompletion: false,
      }));
      return () => {
        cancelled = true;
      };
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      syncAuthBackendUserIdRef(null);
      setState((s) => ({
        ...s,
        isLoading: false,
        isAwaitingBackendSession: false,
        needsProfileCompletion: false,
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
        syncAuthBackendUserIdRef(null);
        setState({
          user: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
          isAwaitingBackendSession: false,
          needsEmailVerification: false,
          pendingVerificationEmail: null,
          needsProfileCompletion: false,
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
        syncAuthBackendUserIdRef(user);
        const profileComplete = isUserProfileComplete(user);
        setState({
          user,
          token: exchanged.token,
          isAuthenticated: true,
          isLoading: false,
          isAwaitingBackendSession: false,
          needsEmailVerification: false,
          pendingVerificationEmail: null,
          needsProfileCompletion: !profileComplete,
        });
      } catch (e) {
        if (e instanceof AuthExchangeError && e.code === 'EMAIL_NOT_VERIFIED') {
          if (__DEV__) {
            console.warn('[Auth] Email not verified — open Firebase verification link, then Continue.');
          }
          clearAuth();
          await clearStoredTokens();
          syncAuthBackendUserIdRef(null);
          setState({
            user: null,
            token: null,
            isAuthenticated: false,
            isLoading: false,
            isAwaitingBackendSession: false,
            needsEmailVerification: true,
            pendingVerificationEmail: fbUser.email ?? null,
            needsProfileCompletion: false,
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
        syncAuthBackendUserIdRef(null);
        setState({
          user: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
          isAwaitingBackendSession: false,
          needsEmailVerification: false,
          pendingVerificationEmail: null,
          needsProfileCompletion: false,
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
