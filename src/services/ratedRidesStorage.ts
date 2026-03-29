import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'drivido_rated_rides_v2_';
const MAX_PASSENGER_RIDES = 400;

export type RatedRidesCache = {
  /** As passenger: ride IDs where the user submitted a rating for the driver. */
  passengerRideIds: string[];
  /** As owner: rideId → passenger userIds already rated. */
  ownerByRide: Record<string, string[]>;
};

function key(userId: string): string {
  return `${KEY_PREFIX}${userId.trim()}`;
}

export async function loadRatedRidesCache(userId: string): Promise<RatedRidesCache> {
  const uid = userId.trim();
  if (!uid) return { passengerRideIds: [], ownerByRide: {} };
  try {
    const raw = await AsyncStorage.getItem(key(uid));
    if (!raw) return { passengerRideIds: [], ownerByRide: {} };
    const parsed = JSON.parse(raw) as RatedRidesCache;
    return {
      passengerRideIds: Array.isArray(parsed.passengerRideIds) ? parsed.passengerRideIds : [],
      ownerByRide: parsed.ownerByRide && typeof parsed.ownerByRide === 'object' ? parsed.ownerByRide : {},
    };
  } catch {
    return { passengerRideIds: [], ownerByRide: {} };
  }
}

async function saveRatedRidesCache(userId: string, cache: RatedRidesCache): Promise<void> {
  const uid = userId.trim();
  if (!uid) return;
  try {
    const pruned = [...new Set(cache.passengerRideIds.map((x) => x.trim()).filter(Boolean))].slice(
      0,
      MAX_PASSENGER_RIDES
    );
    await AsyncStorage.setItem(
      key(uid),
      JSON.stringify({ ...cache, passengerRideIds: pruned })
    );
  } catch {
    // ignore
  }
}

export async function mergePassengerRatedRide(userId: string, rideId: string): Promise<void> {
  const rid = rideId.trim();
  if (!userId.trim() || !rid) return;
  const cache = await loadRatedRidesCache(userId);
  if (cache.passengerRideIds.includes(rid)) return;
  cache.passengerRideIds = [rid, ...cache.passengerRideIds.filter((x) => x !== rid)];
  await saveRatedRidesCache(userId, cache);
}

export async function mergeOwnerRatedPassenger(
  userId: string,
  rideId: string,
  passengerUserId: string
): Promise<void> {
  const rid = rideId.trim();
  const pid = passengerUserId.trim();
  if (!userId.trim() || !rid || !pid) return;
  const cache = await loadRatedRidesCache(userId);
  const existing = cache.ownerByRide[rid] ?? [];
  if (existing.includes(pid)) return;
  cache.ownerByRide = { ...cache.ownerByRide, [rid]: [...existing, pid] };
  await saveRatedRidesCache(userId, cache);
}
