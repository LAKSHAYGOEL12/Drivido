import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../../constants/colors';

const BAR = '#e8eef4';
const BAR_SOFT = '#f1f5f9';

/** Matches `BottomTabs` — extra inset above home indicator, not duplicated in `tabBarStyle.paddingBottom`. */
const TAB_BAR_EXTRA_BOTTOM_INSET = 6;

/**
 * Placeholder layout aligned with main tabs + `SearchRides` — cold-start auth restore.
 */
export default function SearchRidesSkeleton(): React.JSX.Element {
  const { bottom: safeBottom } = useSafeAreaInsets();
  const tabBarPaddingBottom = safeBottom + TAB_BAR_EXTRA_BOTTOM_INSET;

  return (
    <View style={styles.shell}>
      <SafeAreaView style={styles.bodySafe} edges={['top']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
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
            <Text style={[styles.sessionText, styles.sessionTextSpacing]}>Restoring session…</Text>
          </View>
        </ScrollView>
      </SafeAreaView>

      <View style={[styles.tabBar, { paddingBottom: tabBarPaddingBottom }]}>
        {TAB_SLOTS.map((slot, index) => (
          <View key={slot.key} style={styles.tabItem}>
            <View style={[styles.tabIconCircle, index === 0 && styles.tabIconCircleActive]} />
            <View
              style={[
                styles.tabLabelBar,
                index === 0 && styles.tabLabelBarActive,
                { width: slot.labelWidth },
              ]}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

/** Order matches `BottomTabs`: Find, Publish, Rides, Chats, Profile */
const TAB_SLOTS = [
  { key: 'find', labelWidth: 30 },
  { key: 'publish', labelWidth: 44 },
  { key: 'rides', labelWidth: 34 },
  { key: 'chats', labelWidth: 36 },
  { key: 'profile', labelWidth: 40 },
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
    paddingBottom: 28,
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
    backgroundColor: 'rgba(41, 190, 139, 0.35)',
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
    backgroundColor: 'rgba(41, 190, 139, 0.22)',
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
  tabBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingHorizontal: 2,
    backgroundColor: COLORS.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 2,
  },
  tabIconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: BAR,
  },
  tabIconCircleActive: {
    backgroundColor: 'rgba(41, 190, 139, 0.28)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(41, 190, 139, 0.55)',
  },
  tabLabelBar: {
    marginTop: 5,
    height: 9,
    borderRadius: 5,
    backgroundColor: BAR_SOFT,
  },
  tabLabelBarActive: {
    backgroundColor: 'rgba(41, 190, 139, 0.35)',
  },
});
