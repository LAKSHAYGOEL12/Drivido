import api from './api';
import { API } from '../constants/API';
import {
  pickAvatarUrlFromRecord,
  pickSubjectAvatarFromApiEnvelope,
  findAvatarUrlForUserInTree,
  stringifyApiUserId,
} from '../utils/avatarUrl';
import {
  DEACTIVATED_ACCOUNT_LABEL,
  ratingsEnvelopeSubjectInactive,
  ratingRowReviewerInactive,
} from '../utils/deactivatedAccount';
import { normalizeRidePreferenceIds } from '../constants/ridePreferences';

export type SubmitRideRatingPayload = {
  rideId: string;
  toUserId: string;
  rating: number;
  review?: string;
};

export type UserRatingReview = {
  id: string;
  rating: number;
  review: string;
  role: string;
  fromUserName: string;
  fromUserId?: string;
  fromUserAvatarUrl?: string;
  createdAt: string;
};

export type UserRatingsSummary = {
  avgRating: number;
  totalRatings: number;
  reviews: UserRatingReview[];
  /** Profile photo URL for the user whose ratings were fetched (when API includes nested `user`). */
  subjectAvatarUrl?: string;
  /**
   * Subject user's signup / member-since timestamp when `GET /ratings/:userId` embeds `user` (or top-level).
   * Backend: expose `createdAt` on the rated user object for public profile "Since".
   */
  subjectCreatedAt?: string;
  /**
   * Driver/passenger contact when backend exposes it for the profile subject (same trust rules as avatar).
   * Prefer E.164 or national digits; app opens the device dialer via `tel:`.
   */
  subjectContactPhone?: string;
  /** Rated user’s account is inactive — client must not show ratings breakdown, reviews, or PII. */
  subjectDeactivated?: boolean;
  /** Short public bio when `GET /ratings/:userId` embeds it on `user` / envelope. */
  subjectBio?: string;
  /** Occupation text when ratings payload embeds it on `user` / envelope. */
  subjectOccupation?: string;
  /** Driver comfort tags from `user.ridePreferences` on ratings payload (may be empty). */
  subjectRidePreferences: string[];
};

function extractRatingsArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.ratings)) return r.ratings as unknown[];
  if (r.data && typeof r.data === 'object' && Array.isArray((r.data as Record<string, unknown>).ratings)) {
    return (r.data as Record<string, unknown>).ratings as unknown[];
  }
  if (Array.isArray(r.data)) return r.data as unknown[];
  return [];
}

function parseRatedFlag(obj: Record<string, unknown> | null | undefined): boolean | undefined {
  if (!obj) return undefined;
  const keys = ['rated', 'hasRated', 'has_rated', 'alreadyRated', 'already_rated', 'exists'] as const;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'boolean') return v;
  }
  return undefined;
}

export async function hasCurrentUserRatedRide(
  rideId: string,
  fromUserId: string,
  toUserId?: string
): Promise<boolean> {
  // Preferred API contract: GET /ratings/check?rideId&fromUserId[&toUserId] -> { rated: boolean }
  // Pass `toUserId` whenever known (passenger→driver or owner→passenger); backends often require it for an accurate row match.
  try {
    const qs =
      `rideId=${encodeURIComponent(rideId)}` +
      `&fromUserId=${encodeURIComponent(fromUserId)}` +
      (toUserId ? `&toUserId=${encodeURIComponent(toUserId)}` : '');
    const url = `${API.endpoints.ratings.check}?${qs}&_=${encodeURIComponent(String(Date.now()))}`;
    const res = await api.get<unknown>(url, {
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });

    if (res && typeof res === 'object') {
      const obj = res as Record<string, unknown>;
      const top = parseRatedFlag(obj);
      if (top !== undefined) return top;
      const data = obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : null;
      const nested = parseRatedFlag(data);
      if (nested !== undefined) return nested;
    }

    // Last resort: some backends return only a ratings array for this query.
    return extractRatingsArray(res).length > 0;
  } catch {
    return false;
  }
}

