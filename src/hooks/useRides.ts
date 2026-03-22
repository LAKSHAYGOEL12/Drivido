import { useCallback, useEffect, useState } from 'react';
import { useLocation } from './useLocation';

export type Ride = {
  id: string;
  from: string;
  to: string;
  date: string;
  time: string;
  price: string;
  seats: number;
  driverName: string;
  latitude: number;
  longitude: number;
};

type UseRidesOptions = {
  radiusKm?: number;
  enabled?: boolean;
};

/**
 * Search rides near current location. Depends on useLocation (GPS).
 * Replace fetch with your API.
 */
export function useRides(options: UseRidesOptions = {}) {
  const { radiusKm = 50, enabled = true } = options;
  const { location, requestLocation, isLoading: locationLoading, error: locationError } = useLocation();
  const [rides, setRides] = useState<Ride[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRides = useCallback(async () => {
    if (!location && enabled) {
      await requestLocation();
      return;
    }
    if (!location || !enabled) return;
    setIsLoading(true);
    setError(null);
    try {
      // TODO: replace with your API, e.g. GET /rides?lat=&lon=&radius=
      const res = await fetch(
        `https://api.example.com/rides?lat=${location.latitude}&lon=${location.longitude}&radius=${radiusKm}`
      );
      if (!res.ok) throw new Error('Failed to fetch rides');
      const data = (await res.json()) as Ride[];
      setRides(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rides');
      setRides([]);
    } finally {
      setIsLoading(false);
    }
  }, [location, radiusKm, enabled, requestLocation]);

  useEffect(() => {
    if (enabled && location) fetchRides();
  }, [enabled, location?.latitude, location?.longitude, radiusKm]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    rides,
    isLoading: isLoading || locationLoading,
    error: error ?? locationError,
    refetch: fetchRides,
    hasLocation: !!location,
  };
}
