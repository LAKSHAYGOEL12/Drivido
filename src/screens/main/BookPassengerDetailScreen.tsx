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
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { RidesStackParamList, SearchStackParamList } from '../../navigation/types';
import { COLORS } from '../../constants/colors';
import { formatRidePriceParts } from '../../utils/rideDisplay';
import { bookingPickupDrop } from '../../utils/bookingRoutePreview';
import { bookingPassengerDisplayName } from '../../utils/displayNames';
import api from '../../services/api';
import { API } from '../../constants/API';
import { getUserRatingsSummary } from '../../services/ratings';
import UserAvatar from '../../components/common/UserAvatar';

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

export default function BookPassengerDetailScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const route = useRoute<BookPassengerRouteProp>();
  const { ride, booking, requestMode } = route.params;
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [ratingLoading, setRatingLoading] = useState(false);
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
  const { pickup, drop } = bookingPickupDrop(ride, booking);
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
    void (async () => {
      try {
        const summary = await getUserRatingsSummary(uid);
        if (cancelled) return;
        setAvgRating(summary.avgRating > 0 ? Number(summary.avgRating.toFixed(1)) : null);
        setRatingCount(summary.totalRatings);
      } catch {
        if (!cancelled) {
          setAvgRating(null);
          setRatingCount(0);
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
    (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate('Chat', {
      ride,
      otherUserName: passengerName,
      otherUserId: passengerId || undefined,
      ...(passengerAvatarUrl ? { otherUserAvatarUrl: passengerAvatarUrl } : {}),
    });
  };

  const openCall = () => {
    Alert.alert('Call', 'Phone number is not available for this rider yet.');
  };

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
              <Text style={[styles.requestRouteLabel, styles.requestRouteLabelGap]}>DESTINATION</Text>
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
            <View style={styles.verifiedBadge}>
              <Ionicons name="shield-checkmark" size={14} color={COLORS.white} />
            </View>
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
              <Text style={styles.trustSub}>Cancellation rate shown here when available</Text>
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.routeCard}>
          <View style={styles.routeCardInner}>
            <View style={styles.routeCardLeft}>
              <Text style={styles.routeSeatBold}>
                {booking.seats} seat{booking.seats !== 1 ? 's' : ''}
              </Text>
              <Text style={styles.routePathText}>
                {pickup} → {drop}
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

        <TouchableOpacity style={styles.actionRow} onPress={openChat} activeOpacity={0.7}>
          <Ionicons name="chatbubble-outline" size={22} color={COLORS.text} />
          <Text style={styles.actionRowText}>Message on Drivido</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionRow} onPress={openCall} activeOpacity={0.7}>
          <Ionicons name="call-outline" size={22} color={COLORS.text} />
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
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarWrap: {
    position: 'relative',
    marginRight: 14,
  },
  verifiedBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.background,
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
    paddingVertical: 18,
    paddingHorizontal: 16,
    minHeight: 88,
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
  routePathText: {
    fontSize: 15,
    fontWeight: '400',
    color: COLORS.textSecondary,
    lineHeight: 22,
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
