import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { SearchStackParamList, RidesStackParamList, ProfileStackParamList } from '../../navigation/types';
import { useAuth } from '../../contexts/AuthContext';
import { COLORS } from '../../constants/colors';
import { getUserRatingsSummary, type UserRatingReview } from '../../services/ratings';

type OwnerRatingsRoute =
  | RouteProp<RidesStackParamList, 'OwnerRatingsModal'>
  | RouteProp<SearchStackParamList, 'OwnerRatingsModal'>;

function toRelativeText(iso: string): string {
  if (!iso) return 'Recent';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return 'Recent';
  const diffMs = Date.now() - dt.getTime();
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function OwnerRatingsModal(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<OwnerRatingsRoute>();
  const { user } = useAuth();

  const targetUserId = route.params?.userId?.trim() ?? '';
  const targetDisplayName = route.params?.displayName?.trim() ?? 'User';

  const avatarLetter = (targetDisplayName || 'User').charAt(0).toUpperCase();

  const [avgRating, setAvgRating] = useState(0);
  const [totalRatings, setTotalRatings] = useState(0);
  const [recentReviews, setRecentReviews] = useState<UserRatingReview[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      const parentNav = (navigation as any)?.getParent?.();
      parentNav?.setOptions?.({ tabBarStyle: { display: 'none' } });
      return () => {
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
            // ignore
          }
        }, 180);
      };
    }, [navigation])
  );

  useFocusEffect(
    useCallback(() => {
      if (!targetUserId) {
        setLoading(true);
        return () => {};
      }

      let cancelled = false;
      setLoading(true);

      void (async () => {
        try {
          const summary = await getUserRatingsSummary(targetUserId);
          if (cancelled) return;
          setAvgRating(summary.avgRating ?? 0);
          setTotalRatings(summary.totalRatings ?? 0);
          setRecentReviews(summary.reviews ?? []);
        } catch {
          if (cancelled) return;
          setAvgRating(0);
          setTotalRatings(0);
          setRecentReviews([]);
        } finally {
          if (cancelled) return;
          setLoading(false);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [targetUserId])
  );

  const breakdown = useMemo(() => {
    const buildFromAvgTotal = (avg: number, totalRaw: number) => {
      const total = Math.max(0, totalRaw);
      if (total <= 0) {
        return [5, 4, 3, 2, 1].map((stars) => ({ stars, count: 0, total: 1 }));
      }

      const sumTarget = Math.round(avg * total);
      const minSum = 1 * total;
      const maxSum = 5 * total;
      const clampedSum = Math.min(maxSum, Math.max(minSum, sumTarget));

      let remainingCount = total;
      let remainingSum = clampedSum;
      const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

      for (let s = 5; s >= 1; s -= 1) {
        const maxC = Math.min(remainingCount, Math.floor(remainingSum / s));
        let chosen = 0;
        for (let c = maxC; c >= 0; c -= 1) {
          const newCount = remainingCount - c;
          const newSum = remainingSum - c * s;
          const minPossible = newCount * 1;
          const maxPossible = newCount * 5;
          const feasible = newCount === 0 ? true : newSum >= minPossible && newSum <= maxPossible;
          if (feasible) {
            chosen = c;
            break;
          }
        }
        counts[s] = chosen;
        remainingCount -= chosen;
        remainingSum -= chosen * s;
      }

      return [5, 4, 3, 2, 1].map((stars) => ({ stars, count: counts[stars] ?? 0, total }));
    };

    const totalFromReviews = recentReviews.length;
    if (totalFromReviews > 0) {
      const counts = recentReviews.reduce<Record<number, number>>((acc, row) => {
        const k = Math.min(5, Math.max(1, Math.round(row.rating || 0)));
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {});
      const total = Math.max(1, recentReviews.length);
      const breakdownFromReviews = [5, 4, 3, 2, 1].map((stars) => ({ stars, count: counts[stars] ?? 0, total }));

      const derivedAvg =
        totalFromReviews > 0
          ? recentReviews.reduce((acc, r) => acc + Math.max(0, Math.min(5, Number(r.rating) || 0)), 0) / totalFromReviews
          : 0;
      if (avgRating > 0 && totalRatings > 0 && Math.abs(derivedAvg - avgRating) > 0.2) {
        return buildFromAvgTotal(avgRating, totalRatings);
      }
      return breakdownFromReviews;
    }

    return buildFromAvgTotal(avgRating, totalRatings);
  }, [recentReviews, avgRating, totalRatings]);
  const normalizedAvgRating = Math.max(0, Math.min(5, Number(avgRating) || 0));

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
        <View style={styles.topBar}>
          <Pressable onPress={() => navigation.goBack()} style={styles.iconButton} accessibilityRole="button">
            <Ionicons name="arrow-back" size={20} color={COLORS.text} />
          </Pressable>
          <View style={styles.topAvatar}>
            <Text style={styles.topAvatarText}>{avatarLetter}</Text>
          </View>
          <View style={styles.topTitleWrap}>
            <Text style={styles.topTitle}>Ratings</Text>
            <Text style={styles.topSubtitle}>{targetDisplayName}</Text>
          </View>
          <View style={styles.rightSpacer} />
        </View>
        <View style={styles.headerSeparator} />

        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryLeft}>
              <Text style={styles.mainRating}>{avgRating > 0 ? avgRating.toFixed(1) : '0.0'}</Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((idx) => (
                  <Ionicons
                    key={idx}
                    name={
                      normalizedAvgRating >= idx
                        ? 'star'
                        : normalizedAvgRating > idx - 1
                          ? 'star-half'
                          : 'star-outline'
                    }
                    size={14}
                    color={COLORS.warning}
                  />
                ))}
              </View>
              <Text style={styles.reviewsCount}>Based on {totalRatings} reviews</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>RATING BREAKDOWN</Text>
          <View style={styles.breakdownCard}>
            {breakdown.map((row) => {
              const width = `${Math.max(2, Math.round((row.count / row.total) * 100))}%`;
              return (
                <View key={row.stars} style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>
                    {row.stars}
                    <Ionicons name="star-outline" size={11} color={COLORS.warning} />
                  </Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width }]} />
                  </View>
                  <Text style={styles.breakdownCount}>{row.count}</Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>RECENT REVIEWS</Text>
            <Text style={styles.sortText}>Newest First</Text>
          </View>
          <View style={styles.reviewsCard}>
            {recentReviews.length === 0 ? (
              <View style={styles.emptyReviewsWrap}>
                <Text style={styles.emptyReviewsText}>No reviews yet</Text>
              </View>
            ) : (
              recentReviews.map((review, idx) => (
                <Pressable
                  key={review.id}
                  style={[styles.reviewItem, idx > 0 && styles.reviewDivider]}
                  onPress={() => {
                    if (!review.fromUserId) return;
                    navigation.navigate('OwnerProfileModal' as never, {
                      userId: review.fromUserId,
                      displayName: review.fromUserName,
                    } as never);
                  }}
                  disabled={!review.fromUserId}
                >
                  <View style={styles.reviewHead}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {(review.fromUserName?.charAt(0) || review.fromUserId?.charAt(0) || 'U')?.toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.reviewNameWrap}>
                      <Text style={styles.reviewName}>
                        {review.fromUserName || '—'}
                      </Text>
                      <Text style={styles.reviewTime}>{toRelativeText(review.createdAt).toUpperCase()}</Text>
                    </View>
                    <Ionicons name="ellipsis-vertical" size={16} color={COLORS.textMuted} />
                  </View>

                  <View style={styles.reviewStarsRow}>
                    {[1, 2, 3, 4, 5].map((stars) => (
                      <Ionicons
                        key={`${review.id}-${stars}`}
                        name={stars <= (review.rating || 0) ? 'star' : 'star-outline'}
                        size={12}
                        color={COLORS.warning}
                      />
                    ))}
                  </View>

                  <Text style={styles.reviewText}>{review.review?.trim() ? review.review : '—'}</Text>
                </Pressable>
              ))
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f7fb' },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 30, gap: 14 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  topAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.backgroundSecondary, alignItems: 'center', justifyContent: 'center' },
  topAvatarText: { fontSize: 18, fontWeight: '900', color: COLORS.text },
  topTitleWrap: { flex: 1 },
  topTitle: { fontSize: 18, fontWeight: '900', color: COLORS.text },
  topSubtitle: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary },
  rightSpacer: { width: 34 },
  headerSeparator: { height: 1, backgroundColor: COLORS.border, marginTop: 10, marginBottom: 12 },
  summaryCard: {
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.22)',
    padding: 14,
  },
  summaryRow: { flexDirection: 'row' },
  summaryLeft: { flex: 1 },
  mainRating: { fontSize: 34, fontWeight: '900', color: COLORS.text },
  starsRow: { flexDirection: 'row', gap: 2, marginTop: 4 },
  reviewsCount: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, marginTop: 4 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '900', color: COLORS.textSecondary, letterSpacing: 0.3 },
  sortText: { fontSize: 12, fontWeight: '700', color: COLORS.textMuted },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  breakdownCard: { backgroundColor: COLORS.white, borderRadius: 14, borderWidth: 1, borderColor: COLORS.borderLight, padding: 12, gap: 10 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  breakdownLabel: { width: 88, fontSize: 12, fontWeight: '800', color: COLORS.textSecondary },
  barTrack: { flex: 1, height: 8, borderRadius: 999, backgroundColor: COLORS.borderLight, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 999 },
  breakdownCount: { width: 36, textAlign: 'right', fontSize: 12, fontWeight: '900', color: COLORS.text },
  reviewsCard: { backgroundColor: COLORS.white, borderRadius: 14, borderWidth: 1, borderColor: COLORS.borderLight, padding: 12, gap: 10 },
  emptyReviewsWrap: { paddingVertical: 14, alignItems: 'center' },
  emptyReviewsText: { fontSize: 13, fontWeight: '800', color: COLORS.textSecondary },
  reviewItem: { gap: 8, paddingVertical: 6 },
  reviewDivider: { borderTopWidth: 1, borderTopColor: COLORS.borderLight, marginTop: 10, paddingTop: 10 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: COLORS.backgroundSecondary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '900', color: COLORS.text },
  reviewNameWrap: { flex: 1 },
  reviewName: { fontSize: 13, fontWeight: '900', color: COLORS.text },
  reviewTime: { fontSize: 11, fontWeight: '800', color: COLORS.textSecondary },
  reviewStarsRow: { flexDirection: 'row', gap: 2 },
  reviewText: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, lineHeight: 18 },
});

