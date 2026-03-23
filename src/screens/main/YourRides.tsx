import React, { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  SectionList,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Animated,
  Easing,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RidesStackParamList } from '../../navigation/types';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { clearRideDetailCache, fetchRideDetailRaw } from '../../services/rideDetailCache';
import { loadOwnerCancelledRides } from '../../services/ownerCancelledRidesStorage';
import { API } from '../../constants/API';
import type { RideListItem } from '../../types/api';
import { COLORS } from '../../constants/colors';
import RideListCard from '../../components/rides/RideListCard';
import {
  isRideCancelledByOwner,
  isRideCompletedForDisplay,
  isViewerRideOwner,
} from '../../utils/rideDisplay';
import {
  extractBookingsListArray,
  groupBookingListByRideId,
  mapRawToBookingRow,
  mergeBookingsMapOntoRides,
  normalizeBookingsFromDetailResponse,
  rideIdFromBookingListRow,
  type RideBookingRow,
} from '../../utils/bookingNormalize';
import { bookingIsCancelled, pickPreferredBookingStatus } from '../../utils/bookingStatus';
import { isRideSeatsFull } from '../../utils/rideSeats';
import {
  buildDrivingPassengerSections,
  countForTab,
  matchesAllRidesTab,
  matchesMyRidesTab,
  matchesPastRidesTab,
  passengerHasBookingRowOnRide,
  sortRidesForYourRides,
  type YourRidesFilterTab,
  type YourRidesListContext,
} from '../../utils/yourRidesList';
import { showToast } from '../../utils/toast';

type FilterTab = YourRidesFilterTab;