export async function submitRideRating(payload: SubmitRideRatingPayload): Promise<void> {
  await api.post(API.endpoints.ratings.create, payload);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  // Accept ObjectId-like values or any object with a stable string representation.
  try {
    return String(value);
  } catch {
    return '';
  }
}

/** Stable key for deduping rating rows from mixed API shapes. */
function ratingRecordKey(item: unknown): string {
  const obj = asObject(item) ?? {};
  const id = asString(obj._id ?? obj.id).trim();
  if (id) return id;
  const fromUserObj = asObject(obj.fromUser) ?? asObject(obj.from) ?? {};
  const from = asString(
    obj.fromUserId ?? fromUserObj._id ?? fromUserObj.id ?? (fromUserObj as Record<string, unknown>)?.userId
  ).trim();
  const created = asString(obj.createdAt ?? obj.updatedAt ?? obj.date ?? '');
  const r = asNumber(
    obj.rating ?? obj.stars ?? obj.starCount ?? obj.score ?? obj.value ?? obj.ratingValue ?? obj.rating_value
  );
  return `${from}|${created}|${r}`;
}

/**
 * Dedupe rows from multiple API arrays by `ratingRecordKey`.
 * `getUserRatingsSummary` passes **snapshot first**, then **full list** (`recentItems`, `ratingItems`).
 * Iteration order: snapshot rows are inserted first; full-list rows overwrite the same key in the Map,
 * so stale snapshot duplicates lose to the updated full list.
 */
function mergeRatingSourceLists(...lists: unknown[][]): unknown[] {
  const merged = new Map<string, unknown>();
  for (const list of lists) {
    for (const item of list) {
      merged.set(ratingRecordKey(item), item);
    }
  }
  return [...merged.values()];
}

function avatarWhenRecordMatchesUser(record: Record<string, unknown> | null, expectedUserId: string): string | undefined {
  if (!record) return undefined;
  const rid = stringifyApiUserId(record._id ?? record.id);
  if (!rid || rid !== expectedUserId.trim()) return undefined;
  return pickAvatarUrlFromRecord(record);
}

/** Only trust avatar if JSON says it belongs to `expectedUserId` (avoids /user/profile returning *current* user). */
function extractVerifiedSubjectAvatar(body: unknown, expectedUserId: string): string | undefined {
  const top = asObject(body);
  if (!top) return undefined;
  const layers = [top, asObject(top.data), asObject(top.user), asObject(asObject(top.data)?.user)];
  for (const layer of layers) {
    const hit = avatarWhenRecordMatchesUser(layer, expectedUserId);
    if (hit) return hit;
  }
  return undefined;
}

const SUBJECT_PHONE_KEYS = [
  'phone',
  'mobile',
  'phoneNumber',
  'phone_number',
  'contactPhone',
  'contact_phone',
] as const;

