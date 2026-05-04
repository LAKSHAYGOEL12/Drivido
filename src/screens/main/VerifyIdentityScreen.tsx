/**
 * Standalone identity-verification flow reached from Profile.
 *
 * Used when the user skipped identity verification during onboarding
 * (`CompleteProfile`) or wants to retry after a previous failure.
 *
 * Backend = single source of truth:
 * - Frontend never marks the user verified locally.
 * - On successful upload the server flips `identityVerificationStatus` to
 *   `'pending'` and we refresh `/auth/me` to reflect that. The blue ✓ badge
 *   only lights up after an admin manually flips `isIdentityVerified: true`
 *   in Mongo.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Alert } from '../../utils/themedAlert';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { COLORS } from '../../constants/colors';
import type { ProfileStackParamList } from '../../navigation/types';
import {
  validation,
  validationErrors,
  normalizeIdentityNumber,
  type IdentityDocumentValue,
} from '../../constants/validation';
import { useImagePicker } from '../../hooks/useImagePicker';
import { uploadIdentityDocument } from '../../services/identityDocument';
import IdentityVerificationCard, {
  type IdentityCardErrors,
  type IdentityCardValue,
} from '../../components/profile/IdentityVerificationCard';

type Nav = NativeStackNavigationProp<ProfileStackParamList, 'VerifyIdentity'>;

/**
 * Reserved scroll padding so the last field clears the absolutely-positioned
 * Submit footer that overlays the bottom of the ScrollView. Mirrors the
 * Edit Profile screen's proven pattern.
 */
const SCROLL_PADDING_ABOVE_FOOTER = 120;