/** Normalize API ride item: use rideDate/rideTime or scheduledDate/scheduledTime; derive from scheduledAt if needed. Never use createdAt for "when". */
function normalizeRideItem(raw: Record<string, unknown>): RideListItem {
  const r = raw as Record<string, unknown>;
  const toStr = (v: unknown): string | undefined =>
    v === undefined || v === null ? undefined : String(v);
  const rideDate = toStr(r.rideDate ?? r.ride_date);
  const rideTime = toStr(r.rideTime ?? r.ride_time);
  const scheduledDate = toStr(r.scheduledDate ?? r.scheduled_date ?? r.date);
  const scheduledTime = toStr(r.scheduledTime ?? r.scheduled_time ?? r.time);
  const scheduledAt = toStr(r.scheduledAt ?? r.scheduled_at);
  let outDate = rideDate || scheduledDate;
  let outTime = rideTime || scheduledTime;
  if ((!outDate || !outTime) && scheduledAt) {
    const d = new Date(scheduledAt);
    if (!isNaN(d.getTime())) {
      outDate = outDate || `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      outTime = outTime || `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  }
  const rawSeats = r.seats;
  const seats =
    typeof rawSeats === 'number'
      ? rawSeats
      : rawSeats != null && rawSeats !== ''
        ? Number(rawSeats)
        : undefined;
  const outSeats =
    typeof seats === 'number' && !Number.isNaN(seats) && seats >= 0 ? Math.floor(seats) : undefined;
  const rawBooked = r.bookedSeats ?? r.booked_seats;
  const bookedSeatsNum =
    typeof rawBooked === 'number' && !Number.isNaN(rawBooked)
      ? Math.max(0, Math.floor(rawBooked))
      : undefined;
  const rawTotalBk = r.totalBookings ?? r.total_bookings;
  const totalBookingsNum =
    typeof rawTotalBk === 'number' && !Number.isNaN(rawTotalBk)
      ? Math.max(0, Math.floor(rawTotalBk))
      : undefined;
  const rawAvail = r.availableSeats ?? r.seatsAvailable ?? r.seats_available;
  const availableSeatsNum =
    typeof rawAvail === 'number' && !Number.isNaN(rawAvail)
      ? Math.max(0, Math.floor(rawAvail))
      : undefined;
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && !Number.isNaN(v) ? v : v != null && v !== '' ? Number(v) : undefined;
  const nestedUser =
    r.user && typeof r.user === 'object' ? (r.user as Record<string, unknown>) : undefined;
  const driverDisplayName = toStr(
    r.name ??
      r.driverName ??
      r.driver_name ??
      r.publisherName ??
      r.publisher_name ??
      nestedUser?.name
  );
  const out: RideListItem = {
    id: String(r.id ?? r._id ?? ''),
    userId: toStr(r.userId ?? r.user_id ?? r.driverId ?? r.driver_id),
    pickupLocationName: toStr(r.pickupLocationName ?? r.pickup_location_name ?? r.from),
    destinationLocationName: toStr(r.destinationLocationName ?? r.destination_location_name ?? r.to),
    pickupLatitude: num(r.pickupLatitude ?? r.pickup_latitude),
    pickupLongitude: num(r.pickupLongitude ?? r.pickup_longitude),
    destinationLatitude: num(r.destinationLatitude ?? r.destination_latitude),
    destinationLongitude: num(r.destinationLongitude ?? r.destination_longitude),
    from: toStr(r.from),
    to: toStr(r.to),
    username: toStr(r.username ?? r.user_name ?? nestedUser?.username),
    ...(driverDisplayName ? { name: driverDisplayName } : {}),
    seats: outSeats,
    ...(bookedSeatsNum !== undefined ? { bookedSeats: bookedSeatsNum } : {}),
    ...(totalBookingsNum !== undefined ? { totalBookings: totalBookingsNum } : {}),
    ...(availableSeatsNum !== undefined ? { availableSeats: availableSeatsNum } : {}),
    rideDate: outDate,
    rideTime: outTime,
    scheduledDate: scheduledDate || outDate,
    scheduledTime: scheduledTime || outTime,
    scheduledAt: scheduledAt || undefined,
    date: toStr(r.date),
    time: toStr(r.time),
    createdAt: toStr(r.createdAt ?? r.created_at),
    price: toStr(
      r.price ??
      r.fare ??
      r.amount ??
      r.pricePerSeat ??
      r.price_per_seat ??
      r.farePerSeat ??
      r.fare_per_seat ??
      (typeof r.pricing === 'object' && r.pricing ? (r.pricing as Record<string, unknown>).price : undefined)
    ),
    vehicleModel: toStr(r.vehicleModel ?? r.vehicle_model),
    licensePlate: toStr(r.licensePlate ?? r.license_plate),
    vehicleNumber: toStr(r.vehicleNumber ?? r.vehicle_number),
    status: (() => {
      const st = toStr(r.status ?? r.ride_status ?? r.state ?? r.rideState);
      if (st) return st;
      if (r.cancelled_at != null || r.cancelledAt != null || r.deleted_at != null || r.deletedAt != null) {
        return 'cancelled';
      }
      return undefined;
    })(),
  };
  const estDur = num(r.estimatedDurationSeconds ?? r.estimated_duration_seconds);
  if (estDur !== undefined && estDur > 0) {
    out.estimatedDurationSeconds = Math.floor(estDur);
  }
  const rawBookings = r.bookings;
  if (Array.isArray(rawBookings)) {
    const rows = rawBookings
      .map((b) => mapRawToBookingRow(b as Record<string, unknown>))
      .filter((row): row is NonNullable<RideListItem['bookings']>[number] => row != null);
    if (rows.length > 0) out.bookings = rows;
  }
  const rawVi = r.viewerIsOwner ?? r.viewer_is_owner;
  if (typeof rawVi === 'boolean') out.viewerIsOwner = rawVi;
  else if (rawVi === 'true') out.viewerIsOwner = true;
  else if (rawVi === 'false') out.viewerIsOwner = false;
  return out;
}

/**
 * GET /rides may omit owner-cancelled rides; GET /bookings still has rows. Build list items from
 * embedded `ride` on each booking when the ride id is not already in the list.
 */
function appendMissingRidesFromEmbeddedBookings(
  list: RideListItem[],
  bookingsArr: Record<string, unknown>[],
  byRide: Map<string, RideBookingRow[]>,
  myBookingStatusByRideId: Map<string, string>
): RideListItem[] {
  const existing = new Set(list.map((r) => r.id));
  const extras: RideListItem[] = [];
  byRide.forEach((rideBookings, rideId) => {
    if (existing.has(rideId)) return;
    const raw = bookingsArr.find((b) => rideIdFromBookingListRow(b) === rideId);
    if (!raw || !raw.ride || typeof raw.ride !== 'object') return;
    const stub = normalizeRideItem(raw.ride as Record<string, unknown>);
    const st = myBookingStatusByRideId.get(rideId);
    extras.push({
      ...stub,
      id: rideId,
      bookings: rideBookings,
      ...(st !== undefined ? { myBookingStatus: st } : {}),
      viewerIsOwner: false,
    });
  });
  return [...list, ...extras];
}

function rideListItemFromDetailPayload(res: unknown): RideListItem | null {
  if (!res || typeof res !== 'object') return null;
  const root = res as Record<string, unknown>;
  const candidate =
    (root.ride && typeof root.ride === 'object' ? (root.ride as Record<string, unknown>) : null) ??
    (root.data && typeof root.data === 'object'
      ? (((root.data as Record<string, unknown>).ride &&
          typeof (root.data as Record<string, unknown>).ride === 'object')
          ? ((root.data as Record<string, unknown>).ride as Record<string, unknown>)
          : (root.data as Record<string, unknown>))
      : null) ??
    root;
  return normalizeRideItem(candidate as Record<string, unknown>);
}

/**
 * Parse list payloads: top-level array, `{ rides }`, `{ data: [...] }`, `{ data: { rides } }`,
 * or `{ items }` — otherwise “All rides” / “My rides” look empty while the network returns 200.
 */
function extractRawList(res: unknown): Record<string, unknown>[] {
  if (res == null) return [];
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const d = res as Record<string, unknown>;
  if (Array.isArray(d.rides)) return d.rides as Record<string, unknown>[];
  if (Array.isArray(d.items)) return d.items as Record<string, unknown>[];
  const data = d.data;
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    const inner = data as Record<string, unknown>;
    if (Array.isArray(inner.rides)) return inner.rides as Record<string, unknown>[];
    if (Array.isArray(inner.items)) return inner.items as Record<string, unknown>[];
    if (Array.isArray(inner.data)) return inner.data as Record<string, unknown>[];
  }
  return [];
}

