import { API } from '../constants/API';
import { pickAvatarUrlFromRecord } from '../utils/avatarUrl';
import api from './api';

/** Common keys on upload / profile JSON where the server puts the file URL. */
const URL_KEYS = [
  'url',
  'fileUrl',
  'file_url',
  'avatarUrl',
  'avatar_url',
  'photoUrl',
  'photo_url',
  'imageUrl',
  'image_url',
  'path',
  'location',
] as const;

function scrapeUrlFields(obj: Record<string, unknown>): string | null {
  for (const k of URL_KEYS) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function extractAvatarUrlFromResponse(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (typeof raw !== 'object') return null;
  const root = raw as Record<string, unknown>;
  const layers: Record<string, unknown>[] = [root];
  const data = root.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    layers.push(data as Record<string, unknown>);
  }
  for (const layer of layers) {
    const scraped = scrapeUrlFields(layer);
    if (scraped) return scraped;
    const picked = pickAvatarUrlFromRecord(layer);
    if (picked) return picked;
    const user = layer.user;
    if (user && typeof user === 'object') {
      const u = user as Record<string, unknown>;
      const s = scrapeUrlFields(u) ?? pickAvatarUrlFromRecord(u);
      if (s) return s;
    }
  }
  return null;
}

export async function uploadUserAvatar(localUri: string): Promise<string> {
  const form = new FormData();
  const uriLower = localUri.toLowerCase();
  let mime = 'image/jpeg';
  let filename = 'avatar.jpg';
  if (uriLower.endsWith('.png')) {
    mime = 'image/png';
    filename = 'avatar.png';
  } else if (uriLower.endsWith('.webp')) {
    mime = 'image/webp';
    filename = 'avatar.webp';
  }
  form.append('photo', { uri: localUri, name: filename, type: mime } as unknown as Blob);

  const res = await api.postForm<unknown>(API.endpoints.user.avatar, form, { timeout: 60000 });
  const url = extractAvatarUrlFromResponse(res);
  if (!url) {
    throw new Error('Server did not return avatar URL');
  }
  return url;
}

export async function deleteUserAvatar(): Promise<void> {
  await api.delete(API.endpoints.user.avatar);
}
