import type { RideListItem } from '../types/api';

export type BookingLike = NonNullable<RideListItem['bookings']>[number];

export function bookingPickupDrop(
  ride: RideListItem,
  booking: BookingLike
): { pickup: string; drop: string; lineShort: string } {
  const pickup =
    booking.pickupLocationName?.trim() ||
    ride.pickupLocationName?.trim() ||
    ride.from?.trim() ||
    'Pickup';
  const drop =
    booking.destinationLocationName?.trim() ||
    ride.destinationLocationName?.trim() ||
    ride.to?.trim() ||
    'Destination';
  const short = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trim()}…`);
  return {
    pickup,
    drop,
    lineShort: `${short(pickup, 28)} → ${short(drop, 28)}`,
  };
}

/** True when API sent stops specific to this booking (not only the ride-wide route). */
export function hasBookingSpecificRoute(booking: BookingLike): boolean {
  return Boolean(
    booking.pickupLocationName?.trim() || booking.destinationLocationName?.trim()
  );
}

/** True when this booking’s effective pickup/drop (after merging with ride defaults) differs from the published ride text. */
export function bookingDiffersFromPublishedRide(
  ride: RideListItem,
  booking: BookingLike
): boolean {
  const rp = (ride.pickupLocationName ?? ride.from ?? '').trim().toLowerCase();
  const rd = (ride.destinationLocationName ?? ride.to ?? '').trim().toLowerCase();
  const { pickup, drop } = bookingPickupDrop(ride, booking);
  const pp = pickup.trim().toLowerCase();
  const pd = drop.trim().toLowerCase();
  return pp !== rp || pd !== rd;
}

export function viewerTripVersusPublishedDiffers(
  ride: RideListItem,
  viewerPickup: string,
  viewerDest: string
): boolean {
  const pu = viewerPickup.trim();
  const de = viewerDest.trim();
  if (!pu || !de) return false;
  const rp = (ride.pickupLocationName ?? ride.from ?? '').trim().toLowerCase();
  const rd = (ride.destinationLocationName ?? ride.to ?? '').trim().toLowerCase();
  return pu.toLowerCase() !== rp || de.toLowerCase() !== rd;
}