/**
 * Merge GET /my-rides (driver) with GET /rides/booked (passenger, incl. owner-cancelled).
 * Published entries win on conflict; counts may be filled from the booked response.
 */
function mergePublishedAndBookedRideLists(
  published: RideListItem[],
  bookedAsPassenger: RideListItem[]
): RideListItem[] {
  const map = new Map<string, RideListItem>();
  for (const r of published) {
    if (!r.id) continue;
    // /my-rides = rides you published; treat as yours unless API explicitly says otherwise.
    map.set(r.id, { ...r, viewerIsOwner: r.viewerIsOwner !== false });
  }
  for (const r of bookedAsPassenger) {
    if (!r.id) continue;
    const existing = map.get(r.id);
    const fromBooked = { ...r, viewerIsOwner: r.viewerIsOwner ?? false };
    if (!existing) {
      map.set(r.id, fromBooked);
      continue;
    }
    map.set(r.id, {
      ...existing,
      totalBookings: fromBooked.totalBookings ?? existing.totalBookings,
      bookedSeats: fromBooked.bookedSeats ?? existing.bookedSeats,
      bookings:
        (existing.bookings?.length ?? 0) >= (fromBooked.bookings?.length ?? 0)
          ? existing.bookings
          : fromBooked.bookings,
      viewerIsOwner: existing.viewerIsOwner === true || fromBooked.viewerIsOwner === true,
    });
  }
  return Array.from(map.values());
}

/**
 * Union in rides from GET /rides (browse catalog) for “All rides”.
 * Existing rows win on id. For **new** rows: never set `viewerIsOwner: false` by default —
 * public lists often send false/omit for everyone, which blocks isViewerRideOwner’s
 * userId fallback so real owners disappear from “My rides”.
 */
