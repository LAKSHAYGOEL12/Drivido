import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import type { BookingHistoryTimelineItem, BookingHistoryTone } from '../../utils/bookingHistoryDisplay';

function toneColors(tone: BookingHistoryTone): { dot: string; icon: string; softBg: string } {
  switch (tone) {
    case 'success':
      return { dot: COLORS.success, icon: COLORS.success, softBg: 'rgba(34, 197, 94, 0.1)' };
    case 'danger':
      return { dot: COLORS.error, icon: COLORS.error, softBg: 'rgba(239, 68, 68, 0.08)' };
    case 'warning':
      return { dot: COLORS.warning, icon: COLORS.warning, softBg: 'rgba(245, 158, 11, 0.12)' };
    default:
      return { dot: COLORS.textMuted, icon: COLORS.textSecondary, softBg: 'rgba(148, 163, 184, 0.12)' };
  }
}

type Props = {
  items: BookingHistoryTimelineItem[];
  /** Screen reader label for the list */
  accessibilityLabel?: string;
};

/**
 * Vertical activity timeline for passenger booking events (owner view).
 */
export function BookingHistoryTimeline({
  items,
  accessibilityLabel = 'Booking activity timeline',
}: Props): React.JSX.Element {
  if (items.length === 0) {
    return (
      <Text style={styles.empty} accessibilityRole="text">
        No activity recorded yet for this booking.
      </Text>
    );
  }

  return (
    <View style={styles.card} accessibilityLabel={accessibilityLabel}>
      {items.map((item, index) => {
        const c = toneColors(item.tone);
        const isLast = index === items.length - 1;
        return (
          <View key={item.id} style={styles.row}>
            <View style={styles.rail}>
              <View style={[styles.dotOuter, { borderColor: c.dot, backgroundColor: COLORS.white }]}>
                <View style={[styles.dotInner, { backgroundColor: c.dot }]} />
              </View>
              {!isLast ? <View style={styles.connector} /> : null}
            </View>
            <View style={[styles.body, isLast && styles.bodyLast]}>
              <View style={styles.whenRow}>
                <Text style={styles.whenPrimary} numberOfLines={1}>
                  {item.whenPrimary}
                </Text>
                {item.whenRelative ? (
                  <Text style={styles.whenRelative} numberOfLines={1}>
                    {item.whenRelative}
                  </Text>
                ) : null}
              </View>
              <View style={styles.titleRow}>
                <View style={[styles.iconBubble, { backgroundColor: c.softBg }]}>
                  <Ionicons name={item.icon} size={18} color={c.icon} />
                </View>
                <View style={styles.titleCol}>
                  <Text style={styles.title}>{item.title}</Text>
                  {item.seatsLabel ? (
                    <View style={styles.seatChip}>
                      <Text style={styles.seatChipText}>{item.seatsLabel}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 10,
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  empty: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
    marginTop: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 52,
  },
  bodyLast: {
    paddingBottom: 0,
  },
  rail: {
    width: 22,
    alignItems: 'center',
    marginRight: 12,
  },
  dotOuter: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 3,
  },
  dotInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  connector: {
    flex: 1,
    width: 2,
    marginTop: 2,
    marginBottom: -2,
    backgroundColor: COLORS.border,
    borderRadius: 1,
    minHeight: 28,
  },
  body: {
    flex: 1,
    minWidth: 0,
    paddingBottom: 16,
  },
  whenRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  whenPrimary: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  whenRelative: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleCol: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: 21,
  },
  seatChip: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.white,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  seatChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    letterSpacing: 0.2,
  },
});
