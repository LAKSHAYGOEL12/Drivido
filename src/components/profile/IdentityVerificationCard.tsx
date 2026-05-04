/**
 * Reusable identity-verification panel.
 *
 * Shipped on:
 * - Onboarding (`CompleteProfile`) where the whole block is **optional**
 *   (the user can skip it and finish onboarding).
 * - The standalone `VerifyIdentity` screen reached from Profile, where the
 *   block is **required** (the screen exists solely to capture this data).
 *
 * The component is presentational + controlled — it owns no business state.
 * Parents pass the current values, validation errors, and a single
 * `onPickPhoto` callback (parents choose camera vs gallery to keep
 * permissions/UX consistent with the rest of the screen).
 *
 * Backend = SSOT for the verified ✓ flag; this card never derives or sets
 * verification state. It only collects the document type + number + photo
 * and hands them to `uploadIdentityDocument` upstream.
 */
import React, { useRef } from 'react';
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import {
  IDENTITY_DOCUMENT_OPTIONS,
  type IdentityDocumentValue,
} from '../../constants/validation';
import { bumpFieldAboveKeyboard } from '../../utils/scrollFieldAboveKeyboard';

const IDENTITY_PLACEHOLDER: Record<IdentityDocumentValue, string> = {
  aadhaar: '12-digit Aadhaar number',
  pan: 'ABCDE1234F',
  driver_license: 'License number',
  other: 'Passport / national ID number',
};

const IDENTITY_KEYBOARD: Record<IdentityDocumentValue, 'number-pad' | 'default'> = {
  aadhaar: 'number-pad',
  pan: 'default',
  driver_license: 'default',
  other: 'default',
};

/**
 * Hard limit enforced by the TextInput's `maxLength`. Must match the slice
 * length used inside `clampIdentityNumberInput` so the OS rejects the
 * keystroke natively instead of letting it land for one frame and then
 * vanishing on the next render (the "type-then-disappear" flicker).
 */
const IDENTITY_MAX_LENGTH: Record<IdentityDocumentValue, number> = {
  aadhaar: 12,
  pan: 10,
  driver_license: 20,
  other: 35,
};

export type IdentityCardValue = {
  type: '' | IdentityDocumentValue;
  number: string;
  photoUri: string | null;
  /**
   * User-supplied document name, only meaningful when `type === 'other'`
   * (e.g., "Passport", "Voter ID"). Empty string for the three known types.
   */
  label?: string;
};

export type IdentityCardErrors = {
  identity?: string;
  identityPhoto?: string;
  identityLabel?: string;
};

const IDENTITY_LABEL_MAX_LENGTH = 40;

export type IdentityVerificationCardProps = {
  value: IdentityCardValue;
  onChange: (next: IdentityCardValue) => void;
  errors?: IdentityCardErrors;
  onPickPhoto: () => void;
  /** When `true`, render no panel/heading chrome — just the form fields. */
  embedded?: boolean;
  /**
   * `'optional'` shows an "(optional)" tag on the heading and lets the user
   * leave everything blank. `'required'` shows a red asterisk and assumes the
   * caller validates the fields. Default `'optional'`.
   */
  mode?: 'optional' | 'required';
  /** Disable all inputs (e.g. while saving). */
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /**
   * Wire the card into a parent ScrollView so it can scroll the focused
   * TextInput to a comfortable position near the top. Both refs must be
   * provided together; if either is missing, no auto-scroll happens
   * (caller falls back to native keyboard behavior).
   *
   * - `scrollRef`: the ScrollView that wraps the card (for `scrollTo`).
   * - `scrollContentRef`: the inner content View of that ScrollView,
   *   wrapped with `<View ref={scrollContentRef} collapsable={false}>`.
   *   Anchor positions are measured against this view, exactly the way
   *   EditProfileScreen does it.
   */
  scrollRef?: React.RefObject<ScrollView | null>;
  scrollContentRef?: React.RefObject<View | null>;
};

