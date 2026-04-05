import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../../constants/colors';

export type ProfileTripsStatPillsVariant = 'statColumn' | 'listRow';

type Props = {
  completed: number;
  cancelled: number;
  loading?: boolean;
  variant?: ProfileTripsStatPillsVariant;
};

/**
 * Production-style completed / cancelled counts: paired metric chips with clear hierarchy.
 */
export function ProfileTripsStatPills({
  completed,
  cancelled,
  loading,
  variant = 'statColumn',
}: Props): React.JSX.Element {
  const list = variant === 'listRow';

  if (loading) {
    return (
      <View style={[styles.loaderWrap, list && styles.loaderWrapList]} accessibilityLabel="Loading trip counts">
        <ActivityIndicator size="small" color={COLORS.textMuted} />
      </View>
    );
  }

  return (
    <View
      style={[styles.row, list && styles.rowList]}
      accessibilityLabel={`${completed} completed, ${cancelled} cancelled`}
    >
      <View style={[styles.chip, styles.chipCompleted, list && styles.chipList]}>
        <Text style={[styles.chipValue, list && styles.chipValueList]}>{completed}</Text>
        <Text style={[styles.chipLabel, list && styles.chipLabelList]} numberOfLines={1}>
          Completed
        </Text>
      </View>
      <View style={[styles.chip, styles.chipCancelled, list && styles.chipList]}>
        <Text style={[styles.chipValue, list && styles.chipValueList]}>{cancelled}</Text>
        <Text style={[styles.chipLabel, list && styles.chipLabelList]} numberOfLines={1}>
          Cancelled
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
    width: '100%',
    maxWidth: 168,
    alignSelf: 'center',
  },
  rowList: {
    maxWidth: '100%',
    flex: 1,
    alignSelf: 'stretch',
    gap: 8,
  },
  loaderWrap: {
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    maxWidth: 168,
    alignSelf: 'center',
  },
  loaderWrapList: {
    maxWidth: '100%',
    height: 40,
    alignSelf: 'stretch',
  },
  chip: {
    flex: 1,
    minWidth: 0,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: 1,
  },
  chipList: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  chipCompleted: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderColor: 'rgba(34, 197, 94, 0.28)',
  },
  chipCancelled: {
    backgroundColor: 'rgba(148, 163, 184, 0.14)',
    borderColor: 'rgba(148, 163, 184, 0.35)',
  },
  chipValue: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
  },
  chipValueList: {
    fontSize: 16,
  },
  chipLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  chipLabelList: {
    fontSize: 10,
    letterSpacing: 0.25,
  },
});
