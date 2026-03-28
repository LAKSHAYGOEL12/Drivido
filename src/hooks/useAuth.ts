import { useCallback } from 'react';
import { useAuth as useAuthContext } from '../contexts/AuthContext';
import type { User } from '../contexts/AuthContext';

/**
 * Auth state + helpers. Use within AuthProvider.
 */
export function useAuth() {
  const ctx = useAuthContext();

  const loginWithPhone = useCallback(
    (user: Pick<User, 'id' | 'phone' | 'name'>, accessToken: string, refreshToken?: string | null) => {
      ctx.setLoading(true);
      ctx.login(user, accessToken, refreshToken ?? accessToken);
      ctx.setLoading(false);
    },
    [ctx]
  );

  const requireAuth = useCallback((): User | null => {
    if (!ctx.isAuthenticated || !ctx.user) return null;
    return ctx.user;
  }, [ctx.isAuthenticated, ctx.user]);

  return {
    ...ctx,
    loginWithPhone,
    requireAuth,
  };
}

export type { User } from '../contexts/AuthContext';
