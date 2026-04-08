import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { formatOwnProfileTripsLine } from '../../services/tripsAggregation';

type Props = {
  completed: number;
  cancelled: number;
  loading?: boolean;
  onPress?: () => void;
  accessibilityHint?: string;
};

/**
 * Trips column for other users’ profiles: same total count as your own profile (completed + cancelled).
 */
export function ProfileTripsStatCell({
  completed,
  cancelled,
  loading,
  onPress,
  accessibilityHint,
}: Props): React.JSX.Element {
  const valueText = formatOwnProfileTripsLine(!!loading, completed, cancelled);
  const a11y = loading
    ? 'Trips: loading'
    : `Trips: ${valueText} total (${completed} completed, ${cancelled} cancelled)`;

  const inner = (
    <View style={styles.inner}>
      <Ionicons name="car-outline" size={14} color={COLORS.primary} />
      <Text style={styles.value} numberOfLines={1}>
        {valueText}
      </Text>
      <Text style={styles.caption}>Trips</Text>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint={accessibilityHint}
      >
        {inner}
      </Pressable>
    );
  }

  return (
    <View style={styles.cell} accessibilityLabel={a11y} accessible>
      {inner}
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 2,
    justifyContent: 'center',
    minHeight: 88,
  },
  inner: {
    alignItems: 'center',
    gap: 2,
  },
  cellPressed: {
    opacity: 0.72,
  },
  value: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    minHeight: 22,
  },
  caption: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
});
