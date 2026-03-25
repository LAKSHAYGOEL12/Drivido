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
  return typeof value === 'string' ? value : '';
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
  const recentReviewsRaw = data.recentReviews ?? data.reviews ?? userObj.recentReviews ?? userObj.reviews;
  const ratingsRaw = data.ratings ?? userObj.ratings;
  const list = Array.isArray(recentReviewsRaw)
    ? recentReviewsRaw
    : Array.isArray(ratingsRaw)
      ? ratingsRaw
      : [];

  const reviews: UserRatingReview[] = list
    .map((item, idx) => {
      const obj = asObject(item) ?? {};
      const fromUserObj = asObject(obj.fromUser) ?? asObject(obj.from) ?? {};
      const reviewText = asString(obj.review ?? obj.description ?? obj.text ?? obj.comment).trim();
      return {
        id: asString(obj._id || obj.id) || `${idx}`,
        rating: Math.min(5, Math.max(0, Math.round(asNumber(obj.rating)))),
        review: reviewText,
        role: asString(obj.role),
        fromUserName: asString(
          obj.fromUserName ?? obj.fromName ?? obj.name ?? fromUserObj.name ?? fromUserObj.fullName
        ).trim(),
        createdAt: asString(obj.createdAt ?? obj.updatedAt ?? obj.date),
      };
    })
    .filter((r) => r.review.length > 0);

  return { avgRating, totalRatings, reviews };
}
