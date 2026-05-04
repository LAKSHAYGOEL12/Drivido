import type { RideListItem } from '../types/api';
import {
  bookingPassengerDeactivated,
  DEACTIVATED_ACCOUNT_LABEL,
  ridePublisherDeactivated,
  type DeactivatedBookingLike,
} from './deactivatedAccount';

/** Booking / passenger row: show display name, not login username, when both exist. */
export type BookingDisplayLike = { name?: string; userName?: string };

/**
 * Reject values that look like a phone number so legacy rides that snapshotted the publisher's
 * phone into `username` (or comparable fields) don't render as "+919876543210" on cards.
 * Rule: 7–15 digits after stripping `+`, spaces, dashes and parens — covers E.164 and local formats.
 */
function looksLikePhone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const digits = trimmed.replace(/[+\s\-()]/g, '');
  return /^\d{7,15}$/.test(digits);
}

/** First non-empty, non-phone-like candidate from the list. */
function pickHumanName(...candidates: Array<string | undefined>): string {
  for (const c of candidates) {
    const t = (c ?? '').trim();
    if (!t) continue;
    if (looksLikePhone(t)) continue;
    return t;
  }
  return '';
}

/**
 * Ride publisher (driver) label for cards and headers.
 * Prefer `name` / driver display fields from API; fall back to `username` when that’s all we have.
 * Phone-like values are filtered out so legacy snapshots don't surface as the displayed name.
 */
export function ridePublisherDisplayName(ride: RideListItem, fallback = 'Driver'): string {
  if (ridePublisherDeactivated(ride)) return DEACTIVATED_ACCOUNT_LABEL;
  const r = ride as RideListItem & {
    driverName?: string;
    driver_name?: string;
    publisherName?: string;
    publisher_name?: string;
  };
  const n = pickHumanName(
    r.name,
    r.driverName,
    r.driver_name,
    r.publisherName,
    r.publisher_name,
    r.username,
  );
  return n || fallback;
}

/** Passenger on a booking row (list, detail, chat targets). */
export function bookingPassengerDisplayName(b: BookingDisplayLike, fallback = 'Passenger'): string {
  if (bookingPassengerDeactivated(b as DeactivatedBookingLike)) {
    return DEACTIVATED_ACCOUNT_LABEL;
  }
  const n = pickHumanName(b.name, b.userName);
  return n || fallback;
}
