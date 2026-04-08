import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { RIDE_PREFERENCE_OPTIONS, normalizeRidePreferenceIds } from '../../constants/ridePreferences';

type Props = {
  /** Raw ids from API (unknown strings are dropped). */
  ids: string[] | undefined;
  /** Extra top margin when placed under bio. */
  style?: object;
};

/**
 * Read-only pills for profile / owner modal — same order as {@link RIDE_PREFERENCE_OPTIONS}.
 */
export default function RidePreferenceChips({ ids, style }: Props): React.JSX.Element | null {
  const normalized = normalizeRidePreferenceIds(ids ?? []);
  const ordered = RIDE_PREFERENCE_OPTIONS.filter((o) => normalized.includes(o.id));
  if (ordered.length === 0) return null;

  return (
    <View
      style={[styles.wrap, style]}
      accessibilityRole="text"
      accessibilityLabel={`Ride preferences: ${ordered.map((o) => o.label).join(', ')}`}
    >
      {ordered.map((o) => (
        <View key={o.id} style={styles.chip}>
          <Ionicons name={o.icon} size={15} color={COLORS.primary} />
          <Text style={styles.chipText}>{o.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 20,
    backgroundColor: 'rgba(41, 190, 139, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(41, 190, 139, 0.35)',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
});
