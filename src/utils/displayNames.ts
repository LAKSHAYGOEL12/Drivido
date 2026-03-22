import type { RideListItem } from '../types/api';

/** Booking / passenger row: show display name, not login username, when both exist. */
export type BookingDisplayLike = { name?: string; userName?: string };

/**
 * Ride publisher (driver) label for cards and headers.
 * Prefer `name` / driver display fields from API; fall back to `username` when that’s all we have.
 */
export function ridePublisherDisplayName(ride: RideListItem, fallback = 'Driver'): string {
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
  const n = b.name?.trim() || b.userName?.trim();
  return n || fallback;
}
