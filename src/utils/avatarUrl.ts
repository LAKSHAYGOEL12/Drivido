function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Normalize Mongo/string ids for comparison. */
export function stringifyApiUserId(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && '$oid' in (value as object)) {
    const oid = (value as { $oid?: unknown }).$oid;
    if (typeof oid === 'string') return oid.trim();
  }
  try {
    return String(value).trim();
  } catch {
    return '';
  }
}

/** Normalize profile photo URL from API (any common key / nested `user` / `profile`). */
export function pickAvatarUrlFromRecord(r: Record<string, unknown> | undefined | null): string | undefined {
  if (!r) return undefined;
  const direct =
    r.avatarUrl ??
    r.avatar_url ??
    r.photoUrl ??
    r.photo_url ??
    r.photoURL ??
    r.profilePhoto ??
    r.profile_photo ??
    r.profileImageUrl ??
    r.profile_image_url ??
    r.avatarUri ??
    r.avatar_uri ??
    r.avatar ??
    r.picture ??
    r.profilePicture ??
    r.profile_picture ??
    r.imageUrl ??
    r.image_url ??
    r.headshotUrl ??
    r.headshot_url ??
    r.thumbnailUrl ??
    r.thumbnail_url ??
    r.publicAvatarUrl ??
    r.public_avatar_url;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  if (typeof r.image === 'string' && r.image.trim()) return r.image.trim();

  const profile = asObject(r.profile);
  if (profile) {
    const fromProfile = pickAvatarUrlFromRecord(profile);
    if (fromProfile) return fromProfile;
  }

  const nestedUser =
    r.user && typeof r.user === 'object' ? pickAvatarUrlFromRecord(r.user as Record<string, unknown>) : undefined;
  return nestedUser;
}

const SUBJECT_LIKE_KEYS = [
  'ratedUser',
  'toUser',
  'aboutUser',
  'userProfile',
  'subject',
  'targetUser',
  'profile',
  'owner',
  'member',
  'driver',
  'passenger',
] as const;

/**
 * Pull the rated/subject user's avatar from typical API envelopes (ratings summary, profile stubs).
 */
export function pickSubjectAvatarFromApiEnvelope(
  root: unknown,
  data: Record<string, unknown>,
  userObj: Record<string, unknown>
): string | undefined {
  for (const layer of [userObj, data, asObject(root) ?? {}]) {
    const u = pickAvatarUrlFromRecord(layer);
    if (u) return u;
  }
  const r = asObject(root) ?? {};
  const dataFromRoot = asObject(r.data) ?? {};
  for (const key of SUBJECT_LIKE_KEYS) {
    for (const bag of [data, r, dataFromRoot]) {
      const v = bag[key];
      const o = asObject(v);
      if (o) {
        const found = pickAvatarUrlFromRecord(o);
        if (found) return found;
      }
    }
  }
  return undefined;
}

/** Depth-first: find an object whose id matches `userId` and return its avatar URL. */
export function findAvatarUrlForUserInTree(node: unknown, userId: string, maxDepth = 10): string | undefined {
  const target = userId.trim();
  if (!target || maxDepth <= 0 || node == null) return undefined;
  if (typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const el of node) {
      const hit = findAvatarUrlForUserInTree(el, target, maxDepth - 1);
      if (hit) return hit;
    }
    return undefined;
  }
  const o = node as Record<string, unknown>;
  const oid = stringifyApiUserId(o._id ?? o.id);
  if (oid && oid === target) {
    const url = pickAvatarUrlFromRecord(o);
    if (url) return url;
  }
  for (const v of Object.values(o)) {
    const hit = findAvatarUrlForUserInTree(v, target, maxDepth - 1);
    if (hit) return hit;
  }
  return undefined;
}

/** Driver/publisher photo on a ride payload (top-level aliases or nested `user` / `publisher` / `driver`). */
export function pickPublisherAvatarUrl(r: Record<string, unknown>): string | undefined {
  for (const key of [
    'publisherAvatarUrl',
    'publisher_avatar_url',
    'driverAvatarUrl',
    'driver_avatar_url',
  ] as const) {
    const v = r[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  for (const nest of ['publisher', 'driver', 'owner', 'host'] as const) {
    const v = r[nest];
    if (v && typeof v === 'object') {
      const hit = pickAvatarUrlFromRecord(v as Record<string, unknown>);
      if (hit) return hit;
    }
  }
  if (r.user && typeof r.user === 'object') {
    const u = pickAvatarUrlFromRecord(r.user as Record<string, unknown>);
    if (u) return u;
  }
  return pickAvatarUrlFromRecord(r);
}