function mergeBrowseCatalogIntoList(list: RideListItem[], browse: RideListItem[]): RideListItem[] {
  const map = new Map<string, RideListItem>();
  for (const r of list) {
    if (r.id) map.set(r.id, r);
  }
  for (const r of browse) {
    if (!r.id) continue;
    if (!map.has(r.id)) {
      const next: RideListItem = { ...r };
      if (next.viewerIsOwner !== true) {
        delete next.viewerIsOwner;
      }
      map.set(r.id, next);
    }
  }
  return Array.from(map.values());
}

type RidesResponse = { rides?: RideListItem[] } | RideListItem[];

/** Space out ride-list calls so strict backends don’t return 429 for 3× parallel GET /rides*. */
const RIDE_LIST_STAGGER_MS = 150;

function rideListStagger(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RIDE_LIST_STAGGER_MS));
}

function apiErrorStatus(e: unknown): number | undefined {
  if (e && typeof e === 'object' && 'status' in e) {
    const s = (e as { status: unknown }).status;
    return typeof s === 'number' ? s : undefined;
  }
  return undefined;
}

/** GET without throwing — used to combine results and avoid parallel rate-limit bursts. */
async function apiGetOrNull(path: string): Promise<{ data: unknown | null; status?: number }> {
  try {
    const data = await api.get<unknown>(path);
    return { data };
  } catch (e: unknown) {
    return { data: null, status: apiErrorStatus(e) };
  }
}

type YourRidesNavProp = NativeStackNavigationProp<RidesStackParamList, 'YourRidesList'>;

function YourRidesRideCard({
  item,
  filter,
  currentUserId,
  currentUserName,
  bookedRideIds,
  onNavigateDetail,
}: {
  item: RideListItem;
  filter: FilterTab;
  currentUserId: string;
  currentUserName: string;
  bookedRideIds: Set<string>;
  onNavigateDetail: (ride: RideListItem) => void;
}): React.JSX.Element {
  const isPassengerContext =
    (item.userId ?? '').trim() !== currentUserId && bookedRideIds.has(item.id);
  const isOwnerView = isViewerRideOwner(item, currentUserId);
  const hasMyActiveBooking =
    (item.bookings ?? []).some(
      (b) => (b.userId ?? '').trim() === currentUserId && !bookingIsCancelled(b.status)
    ) ||
    Boolean(
      item.myBookingStatus &&
        String(item.myBookingStatus).trim() &&
        !bookingIsCancelled(String(item.myBookingStatus))
    );
  const seatFullBlocked = !isOwnerView && isRideSeatsFull(item) && !hasMyActiveBooking;
  const cancelledByYouInPast =
    filter === 'pastRides' && isPassengerContext && bookingIsCancelled(item.myBookingStatus);
  const showCancelledBadgePast =
    filter === 'pastRides' &&
    (bookingIsCancelled(item.myBookingStatus) ||
      (isRideCancelledByOwner(item) && (isOwnerView || bookedRideIds.has(item.id))));
  const pastCancelledAndRideFull = cancelledByYouInPast && isRideSeatsFull(item);
  return (
    <RideListCard
      ride={item}
      currentUserId={currentUserId}
      currentUserName={currentUserName}
      showCancelledBadge={showCancelledBadgePast}
      showCompletedBadge={filter === 'pastRides' && isRideCompletedForDisplay(item)}
      seatFullUnavailable={seatFullBlocked || pastCancelledAndRideFull}
      hideSeatAvailability={filter === 'pastRides'}
      myRidesOwnerSummary={filter === 'myRides'}
      onPress={() => {
        if (seatFullBlocked || pastCancelledAndRideFull) {
          showToast({
            title: 'Ride full',
            message: 'All seats on this ride are booked.',
            variant: 'info',
          });
          return;
        }
        onNavigateDetail(item);
      }}
    />
  );
}

