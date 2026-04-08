import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { RideListItem } from '../types/api';
import { ownerHasPendingSeatRequests } from '../utils/rideDisplay';
import { useAuth } from './AuthContext';

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

  const value = useMemo(
    () => ({ hasOwnerPendingSeatRequests, syncFromRideList }),
    [hasOwnerPendingSeatRequests, syncFromRideList]
  );

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