/**
 * Constrains the user-entered number to the alphabet allowed for that document
 * type. Backend re-validates; this is just a UX cleanup so the keyboard maps
 * cleanly and the user can't paste obvious garbage.
 */
function clampIdentityNumberInput(raw: string, type: IdentityDocumentValue): string {
  if (type === 'aadhaar') return raw.replace(/\D/g, '').slice(0, 12);
  if (type === 'pan') return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  if (type === 'driver_license') {
    return raw.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 20);
  }
  return raw.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 35);
}

export default function IdentityVerificationCard({
  value,
  onChange,
  errors,
  onPickPhoto,
  embedded = false,
  mode = 'optional',
  disabled = false,
  style,
  scrollRef,
  scrollContentRef,
}: IdentityVerificationCardProps): React.JSX.Element {
  const { type, number, photoUri, label = '' } = value;
  const isOptional = mode === 'optional';

  /** Anchors live INSIDE the card so we can measure each field reliably. */
  const labelAnchorRef = useRef<View | null>(null);
  const numberAnchorRef = useRef<View | null>(null);

  const liftAnchor = (anchorRef: React.RefObject<View | null>) => {
    if (!scrollRef || !scrollContentRef) return;
    bumpFieldAboveKeyboard({ scrollRef, anchorRef, scrollContentRef });
  };

  const setType = (next: '' | IdentityDocumentValue) => {
    onChange({ type: next, number: '', photoUri: null, label: '' });
  };
  const setNumber = (raw: string) => {
    if (!type) return;
    onChange({ type, number: clampIdentityNumberInput(raw, type), photoUri, label });
  };
  const setLabel = (raw: string) => {
    if (type !== 'other') return;
    const cleaned = raw.replace(/[^A-Za-z0-9 ()\-/&.]/g, '').slice(0, IDENTITY_LABEL_MAX_LENGTH);
    onChange({ type, number, photoUri, label: cleaned });
  };
  const removePhoto = () => {
    onChange({ type, number, photoUri: null, label });
  };

  return (
    <View style={[embedded ? null : styles.panel, style]}>
      {!embedded ? <Text style={styles.panelOverline}>Identity verification</Text> : null}

      <Text style={styles.panelLead}>
        Document{' '}
        {isOptional ? (
          <Text style={styles.optionalTag}>(optional)</Text>
        ) : (
          <Text style={styles.asterisk}>*</Text>
        )}
      </Text>

      <View style={styles.chipWrap}>
        {IDENTITY_DOCUMENT_OPTIONS.map((opt) => {
          const active = type === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => setType(active ? '' : opt.value)}
              disabled={disabled}
              style={({ pressed }) => [
                styles.chip,
                active && styles.chipOn,
                pressed && !disabled && styles.chipPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={opt.label}
            >
              <Text style={[styles.chipLabel, active && styles.chipLabelOn]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {type ? (
        <>
          {type === 'other' ? (
            <>
              <Text style={[styles.fieldLabel, styles.fieldLabelFirst]}>
                Identity name <Text style={styles.asterisk}>*</Text>
              </Text>
              <View ref={labelAnchorRef} collapsable={false}>
                <TextInput
                  style={[styles.textField, errors?.identityLabel ? styles.fieldError : null]}
                  value={label}
                  onChangeText={setLabel}
                  placeholder="Document name"
                  placeholderTextColor={COLORS.textMuted}
                  autoCapitalize="words"
                  autoCorrect={false}
                  maxLength={IDENTITY_LABEL_MAX_LENGTH}
                  editable={!disabled}
                  onFocus={() => liftAnchor(labelAnchorRef)}
                />
              </View>
              {errors?.identityLabel ? (
                <Text style={styles.errText}>{errors.identityLabel}</Text>
              ) : null}

              <Text style={styles.fieldLabel}>
                Document number <Text style={styles.asterisk}>*</Text>
              </Text>
            </>
          ) : null}

          <View ref={numberAnchorRef} collapsable={false}>
            <TextInput
              style={[styles.textField, errors?.identity ? styles.fieldError : null]}
              value={number}
              onChangeText={setNumber}
              placeholder={IDENTITY_PLACEHOLDER[type]}
              placeholderTextColor={COLORS.textMuted}
              keyboardType={IDENTITY_KEYBOARD[type]}
              autoCapitalize={type === 'aadhaar' ? 'none' : 'characters'}
              autoCorrect={false}
              maxLength={IDENTITY_MAX_LENGTH[type]}
              editable={!disabled}
              onFocus={() => liftAnchor(numberAnchorRef)}
            />
          </View>
          {errors?.identity ? <Text style={styles.errText}>{errors.identity}</Text> : null}

          <Text style={[styles.panelLead, styles.panelLeadSpaced]}>
            Document photo <Text style={styles.asterisk}>*</Text>
          </Text>

          {photoUri ? (
            <View style={styles.photoCard}>
              <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
              <View style={styles.photoActionsRow}>
                <TouchableOpacity
                  style={styles.photoActionBtn}
                  onPress={onPickPhoto}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel="Replace document photo"
                >
                  <Ionicons name="refresh-outline" size={16} color={COLORS.secondary} />
                  <Text style={styles.photoActionText}>Replace</Text>
                </TouchableOpacity>
                <View style={styles.photoActionDivider} />
                <TouchableOpacity
                  style={styles.photoActionBtn}
                  onPress={removePhoto}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel="Remove document photo"
                >
                  <Ionicons name="trash-outline" size={16} color={COLORS.error} />
                  <Text style={[styles.photoActionText, styles.photoActionDanger]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={onPickPhoto}
              disabled={disabled}
              style={({ pressed }) => [
                styles.photoEmpty,
                errors?.identityPhoto ? styles.photoEmptyError : null,
                pressed && !disabled && styles.photoEmptyPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add document photo"
              accessibilityHint="Take a photo or choose one from your gallery"
            >
              <View style={styles.photoEmptyIcon}>
                <Ionicons name="camera-outline" size={22} color={COLORS.secondary} />
              </View>
              <View style={styles.photoEmptyText}>
                <Text style={styles.photoEmptyTitle}>Add a clear photo</Text>
                <Text style={styles.photoEmptySubtitle}>We use it for verification only.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </Pressable>
          )}
          {errors?.identityPhoto ? <Text style={styles.errText}>{errors.identityPhoto}</Text> : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.tabBarPillBorder,
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
  panelOverline: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  panelLead: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.25,
    marginBottom: 10,
  },
  panelLeadSpaced: {
    marginTop: 18,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
    letterSpacing: 0.1,
    marginTop: 12,
    marginBottom: 8,
  },
  fieldLabelFirst: {
    marginTop: 4,
  },
  asterisk: {
    color: COLORS.error,
    fontWeight: '800',
  },
  optionalTag: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    letterSpacing: 0,
  },
  textField: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    backgroundColor: COLORS.backgroundSecondary,
    minHeight: 54,
  },
  fieldError: {
    borderColor: COLORS.error,
  },
  errText: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.error,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundSecondary,
  },
  chipOn: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipPressed: {
    opacity: 0.9,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  chipLabelOn: {
    color: COLORS.white,
  },
  photoEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.25,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    borderRadius: 14,
    backgroundColor: COLORS.backgroundSecondary,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 72,
  },
  photoEmptyPressed: {
    opacity: 0.85,
  },
  photoEmptyError: {
    borderColor: COLORS.error,
    borderStyle: 'dashed',
  },
  photoEmptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(59, 130, 246, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  photoEmptyText: {
    flex: 1,
  },
  photoEmptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  photoEmptySubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
    lineHeight: 17,
  },
  photoCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundSecondary,
  },
  photoPreview: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: COLORS.borderLight,
  },
  photoActionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  photoActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 6,
  },
  photoActionDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
  },
  photoActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.secondary,
  },
  photoActionDanger: {
    color: COLORS.error,
  },
});
