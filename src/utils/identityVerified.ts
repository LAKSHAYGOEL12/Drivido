/**
 * Helpers for the verified ✓ avatar badge and the verification UI used on the
 * profile screens.
 *
 * Backend = single source of truth:
 * - The verified \u2713 badge renders only when the API explicitly returns
 *   `isIdentityVerified === true` for that user.
 * - The `pending` state lives only on auth/self payloads
 *   (`identityVerificationStatus === 'pending'`); it is intentionally never
 *   surfaced on peer-profile responses.
 * - When the viewer is looking at someone else's profile and that user is not
 *   verified, the UI shows nothing (only the \u2713 distinguishes verified peers).
 *   Self-on-self still surfaces "verification pending" and "not verified" pills
 *   so the user knows what to do next.
 *
 * Backend may surface the flag in either camel- or snake_case (per the contract
 * shipped in `/auth/me`, ride list/detail, and booking endpoints), so these
 * helpers accept both shapes and emit a strict boolean.
 */

import type { RideListItem } from '../types/api';
import type { User } from '../contexts/AuthContext';

type BookingLike = NonNullable<RideListItem['bookings']>[number];

/**
 * Whether the authenticated user's avatar should show the verified badge.
 * Read straight from `AuthContext` user state (populated via `/auth/me`).
 */
export function userIsIdentityVerified(user: Pick<User, 'isIdentityVerified'> | null | undefined): boolean {
  return user?.isIdentityVerified === true;
}

/**
 * Whether the publisher (driver) on a ride list/detail item is identity-verified.
 * Accepts both `publisherIdentityVerified` and `publisher_identity_verified` aliases.
 */
export function ridePublisherIsIdentityVerified(
  ride: Pick<RideListItem, 'publisherIdentityVerified' | 'publisher_identity_verified'> | null | undefined
): boolean {
  if (!ride) return false;
  return (
    ride.publisherIdentityVerified === true ||
    ride.publisher_identity_verified === true
  );
}

/**
 * Whether the passenger on a booking row is identity-verified.
 * Booking payloads are pre-normalized via `mapRawToBookingRow`, which already coalesces
 * the four backend aliases onto `isIdentityVerified`. This helper exists so render sites
 * that consume raw booking shapes (e.g. nav params) stay covered.
 */
export function bookingPassengerIsIdentityVerified(
  booking: Pick<BookingLike, 'isIdentityVerified' | 'is_identity_verified'> | null | undefined
): boolean {
  if (!booking) return false;
  return (
    booking.isIdentityVerified === true ||
    booking.is_identity_verified === true
  );
}

/** Discrete states the profile screens may render below the avatar. */
export type IdentityVerificationViewerState =
  | 'verified'
  | 'pending'
  | 'rejected'
  | 'unverified';

/**
 * Compute the verification state to render under a user's avatar.
 *
 * SSOT rules (mirrors backend contract):
 * - Self viewing self: prefer `isIdentityVerified` -> `verified`, else
 *   `identityVerificationStatus === 'pending'` -> `pending`, else
 *   `identityVerificationStatus === 'rejected'` -> `rejected`, else
 *   `unverified`.
 * - Anyone viewing another user: only `verified` (peer is verified by backend)
 *   is meaningful. Anything else returns `null` so the peer profile shows
 *   nothing — `pending`, `rejected`, and "not verified" are all intentionally
 *   invisible to others.
 */
export function viewerIdentityVerificationState(args: {
  isSelf: boolean;
  user:
    | Pick<User, 'isIdentityVerified' | 'identityVerificationStatus'>
    | null
    | undefined;
  subjectVerified: boolean;
}): IdentityVerificationViewerState | null {
  const { isSelf, user, subjectVerified } = args;
  if (isSelf) {
    if (user?.isIdentityVerified === true) return 'verified';
    if (user?.identityVerificationStatus === 'pending') return 'pending';
    if (user?.identityVerificationStatus === 'rejected') return 'rejected';
    return 'unverified';
  }
  return subjectVerified ? 'verified' : null;
}
