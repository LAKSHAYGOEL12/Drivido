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
 * Ride publisher (driver) label for cards and headers.
 * Prefer `name` / driver display fields from API; fall back to `username` when that’s all we have.
 */
export function ridePublisherDisplayName(ride: RideListItem, fallback = 'Driver'): string {
  if (ridePublisherDeactivated(ride)) return DEACTIVATED_ACCOUNT_LABEL;
  const r = ride as RideListItem & {
    driverName?: string;
    driver_name?: string;
    publisherName?: string;
    publisher_name?: string;
  };
  const n =
    r.name?.trim() ||
    r.driverName?.trim() ||
    r.driver_name?.trim() ||
    r.publisherName?.trim() ||
    r.publisher_name?.trim() ||
    r.username?.trim();
  return n || fallback;
}

/** Passenger on a booking row (list, detail, chat targets). */
export function bookingPassengerDisplayName(b: BookingDisplayLike, fallback = 'Passenger'): string {
  if (bookingPassengerDeactivated(b as DeactivatedBookingLike)) {
    return DEACTIVATED_ACCOUNT_LABEL;
  }
  const n = b.name?.trim() || b.userName?.trim();
  return n || fallback;
}
