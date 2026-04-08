import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { COLORS } from '../../constants/colors';
import type { ProfileStackParamList } from '../../navigation/types';
import { navigateMainTabsBackToRideDetail } from '../../navigation/navigateBackToRideDetail';
import { fetchTripsForProfileSubject } from '../../services/tripsAggregation';
import { formatDistance } from '../../utils/calculateDistance';
import { formatLastTripRelative } from '../../utils/formatLastTripRelative';
import { userIdsMatch } from '../../utils/rideDisplay';

type TabKey = 'completed' | 'cancelled';

export default function TripsScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const route = useRoute<RouteProp<ProfileStackParamList, 'Trips'>>();
  const { user } = useAuth();
  const viewerId = user?.id?.trim() ?? '';
  const paramUserId = route.params?.userId?.trim();
  const subjectDisplayName = route.params?.displayName?.trim();
  const returnToRide = route.params?._returnToRide;
  const subjectId = paramUserId || viewerId;
  const isSelfSubject = userIdsMatch(viewerId, subjectId);
  /** Ledger fetch needs viewer === subject; if auth isn’t hydrated yet but `userId` param is yours, use subject id as viewer. */
  const viewerForTripsFetch =
    viewerId ||
    (subjectId && (!paramUserId || userIdsMatch(user?.id, paramUserId)) ? subjectId : '');
  const fetchUsesSelfLedger = userIdsMatch(viewerForTripsFetch, subjectId);
  const subjectFirstName =
    subjectDisplayName && subjectDisplayName.trim().length > 0
      ? subjectDisplayName.trim().split(/\s+/)[0]
      : '';

  const [tab, setTab] = useState<TabKey>('completed');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [aggregate, setAggregate] = useState<Awaited<ReturnType<typeof fetchTripsForProfileSubject>> | null>(
    null
  );

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!subjectId) {
        setAggregate(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      try {
        const next = await fetchTripsForProfileSubject(subjectId, viewerForTripsFetch || undefined, {
          forcePassengerCache: mode === 'refresh' && fetchUsesSelfLedger,
        });
        setAggregate(next);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [subjectId, viewerForTripsFetch, fetchUsesSelfLedger]
  );

  useFocusEffect(
    useCallback(() => {
      void load('initial');
    }, [load])
  );

  /**
   * Trips opened from your profile sits on the Profile stack (often ProfileHome → Trips).
   * Swipe / Android back pops to ProfileHome ("my profile") unless we intercept.
   */
  const leaveToRideInFlightRef = useRef(false);
  const leaveToRideDetail = useCallback(() => {
    const ctx = returnToRide;
    if (!ctx?.params?.ride || leaveToRideInFlightRef.current) return;
    leaveToRideInFlightRef.current = true;
    navigateMainTabsBackToRideDetail(navigation, ctx);
    setTimeout(() => {
      leaveToRideInFlightRef.current = false;
    }, 750);
  }, [navigation, returnToRide]);

  /**
   * Native stack swipe-back pops Profile stack → ProfileHome. Disable gesture when we must return to ride.
   * Android: hardware back same issue — handled in `useFocusEffect` below.
   */
  useLayoutEffect(() => {
    navigation.setOptions({
      gestureEnabled: !returnToRide?.params?.ride,
    });
  }, [navigation, returnToRide]);

  useFocusEffect(
    useCallback(() => {
      if (!returnToRide?.params?.ride) return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        leaveToRideDetail();
        return true;
      });
      return () => sub.remove();
    }, [returnToRide, leaveToRideDetail])
  );

  const handleBack = useCallback(() => {
    if (returnToRide?.params?.ride) {
      leaveToRideDetail();
      return;
    }
    navigation.goBack();
  }, [returnToRide, navigation, leaveToRideDetail]);

  const completedAllTime = aggregate?.completedAllTime ?? 0;
  const totalKm = aggregate?.totalCompletedDistanceKm ?? 0;
  const lastLabel = aggregate ? formatLastTripRelative(aggregate.lastTripAt) : '—';
  const distanceLabel = totalKm > 0 ? formatDistance(totalKm) : '—';
  const completedBlurb = isSelfSubject
    ? `You have successfully completed ${completedAllTime} trip${completedAllTime === 1 ? '' : 's'} in total.`
    : subjectFirstName
      ? `${subjectFirstName} has successfully completed ${completedAllTime} trip${completedAllTime === 1 ? '' : 's'} in total.`
      : `This member has successfully completed ${completedAllTime} trip${completedAllTime === 1 ? '' : 's'} in total.`;

  const cancelledCount = aggregate?.cancelledAllTime ?? 0;
  const cancelledBlurb = isSelfSubject
    ? `You have ${cancelledCount} cancelled trip record${cancelledCount === 1 ? '' : 's'}.`
    : subjectFirstName
      ? `${subjectFirstName} has ${cancelledCount} cancelled trip record${cancelledCount === 1 ? '' : 's'}.`
      : `This member has ${cancelledCount} cancelled trip record${cancelledCount === 1 ? '' : 's'}.`;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          style={styles.headerBtn}
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={26} color={COLORS.textSecondary} />
        </Pressable>
        <View style={styles.headerTitleRow}>
          <Ionicons name="flash" size={18} color={COLORS.primary} style={styles.headerBolt} />
          <Text style={styles.headerTitle}>Trips</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>
      <View style={styles.headerRule} />

      {refreshing ? (
        <View style={styles.refreshBanner}>
          <ActivityIndicator size="small" color={COLORS.textMuted} />
          <Text style={styles.refreshBannerText}>CHECKING UPDATES...</Text>
        </View>
      ) : null}

      <View style={styles.segmentWrap}>
        <View style={styles.segment}>
          {(['completed', 'cancelled'] as const).map((k) => {
            const active = tab === k;
            return (
              <Pressable
                key={k}
                onPress={() => setTab(k)}
                style={[styles.segmentChip, active && styles.segmentChipActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
                  {k === 'completed' ? 'Completed' : 'Cancelled'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {loading && !aggregate ? (
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor={COLORS.primary}
            />
          }
        >
          <View
            style={[
              styles.summaryCard,
              tab === 'completed' ? styles.summaryCardCompleted : styles.summaryCardCancelled,
            ]}
          >
            <View style={styles.summaryWatermarkWrap} pointerEvents="none">
              <Ionicons
                name={tab === 'completed' ? 'checkmark' : 'close'}
                size={200}
                color={
                  tab === 'completed' ? 'rgba(41, 190, 139, 0.12)' : 'rgba(148, 163, 184, 0.14)'
                }
                style={styles.summaryWatermarkIcon}
              />
            </View>
            <View
              style={[
                styles.summaryIconCircle,
                tab === 'completed' ? styles.summaryIconCircleDone : styles.summaryIconCircleCancelled,
              ]}
            >
              <Ionicons
                name={tab === 'completed' ? 'checkmark' : 'close'}
                size={22}
                color={COLORS.white}
              />
            </View>
            <Text style={styles.summaryNumber}>
              {tab === 'completed' ? completedAllTime : cancelledCount}
            </Text>
            <Text style={styles.summaryCaption}>
              {tab === 'completed' ? 'COMPLETED TRIPS' : 'CANCELLED TRIPS'}
            </Text>
            <Text style={styles.summaryBlurb}>
              {tab === 'completed' ? completedBlurb : cancelledBlurb}
            </Text>
            {isSelfSubject && tab === 'completed' ? (
              <View style={styles.journeyBadge}>
                <Ionicons name="trending-up" size={16} color={COLORS.primary} />
                <Text style={styles.journeyBadgeText}>Keep up the great journey!</Text>
              </View>
            ) : null}
          </View>
          {tab === 'completed' ? (
            <>
              <Text style={styles.insightsSection}>QUICK INSIGHTS</Text>
              <View style={styles.insightsRow}>
                <View style={styles.insightCard}>
                  <Text style={styles.insightLabel}>LAST TRIP</Text>
                  <Text style={styles.insightValue}>{lastLabel}</Text>
                </View>
                <View style={styles.insightCard}>
                  <Text style={styles.insightLabel}>TOTAL DISTANCE</Text>
                  <Text style={styles.insightValue}>{distanceLabel}</Text>
                </View>
              </View>
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerBolt: {
    marginTop: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginHorizontal: 16,
  },
  refreshBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  refreshBannerText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    color: COLORS.textMuted,
  },
  segmentWrap: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 14,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  segmentChip: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 11,
  },
  segmentChipActive: {
    backgroundColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  segmentLabelActive: {
    color: COLORS.primary,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  summaryCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 24,
    paddingHorizontal: 20,
    marginBottom: 20,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 3,
  },
  summaryCardCompleted: {
    backgroundColor: 'rgba(41, 190, 139, 0.11)',
  },
  summaryCardCancelled: {
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
  },
  summaryWatermarkWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryWatermarkIcon: {
    opacity: 0.9,
    transform: [{ translateY: 8 }],
  },
  summaryIconCircle: {
    alignSelf: 'center',
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    zIndex: 1,
  },
  summaryIconCircleDone: {
    backgroundColor: COLORS.primary,
  },
  summaryIconCircleCancelled: {
    backgroundColor: COLORS.textSecondary,
  },
  summaryNumber: {
    fontSize: 44,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    zIndex: 1,
  },
  summaryCaption: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.7,
    color: COLORS.textSecondary,
    textAlign: 'center',
    zIndex: 1,
  },
  summaryBlurb: {
    marginTop: 10,
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
    zIndex: 1,
  },
  journeyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    marginTop: 18,
    backgroundColor: 'rgba(41, 190, 139, 0.16)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    zIndex: 1,
  },
  journeyBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    fontStyle: 'italic',
    color: COLORS.primary,
  },
  insightsSection: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.7,
    color: COLORS.textSecondary,
    marginBottom: 10,
  },
  insightsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  insightCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  insightLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: COLORS.textMuted,
    marginBottom: 6,
  },
  insightValue: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
});
