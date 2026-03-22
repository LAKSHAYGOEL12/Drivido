import type { RideListItem } from '../types/api';
import { bookingIsCancelled } from './bookingStatus';

type RideWithAvail = RideListItem & {
  seatsAvailable?: number;
  seats_available?: number;
};

/**
 * Seats still bookable on this ride. Prefer API `availableSeats` / `seatsAvailable` when present;
 * otherwise `max(0, seats - bookedSeats)` using {@link activeBookedSeats} for confirmed count.
 */
export function getRideAvailableSeats(ride: RideListItem): number {
  const r = ride as RideWithAvail;
  const fromApi = r.availableSeats ?? r.seatsAvailable ?? r.seats_available;
  if (typeof fromApi === 'number' && !Number.isNaN(fromApi)) {
    return Math.max(0, Math.floor(fromApi));
  }
  const cap = ride.seats;
  if (cap == null || cap <= 0) return 0;
  const taken = activeBookedSeats(ride);
  return Math.max(0, Math.floor(cap - taken));
}

/** One-line list/detail copy: “N seats left” or “Full”. Empty string if capacity unknown. */
export function getRideAvailabilityShort(ride: RideListItem): string {
  const cap = ride.seats;
  if (cap == null || cap <= 0) return '';
  const avail = getRideAvailableSeats(ride);
  if (avail <= 0) return 'Full';
  return `${avail} seat${avail !== 1 ? 's' : ''} left`;
}

/** Sum seats from active (non-cancelled) bookings when `bookings[]` is present. */
export function activeBookedSeatsFromBookings(ride: RideListItem): number {
  const bookings = ride.bookings ?? [];
  return bookings
    .filter((b) => !bookingIsCancelled(b.status))
    .reduce((sum, b) => sum + (b.seats ?? 0), 0);
}

/**
 * Total confirmed seats taken.
 * Prefer `bookedSeats` from GET /rides — merged `bookings` on list often only includes the current user’s rows.
 * Otherwise sum `bookings` (e.g. ride detail with full passenger list).
 */
export function activeBookedSeats(ride: RideListItem): number {
  const n = ride.bookedSeats;
  if (typeof n === 'number' && !Number.isNaN(n)) {
    return Math.max(0, Math.floor(n));
  }
  if (ride.bookings && ride.bookings.length > 0) {
    return activeBookedSeatsFromBookings(ride);
  }
  return 0;
}

export function isRideSeatsFull(ride: RideListItem): boolean {
  const cap = ride.seats;
  if (cap == null || cap <= 0) return false;
  return getRideAvailableSeats(ride) <= 0;
}

/** Current user has a confirmed booking on this ride (needs ride + /bookings merge or detail). */
export function viewerHasActiveBookingOnRide(ride: RideListItem, userId: string | undefined): boolean {
  const uid = (userId ?? '').trim();
  if (!uid) return false;
  return (ride.bookings ?? []).some(
    (b) => (b.userId ?? '').trim() === uid && !bookingIsCancelled(b.status)
  );
}
