import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';

type TabKey = 'completed' | 'cancelled';

export type ProfileTripsBreakdownSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** All-time completed trip count (ledger). */
  completed: number;
  cancelled: number;
  loading?: boolean;
  subjectName?: string;
  /** Optional; shown as a small line under the completed blurb (profile total is always all-time). */
  completedThisMonth?: number;
};

function firstName(displayName?: string): string {
  const t = displayName?.trim();
  if (!t) return '';
  return t.split(/\s+/)[0] ?? '';
}

/**
 * Centered modal for someone else’s profile: segments + summary (no last-trip / distance insights).
 */
export function ProfileTripsBreakdownSheet({
  visible,
  onClose,
  completed,
  cancelled,
  loading,
  subjectName,
  completedThisMonth: completedThisMonthProp,
}: ProfileTripsBreakdownSheetProps): React.JSX.Element {
  const [tab, setTab] = useState<TabKey>('completed');

  useEffect(() => {
    if (visible) setTab('completed');
  }, [visible]);

  const fn = firstName(subjectName);
  const cancelledCount = Math.max(0, cancelled);
  const completedAll = Math.max(0, completed);
  /** Profile “Trips” stat is all-time completed + all-time cancelled — same numbers here (not “this month”). */
  const headlineCompleted = completedAll;

  const completedBlurb = fn
    ? `${fn} has completed ${headlineCompleted} trip${headlineCompleted === 1 ? '' : 's'} in total.`
    : `This member has completed ${headlineCompleted} trip${headlineCompleted === 1 ? '' : 's'} in total.`;

  const cancelledBlurb = fn
    ? `${fn} has ${cancelledCount} cancelled trip record${cancelledCount === 1 ? '' : 's'}.`
    : `This member has ${cancelledCount} cancelled trip record${cancelledCount === 1 ? '' : 's'}.`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={styles.card}>
          <View style={styles.modalHeader}>
            <View style={styles.headerSide} />
            <View style={styles.headerTitleRow}>
              <Ionicons name="flash" size={18} color={COLORS.primary} style={styles.headerBolt} />
              <Text style={styles.headerTitle}>Trips</Text>
            </View>
            <Pressable
              onPress={onClose}
              style={styles.headerSide}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={26} color={COLORS.textSecondary} />
            </Pressable>
          </View>
          <View style={styles.headerRule} />
          {subjectName?.trim() ? (
            <Text style={styles.subjectLine} numberOfLines={1}>
              {subjectName.trim()}
            </Text>
          ) : null}

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={COLORS.primary} size="large" />
              <Text style={styles.loadingText}>Loading trip counts…</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={styles.segmentWrap}>
                <View style={styles.segment}>
                  {(['completed', 'cancelled'] as const).map((k) => {
                    const active = tab === k;
                    return (
                      <Pressable
                        key={k}
                        onPress={() => setTab(k)}
                        style={[styles.segmentChip, active && styles.segmentChipActive]}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
                          {k === 'completed' ? 'Completed' : 'Cancelled'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View
                style={[
                  styles.summaryCard,
                  tab === 'completed' ? styles.summaryCardCompleted : styles.summaryCardCancelled,
                ]}
              >
                <View style={styles.summaryWatermarkWrap} pointerEvents="none">
                  <Ionicons
                    name={tab === 'completed' ? 'checkmark' : 'close'}
                    size={160}
                    color={
                      tab === 'completed' ? 'rgba(41, 190, 139, 0.12)' : 'rgba(148, 163, 184, 0.14)'
                    }
                    style={styles.summaryWatermarkIcon}
                  />
                </View>
                <View
                  style={[
                    styles.summaryIconCircle,
                    tab === 'completed' ? styles.summaryIconCircleDone : styles.summaryIconCircleCancelled,
                  ]}
                >
                  <Ionicons
                    name={tab === 'completed' ? 'checkmark' : 'close'}
                    size={22}
                    color={COLORS.white}
                  />
                </View>
                <Text style={styles.summaryNumber}>
                  {tab === 'completed' ? headlineCompleted : cancelledCount}
                </Text>
                <Text style={styles.summaryCaption}>
                  {tab === 'completed' ? 'COMPLETED TRIPS' : 'CANCELLED TRIPS'}
                </Text>
                <Text style={styles.summaryBlurb}>
                  {tab === 'completed' ? completedBlurb : cancelledBlurb}
                </Text>
                {tab === 'completed' && typeof completedThisMonthProp === 'number' ? (
                  <Text style={styles.monthSub}>
                    {completedThisMonthProp} completed this calendar month
                  </Text>
                ) : null}
              </View>

              <Pressable
                style={({ pressed }) => [styles.doneBtn, pressed && styles.doneBtnPressed]}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Done"
              >
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    maxHeight: '88%',
    zIndex: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerSide: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerBolt: {
    marginTop: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginHorizontal: 16,
  },
  subjectLine: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 16,
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 14,
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  scroll: {
    maxHeight: 520,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  segmentWrap: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 14,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  segmentChip: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 11,
  },
  segmentChipActive: {
    backgroundColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  segmentLabelActive: {
    color: COLORS.primary,
  },
  summaryCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 20,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 3,
  },
  summaryCardCompleted: {
    backgroundColor: 'rgba(41, 190, 139, 0.11)',
  },
  summaryCardCancelled: {
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
  },
  summaryWatermarkWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryWatermarkIcon: {
    opacity: 0.9,
    transform: [{ translateY: 6 }],
  },
  summaryIconCircle: {
    alignSelf: 'center',
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    zIndex: 1,
  },
  summaryIconCircleDone: {
    backgroundColor: COLORS.primary,
  },
  summaryIconCircleCancelled: {
    backgroundColor: COLORS.textSecondary,
  },
  summaryNumber: {
    fontSize: 40,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    zIndex: 1,
  },
  summaryCaption: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.7,
    color: COLORS.textSecondary,
    textAlign: 'center',
    zIndex: 1,
  },
  summaryBlurb: {
    marginTop: 8,
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 6,
    zIndex: 1,
  },
  monthSub: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
    textAlign: 'center',
    zIndex: 1,
  },
  doneBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  doneBtnPressed: {
    opacity: 0.88,
  },
  doneText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
});
