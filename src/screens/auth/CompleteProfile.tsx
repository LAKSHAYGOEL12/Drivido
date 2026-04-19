import React, { useMemo, useRef, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  Modal,
  Pressable,
  TextInput,
  ActivityIndicator,
  InteractionManager,
  BackHandler,
} from 'react-native';
import { Alert } from '../../utils/themedAlert';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { RootStackScreenProps } from '../../navigation/types';
import { useAuth } from '../../contexts/AuthContext';
import { requestForegroundLocationAfterAuth } from '../../services/location-permission-auth';
import { updateUserProfileFields } from '../../services/userProfile';
import {
  acceptTermsPrivacyVersion,
  extractLegalAcceptanceRequiredVersion,
  fetchRequiredTermsPrivacyVersion,
} from '../../services/legalAcceptance';
import { rootNavigationRef } from '../../navigation/rootNavigationRef';
import {
  validation,
  validationErrors,
  clampPhoneNationalInput,
  GENDER_OPTIONS,
  type GenderValue,
} from '../../constants/validation';
import { COLORS } from '../../constants/colors';
import { LEGAL_AGREEMENT_VERSION } from '../../constants/legal/legalAgreement';

type Props = RootStackScreenProps<'CompleteProfile'>;

const DIAL_CODE = '+91';

/** Must stay defined: some Metro/Hermes caches still evaluate old style objects that reference `CELL_GAP`. */
const CELL_GAP = 10;
const ROW_GAP_MD = 12;
const ROW_GAP_SM = 8;

const GENDER_DISPLAY: Record<GenderValue, string> = {
  male: 'Male',
  female: 'Female',
  non_binary: 'Other',
  prefer_not_to_say: 'Prefer not to say',
};

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDobDisplay(iso: string): string {
  const t = iso.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const [y, mo, da] = t.split('-');
  return `${mo}/${da}/${y}`;
}

function parseYmdToLocalDate(iso: string): Date {
  const [y, mo, da] = iso.split('-').map((n) => Number(n));
  return new Date(y, mo - 1, da, 12, 0, 0, 0);
}

function clampDate(d: Date, min: Date, max: Date): Date {
  const t = d.getTime();
  if (t < min.getTime()) return new Date(min);
  if (t > max.getTime()) return new Date(max);
  return d;
}

function defaultPickerDate(min: Date, max: Date): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 25);
  d.setHours(12, 0, 0, 0);
  return clampDate(d, min, max);
}

