import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Alert } from '../../utils/themedAlert';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../contexts/AuthContext';
import { useNotificationPreferences } from '../../contexts/NotificationPreferencesContext';
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
import UserAvatar from '../../components/common/UserAvatar';
import { useImagePicker } from '../../hooks/useImagePicker';
import { uploadUserAvatar, deleteUserAvatar } from '../../services/userAvatar';
import { ratingQualitativeColor, ratingQualitativeLabel } from '../../utils/ratingQualitativeLabel';
import { formatMemberSinceLabel } from '../../utils/formatMemberSinceLabel';
import { vehiclesFromUser, type UserVehicleEntry } from '../../utils/userVehicle';
import { unregisterPushTokenWithBackend } from '../../services/pushTokenRegistration';
import RidePreferenceChips from '../../components/profile/RidePreferenceChips';
import { normalizeRidePreferenceIds } from '../../constants/ridePreferences';
import SkeletonBlock from '../../components/common/SkeletonBlock';

export default function Profile(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { user, logout, refreshUser, patchUser, isAuthenticated, needsProfileCompletion } = useAuth();
  const { pushNotificationsAllowed, setPushNotificationsAllowed } = useNotificationPreferences();
  /** Keeps Switch visually ON while the enable confirmation alert is open (avoids controlled-value snap-back). */
  const [pushEnableConfirmPending, setPushEnableConfirmPending] = useState(false);
  const notificationsSwitchVisualOn = pushNotificationsAllowed || pushEnableConfirmPending;
  const sessionReady = isAuthenticated && !needsProfileCompletion;
  const { pickFromGallery, takePhoto } = useImagePicker();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const route = useRoute<RouteProp<ProfileStackParamList, 'ProfileHome' | 'ProfileEntry'>>();
  const [profileName, setProfileName] = useState(user?.name?.trim() || 'Drivido User');
  const [avgRating, setAvgRating] = useState(0);
  const [totalRatings, setTotalRatings] = useState(0);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [tripsCompleted, setTripsCompleted] = useState(0);
  const [tripsCancelled, setTripsCancelled] = useState(0);
  const [tripsCompletedThisMonth, setTripsCompletedThisMonth] = useState(0);
  const [memberSinceLabel, setMemberSinceLabel] = useState('—');
  const [loading, setLoading] = useState(true);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [photoMenuVisible, setPhotoMenuVisible] = useState(false);
  const [tripsBreakdownVisible, setTripsBreakdownVisible] = useState(false);
  const [subjectBioFromApi, setSubjectBioFromApi] = useState('');
  const [subjectRidePrefsFromApi, setSubjectRidePrefsFromApi] = useState<string[]>([]);
  /** Avoid flashing “—” on Trips when refocusing the same profile (e.g. back from Trips screen). */
  const prevTripsSubjectIdRef = useRef<string | null>(null);
  const prevProfileSubjectIdRef = useRef<string | null>(null);

  const routeUserId = route.params?.userId?.trim();
  const routeDisplayName = route.params?.displayName?.trim();

  const routeName = (route as any)?.name as string | undefined;
  const isProfileEntryScreen = routeName === 'ProfileEntry';

  // IMPORTANT:
  // - On owner-profile screen (`ProfileEntry`), NEVER fall back to current user.
  //   Otherwise you will see your own profile flash while params are still applying.
  const targetUserId = isProfileEntryScreen ? (routeUserId ?? '') : ((routeUserId ?? user?.id ?? '').trim());

  const targetDisplayName = routeDisplayName || user?.name?.trim() || 'Drivido User';
  const isSelf = Boolean(user?.id?.trim() && targetUserId === user.id.trim());

  const displayName = profileName || targetDisplayName;
  const mergedVehicles = useMemo(() => (isSelf ? vehiclesFromUser(user) : []), [isSelf, user]);
  const routeAvatarUrl = route.params?.avatarUrl?.trim();
  /** Own profile: only `user` from auth — never route params (they stay stale after remove photo). */
  const profileHeaderPhotoUri = isSelf
    ? (user?.avatarUrl ?? '').trim() || undefined
    : routeAvatarUrl || undefined;

  const pickAndUpload = useCallback(
    async (source: 'library' | 'camera') => {
      const picked =
        source === 'library'
          ? await pickFromGallery({ aspect: [1, 1], quality: 0.85 })
          : await takePhoto({ aspect: [1, 1], quality: 0.85 });
      if (!picked?.uri) return;
      setAvatarUploading(true);
      try {
        const url = await uploadUserAvatar(picked.uri);
        patchUser({ avatarUrl: url });
        await refreshUser();
      } catch (e) {
        Alert.alert(
          'Upload failed',
          e instanceof Error ? e.message : 'Could not update your photo. Check the server and try again.'
        );
      } finally {
        setAvatarUploading(false);
      }
    },
    [patchUser, pickFromGallery, refreshUser, takePhoto]
  );

  const handleRemoveAvatar = useCallback(async () => {
    setAvatarUploading(true);
    try {
      await deleteUserAvatar();
      patchUser({ avatarUrl: undefined });
      await refreshUser();
    } catch (e) {
      Alert.alert(
        'Could not remove photo',
        e instanceof Error ? e.message : 'The server may not support removing photos yet.'
      );
    } finally {
      setAvatarUploading(false);
    }
  }, [patchUser, refreshUser]);

  const closePhotoMenu = useCallback(() => setPhotoMenuVisible(false), []);

  useEffect(() => {
    if (pushNotificationsAllowed) {
      setPushEnableConfirmPending(false);
    }
  }, [pushNotificationsAllowed]);

  const onPushNotificationsSwitch = useCallback(
    (value: boolean) => {
      const uid = user?.id?.trim();
      if (!uid) return;
      if (value) {
        setPushEnableConfirmPending(true);
        const resetPending = () => setPushEnableConfirmPending(false);
        requestAnimationFrame(() => {
          Alert.alert(
            'Allow notifications',
            'You will receive push alerts for ride updates and new messages on this device.',
            [
              { text: 'Cancel', style: 'cancel', onPress: resetPending },
              {
                text: 'Allow',
                onPress: () => {
                  void setPushNotificationsAllowed(true);
                },
              },
            ],
            { cancelable: true, onDismiss: resetPending }
          );
        });
        return;
      }
      setPushEnableConfirmPending(false);
      void setPushNotificationsAllowed(false);
      void (async () => {
        try {
          await unregisterPushTokenWithBackend();
        } catch {
          // Preference already off; backend unregister is best-effort.
        }
      })();
    },
    [user?.id, setPushNotificationsAllowed]
  );

  const handleProfileHeaderBack = useCallback(() => {
    const returnTo = route.params?._returnToRideDetail;
    const parentNav = (navigation as { getParent?: () => { navigate?: (name: string, params?: object) => void } })
      .getParent?.();
    if (returnTo?.tab && returnTo.params) {
      parentNav?.navigate?.(returnTo.tab, {
        screen: 'RideDetail',
        params: returnTo.params,
      });
      return;
    }
    navigation.goBack();
  }, [navigation, route.params]);

  const openPhotoOptions = useCallback(() => {
    if (!isSelf) return;
    setPhotoMenuVisible(true);
  }, [isSelf]);

  useFocusEffect(
    useCallback(() => {
      if (!targetUserId) {
        // Keep loader until the owner `userId` arrives (ProfileEntry).
        // For ProfileHome, we usually always have userId from BottomTabs.
        prevTripsSubjectIdRef.current = null;
        setLoading(true);
        setAvgRating(0);
        setTotalRatings(0);
        setTripsLoading(true);
        setTripsCompleted(0);
        setTripsCancelled(0);
        setTripsCompletedThisMonth(0);
        setMemberSinceLabel('—');
        setSubjectBioFromApi('');
        setSubjectRidePrefsFromApi([]);
        return () => {};
      }

      let cancelled = false;
      const profileSubjectChanged = prevProfileSubjectIdRef.current !== targetUserId;
      prevProfileSubjectIdRef.current = targetUserId;
      const showBlockingLoader = profileSubjectChanged || !hasLoadedOnce;
      setLoading(showBlockingLoader);
      setBackgroundRefreshing(!showBlockingLoader);
      setMemberSinceLabel(formatMemberSinceLabel(isSelf ? user?.createdAt : undefined));
      void (async () => {
        try {
          // Ratings API is fast; Firestore inside `refreshUser()` can hang — never block the profile spinner on it.
          const summary = await getUserRatingsSummary(targetUserId);
          if (cancelled) return;
          setProfileName(targetDisplayName);
          setAvgRating(summary.avgRating);
          setTotalRatings(summary.totalRatings);
          if (summary.subjectDeactivated) {
            setSubjectBioFromApi('');
            setSubjectRidePrefsFromApi([]);
          } else {
            setSubjectBioFromApi((summary.subjectBio ?? '').trim());
            setSubjectRidePrefsFromApi(
              normalizeRidePreferenceIds(summary.subjectRidePreferences ?? [])
            );
          }
          setMemberSinceLabel(
            formatMemberSinceLabel(
              summary.subjectCreatedAt ?? (isSelf ? user?.createdAt : undefined)
            )
          );
        } catch {
          if (cancelled) return;
          setProfileName(targetDisplayName);
          setAvgRating(0);
          setTotalRatings(0);
          setSubjectBioFromApi('');
          setSubjectRidePrefsFromApi([]);
          setMemberSinceLabel(formatMemberSinceLabel(isSelf ? user?.createdAt : undefined));
        } finally {
          if (!cancelled) {
            setLoading(false);
            setBackgroundRefreshing(false);
            setHasLoadedOnce(true);
          }
        }
        if (!cancelled && targetUserId) {
          const tripsSubjectChanged = prevTripsSubjectIdRef.current !== targetUserId;
          prevTripsSubjectIdRef.current = targetUserId;
          if (tripsSubjectChanged) {
            setTripsLoading(true);
          }
          try {
            /** When viewing yourself, always treat viewer as the subject if `user.id` is momentarily missing — otherwise we hit the public summary path and counts can stay 0. */
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
        } else if (!cancelled) {
          setTripsCompleted(0);
          setTripsCancelled(0);
          setTripsCompletedThisMonth(0);
          setTripsLoading(false);
        }
        if (!cancelled && isSelf) {
          void refreshUser();
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [targetUserId, targetDisplayName, isProfileEntryScreen, isSelf, refreshUser, user?.id, user?.createdAt, hasLoadedOnce])
  );

  /** During logout, RootNavigator shows the single “Shutting down” overlay — avoid a second full-screen spinner here. */
  if (!sessionReady) {
    return (
      <View style={styles.rootFill}>
        <View style={[styles.statusBarFill, { height: insets.top }]} />
        <View style={[styles.guestPlaceholder, styles.rootBelowStatus]} />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.rootFill}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
        <View style={[styles.statusBarFill, { height: insets.top }]} />
        <ScrollView
          style={styles.screen}
          contentContainerStyle={styles.skeletonContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.skeletonHeaderCard}>
            <SkeletonBlock width={72} height={72} borderRadius={36} />
            <SkeletonBlock width="50%" height={20} />
            <SkeletonBlock width="80%" height={12} />
            <SkeletonBlock width="65%" height={12} />
          </View>
          <View style={styles.skeletonStatsRow}>
            <SkeletonBlock width="30%" height={52} />
            <SkeletonBlock width="30%" height={52} />
            <SkeletonBlock width="30%" height={52} />
          </View>
          <SkeletonBlock width="100%" height={48} borderRadius={12} />
          <View style={styles.skeletonCard}>
            <SkeletonBlock width="40%" height={14} />
            <SkeletonBlock width="100%" height={16} />
            <SkeletonBlock width="70%" height={14} />
          </View>
          <View style={styles.skeletonCard}>
            <SkeletonBlock width="34%" height={14} />
            <SkeletonBlock width="92%" height={38} borderRadius={10} />
            <SkeletonBlock width="92%" height={38} borderRadius={10} />
          </View>
          <View style={styles.skeletonCard}>
            <SkeletonBlock width="42%" height={14} />
            <SkeletonBlock width="100%" height={40} borderRadius={10} />
            <SkeletonBlock width="100%" height={40} borderRadius={10} />
            <SkeletonBlock width="100%" height={40} borderRadius={10} />
          </View>
          <View style={styles.skeletonFooterSpacer} />
        </ScrollView>
      </View>
    );
  }

  const hasAvatar = Boolean((user?.avatarUrl ?? '').trim());

  return (
    <>
    <View style={styles.rootFill}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      {/** Fixed white strip under status bar (battery / network) — scroll content stays below so icons stay legible. */}
      <View style={[styles.statusBarFill, { height: insets.top }]} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior={Platform.OS === 'ios' ? 'never' : undefined}
      >
      <View style={styles.headerCard}>
        {backgroundRefreshing ? (
          <View style={styles.offlineHintRow}>
            <Ionicons name="cloud-offline-outline" size={14} color={COLORS.textSecondary} />
            <Text style={styles.offlineHintText}>Updating when network is available</Text>
          </View>
        ) : null}
        <View style={styles.headerTopRow}>
          {isSelf ? (
            <View style={styles.headerLeftSpacer} />
          ) : (
            <Pressable
              style={styles.circleIconButton}
              accessibilityRole="button"
              onPress={handleProfileHeaderBack}
            >
              <Ionicons name="arrow-back" size={18} color={COLORS.primary} />
            </Pressable>
          )}
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>Profile</Text>
          </View>
          <View style={styles.headerRightSpacer} />
        </View>

        <View style={styles.avatarBlock}>
          <View style={styles.avatarWithFab}>
            <View style={styles.avatarRing}>
              <UserAvatar
                uri={profileHeaderPhotoUri}
                name={displayName}
                size={72}
              />
              {avatarUploading ? (
                <View style={styles.avatarUploadOverlay}>
                  <ActivityIndicator color={COLORS.primary} />
                </View>
              ) : null}
            </View>
            {isSelf ? (
              <Pressable
                style={[styles.avatarFab, avatarUploading && styles.avatarFabDisabled]}
                onPress={openPhotoOptions}
                disabled={avatarUploading}
                accessibilityRole="button"
                accessibilityLabel="Change profile photo"
                hitSlop={8}
              >
                <Ionicons name="camera" size={17} color={COLORS.primary} />
              </Pressable>
            ) : null}
          </View>
        </View>
        <Text style={styles.name}>{displayName}</Text>
        {(() => {
          const bioLine = isSelf
            ? (user?.bio ?? '').trim() || subjectBioFromApi
            : subjectBioFromApi;
          if (bioLine) {
            return <Text style={styles.bio}>{bioLine}</Text>;
          }
          if (isSelf) {
            return (
              <Text style={styles.bioHint}>Add a short bio from Edit profile.</Text>
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
            accessibilityHint="Opens your trip summary"
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

      {isSelf ? (
        <Pressable
          style={({ pressed }) => [styles.editProfileCta, pressed && styles.editProfileCtaPressed]}
          onPress={() => navigation.navigate('EditProfile')}
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
        >
          <Text style={styles.editProfileCtaText}>Edit profile</Text>
        </Pressable>
      ) : null}

      <View style={styles.performanceCard}>
        <Text style={styles.performanceLabel}>PERFORMANCE</Text>
        <View style={styles.performanceRow}>
          <View style={styles.performanceLeft}>
            <View style={styles.ratingRow}>
              <Ionicons name="star-outline" size={16} color={COLORS.warning} />
              <Text style={styles.ratingValue}>{avgRating > 0 ? avgRating.toFixed(1) : '0.0'}</Text>
              <Text style={[styles.ratingText, { color: ratingQualitativeColor(avgRating) }]}>
                {ratingQualitativeLabel(avgRating)}
              </Text>
            </View>
            <Text style={styles.reviewText}>
              {totalRatings > 0 ? `Based on ${totalRatings} ratings` : 'No ratings yet'}
            </Text>
          </View>

          <Pressable
            style={styles.performanceArrow}
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate('Ratings', {
                userId: targetUserId || undefined,
                displayName: targetDisplayName,
                ...(isSelf && user?.avatarUrl?.trim() ? { avatarUrl: user.avatarUrl.trim() } : {}),
              })
            }
          >
            <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
          </Pressable>
        </View>
      </View>

      {isSelf ? (
        <>
          <Section title="Personal Details">
            <InfoRow icon="person-outline" label="Name" value={user?.name?.trim() || 'Not provided'} />
            <InfoRow icon="mail-outline" label="Email" value={user?.email || 'Not provided'} />
            <InfoRow
              icon="calendar-outline"
              label="Date of birth"
              value={
                user?.dateOfBirth
                  ? (() => {
                      const d = new Date(`${user.dateOfBirth}T12:00:00`);
                      return Number.isNaN(d.getTime())
                        ? user.dateOfBirth
                        : d.toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          });
                    })()
                  : 'Not provided'
              }
            />
            <InfoRow
              icon="male-female-outline"
              label="Gender"
              value={
                user?.gender
                  ? user.gender === 'prefer_not_to_say'
                    ? 'Prefer not to say'
                    : user.gender === 'non_binary'
                      ? 'Non-binary'
                      : user.gender.charAt(0).toUpperCase() + user.gender.slice(1).replace('_', ' ')
                  : 'Not provided'
              }
            />
            <InfoRow icon="call-outline" label="Phone" value={user?.phone?.trim() ? user.phone : 'Not provided'} />
          </Section>

          <View style={styles.vehicleInfoCard}>
            <View style={styles.vehicleInfoHeader}>
              <Ionicons name="car-outline" size={18} color={COLORS.primary} />
              <Text style={styles.vehicleInfoTitle}>Vehicle Information</Text>
            </View>
            {mergedVehicles.length === 0 ? (
              <View style={styles.vehicleEmptyCompact}>
                <View style={styles.rowIcon}>
                  <Ionicons name="car-outline" size={16} color={COLORS.primary} />
                </View>
                <Text style={styles.vehicleEmptyCompactText}>No vehicle added yet</Text>
              </View>
            ) : (
              mergedVehicles.map((v, index) => (
                <View
                  key={v.id}
                  style={[styles.vehicleInfoBlock, index > 0 && styles.vehicleInfoBlockFollow]}
                >
                  <VehicleInformationRow vehicle={v} />
                </View>
              ))
            )}
          </View>

          <View style={styles.menuCard}>
            <NotificationsToggleRow
              value={notificationsSwitchVisualOn}
              onValueChange={onPushNotificationsSwitch}
            />
            <MenuRow
              icon="shield-checkmark-outline"
              title="Account & Security"
              onPress={() => navigation.navigate('AccountSecurity')}
            />
            <Pressable style={styles.menuRow} onPress={logout} accessibilityRole="button">
              <View style={[styles.rowIcon, styles.logoutIconBg]}>
                <Ionicons name="log-out-outline" size={16} color={COLORS.error} />
              </View>
              <Text style={styles.logoutText}>Log Out</Text>
              <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
            </Pressable>
          </View>
        </>
      ) : null}
    </ScrollView>
    </View>

    {isSelf ? (
      <Modal
        visible={photoMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={closePhotoMenu}
        statusBarTranslucent
      >
        <View style={styles.photoMenuRoot}>
          <Pressable
            style={styles.photoMenuBackdrop}
            onPress={closePhotoMenu}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          />
          <View style={styles.photoMenuSheet}>
            <Text style={styles.photoMenuTitle}>Profile photo</Text>
            <View style={styles.photoMenuTitleRule} />
            <Pressable
              style={({ pressed }) => [styles.photoMenuRow, pressed && styles.photoMenuRowPressed]}
              onPress={() => {
                closePhotoMenu();
                void pickAndUpload('library');
              }}
              accessibilityRole="button"
            >
              <Ionicons name="images-outline" size={22} color={COLORS.text} />
              <Text style={styles.photoMenuRowLabel}>Photo library</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.photoMenuRow, pressed && styles.photoMenuRowPressed]}
              onPress={() => {
                closePhotoMenu();
                void pickAndUpload('camera');
              }}
              accessibilityRole="button"
            >
              <Ionicons name="camera-outline" size={22} color={COLORS.text} />
              <Text style={styles.photoMenuRowLabel}>Camera</Text>
            </Pressable>
            {hasAvatar ? (
              <Pressable
                style={({ pressed }) => [styles.photoMenuRow, pressed && styles.photoMenuRowPressed]}
                onPress={() => {
                  closePhotoMenu();
                  void handleRemoveAvatar();
                }}
                accessibilityRole="button"
              >
                <Ionicons name="trash-outline" size={22} color={COLORS.error} />
                <Text style={[styles.photoMenuRowLabel, styles.photoMenuRowLabelDestructive]}>Remove photo</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.photoMenuCancel, pressed && styles.photoMenuRowPressed]}
              onPress={closePhotoMenu}
              accessibilityRole="button"
            >
              <Text style={styles.photoMenuCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    ) : null}
    {!isSelf ? (
      <ProfileTripsBreakdownSheet
        visible={tripsBreakdownVisible}
        onClose={() => setTripsBreakdownVisible(false)}
        completed={tripsCompleted}
        cancelled={tripsCancelled}
        loading={tripsLoading}
        subjectName={displayName}
        completedThisMonth={tripsCompletedThisMonth}
      />
    ) : null}
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function StatItem({
  label,
  value,
  icon,
  onPress,
  accessibilityHint,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  accessibilityHint?: string;
}): React.JSX.Element {
  const iconColor = icon === 'star-outline' || icon === 'star' ? COLORS.warning : COLORS.primary;
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
        accessibilityHint={accessibilityHint}
      >
        {body}
      </Pressable>
    );
  }
  return <View style={styles.statItem}>{body}</View>;
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <View style={styles.infoRow}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={16} color={COLORS.primary} />
      </View>
      <View style={styles.infoTextWrap}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

function VehicleInformationRow({ vehicle }: { vehicle: UserVehicleEntry }): React.JSX.Element {
  const rawPlate = vehicle.licensePlate;
  const plate = rawPlate == null || rawPlate === '' ? '—' : rawPlate;
  const colorStr = vehicle.vehicleColor?.trim() || '—';
  return (
    <View style={styles.vehicleInfoRow}>
      <View style={styles.vehicleInfoThumb}>
        <Ionicons name="car-outline" size={20} color={COLORS.primary} />
      </View>
      <View style={styles.vehicleInfoBody}>
        <Text style={styles.vehicleInfoModel} numberOfLines={1} ellipsizeMode="tail">
          {vehicle.vehicleModel}
        </Text>
        <View style={styles.vehicleInfoMetaRow}>
          <View style={styles.vehicleInfoPlateGroup}>
            <Text style={styles.vehicleInfoMetaLabel}>Plate:</Text>
            <View style={styles.vehiclePlateChip}>
              <Text style={styles.vehiclePlateChipText}>{plate}</Text>
            </View>
          </View>
          <View style={styles.vehicleInfoMetaVsep} />
          <View style={styles.vehicleInfoColorInline}>
            <Text
              style={styles.vehicleInfoColorText}
              numberOfLines={1}
              ellipsizeMode="tail"
            >{`Color: ${colorStr}`}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function NotificationsToggleRow({
  value,
  onValueChange,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
}): React.JSX.Element {
  return (
    <View style={styles.menuRow}>
      <View style={styles.rowIcon}>
        <Ionicons name="notifications-outline" size={16} color={COLORS.primary} />
      </View>
      <View style={styles.menuToggleTextCol}>
        <Text style={styles.menuToggleTitle}>Allow notifications</Text>
        <Text style={styles.menuHint}>When off, ride and message alerts are not sent to this device.</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
        thumbColor={value ? COLORS.primary : COLORS.white}
        ios_backgroundColor={COLORS.border}
      />
    </View>
  );
}

function MenuRow({
  icon,
  title,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  onPress?: () => void;
}): React.JSX.Element {
  const inner = (
    <>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={16} color={COLORS.primary} />
      </View>
      <Text style={styles.menuText}>{title}</Text>
      <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
    </>
  );
  if (onPress) {
    return (
      <Pressable style={styles.menuRow} onPress={onPress} accessibilityRole="button">
        {inner}
      </Pressable>
    );
  }
  return (
    <View style={styles.menuRow} accessibilityRole="text">
      {inner}
    </View>
  );
}

const styles = StyleSheet.create({
  rootFill: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  rootBelowStatus: {
    flex: 1,
  },
  statusBarFill: {
    width: '100%',
    backgroundColor: COLORS.white,
  },
  screen: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  loaderWrap: {
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonContent: {
    padding: 16,
    gap: 12,
  },
  skeletonHeaderCard: {
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 16,
    alignItems: 'center',
    gap: 10,
  },
  skeletonStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  skeletonCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 12,
    gap: 10,
  },
  skeletonFooterSpacer: {
    height: 24,
  },
  guestPlaceholder: {
    backgroundColor: COLORS.backgroundSecondary,
  },
  content: {
    padding: 16,
    paddingBottom: 30,
    paddingTop: 8,
    gap: 10,
  },
  headerTopRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginBottom: 6,
  },
  headerTitleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  headerRightSpacer: {
    width: 30,
    height: 30,
  },
  headerLeftSpacer: {
    width: 30,
    height: 30,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
  },
  editProfileCta: {
    width: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    minHeight: 48,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.22,
        shadowRadius: 6,
      },
      android: { elevation: 3 },
    }),
  },
  editProfileCtaPressed: {
    opacity: 0.92,
  },
  editProfileCtaText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
    letterSpacing: 0.2,
  },
  vehicleInfoCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 3,
      },
      android: { elevation: 1 },
    }),
  },
  vehicleInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 12,
    marginBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  vehicleInfoTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  /** One panel per vehicle — same layout repeated for 2nd, 3rd, etc. */
  vehicleInfoBlock: {
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  vehicleInfoBlockFollow: {
    marginTop: 10,
  },
  vehicleInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  vehicleInfoThumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleInfoBody: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  vehicleInfoModel: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.2,
    lineHeight: 19,
    marginBottom: 4,
  },
  vehicleInfoMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    rowGap: 6,
    minWidth: 0,
  },
  vehicleInfoPlateGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
    maxWidth: '100%',
  },
  vehicleInfoColorInline: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 72,
    justifyContent: 'center',
  },
  vehicleInfoColorText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  vehicleInfoMetaLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textSecondary,
    flexShrink: 0,
  },
  vehicleInfoMetaVsep: {
    width: 1,
    height: 12,
    backgroundColor: COLORS.border,
    flexShrink: 0,
  },
  vehiclePlateChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  vehiclePlateChipText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.35,
    color: COLORS.text,
  },
  vehicleEmptyCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 2,
    minHeight: 36,
  },
  vehicleEmptyCompactText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  headerCard: {
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
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
  avatarBlock: {
    marginTop: 4,
    marginBottom: 8,
    alignItems: 'center',
  },
  avatarWithFab: {
    width: 72,
    height: 72,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: COLORS.white,
    backgroundColor: COLORS.white,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: { elevation: 3 },
    }),
  },
  avatarUploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFab: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.backgroundSecondary,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.12,
        shadowRadius: 3,
      },
      android: { elevation: 4 },
    }),
  },
  avatarFabDisabled: {
    opacity: 0.55,
  },
  photoMenuRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  photoMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  photoMenuSheet: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.borderLight,
    zIndex: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
      },
      android: { elevation: 12 },
    }),
  },
  photoMenuTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    paddingTop: 4,
    paddingBottom: 12,
    paddingHorizontal: 8,
    letterSpacing: 0.2,
  },
  photoMenuTitleRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginHorizontal: 12,
    marginBottom: 4,
  },
  photoMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  photoMenuRowPressed: {
    backgroundColor: COLORS.backgroundSecondary,
  },
  photoMenuRowLabel: {
    fontSize: 17,
    fontWeight: '500',
    color: COLORS.text,
  },
  photoMenuRowLabelDestructive: {
    color: COLORS.error,
    fontWeight: '600',
  },
  photoMenuCancel: {
    marginTop: 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
  },
  photoMenuCancelText: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
  },
  bio: {
    marginTop: 4,
    textAlign: 'center',
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  ridePrefChips: {
    marginTop: 12,
    justifyContent: 'center',
    paddingHorizontal: 4,
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
  offlineHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  offlineHintText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  statsCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    flexDirection: 'row',
    paddingVertical: 10,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
  },
  statValueCenter: { textAlign: 'center' as const },
  statLabel: {
    fontSize: 11,
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
    fontSize: 30,
    lineHeight: 32,
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
  performanceExpanded: {
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    paddingTop: 10,
    gap: 10,
  },
  performanceExpandedTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.textSecondary,
  },
  breakdownCard: {
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  breakdownLabel: {
    width: 72,
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  barTrack: {
    flex: 1,
    height: 8,
    backgroundColor: COLORS.borderLight,
    borderRadius: 999,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 999,
  },
  breakdownCount: {
    width: 34,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '900',
    color: COLORS.text,
  },
  noReviewsText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
    paddingVertical: 6,
  },
  reviewItem: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  reviewHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  reviewFromName: {
    fontSize: 13,
    fontWeight: '900',
    color: COLORS.text,
  },
  reviewTime: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  reviewStarsRow: {
    flexDirection: 'row',
    gap: 4,
  },
  reviewTextExpanded: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  sectionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 12,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 2,
  },
  rowIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(41, 190, 139, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoTextWrap: {
    flex: 1,
    gap: 1,
  },
  infoLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  infoValue: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '600',
  },
  menuCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 2,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  menuText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  menuToggleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  menuToggleTextCol: {
    flex: 1,
    minWidth: 0,
    paddingRight: 4,
  },
  menuHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  logoutIconBg: {
    backgroundColor: '#fef2f2',
  },
  logoutText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.error,
  },
});
