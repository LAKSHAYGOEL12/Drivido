import { useCallback } from 'react';
import { useAuth as useAuthContext } from '../contexts/AuthContext';
import type { User } from '../contexts/AuthContext';

/**
 * Auth state + helpers. Use within AuthProvider.
 */
export function useAuth() {
  const ctx = useAuthContext();

  const requireAuth = useCallback((): User | null => {
    if (!ctx.isAuthenticated || !ctx.user || ctx.needsProfileCompletion) return null;
    return ctx.user;
  }, [ctx.isAuthenticated, ctx.needsProfileCompletion, ctx.user]);

  return {
    ...ctx,
    requireAuth,
  };
}

export type { User } from '../contexts/AuthContext';
