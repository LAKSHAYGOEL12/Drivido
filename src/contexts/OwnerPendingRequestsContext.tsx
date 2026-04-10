import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { RideListItem } from '../types/api';
import { ownerHasPendingSeatRequests } from '../utils/rideDisplay';
import { useAuth } from './AuthContext';
import api from '../services/api';
import { API } from '../constants/API';

type OwnerPendingRequestsContextValue = {
  /** True if any ride in the last synced list is yours and has a pending seat request. */
  hasOwnerPendingSeatRequests: boolean;
  /** Call when Your Rides (or similar) loads a merged ride list for the signed-in user. */
  syncFromRideList: (rides: RideListItem[], currentUserId: string | undefined) => void;
};

const OwnerPendingRequestsContext = createContext<OwnerPendingRequestsContextValue | undefined>(undefined);

export function OwnerPendingRequestsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { user } = useAuth();
  const [hasOwnerPendingSeatRequests, setHas] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const refreshInFlightRef = useRef(false);
  const lastRefreshMsRef = useRef(0);

  useEffect(() => {
    if (!user?.id?.trim()) setHas(false);
  }, [user?.id]);

  const syncFromRideList = useCallback((rides: RideListItem[], currentUserId: string | undefined) => {
    const uid = currentUserId?.trim();
    if (!uid) {
      setHas(false);
      return;
    }
    setHas(rides.some((r) => ownerHasPendingSeatRequests(r, uid)));
  }, []);

  const extractRideRows = useCallback((raw: unknown): RideListItem[] => {
    if (Array.isArray(raw)) return raw as RideListItem[];
    if (!raw || typeof raw !== 'object') return [];
    const root = raw as Record<string, unknown>;
    const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : null;
    const candidates: unknown[] = [
      root.rides,
      root.items,
      root.results,
      root.data,
      data?.rides,
      data?.items,
      data?.results,
    ];
    for (const c of candidates) {
      if (Array.isArray(c)) return c as RideListItem[];
    }
    return [];
  }, []);

  const refreshOwnerPendingFromServer = useCallback(async () => {
    const uid = user?.id?.trim();
    if (!uid) {
      setHas(false);
      return;
    }
    if (refreshInFlightRef.current) return;
    const now = Date.now();
    if (now - lastRefreshMsRef.current < 5000) return; // throttle noisy resume/focus churn
    refreshInFlightRef.current = true;
    lastRefreshMsRef.current = now;
    try {
      const published = await api.get(API.endpoints.rides.myPublished);
      const rides = extractRideRows(published);
      setHas(rides.some((r) => ownerHasPendingSeatRequests(r, uid)));
    } catch {
      // Keep previous badge state; next list sync/focus refresh will correct it.
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [extractRideRows, user?.id]);

  const value = useMemo(
    () => ({ hasOwnerPendingSeatRequests, syncFromRideList }),
    [hasOwnerPendingSeatRequests, syncFromRideList]
  );

  useEffect(() => {
    void refreshOwnerPendingFromServer();
  }, [refreshOwnerPendingFromServer]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if ((prev === 'background' || prev === 'inactive') && next === 'active') {
        void refreshOwnerPendingFromServer();
      }
    });
    return () => sub.remove();
  }, [refreshOwnerPendingFromServer]);

  return (
    <OwnerPendingRequestsContext.Provider value={value}>{children}</OwnerPendingRequestsContext.Provider>
  );
}

export function useOwnerPendingRequests(): OwnerPendingRequestsContextValue {
  const ctx = useContext(OwnerPendingRequestsContext);
  if (!ctx) {
    throw new Error('useOwnerPendingRequests must be used within OwnerPendingRequestsProvider');
  }
  return ctx;
}
