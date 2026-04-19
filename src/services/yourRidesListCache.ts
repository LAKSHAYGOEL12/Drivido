import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RideListItem } from '../types/api';

const CACHE_PREFIX = 'drivido.yourRides.v1:';

export type YourRidesListCachePayload = {
  rides: RideListItem[];
  bookedIds: string[];
  allRidesCount: number;
  savedAt: number;
};

function cacheKey(userId: string): string {
  return `${CACHE_PREFIX}${userId.trim()}`;
}

/** Persist last successful merged list for offline / cold tab open. */
export async function saveYourRidesListCache(
  userId: string,
  payload: YourRidesListCachePayload
): Promise<void> {
  const uid = userId.trim();
  if (!uid) return;
  try {
    const raw = JSON.stringify(payload);
    if (raw.length > 900_000) return;
    await AsyncStorage.setItem(cacheKey(uid), raw);
  } catch {
    /* ignore quota / serialization */
  }
}

export async function loadYourRidesListCache(userId: string): Promise<YourRidesListCachePayload | null> {
  const uid = userId.trim();
  if (!uid) return null;
  try {
    const raw = await AsyncStorage.getItem(cacheKey(uid));
    if (!raw) return null;
    const p = JSON.parse(raw) as YourRidesListCachePayload;
    if (!Array.isArray(p.rides) || p.rides.length === 0) return null;
    return {
      rides: p.rides,
      bookedIds: Array.isArray(p.bookedIds) ? p.bookedIds.map(String) : [],
      allRidesCount: typeof p.allRidesCount === 'number' ? p.allRidesCount : p.rides.length,
      savedAt: typeof p.savedAt === 'number' ? p.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export async function clearYourRidesListCache(userId: string): Promise<void> {
  const uid = userId.trim();
  if (!uid) return;
  try {
    await AsyncStorage.removeItem(cacheKey(uid));
  } catch {
    /* ignore */
  }
}
