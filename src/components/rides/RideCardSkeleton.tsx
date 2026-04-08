import React from 'react';
import { StyleSheet, View } from 'react-native';
import { COLORS } from '../../constants/colors';
import SkeletonBlock from '../common/SkeletonBlock';

export default function RideCardSkeleton(): React.JSX.Element {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <SkeletonBlock width="46%" height={12} borderRadius={6} />
        <SkeletonBlock width={54} height={20} borderRadius={8} />
      </View>

      <View style={styles.timeRoutePriceRow}>
        <View style={styles.timeColumn}>
          <SkeletonBlock width={40} height={16} />
          <SkeletonBlock width={34} height={10} />
          <SkeletonBlock width={40} height={16} />
        </View>

        <View style={styles.timeline}>
          <SkeletonBlock width={10} height={10} borderRadius={5} />
          <SkeletonBlock width={2} height={40} borderRadius={1} />
          <SkeletonBlock width={10} height={10} borderRadius={5} />
        </View>

        <View style={styles.routeTextCol}>
          <SkeletonBlock width="82%" height={14} />
          <SkeletonBlock width="74%" height={14} />
        </View>

        <SkeletonBlock width={66} height={20} />
      </View>

      <View style={styles.divider} />

      <View style={styles.footerRow}>
        <SkeletonBlock width={36} height={36} borderRadius={18} />
        <View style={styles.footerText}>
          <SkeletonBlock width="58%" height={13} />
          <SkeletonBlock width="42%" height={10} />
        </View>
        <SkeletonBlock width={16} height={16} borderRadius={8} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  timeRoutePriceRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  timeColumn: {
    width: 56,
    minHeight: 72,
    justifyContent: 'space-between',
    paddingRight: 4,
  },
  timeline: {
    width: 22,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: 8,
    minHeight: 72,
  },
  routeTextCol: {
    flex: 1,
    minHeight: 72,
    justifyContent: 'space-between',
    marginRight: 6,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 8,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerText: {
    flex: 1,
    marginLeft: 8,
    gap: 6,
  },
});
