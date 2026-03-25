import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'drivido_rating_prompt_handled_v1_';
const MAX = 200;

function key(userId: string): string {
  return `${KEY_PREFIX}${userId.trim()}`;
}

export async function hasHandledRatingPrompt(userId: string, rideId: string): Promise<boolean> {
  const uid = userId.trim();
  const rid = rideId.trim();
  if (!uid || !rid) return false;
  try {
    const raw = await AsyncStorage.getItem(key(uid));
    if (!raw) return false;
    const list = JSON.parse(raw) as string[];
    return Array.isArray(list) && list.includes(rid);
  } catch {
    return false;
  }
}

export async function markRatingPromptHandled(userId: string, rideId: string): Promise<void> {
  const uid = userId.trim();
  const rid = rideId.trim();
  if (!uid || !rid) return;
  try {
    const raw = await AsyncStorage.getItem(key(uid));
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    const next = [rid, ...list.filter((x) => x !== rid)].slice(0, MAX);
    await AsyncStorage.setItem(key(uid), JSON.stringify(next));
  } catch {
    // ignore
  }
}
