import React, { useState, useCallback, useEffect, useRef } from 'react';
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
import type { RidesStackParamList, SearchStackParamList } from '../../navigation/types';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { fetchRideDetailRaw, invalidateRideDetailCache } from '../../services/rideDetailCache';
import { recordOwnerCancelledRide } from '../../services/ownerCancelledRidesStorage';
import { hasCurrentUserRatedRide, submitRideRating } from '../../services/ratings';
import { hasHandledRatingPrompt, markRatingPromptHandled } from '../../services/ratingPromptStorage';
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

type RideDetailRouteProp = RouteProp<RidesStackParamList, 'RideDetail'> | RouteProp<SearchStackParamList, 'RideDetail'>;

type BookingItem = {
  id: string;
  userId: string;
  name?: string;
  userName?: string;
  seats: number;
  status: string;
  bookedAt: string;
  pickupLocationName?: string;
  destinationLocationName?: string;
};

export default function RideDetailScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const route = useRoute<RideDetailRouteProp>();
  const { height: windowHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const fullRideBlockAlertShownRef = useRef(false);
  const { user } = useAuth();
  const { ride: initialRide, passengerSearch } = route.params;
  const [ride, setRide] = useState<RideListItem>(initialRide);
  const [cancelling, setCancelling] = useState(false);
  const [cancellingBooking, setCancellingBooking] = useState(false);
  const [booking, setBooking] = useState(false);
  const [passengers, setPassengers] = useState<BookingItem[]>(initialRide.bookings ?? []);
  const [detailLoading, setDetailLoading] = useState(true);
  const [passengerItineraryExpanded, setPassengerItineraryExpanded] = useState(false);
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
  const ratingCheckKeyRef = useRef<string | null>(null);

  // NOTE: Do not call ratings API from RideDetail for performance.
  // Ratings are fetched on the Profile/Ratings screens instead.

  const [cancelBookingSheetVisible, setCancelBookingSheetVisible] = useState(false);
  const [cancelBookingBid, setCancelBookingBid] = useState<string | null>(null);
  const [cancelBookingMaxSeats, setCancelBookingMaxSeats] = useState(1);
  const [cancelBookingSeatsToCancel, setCancelBookingSeatsToCancel] = useState(1);

  const currentUserId = (user?.id ?? '').trim();
  const currentUserName = (user?.name ?? '').trim();
  const myPassengerBooking = pickPreferredBookingForUser(passengers, currentUserId);
  const mergedBookingStatus = ride.myBookingStatus;
  const hasMergedActiveBooking =
    mergedBookingStatus != null &&
    String(mergedBookingStatus).trim() !== '' &&
    !bookingIsCancelled(mergedBookingStatus);
  /** Include merged list status so we’re not “not booked” before detail bookings[] loads. */
  const isBookedByMe = Boolean(
    (myPassengerBooking && !bookingIsCancelled(myPassengerBooking.status)) || hasMergedActiveBooking
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
  /** Whole ride pulled by driver — passenger UI must not imply *they* cancelled or offer re-book. */
  const rideCancelledByOwner = isRideCancelledByOwner(ride);
  const passengerSelfCancelledBooking = isMyBookingCancelled && !rideCancelledByOwner;

  const activePassengers = passengers.filter((b) => !bookingIsCancelled(b.status));
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
  const totalBookingsCount = getRideTotalBookingCount(ride);
  const availableSeatsCount = getRideAvailableSeats(ride);

  const publishedPickupStr = ride.pickupLocationName ?? ride.from ?? 'Pickup';
  const publishedDestStr = ride.destinationLocationName ?? ride.to ?? 'Destination';

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

  const passengersWithDifferentStops = activePassengers.filter((b) =>
    bookingDiffersFromPublishedRide(ride, b)
  );
  const ownerShowPassengerItineraryToggle =
    isOwner &&
    activePassengers.length > 0 &&
    (passengersWithDifferentStops.length > 0 || activePassengers.length > 1);

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
  const bookedSeats = activePassengers.reduce((sum, b) => sum + (b.seats ?? 0), 0);
  // Passenger UI should show "X seats booked" (not just "seats left").
  // Active only (exclude cancelled bookings) and sum seat counts for the current viewer.
  const viewerBookedSeats = passengers.reduce((sum, b) => {
    const uid = (b.userId ?? '').trim();
    if (!uid || uid !== currentUserId) return sum;
    if (bookingIsCancelled(b.status)) return sum;
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
  const cardAvatarLetter = (
    isOwner
      ? (currentUserName || user?.name || 'Y').trim().charAt(0) || 'Y'
      : driverName.charAt(0)
  ).toUpperCase();
  const firstPassenger = activePassengers[0] ?? passengers[0];
  const chatOtherUserName = isOwner
    ? (firstPassenger ? bookingPassengerDisplayName(firstPassenger, 'Rider') : 'Rider')
    : driverName;
  const chatOtherUserId = isOwner ? firstPassenger?.userId : ride.userId;
  const priceDisplay = formatRidePrice(ride);

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
    isOwner
      ? bookedSeats
      : myPassengerBooking && !bookingIsCancelled(myPassengerBooking.status)
        ? myPassengerBooking.seats ?? 0
        : 0;
  const seatPriceNumber = parseSeatPriceNumber(ride);
  const totalBookedPriceText =
    seatPriceNumber != null && pricingSeats > 0 ? formatRupees(seatPriceNumber * pricingSeats) : null;
  const rideDetailRatingPromptEnabled = false;
  const ratingTargetUserId = (() => {
    if (!currentUserId) return '';
    if (isOwner) {
      const firstOther = passengers.find((b) => (b.userId ?? '').trim() && (b.userId ?? '').trim() !== currentUserId);
      return (firstOther?.userId ?? '').trim();
    }
    return (ride.userId ?? '').trim();
  })();

  const fetchRideDetail = useCallback(async (opts?: { force?: boolean }) => {
    setDetailLoading(true);
    try {
      const res = await fetchRideDetailRaw(initialRide.id, {
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
        const list = Array.isArray(candidate.bookings) ? (candidate.bookings as BookingItem[]) : [];
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
          const next = {
            ...prev,
            ...candidate,
            ...(mergedPrice != null && String(mergedPrice).trim() !== ''
              ? { price: String(mergedPrice) }
              : {}),
            bookings: list,
          } as RideListItem;
          const mine = list.filter((b) => (b.userId ?? '').trim() === currentUserId);
          if (mine.length > 0) {
            next.myBookingStatus = pickPreferredBookingStatus(mine.map((b) => b.status ?? ''));
          } else {
            // Avoid carrying stale local state if the server doesn't include this viewer's booking rows.
            // We only trust server-provided `myBookingStatus` when present; otherwise clear it.
            const mergedStatus = (candidate as RideListItem).myBookingStatus;
            next.myBookingStatus = mergedStatus !== undefined ? mergedStatus : '';
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
          return next;
        });
      }
    } catch {
      // keep list params; UI may be slightly stale
    } finally {
      setDetailLoading(false);
    }
  }, [initialRide.id, currentUserId]);

  useEffect(() => {
    void fetchRideDetail({ force: true });
  }, [fetchRideDetail]);

  // Ensure edited values are shown immediately after returning from EditRide.
  useFocusEffect(
    useCallback(() => {
      // Hide bottom tabs while this screen is focused.
      const parentNav = (navigation as any)?.getParent?.();
      parentNav?.setOptions?.({ tabBarStyle: { display: 'none' } });

      void fetchRideDetail({ force: true });
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
    }, [fetchRideDetail, navigation])
  );

  // Ratings are intentionally not fetched here.

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
  }, [initialRide.id]);

  useEffect(() => {
    if (!rideDetailRatingPromptEnabled) return;
    if (detailLoading) return;
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
        const alreadyRated = await hasCurrentUserRatedRide(ride.id, currentUserId);
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
  }, [detailLoading, rideIsCompleted, ride.id, currentUserId, ratingTargetUserId, rideDetailRatingPromptEnabled]);

  /** Non-owners cannot view full rides unless they already have a booking (e.g. deep link). */
  useEffect(() => {
    if (detailLoading) return;
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
  }, [detailLoading, ride, isBookedByMe, isOwner, navigation]);

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

  const handleBook = async () => {
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
      // Let the Book button finish its press animation, then transition without jank.
      await new Promise<void>((resolve) => {
        InteractionManager.runAfterInteractions(() => resolve());
      });
      await new Promise<void>((r) => setTimeout(r, Platform.OS === 'android' ? 90 : 120));
      resetTabsToYourRidesAfterBook(navigation);
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
    setCancelBookingSheetVisible(true);
  };

  const closeCancelBookingSheet = useCallback(() => {
    if (cancellingBooking) return;
    setCancelBookingSheetVisible(false);
    setCancelBookingBid(null);
    setCancelBookingMaxSeats(1);
    setCancelBookingSeatsToCancel(1);
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
      setRatingSubmitted(true);
      setShowRatingModal(false);
      Alert.alert('Thanks for your feedback');
    } catch (e: unknown) {
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

      {detailLoading ? (
        <View style={styles.detailLoader}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.detailLoaderText}>Loading ride…</Text>
        </View>
      ) : (
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

          {ownerShowPassengerItineraryToggle ? (
            <View style={styles.passengerItineraryWrap}>
              <TouchableOpacity
                style={styles.passengerItineraryToggle}
                onPress={() => setPassengerItineraryExpanded((e) => !e)}
                activeOpacity={0.72}
              >
                <View style={styles.passengerItineraryToggleTextCol}>
                  <Text style={styles.passengerItineraryToggleTitle}>Passenger itineraries</Text>
                  <Text style={styles.passengerItineraryToggleSub} numberOfLines={2}>
                    {passengersWithDifferentStops.length > 0
                      ? `${passengersWithDifferentStops.length} with different stops · ${activePassengers.length} total`
                      : `${activePassengers.length} passenger${activePassengers.length !== 1 ? 's' : ''} — tap to expand`}
                  </Text>
                </View>
                <Ionicons
                  name={passengerItineraryExpanded ? 'chevron-up' : 'chevron-down'}
                  size={22}
                  color={COLORS.textSecondary}
                />
              </TouchableOpacity>
              {passengerItineraryExpanded ? (
                <View style={styles.passengerItineraryList}>
                  {activePassengers.map((b) => {
                    const name = (b.userId ?? '').trim() === currentUserId
                      ? currentUserName || 'You'
                      : bookingPassengerDisplayName(b);
                    const { pickup, drop } = bookingPickupDrop(ride, b);
                    const differs = bookingDiffersFromPublishedRide(ride, b);
                    return (
                      <View key={b.id} style={styles.passengerItinCard}>
                        <Text style={styles.passengerItinName} numberOfLines={1}>
                          {name} · {b.seats} seat{b.seats !== 1 ? 's' : ''}
                        </Text>
                        {differs ? (
                          <View style={styles.passengerItinStops}>
                            <Text style={styles.passengerItinLine} numberOfLines={3}>
                              {pickup}
                            </Text>
                            <Ionicons name="arrow-down" size={14} color={COLORS.textMuted} style={styles.passengerItinArrowIcon} />
                            <Text style={styles.passengerItinLine} numberOfLines={3}>
                              {drop}
                            </Text>
                          </View>
                        ) : (
                          <Text style={styles.passengerItinSame}>Same route as your published ride</Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.cardDivider} />

          <View style={styles.cardDriverRow}>
            <View style={styles.avatarWrap}>
              <View style={styles.driverAvatar}>
                <Text style={styles.driverAvatarText}>{cardAvatarLetter}</Text>
              </View>
              <View style={styles.avatarStatusDot} />
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
                  });
                }}
                activeOpacity={0.75}
              >
                <Text style={styles.detailsPillText}>Details</Text>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>

          {false ? (
            <View style={styles.cardQuickActions}>
              <TouchableOpacity style={styles.driverActionBtn} onPress={() => {}} activeOpacity={0.7}>
                <Ionicons name="call-outline" size={22} color={COLORS.text} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.driverActionBtn, styles.driverActionBtnChat]}
                onPress={() =>
                  (navigation as any).navigate('Chat', {
                    ride,
                    otherUserName: chatOtherUserName,
                    otherUserId: chatOtherUserId,
                  })
                }
                activeOpacity={0.7}
              >
                <Ionicons name="chatbubble-outline" size={20} color={COLORS.white} />
              </TouchableOpacity>
            </View>
          ) : null}
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

        {/* Passengers — include cancelled rows (status from API / cascade). */}
        <View style={styles.block}>
          <Text style={styles.passengersHeading}>Passengers</Text>
          {passengersForDisplay.length > 0 ? (
            <View style={styles.passengersList}>
              {passengersForDisplay.map((b) => {
                const isMe = (b.userId ?? '').trim() === currentUserId;
                const displayName = isMe ? (currentUserName || 'You') : bookingPassengerDisplayName(b);
                const bookingCancelled = bookingIsCancelled(b.status);
                const isRebooked =
                  !bookingCancelled &&
                  !isPastRide &&
                  cancelledPassengerUserIds.has((b.userId ?? '').trim()) &&
                  activePassengerUserIds.has((b.userId ?? '').trim());
                const shouldFadeCancelled = bookingCancelled && !isRebooked;

                if (isOwner) {
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
                      key={b.id}
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
                        <Ionicons
                          name="person-outline"
                          size={20}
                          color={shouldFadeCancelled ? COLORS.textMuted : COLORS.textSecondary}
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
                      </View>
                      <View style={styles.passengerRowOwnerRight}>
                        <Text style={styles.passengerSeatsCompact}>
                          {b.seats} seat{b.seats !== 1 ? 's' : ''}
                        </Text>
                        <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                      </View>
                    </TouchableOpacity>
                  );
                }

                // Co-passengers: names & seats only; chat/call per passenger is owner-only (BookPassengerDetail).
                return (
                  <View
                    key={b.id}
                    style={[styles.passengerRow, shouldFadeCancelled && styles.passengerRowCancelled]}
                  >
                    <Ionicons
                      name="person-outline"
                      size={18}
                      color={shouldFadeCancelled ? COLORS.textMuted : COLORS.textSecondary}
                    />
                    <Text
                      style={[styles.passengerName, shouldFadeCancelled && styles.passengerNameCancelled]}
                    >
                      {displayName}
                    </Text>
                    <Text
                      style={[styles.passengerSeats, shouldFadeCancelled && styles.passengerNameCancelled]}
                    >
                      {b.seats} seat{b.seats !== 1 ? 's' : ''}
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
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.noPassengers}>No other passengers yet</Text>
          )}
        </View>

        {/* Actions — past rides: no calendar / offer links; owner: no edit or cancel */}
        {!isPastRide && (!isBookedByMe || isOwner) && !isOwnerRideCancelled ? (
          <>
            <TouchableOpacity style={styles.linkButton} onPress={() => {}}>
              <Text style={styles.linkText}>Add to calendar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkButton} onPress={() => {}}>
              <Text style={styles.linkText}>See ride offer</Text>
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
              onPress={handleBook}
              disabled={booking || availableSeatsCount <= 0}
              activeOpacity={0.8}
            >
              {booking ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="book-outline" size={22} color="#fff" />
                  <Text style={styles.buttonBookText}>
                    {passengerSelfCancelledBooking ? 'Book again' : bookSeatsCount > 1 ? 'Book seats' : 'Book'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
      )}
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
              <Text style={styles.cancelBookingSheetTitle}>Cancel booking</Text>
              <TouchableOpacity onPress={closeCancelBookingSheet} hitSlop={10} disabled={cancellingBooking}>
                <Ionicons name="close" size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.cancelBookingSheetSubText}>
              {`You booked ${cancelBookingMaxSeats} seat${cancelBookingMaxSeats !== 1 ? 's' : ''}. Select how many to cancel.`}
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
                  Cancel {cancelBookingSeatsToCancel} seat{cancelBookingSeatsToCancel !== 1 ? 's' : ''}
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
  detailLoader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  detailLoaderText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.textSecondary,
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
  passengerItineraryWrap: {
    marginTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
    paddingTop: 14,
  },
  passengerItineraryToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: 10,
  },
  passengerItineraryToggleTextCol: {
    flex: 1,
    minWidth: 0,
  },
  passengerItineraryToggleTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  passengerItineraryToggleSub: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
    lineHeight: 16,
  },
  passengerItineraryList: {
    marginTop: 12,
  },
  passengerItinCard: {
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    marginBottom: 10,
  },
  passengerItinName: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  passengerItinStops: {
    gap: 2,
  },
  passengerItinLine: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textSecondary,
    lineHeight: 16,
  },
  passengerItinArrowIcon: {
    marginVertical: 2,
    marginLeft: 2,
  },
  passengerItinSame: {
    fontSize: 12,
    fontStyle: 'italic',
    color: COLORS.textMuted,
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
  avatarStatusDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.warning,
    borderWidth: 2,
    borderColor: COLORS.background,
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
  cardQuickActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
    gap: 10,
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
  driverAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverAvatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.white,
  },
  driverActionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverActionBtnChat: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  passengersHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginTop: 14,
    marginBottom: 6,
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
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
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
    color: COLORS.textMuted,
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
