import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { hasAuthAccessToken } from './api';
import { API } from '../constants/API';

export type PlaceRecentFieldType = 'pickup' | 'destination';

export type PlaceRecentEntry = {
  placeId: string;
  title: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  fieldType: PlaceRecentFieldType;
  lastUsedAt: number; // epoch ms
};

const KEY = 'drivido_place_recents_v1';

function guestKey() {
  return 'guest';
}

function storageKey(userKey: string | undefined, fieldType: PlaceRecentFieldType): string {
  const u = (userKey ?? '').trim();
  return `${KEY}:${(u || guestKey()).toLowerCase()}:${fieldType}`;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function normalize(raw: unknown): PlaceRecentEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const placeId = String(r.placeId ?? '').trim();
  const title = String(r.title ?? '').trim();
  const formattedAddress = String(r.formattedAddress ?? '').trim();
  const fieldType = (String(r.fieldType ?? '') as PlaceRecentFieldType) || 'pickup';
  const lat = r.latitude;
  const lng = r.longitude;
  const lastUsedAt = r.lastUsedAt;

  if (!placeId || !title || !formattedAddress) return null;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;
  if (fieldType !== 'pickup' && fieldType !== 'destination') return null;

  const last = isFiniteNumber(lastUsedAt) ? lastUsedAt : Date.now();

  return {
    placeId,
    title,
    formattedAddress,
    latitude: lat,
    longitude: lng,
    fieldType,
    lastUsedAt: last,
  };
}

async function loadLocal(
  fieldType: PlaceRecentFieldType,
  userKey?: string
): Promise<PlaceRecentEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userKey, fieldType));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalize).filter((x): x is PlaceRecentEntry => Boolean(x)).slice(0, 8);
  } catch {
    return [];
  }
}

async function saveLocal(
  fieldType: PlaceRecentFieldType,
  list: PlaceRecentEntry[],
  userKey?: string
): Promise<void> {
  await AsyncStorage.setItem(storageKey(userKey, fieldType), JSON.stringify(list.slice(0, 8)));
}

export async function loadPlaceRecents(
  fieldType: PlaceRecentFieldType,
  userKey?: string
): Promise<PlaceRecentEntry[]> {
  const local = await loadLocal(fieldType, userKey);
  if (!hasAuthAccessToken()) {
    return local;
  }
  try {
    const res = await api.get<unknown>(API.endpoints.recentPlaces.list);
    const arr = Array.isArray(res)
      ? res
      : (res as { recents?: unknown[]; data?: { recents?: unknown[] } })?.recents ??
        (res as { recents?: unknown[]; data?: { recents?: unknown[] } })?.data?.recents ??
        [];
    const normalized = (arr as unknown[])
      .map(normalize)
      .filter((x): x is PlaceRecentEntry => Boolean(x))
      .filter((x) => x.fieldType === fieldType)
      .slice(0, 8);
    await saveLocal(fieldType, normalized, userKey);
    return normalized;
  } catch {
    return local;
  }
}

export async function upsertPlaceRecent(
  entry: Omit<PlaceRecentEntry, 'lastUsedAt'> & { lastUsedAt?: number },
  userKey?: string
): Promise<PlaceRecentEntry[]> {
  const nextLastUsedAt = entry.lastUsedAt ?? Date.now();
  const base: PlaceRecentEntry = {
    ...entry,
    lastUsedAt: nextLastUsedAt,
  };

  if (!hasAuthAccessToken()) {
    const list = await loadLocal(base.fieldType, userKey);
    const filtered = list.filter((x) => x.placeId !== base.placeId);
    const updated = [base, ...filtered].slice(0, 8);
    await saveLocal(base.fieldType, updated, userKey);
    return updated;
  }

  try {
    await api.post(API.endpoints.recentPlaces.upsert, base);
    return loadPlaceRecents(base.fieldType, userKey);
  } catch {
    const list = await loadLocal(base.fieldType, userKey);
    const filtered = list.filter((x) => x.placeId !== base.placeId);
    const updated = [base, ...filtered].slice(0, 8);
    await saveLocal(base.fieldType, updated, userKey);
    return updated;
  }
}

