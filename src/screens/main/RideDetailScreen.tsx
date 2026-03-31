import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  Platform,
  InteractionManager,
  useWindowDimensions,
  TextInput,
  KeyboardAvoidingView,
  Pressable,
} from 'react-native';
import { CommonActions, useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import DatePickerModal from '../../components/common/DatePickerModal';
import PassengersPickerModal from '../../components/common/PassengersPickerModal';
import { resetTabsToYourRidesAfterBook } from '../../navigation/navigateAfterBook';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { InboxStackParamList, RidesStackParamList, SearchStackParamList } from '../../navigation/types';
import { Ionicons } from '@expo/vector-icons';
import { authBackendUserIdRef, useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { fetchRideDetailRaw, invalidateRideDetailCache } from '../../services/rideDetailCache';
import { recordOwnerCancelledRide } from '../../services/ownerCancelledRidesStorage';
import { hasCurrentUserRatedRide, submitRideRating } from '../../services/ratings';
import { hasHandledRatingPrompt, markRatingPromptHandled } from '../../services/ratingPromptStorage';
import { mergeOwnerRatedPassenger, mergePassengerRatedRide } from '../../services/ratedRidesStorage';
import { API } from '../../constants/API';
import type { CreateBookingRequest, RideListItem } from '../../types/api';
import { COLORS } from '../../constants/colors';
import {
  getRideCardDateShort,
  formatRidePrice,
  getRidePickupTime,
  isRidePastArrivalWindow,
  isRideCancelledByOwner,
  getRideTotalBookingCount,
  isViewerOwnerStrict,
  isViewerRidePublisher,
} from '../../utils/rideDisplay';
import {
  bookingPickupDrop,
  bookingDiffersFromPublishedRide,
  viewerTripVersusPublishedDiffers,
} from '../../utils/bookingRoutePreview';
import {
  bookingIsCancelled,
  pickPreferredBookingForUser,
  pickPreferredBookingStatus,
} from '../../utils/bookingStatus';
import {
  getRideAvailableSeats,
  getRideAvailabilityShort,
  isRideSeatsFull,
} from '../../utils/rideSeats';
import { bookingPassengerDisplayName, ridePublisherDisplayName } from '../../utils/displayNames';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import LoginBottomSheet from '../../components/auth/LoginBottomSheet';
import UserAvatar from '../../components/common/UserAvatar';
import { mapRawToBookingRow } from '../../utils/bookingNormalize';
import { pickAvatarUrlFromRecord, pickPublisherAvatarUrl } from '../../utils/avatarUrl';
import { getPublisherRouteCoords } from '../../utils/ridePublisherCoords';

type RideDetailRouteProp =
  | RouteProp<RidesStackParamList, 'RideDetail'>
  | RouteProp<SearchStackParamList, 'RideDetail'>
  | RouteProp<InboxStackParamList, 'RideDetail'>;

type BookingItem = NonNullable<RideListItem['bookings']>[number];

function bookingTimelineMs(b: BookingItem): number {
  const ext = b as BookingItem & { updatedAt?: string; createdAt?: string };
  const raw = ext.bookedAt ?? ext.updatedAt ?? ext.createdAt ?? '';
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Prefer active confirmed booking; otherwise newest row (e.g. latest cancellation). */
function pickOwnerPrimaryBookingRow(sortedNewestFirst: BookingItem[]): BookingItem | null {
  if (!sortedNewestFirst.length) return null;
  const active = sortedNewestFirst.find((r) => {
    const s = String(r.status ?? '').trim().toLowerCase();
    const seats = typeof r.seats === 'number' && Number.isFinite(r.seats) ? Math.floor(r.seats) : 0;
    return s === 'confirmed' && seats > 0 && !bookingIsCancelled(r.status);
  });
  if (active) return active;
  return sortedNewestFirst[0];
}

function formatBookingHistoryLineWhen(iso: string): string {
  const t = iso.trim();
  if (!t) return '';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function bookingStatusShortLabel(statusRaw: string): string {
  const s = String(statusRaw ?? '').trim().toLowerCase();
  if (bookingIsCancelled(statusRaw)) return 'Cancelled';
  if (s === 'pending') return 'Pending';
  if (s === 'rejected') return 'Rejected';
  if (s === 'confirmed') return 'Confirmed';
  return s ? s : '—';
}

function rideDetailNumericField(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** True when ride payload still indicates people have booked seats (GET /rides/:id for guests often omits `bookings[]`). */
function rideDetailImpliesPassengersBooked(
  candidate: Record<string, unknown>,
  prevRide: RideListItem
): boolean {
  const bookedSeats =
    rideDetailNumericField(candidate.bookedSeats) ?? rideDetailNumericField(candidate.booked_seats);
  const totalBk =
    rideDetailNumericField(candidate.totalBookings) ?? rideDetailNumericField(candidate.total_bookings);
  const seatsTotal = rideDetailNumericField(candidate.seats) ?? prevRide.seats;
  const avail =
    rideDetailNumericField(candidate.availableSeats ?? candidate.seats_available ?? candidate.seatsAvailable) ??
    prevRide.availableSeats;
  const impliedOccupied =
    typeof seatsTotal === 'number' && typeof avail === 'number'
      ? Math.max(0, seatsTotal - avail)
      : undefined;
  return (
    (typeof bookedSeats === 'number' && bookedSeats > 0) ||
    (typeof totalBk === 'number' && totalBk > 0) ||
    (typeof impliedOccupied === 'number' && impliedOccupied > 0)
  );
}

/** In-session cache: last non-empty booking rows seen for a ride (e.g. after viewer logs out, guest GET strips `bookings`). */
const rideDetailGuestBookingsCache = new Map<string, BookingItem[]>();

function mergeGuestRideBookingsWhenApiOmitsList(args: {
  listFromApi: BookingItem[];
  viewerUserId: string;
  rideId: string;
  routeInitialBookings: BookingItem[] | undefined;
  prevPassengers: BookingItem[];
  prevRide: RideListItem;
  candidate: Record<string, unknown>;
}): BookingItem[] {
  const { listFromApi, viewerUserId, rideId, routeInitialBookings, prevPassengers, prevRide, candidate } =
    args;
  if (viewerUserId.trim() || listFromApi.length > 0) return listFromApi;

  if (Array.isArray(routeInitialBookings) && routeInitialBookings.length > 0) {
    return routeInitialBookings;
  }

  const impliesPassengers = rideDetailImpliesPassengersBooked(candidate, prevRide);
  if (impliesPassengers && prevPassengers.length > 0) {
    return prevPassengers;
  }
  if (impliesPassengers) {
    const cached = rideDetailGuestBookingsCache.get(rideId);
    if (cached && cached.length > 0) return cached;
  }
  return listFromApi;
}

export default function RideDetailScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const route = useRoute<RideDetailRouteProp>();
  const { height: windowHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const fullRideBlockAlertShownRef = useRef(false);
  const { user, isAuthenticated } = useAuth();
  /** Latest backend user id (Mongo) for post–guest-sheet book; Auth updates after POST /auth/firebase. */
  const authUserIdRef = useRef((user?.id ?? '').trim());
  authUserIdRef.current = (user?.id ?? '').trim();
  const { ride: initialRide, passengerSearch } = route.params;
  const activeDetailRideIdRef = useRef(initialRide.id);
  activeDetailRideIdRef.current = initialRide.id;
  const [ride, setRide] = useState<RideListItem>(initialRide);
  const [cancelling, setCancelling] = useState(false);
  const [cancellingBooking, setCancellingBooking] = useState(false);
  const [booking, setBooking] = useState(false);
  const [passengers, setPassengers] = useState<BookingItem[]>(initialRide.bookings ?? []);
  const passengersRef = useRef(passengers);
  const rideSnapshotRef = useRef(ride);
  passengersRef.current = passengers;
  rideSnapshotRef.current = ride;
  /** First GET /rides/:id for this screen has finished (success or failure). Gates alerts that need server truth. */
  const [detailFresh, setDetailFresh] = useState(false);
  const [showEditSheet, setShowEditSheet] = useState(false);
  const [editSheetExpanded, setEditSheetExpanded] = useState(false);
  const editHalfHeight = Math.max(430, Math.round(windowHeight * 0.68));
  const editFullHeight = Math.max(editHalfHeight, Math.round(windowHeight * 0.94));
  const editSheetSlideY = useRef(new Animated.Value(windowHeight)).current;
  const [editPickup, setEditPickup] = useState('');
  const [editDestination, setEditDestination] = useState('');
  const [editPassengers, setEditPassengers] = useState(1);
  const [editDate, setEditDate] = useState<Date | null>(null);
  const [editTimeHour, setEditTimeHour] = useState(9);
  const [editTimeMinute, setEditTimeMinute] = useState(0);
  const [showEditDateModal, setShowEditDateModal] = useState(false);
  const [showEditPassengersModal, setShowEditPassengersModal] = useState(false);
  const [showEditTimeModal, setShowEditTimeModal] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingReview, setRatingReview] = useState('');
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  /** Passenger booking: number of seats to request (capped by fresh getRideAvailableSeats). */
  const [bookSeatsCount, setBookSeatsCount] = useState(1);
  const [seatRequests, setSeatRequests] = useState<BookingItem[]>([]);
  const [seatRequestsLoading, setSeatRequestsLoading] = useState(false);
  const [seatRequestActionBookingId, setSeatRequestActionBookingId] = useState<string | null>(null);
  const [openingSeatRequestDetailId, setOpeningSeatRequestDetailId] = useState<string | null>(null);
  const autoRejectPendingInFlightRef = useRef(false);
  const ratingCheckKeyRef = useRef<string | null>(null);

  const [cancelBookingSheetVisible, setCancelBookingSheetVisible] = useState(false);
  const [cancelBookingBid, setCancelBookingBid] = useState<string | null>(null);
  const [cancelBookingMaxSeats, setCancelBookingMaxSeats] = useState(1);
  const [cancelBookingSeatsToCancel, setCancelBookingSeatsToCancel] = useState(1);
  const [cancelBookingSheetMode, setCancelBookingSheetMode] = useState<'booking' | 'request'>('booking');
  const [guestLoginSheetVisible, setGuestLoginSheetVisible] = useState(false);

  const currentUserId = (user?.id ?? '').trim();
  const currentUserName = (user?.name ?? '').trim();
  const myPassengerBooking = pickPreferredBookingForUser(passengers, currentUserId);
  const mergedBookingStatus = ride.myBookingStatus;
  const normalizedMergedBookingStatus = String(mergedBookingStatus ?? '').trim().toLowerCase();
  const hasMergedConfirmedBooking =
    mergedBookingStatus != null &&
    normalizedMergedBookingStatus !== '' &&
    !bookingIsCancelled(mergedBookingStatus) &&
    normalizedMergedBookingStatus !== 'pending' &&
    normalizedMergedBookingStatus !== 'rejected';
  const myBookingStatusNormalized = String(
    myPassengerBooking?.status ?? mergedBookingStatus ?? ''
  ).trim().toLowerCase();
  const isMyBookingPending = myBookingStatusNormalized === 'pending';
  const isMyBookingRejected = myBookingStatusNormalized === 'rejected';
  /** Include merged list status so we’re not “not booked” before detail bookings[] loads. Pending is handled separately. */
  const isBookedByMe = Boolean(
    (myPassengerBooking &&
      !bookingIsCancelled(myPassengerBooking.status) &&
      String(myPassengerBooking.status ?? '').trim().toLowerCase() !== 'pending' &&
      String(myPassengerBooking.status ?? '').trim().toLowerCase() !== 'rejected') ||
      hasMergedConfirmedBooking
  );
  const userHasPassengerBookingRow = passengers.some(
    (b) => (b.userId ?? '').trim() === currentUserId
  );
  /** Driver vs passenger for labels, chat, passenger list (may use id fallback when API omits `viewerIsOwner`). */
  const isOwner = isViewerRidePublisher(ride, currentUserId, {
    hasActivePassengerBooking: isBookedByMe,
    hasPassengerBookingRowForUser: userHasPassengerBookingRow,
  });
  /** Edit / Cancel ride — API flag only (isViewerOwnerStrict); never infer from userId. */
  const isOwnerStrict = isViewerOwnerStrict(ride);
  /** Re-book creates a second row; stale `ride.myBookingStatus` may still say cancelled — don't treat as cancelled if we're actively booked. */
  const isMyBookingCancelled =
    !isBookedByMe &&
    (bookingIsCancelled(ride.myBookingStatus) ||
      passengers.some(
        (b) =>
          (b.userId ?? '').trim() === currentUserId && bookingIsCancelled(b.status)
      ));
  const rideIsCompleted = String(ride.status ?? '').trim().toLowerCase() === 'completed';
  const isPastRide = rideIsCompleted || isRidePastArrivalWindow(ride);
  /** Cancelled rides may still be “upcoming” by time — hide edit/cancel anyway. */
  const isOwnerRideCancelled = isOwnerStrict && isRideCancelledByOwner(ride);
  const bookingModeSource = ride as RideListItem & {
    bookingMode?: string;
    booking_mode?: string;
    instantBooking?: boolean;
    instant_booking?: boolean;
  };
  const bookingModeRaw = String(
    bookingModeSource.bookingMode ??
      bookingModeSource.booking_mode ??
      (
        bookingModeSource.instantBooking === false || bookingModeSource.instant_booking === false
          ? 'request'
          : 'instant'
      )
  ).trim().toLowerCase();
  const isRequestBookingMode = bookingModeRaw === 'request';
  const isOwnerRef = useRef(isOwner);
  const isRequestBookingModeRef = useRef(isRequestBookingMode);
  isOwnerRef.current = isOwner;
  isRequestBookingModeRef.current = isRequestBookingMode;
  /** Whole ride pulled by driver — passenger UI must not imply *they* cancelled or offer re-book. */
  const rideCancelledByOwner = isRideCancelledByOwner(ride);
  const passengerSelfCancelledBooking = isMyBookingCancelled && !rideCancelledByOwner;

  const pendingSeatRequests = seatRequests.filter(
    (b) => String(b.status ?? '').trim().toLowerCase() === 'pending'
  );
  const activePassengers = passengers.filter((b) => !bookingIsCancelled(b.status));
  const confirmedPassengers = passengers.filter((b) => {
    const s = String(b.status ?? '').trim().toLowerCase();
    return !bookingIsCancelled(s) && s !== 'pending' && s !== 'rejected';
  });
  const activePassengerUserIds = new Set(
    activePassengers.map((p) => (p.userId ?? '').trim()).filter(Boolean)
  );
  const cancelledPassengerUserIds = new Set(
    passengers
      .filter((p) => bookingIsCancelled(p.status))
      .map((p) => (p.userId ?? '').trim())
      .filter(Boolean)
  );
  /** Display list: one entry per passenger user when userId is present (prevents cancel+rebook duplicate rows). */
  const passengersForDisplay: BookingItem[] = (() => {
    const byUser = new Map<string, BookingItem>();
    const out: BookingItem[] = [];
    for (const p of passengers) {
      const uid = (p.userId ?? '').trim();
      if (!uid) {
        out.push(p);
        continue;
      }
      const prev = byUser.get(uid);
      if (!prev) {
        byUser.set(uid, p);
        continue;
      }
      const prevCancelled = bookingIsCancelled(prev.status);
      const nextCancelled = bookingIsCancelled(p.status);
      // Prefer active booking row over cancelled for the same passenger.
      if (prevCancelled && !nextCancelled) byUser.set(uid, p);
    }
    return [...out, ...byUser.values()];
  })();
  const passengersForDisplayFiltered = passengersForDisplay.filter((p) => {
    const status = String(p.status ?? '').trim().toLowerCase();
    const seats = typeof p.seats === 'number' && Number.isFinite(p.seats) ? Math.floor(p.seats) : 0;
    if (isOwner) {
      // Owner list should reflect actually booked passengers only.
      return status === 'confirmed' && seats > 0;
    }
    // Passenger/co-passenger list hides request/rejected rows.
    return status !== 'pending' && status !== 'rejected';
  });

  /** Owner: all booking rows per passenger (re-book / cancel cycles) for primary row + chronological history. */
  const ownerPassengerSummaries = useMemo(() => {
    if (!isOwner) return [];
    const byUser = new Map<string, BookingItem[]>();
    const noUserId: BookingItem[] = [];
    for (const p of passengers) {
      const uid = (p.userId ?? '').trim();
      if (!uid) {
        noUserId.push(p);
        continue;
      }
      const list = byUser.get(uid) ?? [];
      list.push(p);
      byUser.set(uid, list);
    }
    const summaries: Array<{
      userId: string;
      primary: BookingItem;
      historyChronological: BookingItem[];
    }> = [];
    for (const [uid, list] of byUser) {
      const newestFirst = [...list].sort((a, b) => bookingTimelineMs(b) - bookingTimelineMs(a));
      const primary = pickOwnerPrimaryBookingRow(newestFirst);
      if (!primary) continue;
      const historyChronological = [...list].sort((a, b) => bookingTimelineMs(a) - bookingTimelineMs(b));
      summaries.push({ userId: uid, primary, historyChronological });
    }
    for (const orphan of noUserId) {
      summaries.push({
        userId: '',
        primary: orphan,
        historyChronological: [orphan],
      });
    }
    summaries.sort((a, b) =>
      bookingPassengerDisplayName(a.primary).localeCompare(bookingPassengerDisplayName(b.primary))
    );
    return summaries;
  }, [isOwner, passengers]);

  const totalBookingsCount = getRideTotalBookingCount(ride);
  const availableSeatsCount = getRideAvailableSeats(ride);

  const publishedPickupStr = ride.pickupLocationName ?? ride.from ?? 'Pickup';
  const publishedDestStr = ride.destinationLocationName ?? ride.to ?? 'Destination';
  const publisherCoords = useMemo(() => getPublisherRouteCoords(ride), [
    ride.pickupLatitude,
    ride.pickupLongitude,
    ride.destinationLatitude,
    ride.destinationLongitude,
  ]);

  const searchFrom = passengerSearch?.from?.trim() ?? '';
  const searchTo = passengerSearch?.to?.trim() ?? '';
  const bookPu = myPassengerBooking?.pickupLocationName?.trim() ?? '';
  const bookDe = myPassengerBooking?.destinationLocationName?.trim() ?? '';

  /** Non-owner: trip they searched or saved on the booking (may match published ride). */
  const viewerPickupStr = !isOwner
    ? searchFrom || bookPu || publishedPickupStr
    : '';
  const viewerDestStr = !isOwner
    ? searchTo || bookDe || publishedDestStr
    : '';

  /** Only use saved booking stops for route compare when booking is active (not cancelled). */
  const showDualRouteForViewer =
    !isOwner &&
    (isBookedByMe && myPassengerBooking
      ? bookingDiffersFromPublishedRide(ride, myPassengerBooking)
      : viewerTripVersusPublishedDiffers(ride, searchFrom, searchTo));

  /** Single-column route when published-only or viewer trip matches published. */
  const pickupLabel = isOwner ? publishedPickupStr : viewerPickupStr;
  const destinationLabel = isOwner ? publishedDestStr : viewerDestStr;
  const cardDateShort = getRideCardDateShort(ride);
  const pickupTime = getRidePickupTime(ride);
  const driverName = ridePublisherDisplayName(ride);
  const vehicleSubtitle = [ride.vehicleModel, ride.licensePlate ?? ride.vehicleNumber]
    .filter((s) => typeof s === 'string' && s.trim())
    .join(' • ');
  const totalSeats = ride.seats ?? 0;
  const bookedSeats = confirmedPassengers.reduce((sum, b) => sum + (b.seats ?? 0), 0);
  // Passenger UI should show "X seats booked" (not just "seats left").
  // Active only (exclude cancelled bookings) and sum seat counts for the current viewer.
  const viewerBookedSeats = passengers.reduce((sum, b) => {
    const uid = (b.userId ?? '').trim();
    if (!uid || uid !== currentUserId) return sum;
    if (bookingIsCancelled(b.status)) return sum;
    const status = String(b.status ?? '').trim().toLowerCase();
    if (status === 'pending' || status === 'rejected') return sum;
    const rawSeats = typeof b.seats === 'number' && !Number.isNaN(b.seats) ? b.seats : 0;
    const seats = rawSeats > 0 ? Math.max(1, Math.floor(rawSeats)) : 0;
    return sum + seats;
  }, 0);
  /** Owner: no booker names on main card — show your ride + capacity / vehicle. */
  const cardPersonName = isOwner ? 'Your ride' : driverName;
  const cardPersonSubtitle = isOwner
    ? (() => {
        const parts: string[] = [];
        if (activePassengers.length > 0) {
          parts.push(`${bookedSeats} seat${bookedSeats !== 1 ? 's' : ''} booked`);
        } else if (totalBookingsCount > 0) {
          parts.push(
            `Cancelled · ${totalBookingsCount} passenger${totalBookingsCount !== 1 ? 's' : ''}`
          );
        } else {
          parts.push(`${totalSeats} seat${totalSeats !== 1 ? 's' : ''} offered`);
        }
        if (vehicleSubtitle) parts.push(vehicleSubtitle);
        return parts.join(' · ') || 'Share your ride to get passengers';
      })()
    : vehicleSubtitle;
  const cardAvatarUri = (
    isOwner ? (user?.avatarUrl ?? '').trim() : (ride.publisherAvatarUrl ?? '').trim()
  ) || undefined;
  const cardAvatarName = isOwner
    ? (currentUserName || user?.name || 'You').trim() || 'You'
    : driverName;
  const ownerUserIdForChat = (ride.userId ?? '').trim();
  /** Signed-in non-owners can message the driver from ride detail; booking is not required. */
  const passengerCanMessageOwner =
    isAuthenticated &&
    !isOwner &&
    Boolean(ownerUserIdForChat) &&
    Boolean(currentUserId);
  const openChatWithOwner = useCallback(() => {
    const oid = (ride.userId ?? '').trim();
    if (!oid) return;
    (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate('Chat', {
      ride,
      otherUserName: driverName,
      otherUserId: oid,
      ...(ride.publisherAvatarUrl?.trim()
        ? { otherUserAvatarUrl: ride.publisherAvatarUrl.trim() }
        : {}),
    });
  }, [navigation, ride, driverName]);
  const priceDisplay = formatRidePrice(ride);
  const normalizeRequestBookingItem = useCallback((raw: unknown): BookingItem | null => {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const id = String(row.id ?? row._id ?? '').trim();
    if (!id) return null;
    const userObj = row.user && typeof row.user === 'object' ? (row.user as Record<string, unknown>) : null;
    const userId = String(row.userId ?? row.user_id ?? userObj?._id ?? userObj?.id ?? '').trim();
    const seatsRaw = row.seats;
    const seats =
      typeof seatsRaw === 'number'
        ? seatsRaw
        : typeof seatsRaw === 'string' && seatsRaw.trim() !== ''
          ? Number(seatsRaw)
          : 1;
    const status = String(row.status ?? 'pending').trim().toLowerCase() || 'pending';
    const bookedAt = String(row.createdAt ?? row.bookedAt ?? row.updatedAt ?? new Date().toISOString());
    const avatarUrl =
      pickAvatarUrlFromRecord(row) ?? (userObj ? pickAvatarUrlFromRecord(userObj) : undefined);
    return {
      id,
      userId,
      name: String(row.name ?? row.userName ?? row.username ?? userObj?.name ?? '').trim() || undefined,
      userName: String(row.userName ?? row.username ?? userObj?.username ?? '').trim() || undefined,
      seats: Number.isFinite(seats) ? Math.max(1, Math.floor(seats)) : 1,
      status,
      bookedAt,
      pickupLocationName: String(row.pickupLocationName ?? row.pickup ?? '').trim() || undefined,
      destinationLocationName:
        String(row.destinationLocationName ?? row.dropoff ?? row.destination ?? '').trim() || undefined,
      ...(avatarUrl ? { avatarUrl } : {}),
    };
  }, []);

  const parseSeatPriceNumber = (r: RideListItem): number | null => {
    // Keep in sync with `formatRidePrice` raw selection.
    const anyRide = r as RideListItem & {
      fare?: unknown;
      amount?: unknown;
      pricePerSeat?: unknown;
      price_per_seat?: unknown;
      farePerSeat?: unknown;
      fare_per_seat?: unknown;
    };
    const raw =
      r.price ??
      (anyRide.fare as string | number | undefined) ??
      (anyRide.amount as string | number | undefined) ??
      (anyRide.pricePerSeat as string | number | undefined) ??
      (anyRide.price_per_seat as string | number | undefined) ??
      (anyRide.farePerSeat as string | number | undefined) ??
      (anyRide.fare_per_seat as string | number | undefined);
    if (raw == null || String(raw).trim() === '') return null;
    const cleaned = String(raw).replace(/[₹$,]/g, '').trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  const formatRupees = (n: number): string => {
    const pretty = Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
    return `₹${pretty}`;
  };

  // Payment box should show total amount based on seats booked by the viewer.
  // - Passenger: use only their active booking seats
  // - Owner: use total booked seats for the ride
  const pricingSeats =
    myPassengerBooking && !bookingIsCancelled(myPassengerBooking.status)
        ? myPassengerBooking.seats ?? 0
        : 0;
  const seatPriceNumber = parseSeatPriceNumber(ride);
  const totalBookedPriceText =
    !isOwner && seatPriceNumber != null && pricingSeats > 0
      ? formatRupees(seatPriceNumber * pricingSeats)
      : null;
  const rideDetailRatingPromptEnabled = false;
  const ratingTargetUserId = (() => {
    if (!currentUserId) return '';
    if (isOwner) {
      const firstOther = passengers.find((b) => (b.userId ?? '').trim() && (b.userId ?? '').trim() !== currentUserId);
      return (firstOther?.userId ?? '').trim();
    }
    return (ride.userId ?? '').trim();
  })();

  const fetchRideDetail = useCallback(async (opts?: { force?: boolean }): Promise<RideListItem | null> => {
    const forRideId = initialRide.id;
    let nextRideSnapshot: RideListItem | null = null;
    try {
      const res = await fetchRideDetailRaw(forRideId, {
        ...opts,
        viewerUserId: currentUserId,
      });
      if (res && typeof res === 'object') {
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
        const listFromApi: BookingItem[] = Array.isArray(candidate.bookings)
          ? (candidate.bookings as unknown[])
              .map((b) => {
                if (!b || typeof b !== 'object') return null;
                const row = mapRawToBookingRow(b as Record<string, unknown>);
                return row as BookingItem | null;
              })
              .filter((x): x is BookingItem => x != null)
          : [];
        const list = mergeGuestRideBookingsWhenApiOmitsList({
          listFromApi,
          viewerUserId: currentUserId,
          rideId: forRideId,
          routeInitialBookings: initialRide.bookings,
          prevPassengers: passengersRef.current,
          prevRide: rideSnapshotRef.current,
          candidate: candidate as Record<string, unknown>,
        });
        if (list.length > 0) {
          rideDetailGuestBookingsCache.set(forRideId, list);
        }
        const rawRes = candidate as RideListItem & Record<string, unknown>;
        const pricing = (rawRes.pricing && typeof rawRes.pricing === 'object')
          ? (rawRes.pricing as Record<string, unknown>)
          : undefined;
        const mergedPrice =
          (rawRes.price as string | number | undefined) ??
          (rawRes.fare as string | number | undefined) ??
          (rawRes.amount as string | number | undefined) ??
          (rawRes.pricePerSeat as string | number | undefined) ??
          (rawRes.price_per_seat as string | number | undefined) ??
          (rawRes.farePerSeat as string | number | undefined) ??
          (rawRes.fare_per_seat as string | number | undefined) ??
          (pricing?.price as string | number | undefined) ??
          (pricing?.fare as string | number | undefined);
        setPassengers(list);
        setRide((prev) => {
          const candidateModeRaw = String(
            candidate.bookingMode ??
              candidate.booking_mode ??
              (
                candidate.instantBooking === false || candidate.instant_booking === false
                  ? 'request'
                  : 'instant'
              )
          )
            .trim()
            .toLowerCase();
          const pubAvatar = pickPublisherAvatarUrl(candidate as Record<string, unknown>);
          const next = {
            ...prev,
            ...candidate,
            bookingMode: candidateModeRaw === 'request' ? 'request' : 'instant',
            instantBooking: candidateModeRaw !== 'request',
            ...(mergedPrice != null && String(mergedPrice).trim() !== ''
              ? { price: String(mergedPrice) }
              : {}),
            bookings: list,
            ...(pubAvatar ? { publisherAvatarUrl: pubAvatar } : {}),
          } as RideListItem;
          const mine = list.filter((b) => (b.userId ?? '').trim() === currentUserId);
          if (mine.length > 0) {
            next.myBookingStatus = pickPreferredBookingStatus(mine.map((b) => b.status ?? ''));
          } else {
            // Avoid carrying stale local state if the server doesn't include this viewer's booking rows.
            // We only trust server-provided `myBookingStatus` when present; otherwise clear it.
            const mergedStatus = (candidate as RideListItem).myBookingStatus;
            if (mergedStatus !== undefined) {
              next.myBookingStatus = mergedStatus;
            } else if (String(prev.myBookingStatus ?? '').trim().toLowerCase() === 'pending') {
              // Keep local pending state when backend detail temporarily omits my_booking_status.
              next.myBookingStatus = 'pending';
            } else {
              next.myBookingStatus = '';
            }
          }
          if (isRideCancelledByOwner(prev) && !isRideCancelledByOwner(next)) {
            next.status = prev.status ?? 'cancelled';
          }
          const tbRaw = candidate.totalBookings ?? candidate.total_bookings;
          const tb =
            typeof tbRaw === 'number' && !Number.isNaN(tbRaw)
              ? Math.max(0, Math.floor(tbRaw))
              : undefined;
          if (tb !== undefined) {
            next.totalBookings = tb;
          } else if (list.length > 0) {
            next.totalBookings = list.length;
          } else if (prev.totalBookings != null) {
            next.totalBookings = prev.totalBookings;
          }
          const avRaw = candidate.availableSeats ?? candidate.seats_available ?? candidate.seatsAvailable;
          const avMerged =
            typeof avRaw === 'number' && !Number.isNaN(avRaw)
              ? Math.max(0, Math.floor(avRaw))
              : undefined;
          if (avMerged !== undefined) {
            next.availableSeats = avMerged;
          }
          const viRaw = candidate.viewerIsOwner ?? candidate.viewer_is_owner;
          if (typeof viRaw === 'boolean') next.viewerIsOwner = viRaw;
          else if (viRaw === 'true') next.viewerIsOwner = true;
          else if (viRaw === 'false') next.viewerIsOwner = false;
          const candRec = candidate as Record<string, unknown>;
          const numFrom = (v: unknown): number | undefined => {
            if (typeof v === 'number' && Number.isFinite(v)) return v;
            if (typeof v === 'string' && v.trim() !== '') {
              const n = Number(v);
              return Number.isFinite(n) ? n : undefined;
            }
            return undefined;
          };
          const pubAvg =
            numFrom(candRec.publisherAvgRating) ??
            numFrom(candRec.publisher_avg_rating) ??
            numFrom(candRec.driverAvgRating) ??
            numFrom(candRec.driver_avg_rating);
          const pubCount =
            numFrom(candRec.publisherRatingCount) ??
            numFrom(candRec.publisher_rating_count) ??
            numFrom(candRec.publisherTotalRatings) ??
            numFrom(candRec.publisher_total_ratings) ??
            numFrom(candRec.driverRatingCount) ??
            numFrom(candRec.driver_rating_count);
          if (pubAvg != null && pubAvg >= 0 && pubAvg <= 5) {
            next.publisherAvgRating = Number(pubAvg.toFixed(1));
          }
          if (pubCount != null && pubCount >= 0) {
            next.publisherRatingCount = Math.max(0, Math.floor(pubCount));
          }
          nextRideSnapshot = next;
          return next;
        });
      }
    } catch {
      // keep list params; UI may be slightly stale
      return null;
    } finally {
      if (activeDetailRideIdRef.current === forRideId) {
        setDetailFresh(true);
      }
    }
    return nextRideSnapshot;
  }, [initialRide, currentUserId]);

  const openPublishedRouteMap = useCallback(() => {
    const c = getPublisherRouteCoords(ride);
    if (!c) return;
    (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate(
      'PublishedRideRouteMap',
      {
        pickupLabel: publishedPickupStr,
        destinationLabel: publishedDestStr,
        pickupLatitude: c.pickupLatitude,
        pickupLongitude: c.pickupLongitude,
        destinationLatitude: c.destinationLatitude,
        destinationLongitude: c.destinationLongitude,
      }
    );
  }, [navigation, ride, publishedPickupStr, publishedDestStr]);

  const fetchSeatRequests = useCallback(async () => {
    if (!isOwner || !isRequestBookingMode) {
      setSeatRequests([]);
      return;
    }
    setSeatRequestsLoading(true);
    try {
      const response = await api.get(API.endpoints.rides.bookingRequests(ride.id));
      const payload = response?.data ?? response;
      const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      const listRaw =
        (Array.isArray(root.requests) ? root.requests : null) ??
        (Array.isArray(root.bookings) ? root.bookings : null) ??
        (Array.isArray(root.data) ? root.data : null) ??
        [];
      const list = listRaw
        .map((item) => normalizeRequestBookingItem(item))
        .filter((item): item is BookingItem => Boolean(item))
        .sort((a, b) => {
          const at = new Date(a.bookedAt).getTime();
          const bt = new Date(b.bookedAt).getTime();
          const aValid = Number.isFinite(at) && !Number.isNaN(at);
          const bValid = Number.isFinite(bt) && !Number.isNaN(bt);
          if (aValid && bValid) return at - bt; // Oldest first
          if (aValid) return -1;
          if (bValid) return 1;
          return String(a.id).localeCompare(String(b.id));
        });
      setSeatRequests(list);
    } catch {
      setSeatRequests([]);
    } finally {
      setSeatRequestsLoading(false);
    }
  }, [isOwner, isRequestBookingMode, ride.id, normalizeRequestBookingItem]);

  const rejectAllPendingSeatRequests = useCallback(async (rideId: string) => {
    try {
      const response = await api.get(API.endpoints.rides.bookingRequests(rideId));
      const payload = response?.data ?? response;
      const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      const listRaw =
        (Array.isArray(root.requests) ? root.requests : null) ??
        (Array.isArray(root.bookings) ? root.bookings : null) ??
        (Array.isArray(root.data) ? root.data : null) ??
        [];
      const pendingList = listRaw
        .map((item) => normalizeRequestBookingItem(item))
        .filter((item): item is BookingItem => Boolean(item))
        .filter((item) => String(item.status ?? '').trim().toLowerCase() === 'pending');
      if (pendingList.length > 0) {
        await Promise.allSettled(
          pendingList.map((row) => api.patch(API.endpoints.bookings.reject(row.id)))
        );
      }
    } catch {
      // Best-effort cleanup; view refresh handles final truth from backend.
    }
  }, [normalizeRequestBookingItem]);

  const handleSeatRequestAction = useCallback(
    async (bookingId: string, action: 'approve' | 'reject') => {
      if (!bookingId) return;
      setSeatRequestActionBookingId(bookingId);
      try {
        if (action === 'approve') {
          await api.patch(API.endpoints.bookings.approve(bookingId));
        } else {
          await api.patch(API.endpoints.bookings.reject(bookingId));
        }
        const updatedRide = await fetchRideDetail({ force: true });
        if (action === 'approve' && updatedRide && getRideAvailableSeats(updatedRide) <= 0) {
          await rejectAllPendingSeatRequests(updatedRide.id);
        }
        await fetchRideDetail({ force: true });
        await fetchSeatRequests();
      } catch (e: unknown) {
        const message =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: unknown }).message)
            : action === 'approve'
              ? 'Could not approve request.'
              : 'Could not reject request.';
        Alert.alert('Error', message);
      } finally {
        setSeatRequestActionBookingId(null);
      }
    },
    [fetchRideDetail, fetchSeatRequests, rejectAllPendingSeatRequests]
  );

  const openSeatRequestDetail = useCallback(
    (bookingItem: BookingItem) => {
      const bid = String(bookingItem.id ?? '').trim();
      if (!bid) return;
      setOpeningSeatRequestDetailId(bid);
      InteractionManager.runAfterInteractions(() => {
        setTimeout(() => {
          try {
            (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate(
              'BookPassengerDetail',
              { ride, booking: bookingItem, requestMode: true }
            );
          } finally {
            setOpeningSeatRequestDetailId(null);
          }
        }, 120);
      });
    },
    [navigation, ride]
  );

  const openCoPassengerRatings = useCallback(
    (b: BookingItem, displayName: string, avatarForModal?: string) => {
      const uid = (b.userId ?? '').trim();
      if (!uid) return;
      const parentNav = (navigation as { getParent?: () => { setOptions?: (o: { tabBarStyle?: unknown }) => void } })
        .getParent?.();
      parentNav?.setOptions?.({ tabBarStyle: { display: 'none' } });
      (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate('OwnerRatingsModal', {
        userId: uid,
        displayName: displayName.trim() || 'Passenger',
        ...(avatarForModal?.trim() ? { avatarUrl: avatarForModal.trim() } : {}),
      });
    },
    [navigation]
  );

  useEffect(() => {
    if (!isOwner || !isRequestBookingMode) {
      setSeatRequests([]);
      return;
    }
    void fetchSeatRequests();
  }, [isOwner, isRequestBookingMode, fetchSeatRequests]);

  useEffect(() => {
    if (!isOwner || !isRequestBookingMode) return;
    if (availableSeatsCount > 0) return;
    if (autoRejectPendingInFlightRef.current) return;
    autoRejectPendingInFlightRef.current = true;
    void (async () => {
      await rejectAllPendingSeatRequests(ride.id);
      await fetchSeatRequests();
      autoRejectPendingInFlightRef.current = false;
    })();
  }, [isOwner, isRequestBookingMode, availableSeatsCount, ride.id, rejectAllPendingSeatRequests, fetchSeatRequests]);

  // Ensure edited values are shown immediately after returning from EditRide.
  useFocusEffect(
    useCallback(() => {
      // Hide bottom tabs while this screen is focused.
      const parentNav = (navigation as any)?.getParent?.();
      parentNav?.setOptions?.({ tabBarStyle: { display: 'none' } });

      void fetchRideDetail({ force: true });
      if (isOwnerRef.current && isRequestBookingModeRef.current) {
        void fetchSeatRequests();
      }
      return () => {
        // Avoid "tab bar flash" during fast transitions (e.g. RideDetail -> OwnerProfileModal).
        // Only restore tab bar after a short delay and only when the next focused nested screen
        // is NOT one of our full-screen/hidden routes.
        setTimeout(() => {
          try {
            const tabState = parentNav?.getState?.();
            const activeTabRoute = tabState?.routes?.[tabState?.index ?? 0];
            const nestedState = activeTabRoute?.state;
            const nestedName = nestedState?.routes?.[nestedState?.index ?? 0]?.name;

            const hiddenNestedNames = new Set([
              'RideDetail',
              'RideDetailScreen',
              'BookPassengerDetail',
              'Chat',
              'OwnerProfileModal',
              'OwnerRatingsModal',
              'ProfileHome',
              'ProfileEntry',
              'Ratings',
              'RatingsScreen',
            ]);

            if (!nestedName || !hiddenNestedNames.has(nestedName)) {
              parentNav?.setOptions?.({ tabBarStyle: undefined });
            }
          } catch {
            // If we can't inspect navigation state, keep the last known option.
          }
        }, 180);
      };
    }, [fetchRideDetail, fetchSeatRequests, navigation])
  );

  useEffect(() => {
    setBookSeatsCount(1);
    setShowRatingModal(false);
    setRatingStars(0);
    setRatingReview('');
    setRatingSubmitting(false);
    setRatingSubmitted(false);
    ratingCheckKeyRef.current = null;
  }, [ride.id]);

  /** Keep seat picker within fresh availability whenever server counts change (never trust stale values). */
  useEffect(() => {
    const a = getRideAvailableSeats(ride);
    setBookSeatsCount((prev) => {
      if (a <= 0) return prev;
      return Math.min(Math.max(1, prev), a);
    });
  }, [ride.bookedSeats, ride.seats, ride.availableSeats, ride.bookings]);

  useEffect(() => {
    fullRideBlockAlertShownRef.current = false;
    setDetailFresh(false);
  }, [initialRide.id]);

  useEffect(() => {
    if (!rideDetailRatingPromptEnabled) return;
    if (!detailFresh) return;
    if (!rideIsCompleted) return;
    if (!currentUserId) return;
    if (!ratingTargetUserId) return;

    const key = `${ride.id}:${currentUserId}:${ratingTargetUserId}`;
    if (ratingCheckKeyRef.current === key) return;
    ratingCheckKeyRef.current = key;

    let cancelled = false;
    void (async () => {
      const handled = await hasHandledRatingPrompt(currentUserId, ride.id);
      if (cancelled || handled) return;
      try {
        const alreadyRated = await hasCurrentUserRatedRide(
          ride.id,
          currentUserId,
          (ratingTargetUserId ?? '').trim() || undefined
        );
        if (cancelled) return;
        if (alreadyRated) {
          await markRatingPromptHandled(currentUserId, ride.id);
          return;
        }
        setShowRatingModal(true);
      } catch {
        // Non-blocking fallback: still allow prompt once; backend duplicate guard prevents resubmission.
        if (!cancelled) setShowRatingModal(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [detailFresh, rideIsCompleted, ride.id, currentUserId, ratingTargetUserId, rideDetailRatingPromptEnabled]);

  /** Non-owners cannot view full rides unless they already have a booking (e.g. deep link). */
  useEffect(() => {
    if (!detailFresh) return;
    if (isOwner) return;
    if (!isRideSeatsFull(ride)) return;
    if (isBookedByMe) return;
    if (fullRideBlockAlertShownRef.current) return;
    fullRideBlockAlertShownRef.current = true;
    Alert.alert(
      'Ride full',
      'This ride has no available seats. Details are only available if you already have a booking.',
      [{ text: 'OK', onPress: () => navigation.goBack() }]
    );
  }, [detailFresh, ride, isBookedByMe, isOwner, navigation]);

  const handleEdit = () => {
    if (!isOwnerStrict) {
      Alert.alert('Not allowed', 'Only the driver can edit this ride.');
      return;
    }
    (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate('EditRide', {
      ride,
    });
  };

  const expandEditSheet = () => {
    setEditSheetExpanded(true);
  };

  const closeEditSheet = () => {
    Animated.timing(editSheetSlideY, {
      toValue: windowHeight,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      setShowEditSheet(false);
      setEditSheetExpanded(false);
    });
  };

  useEffect(() => {
    const p = route.params as RidesStackParamList['RideDetail'] & {
      selectedFrom?: string;
      selectedTo?: string;
    };
    if (!p) return;
    let touched = false;
    if (typeof p.selectedFrom === 'string') {
      setEditPickup(p.selectedFrom);
      touched = true;
    }
    if (typeof p.selectedTo === 'string') {
      setEditDestination(p.selectedTo);
      touched = true;
    }
    if (!touched) return;
    (navigation as { setParams: (params: Record<string, unknown>) => void }).setParams({
      selectedFrom: undefined,
      selectedTo: undefined,
    });
  }, [route.params, navigation]);

  const handleBook = async (opts?: { sessionUserId?: string; stayOnRideDetail?: boolean }) => {
    if (rideCancelledByOwner) {
      Alert.alert('Ride cancelled', 'This ride was cancelled by the driver.');
      return;
    }
    if (isPastRide) {
      Alert.alert('Ride ended', 'This ride is in the past and can no longer be booked.');
      return;
    }
    const cap = getRideAvailableSeats(ride);
    if (cap <= 0) {
      Alert.alert('Full', 'This ride has no available seats.');
      return;
    }
    const seatsToBook = Math.min(Math.max(1, bookSeatsCount), cap);
    /** Prefer Mongo `user.id` from context (API); fall back to sheet callback after auth exchange. */
    const uid = ((user?.id ?? '').trim() || (opts?.sessionUserId ?? '').trim()).trim();
    if (!uid) {
      setGuestLoginSheetVisible(true);
      return;
    }
    const afterGuestSheetLogin = Boolean(opts?.sessionUserId?.trim());
    const stayOnRideDetailAfterBook = Boolean(opts?.stayOnRideDetail);
    setBooking(true);
    try {
      const body: CreateBookingRequest = {
        rideId: ride.id,
        seats: seatsToBook,
        ...(passengerSearch?.from?.trim() && passengerSearch?.to?.trim()
          ? {
              pickupLocationName: passengerSearch.from.trim(),
              destinationLocationName: passengerSearch.to.trim(),
              ...(passengerSearch.fromLatitude != null &&
              passengerSearch.fromLongitude != null
                ? {
                    pickupLatitude: passengerSearch.fromLatitude,
                    pickupLongitude: passengerSearch.fromLongitude,
                  }
                : {}),
              ...(passengerSearch.toLatitude != null && passengerSearch.toLongitude != null
                ? {
                    destinationLatitude: passengerSearch.toLatitude,
                    destinationLongitude: passengerSearch.toLongitude,
                  }
                : {}),
            }
          : {}),
      };
      await api.post(API.endpoints.bookings.create, body);
      invalidateRideDetailCache(initialRide.id);
      if (isRequestBookingMode) {
        setRide((prev) => ({ ...prev, myBookingStatus: 'pending' }));
        await fetchRideDetail({ force: true });
        Alert.alert('Request sent', 'Your booking request is pending driver approval.');
      } else if (afterGuestSheetLogin && stayOnRideDetailAfterBook) {
        await fetchRideDetail({ force: true });
        Alert.alert('Booked', 'Your seat(s) are confirmed on this ride.', [
          {
            text: 'OK',
            onPress: () => {
              void (async () => {
                await new Promise<void>((resolve) => {
                  InteractionManager.runAfterInteractions(() => resolve());
                });
                await new Promise<void>((r) => setTimeout(r, Platform.OS === 'android' ? 90 : 120));
                resetTabsToYourRidesAfterBook(navigation);
              })();
            },
          },
        ]);
      } else {
        // Let the Book button finish its press animation, then transition without jank.
        await new Promise<void>((resolve) => {
          InteractionManager.runAfterInteractions(() => resolve());
        });
        await new Promise<void>((r) => setTimeout(r, Platform.OS === 'android' ? 90 : 120));
        resetTabsToYourRidesAfterBook(navigation);
      }
    } catch (e: unknown) {
      const message = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : 'Failed to book ride.';
      Alert.alert('Error', message);
    } finally {
      setBooking(false);
    }
  };

  const handleCancelBooking = () => {
    const bid = myPassengerBooking?.id?.trim();
    if (!bid) {
      Alert.alert('Cancel booking', 'Could not find your booking. Try again in a moment.');
      return;
    }
    // Max seats to show in the cancellation sheet should reflect the viewer's active booked seats.
    const myBookingSeats = viewerBookedSeats > 0 ? Math.max(1, Math.floor(viewerBookedSeats)) : 1;

    setCancelBookingBid(bid);
    setCancelBookingMaxSeats(myBookingSeats);
    setCancelBookingSeatsToCancel(1);
    setCancelBookingSheetMode('booking');
    setCancelBookingSheetVisible(true);
  };

  const openPendingRequestActions = useCallback(() => {
    const bid = myPassengerBooking?.id?.trim();
    if (!bid) {
      Alert.alert('Request', 'Could not find your pending request. Please refresh and try again.');
      return;
    }
    const requestedSeatsRaw =
      typeof myPassengerBooking?.seats === 'number' && Number.isFinite(myPassengerBooking.seats)
        ? myPassengerBooking.seats
        : 1;
    const requestedSeats = Math.max(1, Math.floor(requestedSeatsRaw));
    setCancelBookingBid(bid);
    setCancelBookingMaxSeats(requestedSeats);
    setCancelBookingSeatsToCancel(1);
    setCancelBookingSheetMode('request');
    setCancelBookingSheetVisible(true);
  }, [myPassengerBooking]);

  const closeCancelBookingSheet = useCallback(() => {
    if (cancellingBooking) return;
    setCancelBookingSheetVisible(false);
    setCancelBookingBid(null);
    setCancelBookingMaxSeats(1);
    setCancelBookingSeatsToCancel(1);
    setCancelBookingSheetMode('booking');
  }, [cancellingBooking]);

  const confirmCancelSeats = useCallback(
    async (seatsToCancel: number) => {
      const bid = cancelBookingBid;
      if (!bid) return;
      if (seatsToCancel < 1) return;

      setCancelBookingSheetVisible(false);
      setCancellingBooking(true);
      try {
        const cancelAll = seatsToCancel >= cancelBookingMaxSeats;
        // Backend enhancement (expected): allow partial seat cancellation via query params.
        const url = `${API.endpoints.bookings.cancel(bid)}?seats=${encodeURIComponent(
          seatsToCancel
        )}&seatsToCancel=${encodeURIComponent(seatsToCancel)}`;

        await api.delete(url);
        // Always reload from the server so seat counts / booking status stay source-of-truth.
        await fetchRideDetail({ force: true });

        if (cancelAll) {
          Alert.alert('Cancelled', 'Your booking was cancelled. You can find it under Past rides.', [
            { text: 'OK', onPress: () => navigation.goBack() },
          ]);
        } else {
          Alert.alert(
            'Updated',
            `Cancelled ${seatsToCancel} seat${seatsToCancel !== 1 ? 's' : ''}.`
          );
        }
      } catch (e: unknown) {
        const message =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: unknown }).message)
            : 'Could not cancel booking.';
        Alert.alert('Error', message);
      } finally {
        setCancellingBooking(false);
        setCancelBookingBid(null);
        setCancelBookingMaxSeats(1);
        setCancelBookingSeatsToCancel(1);
      }
    },
    [cancelBookingBid, cancelBookingMaxSeats, fetchRideDetail, navigation]
  );

  const handleCancelRide = () => {
    if (!isOwnerStrict) {
      Alert.alert('Not allowed', 'Only the driver can cancel this ride.');
      return;
    }
    Alert.alert(
      'Cancel ride',
      'Are you sure you want to cancel this ride? This cannot be undone.',
      [
        { text: 'Keep ride', style: 'cancel' },
        {
          text: 'Cancel ride',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await api.delete(API.endpoints.rides.detail(ride.id));
              await recordOwnerCancelledRide(currentUserId, {
                id: ride.id,
                userId: ride.userId ?? currentUserId,
                pickupLocationName: ride.pickupLocationName,
                destinationLocationName: ride.destinationLocationName,
                pickupLatitude: ride.pickupLatitude,
                pickupLongitude: ride.pickupLongitude,
                destinationLatitude: ride.destinationLatitude,
                destinationLongitude: ride.destinationLongitude,
                scheduledAt: ride.scheduledAt,
                scheduledDate: ride.scheduledDate,
                scheduledTime: ride.scheduledTime,
                rideDate: ride.rideDate,
                rideTime: ride.rideTime,
                price: ride.price,
                seats: ride.seats,
                username: ride.username,
                ...(ride.name ? { name: ride.name } : {}),
                estimatedDurationSeconds: ride.estimatedDurationSeconds,
                status: 'cancelled',
              });
              navigation.goBack();
            } catch (e: unknown) {
              const message = e && typeof e === 'object' && 'message' in e
                ? String((e as { message: unknown }).message)
                : 'Failed to cancel ride.';
              Alert.alert('Error', message);
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

  const handleSkipRating = useCallback(() => {
    if (!currentUserId) {
      setShowRatingModal(false);
      return;
    }
    void markRatingPromptHandled(currentUserId, ride.id);
    setShowRatingModal(false);
  }, [currentUserId, ride.id]);

  const handleSubmitRating = useCallback(async () => {
    if (ratingSubmitting || ratingSubmitted) return;
    if (!currentUserId) return;
    if (!ratingTargetUserId) {
      Alert.alert('Rating unavailable', 'Could not find who to rate for this completed ride.');
      return;
    }
    if (ratingStars < 1 || ratingStars > 5) {
      Alert.alert('Select rating', 'Please select 1 to 5 stars.');
      return;
    }

    setRatingSubmitting(true);
    try {
      await submitRideRating({
        rideId: ride.id,
        toUserId: ratingTargetUserId,
        rating: ratingStars,
        review: ratingReview.trim() || undefined,
      });
      await markRatingPromptHandled(currentUserId, ride.id);
      if (isOwner) {
        void mergeOwnerRatedPassenger(currentUserId, ride.id, ratingTargetUserId);
      } else {
        void mergePassengerRatedRide(currentUserId, ride.id);
      }
      setRatingSubmitted(true);
      setShowRatingModal(false);
      Alert.alert('Thanks for your feedback');
    } catch (e: unknown) {
      const status =
        e && typeof e === 'object' && 'status' in e ? (e as { status?: number }).status : undefined;
      if (status === 409) {
        await markRatingPromptHandled(currentUserId, ride.id);
        if (isOwner) {
          void mergeOwnerRatedPassenger(currentUserId, ride.id, ratingTargetUserId);
        } else {
          void mergePassengerRatedRide(currentUserId, ride.id);
        }
        setRatingSubmitted(true);
        setShowRatingModal(false);
        Alert.alert('Already rated', 'Your feedback was recorded earlier.');
        return;
      }
      const message =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : 'Could not submit rating right now.';
      Alert.alert('Error', message);
    } finally {
      setRatingSubmitting(false);
    }
  }, [
    ratingSubmitting,
    ratingSubmitted,
    currentUserId,
    ratingTargetUserId,
    ratingStars,
    ratingReview,
    ride.id,
    isOwner,
  ]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBack} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Ride plan</Text>
        <TouchableOpacity style={styles.headerSupport} hitSlop={8}>
          <Text style={styles.headerSupportText}>Get support</Text>
        </TouchableOpacity>
      </View>

      <>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Main ride card (reference layout) */}
        <View style={styles.detailCard}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardDateTime}>
              {cardDateShort} • {pickupTime}
            </Text>
          </View>

          {showDualRouteForViewer ? (
            <View style={styles.routeStack}>
              <Text style={styles.routeSectionLabel}>{"Driver's route (published)"}</Text>
              <View style={styles.cardRouteRow}>
                <View style={styles.cardRouteTimeline}>
                  <View style={styles.hollowDot} />
                  <View style={styles.timelineDashCompact} />
                  <Ionicons name="location" size={18} color={COLORS.primary} />
                </View>
                <View style={styles.cardRouteTextCol}>
                  <View style={styles.cardRouteStop}>
                    <Text style={styles.routeLabelCompact}>PICKUP</Text>
                    <Text style={styles.routePlaceCompact} numberOfLines={4}>
                      {publishedPickupStr}
                    </Text>
                  </View>
                  <View style={styles.cardRouteStopSpacedCompact}>
                    <Text style={styles.routeLabelCompact}>DROP-OFF</Text>
                    <Text style={styles.routePlaceCompact} numberOfLines={4}>
                      {publishedDestStr}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.routeSubDivider} />

              <Text style={styles.routeSectionLabel}>
                {isBookedByMe ? 'Your pickup & drop-off' : 'Your pickup & drop-off (search)'}
              </Text>
              <View style={styles.cardRouteRow}>
                <View style={styles.cardRouteTimeline}>
                  <View style={styles.hollowDotSmall} />
                  <View style={styles.timelineDashCompact} />
                  <Ionicons name="location" size={18} color={COLORS.textSecondary} />
                </View>
                <View style={styles.cardRouteTextCol}>
                  <View style={styles.cardRouteStop}>
                    <Text style={styles.routeLabelCompact}>PICKUP</Text>
                    <Text style={styles.routePlaceCompact} numberOfLines={4}>
                      {viewerPickupStr}
                    </Text>
                  </View>
                  <View style={styles.cardRouteStopSpacedCompact}>
                    <Text style={styles.routeLabelCompact}>DROP-OFF</Text>
                    <Text style={styles.routePlaceCompact} numberOfLines={4}>
                      {viewerDestStr}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.cardRouteRow}>
              <View style={styles.cardRouteTimeline}>
                <View style={styles.hollowDot} />
                <View style={styles.timelineDash} />
                <Ionicons name="location" size={22} color={COLORS.primary} />
              </View>
              <View style={styles.cardRouteTextCol}>
                <View style={styles.cardRouteStop}>
                  <Text style={styles.routeLabel}>
                    {isOwner ? 'PICKUP' : isBookedByMe ? 'YOUR PICKUP' : 'PICKUP'}
                  </Text>
                  <Text style={styles.routePlace} numberOfLines={2}>
                    {pickupLabel}
                  </Text>
                </View>
                <View style={styles.cardRouteStopSpaced}>
                  <Text style={styles.routeLabel}>
                    {isOwner ? 'DROP-OFF' : isBookedByMe ? 'YOUR DROP-OFF' : 'DROP-OFF'}
                  </Text>
                  <Text style={styles.routePlace} numberOfLines={2}>
                    {destinationLabel}
                  </Text>
                </View>
              </View>
            </View>
          )}

          {publisherCoords ? (
            <TouchableOpacity
              style={styles.viewRouteMapRow}
              onPress={openPublishedRouteMap}
              activeOpacity={0.75}
            >
              <View style={styles.viewRouteMapIconWrap}>
                <Ionicons name="map-outline" size={22} color={COLORS.primary} />
              </View>
              <View style={styles.viewRouteMapTextCol}>
                <Text style={styles.viewRouteMapTitle}>View route map</Text>
                <Text style={styles.viewRouteMapSub} numberOfLines={2}>
                  Driving directions for the route the driver published
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
          ) : null}

          <View style={styles.cardDivider} />

          <View style={styles.cardDriverRow}>
            <View style={styles.avatarWrap}>
              <UserAvatar
                uri={cardAvatarUri}
                name={cardAvatarName}
                size={48}
                backgroundColor={COLORS.primary}
                fallbackTextColor={COLORS.white}
              />
            </View>
            <View style={styles.cardDriverText}>
              <Text style={styles.driverNameBold} numberOfLines={isOwner ? 2 : 1}>
                {cardPersonName}
              </Text>
              {cardPersonSubtitle ? (
                <Text style={styles.driverVehicle} numberOfLines={isOwner ? 2 : 1}>
                  {cardPersonSubtitle}
                </Text>
              ) : null}
            </View>
            {!isOwner ? (
              <View style={styles.cardDriverActions}>
                {passengerCanMessageOwner ? (
                  <TouchableOpacity
                    style={styles.ownerRowChatPill}
                    onPress={openChatWithOwner}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel="Message driver"
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={20} color={COLORS.primary} />
                    <Text style={styles.ownerRowChatPillText}>Chat</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={styles.detailsPill}
                  onPress={() => {
                    const ownerId = (ride.userId ?? '').trim();
                    if (!ownerId) {
                      scrollRef.current?.scrollToEnd({ animated: true });
                      return;
                    }

                    // Hide bottom tabs immediately while the profile screen mounts.
                    const parentNav = (navigation as any)?.getParent?.();
                    parentNav?.setOptions?.({ tabBarStyle: { display: 'none' } });

                    (navigation as any).navigate('OwnerProfileModal', {
                      userId: ownerId,
                      displayName: driverName || ride.name || ride.username || 'User',
                      ...(ride.publisherAvatarUrl?.trim()
                        ? { avatarUrl: ride.publisherAvatarUrl.trim() }
                        : {}),
                      ...(typeof ride.publisherAvgRating === 'number' &&
                      Number.isFinite(ride.publisherAvgRating)
                        ? { publisherAvgRating: ride.publisherAvgRating }
                        : {}),
                      ...(typeof ride.publisherRatingCount === 'number' &&
                      Number.isFinite(ride.publisherRatingCount) &&
                      ride.publisherRatingCount >= 0
                        ? { publisherRatingCount: ride.publisherRatingCount }
                        : {}),
                    });
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={styles.detailsPillText}>Details</Text>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>

        {/* Payment & seats */}
        <View style={styles.block}>
          <View style={styles.paymentRow}>
            <View>
              <Text style={styles.paymentMethod}>Pay in cash (₹)</Text>
              <Text style={styles.paymentSeats}>
                {!isOwner
                  ? viewerBookedSeats > 0
                    ? `${viewerBookedSeats} seat${viewerBookedSeats !== 1 ? 's' : ''} booked · ${availableSeatsCount} left`
                    : getRideAvailabilityShort(ride) || '—'
                  : bookedSeats > 0
                    ? `${bookedSeats} seat${bookedSeats !== 1 ? 's' : ''} booked · ${availableSeatsCount} left`
                    : totalBookingsCount > 0
                      ? `Cancelled · ${totalBookingsCount} passenger${totalBookingsCount !== 1 ? 's' : ''}`
                      : getRideAvailabilityShort(ride) ||
                        `${totalSeats} seat${totalSeats !== 1 ? 's' : ''} offered`}
              </Text>
            </View>
            <Text style={styles.paymentPrice}>
              {totalBookedPriceText ?? (priceDisplay !== '—' ? priceDisplay : '₹—')}
            </Text>
          </View>
        </View>

        {/* Seat requests (owner + request-book mode) */}
        {isOwner && isRequestBookingMode && availableSeatsCount > 0 ? (
          <View style={[styles.block, styles.seatRequestsBlock]}>
            <View style={styles.seatRequestsHeader}>
              <Text style={styles.seatRequestsHeading}>
                Seat requests <Text style={styles.seatRequestsCount}>{pendingSeatRequests.length}</Text>
              </Text>
              <TouchableOpacity
                style={styles.seatRequestsManageAllBtn}
                onPress={() => void fetchSeatRequests()}
                disabled={seatRequestsLoading}
                activeOpacity={0.75}
              >
                {seatRequestsLoading ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : (
                  <Text style={styles.seatRequestsManageAll}>Manage all</Text>
                )}
              </TouchableOpacity>
            </View>
            {seatRequestsLoading ? (
              <View style={styles.seatRequestsLoadingWrap}>
                <ActivityIndicator size="small" color={COLORS.primary} />
                <Text style={styles.seatRequestsLoadingText}>Loading requests...</Text>
              </View>
            ) : pendingSeatRequests.length > 0 ? (
              <View style={styles.seatRequestsList}>
                {pendingSeatRequests.map((b) => {
                  const displayName = bookingPassengerDisplayName(b);
                  const { lineShort } = bookingPickupDrop(ride, b);
                  const actionBusy = seatRequestActionBookingId === b.id;
                  const createdAt = new Date(b.bookedAt);
                  const requestAgo = (() => {
                    if (Number.isNaN(createdAt.getTime())) return '';
                    const mins = Math.max(1, Math.floor((Date.now() - createdAt.getTime()) / 60000));
                    if (mins < 60) return `${mins}m ago`;
                    const hours = Math.floor(mins / 60);
                    if (hours < 24) return `${hours}h ago`;
                    const days = Math.floor(hours / 24);
                    return `${days}d ago`;
                  })();
                  const [fromLine = lineShort, toLine = ''] = String(lineShort).split('→').map((s) => s.trim());
                  return (
                    <TouchableOpacity
                      key={`req_${b.id}`}
                      style={styles.seatRequestCard}
                      activeOpacity={0.82}
                      onPress={() => openSeatRequestDetail(b)}
                    >
                      <View style={styles.seatRequestTop}>
                        <View style={styles.seatRequestTopLeft}>
                          <View style={styles.seatRequestIdentityRow}>
                            <UserAvatar
                              uri={b.avatarUrl}
                              name={displayName}
                              size={38}
                              backgroundColor="#e2e8f0"
                            />
                            <View style={styles.seatRequestIdentityText}>
                              <Text style={styles.seatRequestName} numberOfLines={1}>
                                {displayName}
                              </Text>
                              <View style={styles.seatRequestMetaRow}>
                                <Ionicons name="star-outline" size={12} color="#f59e0b" />
                                <Text style={styles.seatRequestMetaText}>4.9</Text>
                                {requestAgo ? <Text style={styles.seatRequestMetaDot}>•</Text> : null}
                                {requestAgo ? (
                                  <Text style={styles.seatRequestMetaTextMuted}>{requestAgo}</Text>
                                ) : null}
                              </View>
                            </View>
                          </View>
                          <View style={styles.seatRequestRouteWrap}>
                            <Text style={styles.seatRequestRouteLine} numberOfLines={1}>
                              • {fromLine}
                            </Text>
                            {toLine ? (
                              <Text style={styles.seatRequestRouteLine} numberOfLines={1}>
                                • {toLine}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                        <View style={styles.seatRequestSeatsBadge}>
                          <Text style={styles.seatRequestSeats}>
                            {b.seats} seat{b.seats !== 1 ? 's' : ''}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.seatRequestDivider} />
                      <View style={styles.seatRequestActions}>
                        <TouchableOpacity
                          style={styles.seatRequestApproveBtn}
                          activeOpacity={0.75}
                          onPress={() => void handleSeatRequestAction(b.id, 'approve')}
                          disabled={actionBusy}
                        >
                          {actionBusy ? (
                            <ActivityIndicator size="small" color={COLORS.white} />
                          ) : (
                            <Text style={styles.seatRequestApproveText}>Approve</Text>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.seatRequestRejectBtn}
                          activeOpacity={0.75}
                          onPress={() => void handleSeatRequestAction(b.id, 'reject')}
                          disabled={actionBusy}
                        >
                          {actionBusy ? (
                            <ActivityIndicator size="small" color={COLORS.error} />
                          ) : (
                            <Text style={styles.seatRequestRejectText}>Reject</Text>
                          )}
                        </TouchableOpacity>
                        <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.noPassengers}>No pending requests</Text>
            )}
          </View>
        ) : null}

        {/* Passengers: signed-in owner gets management list; everyone else (incl. guests) sees who’s already booked. */}
        {(isAuthenticated && isOwner) || !isOwner ? (
          <View style={styles.block}>
            <Text style={styles.passengersHeading}>Passengers</Text>
            {isAuthenticated && isOwner ? (
              ownerPassengerSummaries.length > 0 ? (
                <View style={styles.passengersList}>
                  {ownerPassengerSummaries.map(({ userId: ownerSummaryUserId, primary, historyChronological }) => {
                    const b = primary;
                    const isMe = (b.userId ?? '').trim() === currentUserId;
                    const displayName = isMe ? (currentUserName || 'You') : bookingPassengerDisplayName(b);
                    const bookingCancelled = bookingIsCancelled(b.status);
                    const isRebooked =
                      !bookingCancelled &&
                      !isPastRide &&
                      cancelledPassengerUserIds.has((b.userId ?? '').trim()) &&
                      activePassengerUserIds.has((b.userId ?? '').trim());
                    const shouldFadeCancelled = bookingCancelled && !isRebooked;
                    const mergedForRoute: BookingItem =
                      isMe && passengerSearch?.from?.trim() && passengerSearch?.to?.trim()
                        ? {
                            ...b,
                            pickupLocationName:
                              b.pickupLocationName?.trim() || passengerSearch.from.trim(),
                            destinationLocationName:
                              b.destinationLocationName?.trim() || passengerSearch.to.trim(),
                          }
                        : b;
                    const { lineShort } = bookingPickupDrop(ride, mergedForRoute);
                    return (
                      <TouchableOpacity
                        key={ownerSummaryUserId || b.id}
                        style={[styles.passengerRowOwner, shouldFadeCancelled && styles.passengerRowCancelled]}
                        onPress={() =>
                          (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate(
                            'BookPassengerDetail',
                            { ride, booking: b }
                          )
                        }
                        activeOpacity={shouldFadeCancelled ? 0.55 : 0.72}
                      >
                        <View style={styles.passengerRowOwnerIcon}>
                          <UserAvatar
                            uri={
                              isMe
                                ? (b.avatarUrl?.trim() || user?.avatarUrl?.trim() || undefined)
                                : (b.avatarUrl ?? '').trim() || undefined
                            }
                            name={displayName}
                            size={40}
                            backgroundColor="rgba(41, 190, 139, 0.14)"
                            fallbackTextColor={COLORS.primary}
                          />
                        </View>
                        <View style={styles.passengerRowOwnerText}>
                          <Text
                            style={[styles.passengerNameOwner, shouldFadeCancelled && styles.passengerNameCancelled]}
                          >
                            {displayName}
                          </Text>
                          {bookingCancelled || isRebooked ? (
                            <Text
                              style={[
                                styles.passengerBookingCancelledLabel,
                                isRebooked && styles.passengerBookingRebookedLabel,
                              ]}
                            >
                              {isRebooked ? 'Rebooked' : 'Cancelled'}
                            </Text>
                          ) : null}
                          <Text
                            style={[
                              styles.passengerBookedRouteCaption,
                              shouldFadeCancelled && styles.passengerCaptionCancelled,
                            ]}
                          >
                            Passenger pickup → drop-off
                          </Text>
                          <Text
                            style={[styles.passengerRouteHint, shouldFadeCancelled && styles.passengerHintCancelled]}
                            numberOfLines={2}
                          >
                            {lineShort}
                          </Text>
                          {historyChronological.length > 1 ? (
                            <View style={styles.passengerBookingHistory}>
                              <Text style={styles.passengerBookingHistoryTitle}>Booking history</Text>
                              {historyChronological.map((h) => {
                                const when = formatBookingHistoryLineWhen(h.bookedAt ?? '');
                                return (
                                  <Text key={h.id} style={styles.passengerBookingHistoryLine} numberOfLines={2}>
                                    {h.seats} seat{h.seats !== 1 ? 's' : ''} · {bookingStatusShortLabel(h.status)}
                                    {when ? ` · ${when}` : ''}
                                  </Text>
                                );
                              })}
                            </View>
                          ) : null}
                        </View>
                        <View style={styles.passengerRowOwnerRight}>
                          <Text
                            style={[
                              styles.passengerSeatsCompact,
                              shouldFadeCancelled && styles.passengerNameCancelled,
                            ]}
                          >
                            {b.seats} seat{b.seats !== 1 ? 's' : ''}
                          </Text>
                          <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.noPassengers}>No other passengers yet</Text>
              )
            ) : !isOwner && passengersForDisplayFiltered.length > 0 ? (
              <View style={styles.passengersList}>
                {passengersForDisplayFiltered.map((b) => {
                  const isMe = (b.userId ?? '').trim() === currentUserId;
                  const displayName = isMe ? (currentUserName || 'You') : bookingPassengerDisplayName(b);
                  const bookingCancelled = bookingIsCancelled(b.status);
                  const isRebooked =
                    !bookingCancelled &&
                    !isPastRide &&
                    cancelledPassengerUserIds.has((b.userId ?? '').trim()) &&
                    activePassengerUserIds.has((b.userId ?? '').trim());
                  const shouldFadeCancelled = bookingCancelled && !isRebooked;

                  const coPassengerUid = (b.userId ?? '').trim();
                  /** Open ratings modal for any viewer with a passenger user id (incl. guests). */
                  const canOpenRatings = Boolean(coPassengerUid);
                  const rowAvatarUri =
                    isMe
                      ? (b.avatarUrl?.trim() || user?.avatarUrl?.trim() || undefined)
                      : b.avatarUrl?.trim() || undefined;
                  const avgKnown =
                    typeof b.avgRating === 'number' && Number.isFinite(b.avgRating) && b.avgRating > 0
                      ? b.avgRating
                      : null;
                  const rc =
                    typeof b.ratingCount === 'number' && b.ratingCount > 0 ? Math.floor(b.ratingCount) : 0;

                  const coPassengerBody = (
                    <>
                      <View style={styles.passengerRowOwnerIcon}>
                        <UserAvatar
                          uri={rowAvatarUri}
                          name={displayName}
                          size={40}
                          backgroundColor="rgba(41, 190, 139, 0.14)"
                          fallbackTextColor={COLORS.primary}
                        />
                      </View>
                      <View style={styles.passengerRowOwnerText}>
                        <Text
                          style={[styles.passengerNameOwner, shouldFadeCancelled && styles.passengerNameCancelled]}
                        >
                          {displayName}
                        </Text>
                        {bookingCancelled || isRebooked ? (
                          <Text
                            style={[
                              styles.passengerBookingCancelledLabel,
                              isRebooked && styles.passengerBookingRebookedLabel,
                            ]}
                          >
                            {isRebooked ? 'Rebooked' : 'Cancelled'}
                          </Text>
                        ) : null}
                        {avgKnown != null ? (
                          <View style={styles.passengerRatingRow}>
                            <Ionicons name="star" size={14} color="#f59e0b" />
                            <Text style={styles.passengerRatingAvg}>{avgKnown.toFixed(1)}</Text>
                            {rc > 0 ? (
                              <Text style={styles.passengerRatingCount}>
                                ({rc} ride{rc !== 1 ? 's' : ''})
                              </Text>
                            ) : null}
                          </View>
                        ) : null}
                        <Text
                          style={[
                            styles.passengerSeatsMeta,
                            shouldFadeCancelled && styles.passengerNameCancelled,
                          ]}
                        >
                          {b.seats} seat{b.seats !== 1 ? 's' : ''}
                        </Text>
                      </View>
                      <View style={styles.passengerRowOwnerRight}>
                        {canOpenRatings ? (
                          <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                        ) : null}
                      </View>
                    </>
                  );

                  return canOpenRatings ? (
                    <TouchableOpacity
                      key={b.id}
                      style={[
                        styles.passengerRowOwner,
                        styles.passengerRowCopassenger,
                        shouldFadeCancelled && styles.passengerRowCancelled,
                      ]}
                      onPress={() => openCoPassengerRatings(b, displayName, rowAvatarUri)}
                      activeOpacity={shouldFadeCancelled ? 0.55 : 0.72}
                    >
                      {coPassengerBody}
                    </TouchableOpacity>
                  ) : (
                    <View
                      key={b.id}
                      style={[
                        styles.passengerRowOwner,
                        styles.passengerRowCopassenger,
                        shouldFadeCancelled && styles.passengerRowCancelled,
                      ]}
                    >
                      {coPassengerBody}
                    </View>
                  );
                })}
              </View>
            ) : !isOwner ? (
              <Text style={styles.noPassengers}>No other passengers yet</Text>
            ) : null}
          </View>
        ) : null}

        {/* Actions — past rides: no calendar / offer links; owner: no edit or cancel */}
        {!isPastRide && (!isBookedByMe || isOwner) && !isOwnerRideCancelled ? (
          <>
            <TouchableOpacity style={styles.linkButton} onPress={() => {}}>
              <Text style={styles.linkText}>Add to calendar</Text>
            </TouchableOpacity>
          </>
        ) : null}

        {isOwnerStrict && isOwnerRideCancelled ? (
          <View style={[styles.button, styles.buttonOwnerRideCancelled]}>
            <Ionicons name="ban-outline" size={22} color={COLORS.textMuted} />
            <Text style={styles.buttonOwnerRideCancelledText}>Ride cancelled</Text>
          </View>
        ) : isOwnerStrict && !isPastRide ? (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.buttonEdit]}
              onPress={handleEdit}
              disabled={cancelling}
            >
              <Ionicons name="pencil-outline" size={22} color={COLORS.primary} />
              <Text style={styles.buttonEditText}>Edit ride details</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.buttonCancel]}
              onPress={handleCancelRide}
              disabled={cancelling}
            >
              {cancelling ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="close-circle-outline" size={22} color="#fff" />
                  <Text style={styles.buttonCancelText}>Cancel ride</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ) : isBookedByMe && !isPastRide && !rideCancelledByOwner ? (
          <TouchableOpacity
            style={[styles.button, styles.buttonCancelPassenger]}
            onPress={handleCancelBooking}
            disabled={cancellingBooking}
            activeOpacity={0.85}
          >
            {cancellingBooking ? (
              <ActivityIndicator size="small" color={COLORS.error} />
            ) : (
              <>
                <Ionicons name="close-circle-outline" size={22} color={COLORS.error} />
                <Text style={styles.buttonCancelPassengerText}>Cancel your ride</Text>
              </>
            )}
          </TouchableOpacity>
        ) : !isOwner && isMyBookingPending && !isPastRide && !rideCancelledByOwner ? (
          <TouchableOpacity
            style={[styles.button, styles.buttonPendingRequest]}
            onPress={openPendingRequestActions}
            activeOpacity={0.85}
          >
            <Ionicons name="time-outline" size={22} color={COLORS.primary} />
            <Text style={styles.buttonPendingRequestText}>Request pending approval</Text>
          </TouchableOpacity>
        ) : !isOwner && isMyBookingRejected && !isPastRide && !rideCancelledByOwner ? (
          <View style={[styles.button, styles.buttonRequestRejected]}>
            <Ionicons name="close-circle-outline" size={22} color={COLORS.error} />
            <Text style={styles.buttonRequestRejectedText}>{driverName} rejected</Text>
          </View>
        ) : !isOwner && rideCancelledByOwner ? (
          <View style={[styles.button, styles.buttonOwnerRideCancelled]}>
            <Ionicons name="ban-outline" size={22} color={COLORS.textMuted} />
            <Text style={styles.buttonOwnerRideCancelledText}>Ride cancelled by the driver</Text>
          </View>
        ) : !isOwner && isMyBookingCancelled && isPastRide ? (
          <View style={[styles.button, styles.buttonBookingCancelled]}>
            <Ionicons name="ban-outline" size={22} color={COLORS.error} />
            <Text style={styles.buttonBookingCancelledText}>You cancelled your booking</Text>
          </View>
        ) : isPastRide ? (
          <View style={[styles.button, styles.buttonPastEnded]}>
            <Ionicons name="time-outline" size={22} color={COLORS.textMuted} />
            <Text style={styles.buttonPastEndedText}>This ride is in the past</Text>
          </View>
        ) : availableSeatsCount <= 0 ? (
          <View style={[styles.button, styles.buttonPastEnded]}>
            <Ionicons name="people-outline" size={22} color={COLORS.textMuted} />
            <Text style={styles.buttonPastEndedText}>Full</Text>
          </View>
        ) : (
          <View>
            {passengerSelfCancelledBooking ? (
              <Text style={styles.rebookHint}>You cancelled your booking — you can book again.</Text>
            ) : null}
            {availableSeatsCount > 1 ? (
              <View style={styles.seatPickerRow}>
                <Text style={styles.seatPickerLabel}>Seats</Text>
                <View style={styles.seatPickerControls}>
                  <TouchableOpacity
                    style={[styles.seatPickerBtn, bookSeatsCount <= 1 && styles.seatPickerBtnDisabled]}
                    onPress={() => setBookSeatsCount((c) => Math.max(1, c - 1))}
                    disabled={bookSeatsCount <= 1 || booking}
                    hitSlop={8}
                  >
                    <Ionicons name="remove" size={22} color={COLORS.primary} />
                  </TouchableOpacity>
                  <Text style={styles.seatPickerValue}>{bookSeatsCount}</Text>
                  <TouchableOpacity
                    style={[
                      styles.seatPickerBtn,
                      bookSeatsCount >= availableSeatsCount && styles.seatPickerBtnDisabled,
                    ]}
                    onPress={() =>
                      setBookSeatsCount((c) => Math.min(availableSeatsCount, c + 1))
                    }
                    disabled={bookSeatsCount >= availableSeatsCount || booking}
                    hitSlop={8}
                  >
                    <Ionicons name="add" size={22} color={COLORS.primary} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.seatPickerHint}>
                  {availableSeatsCount} seat{availableSeatsCount !== 1 ? 's' : ''} left
                </Text>
              </View>
            ) : null}
            <TouchableOpacity
              style={[styles.button, styles.buttonBook]}
              onPress={() => void handleBook()}
              disabled={booking || availableSeatsCount <= 0}
              activeOpacity={0.8}
            >
              {booking ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="book-outline" size={22} color="#fff" />
                  <Text style={styles.buttonBookText}>
                    {isRequestBookingMode
                      ? passengerSelfCancelledBooking
                        ? 'Request again'
                        : bookSeatsCount > 1
                          ? 'Request seats'
                          : 'Request to book'
                      : passengerSelfCancelledBooking
                        ? 'Book again'
                        : bookSeatsCount > 1
                          ? 'Book seats'
                          : 'Book'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
      <Modal
        visible={openingSeatRequestDetailId != null}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.requestDetailOpeningOverlay}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={styles.requestDetailOpeningText}>Opening request...</Text>
        </View>
      </Modal>
      </>
      <LoginBottomSheet
        visible={guestLoginSheetVisible}
        onClose={() => setGuestLoginSheetVisible(false)}
        onLoggedIn={() => {
          InteractionManager.runAfterInteractions(() => {
            let attempts = 0;
            const maxAttempts = 50;
            const tick = () => {
              const id = (
                authBackendUserIdRef.current.trim() ||
                authUserIdRef.current.trim()
              ).trim();
              if (id) {
                const cap = getRideAvailableSeats(ride);
                if (cap <= 0) {
                  Alert.alert('Full', 'This ride has no available seats.');
                  return;
                }
                const seats = Math.min(Math.max(1, bookSeatsCount), cap);
                const unit = parseSeatPriceNumber(ride);
                const priceLine =
                  unit != null ? `\n\nTotal: ${formatRupees(unit * seats)}` : '';
                Alert.alert(
                  isRequestBookingMode ? 'Confirm request' : 'Confirm booking',
                  `${isRequestBookingMode ? 'Request' : 'Book'} ${seats} seat${seats === 1 ? '' : 's'} on this ride?${priceLine}`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: isRequestBookingMode ? 'Request' : 'Book',
                      onPress: () =>
                        void handleBook({
                          sessionUserId: id,
                          stayOnRideDetail: true,
                        }),
                    },
                  ],
                );
                return;
              }
              attempts += 1;
              if (attempts >= maxAttempts) {
                Alert.alert('Sign-in', 'Could not confirm your account. Try booking again.');
                return;
              }
              setTimeout(tick, 80);
            };
            setTimeout(tick, 0);
          });
        }}
        navigation={navigation as NavigationProp<ParamListBase>}
      />
      <Modal visible={showRatingModal} transparent animationType="fade" onRequestClose={handleSkipRating}>
        <KeyboardAvoidingView
          style={styles.ratingOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
        >
          <Pressable style={styles.ratingOverlayPressable} onPress={handleSkipRating} />
          <View style={styles.ratingSheet}>
            <View style={styles.ratingHandle} />
            <TouchableOpacity
              style={styles.ratingCloseBtn}
              onPress={handleSkipRating}
              disabled={ratingSubmitting || ratingSubmitted}
              hitSlop={8}
            >
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
            <Text style={styles.ratingTitle}>Rate your ride</Text>
            <Text style={styles.ratingSubtitle}>Tap a star to rate your experience</Text>

            <View style={styles.ratingStarsRow}>
              {[1, 2, 3, 4, 5].map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setRatingStars(s)}
                  disabled={ratingSubmitting || ratingSubmitted}
                  hitSlop={8}
                >
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
              editable={!ratingSubmitting && !ratingSubmitted}
            />

            <TouchableOpacity
              style={[
                styles.ratingSubmitBtn,
                (ratingStars < 1 || ratingSubmitting || ratingSubmitted) && styles.ratingSubmitBtnDisabled,
              ]}
              onPress={handleSubmitRating}
              disabled={ratingStars < 1 || ratingSubmitting || ratingSubmitted}
            >
              {ratingSubmitting ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <Text style={styles.ratingSubmitText}>Submit Feedback</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.ratingCancelBtn}
              onPress={handleSkipRating}
              disabled={ratingSubmitting || ratingSubmitted}
            >
              <Text style={styles.ratingCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={showEditSheet} transparent animationType="none" onRequestClose={closeEditSheet}>
        <View style={styles.editSheetOverlay}>
          <TouchableOpacity style={styles.editSheetDismissArea} activeOpacity={1} onPress={closeEditSheet} />
          <Animated.View
            style={[
              styles.editSheetCard,
              { height: editSheetExpanded ? editFullHeight : editHalfHeight, transform: [{ translateY: editSheetSlideY }] },
            ]}
          >
            <TouchableOpacity style={styles.editSheetHandleArea} onPress={expandEditSheet} activeOpacity={0.9}>
              <View style={styles.editSheetHandle} />
            </TouchableOpacity>
            <View style={styles.editSheetHeader}>
              <Text style={styles.editSheetTitle}>Edit ride details</Text>
              <TouchableOpacity onPress={closeEditSheet} hitSlop={10}>
                <Ionicons name="close" size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.editSheetBodyScroll}
              contentContainerStyle={styles.editSheetBody}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.editPreviewCard}>
                <TouchableOpacity
                  style={styles.editPreviewRow}
                  onPress={() =>
                    (navigation as { navigate: (name: string, params: Record<string, unknown>) => void }).navigate('LocationPicker', {
                      field: 'from',
                      currentFrom: editPickup,
                      currentTo: editDestination,
                      returnScreen: 'SearchRides',
                    })
                  }
                  activeOpacity={0.75}
                >
                  <View style={styles.editPreviewIconCol}>
                    <View style={styles.editPreviewGreenDot} />
                    <View style={styles.editPreviewDotted} />
                  </View>
                  <View style={styles.editPreviewTextWrap}>
                    <Text style={styles.editPreviewValue} numberOfLines={1}>{editPickup}</Text>
                    <Text style={styles.editPreviewLabel}>PICKUP</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.editPreviewRow}
                  onPress={() =>
                    (navigation as { navigate: (name: string, params: Record<string, unknown>) => void }).navigate('LocationPicker', {
                      field: 'to',
                      currentFrom: editPickup,
                      currentTo: editDestination,
                      returnScreen: 'SearchRides',
                    })
                  }
                  activeOpacity={0.75}
                >
                  <View style={styles.editPreviewIconCol}>
                    <View style={styles.editPreviewRedPin} />
                  </View>
                  <View style={styles.editPreviewTextWrap}>
                    <Text style={styles.editPreviewValue} numberOfLines={1}>{editDestination}</Text>
                    <Text style={styles.editPreviewLabel}>DESTINATION</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>

                <View style={styles.editPreviewDivider} />

                <TouchableOpacity style={styles.editMetaRow} onPress={() => setShowEditDateModal(true)} activeOpacity={0.75}>
                  <View style={styles.editMetaLeft}>
                    <Ionicons name="calendar-outline" size={20} color={COLORS.textSecondary} />
                  </View>
                  <View style={styles.editMetaCenter}>
                    <Text style={styles.editMetaValue}>
                      {editDate ? `${editDate.getDate()}/${editDate.getMonth() + 1}/${editDate.getFullYear()}` : cardDateShort}
                    </Text>
                    <Text style={styles.editMetaLabel}>DEPARTURE DATE</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                </TouchableOpacity>

                <View style={styles.editPreviewDivider} />

                <TouchableOpacity style={styles.editMetaRow} onPress={() => setShowEditTimeModal(true)} activeOpacity={0.75}>
                  <View style={styles.editMetaLeft}>
                    <Ionicons name="time-outline" size={20} color={COLORS.textSecondary} />
                  </View>
                  <View style={styles.editMetaCenter}>
                    <Text style={styles.editMetaValue}>
                      {String(editTimeHour).padStart(2, '0')}:{String(editTimeMinute).padStart(2, '0')}
                    </Text>
                    <Text style={styles.editMetaLabel}>PREFERRED TIME</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                </TouchableOpacity>

                <View style={styles.editPreviewDivider} />

                <TouchableOpacity style={styles.editMetaRow} onPress={() => setShowEditPassengersModal(true)} activeOpacity={0.75}>
                  <View style={styles.editMetaLeft}>
                    <Ionicons name="people-outline" size={20} color={COLORS.textSecondary} />
                  </View>
                  <View style={styles.editMetaCenter}>
                    <Text style={styles.editMetaValue}>
                      {editPassengers} passenger{editPassengers !== 1 ? 's' : ''}
                    </Text>
                    <Text style={styles.editMetaLabel}>SEATING SPACE</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>

              <Text style={styles.editSheetText}>
                Tap the top handle to expand this sheet to full screen.
              </Text>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      <Modal
        visible={cancelBookingSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={closeCancelBookingSheet}
      >
        <TouchableOpacity
          style={styles.cancelBookingSheetOverlay}
          activeOpacity={1}
          onPress={closeCancelBookingSheet}
          disabled={cancellingBooking}
        >
          <View style={styles.cancelBookingSheetCard} onStartShouldSetResponder={() => true}>
            <View style={styles.cancelBookingSheetHandleArea}>
              <View style={styles.cancelBookingSheetHandle} />
            </View>
            <View style={styles.cancelBookingSheetHeader}>
              <Text style={styles.cancelBookingSheetTitle}>
                {cancelBookingSheetMode === 'request' ? 'Pending request' : 'Cancel booking'}
              </Text>
              <TouchableOpacity onPress={closeCancelBookingSheet} hitSlop={10} disabled={cancellingBooking}>
                <Ionicons name="close" size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.cancelBookingSheetSubText}>
              {cancelBookingSheetMode === 'request'
                ? `You requested ${cancelBookingMaxSeats} seat${cancelBookingMaxSeats !== 1 ? 's' : ''}. Select how many request seat${cancelBookingMaxSeats !== 1 ? 's' : ''} to cancel.`
                : `You booked ${cancelBookingMaxSeats} seat${cancelBookingMaxSeats !== 1 ? 's' : ''}. Select how many to cancel.`}
            </Text>

            <View style={styles.cancelBookingCounterRow}>
              <TouchableOpacity
                style={[
                  styles.cancelBookingCounterBtn,
                  cancelBookingSeatsToCancel <= 1 && styles.cancelBookingCounterBtnDisabled,
                ]}
                onPress={() => setCancelBookingSeatsToCancel((s) => Math.max(1, s - 1))}
                disabled={cancellingBooking || cancelBookingSeatsToCancel <= 1}
                hitSlop={8}
                activeOpacity={0.85}
              >
                <Ionicons name="remove" size={20} color={COLORS.primary} />
              </TouchableOpacity>

              <View style={styles.cancelBookingCounterValueWrap}>
                <Text style={styles.cancelBookingCounterValue}>{cancelBookingSeatsToCancel}</Text>
                <Text style={styles.cancelBookingCounterUnit}>
                  seat{cancelBookingSeatsToCancel !== 1 ? 's' : ''} to cancel
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.cancelBookingCounterBtn,
                  cancelBookingSeatsToCancel >= cancelBookingMaxSeats && styles.cancelBookingCounterBtnDisabled,
                ]}
                onPress={() => setCancelBookingSeatsToCancel((s) => Math.min(cancelBookingMaxSeats, s + 1))}
                disabled={cancellingBooking || cancelBookingSeatsToCancel >= cancelBookingMaxSeats}
                hitSlop={8}
                activeOpacity={0.85}
              >
                <Ionicons name="add" size={20} color={COLORS.primary} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.cancelBookingConfirmBtn}
              onPress={() => void confirmCancelSeats(cancelBookingSeatsToCancel)}
              disabled={cancellingBooking}
              activeOpacity={0.9}
            >
              {cancellingBooking ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <Text style={styles.cancelBookingConfirmText}>
                  {cancelBookingSheetMode === 'request' ? 'Cancel request' : 'Cancel'} {cancelBookingSeatsToCancel} seat{cancelBookingSeatsToCancel !== 1 ? 's' : ''}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBookingKeepBtn}
              onPress={closeCancelBookingSheet}
              disabled={cancellingBooking}
              activeOpacity={0.9}
            >
              <Text style={styles.cancelBookingKeepText}>Keep booking</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <DatePickerModal
        visible={showEditDateModal}
        onClose={() => setShowEditDateModal(false)}
        selectedDate={editDate}
        onSelectDate={(d) => {
          setEditDate(d);
          setShowEditDateModal(false);
        }}
      />
      <PassengersPickerModal
        visible={showEditPassengersModal}
        onClose={() => setShowEditPassengersModal(false)}
        value={editPassengers}
        onDone={(n) => setEditPassengers(Math.max(1, Math.min(4, n)))}
      />
      <Modal visible={showEditTimeModal} transparent animationType="slide" onRequestClose={() => setShowEditTimeModal(false)}>
        <TouchableOpacity style={styles.editTimeOverlay} activeOpacity={1} onPress={() => setShowEditTimeModal(false)}>
          <View style={styles.editTimeCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.editTimeTitle}>Set time</Text>
            <View style={styles.editTimeRow}>
              <TouchableOpacity style={styles.editTimeBtn} onPress={() => setEditTimeHour((h) => (h + 23) % 24)}>
                <Ionicons name="remove" size={20} color={COLORS.text} />
              </TouchableOpacity>
              <Text style={styles.editTimeValue}>{String(editTimeHour).padStart(2, '0')}</Text>
              <TouchableOpacity style={styles.editTimeBtn} onPress={() => setEditTimeHour((h) => (h + 1) % 24)}>
                <Ionicons name="add" size={20} color={COLORS.text} />
              </TouchableOpacity>
              <Text style={styles.editTimeColon}>:</Text>
              <TouchableOpacity style={styles.editTimeBtn} onPress={() => setEditTimeMinute((m) => (m + 55) % 60)}>
                <Ionicons name="remove" size={20} color={COLORS.text} />
              </TouchableOpacity>
              <Text style={styles.editTimeValue}>{String(editTimeMinute).padStart(2, '0')}</Text>
              <TouchableOpacity style={styles.editTimeBtn} onPress={() => setEditTimeMinute((m) => (m + 5) % 60)}>
                <Ionicons name="add" size={20} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.editTimeDoneBtn} onPress={() => setShowEditTimeModal(false)}>
              <Text style={styles.editTimeDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  openingDetailsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  openingDetailsText: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  headerBack: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSupport: {
    padding: 4,
  },
  headerSupportText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  detailCard: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 22,
  },
  cardDateTime: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
    flex: 1,
    paddingRight: 12,
  },
  cardRouteRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  cardRouteTimeline: {
    width: 28,
    alignItems: 'center',
    marginRight: 14,
  },
  hollowDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.white,
  },
  timelineDash: {
    width: 2,
    flex: 1,
    minHeight: 40,
    marginVertical: 6,
    backgroundColor: COLORS.border,
    borderRadius: 1,
  },
  cardRouteTextCol: {
    flex: 1,
    minWidth: 0,
  },
  cardRouteStop: {
    marginBottom: 0,
  },
  cardRouteStopSpaced: {
    marginTop: 22,
  },
  routeLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textSecondary,
    letterSpacing: 0.6,
  },
  routePlace: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 4,
  },
  routeStack: {
    width: '100%',
  },
  routeSectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 2,
  },
  timelineDashCompact: {
    width: 2,
    flex: 1,
    minHeight: 28,
    marginVertical: 4,
    backgroundColor: COLORS.border,
    borderRadius: 1,
  },
  routeLabelCompact: {
    fontSize: 9,
    fontWeight: '600',
    color: COLORS.textSecondary,
    letterSpacing: 0.5,
  },
  routePlaceCompact: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 3,
    lineHeight: 18,
  },
  cardRouteStopSpacedCompact: {
    marginTop: 14,
  },
  hollowDotSmall: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.textSecondary,
    backgroundColor: COLORS.white,
  },
  routeSubDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.borderLight,
    marginVertical: 14,
  },
  viewRouteMapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
  },
  viewRouteMapIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(41, 190, 139, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewRouteMapTextCol: {
    flex: 1,
    minWidth: 0,
  },
  viewRouteMapTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  viewRouteMapSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 18,
  },
  cardDriverRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrap: {
    position: 'relative',
    marginRight: 12,
  },
  cardDriverText: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  driverNameBold: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  driverVehicle: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textSecondary,
    marginTop: 3,
  },
  cardDriverActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 8,
  },
  ownerRowChatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(41, 190, 139, 0.1)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  ownerRowChatPillText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primary,
  },
  detailsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundSecondary,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  detailsPillText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginRight: 4,
  },
  block: {
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  paymentMethod: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  paymentSeats: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  paymentPrice: {
    fontSize: 19,
    fontWeight: '800',
    color: COLORS.primary,
  },
  passengersHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginTop: 14,
    marginBottom: 6,
  },
  seatRequestsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 6,
  },
  seatRequestsCount: {
    color: COLORS.primary,
    fontWeight: '800',
  },
  seatRequestsHeading: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.text,
  },
  seatRequestsBlock: {
    backgroundColor: COLORS.white,
    borderWidth: 0,
    borderColor: 'transparent',
  },
  seatRequestsList: {
    paddingTop: 6,
  },
  seatRequestsManageAll: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  seatRequestsManageAllBtn: {
    minHeight: 24,
    justifyContent: 'center',
    alignItems: 'flex-end',
    minWidth: 70,
  },
  seatRequestsLoadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 10,
  },
  seatRequestsLoadingText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  seatRequestCard: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    backgroundColor: COLORS.white,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  seatRequestTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  seatRequestTopLeft: {
    flex: 1,
    minWidth: 0,
  },
  seatRequestIdentityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  seatRequestIdentityText: {
    flex: 1,
    minWidth: 0,
  },
  seatRequestName: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
  },
  seatRequestMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  seatRequestMetaText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#f59e0b',
  },
  seatRequestMetaDot: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginHorizontal: 1,
  },
  seatRequestMetaTextMuted: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  seatRequestRouteWrap: {
    marginTop: 8,
    paddingLeft: 48,
    gap: 2,
  },
  seatRequestRouteLine: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 17,
    fontWeight: '500',
  },
  seatRequestSeatsBadge: {
    backgroundColor: '#eef2ff',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginLeft: 8,
  },
  seatRequestSeats: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6366f1',
  },
  seatRequestDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.borderLight,
    marginTop: 12,
    marginBottom: 10,
  },
  seatRequestActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  seatRequestApproveBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    borderRadius: 10,
    paddingVertical: 10,
  },
  seatRequestApproveText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
  },
  seatRequestRejectBtn: {
    width: 82,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: 10,
    backgroundColor: COLORS.white,
  },
  seatRequestRejectText: {
    color: COLORS.error,
    fontSize: 14,
    fontWeight: '700',
  },
  requestDetailOpeningOverlay: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  requestDetailOpeningText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  passengersList: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 12,
  },
  passengerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  passengerRowOwner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    marginHorizontal: -4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  passengerRowOwnerIcon: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passengerRowCopassenger: {
    paddingVertical: 10,
  },
  passengerRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  passengerRatingAvg: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  passengerRatingCount: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  passengerSeatsMeta: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  passengerRowOwnerText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 4,
  },
  passengerNameOwner: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  /** Owner view: explicit label when this passenger’s booking was cancelled. */
  passengerBookingCancelledLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.error,
    marginTop: 4,
  },
  passengerBookingRebookedLabel: {
    color: '#16a34a',
  },
  passengerBookingHistory: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    alignSelf: 'stretch',
  },
  passengerBookingHistoryTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  passengerBookingHistoryLine: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  passengerBookedRouteCaption: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: 0.4,
    marginTop: 6,
    textTransform: 'uppercase',
  },
  passengerRouteHint: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  passengerRowOwnerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 8,
  },
  passengerSeatsCompact: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  passengerName: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
  },
  passengerSeats: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  passengerRowCancelled: {
    opacity: 0.92,
  },
  passengerNameCancelled: {
    color: COLORS.textMuted,
  },
  passengerCaptionCancelled: {
    color: COLORS.textMuted,
  },
  passengerHintCancelled: {
    color: COLORS.textMuted,
  },
  passengerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  passengerActionBtn: {
    padding: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  passengerActionBtnChat: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  noPassengers: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  linkButton: {
    paddingVertical: 12,
    marginBottom: 4,
  },
  linkText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
  },
  actions: {
    gap: 12,
    marginTop: 8,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 10,
    marginTop: 16,
  },
  buttonEdit: {
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  buttonEditText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
  },
  buttonCancel: {
    backgroundColor: COLORS.error,
  },
  buttonCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  rebookHint: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 8,
    lineHeight: 20,
  },
  buttonBook: {
    backgroundColor: COLORS.primary,
  },
  buttonBookText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  seatPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  seatPickerLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginRight: 4,
  },
  seatPickerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  seatPickerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  seatPickerBtnDisabled: {
    opacity: 0.35,
    borderColor: COLORS.border,
  },
  seatPickerValue: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
    minWidth: 28,
    textAlign: 'center',
  },
  seatPickerHint: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginLeft: 'auto',
  },
  buttonBooked: {
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  buttonBookedText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  buttonCancelPassenger: {
    backgroundColor: COLORS.background,
    borderWidth: 2,
    borderColor: COLORS.error,
  },
  buttonCancelPassengerText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.error,
    flexShrink: 1,
    textAlign: 'center',
  },
  buttonBookingCancelled: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.28)',
  },
  buttonBookingCancelledText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.error,
  },
  buttonPendingRequest: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.32)',
  },
  buttonPendingRequestText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primary,
  },
  buttonRequestRejected: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  buttonRequestRejectedText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.error,
  },
  buttonPastEnded: {
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  buttonPastEndedText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  /** Owner cancelled — no edit/cancel; muted “done” state */
  buttonOwnerRideCancelled: {
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    opacity: 0.92,
  },
  buttonOwnerRideCancelledText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textMuted,
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
    maxHeight: '72%',
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
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginTop: 6,
  },
  ratingSubtitle: {
    marginTop: 4,
    fontSize: 15,
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
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  ratingInput: {
    minHeight: 118,
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
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
  },
  ratingSubmitBtnDisabled: {
    backgroundColor: 'rgba(34,197,94,0.45)',
  },
  ratingSubmitText: {
    fontSize: 26,
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
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  editSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  editSheetDismissArea: {
    flex: 1,
  },
  editSheetCard: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    minHeight: 380,
    maxHeight: '96%',
  },
  editSheetHandleArea: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  editSheetHandle: {
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: COLORS.border,
  },
  editSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  editSheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
  },
  editSheetBody: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
  },
  editSheetBodyScroll: {
    flex: 1,
  },
  editSheetText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginTop: 10,
  },
  editPreviewCard: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.background,
  },
  editPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
  },
  editPreviewIconCol: {
    width: 22,
    alignItems: 'center',
  },
  editPreviewGreenDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.background,
    marginTop: 2,
  },
  editPreviewDotted: {
    width: 2,
    minHeight: 14,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.border,
    borderStyle: 'dashed',
    marginVertical: 3,
  },
  editPreviewRedPin: {
    width: 10,
    height: 14,
    borderRadius: 6,
    backgroundColor: COLORS.error,
    marginTop: 2,
  },
  editPreviewTextWrap: {
    flex: 1,
    marginLeft: 10,
  },
  editPreviewValue: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  editPreviewLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginTop: 1,
  },
  editPreviewDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 8,
  },
  editMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
  },
  editMetaLeft: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editMetaCenter: {
    flex: 1,
    marginLeft: 10,
  },
  editMetaValue: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  editMetaLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.4,
  },
  editTimeOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  editTimeCard: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 22,
  },
  editTimeTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 10,
  },
  editTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  editTimeBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundSecondary,
  },
  editTimeValue: {
    minWidth: 34,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  editTimeColon: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginHorizontal: 2,
  },
  editTimeDoneBtn: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 10,
  },
  editTimeDoneText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.primary,
  },
  cancelBookingSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  cancelBookingSheetCard: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    minHeight: 240,
  },
  cancelBookingSheetHandleArea: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 10,
  },
  cancelBookingSheetHandle: {
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: COLORS.border,
  },
  cancelBookingSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  cancelBookingSheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
  },
  cancelBookingSheetSubText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 16,
    lineHeight: 20,
  },
  cancelBookingCounterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  cancelBookingCounterBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundSecondary,
  },
  cancelBookingCounterBtnDisabled: {
    opacity: 0.45,
  },
  cancelBookingCounterValueWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  cancelBookingCounterValue: {
    fontSize: 26,
    fontWeight: '900',
    color: COLORS.error,
    lineHeight: 30,
  },
  cancelBookingCounterUnit: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  cancelBookingConfirmBtn: {
    marginTop: 10,
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.error,
  },
  cancelBookingConfirmText: {
    color: COLORS.white,
    fontWeight: '900',
    fontSize: 16,
  },
  cancelBookingSheetOptions: {
    gap: 10,
  },
  cancelBookingSheetOption: {
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.45)',
    backgroundColor: 'rgba(239,68,68,0.10)',
    alignItems: 'center',
  },
  cancelBookingSheetOptionText: {
    color: COLORS.error,
    fontWeight: '800',
    fontSize: 15,
  },
  cancelBookingKeepBtn: {
    marginTop: 12,
    paddingVertical: 13,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.backgroundSecondary,
  },
  cancelBookingKeepText: {
    color: COLORS.text,
    fontWeight: '800',
    fontSize: 15,
  },
});
