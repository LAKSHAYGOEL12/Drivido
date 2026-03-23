import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform,
  InteractionManager,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { resetTabsToYourRidesAfterBook } from '../../navigation/navigateAfterBook';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RidesStackParamList, SearchStackParamList } from '../../navigation/types';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { fetchRideDetailRaw, invalidateRideDetailCache } from '../../services/rideDetailCache';
import { recordOwnerCancelledRide } from '../../services/ownerCancelledRidesStorage';
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
  /** Passenger booking: number of seats to request (capped by fresh getRideAvailableSeats). */
  const [bookSeatsCount, setBookSeatsCount] = useState(1);

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
  const isPastRide = isRidePastArrivalWindow(ride);
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
            const mergedStatus = (candidate as RideListItem).myBookingStatus ?? prev.myBookingStatus;
            if (mergedStatus !== undefined) next.myBookingStatus = mergedStatus;
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

  useEffect(() => {
    setBookSeatsCount(1);
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
    Alert.alert('Edit ride', 'Edit ride details will be available soon.');
  };

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
    Alert.alert(
      'Cancel booking',
      'Are you sure you want to cancel your seat on this ride?',
      [
        { text: 'Keep booking', style: 'cancel' },
        {
          text: 'Cancel',
          style: 'destructive',
          onPress: async () => {
            setCancellingBooking(true);
            try {
              await api.delete(API.endpoints.bookings.cancel(bid));
              setRide((prev) => ({ ...prev, myBookingStatus: 'cancelled' }));
              await fetchRideDetail({ force: true });
              Alert.alert('Cancelled', 'Your booking was cancelled. You can find it under Past rides.', [
                { text: 'OK', onPress: () => navigation.goBack() },
              ]);
            } catch (e: unknown) {
              const message =
                e && typeof e === 'object' && 'message' in e
                  ? String((e as { message: unknown }).message)
                  : 'Could not cancel booking.';
              Alert.alert('Error', message);
            } finally {
              setCancellingBooking(false);
            }
          },
        },
      ]
    );
  };

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
                onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}
                activeOpacity={0.75}
              >
                <Text style={styles.detailsPillText}>Details</Text>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>

          {!isOwner ? (
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
                  ? getRideAvailabilityShort(ride) || '—'
                  : bookedSeats > 0
                    ? `${bookedSeats} seat${bookedSeats !== 1 ? 's' : ''} booked · ${availableSeatsCount} left`
                    : totalBookingsCount > 0
                      ? `Cancelled · ${totalBookingsCount} passenger${totalBookingsCount !== 1 ? 's' : ''}`
                      : getRideAvailabilityShort(ride) ||
                        `${totalSeats} seat${totalSeats !== 1 ? 's' : ''} offered`}
              </Text>
            </View>
            <Text style={styles.paymentPrice}>{priceDisplay !== '—' ? priceDisplay : '₹—'}</Text>
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
});
