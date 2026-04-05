import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  InteractionManager,
  Linking,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { calculateAge } from '../../utils/calculateAge';

type BookPassengerRouteProp =
  | RouteProp<RidesStackParamList, 'BookPassengerDetail'>
  | RouteProp<SearchStackParamList, 'BookPassengerDetail'>;

function findMainTabNavigator(navigation: any) {
  let current = navigation?.getParent?.() as any | undefined;
  for (let i = 0; i < 5 && current; i += 1) {
    const names: string[] | undefined = current?.getState?.()?.routeNames;
    if (names?.includes('SearchStack') && names?.includes('YourRides')) return current;
    current = current.getParent?.();
  }
  return null;
}

function formatBookingHistoryLineWhen(iso: string): string {
  const t = iso.trim();
  if (!t) return '';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function BookPassengerDetailScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const route = useRoute<BookPassengerRouteProp>();
  const { ride, booking, requestMode } = route.params;

  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [ratingLoading, setRatingLoading] = useState(false);
  const [passengerPhoneFromApi, setPassengerPhoneFromApi] = useState('');
  const [requestActionLoading, setRequestActionLoading] = useState<'approve' | 'reject' | null>(null);

  useFocusEffect(
    useCallback(() => {
      const tabsNav = findMainTabNavigator(navigation as any);
      tabsNav?.setOptions?.({ tabBarStyle: { display: 'none' } });
      return () => {
        setTimeout(() => {
          try {
            const tabState = tabsNav?.getState?.();
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
            ]);
            if (!nestedName || !hiddenNestedNames.has(nestedName)) {
              tabsNav?.setOptions?.({ tabBarStyle: undefined });
            }
          } catch {
            // ignore
          }
        }, 180);
      };
    }, [navigation])
  );

  const passengerName = bookingPassengerDisplayName(booking);
  const passengerId = booking.userId ?? '';
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
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBack} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Passenger</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {isRequestDetail ? (
          <>
            <Text style={styles.requestTitle}>Request from {passengerName}</Text>
            <View style={styles.requestProfileCard}>
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
              <View style={styles.requestProfileTextCol}>
                <Text style={styles.requestProfileName}>{passengerName}</Text>
                <TouchableOpacity style={styles.requestRatingRow} onPress={openPassengerRatings} activeOpacity={0.75}>
                  <Ionicons name="star-outline" size={14} color={COLORS.warning} />
                  {ratingLoading ? (
                    <Text style={styles.requestRatingText}>Loading rating...</Text>
                  ) : (
                    <Text style={styles.requestRatingText}>
                      {avgRating != null ? avgRating.toFixed(1) : 'No rating'} {ratingCount > 0 ? `(${ratingCount} rides)` : ''}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.requestRouteCard}>
              <Text style={styles.requestRouteLabel}>PICKUP</Text>
              <Text style={styles.requestRouteValue}>{pickup}</Text>
              <Text style={[styles.requestRouteLabel, styles.requestRouteLabelGap]}>DROP-OFF</Text>
              <Text style={styles.requestRouteValue}>{drop}</Text>
            </View>

            <View style={styles.requestMetaRow}>
              <View style={styles.requestMetaItem}>
                <Text style={styles.requestMetaLabel}>SEATS</Text>
                <Text style={styles.requestMetaValue}>{booking.seats} Passenger{booking.seats !== 1 ? 's' : ''}</Text>
              </View>
              <View style={[styles.requestMetaItem, styles.requestMetaItemPayment]}>
                <Text style={styles.requestMetaLabel}>PAYMENT</Text>
                <Text style={styles.requestMetaValue}>{totalPriceText}</Text>
              </View>
            </View>

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
                    <Ionicons name="close-circle-outline" size={18} color={COLORS.error} />
                    <Text style={styles.requestRejectText}>Reject</Text>
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
                    <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.white} />
                    <Text style={styles.requestApproveText}>Approve</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.requestChatBtn}
              onPress={openChat}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Chat with passenger"
            >
              <Ionicons name="chatbubble-ellipses-outline" size={22} color={COLORS.primary} />
              <Text style={styles.requestChatBtnText}>Chat</Text>
            </TouchableOpacity>
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
            <Ionicons name="calendar-outline" size={22} color={COLORS.textSecondary} />
            <View style={styles.trustTextCol}>
              <Text style={styles.trustTitle}>Booking history</Text>
              {booking.bookingHistory && booking.bookingHistory.length > 0 ? (
                <View style={styles.bookingHistoryList}>
                  {booking.bookingHistory.map((h, idx) => {
                    const when = formatBookingHistoryLineWhen(h.bookedAt ?? '');
                    return (
                      <Text key={idx} style={styles.bookingHistoryLine} numberOfLines={2}>
                        {h.seats} seat{h.seats !== 1 ? 's' : ''} · {String(h.status ?? '').trim()}
                        {when ? ` · ${when}` : ''}
                      </Text>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.trustSub}>No booking history yet</Text>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerBack: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSpacer: {
    width: 32,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 24,
  },
  requestTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 10,
    lineHeight: 26,
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
  requestProfileCard: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  requestProfileTextCol: {
    flex: 1,
    minWidth: 0,
  },
  requestProfileName: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  requestRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  requestRatingText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
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
  requestMetaRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  requestMetaItem: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#eef2ff',
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  requestMetaItemPayment: {
    backgroundColor: '#fff7ed',
  },
  requestMetaLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.textSecondary,
    letterSpacing: 0.3,
  },
  requestMetaValue: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: 4,
    lineHeight: 20,
  },
  requestActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  requestRejectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
    paddingVertical: 12,
  },
  requestRejectText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  requestApproveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    backgroundColor: '#27c8b7',
    paddingVertical: 12,
  },
  requestApproveText: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.white,
  },
  requestChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(0, 150, 135, 0.08)',
    paddingVertical: 12,
    marginTop: 12,
  },
  requestChatBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.primary,
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
  bookingHistoryList: {
    marginTop: 6,
  },
  bookingHistoryLine: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textSecondary,
    marginBottom: 4,
    lineHeight: 16,
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
