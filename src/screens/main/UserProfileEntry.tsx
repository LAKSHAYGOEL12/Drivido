import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import UserAvatar from '../../components/common/UserAvatar';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../contexts/AuthContext';
import { COLORS } from '../../constants/colors';
import type { ProfileStackParamList } from '../../navigation/types';
import { getUserRatingsSummary } from '../../services/ratings';
import { ProfileTripsBreakdownSheet } from '../../components/common/ProfileTripsBreakdownSheet';
import { ProfileTripsStatCell } from '../../components/common/ProfileTripsStatCell';
import {
  fetchTripsForProfileSubject,
  formatOwnProfileTripsLine,
  tripCountsFromAggregate,
} from '../../services/tripsAggregation';
import { ratingQualitativeColor, ratingQualitativeLabel } from '../../utils/ratingQualitativeLabel';
import { formatMemberSinceLabel } from '../../utils/formatMemberSinceLabel';
import { DEACTIVATED_ACCOUNT_LABEL } from '../../utils/deactivatedAccount';
import RidePreferenceChips from '../../components/profile/RidePreferenceChips';
import { normalizeRidePreferenceIds } from '../../constants/ridePreferences';

type UserProfileEntryRoute = RouteProp<ProfileStackParamList, 'ProfileEntry'>;

