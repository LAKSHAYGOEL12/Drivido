import type { RideListItem } from '../types/api';
import { bookingIsCancelled } from './bookingStatus';
import {
  getRideScheduledAt,
  isRideCancelledByOwner,
  isRidePastArrivalWindow,
  isViewerRideOwner,
} from './rideDisplay';

export type YourRidesFilterTab = 'myRides' | 'allRides' | 'pastRides';

export type YourRidesListContext = {
  userId: string;
  bookedRideIds: ReadonlySet<string>;
};

/** True if this user has any booking row on the ride (incl. cancelled) — keeps passenger linked after owner cancels. */
export function passengerHasBookingRowOnRide(r: RideListItem, userId: string): boolean {
  const uid = (userId ?? '').trim();
  if (!uid) return false;
  return (r.bookings ?? []).some((b) => (b.userId ?? '').trim() === uid);
}

export function isMineOrBooked(r: RideListItem, ctx: YourRidesListContext): boolean {
  const uid = ctx.userId.trim();
  if (!uid) return false;
  return (
    isViewerRideOwner(r, uid) ||
    ctx.bookedRideIds.has(r.id) ||
    passengerHasBookingRowOnRide(r, uid)
  );
}

export function matchesMyRidesTab(r: RideListItem, ctx: YourRidesListContext): boolean {
  return (
    isMineOrBooked(r, ctx) &&
    !isRidePastArrivalWindow(r) &&
    !bookingIsCancelled(r.myBookingStatus) &&
    !isRideCancelledByOwner(r)
  );
}

export function matchesAllRidesTab(r: RideListItem): boolean {
  return !isRidePastArrivalWindow(r) && !isRideCancelledByOwner(r);
}

export function matchesPastRidesTab(r: RideListItem, ctx: YourRidesListContext): boolean {
  return (
    isMineOrBooked(r, ctx) &&
    (isRidePastArrivalWindow(r) ||
      bookingIsCancelled(r.myBookingStatus) ||
      isRideCancelledByOwner(r))
  );
}

/** Sort key: soonest / unknown last for upcoming; latest first for past. */
function rideSortTime(ride: RideListItem, mode: 'upcoming' | 'past'): number {
  const at = getRideScheduledAt(ride);
  if (!at || isNaN(at.getTime())) {
    return mode === 'upcoming' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }
  return at.getTime();
}

export function sortRidesForYourRides(rides: RideListItem[], mode: 'upcoming' | 'past'): RideListItem[] {
  const copy = [...rides];
  copy.sort((a, b) => {
    const ta = rideSortTime(a, mode);
    const tb = rideSortTime(b, mode);
    if (mode === 'upcoming') {
      return ta - tb;
    }
    return tb - ta;
  });
  return copy;
}

export type YourRidesSection = { title: string; data: RideListItem[] };

/**
 * Split “my” rides into hosting vs riding, each group sorted by time.
 * Omits empty sections so we don’t show stray headers.
 */
export function buildDrivingPassengerSections(
  items: RideListItem[],
  currentUserId: string,
  order: 'upcoming' | 'past'
): YourRidesSection[] {
  const sorted = sortRidesForYourRides(items, order);
  const driving = sorted.filter((r) => isViewerRideOwner(r, currentUserId));
  const passenger = sorted.filter((r) => !isViewerRideOwner(r, currentUserId));
  const sections: YourRidesSection[] = [];
  if (driving.length > 0) {
    sections.push({ title: "You're driving", data: driving });
  }
  if (passenger.length > 0) {
    sections.push({ title: 'As a passenger', data: passenger });
  }
  return sections;
}

export function countForTab(
  rides: RideListItem[],
  tab: YourRidesFilterTab,
  ctx: YourRidesListContext
): number {
  if (tab === 'myRides') return rides.filter((r) => matchesMyRidesTab(r, ctx)).length;
  if (tab === 'allRides') return rides.filter(matchesAllRidesTab).length;
  return rides.filter((r) => matchesPastRidesTab(r, ctx)).length;
}
