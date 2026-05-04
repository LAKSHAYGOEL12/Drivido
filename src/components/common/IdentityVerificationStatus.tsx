import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import type { IdentityVerificationViewerState } from '../../utils/identityVerified';

/**
 * Compact pill (and optional rejection reason note) that surfaces identity
 * verification state below a profile avatar.
 *
 * Backend = single source of truth — the caller computes `state` from API
 * payloads via `viewerIdentityVerificationState(...)` and reads
 * `identityVerificationReason` from the auth user. This component is purely
 * presentational and never derives state itself.
 *
 * State legend:
 * - `null`       → renders nothing. Used when a peer is not verified: other
 *                  users see only the ✓ when verified, never any negative-state
 *                  text about someone else.
 * - `verified`   → renders nothing here (the blue ✓ on the avatar speaks for itself).
 * - `pending`    → amber pill, only ever shown to the authenticated user on
 *                  their own profile.
 * - `rejected`   → red pill + admin-supplied reason text below; only ever
 *                  shown to the authenticated user on their own profile.
 * - `unverified` → muted neutral pill, shown only on the user's own profile
 *                  before they upload a document so they know to act on it.
 */
export type IdentityVerificationStatusProps = {
  state: IdentityVerificationViewerState | null;
  /**
   * Admin-supplied note for `state === 'rejected'`. Comes from
   * `user.identityVerificationReason` (auth/me). Displayed verbatim below the
   * pill; falls back to a generic line if empty.
   */
  reason?: string | null;
  style?: StyleProp<ViewStyle>;
};

const REJECTED_FALLBACK = 'Document was rejected. Please re-upload.';

export default function IdentityVerificationStatus({
  state,
  reason,
  style,
}: IdentityVerificationStatusProps): React.JSX.Element | null {
  if (state === null || state === 'verified') return null;

  if (state === 'pending') {
    return (
      <View
        style={[styles.pill, styles.pillPending, style]}
        accessibilityRole="text"
        accessibilityLabel="Identity verification pending review"
      >
        <Ionicons name="hourglass-outline" size={13} color="#b45309" />
        <Text style={[styles.pillText, styles.pillTextPending]}>Verification pending</Text>
      </View>
    );
  }

  if (state === 'rejected') {
    const reasonText = (reason ?? '').trim() || REJECTED_FALLBACK;
    return (
      <View style={[styles.rejectedWrap, style]}>
        <View
          style={[styles.pill, styles.pillRejected]}
          accessibilityRole="text"
          accessibilityLabel="Identity document rejected"
        >
          <Ionicons name="alert-circle-outline" size={13} color="#b91c1c" />
          <Text style={[styles.pillText, styles.pillTextRejected]}>Verification rejected</Text>
        </View>
        <Text
          style={styles.reasonText}
          accessibilityRole="text"
          accessibilityLabel={`Reason: ${reasonText}`}
        >
          {reasonText}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.pill, styles.pillUnverified, style]}
      accessibilityRole="text"
      accessibilityLabel="Identity not verified"
    >
      <Ionicons name="shield-outline" size={13} color={COLORS.textSecondary} />
      <Text style={[styles.pillText, styles.pillTextUnverified]}>Not verified</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },

  pillPending: {
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
  },
  pillTextPending: {
    color: '#b45309',
  },

  pillRejected: {
    backgroundColor: '#fee2e2',
    borderColor: '#fecaca',
  },
  pillTextRejected: {
    color: '#b91c1c',
  },

  pillUnverified: {
    backgroundColor: COLORS.backgroundSecondary,
    borderColor: COLORS.borderLight,
  },
  pillTextUnverified: {
    color: COLORS.textSecondary,
  },

  rejectedWrap: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  reasonText: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '500',
    color: '#991b1b',
    lineHeight: 17,
  },
});
