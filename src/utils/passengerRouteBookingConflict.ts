import type { RideListItem } from '../types/api';
import { distanceKm } from './calculateDistance';
import { bookingIsCancelled } from './bookingStatus';
import { getRideArrivalDate, getRideScheduledAt, isRideCancelledByOwner } from './rideDisplay';

/** Match search “same corridor” radius (km). */
export const SAME_ROUTE_MAX_KM = 4;

const ONE_HOUR_MS = 60 * 60 * 1000;

export const PASSENGER_OVERLAP_BOOKING_TOAST =
  'Same route & time as another booking. Cancel that one first.';

export const PASSENGER_ALREADY_BOOKED_THIS_RIDE_TOAST =
  'You already have a booking on this ride.';

function normLabel(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function pickupLabel(r: RideListItem): string {
  return normLabel(r.pickupLocationName ?? r.from);
}

function destinationLabel(r: RideListItem): string {
  return normLabel(r.destinationLocationName ?? r.to);
}

function hasCoords(r: RideListItem): boolean {
  const a =
    typeof r.pickupLatitude === 'number' &&
    !Number.isNaN(r.pickupLatitude) &&
    typeof r.pickupLongitude === 'number' &&
    !Number.isNaN(r.pickupLongitude);
  const b =
    typeof r.destinationLatitude === 'number' &&
    !Number.isNaN(r.destinationLatitude) &&
    typeof r.destinationLongitude === 'number' &&
    !Number.isNaN(r.destinationLongitude);
  return a && b;
}

/**
 * Same route: both stops within {@link SAME_ROUTE_MAX_KM} when coords exist; otherwise same normalized labels.
 */
export function ridesAreSamePublishedRoute(a: RideListItem, b: RideListItem): boolean {
  if (hasCoords(a) && hasCoords(b)) {
    const dPu = distanceKm(
      { latitude: a.pickupLatitude!, longitude: a.pickupLongitude! },
      { latitude: b.pickupLatitude!, longitude: b.pickupLongitude! }
    );
    const dDe = distanceKm(
      { latitude: a.destinationLatitude!, longitude: a.destinationLongitude! },
      { latitude: b.destinationLatitude!, longitude: b.destinationLongitude! }
    );
    return dPu <= SAME_ROUTE_MAX_KM && dDe <= SAME_ROUTE_MAX_KM;
  }
  const pA = pickupLabel(a);
  const pB = pickupLabel(b);
  const dA = destinationLabel(a);
  const dB = destinationLabel(b);
  return pA.length > 0 && pA === pB && dA.length > 0 && dA === dB;
}

/** Trip “busy” window: 1 h before pickup through estimated arrival. */
export function getPassengerTripWindowMs(ride: RideListItem): { startMs: number; endMs: number } | null {
  const pickup = getRideScheduledAt(ride);
  if (!pickup) return null;
  const arrival = getRideArrivalDate(ride);
  if (!arrival) return null;
  return {
    startMs: pickup.getTime() - ONE_HOUR_MS,
    endMs: arrival.getTime(),
  };
}

function windowsOverlap(
  a: { startMs: number; endMs: number },
  b: { startMs: number; endMs: number }
): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/** True for statuses that still block another booking (pending or holds seats). */
export function passengerBookingCountsAsOverlapBlock(status: string | undefined): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  if (!s || bookingIsCancelled(s)) return false;
  if (s === 'rejected') return false;
  return true;
}

export function rideHasActivePassengerBookingForUser(ride: RideListItem, userId: string): boolean {
  const uid = userId.trim();
  if (!uid) return false;
  const st = String(ride.myBookingStatus ?? '').trim();
  if (st && passengerBookingCountsAsOverlapBlock(st)) return true;
  for (const b of ride.bookings ?? []) {
    if ((b.userId ?? '').trim() !== uid) continue;
    if (passengerBookingCountsAsOverlapBlock(b.status)) return true;
  }
  return false;
}

/**
 * Another ride (already booked by user) that shares the route and overlaps the time window with `candidate`.
 * Excludes the same ride id. Returns null if none.
 */
export function findOverlappingPassengerBookingRide(args: {
  candidate: RideListItem;
  bookedRides: RideListItem[];
  userId: string;
}): RideListItem | null {
  const { candidate, bookedRides, userId } = args;
  const uid = userId.trim();
  if (!uid) return null;
  const candId = (candidate.id ?? '').trim();
  const wCand = getPassengerTripWindowMs(candidate);
  if (!wCand) return null;

  for (const other of bookedRides) {
    const oid = (other.id ?? '').trim();
    if (!oid || oid === candId) continue;
    if (!rideHasActivePassengerBookingForUser(other, uid)) continue;
    if (isRideCancelledByOwner(other)) continue;
    if (!ridesAreSamePublishedRoute(candidate, other)) continue;
    const wOther = getPassengerTripWindowMs(other);
    if (!wOther) continue;
    if (windowsOverlap(wCand, wOther)) return other;
  }
  return null;
}
