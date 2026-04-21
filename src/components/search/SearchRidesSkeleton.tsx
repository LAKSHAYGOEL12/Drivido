import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../../constants/colors';
import {
  FAB_VISUAL_RISE,
  mainTabBarChromeLayoutStyle,
  mainTabBarSlotHeight,
  mainTabScrollBottomInset,
  TAB_BAR_EXTRA_BOTTOM_INSET,
} from '../../navigation/tabBarMetrics';

const BAR = '#e8eef4';
const BAR_SOFT = '#f1f5f9';

/**
 * Placeholder layout aligned with main tabs + `SearchRides` — cold-start auth restore.
 */
export default function SearchRidesSkeleton(): React.JSX.Element {
  const { bottom: safeBottom } = useSafeAreaInsets();
  const scrollBottomPad = mainTabScrollBottomInset(safeBottom);
  const tabBarSlotHeight = mainTabBarSlotHeight(safeBottom);
  /** Matches {@link MainBottomTabBar} (`BottomTabs.tsx`): pill sits on bottom inset; FAB sits in the Publish column. */
  const bottomPad = safeBottom + TAB_BAR_EXTRA_BOTTOM_INSET;

  return (
    <View style={styles.shell}>
      <SafeAreaView style={styles.bodySafe} edges={['top']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollBottomPad }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.line, { width: '46%', height: 18, marginBottom: 10, backgroundColor: BAR_SOFT }]} />
          <View style={[styles.line, styles.heroTitleBar]} />
          <View style={[styles.line, styles.heroSubBar]} />

          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.iconCol}>
                <View style={styles.greenDot} />
                <View style={styles.dottedLine} />
              </View>
              <View style={styles.inputBlock}>
                <View style={[styles.line, { width: '72%', height: 16 }]} />
                <View style={[styles.line, { width: '28%', height: 11, marginTop: 8, backgroundColor: BAR_SOFT }]} />
              </View>
              <View style={styles.swapPlaceholder} />
            </View>
            <View style={styles.row}>
              <View style={styles.iconCol}>
                <View style={styles.redPin} />
              </View>
              <View style={styles.inputBlock}>
                <View style={[styles.line, { width: '64%', height: 16 }]} />
                <View style={[styles.line, { width: '36%', height: 11, marginTop: 8, backgroundColor: BAR_SOFT }]} />
              </View>
            </View>
            <View style={styles.cardDivider} />
            <View style={styles.row}>
              <View style={[styles.line, { width: 22, height: 22, borderRadius: 11, marginRight: 12 }]} />
              <View style={styles.inputBlock}>
                <View style={[styles.line, { width: '52%', height: 16 }]} />
                <View style={[styles.line, { width: '22%', height: 11, marginTop: 8, backgroundColor: BAR_SOFT }]} />
              </View>
            </View>
            <View style={styles.row}>
              <View style={[styles.line, { width: 22, height: 22, borderRadius: 11, marginRight: 12 }]} />
              <View style={styles.inputBlock}>
                <View style={[styles.line, { width: '40%', height: 16 }]} />
                <View style={[styles.line, { width: '32%', height: 11, marginTop: 8, backgroundColor: BAR_SOFT }]} />
              </View>
            </View>
            <View style={styles.searchButtonPlaceholder} />
          </View>

          <View style={styles.recentsHeader}>
            <View style={[styles.line, { width: 140, height: 12 }]} />
            <View style={[styles.line, { width: 56, height: 12, backgroundColor: BAR_SOFT }]} />
          </View>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.recentRow}>
              <View style={[styles.line, { width: 36, height: 36, borderRadius: 18 }]} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <View style={[styles.line, { width: '88%', height: 14, marginBottom: 8 }]} />
                <View style={[styles.line, { width: '72%', height: 14, marginBottom: 6 }]} />
                <View style={[styles.line, { width: '48%', height: 11, backgroundColor: BAR_SOFT }]} />
              </View>
            </View>
          ))}

          <View style={styles.sessionRow} accessibilityLabel="Loading session">
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={[styles.sessionText, styles.sessionTextSpacing]}>Restoring your session…</Text>
          </View>
        </ScrollView>
      </SafeAreaView>

      <View
        style={[styles.tabBarChrome, mainTabBarChromeLayoutStyle(tabBarSlotHeight)]}
        collapsable={false}
        pointerEvents="box-none"
      >
        <View
          style={[
            styles.tabBarInner,
            { paddingBottom: bottomPad, paddingHorizontal: 20 },
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.tabPillShadow}>
            <View style={styles.tabPill}>
              <View style={styles.tabRow}>
                {TAB_SLOTS.map((slot, index) =>
                  slot.kind === 'fab' ? (
                    <View key={slot.key} style={styles.tabFabSlot}>
                      <View style={styles.tabFabCircle} />
                    </View>
                  ) : (
                    <View key={slot.key} style={styles.tabItem}>
                      <View style={[styles.tabIconCircle, index === 0 && styles.tabIconCircleEmphasis]} />
                    </View>
                  )
                )}
              </View>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

/** Pill slot order: Find, My Trips, publish FAB, Messages, Profile (see `mainTabOrder.ts`). */
const TAB_SLOTS = [
  { key: 'find', kind: 'tab' as const },
  { key: 'rides', kind: 'tab' as const },
  { key: 'publishFab', kind: 'fab' as const },
  { key: 'inbox', kind: 'tab' as const },
  { key: 'profile', kind: 'tab' as const },
] as const;

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: COLORS.backgroundSecondary,
  },
  bodySafe: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  scroll: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  line: {
    borderRadius: 8,
    backgroundColor: BAR,
  },
  heroTitleBar: {
    width: '72%',
    height: 28,
    marginBottom: 10,
    borderRadius: 10,
  },
  heroSubBar: {
    width: '88%',
    height: 18,
    marginBottom: 20,
    borderRadius: 8,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.borderLight,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
  },
  iconCol: {
    width: 22,
    alignItems: 'center',
    marginRight: 12,
  },
  greenDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.primaryMuted38,
  },
  dottedLine: {
    width: 2,
    flex: 1,
    minHeight: 22,
    marginTop: 4,
    marginBottom: 2,
    backgroundColor: COLORS.borderLight,
    borderRadius: 1,
  },
  redPin: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.35)',
  },
  inputBlock: {
    flex: 1,
    justifyContent: 'center',
  },
  swapPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: BAR_SOFT,
    marginLeft: 4,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 10,
    marginLeft: 46,
  },
  searchButtonPlaceholder: {
    marginTop: 18,
    height: 48,
    borderRadius: 14,
    backgroundColor: COLORS.primaryMuted22,
  },
  recentsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 14,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  sessionText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  sessionTextSpacing: {
    marginLeft: 10,
  },
  /** Same stacking model as `MainBottomTabBar`: overlay fixed-height slot so pill + FAB match cold start. */
  tabBarChrome: {
    backgroundColor: 'transparent',
    overflow: 'visible',
    zIndex: 50,
    elevation: 50,
  },
  tabBarInner: {
    flex: 1,
    justifyContent: 'flex-end',
    overflow: 'visible',
  },
  tabPillShadow: {
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 24,
    elevation: 10,
  },
  tabPill: {
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.tabBarPillBorder,
    /** Match `BottomTabs` `floatingPill`. */
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.borderLight,
  },
  /** Matches selected tab well in `MainBottomTabBar`. */
  tabIconCircleEmphasis: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.tabBarSelectedWell,
  },
  tabFabSlot: {
    width: 64,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -FAB_VISUAL_RISE,
    zIndex: 2,
    elevation: 4,
  },
  tabFabCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.primary,
    borderWidth: 2,
    borderColor: COLORS.white,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 10,
  },
});
