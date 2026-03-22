/**
 * When the owner cancels a ride, many backends DELETE the row or omit it from GET /rides,
 * so the ride never appears under Past rides. We keep a minimal snapshot locally (per user)
 * so Past rides can still list owner-cancelled trips.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'drivido_owner_cancelled_rides_v1_';
const MAX = 50;

function key(userId: string): string {
  return `${KEY_PREFIX}${userId.trim()}`;
}

export async function recordOwnerCancelledRide(userId: string, ride: Record<string, unknown>): Promise<void> {
  const uid = userId.trim();
  if (!uid) return;
  try {
    const snapshot = {
      ...ride,
      status: 'cancelled',
      userId: uid,
      viewerIsOwner: true,
    };
    const raw = await AsyncStorage.getItem(key(uid));
    const list: Record<string, unknown>[] = raw ? JSON.parse(raw) : [];
    const next = [snapshot, ...list.filter((x) => String(x?.id ?? '') !== String(ride.id ?? ''))].slice(
      0,
      MAX
    );
    await AsyncStorage.setItem(key(uid), JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export async function loadOwnerCancelledRides(userId: string): Promise<Record<string, unknown>[]> {
  const uid = userId.trim();
  if (!uid) return [];
  try {
    const raw = await AsyncStorage.getItem(key(uid));
    if (!raw) return [];
    const list = JSON.parse(raw) as Record<string, unknown>[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