export default function UserProfileEntry(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const route = useRoute<UserProfileEntryRoute>();
  const { user } = useAuth();

  const targetUserId = route.params?.userId?.trim() ?? '';
  const peerDeactivatedFromRoute = route.params?.peerDeactivated === true;
  const targetDisplayName = peerDeactivatedFromRoute
    ? DEACTIVATED_ACCOUNT_LABEL
    : route.params?.displayName?.trim() ?? 'User';
  const isSelf = Boolean(user?.id?.trim() && targetUserId === user.id.trim());
  const [subjectDeactivatedFromApi, setSubjectDeactivatedFromApi] = useState(false);
  const showDeactivatedOther =
    !isSelf && (peerDeactivatedFromRoute || subjectDeactivatedFromApi);

  const [loading, setLoading] = useState(true);
  const [avgRating, setAvgRating] = useState(0);
  const [totalRatings, setTotalRatings] = useState(0);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [tripsCompleted, setTripsCompleted] = useState(0);
  const [tripsCancelled, setTripsCancelled] = useState(0);
  const [tripsCompletedThisMonth, setTripsCompletedThisMonth] = useState(0);
  const [memberSinceLabel, setMemberSinceLabel] = useState('—');
  const [tripsBreakdownVisible, setTripsBreakdownVisible] = useState(false);
  const [subjectBioFromApi, setSubjectBioFromApi] = useState('');
  const [subjectRidePrefsFromApi, setSubjectRidePrefsFromApi] = useState<string[]>([]);
  const prevTripsSubjectIdRef = useRef<string | null>(null);

  const [fetchedSubjectAvatar, setFetchedSubjectAvatar] = useState<string | undefined>();
  const headerPhotoUri = showDeactivatedOther
    ? undefined
    : (route.params?.avatarUrl ?? '').trim() ||
      (isSelf ? (user?.avatarUrl ?? '').trim() : '') ||
      (fetchedSubjectAvatar ?? '').trim() ||
      undefined;

  useFocusEffect(
    useCallback(() => {
      // Never fall back to current user on this screen.
      if (!targetUserId) {
        prevTripsSubjectIdRef.current = null;
        setLoading(true);
        setFetchedSubjectAvatar(undefined);
        setTripsLoading(true);
        setTripsCompleted(0);
        setTripsCancelled(0);
        setTripsCompletedThisMonth(0);
        setMemberSinceLabel('—');
        setSubjectDeactivatedFromApi(false);
        setSubjectBioFromApi('');
        setSubjectRidePrefsFromApi([]);
        return () => {};
      }

      if (peerDeactivatedFromRoute && !isSelf) {
        setSubjectDeactivatedFromApi(false);
        setFetchedSubjectAvatar(undefined);
        setAvgRating(0);
        setTotalRatings(0);
        setTripsLoading(false);
        setTripsCompleted(0);
        setTripsCancelled(0);
        setTripsCompletedThisMonth(0);
        setMemberSinceLabel('—');
        setSubjectBioFromApi('');
        setSubjectRidePrefsFromApi([]);
        setLoading(false);
        return () => {};
      }

      let cancelled = false;
      setLoading(true);
      setMemberSinceLabel(formatMemberSinceLabel(isSelf ? user?.createdAt : undefined));

      void (async () => {
        try {
          const summary = await getUserRatingsSummary(targetUserId);
          if (cancelled) return;
          if (summary.subjectDeactivated && !isSelf) {
            setSubjectDeactivatedFromApi(true);
            setSubjectBioFromApi('');
            setSubjectRidePrefsFromApi([]);
            setAvgRating(0);
            setTotalRatings(0);
            setFetchedSubjectAvatar(undefined);
            setMemberSinceLabel('—');
            setTripsLoading(false);
            setTripsCompleted(0);
            setTripsCancelled(0);
            setTripsCompletedThisMonth(0);
            setLoading(false);
            return;
          }
          setSubjectDeactivatedFromApi(false);
          setAvgRating(summary.avgRating ?? 0);
          setTotalRatings(summary.totalRatings ?? 0);
          setFetchedSubjectAvatar(summary.subjectAvatarUrl);
          setSubjectBioFromApi((summary.subjectBio ?? '').trim());
          setSubjectRidePrefsFromApi(
            normalizeRidePreferenceIds(summary.subjectRidePreferences ?? [])
          );
          setMemberSinceLabel(
            formatMemberSinceLabel(
              summary.subjectCreatedAt ?? (isSelf ? user?.createdAt : undefined)
            )
          );
        } catch {
          if (cancelled) return;
          setSubjectDeactivatedFromApi(false);
          setAvgRating(0);
          setTotalRatings(0);
          setFetchedSubjectAvatar(undefined);
          setSubjectBioFromApi('');
          setSubjectRidePrefsFromApi([]);
          setMemberSinceLabel(formatMemberSinceLabel(isSelf ? user?.createdAt : undefined));
        }
        if (cancelled) return;
        const tripsSubjectChanged = prevTripsSubjectIdRef.current !== targetUserId;
        prevTripsSubjectIdRef.current = targetUserId;
        if (tripsSubjectChanged) {
          setTripsLoading(true);
        }
        try {
          const viewerForTrips = isSelf
            ? (user?.id?.trim() || targetUserId)
            : user?.id?.trim();
          const agg = await fetchTripsForProfileSubject(targetUserId, viewerForTrips || undefined);
          if (!cancelled) {
            const { completed, cancelled: cx } = tripCountsFromAggregate(agg);
            setTripsCompleted(completed);
            setTripsCancelled(cx);
            setTripsCompletedThisMonth(Math.max(0, agg?.completedThisMonth ?? 0));
          }
        } catch {
          if (!cancelled) {
            setTripsCompleted(0);
            setTripsCancelled(0);
            setTripsCompletedThisMonth(0);
          }
        } finally {
          if (!cancelled) setTripsLoading(false);
        }
        if (!cancelled) setLoading(false);
      })();

      return () => {
        cancelled = true;
      };
    }, [targetUserId, isSelf, user?.id, user?.createdAt, peerDeactivatedFromRoute])
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

  if (showDeactivatedOther) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerCard}>
          <View style={styles.headerTopRow}>
            <Pressable style={styles.circleIconButton} accessibilityRole="button" onPress={handleBack}>
              <Ionicons name="arrow-back" size={18} color={COLORS.textSecondary} />
            </Pressable>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle}>Profile</Text>
            </View>
            <View style={styles.headerRightSpacer} />
          </View>
          <View style={styles.avatarWrap}>
            <UserAvatar uri={undefined} name={DEACTIVATED_ACCOUNT_LABEL} size={72} />
          </View>
          <Text style={styles.name}>{DEACTIVATED_ACCOUNT_LABEL}</Text>
          <Text style={styles.bioMuted}>
            This account is no longer active. Ratings, trip history, and contact details are hidden.
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <>
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
          <UserAvatar uri={headerPhotoUri} name={targetDisplayName} size={72} />
        </View>

        <Text style={styles.name}>{targetDisplayName}</Text>
        {(() => {
          const bioLine = isSelf
            ? (user?.bio ?? '').trim() || subjectBioFromApi
            : subjectBioFromApi;
          if (bioLine) {
            return <Text style={styles.bio}>{bioLine}</Text>;
          }
          if (isSelf) {
            return (
              <Text style={styles.bioHint}>Add a short description in Edit profile.</Text>
            );
          }
          return null;
        })()}
        <RidePreferenceChips
          ids={
            isSelf
              ? normalizeRidePreferenceIds(user?.ridePreferences ?? subjectRidePrefsFromApi)
              : subjectRidePrefsFromApi
          }
          style={styles.ridePrefChips}
        />
      </View>

      <View style={styles.statsCard}>
        {isSelf ? (
          <StatItem
            label="Trips"
            value={formatOwnProfileTripsLine(tripsLoading, tripsCompleted, tripsCancelled)}
            icon="car-outline"
            onPress={() =>
              navigation.navigate('Trips', {
                userId: targetUserId,
                ...(targetDisplayName.trim() ? { displayName: targetDisplayName.trim() } : {}),
              })
            }
          />
        ) : (
          <ProfileTripsStatCell
            completed={tripsCompleted}
            cancelled={tripsCancelled}
            loading={tripsLoading}
            onPress={tripsLoading ? undefined : () => setTripsBreakdownVisible(true)}
            accessibilityHint="Shows completed and cancelled trip counts"
          />
        )}
        <StatItem label="Rating" value={avgRating > 0 ? avgRating.toFixed(1) : '0'} icon="star-outline" />
        <StatItem label="Since" value={memberSinceLabel} icon="calendar-outline" />
      </View>

      <View style={styles.performanceCard}>
        <Text style={styles.performanceLabel}>PERFORMANCE</Text>
        <View style={styles.performanceRow}>
          <View style={styles.performanceLeft}>
            <View style={styles.ratingRow}>
              <Ionicons name="star-outline" size={16} color={COLORS.warning} />
              <Text style={styles.ratingValue}>{avgRating > 0 ? avgRating.toFixed(1) : '0.0'}</Text>
              <Text style={styles.ratingText}>{ratingQualitativeLabel(avgRating)}</Text>
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
                ...(route.params?.avatarUrl?.trim()
                  ? { avatarUrl: route.params.avatarUrl.trim() }
                  : {}),
              })
            }
          >
            <Ionicons name="chevron-forward" size={16} color={COLORS.success} />
          </Pressable>
        </View>
      </View>
    </ScrollView>
    {!isSelf ? (
      <ProfileTripsBreakdownSheet
        visible={tripsBreakdownVisible}
        onClose={() => setTripsBreakdownVisible(false)}
        completed={tripsCompleted}
        cancelled={tripsCancelled}
        loading={tripsLoading}
        subjectName={targetDisplayName}
        completedThisMonth={tripsCompletedThisMonth}
      />
    ) : null}
    </>
  );
}

function StatItem({
  label,
  value,
  icon,
  onPress,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
}): React.JSX.Element {
  const iconColor = icon === 'star-outline' || icon === 'star' ? COLORS.warning : COLORS.secondary;
  const body = (
    <>
      <Ionicons name={icon} size={14} color={iconColor} />
      <Text style={[styles.statValue, styles.statValueCenter]} numberOfLines={2}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.statItem, pressed && { opacity: 0.72 }]}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        accessibilityHint="Opens trip summary"
      >
        {body}
      </Pressable>
    );
  }
  return <View style={styles.statItem}>{body}</View>;
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
    marginTop: 4,
    marginBottom: 10,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
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
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  bioHint: {
    marginTop: 4,
    textAlign: 'center',
    fontSize: 14,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    lineHeight: 20,
    paddingHorizontal: 12,
  },
  ridePrefChips: {
    marginTop: 12,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  bioMuted: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textSecondary,
    paddingHorizontal: 8,
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
  statValueCenter: { textAlign: 'center' as const },
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

