import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import UserAvatar from '../../components/common/UserAvatar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RidesStackParamList, SearchStackParamList } from '../../navigation/types';
import type { PassengerSearchParams } from '../../navigation/types';
import { useAuth } from '../../contexts/AuthContext';
import { COLORS } from '../../constants/colors';
import { getUserRatingsSummary } from '../../services/ratings';
import type { SearchStackParamList as TypesSearchStackParamList } from '../../navigation/types';
import type { RidesStackParamList as TypesRidesStackParamList } from '../../navigation/types';

type OwnerProfileRoute =
  | RouteProp<TypesRidesStackParamList, 'OwnerProfileModal'>
  | RouteProp<TypesSearchStackParamList, 'OwnerProfileModal'>;

export default function OwnerProfileModal(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<OwnerProfileRoute>();
  const { user } = useAuth();

  const targetUserId = route.params?.userId?.trim() ?? '';
  const targetDisplayName = route.params?.displayName?.trim() ?? 'User';
  const paramAvatarUrl = route.params?.avatarUrl?.trim();
  const paramPublisherAvg = route.params?.publisherAvgRating;
  const paramPublisherCount = route.params?.publisherRatingCount;
  const isSelf = Boolean(user?.id?.trim() && targetUserId === user.id.trim());
  /** No session: ratings are loaded via GET /ratings/:userId when this screen opens (see backend notes below). */
  const isGuest = !(user?.id ?? '').trim();
  const headerPhotoUri =
    (isSelf ? (user?.avatarUrl ?? '').trim() || paramAvatarUrl : paramAvatarUrl) || undefined;

  const [loading, setLoading] = useState(true);
  const [avgRating, setAvgRating] = useState(0);
  const [totalRatings, setTotalRatings] = useState(0);
  /** Signed-in users without ride-embedded stats: show "—" instead of a misleading 0. */
  const [ratingKnown, setRatingKnown] = useState(false);
  const ratingsFetchSeqRef = useRef(0);
  /** Only prime UI from ride params when the snapshot is new — not on every blur→focus (same params would re-apply stale ride stats). */
  const lastEmbeddedKeyRef = useRef<string>('');

  useFocusEffect(
    useCallback(() => {
      const parentNav = (navigation as any)?.getParent?.();
      parentNav?.setOptions?.({ tabBarStyle: { display: 'none' } });
      return () => {
        // Restore only when the next focused nested screen should show tabs.
        // This prevents brief tab re-appearance when switching between
        // OwnerProfileModal <-> OwnerRatingsModal.
        setTimeout(() => {
          try {
            const tabState = parentNav?.getState?.();
            const activeTabRoute = tabState?.routes?.[tabState?.index ?? 0];
            const nestedState = activeTabRoute?.state;
            const nestedName = nestedState?.routes?.[nestedState?.index ?? 0]?.name;

            const hiddenNestedNames = new Set([
              'RideDetail',
              'RideDetailScreen',
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
            // ignore
          }
        }, 180);
      };
    }, [navigation])
  );

  const memberSince = (() => {
    if (!isSelf) return '—';
    const raw = user?.createdAt?.trim();
    if (!raw) return '—';
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  })();

  useFocusEffect(
    useCallback(() => {
      if (!targetUserId) {
        setLoading(true);
        return () => {};
      }

      let cancelled = false;
      const runId = ++ratingsFetchSeqRef.current;
      setLoading(true);

      const applyPublisherParams = (): boolean => {
        const hasAvg =
          typeof paramPublisherAvg === 'number' && Number.isFinite(paramPublisherAvg) && paramPublisherAvg >= 0;
        const hasCount =
          typeof paramPublisherCount === 'number' &&
          Number.isFinite(paramPublisherCount) &&
          paramPublisherCount >= 0;
        if (!hasAvg && !hasCount) return false;
        setAvgRating(hasAvg ? Number(paramPublisherAvg.toFixed(1)) : 0);
        setTotalRatings(hasCount ? Math.floor(paramPublisherCount) : 0);
        setRatingKnown(true);
        return true;
      };

      /**
       * Ride detail passes publisher avg/count for a fast first paint. Re-applying those params on every
       * focus (e.g. back from ratings) resets the UI to stale ride snapshot numbers before GET /ratings/:id
       * finishes — only apply when this exact snapshot is new (first open or new params from navigation).
       */
      const embeddedKey = `${targetUserId}|${paramPublisherAvg ?? ''}|${paramPublisherCount ?? ''}`;
      const isNewEmbeddedSnapshot = embeddedKey !== lastEmbeddedKeyRef.current;
      if (isNewEmbeddedSnapshot) {
        lastEmbeddedKeyRef.current = embeddedKey;
      }
      const hadEmbeddedFromRide = isNewEmbeddedSnapshot && !isGuest && applyPublisherParams();
      if (hadEmbeddedFromRide) {
        setLoading(false);
      }

      const fetchSummary = async () => {
        try {
          const summary = await getUserRatingsSummary(targetUserId);
          if (cancelled || runId !== ratingsFetchSeqRef.current) return;
          setAvgRating(summary.avgRating ?? 0);
          setTotalRatings(summary.totalRatings ?? 0);
          setRatingKnown(true);
        } catch {
          if (cancelled || runId !== ratingsFetchSeqRef.current) return;
          if (!hadEmbeddedFromRide) {
            setAvgRating(0);
            setTotalRatings(0);
          }
          setRatingKnown(true);
        } finally {
          if (!cancelled && runId === ratingsFetchSeqRef.current) setLoading(false);
        }
      };

      void fetchSummary();

      return () => {
        cancelled = true;
        ratingsFetchSeqRef.current += 1;
      };
    }, [targetUserId, isGuest, isSelf, paramPublisherAvg, paramPublisherCount])
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.headerCard, !isSelf ? styles.headerCardOther : null]}>
          <View style={[styles.headerTopRow, !isSelf ? styles.headerTopRowOther : null]}>
            <Pressable
              onPress={() => navigation.goBack()}
              style={styles.circleIconButton}
              accessibilityRole="button"
            >
              <Ionicons name="arrow-back" size={18} color={COLORS.textSecondary} />
            </Pressable>

            <View style={[styles.headerTitleWrap, !isSelf ? styles.headerTitleWrapOther : null]}>
              <Text style={styles.headerTitle}>Profile</Text>
            </View>
            <View style={styles.headerRightSpacer} />
          </View>

          <View style={styles.avatarWrap}>
            <UserAvatar uri={headerPhotoUri} name={targetDisplayName} size={72} />
          </View>

          <Text style={styles.name}>{targetDisplayName}</Text>
          <Text style={styles.bio}>Top-rated urban navigator and tech enthusiast.</Text>
        </View>

        <View style={styles.statsCard}>
          <StatItem label="Trips" value="0" icon="car-outline" />
          <StatItem
            label="Rating"
            value={!ratingKnown && !isGuest ? '—' : avgRating.toFixed(1)}
            icon="star-outline"
          />
          <StatItem label="Since" value={isSelf ? memberSince : '—'} icon="calendar-outline" />
        </View>

        <View style={styles.performanceCard}>
          <Text style={styles.performanceLabel}>PERFORMANCE</Text>
          <View style={styles.performanceRow}>
            <View style={styles.performanceLeft}>
              <View style={styles.ratingRow}>
              <Ionicons name="star-outline" size={16} color={COLORS.warning} />
                <Text style={styles.ratingValue}>
                  {!ratingKnown && !isGuest ? '—' : avgRating.toFixed(1)}
                </Text>
                <Text style={styles.ratingText}>Excellent</Text>
              </View>
              <Text style={styles.reviewText}>
                {!ratingKnown && !isGuest
                  ? '—'
                  : `Based on ${totalRatings} review${totalRatings !== 1 ? 's' : ''}`}
              </Text>
            </View>
            <Pressable
              style={styles.performanceArrow}
              accessibilityRole="button"
              onPress={() =>
                navigation.navigate('OwnerRatingsModal', {
                  userId: targetUserId,
                  displayName: targetDisplayName,
                  ...(headerPhotoUri ? { avatarUrl: headerPhotoUri } : {}),
                })
              }
            >
              <Ionicons name="chevron-forward" size={16} color={COLORS.success} />
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
}): React.JSX.Element {
  const iconColor = icon === 'star-outline' || icon === 'star' ? COLORS.warning : COLORS.secondary;
  return (
    <View style={styles.statItem}>
      <Ionicons name={icon} size={14} color={iconColor} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.white },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 30, paddingTop: 40, gap: 12 },

  headerCard: {
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  // Move the border/background up, but push children back down
  // so the arrow + "Profile" title don't get cramped.
  headerCardOther: { marginTop: -10, paddingTop: 24 },
  headerTopRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerTitleWrap: { flex: 1, alignItems: 'center' },
  headerTopRowOther: { marginTop: -8, marginBottom: 6 },
  headerTitleWrapOther: { marginTop: -6 },
  headerLeftSpacer: { width: 30, height: 30 },
  headerRightSpacer: { width: 30, height: 30 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text },

  circleIconButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  avatarWrap: {
    marginTop: 4,
    marginBottom: 10,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },

  name: { fontSize: 26, fontWeight: '800', color: COLORS.text, textAlign: 'center' },
  bio: { marginTop: 4, textAlign: 'center', fontSize: 14, color: COLORS.textSecondary },

  statsCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    flexDirection: 'row',
    paddingVertical: 12,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  statLabel: { fontSize: 12, color: COLORS.textSecondary },

  performanceCard: { backgroundColor: 'rgba(34,197,94,0.08)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(34,197,94,0.22)', padding: 12, gap: 8 },
  performanceLabel: { fontSize: 12, fontWeight: '700', color: 'rgba(21,128,61,0.55)', letterSpacing: 0.6 },
  performanceRow: { flexDirection: 'row', alignItems: 'center' },
  performanceLeft: { flex: 1, gap: 8 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ratingValue: { fontSize: 18, fontWeight: '900', color: COLORS.text },
  ratingText: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary },
  reviewText: { fontSize: 12, color: COLORS.textSecondary, textDecorationLine: 'underline' },
  performanceArrow: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(34,197,94,0.14)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(34,197,94,0.28)' },
});

