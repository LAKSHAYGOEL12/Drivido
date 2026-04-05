import React from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';

export type CancelRideConfirmModalProps = {
  visible: boolean;
  onClose: () => void;
  /** User confirmed they want to cancel the ride (destructive). */
  onConfirmCancel: () => void;
};

/**
 * Styled confirmation for owner cancel-ride flow (replaces system Alert for this case).
 */
export default function CancelRideConfirmModal({
  visible,
  onClose,
  onConfirmCancel,
}: CancelRideConfirmModalProps): React.JSX.Element {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Keep ride, dismiss"
        />
        <View style={styles.card} accessibilityRole="alert">
          <View style={styles.iconCircle}>
            <Ionicons name="alert-circle-outline" size={28} color={COLORS.error} />
          </View>
          <Text style={styles.title}>Cancel this ride?</Text>
          <Text style={styles.body}>
            Passengers will be notified. This can&apos;t be undone.
          </Text>
          <TouchableOpacity
            style={styles.btnKeep}
            onPress={onClose}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel="Keep ride"
          >
            <Text style={styles.btnKeepText}>Keep ride</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnCancel}
            onPress={onConfirmCancel}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel="Cancel ride"
          >
            <Text style={styles.btnCancelText}>Cancel ride</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
  },
  card: {
    backgroundColor: COLORS.background,
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
      },
      android: { elevation: 12 },
    }),
  },
  iconCircle: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.2,
  },
  body: {
    fontSize: 15,
    fontWeight: '400',
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 22,
    paddingHorizontal: 4,
  },
  btnKeep: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  btnKeepText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
  btnCancel: {
    backgroundColor: 'transparent',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
  },
  btnCancelText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.error,
  },
});