export default function VerifyIdentityScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { user, refreshUser } = useAuth();

  const initialFromUser = !!user?.identityVerificationStatus;

  const [value, setValue] = useState<IdentityCardValue>({
    type: '',
    number: '',
    photoUri: null,
    label: '',
  });
  const [errors, setErrors] = useState<IdentityCardErrors>({});
  const [submitting, setSubmitting] = useState(false);
  /**
   * Live keyboard height. State drives ScrollView's `paddingBottom`; the ref
   * mirrors the latest value so the focus handler (which fires before the
   * keyboard finishes animating) can read a fresh height inside its delayed
   * timeout. Same pattern used in AccountSecurityScreen.
   */
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);
  /** Inner content View ref — used as the `measureLayout` reference frame for the focused field. */
  const scrollContentRef = useRef<View | null>(null);

  const { pickFromGallery, takePhoto } = useImagePicker();

  useEffect(() => {
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subShow = Keyboard.addListener(show, (e) => {
      setKeyboardBottomInset(e.endCoordinates?.height ?? 0);
    });
    const subHide = Keyboard.addListener(hide, () => {
      setKeyboardBottomInset(0);
    });
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  const pickPhoto = useCallback(
    async (source: 'library' | 'camera') => {
      const picked =
        source === 'library'
          ? await pickFromGallery({ aspect: [4, 3], quality: 0.85 })
          : await takePhoto({ aspect: [4, 3], quality: 0.85 });
      if (picked?.uri) {
        setValue((prev) => ({ ...prev, photoUri: picked.uri }));
        setErrors((e) => ({ ...e, identityPhoto: undefined }));
      }
    },
    [pickFromGallery, takePhoto]
  );

  const promptPhotoSource = useCallback(() => {
    Alert.alert(
      'Document photo',
      'Choose where to add the document photo from.',
      [
        { text: 'Take photo', onPress: () => void pickPhoto('camera') },
        { text: 'Choose from gallery', onPress: () => void pickPhoto('library') },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true }
    );
  }, [pickPhoto]);

  const validateForm = (): {
    documentType: IdentityDocumentValue;
    documentNumber: string;
    documentLabel?: string;
  } | null => {
    const next: IdentityCardErrors = {};
    if (!value.type || !value.number.trim()) {
      next.identity = validationErrors.identityIncomplete;
    } else if (!validation.identityNumber(value.number, value.type)) {
      next.identity =
        value.type === 'aadhaar'
          ? validationErrors.identityAadhaar
          : value.type === 'pan'
            ? validationErrors.identityPan
            : value.type === 'driver_license'
              ? validationErrors.identityDriverLicense
              : validationErrors.identityOther;
    }
    if (value.type === 'other' && !validation.identityLabel(value.label ?? '')) {
      next.identityLabel = validationErrors.identityLabel;
    }
    if (!value.photoUri) {
      next.identityPhoto = 'Document photo is required.';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    return {
      documentType: value.type as IdentityDocumentValue,
      documentNumber: normalizeIdentityNumber(value.number),
      documentLabel: value.type === 'other' ? (value.label ?? '').trim() : undefined,
    };
  };

  const handleSubmit = async () => {
    if (submitting) return;
    const ready = validateForm();
    if (!ready || !value.photoUri) return;
    setSubmitting(true);
    try {
      await uploadIdentityDocument({
        documentType: ready.documentType,
        documentNumber: ready.documentNumber,
        documentLabel: ready.documentLabel,
        localUri: value.photoUri,
      });
      try {
        await refreshUser();
      } catch {
        /** Best-effort — auth/me on next focus will pick up the new status. */
      }
      Alert.alert(
        'Document submitted',
        'Your document is under review. Verification appears on your profile once approved.',
        [{ text: 'Done', onPress: () => navigation.goBack() }],
        { cancelable: false }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not submit your document. Try again.';
      Alert.alert('Upload failed', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const wasRejected = user?.identityVerificationStatus === 'rejected';
  const rejectionReason = (user?.identityVerificationReason ?? '').trim();
  const submitLabel = initialFromUser ? 'Resubmit' : 'Submit';
  const helperLine = wasRejected
    ? 'Your previous submission was rejected. Re-upload to retry.'
    : initialFromUser
      ? 'Replace the document on file. Status returns to pending.'
      : 'Submit a government-issued ID. Reviewed manually.';

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.surface} />
      <View style={[styles.statusBarFill, { height: insets.top }]} />

      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.headerBack, pressed && styles.headerBackPressed]}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Verify identity</Text>
        <View style={styles.headerBackPlaceholder} />
      </View>

      <View style={styles.body}>
        <KeyboardAvoidingView
          style={styles.kav}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 52 : 0}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: SCROLL_PADDING_ABOVE_FOOTER + insets.bottom + keyboardBottomInset },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <View ref={scrollContentRef} collapsable={false} style={styles.scrollInner}>
              <View style={styles.heroPanel}>
                <View style={styles.heroIconWrap}>
                  <Ionicons name="shield-checkmark-outline" size={26} color={COLORS.secondary} />
                </View>
                <Text style={styles.heroTitle}>Identity verification</Text>
                <Text style={styles.heroLead}>{helperLine}</Text>
              </View>

              {wasRejected ? (
                <View style={styles.rejectionPanel}>
                  <View style={styles.rejectionHeader}>
                    <Ionicons name="alert-circle" size={18} color="#b91c1c" />
                    <Text style={styles.rejectionTitle}>Previous submission rejected</Text>
                  </View>
                  <Text style={styles.rejectionBody}>
                    {rejectionReason ||
                      'Document was rejected. Please upload a clearer image of a valid ID.'}
                  </Text>
                </View>
              ) : null}

              <IdentityVerificationCard
                value={value}
                onChange={(next) => {
                  setValue(next);
                  setErrors((e) => ({
                    ...e,
                    identity: next.type !== value.type ? undefined : e.identity,
                    identityPhoto: next.photoUri ? undefined : e.identityPhoto,
                    identityLabel:
                      next.type !== 'other' || (next.label ?? '').trim().length > 0
                        ? undefined
                        : e.identityLabel,
                  }));
                }}
                errors={errors}
                onPickPhoto={promptPhotoSource}
                scrollRef={scrollRef}
                scrollContentRef={scrollContentRef}
                mode="required"
                disabled={submitting}
              />

              <View style={styles.notePanel}>
                <Ionicons name="lock-closed-outline" size={14} color={COLORS.textSecondary} />
                <Text style={styles.noteText}>
                  Stored privately. Used only for identity verification.
                </Text>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        <View
          style={[
            styles.footer,
            {
              paddingBottom: Math.max(insets.bottom, 12),
              bottom: keyboardBottomInset,
            },
          ]}
        >
          <Pressable
            onPress={handleSubmit}
            disabled={submitting}
            style={({ pressed }) => [
              styles.submitBtn,
              submitting && styles.submitBtnDisabled,
              pressed && !submitting && styles.submitBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={submitLabel}
          >
            {submitting ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.submitBtnText}>{submitLabel}</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.backgroundSecondary,
  },
  statusBarFill: {
    backgroundColor: COLORS.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerBack: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBackPressed: {
    backgroundColor: COLORS.backgroundSecondary,
  },
  headerBackPlaceholder: {
    width: 36,
    height: 36,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  body: {
    flex: 1,
    position: 'relative',
  },
  kav: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  scrollInner: {
    paddingTop: 16,
    gap: 14,
  },
  heroPanel: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.tabBarPillBorder,
    alignItems: 'flex-start',
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.06,
        shadowRadius: 16,
      },
      android: { elevation: 2 },
    }),
  },
  heroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(37, 99, 235, 0.10)',
    marginBottom: 10,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.4,
    marginBottom: 6,
  },
  heroLead: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  notePanel: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.borderLight,
  },
  noteText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textSecondary,
    lineHeight: 17,
  },
  rejectionPanel: {
    backgroundColor: '#fef2f2',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#fecaca',
    gap: 6,
  },
  rejectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rejectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#991b1b',
    letterSpacing: -0.1,
  },
  rejectionBody: {
    fontSize: 13,
    fontWeight: '500',
    color: '#7f1d1d',
    lineHeight: 18,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: COLORS.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.06,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
    }),
  },
  submitBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  submitBtnDisabled: {
    opacity: 0.55,
  },
  submitBtnPressed: {
    opacity: 0.9,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: -0.2,
  },
});