export default function CompleteProfile(): React.JSX.Element {
  const navigation = useNavigation<Props['navigation']>();
  const { refreshUser, patchUser, logout } = useAuth();

  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<GenderValue | ''>('');
  const [phoneNational, setPhoneNational] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [genderPickerOpen, setGenderPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [legalVersionRequired, setLegalVersionRequired] = useState<string | null>(null);

  const [errors, setErrors] = useState<{
    dateOfBirth?: string;
    gender?: string;
    phone?: string;
  }>({});

  const scrollRef = useRef<ScrollView | null>(null);
  const signOutInFlightRef = useRef(false);
  const [dobPickerOpen, setDobPickerOpen] = useState(false);
  const [dobPickerDate, setDobPickerDate] = useState(() => new Date());

  const { dobMin, dobMax } = useMemo(() => {
    const max = new Date();
    max.setFullYear(max.getFullYear() - 13);
    const min = new Date();
    min.setFullYear(min.getFullYear() - 120);
    return { dobMin: min, dobMax: max };
  }, []);

  const legalDisplayVersion = useMemo(
    () => (legalVersionRequired ?? LEGAL_AGREEMENT_VERSION).trim() || LEGAL_AGREEMENT_VERSION,
    [legalVersionRequired]
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void fetchRequiredTermsPrivacyVersion()
        .then((v) => {
          if (!cancelled) setLegalVersionRequired(v);
        })
        .catch(() => {
          if (!cancelled) setLegalVersionRequired(null);
        });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  /** Android hardware back cannot dismiss this screen — avoids nav reset loops with the profile gate. Use Sign out to leave. */
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
      return () => sub.remove();
    }, [])
  );

  const openDobPicker = () => {
    let next = defaultPickerDate(dobMin, dobMax);
    if (dateOfBirth.trim() && validation.dateOfBirth(dateOfBirth.trim())) {
      next = clampDate(parseYmdToLocalDate(dateOfBirth.trim()), dobMin, dobMax);
    }
    setDobPickerDate(next);
    setDobPickerOpen(true);
    setErrors((e) => ({ ...e, dateOfBirth: undefined }));
  };

  const onAndroidDobChange = (event: DateTimePickerEvent, date?: Date) => {
    setDobPickerOpen(false);
    if (event.type === 'dismissed') return;
    if (date) {
      const c = clampDate(date, dobMin, dobMax);
      setDateOfBirth(formatLocalYmd(c));
      setErrors((e) => ({ ...e, dateOfBirth: undefined }));
    }
  };

  const confirmIosDob = () => {
    setDateOfBirth(formatLocalYmd(clampDate(dobPickerDate, dobMin, dobMax)));
    setDobPickerOpen(false);
    setErrors((e) => ({ ...e, dateOfBirth: undefined }));
  };

  const goMain = useCallback(() => {
    void requestForegroundLocationAfterAuth();
    if (rootNavigationRef.isReady()) {
      rootNavigationRef.reset({ index: 0, routes: [{ name: 'Main' }] });
    } else {
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    }
  }, [navigation]);

  const handleSignOut = useCallback(async () => {
    if (signOutInFlightRef.current) return;
    signOutInFlightRef.current = true;
    setSigningOut(true);
    /** Let React paint the blocking overlay before async logout (avoids a flash of Main / ride UI). */
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    await logout();
    /** RootNavigator resets to guest Main once auth clears — do not navigate here or tabs flash under the overlay. */
  }, [logout]);

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!validation.dateOfBirth(dateOfBirth)) next.dateOfBirth = validationErrors.dateOfBirth;
    if (!gender || !validation.gender(gender)) next.gender = validationErrors.gender;
    if (!validation.phoneNational(phoneNational)) next.phone = validationErrors.phone;
    setErrors(next);
    if (Object.keys(next).length > 0) return false;
    if (!termsAccepted) {
      Alert.alert('Terms', 'Please accept the Terms & Privacy Policy to continue.');
      return false;
    }
    return true;
  };

  const friendlyProfileSaveError = (err: unknown): string => {
    const errObj = err as {
      message?: unknown;
      status?: unknown;
      data?: { code?: unknown; message?: unknown; error?: unknown } | unknown;
    };
    const msg =
      err instanceof Error
        ? err.message
        : typeof errObj?.message === 'string'
          ? errObj.message
          : String(err ?? '');
    const status = typeof errObj?.status === 'number' ? errObj.status : undefined;
    const data = errObj?.data && typeof errObj.data === 'object' ? (errObj.data as Record<string, unknown>) : null;
    const code = typeof data?.code === 'string' ? data.code.toLowerCase() : '';
    const low = msg.toLowerCase();
    const duplicatePhone =
      status === 409 ||
      code.includes('phone') ||
      code.includes('duplicate') ||
      (low.includes('phone') && (low.includes('already') || low.includes('duplicate'))) ||
      (low.includes('e11000') && low.includes('phone')) ||
      low.includes('duplicate key');
    if (duplicatePhone) return 'This phone number already exists.';
    return msg || 'Couldn’t save changes.';
  };

  const handleContinue = async () => {
    if (!validate() || saving || finishing) return;
    const national = clampPhoneNationalInput(phoneNational);
    const phoneE164 = `${DIAL_CODE}${national}`;
    setSaving(true);
    try {
      const submitProfile = async () => {
        await updateUserProfileFields({
          dateOfBirth: dateOfBirth.trim(),
          gender: gender as string,
          phone: phoneE164,
        });
        patchUser({
          dateOfBirth: dateOfBirth.trim(),
          gender: gender as string,
          phone: national,
        });
        await refreshUser();
      };

      const hintedVersion = legalVersionRequired?.trim() || '';
      if (hintedVersion) {
        await acceptTermsPrivacyVersion({
          version: hintedVersion,
          platform: Platform.OS,
        });
      }
      await submitProfile();
      setSaving(false);
      setFinishing(true);
      await new Promise((r) => setTimeout(r, 520));
      await new Promise<void>((resolve) => {
        InteractionManager.runAfterInteractions(() => resolve());
      });
      goMain();
    } catch (e: unknown) {
      const requiredVersion = extractLegalAcceptanceRequiredVersion(e);
      if (requiredVersion) {
        try {
          setLegalVersionRequired(requiredVersion);
          await acceptTermsPrivacyVersion({
            version: requiredVersion,
            platform: Platform.OS,
          });
          await updateUserProfileFields({
            dateOfBirth: dateOfBirth.trim(),
            gender: gender as string,
            phone: phoneE164,
          });
          patchUser({
            dateOfBirth: dateOfBirth.trim(),
            gender: gender as string,
            phone: national,
          });
          await refreshUser();
          setSaving(false);
          setFinishing(true);
          await new Promise((r) => setTimeout(r, 520));
          await new Promise<void>((resolve) => {
            InteractionManager.runAfterInteractions(() => resolve());
          });
          goMain();
          return;
        } catch {
          Alert.alert(
            'Legal acceptance required',
            'Please review and accept the latest Terms and Privacy Policy to continue.'
          );
          return;
        }
      }
      const msg = friendlyProfileSaveError(e);
      Alert.alert('Couldn’t save changes', msg);
    } finally {
      setSaving(false);
      setFinishing(false);
    }
  };

  const canContinue =
    termsAccepted &&
    validation.dateOfBirth(dateOfBirth) &&
    !!gender &&
    validation.gender(gender) &&
    validation.phoneNational(phoneNational) &&
    !saving &&
    !finishing;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 16 : 20}
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={() => void handleSignOut()}
            style={styles.signOutBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            disabled={saving || finishing || signingOut}
          >
            <Text
              style={[
                styles.signOutBtnText,
                (saving || finishing || signingOut) && styles.signOutBtnTextDisabled,
              ]}
            >
              Sign out
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.divider} />

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.headline}>Complete your info</Text>
          <Text style={styles.subheadline}>Help us personalize your experience and secure your account.</Text>

          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>
              Date of birth <Text style={styles.asterisk}>*</Text>
            </Text>
            {Platform.OS === 'web' ? (
              <TextInput
                style={[styles.textField, errors.dateOfBirth ? styles.fieldError : null]}
                value={dateOfBirth}
                onChangeText={(v) => {
                  setDateOfBirth(v);
                  setErrors((e) => ({ ...e, dateOfBirth: undefined }));
                }}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={COLORS.textMuted}
              />
            ) : (
              <TouchableOpacity
                style={[styles.dobRow, errors.dateOfBirth ? styles.fieldError : null]}
                onPress={openDobPicker}
                activeOpacity={0.75}
              >
                <Ionicons name="calendar-outline" size={20} color={COLORS.textSecondary} style={styles.dobIcon} />
                <Text style={[styles.dobText, !dateOfBirth.trim() && styles.dobPlaceholder]}>
                  {dateOfBirth.trim() ? formatDobDisplay(dateOfBirth.trim()) : 'MM/DD/YYYY'}
                </Text>
              </TouchableOpacity>
            )}
            {errors.dateOfBirth ? <Text style={styles.fieldErrText}>{errors.dateOfBirth}</Text> : null}
          </View>

          {Platform.OS === 'android' && dobPickerOpen ? (
            <DateTimePicker
              value={dobPickerDate}
              mode="date"
              display="default"
              minimumDate={dobMin}
              maximumDate={dobMax}
              onChange={onAndroidDobChange}
            />
          ) : null}

          {Platform.OS === 'ios' ? (
            <Modal visible={dobPickerOpen} animationType="slide" transparent onRequestClose={() => setDobPickerOpen(false)}>
              <View style={styles.dobModalRoot}>
                <Pressable style={styles.dobModalBackdrop} onPress={() => setDobPickerOpen(false)} />
                <SafeAreaView edges={['bottom']} style={styles.dobModalSheet}>
                  <View style={styles.dobModalGrabberWrap} pointerEvents="none">
                    <View style={styles.dobModalGrabber} />
                  </View>
                  <View style={styles.dobModalHeader}>
                    <View style={styles.dobModalHeaderSide}>
                      <TouchableOpacity onPress={() => setDobPickerOpen(false)} hitSlop={12}>
                        <Text style={styles.dobModalCancel}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.dobModalTitleBlock}>
                      <Text style={styles.dobModalTitle}>Date of birth</Text>
                      <Text style={styles.dobModalSubtitle}>Choose a day on the calendar</Text>
                    </View>
                    <View style={[styles.dobModalHeaderSide, styles.dobModalHeaderSideEnd]}>
                      <TouchableOpacity onPress={confirmIosDob} hitSlop={12}>
                        <Text style={styles.dobModalDone}>Done</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={styles.dobPickerWrap}>
                    <DateTimePicker
                      style={styles.dobPickerNative}
                      value={dobPickerDate}
                      mode="date"
                      display="inline"
                      minimumDate={dobMin}
                      maximumDate={dobMax}
                      onChange={(_, d) => {
                        if (d) setDobPickerDate(clampDate(d, dobMin, dobMax));
                      }}
                      themeVariant="light"
                    />
                  </View>
                </SafeAreaView>
              </View>
            </Modal>
          ) : null}

          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>
              Gender <Text style={styles.asterisk}>*</Text>
            </Text>
            <TouchableOpacity
              style={[styles.genderDropdown, errors.gender ? styles.fieldError : null]}
              onPress={() => {
                setGenderPickerOpen(true);
                setErrors((e) => ({ ...e, gender: undefined }));
              }}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Select gender"
            >
              <Text
                style={[styles.genderDropdownText, !gender && styles.genderDropdownPlaceholder]}
                numberOfLines={1}
              >
                {gender ? GENDER_DISPLAY[gender] : 'Select gender'}
              </Text>
              <Ionicons name="chevron-down" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
            {errors.gender ? <Text style={styles.fieldErrText}>{errors.gender}</Text> : null}
          </View>

          <Modal
            visible={genderPickerOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setGenderPickerOpen(false)}
          >
            <View style={styles.genderModalRoot}>
              <Pressable style={styles.genderModalBackdrop} onPress={() => setGenderPickerOpen(false)} />
              <View style={styles.genderModalSheet}>
                <Text style={styles.genderModalTitle}>Gender</Text>
                {GENDER_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={styles.genderModalOption}
                    onPress={() => {
                      setGender(opt.value);
                      setGenderPickerOpen(false);
                      setErrors((e) => ({ ...e, gender: undefined }));
                    }}
                  >
                    <Text style={styles.genderModalOptionText}>{GENDER_DISPLAY[opt.value]}</Text>
                    {gender === opt.value ? (
                      <Ionicons name="checkmark" size={22} color={COLORS.primary} />
                    ) : null}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </Modal>

          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>
              Phone number <Text style={styles.asterisk}>*</Text>
            </Text>
            <View style={styles.phoneRow}>
              <View style={[styles.dialFixed, styles.phoneRowPrefix]}>
                <Text style={styles.dialFixedText}>{DIAL_CODE}</Text>
              </View>
              <View style={[styles.phoneInputWrap, errors.phone ? styles.fieldError : null]}>
                <Ionicons name="call-outline" size={18} color={COLORS.textSecondary} style={styles.phoneIcon} />
                <TextInput
                  style={styles.phoneInput}
                  value={phoneNational}
                  onChangeText={(v) => {
                    setPhoneNational(clampPhoneNationalInput(v));
                    setErrors((e) => ({ ...e, phone: undefined }));
                  }}
                  placeholder="10-digit mobile number"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="number-pad"
                  maxLength={10}
                />
              </View>
            </View>
            {errors.phone ? <Text style={styles.fieldErrText}>{errors.phone}</Text> : null}
          </View>

          <View style={styles.termsBox}>
            <TouchableOpacity
              style={styles.termsRow}
              onPress={() => setTermsAccepted((v) => !v)}
              activeOpacity={0.8}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: termsAccepted }}
            >
              <View style={[styles.checkbox, styles.termsCheckbox, termsAccepted && styles.checkboxOn]}>
                {termsAccepted ? <Ionicons name="checkmark" size={16} color={COLORS.white} /> : null}
              </View>
              <Text style={styles.termsText}>
                I agree to the <Text style={styles.termsBold}>Terms and Privacy Policy</Text>
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => navigation.navigate('LegalAgreement', { source: 'complete_profile' })}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="link"
              accessibilityLabel="Read full legal agreement"
            >
              <Text style={styles.termsLink}>Read full legal agreement (v{legalDisplayVersion})</Text>
            </TouchableOpacity>
            <View style={styles.infoRow}>
              <Ionicons name="information-circle-outline" size={16} color={COLORS.secondary} style={styles.infoIcon} />
              <Text style={styles.infoText}>
                Used for ride verification, safety, and account notices—see Privacy Policy.
              </Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.footerDivider} />
          <TouchableOpacity
            style={[styles.continueBtn, !canContinue && styles.continueBtnDisabled]}
            onPress={() => void handleContinue()}
            disabled={!canContinue}
            activeOpacity={0.85}
          >
            <Text style={[styles.continueBtnText, !canContinue && styles.continueBtnTextDisabled]}>
              {finishing ? 'Thinking' : saving ? 'Saving…' : 'Continue'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      {signingOut || finishing ? (
        <View style={styles.thinkingOverlay} pointerEvents="auto">
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.thinkingLabel}>
            {signingOut ? 'Shutting down' : 'Thinking'}
          </Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  signOutBtn: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  signOutBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.error,
  },
  signOutBtnTextDisabled: {
    opacity: 0.4,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginHorizontal: 16,
  },
  scroll: {
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 24,
  },
  headline: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 8,
  },
  subheadline: {
    fontSize: 15,
    color: COLORS.textSecondary,
    lineHeight: 22,
    marginBottom: 28,
  },
  fieldBlock: {
    marginBottom: 22,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 10,
  },
  asterisk: {
    color: COLORS.error,
    fontWeight: '700',
  },
  textField: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.background,
  },
  dobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: COLORS.background,
  },
  dobIcon: {
    marginRight: ROW_GAP_MD,
  },
  dobText: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
  },
  dobPlaceholder: {
    color: COLORS.textMuted,
  },
  fieldError: {
    borderColor: COLORS.error,
  },
  fieldErrText: {
    marginTop: 6,
    fontSize: 13,
    color: COLORS.error,
  },
  dobModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  dobModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
  },
  dobModalSheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 4,
  },
  dobModalGrabberWrap: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  dobModalGrabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
  },
  dobModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  dobModalHeaderSide: {
    width: 76,
    justifyContent: 'center',
  },
  dobModalHeaderSideEnd: {
    alignItems: 'flex-end',
  },
  dobModalTitleBlock: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  dobModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  dobModalSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  dobModalCancel: {
    fontSize: 16,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  dobModalDone: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '700',
  },
  dobPickerWrap: {
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 12,
    alignItems: 'stretch',
    width: '100%',
  },
  dobPickerNative: {
    width: '100%',
  },
  genderDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: COLORS.background,
  },
  genderDropdownText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  genderDropdownPlaceholder: {
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  genderModalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  genderModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.4)',
  },
  genderModalSheet: {
    backgroundColor: COLORS.background,
    borderRadius: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  genderModalTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  genderModalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
  },
  genderModalOptionText: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '600',
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  phoneRowPrefix: {
    marginRight: CELL_GAP,
  },
  dialFixed: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    minWidth: 72,
    backgroundColor: COLORS.backgroundSecondary,
  },
  dialFixedText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  phoneInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: COLORS.background,
  },
  phoneIcon: {
    marginRight: 8,
  },
  phoneInput: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    paddingVertical: 14,
  },
  termsBox: {
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  termsCheckbox: {
    marginRight: ROW_GAP_MD,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxOn: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  termsText: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 22,
  },
  termsBold: {
    fontWeight: '800',
    color: COLORS.secondary,
  },
  termsLink: {
    marginTop: 8,
    marginLeft: 34,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.secondary,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 12,
  },
  infoIcon: {
    marginRight: ROW_GAP_SM,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: 22,
    paddingBottom: 8,
  },
  footerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginBottom: 14,
  },
  continueBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  continueBtnDisabled: {
    backgroundColor: COLORS.borderLight,
  },
  continueBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.white,
  },
  continueBtnTextDisabled: {
    color: COLORS.textMuted,
  },
  thinkingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(248, 250, 252, 0.96)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thinkingLabel: {
    marginTop: 12,
    color: COLORS.textSecondary,
    fontWeight: '600',
    fontSize: 16,
  },
});
