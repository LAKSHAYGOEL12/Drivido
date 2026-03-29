import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../contexts/AuthContext';
import { COLORS } from '../../constants/colors';
import type { ProfileStackParamList } from '../../navigation/types';
import { getUserRatingsSummary } from '../../services/ratings';
import UserAvatar from '../../components/common/UserAvatar';
import { useImagePicker } from '../../hooks/useImagePicker';
import { uploadUserAvatar, deleteUserAvatar } from '../../services/userAvatar';

export default function Profile(): React.JSX.Element {
  const { user, logout, refreshUser, patchUser } = useAuth();
  const { pickFromGallery, takePhoto } = useImagePicker();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const route = useRoute<RouteProp<ProfileStackParamList, 'ProfileHome' | 'ProfileEntry'>>();
  const [profileName, setProfileName] = useState(user?.name?.trim() || 'Drivido User');
  const [avgRating, setAvgRating] = useState(0);
  const [totalRatings, setTotalRatings] = useState(0);
  const [loading, setLoading] = useState(true);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [photoMenuVisible, setPhotoMenuVisible] = useState(false);

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

  const memberSince = (() => {
    const raw = targetUserId === (user?.id ?? '').trim() ? user?.createdAt?.trim() : undefined;
    if (!raw) return '—';
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  })();

  const displayName = profileName || targetDisplayName;
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

  const openPhotoOptions = useCallback(() => {
    if (!isSelf) return;
    setPhotoMenuVisible(true);
  }, [isSelf]);

  useFocusEffect(
    useCallback(() => {
      if (!targetUserId) {
        // Keep loader until the owner `userId` arrives (ProfileEntry).
        // For ProfileHome, we usually always have userId from BottomTabs.
        setLoading(true);
        setAvgRating(0);
        setTotalRatings(0);
        return () => {};
      }

      let cancelled = false;
      setLoading(true);
      void (async () => {
        try {
          // Ratings API is fast; Firestore inside `refreshUser()` can hang — never block the profile spinner on it.
          const summary = await getUserRatingsSummary(targetUserId);
          if (cancelled) return;
          setProfileName(targetDisplayName);
          setAvgRating(summary.avgRating);
          setTotalRatings(summary.totalRatings);
        } catch {
          if (cancelled) return;
          setProfileName(targetDisplayName);
          setAvgRating(0);
          setTotalRatings(0);
        } finally {
          if (!cancelled) setLoading(false);
        }
        if (!cancelled && isSelf) {
          void refreshUser();
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [targetUserId, targetDisplayName, isProfileEntryScreen, isSelf, refreshUser])
  );

  if (loading) {
    return (
      <View style={styles.loaderWrap}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const hasAvatar = Boolean((user?.avatarUrl ?? '').trim());

  return (
    <>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.headerCard}>
        <View style={styles.headerTopRow}>
          {isSelf ? (
            <View style={styles.headerLeftSpacer} />
          ) : (
            <Pressable
              style={styles.circleIconButton}
              accessibilityRole="button"
              onPress={() => {
                const returnTo = route.params?._returnToRideDetail;
                const parentNav = (navigation as any)?.getParent?.();
                if (returnTo?.tab && returnTo.params) {
                  // Back to the ride detail we came from (preserves the other tab's state).
                  parentNav?.navigate?.(returnTo.tab, {
                    screen: 'RideDetail',
                    params: returnTo.params,
                  });
                  return;
                }
                navigation.goBack();
              }}
            >
              <Ionicons name="arrow-back" size={18} color={COLORS.textSecondary} />
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
            <View style={[styles.onlineDot, isSelf && styles.onlineDotSelf]} />
          </View>
        </View>
        <Text style={styles.name}>{displayName}</Text>
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
                ...(isSelf && user?.avatarUrl?.trim() ? { avatarUrl: user.avatarUrl.trim() } : {}),
              })
            }
          >
            <Ionicons name="chevron-forward" size={16} color={COLORS.success} />
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

          <Section title="Vehicle Information">
            <InfoRow icon="car-sport-outline" label="Vehicle" value="Add your vehicle details" />
          </Section>

          <View style={styles.menuCard}>
            <MenuRow icon="settings-outline" title="Settings & Privacy" />
            <MenuRow icon="shield-checkmark-outline" title="Account Security" />
            <Pressable style={styles.menuRow} onPress={logout} accessibilityRole="button">
              <View style={[styles.rowIcon, styles.logoutIconBg]}>
                <Ionicons name="log-out-outline" size={16} color={COLORS.error} />
              </View>
              <Text style={styles.logoutText}>Log Out</Text>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </Pressable>
          </View>
        </>
      ) : null}
    </ScrollView>

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
        <Ionicons name={icon} size={16} color={COLORS.secondary} />
      </View>
      <View style={styles.infoTextWrap}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

function MenuRow({
  icon,
  title,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}): React.JSX.Element {
  return (
    <Pressable style={styles.menuRow} accessibilityRole="button">
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={16} color={COLORS.secondary} />
      </View>
      <Text style={styles.menuText}>{title}</Text>
      <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  loaderWrap: {
    flex: 1,
    backgroundColor: COLORS.white,
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
    marginBottom: 10,
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
  onlineDotSelf: {
    right: undefined,
    left: 0,
    bottom: 4,
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
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.text,
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
    backgroundColor: '#eff6ff',
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
