import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CommonActions, useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import {
  loadRecentPublished,
  type RecentPublishedEntry,
} from '../../services/recent-published-storage';
import { useAuth } from '../../contexts/AuthContext';
import { formatPublishStyleDateLabel } from '../../utils/rideDisplay';
import { navigatePublishStackToNewRideWizard } from '../../navigation/navigatePublishStackNewRideWizard';
import { briefRouteListLabel } from '../../utils/routeListBriefLabel';

function formatTimeLabel(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function formatPublishedMetaLine(e: RecentPublishedEntry): string {
  const [y, m, d] = e.dateYmd.split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(y, m - 1, d);
  const label = formatPublishStyleDateLabel(dt);
  const time = formatTimeLabel(e.hour, e.minute);
  const pax = e.seats === 1 ? '1 seat' : `${e.seats} seats`;
  const fare = e.rate.trim() ? `\u20B9${e.rate}` : '\u2014';
  const mode = e.instantBooking ? 'Instant' : 'Request';
  return `${label} \u00B7 ${time} \u00B7 ${pax} \u00B7 ${fare} \u00B7 ${mode}`;
}

/**
 * FAB “Reuse recent”: pick a saved route without the legacy full Publish form.
 *
 * Two visual states intentionally diverge:
 * - **Empty** uses a polished icon-led "No saved routes yet" call-to-action.
 *   This was a deliberate redesign and we keep it as-is.
 * - **Populated** uses the established card-style list (accent strip, icon
 *   circle, From → To stack, meta line). Users explicitly asked us not to
 *   replace this layout — it's the canonical "saved routes" presentation in
 *   the rest of the app, so consistency wins over churn.
 */
export default function PublishRecentsPickerScreen(): React.JSX.Element {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const recentUserKey = useMemo(() => (user?.id ?? user?.phone ?? '').trim(), [user?.id, user?.phone]);
  const [rows, setRows] = useState<RecentPublishedEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await loadRecentPublished(recentUserKey);
      if (!cancelled) {
        setRows(list);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recentUserKey]);

  const onPick = useCallback(
    (entry: RecentPublishedEntry) => {
      navigation.navigate('PublishRecentEdit', { entry });
    },
    [navigation]
  );

  const onStartNew = useCallback(() => {
    navigatePublishStackToNewRideWizard(navigation as { dispatch: (a: unknown) => void }, { exitToTab: 'SearchStack' });
  }, [navigation]);

  const onBack = useCallback(() => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'Main',
        params: {
          screen: 'SearchStack',
          params: {
            screen: 'SearchRides',
            params: { _tabResetToken: Date.now() },
          },
        },
        merge: false,
      } as never)
    );
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        onBack();
        return true;
      });
      return () => sub.remove();
    }, [onBack])
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={[styles.header, { paddingTop: 8 }]}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>Reuse a route</Text>
        <View style={styles.headerRight} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : rows.length === 0 ? (
        // Redesigned empty state — kept per product feedback.
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="navigate-outline" size={26} color={COLORS.primary} />
          </View>
          <Text style={styles.emptyTitle}>No saved routes yet</Text>
          <Text style={styles.emptyText}>Routes you publish will appear here for quick reuse.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={onStartNew} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Publish a ride</Text>
          </TouchableOpacity>
        </View>
      ) : (
        // Populated list — preserved from the prior design (card with accent
        // strip + icon circle + From → To stack + meta line).
        <>
          <Text style={styles.subtitle}>Pick a ride you published before, or start a new one.</Text>
          <FlatList
            data={rows}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.pubRecentItem, pressed && styles.pubRecentItemPressed]}
                onPress={() => onPick(item)}
                accessibilityRole="button"
                accessibilityLabel={`Reuse route from ${briefRouteListLabel(item.pickup)} to ${briefRouteListLabel(item.destination)}`}
              >
                <View style={styles.pubRecentAccent} />
                <View style={styles.pubRecentItemMain}>
                  <View style={styles.pubRecentIconCircle}>
                    <Ionicons name="navigate-outline" size={16} color={COLORS.primary} />
                  </View>
                  <View style={styles.pubRecentTextCol}>
                    <View style={styles.pubRecentRouteStack}>
                      <Text style={styles.pubRecentRouteTitle} numberOfLines={1} ellipsizeMode="tail">
                        {briefRouteListLabel(item.pickup)}
                      </Text>
                      <View style={styles.pubRecentArrowRow}>
                        <View style={styles.pubRecentArrowLine} />
                        <Ionicons name="arrow-down" size={12} color={COLORS.textMuted} />
                        <View style={styles.pubRecentArrowLine} />
                      </View>
                      <Text style={styles.pubRecentRouteSubtitle} numberOfLines={1} ellipsizeMode="tail">
                        {briefRouteListLabel(item.destination)}
                      </Text>
                    </View>
                    <Text style={styles.pubRecentMeta} numberOfLines={1}>
                      {formatPublishedMetaLine(item)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.border} style={styles.pubRecentChevron} />
                </View>
              </Pressable>
            )}
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.backgroundSecondary },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  backBtn: { padding: 8, width: 44 },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
  },
  headerRight: { width: 44 },

  subtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textSecondary,
    paddingHorizontal: 20,
    marginBottom: 16,
    lineHeight: 20,
  },

  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // ───── Empty state (kept from the redesign) ─────────────────────────────
  emptyWrap: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(37, 99, 235, 0.10)',
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 22,
  },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    minWidth: 180,
    alignItems: 'center',
  },
  primaryBtnText: { color: COLORS.white, fontSize: 15, fontWeight: '800', letterSpacing: -0.1 },

  // ───── Populated list (restored to the previous card design) ────────────
  pubRecentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 9,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
    overflow: 'hidden',
  },
  pubRecentItemPressed: { opacity: 0.92 },
  pubRecentAccent: {
    alignSelf: 'stretch',
    width: 4,
    backgroundColor: COLORS.primary,
  },
  pubRecentItemMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingLeft: 10,
    paddingRight: 12,
    minHeight: 48,
  },
  pubRecentIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primaryMuted22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  pubRecentTextCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  pubRecentRouteStack: {
    marginBottom: 4,
  },
  pubRecentRouteTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 20,
  },
  pubRecentArrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 2,
  },
  pubRecentArrowLine: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    flex: 1,
  },
  pubRecentRouteSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  pubRecentMeta: {
    fontSize: 12.5,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginTop: 4,
    lineHeight: 18,
  },
  pubRecentChevron: {
    marginLeft: 10,
  },
});