function phoneWhenRecordMatchesUser(
  record: Record<string, unknown> | null,
  expectedUserId: string
): string | undefined {
  if (!record) return undefined;
  const rid = stringifyApiUserId(record._id ?? record.id);
  if (!rid || rid !== expectedUserId.trim()) return undefined;
  for (const k of SUBJECT_PHONE_KEYS) {
    const v = record[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/** Only trust phone if JSON says it belongs to `expectedUserId`. */
function extractVerifiedSubjectPhone(body: unknown, expectedUserId: string): string | undefined {
  const top = asObject(body);
  if (!top) return undefined;
  const layers = [top, asObject(top.data), asObject(top.user), asObject(asObject(top.data)?.user)];
  for (const layer of layers) {
    const hit = phoneWhenRecordMatchesUser(layer, expectedUserId);
    if (hit) return hit;
  }
  return undefined;
}

/** Try common public-profile URL shapes when ratings payload omits avatar or contact phone. */
async function probePublicUserProfileExtras(
  userId: string
): Promise<{ subjectAvatarUrl?: string; subjectContactPhone?: string }> {
  const id = userId.trim();
  if (!id) return {};

  const pathProbes: { path: string; userIdFromPath: boolean }[] = [
    { path: `/users/${encodeURIComponent(id)}`, userIdFromPath: true },
    { path: `/users/${encodeURIComponent(id)}/profile`, userIdFromPath: true },
    { path: `/user/${encodeURIComponent(id)}`, userIdFromPath: true },
    { path: `${API.endpoints.user.profile}?userId=${encodeURIComponent(id)}`, userIdFromPath: false },
    { path: `${API.endpoints.user.profile}?id=${encodeURIComponent(id)}`, userIdFromPath: false },
  ];

  // Run probes in parallel — sequential 404s add up; each uses a short timeout so a dead route cannot stall 15s.
  const probeMs = 4500;
  const bodies = await Promise.all(
    pathProbes.map((p) =>
      api
        .getOptional<unknown>(p.path, { timeout: probeMs })
        .catch(() => null)
    )
  );

  let subjectAvatarUrl: string | undefined;
  let subjectContactPhone: string | undefined;

  for (let i = 0; i < pathProbes.length; i++) {
    const { userIdFromPath } = pathProbes[i];
    const body = bodies[i];
    if (body == null) continue;
    const verifiedAvatar = extractVerifiedSubjectAvatar(body, id);
    const verifiedPhone = extractVerifiedSubjectPhone(body, id);
    if (verifiedAvatar && !subjectAvatarUrl) subjectAvatarUrl = verifiedAvatar;
    if (verifiedPhone && !subjectContactPhone) subjectContactPhone = verifiedPhone;
    if (!userIdFromPath) continue;
    const top = asObject(body) ?? {};
    const nested = asObject(top.data) ?? {};
    const user = asObject(nested.user) ?? asObject(top.user) ?? {};
    if (!subjectAvatarUrl) {
      const loose =
        pickAvatarUrlFromRecord(top) ??
        pickAvatarUrlFromRecord(nested) ??
        pickAvatarUrlFromRecord(user);
      if (loose) subjectAvatarUrl = loose;
    }
  }

  return {
    ...(subjectAvatarUrl ? { subjectAvatarUrl } : {}),
    ...(subjectContactPhone ? { subjectContactPhone } : {}),
  };
}

export async function getUserRatingsSummary(userId: string): Promise<UserRatingsSummary> {
  /** Avoid stale responses from HTTP caches / intermediaries after a new rating is submitted. */
  const path = `${API.endpoints.ratings.list}/${encodeURIComponent(userId)}`;
  const url = `${path}?_=${encodeURIComponent(String(Date.now()))}`;
  const raw = await api.get<unknown>(url, {
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });
  const root = asObject(raw);
  const data = asObject(root?.data) ?? root ?? {};
  const userObj = asObject(data.user) ?? {};

  if (ratingsEnvelopeSubjectInactive(root, data, userObj)) {
    return {
      avgRating: 0,
      totalRatings: 0,
      reviews: [],
      subjectDeactivated: true,
      subjectRidePreferences: [],
    };
  }

  const avgRating = asNumber(
    data.avgRating ?? userObj.avgRating ?? data.averageRating ?? userObj.averageRating
  );
  const totalRatings = Math.max(
    0,
    Math.floor(
      asNumber(
        data.totalRatings ??
          userObj.totalRatings ??
          data.ratingsCount ??
          userObj.ratingsCount ??
          data.total_reviews ??
          userObj.total_reviews
      )
    )
  );
  /**
   * Explicit **snapshot** fields only (`recentReviews` / `recent_reviews` on `data` and nested `user`).
   * Do **not** chain `data.reviews` or `userObj.reviews` here — those belong on the full-list path below.
   * Otherwise a stale `recentReviews` plus a fresh `reviews` array could bind the wrong branch and hide new rows.
   */
  const recentReviewsRaw =
    data.recentReviews ?? data.recent_reviews ?? userObj.recentReviews ?? userObj.recent_reviews;
  /**
   * **Full-list** fields: each side’s `ratings` / `ratingList` / `rating_list` first, then that side’s `reviews`
   * (`data.reviews` / `userObj.reviews` are not used in `recentReviewsRaw` above).
   */
  const ratingsRaw =
    data.ratings ??
    data.ratingList ??
    data.rating_list ??
    data.reviews ??
    userObj.ratings ??
    userObj.ratingList ??
    userObj.rating_list ??
    userObj.reviews;

  const extractArray = (value: unknown, depth = 3): unknown[] => {
    if (Array.isArray(value)) return value;
    if (depth <= 0) return [];

    const obj = asObject(value);
    if (!obj) return [];

    // 1) Check direct object properties for arrays first.
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) return v;
    }

    // 2) Otherwise recursively search nested objects (bounded by depth).
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') {
        const nested = extractArray(v, depth - 1);
        if (nested.length > 0) return nested;
      }
    }

    return [];
  };

  const recentItems = extractArray(recentReviewsRaw);
  const ratingItems = extractArray(ratingsRaw);

  // Snapshot first, full list second — see `mergeRatingSourceLists`.
  const safeList = mergeRatingSourceLists(recentItems, ratingItems);

  // (dev logs removed)

  // Keep two arrays:
  // 1) `mappedAll` is used for average/stars (even if review text is empty).
  // 2) `reviews` is what we return to UI (we keep the old behavior that
  //    recent reviews only appear when review text is non-empty).
  const mappedAll: UserRatingReview[] = safeList.map((item, idx) => {
      const obj = asObject(item) ?? {};
      const fromUserObj = asObject(obj.fromUser) ?? asObject(obj.from) ?? {};
      const reviewText = asString(obj.review ?? obj.description ?? obj.text ?? obj.comment).trim();
      const ratingRaw =
        obj.rating ??
        obj.stars ??
        obj.starCount ??
        obj.score ??
        obj.value ??
        obj.ratingValue ??
        obj.rating_value;
      const fromUserId =
        asString(obj.fromUserId ?? fromUserObj._id ?? fromUserObj.id) ||
        asString(fromUserObj?.userId ?? obj.fromUserId ?? obj.fromUserID);
      const fromUserNameRaw =
        obj.fromUserName ??
        obj.fromUserName ??
        obj.fromName ??
        (obj as Record<string, unknown>).from_name ??
        (obj as Record<string, unknown>).from_username ??
        obj.name ??
        (obj as Record<string, unknown>).userName ??
        (obj as Record<string, unknown>).username ??
        fromUserObj.name ??
        fromUserObj.fullName ??
        fromUserObj.full_name ??
        fromUserObj.userName ??
        fromUserObj.user_name ??
        fromUserObj.username;

      // Last-resort: recursively search for likely "name" keys.
      const findName = (value: unknown, depth: number): string => {
        if (depth <= 0) return '';
        const o = asObject(value);
        if (!o) return '';
        const keys = [
          'fromUserName',
          'from_name',
          'fromName',
          'from_username',
          'fullName',
          'full_name',
          'userName',
          'username',
          'user_name',
          'name',
        ] as const;
        for (const k of keys) {
          const v = (o as Record<string, unknown>)[k];
          if (typeof v === 'string' && v.trim()) return v.trim();
        }
        for (const v of Object.values(o)) {
          if (v && typeof v === 'object') {
            const nested = findName(v, depth - 1);
            if (nested) return nested;
          }
        }
        return '';
      };

      const fromUserNameCandidate = asString(fromUserNameRaw).trim() || findName(fromUserObj, 3) || findName(obj, 3);
      const fromUserAvatarUrl =
        pickAvatarUrlFromRecord(fromUserObj) ?? pickAvatarUrlFromRecord(obj) ?? undefined;
      const reviewerInactive = ratingRowReviewerInactive(obj, fromUserObj);
      return {
        id: asString(obj._id || obj.id) || `${idx}`,
        rating: Math.min(5, Math.max(0, Math.round(asNumber(ratingRaw)))),
        review: reviewText,
        role: asString(obj.role),
        fromUserName: reviewerInactive ? DEACTIVATED_ACCOUNT_LABEL : fromUserNameCandidate,
        fromUserId: reviewerInactive ? undefined : fromUserId || undefined,
        ...(reviewerInactive || !fromUserAvatarUrl ? {} : { fromUserAvatarUrl }),
        createdAt: asString(obj.createdAt ?? obj.updatedAt ?? obj.date),
      };
    });

  // IMPORTANT: keep rating entries even when review text is empty.
  // The UI's star breakdown counts depend on rating values, not review text.
  const reviews: UserRatingReview[] = [...mappedAll].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });

  // If backend avgRating parsing fails (we fall back to 0) but we still have
  // ratings in the items, compute avg from items so star counts match breakdown.
  const computedAvgFromMapped =
    mappedAll.length > 0 ? mappedAll.reduce((acc, r) => acc + (r.rating || 0), 0) / mappedAll.length : 0;
  const computedTotalFromMapped = mappedAll.length;

  const finalAvgRating = avgRating === 0 && computedAvgFromMapped > 0 ? computedAvgFromMapped : avgRating;
  const finalTotalRatings =
    totalRatings === 0 && computedTotalFromMapped > 0 ? computedTotalFromMapped : totalRatings;

  // (dev logs removed)

  let subjectContactPhone =
    phoneWhenRecordMatchesUser(userObj, userId) ??
    extractVerifiedSubjectPhone(raw, userId) ??
    extractVerifiedSubjectPhone(data, userId);

  let subjectAvatarUrl =
    pickSubjectAvatarFromApiEnvelope(raw, data, userObj) ?? findAvatarUrlForUserInTree(raw, userId);
  const extras = await probePublicUserProfileExtras(userId);
  if (!subjectAvatarUrl && extras.subjectAvatarUrl) subjectAvatarUrl = extras.subjectAvatarUrl;
  if (!subjectContactPhone && extras.subjectContactPhone) subjectContactPhone = extras.subjectContactPhone;

  const subjectCreatedAtRaw = asString(
    userObj.createdAt ??
      userObj.created_at ??
      userObj.joinedAt ??
      userObj.joined_at ??
      userObj.memberSince ??
      userObj.member_since ??
      data.createdAt ??
      data.created_at
  ).trim();

  const subjectBioRaw = asString(
    data.subjectBio ??
      data.subject_bio ??
      root?.subjectBio ??
      root?.subject_bio ??
      userObj.bio ??
      userObj.description ??
      userObj.profileBio ??
      userObj.profile_bio ??
      userObj.about ??
      userObj.subjectBio ??
      userObj.subject_bio ??
      data.bio ??
      data.description
  ).trim();
  const subjectOccupationRaw = asString(
    data.subjectOccupation ??
      data.subject_occupation ??
      root?.subjectOccupation ??
      root?.subject_occupation ??
      userObj.occupation ??
      userObj.occupation_text ??
      userObj.jobTitle ??
      userObj.job_title ??
      userObj.profession ??
      data.occupation ??
      data.occupation_text
  ).trim();

  const subjectRidePrefsRaw =
    userObj.ridePreferences ??
    userObj.ride_preferences ??
    data.subjectRidePreferences ??
    data.subject_ride_preferences ??
    root?.subjectRidePreferences;
  const subjectRidePreferences = normalizeRidePreferenceIds(
    Array.isArray(subjectRidePrefsRaw) ? subjectRidePrefsRaw : []
  );

  return {
    avgRating: finalAvgRating,
    totalRatings: finalTotalRatings,
    reviews,
    ...(subjectAvatarUrl ? { subjectAvatarUrl } : {}),
    ...(subjectCreatedAtRaw ? { subjectCreatedAt: subjectCreatedAtRaw } : {}),
    ...(subjectBioRaw ? { subjectBio: subjectBioRaw } : {}),
    ...(subjectOccupationRaw ? { subjectOccupation: subjectOccupationRaw } : {}),
    ...(subjectContactPhone ? { subjectContactPhone } : {}),
    subjectRidePreferences,
  };
}
