import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../contexts/AuthContext';
import { COLORS } from '../../constants/colors';
import type { ProfileStackParamList } from '../../navigation/types';
import { getUserRatingsSummary } from '../../services/ratings';

export default function Profile(): React.JSX.Element {
  const { user, logout } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList, 'ProfileHome'>>();
  const [profileName, setProfileName] = useState(user?.name?.trim() || 'Drivido User');
  const [avgRating, setAvgRating] = useState(0);
  const [totalRatings, setTotalRatings] = useState(0);
  const [loading, setLoading] = useState(true);
  const displayName = profileName || user?.name?.trim() || 'Drivido User';
  const firstLetter = displayName.charAt(0).toUpperCase();
  const memberSince = (() => {
    const raw = user?.createdAt?.trim();
    if (!raw) return 'Today';
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return 'Today';
    return dt.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  })();

  useFocusEffect(
    useCallback(() => {
      const userId = user?.id?.trim();
      if (!userId) {
        setAvgRating(0);
        setTotalRatings(0);
        setProfileName(user?.name?.trim() || 'Drivido User');
        setLoading(false);
        return () => {};
      }

      let cancelled = false;
      setLoading(true);
      void (async () => {
        try {
          const summary = await getUserRatingsSummary(userId);
          if (cancelled) return;
          setProfileName(user?.name?.trim() || 'Drivido User');
          setAvgRating(summary.avgRating);
          setTotalRatings(summary.totalRatings);
        } catch {
          if (cancelled) return;
          setProfileName(user?.name?.trim() || 'Drivido User');
          setAvgRating(0);
          setTotalRatings(0);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [user?.id, user?.name])
  );

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
          <Pressable style={styles.circleIconButton} accessibilityRole="button">
            <Ionicons name="chevron-back" size={18} color={COLORS.textSecondary} />
          </Pressable>
          <Text style={styles.headerTitle}>Profile</Text>
          <Pressable style={styles.circleIconButton} accessibilityRole="button">
            <Ionicons name="settings-outline" size={18} color={COLORS.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.avatarWrap}>
          <Text style={styles.avatarText}>{firstLetter}</Text>
          <View style={styles.onlineDot} />
        </View>
        <Text style={styles.name}>{displayName}</Text>
        <Text style={styles.bio}>Top-rated urban navigator and tech enthusiast.</Text>
      </View>

      <View style={styles.statsCard}>
        <StatItem label="Trips" value="0" icon="car-outline" />
        <StatItem label="Rating" value={avgRating > 0 ? avgRating.toFixed(1) : '0'} icon="star-outline" />
        <StatItem label="Since" value={memberSince} icon="calendar-outline" />
      </View>

      <Pressable style={styles.editButton} accessibilityRole="button">
        <Text style={styles.editButtonText}>Edit Profile</Text>
      </Pressable>

      <View style={styles.performanceCard}>
        <Text style={styles.performanceLabel}>PERFORMANCE</Text>
        <View style={styles.performanceRow}>
          <View style={styles.performanceLeft}>
            <View style={styles.ratingRow}>
              <Ionicons name="star-outline" size={16} color="#f59e0b" />
              <Text style={styles.ratingValue}>{avgRating > 0 ? avgRating.toFixed(1) : '0.0'}</Text>
              <Text style={styles.ratingText}>Excellent</Text>
            </View>
            <Text style={styles.reviewText}>Based on {totalRatings} reviews</Text>
          </View>
          <Pressable
            style={styles.performanceArrow}
            accessibilityRole="button"
            onPress={() => navigation.navigate('Ratings')}
          >
            <Ionicons name="chevron-forward" size={16} color="#6d6be9" />
          </Pressable>
        </View>
      </View>

      <Section title="Personal Details">
        <InfoRow icon="call-outline" label="Phone Number" value={user?.phone || 'Not provided'} />
        <InfoRow icon="mail-outline" label="Email Address" value={user?.email || 'Not provided'} />
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
    </ScrollView>
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
  return (
    <View style={styles.statItem}>
      <Ionicons name={icon} size={14} color={COLORS.secondary} />
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
    paddingTop: 22,
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
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
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
  editButton: {
    backgroundColor: '#5b5be8',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  editButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
  },
  performanceCard: {
    backgroundColor: '#f5f6ff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dfe2ff',
    padding: 12,
    gap: 8,
  },
  performanceLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#c2c6d9',
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
    backgroundColor: '#eef0ff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#d9ddff',
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
