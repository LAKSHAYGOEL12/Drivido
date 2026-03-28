import { API } from '../constants/API';
import api from './api';

function extractAvatarUrlFromResponse(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const root = raw as Record<string, unknown>;
  const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root;
  const user = data.user && typeof data.user === 'object' ? (data.user as Record<string, unknown>) : null;
  const candidates = [
    data.avatarUrl,
    data.avatar_url,
    data.photoUrl,
    data.photo_url,
    user?.avatarUrl,
    user?.avatar_url,
    user?.photoUrl,
    user?.photo_url,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

/** Upload profile photo. Backend: POST multipart /api/user/avatar with field `photo` or `avatar`. */
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

/** Remove avatar. Backend: DELETE /api/user/avatar */
export async function deleteUserAvatar(): Promise<void> {
  await api.delete(API.endpoints.user.avatar);
}
