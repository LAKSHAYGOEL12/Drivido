import type { RideListItem } from '../types/api';
import { pickAvatarUrlFromRecord } from './avatarUrl';

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
    (bookedBy ? pickAvatarUrlFromRecord(bookedBy) : undefined);

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

  return {
    id: bookingId || `${userId || 'b'}-${toStr(o.bookedAt) ?? ''}`,
    userId,
    userName: userLabel || 'Passenger',
    ...(explicitName ? { name: explicitName } : {}),
    seats: seatsFromRaw(o.seats),
    status: toStr(o.status) ?? '',
    bookedAt: toStr(o.bookedAt ?? o.booked_at ?? o.createdAt ?? o.created_at) ?? '',
    ...(pickupLocationName ? { pickupLocationName } : {}),
    ...(destinationLocationName ? { destinationLocationName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
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
