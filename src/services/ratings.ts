import api from './api';
import { API } from '../constants/API';

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
  createdAt: string;
};

export type UserRatingsSummary = {
  avgRating: number;
  totalRatings: number;
  reviews: UserRatingReview[];
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

export async function hasCurrentUserRatedRide(
  rideId: string,
  fromUserId: string,
  toUserId?: string
): Promise<boolean> {
  // Preferred API contract: GET /ratings/check?rideId&fromUserId[&toUserId] -> { rated: boolean }
  // Fallback parsing keeps compatibility if backend returns wrapped data.
  try {
    const qs =
      `rideId=${encodeURIComponent(rideId)}` +
      `&fromUserId=${encodeURIComponent(fromUserId)}` +
      (toUserId ? `&toUserId=${encodeURIComponent(toUserId)}` : '');
    const res = await api.get<unknown>(`${API.endpoints.ratings.check}?${qs}`);

    if (res && typeof res === 'object') {
      const obj = res as Record<string, unknown>;
      if (typeof obj.rated === 'boolean') return obj.rated;
      if (
        obj.data &&
        typeof obj.data === 'object' &&
        typeof (obj.data as Record<string, unknown>).rated === 'boolean'
      ) {
        return Boolean((obj.data as Record<string, unknown>).rated);
      }
    }

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

export async function getUserRatingsSummary(userId: string): Promise<UserRatingsSummary> {
  const raw = await api.get<unknown>(`${API.endpoints.ratings.list}/${encodeURIComponent(userId)}`);
  const root = asObject(raw);
  const data = asObject(root?.data) ?? root ?? {};
  const userObj = asObject(data.user) ?? {};

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
  const recentReviewsRaw =
    data.recentReviews ??
    data.recent_reviews ??
    data.reviews ??
    userObj.recentReviews ??
    userObj.recent_reviews ??
    userObj.reviews;
  const ratingsRaw =
    data.ratings ??
    data.ratingList ??
    data.rating_list ??
    userObj.ratings ??
    userObj.ratingList ??
    userObj.rating_list;

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

  const safeList = recentItems.length > 0 ? recentItems : ratingItems;

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
      return {
        id: asString(obj._id || obj.id) || `${idx}`,
        rating: Math.min(5, Math.max(0, Math.round(asNumber(ratingRaw)))),
        review: reviewText,
        role: asString(obj.role),
        fromUserName: fromUserNameCandidate,
        fromUserId: fromUserId || undefined,
        createdAt: asString(obj.createdAt ?? obj.updatedAt ?? obj.date),
      };
    });

  // IMPORTANT: keep rating entries even when review text is empty.
  // The UI's star breakdown counts depend on rating values, not review text.
  const reviews: UserRatingReview[] = mappedAll;

  // If backend avgRating parsing fails (we fall back to 0) but we still have
  // ratings in the items, compute avg from items so star counts match breakdown.
  const computedAvgFromMapped =
    mappedAll.length > 0 ? mappedAll.reduce((acc, r) => acc + (r.rating || 0), 0) / mappedAll.length : 0;
  const computedTotalFromMapped = mappedAll.length;

  const finalAvgRating = avgRating === 0 && computedAvgFromMapped > 0 ? computedAvgFromMapped : avgRating;
  const finalTotalRatings =
    totalRatings === 0 && computedTotalFromMapped > 0 ? computedTotalFromMapped : totalRatings;

  // (dev logs removed)

  return { avgRating: finalAvgRating, totalRatings: finalTotalRatings, reviews };
}
