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
import { unregisterPushTokenWithBackend } from '../services/pushTokenApi';
import api from '../services/api';
import { API } from '../constants/API';

export type User = {
  id: string;
  phone: string;
  email?: string;
  name?: string;
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
  };
}

function userFromMe(me: MeResponse['user']): User {
  const id = typeof me.id === 'string' ? me.id : String(me._id ?? '');
  return {
    id,
    phone: me.phone ?? '',
    email: me.email,
    name: me.name,
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
