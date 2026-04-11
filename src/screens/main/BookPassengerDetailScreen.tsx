import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  InteractionManager,
  Linking,
  Platform,
} from 'react-native';
import { Alert } from '../../utils/themedAlert';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { RidesStackParamList, SearchStackParamList } from '../../navigation/types';
import { COLORS } from '../../constants/colors';
import { formatRidePriceParts, pickPassengerPhoneFromBooking } from '../../utils/rideDisplay';
import { bookingPickupDrop } from '../../utils/bookingRoutePreview';
import { bookingPassengerDisplayName } from '../../utils/displayNames';
import api from '../../services/api';
import { API } from '../../constants/API';
import { getUserRatingsSummary } from '../../services/ratings';
import UserAvatar from '../../components/common/UserAvatar';
import { BookingHistoryTimeline } from '../../components/common/BookingHistoryTimeline';
import { calculateAge } from '../../utils/calculateAge';
import { buildBookingHistoryTimelineItems } from '../../utils/bookingHistoryDisplay';
import { findMainTabNavigatorWithOptions } from '../../navigation/findMainTabNavigator';

type BookPassengerRouteProp =
  | RouteProp<RidesStackParamList, 'BookPassengerDetail'>
  | RouteProp<SearchStackParamList, 'BookPassengerDetail'>;

