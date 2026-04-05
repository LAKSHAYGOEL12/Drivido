import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { DimensionValue } from 'react-native';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import UserAvatar from '../../components/common/UserAvatar';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { COLORS } from '../../constants/colors';
import { getUserRatingsSummary, type UserRatingReview } from '../../services/ratings';
import type { ProfileStackParamList } from '../../navigation/types';
import { calculateAge } from '../../utils/calculateAge';

export default function RatingsScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const { user } = useAuth();
  const route = useRoute<RouteProp<ProfileStackParamList, 'Ratings'>>();
  const targetUserId = (route.params?.userId ?? user?.id ?? '').trim();
  const targetDisplayName = route.params?.displayName?.trim() || user?.name?.trim() || 'Drivido User';
  const targetDateOfBirth = (route.params as any)?.dateOfBirth;
  const targetAge = calculateAge(targetDateOfBirth);
  const displayName = targetDisplayName;
  const isViewingSelf = Boolean(user?.id?.trim() && targetUserId === user.id.trim());
  const [subjectAvatarUrl, setSubjectAvatarUrl] = useState<string | undefined>();
  const headerAvatarUri =
    (route.params?.avatarUrl ?? '').trim() ||
    (isViewingSelf ? (user?.avatarUrl ?? '').trim() : '') ||
    (subjectAvatarUrl ?? '').trim() ||
    undefined;
  const [avgRating, setAvgRating] = useState(0);
  const [totalRatings, setTotalRatings] = useState(0);
  const [recentReviews, setRecentReviews] = useState<UserRatingReview[]>([]);
  const [loading, setLoading] = useState(true);
  const ratingsFetchSeqRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      const userId = targetUserId;
      if (!userId) {
        setAvgRating(0);
        setTotalRatings(0);
        setRecentReviews([]);
        setSubjectAvatarUrl(undefined);
        setLoading(false);
        return () => {};
      }
      let cancelled = false;
      const runId = ++ratingsFetchSeqRef.current;
      setLoading(true);
      void (async () => {
        try {
          const summary = await getUserRatingsSummary(userId);
          if (cancelled || runId !== ratingsFetchSeqRef.current) return;
          setAvgRating(summary.avgRating);
          setTotalRatings(summary.totalRatings);
          setRecentReviews(summary.reviews);
          setSubjectAvatarUrl(summary.subjectAvatarUrl);
        } catch {
          if (cancelled || runId !== ratingsFetchSeqRef.current) return;
          setAvgRating(0);
          setTotalRatings(0);
          setRecentReviews([]);
          setSubjectAvatarUrl(undefined);
        } finally {
          if (!cancelled && runId === ratingsFetchSeqRef.current) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
        ratingsFetchSeqRef.current += 1;
      };
    }, [targetUserId, targetDisplayName])
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

      // If review-bucket average drifts from shown avg, trust avg+total for distribution.
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

  const toRelativeText = (iso: string): string => {
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
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(months / 12);
    return `${years}y ago`;
  };

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
            <UserAvatar
              uri={headerAvatarUri}
              name={displayName}
              size={34}
              backgroundColor="#dbeafe"
              fallbackTextColor="#1e40af"
            />
            {targetAge !== null ? (
              <View style={styles.topAgeBadge}>
                <Text style={styles.topAgeBadgeText}>{targetAge}y</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.topTitleWrap}>
            <Text style={styles.topTitle}>Ratings</Text>
            <Text style={styles.topSubtitle}>{displayName}</Text>
          </View>
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
            <View style={styles.feedbackButton}>
              <Ionicons name="chatbox-outline" size={22} color={COLORS.success} />
              <Text style={styles.feedbackText}>FEEDBACK</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>RATING BREAKDOWN</Text>
          <View style={styles.breakdownCard}>
            {breakdown.map((row) => {
              const width: DimensionValue = `${Math.max(2, Math.round((row.count / row.total) * 100))}%`;
              return (
                <View key={row.stars} style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>
                    {row.stars}
                    <Ionicons name="star-outline" size={11} color={COLORS.warning} />
                  </Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width }]} />
                  </View>
                  <Text style={styles.breakdownCount}>
                    {row.count >= 1000 ? `${(row.count / 1000).toFixed(1)}k` : `${row.count}`}
                  </Text>
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
                accessibilityRole={review.fromUserId ? 'button' : 'none'}
                disabled={!review.fromUserId}
                onPress={() => {
                  if (!review.fromUserId) return;
                  navigation.navigate('ProfileEntry', {
                    userId: review.fromUserId,
                    displayName: review.fromUserName,
                    ...(review.fromUserAvatarUrl?.trim()
                      ? { avatarUrl: review.fromUserAvatarUrl.trim() }
                      : {}),
                  });
                }}
              >
                <View style={styles.reviewHead}>
                  <View style={styles.avatar}>
                    <UserAvatar
                      uri={review.fromUserAvatarUrl}
                      name={review.fromUserName || review.fromUserId || 'User'}
                      size={36}
                      backgroundColor="#e2e8f0"
                    />
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
                  {[1, 2, 3, 4, 5].map((idx) => (
                    <Ionicons
                      key={`${review.id}-star-${idx}`}
                      name={idx <= review.rating ? 'star' : 'star-outline'}
                      size={12}
                      color={COLORS.warning}
                    />
                  ))}
                </View>
                <Text style={styles.reviewText}>{review.review?.trim() ? review.review : '—'}</Text>
                <View style={styles.rolePill}>
                  <Text style={styles.rolePillText}>
                    {(review.role || 'review').replace(/_/g, ' ')}
                  </Text>
                </View>
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
  screen: {
    flex: 1,
    backgroundColor: '#f6f7fb',
  },
  content: {
    padding: 16,
    paddingBottom: 30,
    gap: 14,
  },
  loaderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerSeparator: {
    height: 1,
    backgroundColor: COLORS.border,
    marginHorizontal: -16,
    marginTop: 4,
    marginBottom: 10,
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitleWrap: {
    gap: 1,
    flex: 1,
  },
  topAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  topAgeBadge: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.background,
  },
  topAgeBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.white,
  },
  topTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.text,
  },
  topSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  summaryCard: {
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.22)',
    padding: 14,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  summaryLeft: {
    flex: 1,
    gap: 5,
  },
  mainRating: {
    fontSize: 46,
    lineHeight: 46,
    fontWeight: '800',
    color: COLORS.success,
  },
  starsRow: {
    flexDirection: 'row',
    gap: 2,
  },
  reviewsCount: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  feedbackButton: {
    width: 88,
    height: 88,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)',
    backgroundColor: 'rgba(34,197,94,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  feedbackText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.success,
    letterSpacing: 0.4,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#6b7280',
    letterSpacing: 0.4,
  },
  breakdownCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 12,
    gap: 10,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  breakdownLabel: {
    width: 30,
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '700',
  },
  barTrack: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#eceff5',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  breakdownCount: {
    width: 34,
    textAlign: 'right',
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '700',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sortText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '700',
  },
  reviewsCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 12,
  },
  reviewItem: {
    paddingVertical: 12,
    gap: 8,
  },
  reviewDivider: {
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  reviewHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewNameWrap: {
    flex: 1,
  },
  reviewName: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.text,
  },
  reviewTime: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '700',
  },
  reviewStarsRow: {
    flexDirection: 'row',
    gap: 2,
  },
  reviewText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#374151',
  },
  rolePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(34,197,94,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.success,
  },
  emptyReviewsWrap: {
    paddingVertical: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyReviewsText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
});
