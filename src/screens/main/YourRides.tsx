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
  Modal,
  Pressable,
  TextInput,
  Platform,
  Alert,
  Keyboard,
  BackHandler,
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
import { hasCurrentUserRatedRide, submitRideRating } from '../../services/ratings';
import { hasHandledRatingPrompt, markRatingPromptHandled } from '../../services/ratingPromptStorage';

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
  ratedRideIds,
  ratedTargetsByRide,
  onNavigateDetail,
  onRateRide,
}: {
  item: RideListItem;
  filter: FilterTab;
  currentUserId: string;
  currentUserName: string;
  bookedRideIds: Set<string>;
  ratedRideIds: Set<string>;
  ratedTargetsByRide: Record<string, string[]>;
  onNavigateDetail: (ride: RideListItem) => void;
  onRateRide: (ride: RideListItem) => void;
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
  const isCompletedByBackendStatus = String(item.status ?? '').trim().toLowerCase() === 'completed';
  const showRatePromptPast =
    filter === 'pastRides' &&
    isCompletedByBackendStatus &&
    !bookingIsCancelled(item.myBookingStatus) &&
    !isRideCancelledByOwner(item) &&
    (() => {
      if (!isOwnerView) return !ratedRideIds.has(item.id);
      const activePassengerIds = (item.bookings ?? [])
        .filter((b) => !bookingIsCancelled(b.status))
        .map((b) => (b.userId ?? '').trim())
        .filter((uid) => uid && uid !== currentUserId);
      if (activePassengerIds.length === 0) return false;
      const ratedSet = new Set(ratedTargetsByRide[item.id] ?? []);
      return activePassengerIds.some((uid) => !ratedSet.has(uid));
    })();
  const showRatedStatePast =
    filter === 'pastRides' &&
    isCompletedByBackendStatus &&
    !bookingIsCancelled(item.myBookingStatus) &&
    !isRideCancelledByOwner(item) &&
    (() => {
      if (!isOwnerView) return ratedRideIds.has(item.id);
      const activePassengerIds = (item.bookings ?? [])
        .filter((b) => !bookingIsCancelled(b.status))
        .map((b) => (b.userId ?? '').trim())
        .filter((uid) => uid && uid !== currentUserId);
      if (activePassengerIds.length === 0) return false;
      const ratedSet = new Set(ratedTargetsByRide[item.id] ?? []);
      return activePassengerIds.every((uid) => ratedSet.has(uid));
    })();
  const pastCancelledAndRideFull = cancelledByYouInPast && isRideSeatsFull(item);
  return (
    <RideListCard
      ride={item}
      currentUserId={currentUserId}
      currentUserName={currentUserName}
      showCancelledBadge={showCancelledBadgePast}
      showCompletedBadge={filter === 'pastRides' && isCompletedByBackendStatus}
      seatFullUnavailable={seatFullBlocked || pastCancelledAndRideFull}
      hideSeatAvailability={filter === 'pastRides'}
      myRidesOwnerSummary={filter === 'myRides'}
      showRatePrompt={showRatePromptPast}
      showRatedState={showRatedStatePast}
      onRatePress={() => onRateRide(item)}
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
  const [ratingRide, setRatingRide] = useState<RideListItem | null>(null);
  const [showRatingSheet, setShowRatingSheet] = useState(false);
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingReview, setRatingReview] = useState('');
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [selectedRateTargetUserId, setSelectedRateTargetUserId] = useState('');
  const [selectedRateTargetName, setSelectedRateTargetName] = useState('');
  const [ratedTargetsByRide, setRatedTargetsByRide] = useState<Record<string, string[]>>({});
  const [ratingKeyboardVisible, setRatingKeyboardVisible] = useState(false);
  const ratingKeyboardOffset = useRef(new Animated.Value(0)).current;
  const [ratedRideIds, setRatedRideIds] = useState<Set<string>>(new Set());
  const ratingCheckInFlightRef = useRef<Set<string>>(new Set());

  // Block "navigate back" while the initial loader is visible.
  // Prevents accidental stack pops if the user taps back during refresh/loading.
  const isInitialLoaderVisible = loading && rides.length === 0;
  useEffect(() => {
    if (!isInitialLoaderVisible) return;

    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      e.preventDefault();
    });

    const backSub = BackHandler.addEventListener('hardwareBackPress', () => true);

    return () => {
      unsubscribe();
      backSub.remove();
    };
  }, [isInitialLoaderVisible, navigation]);

  useEffect(() => {
    const tabNav = navigation.getParent();
    if (!tabNav) return;
    tabNav.setOptions({
      tabBarStyle: filter === 'pastRides' ? { display: 'none' } : undefined,
    });
    return () => {
      tabNav.setOptions({ tabBarStyle: undefined });
    };
  }, [navigation, filter]);

  useEffect(() => {
    if (!currentUserId || filter !== 'pastRides') return;
    const candidates = rides.filter((r) => {
      const completed = String(r.status ?? '').trim().toLowerCase() === 'completed';
      return completed && !bookingIsCancelled(r.myBookingStatus) && !isRideCancelledByOwner(r);
    });
    if (candidates.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const ride of candidates) {
        if (cancelled) break;
        if (ratedRideIds.has(ride.id)) continue;
        if (ratingCheckInFlightRef.current.has(ride.id)) continue;
        ratingCheckInFlightRef.current.add(ride.id);
        try {
          const targetUserId = isViewerRideOwner(ride, currentUserId)
            ? undefined
            : (ride.userId ?? '').trim() || undefined;
          const rated = await hasCurrentUserRatedRide(ride.id, currentUserId, targetUserId);
          if (cancelled) break;
          if (rated) {
            setRatedRideIds((prev) => {
              const next = new Set(prev);
              next.add(ride.id);
              return next;
            });
          }
        } catch {
          // ignore pre-check failures; submit path remains backend-protected
        } finally {
          ratingCheckInFlightRef.current.delete(ride.id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rides, filter, currentUserId, ratedRideIds]);

  useEffect(() => {
    const onShow = (e: { endCoordinates?: { height?: number } }) => {
      setRatingKeyboardVisible(true);
      const h = Math.max(0, e?.endCoordinates?.height ?? 0);
      Animated.timing(ratingKeyboardOffset, {
        toValue: h,
        duration: 220,
        useNativeDriver: true,
      }).start();
    };
    const onHide = () => {
      setRatingKeyboardVisible(false);
      Animated.timing(ratingKeyboardOffset, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    };
    const showSub = Keyboard.addListener('keyboardDidShow', onShow);
    const hideSub = Keyboard.addListener('keyboardDidHide', onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [ratingKeyboardOffset]);

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

  const closeRatingSheet = useCallback(() => {
    Keyboard.dismiss();
    setShowRatingSheet(false);
    setRatingStars(0);
    setRatingReview('');
    setRatingSubmitting(false);
    setSelectedRateTargetUserId('');
    setSelectedRateTargetName('');
    setRatingRide(null);
    setRatingKeyboardVisible(false);
    ratingKeyboardOffset.setValue(0);
  }, [ratingKeyboardOffset]);

  const handleSkipRating = useCallback(async () => {
    if (currentUserId && ratingRide?.id) {
      await markRatingPromptHandled(currentUserId, ratingRide.id);
    }
    closeRatingSheet();
  }, [closeRatingSheet, currentUserId, ratingRide?.id]);

  const openRateSheet = useCallback(
    async (ride: RideListItem) => {
      if (!currentUserId) return;
      if (String(ride.status ?? '').trim().toLowerCase() !== 'completed') {
        showToast({
          title: 'Rating unavailable',
          message: 'Ratings are available only after the ride is marked completed.',
          variant: 'info',
        });
        return;
      }
      const isOwner = isViewerRideOwner(ride, currentUserId);
      const activePassengers = (ride.bookings ?? []).filter(
        (b) => !bookingIsCancelled(b.status) && (b.userId ?? '').trim() && (b.userId ?? '').trim() !== currentUserId
      );
      const rideOwnerId = (ride.userId ?? '').trim();
      if (!isOwner && rideOwnerId) {
        try {
          const alreadyRated = await hasCurrentUserRatedRide(ride.id, currentUserId, rideOwnerId);
          if (alreadyRated) {
            setRatedRideIds((prev) => {
              const next = new Set(prev);
              next.add(ride.id);
              return next;
            });
            showToast({
              title: 'Already rated',
              message: 'You have already rated this ride.',
              variant: 'info',
            });
            return;
          }
        } catch {
          // Non-blocking fallback: allow opening; backend duplicate guard still protects POST.
        }
      }

      if (isOwner && activePassengers.length > 0) {
        // Do not block opening with pre-check calls for owner flow.
        // Some backends may return broad "rated" results, which can falsely mark all passengers as rated.
        // Duplicate submissions are still guarded by backend (409) in submit handler.
        const ratedForRide = new Set(ratedTargetsByRide[ride.id] ?? []);
        if (ratedForRide.size >= activePassengers.length) {
          showToast({
            title: 'Already rated',
            message: 'You have already rated all passengers for this ride.',
            variant: 'info',
          });
          return;
        }
      }

      setRatingRide(ride);
      if (isOwner && activePassengers.length === 1) {
        const p = activePassengers[0];
        setSelectedRateTargetUserId((p.userId ?? '').trim());
        setSelectedRateTargetName((p.name ?? p.userName ?? 'Passenger').trim() || 'Passenger');
      } else {
        setSelectedRateTargetUserId('');
        setSelectedRateTargetName('');
      }
      setShowRatingSheet(true);
    },
    [currentUserId, ratedTargetsByRide]
  );

  const handleSubmitRating = useCallback(async () => {
    if (!ratingRide || !currentUserId) return;
    if (ratingSubmitting) return;
    if (ratingStars < 1 || ratingStars > 5) {
      Alert.alert('Select rating', 'Please select 1 to 5 stars.');
      return;
    }

    const rideOwnerId = (ratingRide.userId ?? '').trim();
    const isOwner = isViewerRideOwner(ratingRide, currentUserId);
    const activePassenger = (ratingRide.bookings ?? []).find(
      (b) => !bookingIsCancelled(b.status) && (b.userId ?? '').trim() && (b.userId ?? '').trim() !== currentUserId
    );
    const ownerCandidatesCount = isOwner
      ? (ratingRide.bookings ?? []).filter(
          (b) =>
            !bookingIsCancelled(b.status) &&
            (b.userId ?? '').trim() &&
            (b.userId ?? '').trim() !== currentUserId
        ).length
      : 0;
    const toUserId = isOwner
      ? (selectedRateTargetUserId || (activePassenger?.userId ?? '').trim())
      : rideOwnerId;
    if (!toUserId) {
      Alert.alert(
        'Select passenger',
        'Please select a passenger to rate for this completed ride.'
      );
      return;
    }

    // Targeted duplicate guard for owner flow:
    // check only the selected passenger to avoid backend 409/noisy network warnings.
    if (isOwner && toUserId) {
      try {
        const alreadyRatedSelected = await hasCurrentUserRatedRide(ratingRide.id, currentUserId, toUserId);
        if (alreadyRatedSelected) {
          setRatedTargetsByRide((prev) => {
            const existing = prev[ratingRide.id] ?? [];
            if (existing.includes(toUserId)) return prev;
            return { ...prev, [ratingRide.id]: [...existing, toUserId] };
          });
          const existingRated = new Set(ratedTargetsByRide[ratingRide.id] ?? []);
          existingRated.add(toUserId);
          if (existingRated.size >= ownerCandidatesCount) {
            closeRatingSheet();
            showToast({
              title: 'Already rated',
              message: 'All passengers for this ride are rated.',
              variant: 'info',
            });
            return;
          }
          showToast({
            title: 'Already rated',
            message: selectedRateTargetName
              ? `${selectedRateTargetName} is already rated for this ride.`
              : 'This passenger is already rated for this ride.',
            variant: 'info',
          });
          if (ownerCandidatesCount > 1) {
            setSelectedRateTargetUserId('');
            setSelectedRateTargetName('');
          } else {
            closeRatingSheet();
          }
          return;
        }
      } catch {
        // Non-blocking: continue and let submit endpoint enforce dedupe.
      }
    }

    setRatingSubmitting(true);
    try {
      await submitRideRating({
        rideId: ratingRide.id,
        toUserId,
        rating: ratingStars,
        review: ratingReview.trim() || undefined,
      });
      if (isOwner && toUserId) {
        setRatedTargetsByRide((prev) => {
          const existing = prev[ratingRide.id] ?? [];
          if (existing.includes(toUserId)) return prev;
          return { ...prev, [ratingRide.id]: [...existing, toUserId] };
        });
      }
      setRatedRideIds((prev) => {
        const next = new Set(prev);
        if (!isOwner) next.add(ratingRide.id);
        return next;
      });
      await markRatingPromptHandled(currentUserId, ratingRide.id);
      if (isOwner && ownerCandidatesCount > 1) {
        const existingRated = new Set(ratedTargetsByRide[ratingRide.id] ?? []);
        existingRated.add(toUserId);
        if (existingRated.size >= ownerCandidatesCount) {
          closeRatingSheet();
          showToast({
            title: 'Thanks for your feedback',
            message: 'All passengers for this ride are rated.',
            variant: 'success',
          });
          return;
        }
        setRatingStars(0);
        setRatingReview('');
        setSelectedRateTargetUserId('');
        setSelectedRateTargetName('');
        showToast({
          title: 'Thanks for your feedback',
          message: 'You can rate other passengers too.',
          variant: 'success',
        });
      } else {
        closeRatingSheet();
        showToast({
          title: 'Thanks for your feedback',
          variant: 'success',
        });
      }
    } catch (e: unknown) {
      const statusCode =
        e && typeof e === 'object' && 'statusCode' in e
          ? Number((e as { statusCode?: unknown }).statusCode)
          : undefined;
      const message =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : 'Could not submit rating right now.';
      if (statusCode === 409) {
        if (isOwner && toUserId) {
          setRatedTargetsByRide((prev) => {
            const existing = prev[ratingRide.id] ?? [];
            if (existing.includes(toUserId)) return prev;
            return { ...prev, [ratingRide.id]: [...existing, toUserId] };
          });
          const existingRated = new Set(ratedTargetsByRide[ratingRide.id] ?? []);
          existingRated.add(toUserId);
          if (existingRated.size >= ownerCandidatesCount) {
            closeRatingSheet();
            showToast({
              title: 'Already rated',
              message: 'All passengers for this ride are rated.',
              variant: 'info',
            });
            return;
          }
          setRatingStars(0);
          setRatingReview('');
          setSelectedRateTargetUserId('');
          setSelectedRateTargetName('');
        } else {
          setRatedRideIds((prev) => {
            const next = new Set(prev);
            next.add(ratingRide.id);
            return next;
          });
          closeRatingSheet();
        }
        showToast({ title: 'Already rated', message, variant: 'info' });
        return;
      }
      Alert.alert('Error', message);
    } finally {
      setRatingSubmitting(false);
    }
  }, [
    ratingRide,
    currentUserId,
    ratingSubmitting,
    ratingStars,
    ratingReview,
    closeRatingSheet,
    ratedTargetsByRide,
  ]);

  const handleRatingModalRequestClose = useCallback(() => {
    if (ratingKeyboardVisible) {
      Keyboard.dismiss();
      return;
    }
    void handleSkipRating();
  }, [ratingKeyboardVisible, handleSkipRating]);

  const ownerRateCandidates = useMemo(() => {
    if (!ratingRide || !currentUserId) return [];
    if (!isViewerRideOwner(ratingRide, currentUserId)) return [];
    return (ratingRide.bookings ?? []).filter(
      (b) => !bookingIsCancelled(b.status) && (b.userId ?? '').trim() && (b.userId ?? '').trim() !== currentUserId
    );
  }, [ratingRide, currentUserId]);
  const isOwnerRatingFlow = Boolean(
    ratingRide && currentUserId && isViewerRideOwner(ratingRide, currentUserId)
  );
  const ownerHasMultipleCandidates = isOwnerRatingFlow && ownerRateCandidates.length > 1;
  const showOwnerPickerOnly = ownerHasMultipleCandidates && !selectedRateTargetUserId;

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
              ratedRideIds={ratedRideIds}
              ratedTargetsByRide={ratedTargetsByRide}
              onNavigateDetail={goRideDetail}
              onRateRide={openRateSheet}
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
              ratedRideIds={ratedRideIds}
              ratedTargetsByRide={ratedTargetsByRide}
              onNavigateDetail={goRideDetail}
              onRateRide={openRateSheet}
            />
          )}
        />
      )}
      <Modal visible={showRatingSheet} transparent animationType="slide" onRequestClose={handleRatingModalRequestClose}>
        <View
          style={styles.ratingOverlay}
        >
          <Pressable style={styles.ratingOverlayPressable} onPress={() => void handleSkipRating()} />
          <Animated.View
            style={[
              styles.ratingSheet,
              { transform: [{ translateY: Animated.multiply(ratingKeyboardOffset, -1) }] },
            ]}
          >
            <View style={styles.ratingHandle} />
            <TouchableOpacity style={styles.ratingCloseBtn} onPress={() => void handleSkipRating()} hitSlop={8}>
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
            <Text style={styles.ratingTitle}>Rate your ride</Text>
            <Text style={styles.ratingSubtitle}>Tap a star to rate your experience</Text>

            {ownerRateCandidates.length > 1 ? (
              <View style={styles.rateTargetBlock}>
                <Text style={styles.rateTargetHeading}>Select passenger</Text>
                <View style={styles.rateTargetList}>
                  {ownerRateCandidates.map((p) => {
                    const uid = (p.userId ?? '').trim();
                    const name = (p.name ?? p.userName ?? 'Passenger').trim() || 'Passenger';
                    const selected = selectedRateTargetUserId === uid;
                    const isRated = Boolean(
                      ratingRide?.id && (ratedTargetsByRide[ratingRide.id] ?? []).includes(uid)
                    );
                    return (
                      <TouchableOpacity
                        key={`${ratingRide?.id}-${uid}`}
                        style={[
                          styles.rateTargetRow,
                          selected && !isRated && styles.rateTargetRowSelected,
                          isRated && styles.rateTargetRowRated,
                        ]}
                        onPress={() => {
                          if (isRated) return;
                          setSelectedRateTargetUserId(uid);
                          setSelectedRateTargetName(name);
                          // Reset inputs when changing target passenger.
                          setRatingStars(0);
                          setRatingReview('');
                        }}
                        disabled={isRated}
                        activeOpacity={isRated ? 1 : 0.75}
                      >
                        <View style={styles.rateTargetIcon}>
                          <Ionicons
                            name={isRated ? 'checkmark-circle' : 'person-outline'}
                            size={18}
                            color={isRated ? COLORS.success : selected ? COLORS.primary : COLORS.textSecondary}
                          />
                        </View>
                        <Text
                          style={[
                            styles.rateTargetName,
                            selected && styles.rateTargetNameSelected,
                            isRated && styles.rateTargetNameRated,
                          ]}
                          numberOfLines={1}
                        >
                          {name}
                        </Text>
                        {ownerRateCandidates.length > 1 ? (
                          <View style={styles.rateTargetActionWrap}>
                            <Text style={[styles.rateTargetActionText, isRated && styles.rateTargetActionRatedText]}>
                              {isRated ? 'Rated' : 'Rate'}
                            </Text>
                            <Ionicons
                              name={isRated ? 'checkmark' : 'chevron-forward'}
                              size={14}
                              color={isRated ? COLORS.success : COLORS.textMuted}
                            />
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : selectedRateTargetName ? (
              <View style={styles.rateTargetChosenPill}>
                <Text style={styles.rateTargetChosenText}>Rating: {selectedRateTargetName}</Text>
              </View>
            ) : null}

            {!showOwnerPickerOnly ? (
              <>
                <View style={styles.ratingStarsRow}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <TouchableOpacity key={s} onPress={() => setRatingStars(s)} disabled={ratingSubmitting} hitSlop={8}>
                      <Ionicons
                        name={ratingStars >= s ? 'star' : 'star-outline'}
                        size={34}
                    color={COLORS.warning}
                      />
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.ratingInputLabel}>Write your review (optional)</Text>
                <TextInput
                  style={styles.ratingInput}
                  placeholder="Tell us about the driver, the vehicle, or the route..."
                  placeholderTextColor={COLORS.textMuted}
                  value={ratingReview}
                  onChangeText={setRatingReview}
                  multiline
                  editable={!ratingSubmitting}
                />

                <TouchableOpacity
                  style={[
                    styles.ratingSubmitBtn,
                    (ratingStars < 1 || ratingSubmitting || (ownerRateCandidates.length > 0 && !selectedRateTargetUserId)) &&
                      styles.ratingSubmitBtnDisabled,
                  ]}
                  onPress={() => void handleSubmitRating()}
                  disabled={ratingStars < 1 || ratingSubmitting || (ownerRateCandidates.length > 0 && !selectedRateTargetUserId)}
                >
                  {ratingSubmitting ? (
                    <ActivityIndicator size="small" color={COLORS.white} />
                  ) : (
                    <Text style={styles.ratingSubmitText}>Submit Feedback</Text>
                  )}
                </TouchableOpacity>
                {ownerHasMultipleCandidates ? (
                  <TouchableOpacity
                    style={styles.ratingCancelBtn}
                    onPress={() => {
                      setSelectedRateTargetUserId('');
                      setSelectedRateTargetName('');
                      setRatingStars(0);
                      setRatingReview('');
                    }}
                  >
                    <Text style={styles.ratingCancelText}>Back to passengers</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.ratingCancelBtn} onPress={() => void handleSkipRating()}>
                    <Text style={styles.ratingCancelText}>Cancel</Text>
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <TouchableOpacity style={styles.ratingCancelBtn} onPress={() => void handleSkipRating()}>
                <Text style={styles.ratingCancelText}>Cancel</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        </View>
      </Modal>
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
  ratingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  ratingOverlayPressable: {
    flex: 1,
  },
  ratingSheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    maxHeight: '68%',
  },
  ratingHandle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  ratingCloseBtn: {
    position: 'absolute',
    right: 14,
    top: 12,
    zIndex: 2,
    padding: 4,
  },
  ratingTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginTop: 4,
  },
  ratingSubtitle: {
    marginTop: 3,
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  ratingStarsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginTop: 18,
    marginBottom: 14,
  },
  ratingInputLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  rateTargetBlock: {
    marginTop: 10,
    marginBottom: 8,
  },
  rateTargetHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  rateTargetList: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundSecondary,
    overflow: 'hidden',
  },
  rateTargetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    gap: 8,
  },
  rateTargetRowSelected: {
    backgroundColor: '#eef8f4',
  },
  rateTargetRowRated: {
    backgroundColor: '#f0fdf4',
  },
  rateTargetIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  rateTargetName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  rateTargetNameSelected: {
    color: COLORS.primary,
  },
  rateTargetNameRated: {
    color: COLORS.success,
  },
  rateTargetActionWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  rateTargetActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  rateTargetActionRatedText: {
    color: COLORS.success,
  },
  rateTargetChosenPill: {
    marginTop: 10,
    marginBottom: 8,
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#eef8f4',
  },
  rateTargetChosenText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  ratingInput: {
    minHeight: 100,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: 'top',
    color: COLORS.text,
    backgroundColor: COLORS.backgroundSecondary,
  },
  ratingSubmitBtn: {
    marginTop: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  ratingSubmitBtnDisabled: {
    backgroundColor: 'rgba(34,197,94,0.45)',
  },
  ratingSubmitText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
  ratingCancelBtn: {
    alignSelf: 'center',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  ratingCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
});