export default function BookPassengerDetailScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const route = useRoute<BookPassengerRouteProp>();
  const { ride, booking, requestMode, ownerBookingHistoryLines } = route.params;
  const insets = useSafeAreaInsets();

  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [ratingLoading, setRatingLoading] = useState(false);
  const [passengerPhoneFromApi, setPassengerPhoneFromApi] = useState('');
  const [requestActionLoading, setRequestActionLoading] = useState<'approve' | 'reject' | null>(null);

  useFocusEffect(
    useCallback(() => {
      const tabsNav = findMainTabNavigatorWithOptions(navigation as { getParent?: () => unknown });
      tabsNav?.setOptions?.({ tabBarStyle: { display: 'none' } });
      return () => {
        setTimeout(() => {
          try {
            const tabState = tabsNav?.getState?.();
            const activeTabRoute = tabState?.routes?.[tabState?.index ?? 0] as
              | { state?: { routes?: { name?: string }[]; index?: number } }
              | undefined;
            const nestedState = activeTabRoute?.state;
            const nestedName = nestedState?.routes?.[nestedState?.index ?? 0]?.name;
            const hideTabsOn = new Set([
              'RideDetail',
              'RideDetailScreen',
              'BookPassengerDetail',
              'Chat',
              'OwnerProfileModal',
              'OwnerRatingsModal',
            ]);
            if (!nestedName || !hideTabsOn.has(nestedName)) {
              tabsNav?.setOptions?.({ tabBarStyle: undefined });
            }
          } catch {
            tabsNav?.setOptions?.({ tabBarStyle: undefined });
          }
        }, 120);
      };
    }, [navigation])
  );

  const passengerName = bookingPassengerDisplayName(booking);
  const passengerId = booking.userId ?? '';

  const passengerListSegmentScope = useMemo(() => {
    const ext = booking as { passenger_list_segment_id?: string };
    return String(booking.passengerListSegmentId ?? ext.passenger_list_segment_id ?? '').trim();
  }, [booking]);

  /** Structured timeline: nav lines from ride detail merge, else embedded `booking.bookingHistory`. */
  const bookingHistoryItems = useMemo(
    () =>
      buildBookingHistoryTimelineItems({
        ownerBookingHistoryLines,
        embedded: booking.bookingHistory,
        scopeToPassengerListSegmentId: passengerListSegmentScope,
        scopeEmbeddedSnapshotsAfterBookedAt: booking.bookedAt,
      }),
    [ownerBookingHistoryLines, booking.bookingHistory, passengerListSegmentScope, booking.bookedAt]
  );
  const passengerAge = calculateAge(booking.dateOfBirth);
  const { pickup, drop } = bookingPickupDrop(ride, booking);
  /** Owner ride detail uses published stops; match that on confirmed passenger detail. */
  const publishedPickupStr = useMemo(
    () => ride.pickupLocationName?.trim() || ride.from?.trim() || 'Pickup',
    [ride.pickupLocationName, ride.from]
  );
  const publishedDestStr = useMemo(
    () => ride.destinationLocationName?.trim() || ride.to?.trim() || 'Destination',
    [ride.destinationLocationName, ride.to]
  );
  const priceParts = formatRidePriceParts(ride);
  const isRequestDetail = Boolean(requestMode) || String(booking.status ?? '').trim().toLowerCase() === 'pending';
  const [requestScreenLoading, setRequestScreenLoading] = useState(isRequestDetail);
  const passengerAvatarUrl = booking.avatarUrl?.trim();
  const totalPriceText = useMemo(() => {
    const raw = String(ride.price ?? '').replace(/[₹$,]/g, '').trim();
    const pricePerSeat = Number(raw);
    if (!Number.isFinite(pricePerSeat) || pricePerSeat <= 0) return '—';
    const total = Math.round(pricePerSeat * Math.max(1, booking.seats) * 100) / 100;
    return `₹${Number.isInteger(total) ? total : total.toFixed(2)}`;
  }, [ride.price, booking.seats]);

  useEffect(() => {
    if (!isRequestDetail) {
      setRequestScreenLoading(false);
      return;
    }
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        if (!cancelled) setRequestScreenLoading(false);
      }, 180);
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [isRequestDetail]);

  useEffect(() => {
    const uid = passengerId.trim();
    if (!uid) return;
    let cancelled = false;
    setRatingLoading(true);
    setPassengerPhoneFromApi('');
    void (async () => {
      try {
        const summary = await getUserRatingsSummary(uid);
        if (cancelled) return;
        setAvgRating(summary.avgRating > 0 ? Number(summary.avgRating.toFixed(1)) : null);
        setRatingCount(summary.totalRatings);
        setPassengerPhoneFromApi((summary.subjectContactPhone ?? '').trim());
      } catch {
        if (!cancelled) {
          setAvgRating(null);
          setRatingCount(0);
          setPassengerPhoneFromApi('');
        }
      } finally {
        if (!cancelled) setRatingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [passengerId]);

  const openChat = () => {
    const rideId = String(ride?.id ?? '').trim();
    if (!rideId) {
      Alert.alert('Chat', 'Ride information is missing. Go back and open this passenger again.');
      return;
    }
    if (!passengerId.trim()) {
      Alert.alert('Chat', 'Passenger information is missing.');
      return;
    }
    (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate('Chat', {
      rideId,
      ...(ride ? { ride } : {}),
      otherUserName: passengerName || 'Passenger',
      otherUserId: passengerId,
      ...(passengerAvatarUrl ? { otherUserAvatarUrl: passengerAvatarUrl } : {}),
    });
  };

  const dialPhone =
    pickPassengerPhoneFromBooking(booking) || passengerPhoneFromApi.trim();

  const openCall = useCallback(async () => {
    const cleaned = dialPhone.replace(/[^\d+]/g, '');
    if (!cleaned) {
      Alert.alert(
        'No phone number',
        "This passenger's phone is not available yet. It may appear after your backend includes it on the booking or profile for ride owners."
      );
      return;
    }
    const url = `tel:${cleaned}`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        'Cannot open dialer',
        'Try on a physical phone. Simulators and some tablets do not support phone calls.'
      );
    }
  }, [dialPhone]);

  const openPassengerRatings = () => {
    const targetUserId = passengerId.trim();
    if (!targetUserId) {
      Alert.alert('Ratings', 'Passenger ratings are not available yet.');
      return;
    }
    (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate('OwnerRatingsModal', {
      userId: targetUserId,
      displayName: passengerName,
      ...(passengerAvatarUrl ? { avatarUrl: passengerAvatarUrl } : {}),
    });
  };

  const handleRequestAction = useCallback(
    async (action: 'approve' | 'reject') => {
      const bookingId = String(booking.id ?? '').trim();
      if (!bookingId) {
        Alert.alert('Request', 'Booking request id is missing.');
        return;
      }
      setRequestActionLoading(action);
      try {
        if (action === 'approve') {
          await api.patch(API.endpoints.bookings.approve(bookingId));
        } else {
          await api.patch(API.endpoints.bookings.reject(bookingId));
        }
        navigation.goBack();
      } catch (e: unknown) {
        const message =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: unknown }).message)
            : action === 'approve'
              ? 'Could not approve this request.'
              : 'Could not reject this request.';
        Alert.alert('Error', message);
      } finally {
        setRequestActionLoading(null);
      }
    },
    [booking.id, navigation]
  );

  if (isRequestDetail && requestScreenLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.requestFullScreenLoader}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={styles.requestLoaderText}>Loading request...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, isRequestDetail && styles.safeRequest]} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerSide}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBack} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
        <View style={styles.headerTitleCol}>
          <Text style={styles.headerTitle}>{isRequestDetail ? 'Seat request' : 'Passenger'}</Text>
          {isRequestDetail ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {ride.pickupLocationName?.trim() || ride.from?.trim() || 'Ride'} →{' '}
              {ride.destinationLocationName?.trim() || ride.to?.trim() || 'Destination'}
            </Text>
          ) : null}
        </View>
        <View style={styles.headerSide} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, isRequestDetail && styles.scrollContentRequest]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {isRequestDetail ? (
          <>
            <View style={styles.requestStatusPill}>
              <Ionicons name="hourglass-outline" size={16} color="#b45309" />
              <Text style={styles.requestStatusPillText}>Waiting for you to approve or decline</Text>
            </View>

            <View style={styles.requestHeroCard}>
              <View style={styles.requestHeroAvatarBlock}>
                <View style={styles.requestHeroAvatarRing}>
                  <UserAvatar
                    uri={passengerAvatarUrl}
                    name={passengerName}
                    size={80}
                    backgroundColor={COLORS.primary}
                    fallbackTextColor={COLORS.white}
                  />
                </View>
                {passengerAge !== null ? (
                  <View style={styles.requestAgeChip}>
                    <Text style={styles.requestAgeChipText}>{passengerAge}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.requestHeroName} numberOfLines={2}>
                {passengerName}
              </Text>
              <TouchableOpacity
                style={styles.requestRatingChip}
                onPress={openPassengerRatings}
                activeOpacity={0.75}
              >
                <Ionicons name="star" size={14} color={COLORS.warning} />
                {ratingLoading ? (
                  <Text style={styles.requestRatingChipText}>Loading…</Text>
                ) : (
                  <Text style={styles.requestRatingChipText}>
                    {avgRating != null ? `${avgRating.toFixed(1)} rating` : 'View ratings'}
                    {ratingCount > 0 ? ` · ${ratingCount} reviews` : ''}
                  </Text>
                )}
                <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.requestSectionCard}>
              <Text style={styles.requestSectionTitle}>Requested route</Text>
              <View style={styles.requestRouteTimeline}>
                <View style={styles.requestRouteTimelineRail}>
                  <View style={[styles.requestRouteDot, styles.requestRouteDotPickup]} />
                  <View style={styles.requestRouteDash} />
                  <View style={[styles.requestRouteDot, styles.requestRouteDotDrop]} />
                </View>
                <View style={styles.requestRouteTimelineBody}>
                  <View>
                    <Text style={styles.requestRouteKind}>Pickup</Text>
                    <Text style={styles.requestRouteLine}>{pickup}</Text>
                  </View>
                  <View style={styles.requestRouteStopGap}>
                    <Text style={styles.requestRouteKind}>Drop-off</Text>
                    <Text style={styles.requestRouteLine}>{drop}</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.requestSummaryRow}>
              <View style={styles.requestSummaryCard}>
                <View style={styles.requestSummaryIconCircle}>
                  <Ionicons name="people-outline" size={18} color={COLORS.primary} />
                </View>
                <Text style={styles.requestSummaryLabel}>Seats</Text>
                <Text style={styles.requestSummaryValue}>
                  {booking.seats} {booking.seats === 1 ? 'passenger' : 'passengers'}
                </Text>
              </View>
              <View style={styles.requestSummaryCard}>
                <View style={[styles.requestSummaryIconCircle, styles.requestSummaryIconCircleMuted]}>
                  <Ionicons name="wallet-outline" size={18} color="#c2410c" />
                </View>
                <Text style={styles.requestSummaryLabel}>If approved</Text>
                <Text style={styles.requestSummaryValue}>{totalPriceText}</Text>
              </View>
            </View>
          </>
        ) : (
          <>
        <TouchableOpacity style={styles.profileRow} activeOpacity={0.75} onPress={openPassengerRatings}>
          <View style={styles.avatarWrap}>
            <UserAvatar
              uri={passengerAvatarUrl}
              name={passengerName}
              size={72}
              backgroundColor={COLORS.primary}
              fallbackTextColor={COLORS.white}
            />
            {passengerAge !== null ? (
              <View style={styles.ageBadge}>
                <Text style={styles.ageBadgeText}>{passengerAge}y</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.profileTextCol}>
            <Text style={styles.profileName}>{passengerName}</Text>
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={16} color={COLORS.warning} />
              <Text style={styles.ratingText}>View ratings</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={22} color={COLORS.textMuted} />
        </TouchableOpacity>

        <View style={styles.trustBlock}>
          <View style={styles.trustRow}>
            <Ionicons name="shield-checkmark" size={22} color={COLORS.primary} />
            <View style={styles.trustTextCol}>
              <Text style={styles.trustTitle}>Verified profile</Text>
              <Text style={styles.trustSub}>ID, email and phone verified when available</Text>
            </View>
          </View>
          <View style={[styles.trustRow, styles.trustRowSecond]}>
            <Ionicons name="list-outline" size={22} color={COLORS.textSecondary} />
            <View style={styles.trustTextCol}>
              <Text style={styles.trustTitle}>Booking activity</Text>
              <Text style={styles.trustSub}>
                Bookings and cancellations initiated by the passenger on this ride.
              </Text>
              {bookingHistoryItems.length > 0 ? (
                <BookingHistoryTimeline items={bookingHistoryItems} />
              ) : (
                <Text style={[styles.trustSub, styles.bookingActivityEmpty]}>Nothing to show yet.</Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.requestRouteCard}>
          <Text style={styles.requestRouteLabel}>PICKUP</Text>
          <Text style={styles.requestRouteValue}>{publishedPickupStr}</Text>
          <Text style={[styles.requestRouteLabel, styles.requestRouteLabelGap]}>DROP-OFF</Text>
          <Text style={styles.requestRouteValue}>{publishedDestStr}</Text>
        </View>

        <View style={styles.routeCard}>
          <View style={styles.routeCardInner}>
            <View style={styles.routeCardLeft}>
              <Text style={[styles.routeSeatBold, styles.routeSeatBoldNoPath]}>
                {booking.seats} seat{booking.seats !== 1 ? 's' : ''}
              </Text>
            </View>
            <View style={styles.routeCardRight}>
              {priceParts ? (
                <View style={styles.pricePartsWrap}>
                  <Text style={styles.priceRupee}>{priceParts.rupee}</Text>
                  <Text style={styles.priceInteger}>{priceParts.integerPart}</Text>
                </View>
              ) : (
                <Text style={styles.priceInteger}>—</Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.actionRow}
          onPress={openChat}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Chat with passenger"
        >
          <Ionicons name="chatbubble-ellipses-outline" size={22} color={COLORS.primary} />
          <Text style={styles.actionRowText}>Chat</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionRow} onPress={openCall} activeOpacity={0.7}>
          <Ionicons name="call-outline" size={22} color={COLORS.primary} />
          <Text style={styles.actionRowText}>Call</Text>
        </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {isRequestDetail ? (
        <View
          style={[
            styles.requestFooter,
            { paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          <View style={styles.requestActionsRow}>
            <TouchableOpacity
              style={styles.requestRejectBtn}
              onPress={() => void handleRequestAction('reject')}
              activeOpacity={0.85}
              disabled={requestActionLoading != null}
            >
              {requestActionLoading === 'reject' ? (
                <ActivityIndicator size="small" color={COLORS.error} />
              ) : (
                <>
                  <Ionicons name="close-circle-outline" size={20} color={COLORS.error} />
                  <Text style={styles.requestRejectText}>Decline</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.requestApproveBtn}
              onPress={() => void handleRequestAction('approve')}
              activeOpacity={0.85}
              disabled={requestActionLoading != null}
            >
              {requestActionLoading === 'approve' ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color={COLORS.white} />
                  <Text style={styles.requestApproveText}>Approve</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.requestFooterChat}
            onPress={openChat}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Message passenger"
          >
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={COLORS.primary} />
            <Text style={styles.requestFooterChatText}>Message passenger</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  safeRequest: {
    backgroundColor: COLORS.backgroundSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  headerSide: {
    width: 40,
    justifyContent: 'center',
  },
  headerBack: {
    padding: 4,
  },
  headerTitleCol: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginTop: 2,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 24,
  },
  scrollContentRequest: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  requestFullScreenLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.background,
  },
  requestLoaderText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  requestStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    marginBottom: 16,
  },
  requestStatusPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400e',
    flexShrink: 1,
  },
  requestHeroCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 20,
    paddingHorizontal: 16,
    marginBottom: 12,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 12,
      },
      android: { elevation: 2 },
    }),
  },
  requestHeroAvatarBlock: {
    position: 'relative',
    marginBottom: 12,
  },
  requestHeroAvatarRing: {
    borderRadius: 48,
    padding: 3,
    borderWidth: 2,
    borderColor: 'rgba(41, 190, 139, 0.35)',
    backgroundColor: COLORS.white,
  },
  requestAgeChip: {
    position: 'absolute',
    right: -4,
    bottom: 2,
    minWidth: 28,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: COLORS.text,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  requestAgeChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.white,
  },
  requestHeroName: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 10,
    paddingHorizontal: 8,
  },
  requestRatingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignSelf: 'stretch',
    marginHorizontal: 4,
  },
  requestRatingChipText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  requestSectionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 16,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 8,
      },
      android: { elevation: 1 },
    }),
  },
  requestSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  requestRouteTimeline: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  requestRouteTimelineRail: {
    width: 14,
    alignItems: 'center',
    alignSelf: 'stretch',
    marginRight: 12,
    paddingTop: 4,
  },
  requestRouteDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    backgroundColor: COLORS.white,
  },
  requestRouteDotPickup: {
    borderColor: COLORS.primary,
  },
  requestRouteDotDrop: {
    borderColor: COLORS.error,
  },
  requestRouteDash: {
    width: 2,
    flex: 1,
    minHeight: 20,
    marginVertical: 4,
    backgroundColor: COLORS.border,
    borderRadius: 1,
  },
  requestRouteTimelineBody: {
    flex: 1,
    minWidth: 0,
  },
  requestRouteKind: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  requestRouteLine: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 21,
  },
  requestRouteStopGap: {
    marginTop: 16,
  },
  requestSummaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  requestSummaryCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'flex-start',
  },
  requestSummaryIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(41, 190, 139, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  requestSummaryIconCircleMuted: {
    backgroundColor: 'rgba(234, 88, 12, 0.12)',
  },
  requestSummaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  requestSummaryValue: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.text,
    lineHeight: 22,
  },
  requestFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
    paddingHorizontal: 16,
    paddingTop: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: { elevation: 8 },
    }),
  },
  requestActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  requestRejectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
    paddingVertical: 14,
    minHeight: 50,
  },
  requestRejectText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  requestApproveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    minHeight: 50,
    ...Platform.select({
      ios: {
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.28,
        shadowRadius: 8,
      },
      android: { elevation: 3 },
    }),
  },
  requestApproveText: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.white,
  },
  requestFooterChat: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 4,
  },
  requestFooterChatText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primary,
  },
  requestRouteCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.white,
    padding: 12,
    marginBottom: 12,
  },
  requestRouteLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.4,
  },
  requestRouteLabelGap: {
    marginTop: 12,
  },
  requestRouteValue: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 4,
    lineHeight: 21,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarWrap: {
    position: 'relative',
    marginRight: 14,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: COLORS.white,
    backgroundColor: COLORS.white,
    padding: 2,
  },
  ageBadge: {
    position: 'absolute',
    right: -22,
    bottom: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  ageBadgeText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  profileTextCol: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    marginLeft: 10,
  },
  ratingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  trustBlock: {
    marginBottom: 8,
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  trustRowSecond: {
    marginTop: 16,
  },
  trustTextCol: {
    flex: 1,
  },
  trustTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  trustSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
    lineHeight: 18,
  },
  bookingActivityEmpty: {
    marginTop: 8,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 20,
  },
  routeCard: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  routeCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 64,
  },
  routeCardLeft: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  routeSeatBold: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 10,
  },
  routeSeatBoldNoPath: {
    marginBottom: 0,
  },
  routeCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  pricePartsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
  },
  priceRupee: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 2,
    marginRight: 1,
  },
  priceInteger: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.6,
    lineHeight: 28,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  actionRowText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
});
