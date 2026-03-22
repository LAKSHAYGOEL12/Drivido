import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as Location from 'expo-location';
import {
  getLocationDeniedFromPicker,
  setLocationDeniedFromPicker as persistDeniedFromPicker,
} from '../services/location-storage';

export type LocationCoords = {
  latitude: number;
  longitude: number;
  altitude?: number | null;
  accuracy?: number | null;
};

type LocationState = {
  location: LocationCoords | null;
  isLoading: boolean;
  error: string | null;
  /** Hide "Use current location" until logout+login after user denied twice. */
  canShowUseCurrentLocation: boolean;
};

type LocationContextValue = LocationState & {
  setLocation: (coords: LocationCoords | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  /** Returns location or null if permission denied / error. Prompts for permission when needed. */
  requestLocation: () => Promise<LocationCoords | null>;
  /** Prefetch in background when user logs in; does not prompt. Uses cache first for speed. */
  prefetchLocation: () => Promise<void>;
  clearLocation: () => void;
};

const initialState: LocationState = {
  location: null,
  isLoading: false,
  error: null,
  canShowUseCurrentLocation: true,
};

const LocationContext = createContext<LocationContextValue | null>(null);

const LAST_KNOWN_MAX_AGE_MS = 120_000; // 2 min

function toCoords(loc: Location.LocationObject): LocationCoords {
  return {
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    altitude: loc.coords.altitude ?? null,
    accuracy: loc.coords.accuracy ?? null,
  };
}

export function LocationProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = useState<LocationState>(initialState);

  useEffect(() => {
    let cancelled = false;
    getLocationDeniedFromPicker().then((denied) => {
      if (!cancelled) {
        setState((prev) => ({ ...prev, canShowUseCurrentLocation: !denied }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocation = useCallback((location: LocationCoords | null) => {
    setState((prev) => ({ ...prev, location, error: null }));
  }, []);

  const setLoading = useCallback((isLoading: boolean) => {
    setState((prev) => ({ ...prev, isLoading }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState((prev) => ({ ...prev, error, isLoading: false }));
  }, []);

  const requestLocation = useCallback(async (): Promise<LocationCoords | null> => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        await persistDeniedFromPicker(true);
        setState((prev) => ({
          ...prev,
          error: 'Location permission denied',
          isLoading: false,
          canShowUseCurrentLocation: false,
        }));
        return null;
      }
      // Try cache first for instant result when possible
      try {
        const last = await Location.getLastKnownPositionAsync({
          maxAge: LAST_KNOWN_MAX_AGE_MS,
        });
        if (last) {
          const coords = toCoords(last);
          setState((prev) => ({ ...prev, location: coords, error: null, isLoading: false }));
          // Optionally refresh in background (don't await)
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
            mayShowUserSettingsDialog: false,
          })
            .then((loc) => {
              setState((prev) => ({ ...prev, location: toCoords(loc) }));
            })
            .catch(() => {});
          return coords;
        }
      } catch {
        // ignore lastKnown failure
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        mayShowUserSettingsDialog: true,
      });
      const coords = toCoords(loc);
      setState((prev) => ({ ...prev, location: coords, error: null, isLoading: false }));
      return coords;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to get location';
      setState((prev) => ({ ...prev, error: msg, isLoading: false }));
      return null;
    }
  }, []);

  const prefetchLocation = useCallback(async (): Promise<void> => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return;
      try {
        const last = await Location.getLastKnownPositionAsync({
          maxAge: LAST_KNOWN_MAX_AGE_MS,
        });
        if (last) {
          setState((prev) => ({ ...prev, location: toCoords(last) }));
        }
      } catch {
        // ignore
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setState((prev) => ({ ...prev, location: toCoords(loc) }));
    } catch {
      // silent: prefetch must not show errors or prompt
    }
  }, []);

  const clearLocation = useCallback(() => {
    setState(initialState);
  }, []);

  const value: LocationContextValue = {
    ...state,
    setLocation,
    setLoading,
    setError,
    requestLocation,
    prefetchLocation,
    clearLocation,
  };

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationContextValue {
  const ctx = useContext(LocationContext);
  if (ctx == null) {
    throw new Error('useLocation must be used within LocationProvider');
  }
  return ctx;
}
