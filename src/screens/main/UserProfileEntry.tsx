import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../contexts/AuthContext';
import { COLORS } from '../../constants/colors';
import type { ProfileStackParamList } from '../../navigation/types';
import { getUserRatingsSummary } from '../../services/ratings';

type UserProfileEntryRoute = RouteProp<ProfileStackParamList, 'ProfileEntry'>;

export default function UserProfileEntry(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const route = useRoute<UserProfileEntryRoute>();
  const { user } = useAuth();

  const targetUserId = route.params?.userId?.trim() ?? '';
  const targetDisplayName = route.params?.displayName?.trim() ?? 'User';
  const isSelf = Boolean(user?.id?.trim() && targetUserId === user.id.trim());

  const [loading, setLoading] = useState(true);
  const [avgRating, setAvgRating] = useState(0);
  const [totalRatings, setTotalRatings] = useState(0);

  const memberSince = (() => {
    if (!isSelf) return '—';
    const raw = user?.createdAt?.trim();
    if (!raw) return '—';
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  })();

  const firstLetter = (targetDisplayName || 'User').charAt(0).toUpperCase();

  useFocusEffect(
    useCallback(() => {
      // Never fall back to current user on this screen.
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
        } catch {
          if (cancelled) return;
          setAvgRating(0);
          setTotalRatings(0);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [targetUserId])
  );

  const handleBack = () => {
    const returnTo = route.params?._returnToRideDetail;
    const parentNav = (navigation as any)?.getParent?.();
    if (returnTo?.tab && returnTo.params) {
      parentNav?.navigate?.(returnTo.tab, {
        screen: 'RideDetail',
        params: returnTo.params,
      });
      return;
    }
    navigation.goBack();
  };

  if (loading) {
    return (
      <View style={styles.loaderWrap}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.headerCard}>
        <View style={styles.headerTopRow}>
          {isSelf ? (
            <View style={styles.headerLeftSpacer} />
          ) : (
            <Pressable style={styles.circleIconButton} accessibilityRole="button" onPress={handleBack}>
              <Ionicons name="arrow-back" size={18} color={COLORS.textSecondary} />
            </Pressable>
          )}

          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>Profile</Text>
          </View>
          <View style={styles.headerRightSpacer} />
        </View>

        <View style={styles.avatarWrap}>
          <Text style={styles.avatarText}>{firstLetter}</Text>
          <View style={styles.onlineDot} />
        </View>

        <Text style={styles.name}>{targetDisplayName}</Text>
        <Text style={styles.bio}>Top-rated urban navigator and tech enthusiast.</Text>
      </View>

      <View style={styles.statsCard}>
        <StatItem label="Trips" value="0" icon="car-outline" />
        <StatItem label="Rating" value={avgRating > 0 ? avgRating.toFixed(1) : '0'} icon="star-outline" />
        <StatItem label="Since" value={memberSince} icon="calendar-outline" />
      </View>

      <View style={styles.performanceCard}>
        <Text style={styles.performanceLabel}>PERFORMANCE</Text>
        <View style={styles.performanceRow}>
          <View style={styles.performanceLeft}>
            <View style={styles.ratingRow}>
              <Ionicons name="star-outline" size={16} color={COLORS.warning} />
              <Text style={styles.ratingValue}>{avgRating > 0 ? avgRating.toFixed(1) : '0.0'}</Text>
              <Text style={styles.ratingText}>Excellent</Text>
            </View>
            <Text style={styles.reviewText}>Based on {totalRatings} reviews</Text>
          </View>
          <Pressable
            style={styles.performanceArrow}
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate('Ratings', {
                userId: targetUserId || undefined,
                displayName: targetDisplayName,
              })
            }
          >
            <Ionicons name="chevron-forward" size={16} color={COLORS.success} />
          </Pressable>
        </View>
      </View>
    </ScrollView>
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
  screen: {
    flex: 1,
    backgroundColor: COLORS.backgroundSecondary,
  },
  loaderWrap: {
    flex: 1,
    backgroundColor: COLORS.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 16,
    paddingBottom: 30,
    paddingTop: 40,
    gap: 12,
  },
  headerCard: {
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  headerTopRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerTitleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  headerLeftSpacer: {
    width: 30,
    height: 30,
  },
  headerRightSpacer: {
    width: 30,
    height: 30,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
  },
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
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 10,
    position: 'relative',
  },
  avatarText: {
    fontSize: 30,
    fontWeight: '800',
    color: COLORS.text,
  },
  onlineDot: {
    position: 'absolute',
    right: 3,
    bottom: 4,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.error,
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  name: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
  },
  bio: {
    marginTop: 4,
    textAlign: 'center',
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  statsCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    flexDirection: 'row',
    paddingVertical: 12,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.text,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  performanceCard: {
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.22)',
    padding: 12,
    gap: 8,
  },
  performanceLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(21,128,61,0.55)',
    letterSpacing: 0.6,
  },
  performanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  performanceLeft: {
    flex: 1,
    gap: 8,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ratingValue: {
    fontSize: 34,
    lineHeight: 36,
    fontWeight: '800',
    color: COLORS.text,
  },
  ratingText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  reviewText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textDecorationLine: 'underline',
  },
  performanceArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(34,197,94,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.28)',
  },
});