export default function YourRides(): React.JSX.Element {
  const navigation = useNavigation<YourRidesNavProp>();
  const route = useRoute<RouteProp<RidesStackParamList, 'YourRidesList'>>();
  const { user } = useAuth();
  const currentUserId = (user?.id ?? '').trim();
  const currentUserName = (user?.name ?? '').trim();
  const [rides, setRides] = useState<RideListItem[]>([]);
  const [bookedRideIds, setBookedRideIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterTab>('myRides');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Softer copy + animation right after booking navigates here. */
  const [justBookedWelcome, setJustBookedWelcome] = useState(false);
  const loaderOpacity = useRef(new Animated.Value(0)).current;

  const fetchRides = useCallback(async () => {
    setError(null);
    setLoading(true);
    const ownerId = currentUserId.trim();
    try {
      let saw429 = false;

      /** Sequential + stagger: parallel calls often trigger 429 on rate-limited APIs. */
      const myPublishedRes = await apiGetOrNull(API.endpoints.rides.myPublished);
      if (myPublishedRes.status === 429) saw429 = true;
      /** Driver’s published rides only — never treat full GET /rides as “published” (would mark everyone as owner). */
      let publishedRaw: Record<string, unknown>[] = [];
      if (myPublishedRes.data != null) {
        publishedRaw = extractRawList(myPublishedRes.data);
        if (__DEV__) {
          console.log('========== GET /my-rides – API response ==========');
          console.log(JSON.stringify(myPublishedRes.data, null, 2));
          console.log('================================================');
        }
      } else if (__DEV__) {
        console.log('========== GET /my-rides failed — driver list empty; catalog still from GET /rides ==========');
      }

      await rideListStagger();
      const bookedResult = await apiGetOrNull(API.endpoints.rides.booked);
      if (bookedResult.status === 429) saw429 = true;
      let bookedRaw: Record<string, unknown>[] = [];
      if (bookedResult.data != null) {
        bookedRaw = extractRawList(bookedResult.data);
        if (__DEV__) {
          console.log('========== GET /rides/booked – API response ==========');
          console.log(JSON.stringify(bookedResult.data, null, 2));
          console.log('================================================');
        }
      }

      await rideListStagger();
      const browseListResult = await apiGetOrNull(API.endpoints.rides.list);
      if (browseListResult.status === 429) saw429 = true;
      let browseRaw: Record<string, unknown>[] = [];
      if (browseListResult.data != null) {
        browseRaw = extractRawList(browseListResult.data);
        if (__DEV__) {
          console.log('========== GET /rides (browse catalog) – API response ==========');
          console.log(JSON.stringify(browseListResult.data, null, 2));
          console.log('================================================');
        }
      } else if (browseListResult.status !== 429) {
        /** Don’t retry immediately after 429 — same bucket, makes things worse. */
        try {
          await rideListStagger();
          const ridesRes = await api.get<RidesResponse>(API.endpoints.rides.list);
          browseRaw = extractRawList(ridesRes);
          if (__DEV__) {
            console.log('========== GET /rides (browse retry) – API response ==========');
            console.log(JSON.stringify(ridesRes, null, 2));
            console.log('================================================');
          }
        } catch {
          /* ignore */
        }
      }

      const published = publishedRaw.map(normalizeRideItem);
      const bookedPassenger = bookedRaw.map(normalizeRideItem);
      const browseCatalog = browseRaw.map(normalizeRideItem);
      let list = mergePublishedAndBookedRideLists(published, bookedPassenger);
      list = mergeBrowseCatalogIntoList(list, browseCatalog);

      let bookedIds = new Set<string>();
      const myBookingStatusByRideId = new Map<string, string>();
      await rideListStagger();
      const bookingsWrap = await apiGetOrNull(API.endpoints.bookings.list);
      if (bookingsWrap.status === 429) saw429 = true;
      try {
        if (bookingsWrap.data == null) {
          bookedIds = new Set();
        } else {
          const arr = extractBookingsListArray(bookingsWrap.data);
          bookedIds = new Set<string>();
        /** Same ride may appear twice after re-book (cancelled + active) — prefer active status. */
        const myStatusesPerRide = new Map<string, string[]>();
        arr.forEach((raw) => {
          const rideId = rideIdFromBookingListRow(raw);
          if (rideId) bookedIds.add(rideId);
          const row = mapRawToBookingRow(raw);
          if (!row || !rideId || !ownerId) return;
          if ((row.userId ?? '').trim() === ownerId) {
            const acc = myStatusesPerRide.get(rideId) ?? [];
            acc.push(row.status ?? '');
            myStatusesPerRide.set(rideId, acc);
          }
        });
        myStatusesPerRide.forEach((statuses, rideId) => {
          myBookingStatusByRideId.set(rideId, pickPreferredBookingStatus(statuses));
        });
        const byRide = groupBookingListByRideId(arr);
        list = mergeBookingsMapOntoRides(list, byRide);
        list = list.map((r) => {
          const st = myBookingStatusByRideId.get(r.id);
          if (st !== undefined) return { ...r, myBookingStatus: st };
          return r;
        });
        // Passenger rides dropped from GET /rides (e.g. owner cancelled) — still in GET /bookings.
        list = appendMissingRidesFromEmbeddedBookings(list, arr, byRide, myBookingStatusByRideId);
        const idsKnown = new Set(list.map((r) => r.id));
        const missingRideIds = [...byRide.keys()].filter((id) => !idsKnown.has(id));
        if (missingRideIds.length > 0 && ownerId) {
          const fetched = await Promise.all(
            missingRideIds.map(async (rideId) => {
              try {
                const res = await fetchRideDetailRaw(rideId, {
                  force: true,
                  viewerUserId: ownerId,
                });
                const item = rideListItemFromDetailPayload(res);
                if (!item) return null;
                const rows = byRide.get(rideId) ?? [];
                const st = myBookingStatusByRideId.get(rideId);
                return {
                  ...item,
                  id: rideId,
                  bookings: rows,
                  ...(st !== undefined ? { myBookingStatus: st } : {}),
                  viewerIsOwner: false,
                } as RideListItem;
              } catch {
                return null;
              }
            })
          );
          list = [...list, ...fetched.filter((x): x is RideListItem => x != null)];
        }
        }
      } catch {
        bookedIds = new Set();
      }

      /** GET /rides/booked — always treat these ride ids as passenger-side “mine” for filters. */
      bookedPassenger.forEach((r) => {
        if (r.id) bookedIds.add(r.id);
      });

      // List responses often omit bookings; load passengers for your published rides (same as ride detail).
      if (ownerId) {
        const ownedMissing = list.filter(
          (r) => (r.userId ?? '').trim() === ownerId && (!r.bookings || r.bookings.length === 0)
        );
        if (ownedMissing.length > 0) {
          const detailResults = await Promise.all(
            ownedMissing.map(async (r) => {
              try {
                const res = (await fetchRideDetailRaw(r.id, {
                  viewerUserId: ownerId,
                })) as RideListItem & {
                  bookings?: unknown[];
                };
                const rawBk =
                  res && typeof res === 'object'
                    ? (res as RideListItem).bookings
                    : undefined;
                const bookings = normalizeBookingsFromDetailResponse(rawBk);
                return { id: r.id, bookings };
              } catch {
                return { id: r.id, bookings: [] as NonNullable<RideListItem['bookings']> };
              }
            })
          );
          const detailMap = new Map(detailResults.map((x) => [x.id, x.bookings]));
          list = list.map((r) => {
            const b = detailMap.get(r.id);
            if (b && b.length > 0) return { ...r, bookings: b };
            return r;
          });
        }
      }

      // If ride.bookings has several rows for this user (cancel + rebook), prefer active over cancelled.
      if (ownerId) {
        list = list.map((r) => {
          const mine = (r.bookings ?? []).filter((b) => (b.userId ?? '').trim() === ownerId);
          if (mine.length === 0) return r;
          const fromBookings = pickPreferredBookingStatus(mine.map((b) => b.status ?? ''));
          const prev = r.myBookingStatus;
          if (prev === undefined || prev === '') return { ...r, myBookingStatus: fromBookings };
          return { ...r, myBookingStatus: pickPreferredBookingStatus([prev, fromBookings]) };
        });
      }

      // Owner-cancelled rides: many APIs omit them from GET /rides — merge local snapshots.
      if (ownerId) {
        try {
          const localRaw = await loadOwnerCancelledRides(ownerId);
          for (const raw of localRaw) {
            const local = normalizeRideItem(raw as Record<string, unknown>);
            const idx = list.findIndex((x) => x.id === local.id);
            if (idx >= 0) {
              const cur = list[idx];
              if (isRideCancelledByOwner(local) && !isRideCancelledByOwner(cur)) {
                list[idx] = { ...cur, status: 'cancelled' };
              }
            } else {
              list.push(local);
            }
          }
        } catch {
          /* ignore */
        }
      }

      if (list.length === 0 && saw429) {
        setError(
          'Too many requests (429): your backend is rate-limiting. Wait 30–60 seconds, pull to refresh, or raise limits for development.'
        );
      } else {
        setError(null);
      }

      /** Keep passenger ride ids for filters when owner cancels but list still has booking/status merge. */
      if (ownerId) {
        for (const r of list) {
          if (passengerHasBookingRowOnRide(r, ownerId)) bookedIds.add(r.id);
          const st = r.myBookingStatus;
          if (
            st != null &&
            String(st).trim() !== '' &&
            !isViewerRideOwner(r, ownerId)
          ) {
            bookedIds.add(r.id);
          }
        }
      }

      setRides(list);
      setBookedRideIds(bookedIds);
    } catch (e: unknown) {
      let message = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : 'Failed to load rides.';
      if (message === 'Network request failed' || message === 'Aborted' || message.includes('timed out')) {
        message = 'Cannot reach server. Check that the backend is running and your device is on the same network.';
      }
      setError(message);
      setRides([]);
      setBookedRideIds(new Set());
    } finally {
      setLoading(false);
      setJustBookedWelcome(false);
    }
  }, [currentUserId]);

  useFocusEffect(
    useCallback(() => {
      const afterBook = route.params?._afterBookRefresh;
      if (afterBook != null) {
        setJustBookedWelcome(true);
        setFilter('myRides');
        navigation.setParams({ _afterBookRefresh: undefined });
        setRides([]);
        setBookedRideIds(new Set());
        setError(null);
        setLoading(true);
      }
      fetchRides();
    }, [fetchRides, navigation, route.params])
  );

  const goRideDetail = useCallback(
    (ride: RideListItem) => {
      navigation.navigate('RideDetail', { ride });
    },
    [navigation]
  );

  const listCtx = useMemo<YourRidesListContext>(
    () => ({ userId: currentUserId, bookedRideIds }),
    [currentUserId, bookedRideIds]
  );

  const tabCounts = useMemo(
    () => ({
      myRides: countForTab(rides, 'myRides', listCtx),
      allRides: countForTab(rides, 'allRides', listCtx),
      pastRides: countForTab(rides, 'pastRides', listCtx),
    }),
    [rides, listCtx]
  );

  const allRidesFlat = useMemo(
    () => sortRidesForYourRides(rides.filter(matchesAllRidesTab), 'upcoming'),
    [rides]
  );

  const myRidesSections = useMemo(
    () =>
      buildDrivingPassengerSections(
        rides.filter((r) => matchesMyRidesTab(r, listCtx)),
        currentUserId,
        'upcoming'
      ),
    [rides, listCtx, currentUserId]
  );

  const pastRidesSections = useMemo(
    () =>
      buildDrivingPassengerSections(
        rides.filter((r) => matchesPastRidesTab(r, listCtx)),
        currentUserId,
        'past'
      ),
    [rides, listCtx, currentUserId]
  );

  useEffect(() => {
    if (!(loading && rides.length === 0)) {
      loaderOpacity.setValue(0);
      return;
    }
    loaderOpacity.setValue(0);
    const anim = Animated.timing(loaderOpacity, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [loading, rides.length, loaderOpacity]);

  if (loading && rides.length === 0) {
    return (
      <View style={styles.center}>
        <Animated.View style={[styles.loaderInner, { opacity: loaderOpacity }]}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingTitle}>
            {justBookedWelcome ? "You're in" : 'Your rides'}
          </Text>
          <Text style={styles.loadingText}>
            {justBookedWelcome
              ? 'Syncing your bookings…'
              : 'Loading your rides…'}
          </Text>
        </Animated.View>
      </View>
    );
  }

  if (error && rides.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color={COLORS.error} />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            clearRideDetailCache();
            void fetchRides();
          }}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'myRides' && styles.filterTabActive]}
          onPress={() => setFilter('myRides')}
          activeOpacity={0.8}
        >
          <Text style={[styles.filterTabText, filter === 'myRides' && styles.filterTabTextActive]}>
            My rides{tabCounts.myRides > 0 ? ` (${tabCounts.myRides})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'allRides' && styles.filterTabActive]}
          onPress={() => setFilter('allRides')}
          activeOpacity={0.8}
        >
          <Text style={[styles.filterTabText, filter === 'allRides' && styles.filterTabTextActive]}>
            All rides{tabCounts.allRides > 0 ? ` (${tabCounts.allRides})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'pastRides' && styles.filterTabActive]}
          onPress={() => setFilter('pastRides')}
          activeOpacity={0.8}
        >
          <Text style={[styles.filterTabText, filter === 'pastRides' && styles.filterTabTextActive]}>
            Past rides{tabCounts.pastRides > 0 ? ` (${tabCounts.pastRides})` : ''}
          </Text>
        </TouchableOpacity>
      </View>
      {filter === 'allRides' ? (
        <FlatList
          data={allRidesFlat}
          keyExtractor={(item) => item.id}
          contentContainerStyle={allRidesFlat.length === 0 ? styles.emptyList : styles.list}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => {
                clearRideDetailCache();
                void fetchRides();
              }}
              colors={[COLORS.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="car-outline" size={56} color={COLORS.textMuted} />
              <Text style={styles.emptyTitle}>No upcoming rides</Text>
              <Text style={styles.emptySubtitle}>
                Nothing scheduled ahead right now. Pull to refresh or check back later.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <YourRidesRideCard
              item={item}
              filter={filter}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              bookedRideIds={bookedRideIds}
              onNavigateDetail={goRideDetail}
            />
          )}
        />
      ) : (
        <SectionList
          sections={filter === 'myRides' ? myRidesSections : pastRidesSections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          )}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={
            (filter === 'myRides' ? myRidesSections : pastRidesSections).length === 0
              ? styles.emptyList
              : styles.list
          }
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => {
                clearRideDetailCache();
                void fetchRides();
              }}
              colors={[COLORS.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="car-outline" size={56} color={COLORS.textMuted} />
              <Text style={styles.emptyTitle}>
                {filter === 'myRides' ? 'No upcoming rides' : 'No past rides'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {filter === 'myRides'
                  ? 'Publish a ride or book a seat — your active trips show up here, split by driving vs riding.'
                  : 'When a ride ends or is cancelled, it moves here (for rides you hosted or joined).'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <YourRidesRideCard
              item={item}
              filter={filter}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              bookedRideIds={bookedRideIds}
              onNavigateDetail={goRideDetail}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 6,
    backgroundColor: COLORS.background,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 4,
    marginBottom: 8,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterTabActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  filterTabTextActive: {
    color: COLORS.white,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    padding: 24,
  },
  loaderInner: {
    alignItems: 'center',
    maxWidth: 280,
  },
  loadingTitle: {
    marginTop: 20,
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  errorText: {
    marginTop: 12,
    fontSize: 15,
    color: COLORS.error,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  emptyList: {
    flexGrow: 1,
    padding: 16,
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
});
