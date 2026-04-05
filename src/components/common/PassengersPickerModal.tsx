import React, { useState, useEffect } from 'react';
import { Modal, StyleSheet, Text, View, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';

const MIN = 1;
const MAX = 6;

export type PassengersPickerModalProps = {
  visible: boolean;
  onClose: () => void;
  /** Current value (1–6) when opening. */
  value: number;
  /** Called when modal closes (overlay, Close, or back) with chosen count. */
  onDone: (count: number) => void;
};

function clamp(n: number): number {
  if (Number.isNaN(n) || n < MIN) return MIN;
  if (n > MAX) return MAX;
  return Math.round(n);
}

export default function PassengersPickerModal({
  visible,
  onClose,
  value,
  onDone,
}: PassengersPickerModalProps): React.JSX.Element {
  const [draft, setDraft] = useState(() => clamp(value));

  useEffect(() => {
    if (visible) {
      setDraft(clamp(value));
    }
  }, [visible, value]);

  const commitClose = () => {
    onDone(draft);
    onClose();
  };

  const handleRequestClose = () => {
    onDone(draft);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleRequestClose}>
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={commitClose}
      >
        <View style={styles.content} onStartShouldSetResponder={() => true}>
          <Text style={styles.heading}>How many passengers?</Text>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={[styles.stepBtn, draft <= MIN && styles.stepBtnDisabled]}
              onPress={() => setDraft((d) => Math.max(MIN, d - 1))}
              disabled={draft <= MIN}
              activeOpacity={0.7}
            >
              <Ionicons name="remove" size={28} color={draft <= MIN ? COLORS.textMuted : COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.count}>{draft}</Text>
            <TouchableOpacity
              style={[styles.stepBtn, draft >= MAX && styles.stepBtnDisabled]}
              onPress={() => setDraft((d) => Math.min(MAX, d + 1))}
              disabled={draft >= MAX}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={28} color={draft >= MAX ? COLORS.textMuted : COLORS.text} />
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>Between {MIN} and {MAX} passengers</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={commitClose}>
            <Text style={styles.closeBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    paddingTop: 24,
  },
  heading: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 28,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  stepBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: {
    opacity: 0.45,
  },
  count: {
    fontSize: 36,
    fontWeight: '700',
    color: COLORS.text,
    minWidth: 72,
    marginHorizontal: 28,
    textAlign: 'center',
  },
  hint: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: 8,
  },
  closeBtn: {
    marginTop: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
  },
});
