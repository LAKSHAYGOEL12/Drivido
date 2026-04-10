import type { RideListItem } from '../types/api';
import { pickAvatarUrlFromRecord } from './avatarUrl';
import { bookingIsCancelledByOwner } from './bookingStatus';

export type RideBookingRow = NonNullable<RideListItem['bookings']>[number];

function toStr(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

function seatsFromRaw(raw: unknown): number {
  if (typeof raw === 'number' && !Number.isNaN(raw)) return Math.max(0, Math.floor(raw));
  if (raw != null && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return 1;
}

/**
 * Map generic `cancelled` to `cancelled_by_owner` when API sends who cancelled separately.
 */
function normalizeBookingStatusFromRaw(raw: Record<string, unknown>, base: string): string {
  const baseTrim = base.trim();
  if (bookingIsCancelledByOwner(baseTrim)) return baseTrim;

  const sl = baseTrim.toLowerCase();
  if (sl !== 'cancelled' && sl !== 'canceled') return baseTrim;

  const by = String(
    raw.cancelledBy ??
      raw.cancelled_by ??
      raw.cancelledByType ??
      raw.cancelled_by_type ??
      raw.cancellationInitiator ??
      raw.cancellation_initiator ??
      ''
  )
    .trim()
    .toLowerCase();
  if (
    by === 'owner' ||
    by === 'driver' ||
    by === 'publisher' ||
    by === 'host' ||
    by === 'ride_owner' ||
    by === 'captain'
  ) {
    return 'cancelled_by_owner';
  }

  const reason = String(
    raw.cancellationReason ??
      raw.cancellation_reason ??
      raw.cancelReason ??
      raw.cancel_reason ??
      ''
  )
    .trim()
    .toLowerCase();
  if (
    reason.includes('removed_by_owner') ||
    reason.includes('removed_by_driver') ||
    reason.includes('owner_cancel') ||
    (reason.includes('driver') && reason.includes('cancel'))
  ) {
    return 'cancelled_by_owner';
  }

  if (raw.cancelledByOwner === true || raw.cancelled_by_owner === true) return 'cancelled_by_owner';
  if (raw.removedByOwner === true || raw.removed_by_owner === true) return 'cancelled_by_owner';

  return baseTrim;
}

function numField(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Passenger / user aggregates from booking or nested `user` object (backend may snake_case). */
function ratingFieldsFromRecord(rec: Record<string, unknown>): {
  avgRating?: number;
  ratingCount?: number;
} {
  const avgRaw =
    numField(rec.avgRating) ??
    numField(rec.avg_rating) ??
    numField(rec.averageRating) ??
    numField(rec.average_rating) ??
    numField(rec.ratingAvg) ??
    numField(rec.rating_avg) ??
    numField(rec.publisherAvgRating) ??
    numField(rec.publisher_avg_rating);
  const countRaw =
    numField(rec.ratingCount) ??
    numField(rec.rating_count) ??
    numField(rec.totalRatings) ??
    numField(rec.total_ratings) ??
    numField(rec.reviewCount) ??
    numField(rec.review_count) ??
    numField(rec.publisherRatingCount) ??
    numField(rec.publisher_rating_count);

  const avg =
    avgRaw != null && avgRaw >= 0 && avgRaw <= 5 ? Number(avgRaw.toFixed(1)) : undefined;
  const ratingCount =
    countRaw != null && countRaw >= 0 ? Math.floor(countRaw) : undefined;
  return {
    ...(avg != null ? { avgRating: avg } : {}),
    ...(ratingCount != null && ratingCount > 0 ? { ratingCount } : {}),
  };
}

/** Map one booking object (from ride detail or booking list) to a row. */
export function mapRawToBookingRow(o: Record<string, unknown>): RideBookingRow | null {
  const nestedUser =
    o.user && typeof o.user === 'object' ? (o.user as Record<string, unknown>) : undefined;
  const passenger =
    o.passenger && typeof o.passenger === 'object'
      ? (o.passenger as Record<string, unknown>)
      : undefined;
  const bookedBy =
    o.bookedBy && typeof o.bookedBy === 'object'
      ? (o.bookedBy as Record<string, unknown>)
      : undefined;
  const rider =
    o.rider && typeof o.rider === 'object' ? (o.rider as Record<string, unknown>) : undefined;
  const pickupObj =
    o.pickup != null && typeof o.pickup === 'object' ? (o.pickup as Record<string, unknown>) : undefined;
  const destinationObj =
    o.destination != null && typeof o.destination === 'object'
      ? (o.destination as Record<string, unknown>)
      : undefined;

  /** Real-world / profile name — prefer this over login username everywhere in UI. */
  const explicitName =
    toStr(o.name) ??
    toStr(nestedUser?.name) ??
    toStr(passenger?.name) ??
    toStr(bookedBy?.name) ??
    toStr(o.passengerName) ??
    toStr(o.passenger_name) ??
    toStr(o.bookerName) ??
    toStr(o.booker_name) ??
    toStr(o.fullName) ??
    toStr(o.full_name) ??
    toStr(nestedUser?.fullName) ??
    toStr((nestedUser as { displayName?: unknown })?.displayName);

  const loginUsername =
    toStr(o.userName) ??
    toStr(o.user_name) ??
    toStr(nestedUser?.username) ??
    toStr(passenger?.username) ??
    toStr((passenger as { userName?: unknown })?.userName);

  const userLabel = explicitName ?? loginUsername;

  const userId = String(
    o.userId ?? o.user_id ?? nestedUser?.id ?? nestedUser?._id ?? passenger?.id ?? passenger?._id ?? ''
  );

  const bookingId = String(o.id ?? o._id ?? '');
  if (!userLabel && !userId && !bookingId) return null;

  const avatarUrl =
    pickAvatarUrlFromRecord(o) ??
    (nestedUser ? pickAvatarUrlFromRecord(nestedUser) : undefined) ??
    (passenger ? pickAvatarUrlFromRecord(passenger) : undefined) ??
    (bookedBy ? pickAvatarUrlFromRecord(bookedBy) : undefined) ??
    (rider ? pickAvatarUrlFromRecord(rider) : undefined);

  let avgRating: number | undefined;
  let ratingCount: number | undefined;
  for (const src of [nestedUser, passenger, bookedBy, rider, o] as const) {
    if (!src || typeof src !== 'object') continue;
    const r = ratingFieldsFromRecord(src as Record<string, unknown>);
    if (avgRating == null && r.avgRating != null) avgRating = r.avgRating;
    if ((ratingCount == null || ratingCount === 0) && r.ratingCount != null && r.ratingCount > 0) {
      ratingCount = r.ratingCount;
    }
    if (avgRating != null && ratingCount != null) break;
  }

  const pickupLocationName = toStr(
    o.pickupLocationName ??
      o.pickup_location_name ??
      o.passengerPickup ??
      o.passenger_pickup ??
      o.bookedPickup ??
      o.booked_pickup ??
      pickupObj?.name
  );
  const destinationLocationName = toStr(
    o.destinationLocationName ??
      o.destination_location_name ??
      o.passengerDestination ??
      o.passenger_destination ??
      o.passengerDropoff ??
      o.passenger_dropoff ??
      o.dropoffLocationName ??
      o.dropoff_location_name ??
      o.dropOffLocationName ??
      o.bookedDestination ??
      o.booked_destination ??
      o.destinationAddress ??
      o.destination_address ??
      destinationObj?.name
  );

  const rawStatus = toStr(o.status) ?? '';
  const status = normalizeBookingStatusFromRaw(o as Record<string, unknown>, rawStatus);

  const bhRaw = (o as Record<string, unknown>).bookingHistory ?? (o as Record<string, unknown>).booking_history;
  let bookingHistory: NonNullable<RideBookingRow['bookingHistory']> | undefined;
  if (Array.isArray(bhRaw)) {
    const mapped = bhRaw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const rec = item as Record<string, unknown>;
        const hid = toStr(rec.id ?? rec._id);
        const seatsRaw = rec.seats;
        const seatsNum =
          typeof seatsRaw === 'number' && Number.isFinite(seatsRaw)
            ? Math.max(0, Math.floor(seatsRaw))
            : seatsRaw != null && seatsRaw !== ''
              ? Math.max(0, Math.floor(Number(seatsRaw)) || 0)
              : 0;
        // Missing status should not imply a confirmed seat.
        const st = toStr(rec.status) ?? 'pending';
        const bat = toStr(rec.bookedAt ?? rec.booked_at ?? rec.createdAt ?? rec.created_at) ?? '';
        const embDk = toStr(rec.displayKey ?? rec.display_key);
        const embDp = rec.displayParams ?? rec.display_params;
        let embDisplayParams: { seats?: number; reason?: string } | undefined;
        if (embDp && typeof embDp === 'object' && !Array.isArray(embDp)) {
          const dpr = embDp as Record<string, unknown>;
          const sn = dpr.seats;
          const rs = dpr.reason;
          embDisplayParams = {
            ...(typeof sn === 'number' && Number.isFinite(sn) ? { seats: Math.max(0, Math.floor(sn)) } : {}),
            ...(typeof rs === 'string' && rs.trim() ? { reason: rs.trim() } : {}),
          };
          if (Object.keys(embDisplayParams).length === 0) embDisplayParams = undefined;
        }
        return {
          ...(hid ? { id: hid } : {}),
          seats: seatsNum,
          status: st,
          bookedAt: bat,
          ...(embDk ? { displayKey: embDk } : {}),
          ...(embDisplayParams ? { displayParams: embDisplayParams } : {}),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
    if (mapped.length > 0) bookingHistory = mapped;
  }

  const partialOwnerRaw =
    (o as Record<string, unknown>).ownerPartialSeatRemoval ??
    (o as Record<string, unknown>).owner_partial_seat_removal;
  const isPendingRequestRaw =
    (o as Record<string, unknown>).isPendingRequest ??
    (o as Record<string, unknown>).is_pending_request;
  const isAcceptedPassengerRaw =
    (o as Record<string, unknown>).isAcceptedPassenger ??
    (o as Record<string, unknown>).is_accepted_passenger;
  const isCancelledByPassengerRaw =
    (o as Record<string, unknown>).isCancelledByPassenger ??
    (o as Record<string, unknown>).is_cancelled_by_passenger;
  const isCancelledByOwnerRaw =
    (o as Record<string, unknown>).isCancelledByOwner ??
    (o as Record<string, unknown>).is_cancelled_by_owner;
  const canOwnerRemoveRaw =
    (o as Record<string, unknown>).canOwnerRemove ??
    (o as Record<string, unknown>).can_owner_remove;
  const showRebookedBadgeRaw =
    (o as Record<string, unknown>).showRebookedBadge ??
    (o as Record<string, unknown>).show_rebooked_badge;
  const rebookedBadgeSourceRaw =
    (o as Record<string, unknown>).rebookedBadgeSource ??
    (o as Record<string, unknown>).rebooked_badge_source;
  const ownerListRoleRaw =
    (o as Record<string, unknown>).ownerListRole ?? (o as Record<string, unknown>).owner_list_role;

  return {
    id: bookingId || `${userId || 'b'}-${toStr(o.bookedAt) ?? ''}`,
    userId,
    userName: userLabel || 'Passenger',
    ...(explicitName ? { name: explicitName } : {}),
    seats: seatsFromRaw(o.seats),
    status,
    bookedAt: toStr(o.bookedAt ?? o.booked_at ?? o.createdAt ?? o.created_at) ?? '',
    ...(pickupLocationName ? { pickupLocationName } : {}),
    ...(destinationLocationName ? { destinationLocationName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(avgRating != null ? { avgRating } : {}),
    ...(ratingCount != null && ratingCount > 0 ? { ratingCount } : {}),
    ...(bookingHistory ? { bookingHistory } : {}),
    ...(partialOwnerRaw === true ? { ownerPartialSeatRemoval: true } : {}),
    ...(isPendingRequestRaw === true ? { isPendingRequest: true } : {}),
    ...(isAcceptedPassengerRaw === true ? { isAcceptedPassenger: true } : {}),
    ...(isCancelledByPassengerRaw === true ? { isCancelledByPassenger: true } : {}),
    ...(isCancelledByOwnerRaw === true ? { isCancelledByOwner: true } : {}),
    ...(typeof canOwnerRemoveRaw === 'boolean' ? { canOwnerRemove: canOwnerRemoveRaw } : {}),
    ...(typeof showRebookedBadgeRaw === 'boolean' ? { showRebookedBadge: showRebookedBadgeRaw } : {}),
    ...(typeof rebookedBadgeSourceRaw === 'string' && rebookedBadgeSourceRaw.trim()
      ? { rebookedBadgeSource: rebookedBadgeSourceRaw.trim() }
      : {}),
    ...(typeof ownerListRoleRaw === 'string' && ownerListRoleRaw.trim()
      ? { ownerListRole: ownerListRoleRaw.trim() }
      : {}),
    // Extract dateOfBirth - check root first, then nested objects
    ...((): { dateOfBirth?: string } => {
      const dob = toStr(
        o.dateOfBirth ??
        o.date_of_birth ??
        o.dob ??
        nestedUser?.dateOfBirth ??
        nestedUser?.date_of_birth ??
        nestedUser?.dob ??
        passenger?.dateOfBirth ??
        passenger?.date_of_birth ??
        passenger?.dob ??
        bookedBy?.dateOfBirth ??
        bookedBy?.date_of_birth ??
        bookedBy?.dob ??
        rider?.dateOfBirth ??
        rider?.date_of_birth ??
        rider?.dob
      );
      return dob ? { dateOfBirth: dob } : {};
    })(),
  };
}

/** rideId for grouping list GET /bookings rows onto rides. */
export function rideIdFromBookingListRow(b: Record<string, unknown>): string | undefined {
  const direct = toStr(b.rideId ?? b.ride_id);
  if (direct) return direct;
  if (b.ride && typeof b.ride === 'object') {
    const r = b.ride as Record<string, unknown>;
    return toStr(r.id ?? r._id);
  }
  return undefined;
}

/** Normalize bookings[] from GET /rides/:id (items may omit rideId). */
export function normalizeBookingsFromDetailResponse(raw: unknown): RideBookingRow[] {
  if (!Array.isArray(raw)) return [];
  const out: RideBookingRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = mapRawToBookingRow(item as Record<string, unknown>);
    if (row) out.push(row);
  }
  return out;
}

/** Extract array from various GET /bookings wrapper shapes. */
export function extractBookingsListArray(bookingsRes: unknown): Record<string, unknown>[] {
  if (Array.isArray(bookingsRes)) return bookingsRes as Record<string, unknown>[];
  if (bookingsRes && typeof bookingsRes === 'object') {
    const o = bookingsRes as Record<string, unknown>;
    const inner = o.bookings ?? o.data;
    if (Array.isArray(inner)) return inner as Record<string, unknown>[];
    if (inner && typeof inner === 'object') {
      const nested = (inner as Record<string, unknown>).bookings;
      if (Array.isArray(nested)) return nested as Record<string, unknown>[];
    }
  }
  return [];
}

/** Group booking list rows by ride id (passenger bookings on rides, or driver-side list if API returns those). */
export function groupBookingListByRideId(rows: Record<string, unknown>[]): Map<string, RideBookingRow[]> {
  const map = new Map<string, RideBookingRow[]>();
  for (const raw of rows) {
    const rideId = rideIdFromBookingListRow(raw);
    if (!rideId) continue;
    const row = mapRawToBookingRow(raw);
    if (!row) continue;
    const list = map.get(rideId) ?? [];
    list.push(row);
    map.set(rideId, list);
  }
  return map;
}

export function mergeBookingsMapOntoRides(
  rides: RideListItem[],
  byRideId: Map<string, RideBookingRow[]>
): RideListItem[] {
  return rides.map((r) => {
    if (r.bookings && r.bookings.length > 0) return r;
    const add = byRideId.get(r.id);
    if (!add?.length) return r;
    return { ...r, bookings: [...add] };
  });
}
