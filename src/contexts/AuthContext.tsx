import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  setAuthToken,
  setRefreshToken,
  clearAuth,
  setOnSessionExpired,
} from '../services/api';
import { getStoredTokens, setStoredTokens, clearStoredTokens } from '../services/token-storage';
import { clearLocationDeniedFlags } from '../services/location-storage';
import { clearRideDetailCache } from '../services/rideDetailCache';
import { unregisterPushTokenWithBackend } from '../services/pushTokenRegistration';
import api from '../services/api';
import { API } from '../constants/API';
import { pickAvatarUrlFromRecord } from '../utils/avatarUrl';

export type User = {
  id: string;
  phone: string;
  email?: string;
  name?: string;
  createdAt?: string;
  /** Profile photo URL from backend (HTTPS or app file URI after pick). */
  avatarUrl?: string;
};

type AuthState = {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
};

type AuthContextValue = AuthState & {
  login: (user: User, accessToken: string, refreshToken?: string | null) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  /** Re-fetch `/auth/me` and merge into `user` (e.g. after avatar upload). */
  refreshUser: () => Promise<void>;
  /** Shallow merge into current user (instant UI after upload). */
  patchUser: (patch: Partial<User>) => void;
};

const initialState: AuthState = {
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** /auth/me response shape. Align with backend. */
interface MeResponse {
  user: {
    id?: string;
    _id?: string;
    phone: string;
    email?: string;
    name?: string;
    createdAt?: string;
    created_at?: string;
    avatarUrl?: string | null;
    avatar_url?: string | null;
    avatarUri?: string | null;
    photoUrl?: string | null;
    photo_url?: string | null;
  };
}

function userFromMe(me: MeResponse['user']): User {
  const id = typeof me.id === 'string' ? me.id : String(me._id ?? '');
  const meRec = me as unknown as Record<string, unknown>;
  const avatarUrl = pickAvatarUrlFromRecord(meRec);
  return {
    id,
    phone: me.phone ?? '',
    email: me.email,
    name: me.name,
    createdAt:
      (typeof me.createdAt === 'string' && me.createdAt.trim()) ||
      (typeof me.created_at === 'string' && me.created_at.trim()) ||
      undefined,
    ...(avatarUrl ? { avatarUrl } : {}),
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
      clearRideDetailCache();
      clearAuth();
      clearStoredTokens();
      clearLocationDeniedFlags();
      setState({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
      });
    })();
  }, []);

  const login = useCallback((user: User, accessToken: string, refreshTokenValue?: string | null) => {
    clearRideDetailCache();
    const refresh = refreshTokenValue ?? accessToken;
    setAuthToken(accessToken);
    setRefreshToken(refresh);
    setStoredTokens(accessToken, refresh);
    setState({
      user,
      token: accessToken,
      isAuthenticated: true,
      isLoading: false,
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
    try {
      const res = await api.get<MeResponse>(API.endpoints.auth.me);
      const u = res?.user ? userFromMe(res.user) : null;
      if (u) {
        setState((prev) =>
          prev.isAuthenticated && prev.token
            ? { ...prev, user: u }
            : prev
        );
      }
    } catch {
      // Session may be invalid — leave state to existing guards.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    setOnSessionExpired(() => {
      if (!cancelled) logout();
    });

    (async () => {
      const tokens = await getStoredTokens();
      if (!tokens || cancelled) {
        setState((prev) => ({ ...prev, isLoading: false }));
        return;
      }
      setAuthToken(tokens.accessToken);
      setRefreshToken(tokens.refreshToken);
      try {
        const res = await api.get<MeResponse>(API.endpoints.auth.me);
        if (cancelled) return;
        const user = res?.user ? userFromMe(res.user) : null;
        if (user) {
          setState({
            user,
            token: tokens.accessToken,
            isAuthenticated: true,
            isLoading: false,
          });
        } else {
          await clearStoredTokens();
          clearRideDetailCache();
          clearAuth();
          setState({ ...initialState, isLoading: false });
        }
      } catch {
        if (cancelled) return;
        await clearStoredTokens();
        clearRideDetailCache();
        clearAuth();
        setState({ ...initialState, isLoading: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [logout]);

  const value: AuthContextValue = {
    ...state,
    login,
    logout,
    setLoading,
    refreshUser,
    patchUser,
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
