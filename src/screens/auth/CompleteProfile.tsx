import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Keyboard,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
  normalizeIdentityNumber,
  type GenderValue,
  type IdentityDocumentValue,
} from '../../constants/validation';
import { COLORS } from '../../constants/colors';
import { useImagePicker } from '../../hooks/useImagePicker';
import { uploadIdentityDocument } from '../../services/identityDocument';
import IdentityVerificationCard from '../../components/profile/IdentityVerificationCard';

type Props = RootStackScreenProps<'CompleteProfile'>;

/**
 * Reserved scroll padding so the last field clears the absolutely-positioned
 * Continue footer that overlays the bottom of the ScrollView. Mirrors the
 * Edit Profile screen's proven pattern.
 */
const SCROLL_PADDING_ABOVE_FOOTER = 120;

const DIAL_CODE = '+91';

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
  return `${da}/${mo}/${y}`;
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
  const insets = useSafeAreaInsets();
  const { refreshUser, patchUser, logout } = useAuth();

  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<GenderValue | ''>('');
  const [phoneNational, setPhoneNational] = useState('');
  const [identityType, setIdentityType] = useState<IdentityDocumentValue | ''>('');
  const [identityNumber, setIdentityNumber] = useState('');
  const [identityPhotoUri, setIdentityPhotoUri] = useState<string | null>(null);
  const [identityLabel, setIdentityLabel] = useState('');
  const { pickFromGallery, takePhoto } = useImagePicker();
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
    identity?: string;
    identityPhoto?: string;
    identityLabel?: string;
  }>({});

  const scrollRef = useRef<ScrollView | null>(null);
  const scrollContentRef = useRef<View | null>(null);
  const signOutInFlightRef = useRef(false);
  const [dobPickerOpen, setDobPickerOpen] = useState(false);
  const [dobPickerDate, setDobPickerDate] = useState(() => new Date());
  /** Live keyboard height — drives the absolute footer's `bottom` and ScrollView's bottom padding. */
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);

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

  const { dobMin, dobMax } = useMemo(() => {
    const max = new Date();
    max.setFullYear(max.getFullYear() - 13);
    const min = new Date();
    min.setFullYear(min.getFullYear() - 120);
    return { dobMin: min, dobMax: max };
  }, []);

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

  const identityIsTouched = identityType !== '' || identityNumber.trim().length > 0;

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!validation.dateOfBirth(dateOfBirth)) next.dateOfBirth = validationErrors.dateOfBirth;
    if (!gender || !validation.gender(gender)) next.gender = validationErrors.gender;
    if (!validation.phoneNational(phoneNational)) next.phone = validationErrors.phone;
    if (identityIsTouched) {
      if (!identityType || !identityNumber.trim()) {
        next.identity = validationErrors.identityIncomplete;
      } else if (!validation.identityNumber(identityNumber, identityType)) {
        next.identity =
          identityType === 'aadhaar'
            ? validationErrors.identityAadhaar
            : identityType === 'pan'
              ? validationErrors.identityPan
              : identityType === 'driver_license'
                ? validationErrors.identityDriverLicense
                : validationErrors.identityOther;
      }
      if (identityType === 'other' && !validation.identityLabel(identityLabel)) {
        next.identityLabel = validationErrors.identityLabel;
      }
      if (!identityPhotoUri) {
        next.identityPhoto = 'Add a clear photo of the document to continue.';
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return false;
    if (!termsAccepted) {
      Alert.alert('Terms', 'Please accept the Terms and Privacy Policy to continue.');
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

  /**
   * Best-effort upload — never blocks account onboarding.
   * Verification status is owned by the backend; if upload fails the user can re-try
   * later from Profile. Logs in dev so we notice silent failures without alerting users.
   *
   * On success we refresh the auth user so the freshly-set
   * `identityVerificationStatus: 'pending'` lands in memory immediately. The badge
   * itself stays off until an admin manually flips `isIdentityVerified` in Mongo.
   */
  const submitIdentityDocumentIfPresent = useCallback(async () => {
    if (!identityIsTouched) return;
    if (!identityType || !identityPhotoUri) return;
    const number = normalizeIdentityNumber(identityNumber);
    if (!validation.identityNumber(number, identityType)) return;
    if (identityType === 'other' && !validation.identityLabel(identityLabel)) return;
    try {
      await uploadIdentityDocument({
        documentType: identityType,
        documentNumber: number,
        documentLabel: identityType === 'other' ? identityLabel.trim() : undefined,
        localUri: identityPhotoUri,
      });
      try {
        await refreshUser();
      } catch {
        // Refresh is opportunistic; next /auth/me on resume will pick up status.
      }
    } catch (err) {
      if (__DEV__) {
        console.warn('[CompleteProfile] identity document upload failed', err);
      }
    }
  }, [identityIsTouched, identityType, identityNumber, identityPhotoUri, identityLabel, refreshUser]);

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
      await submitIdentityDocumentIfPresent();
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
          await submitIdentityDocumentIfPresent();
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

  const pickIdentityPhoto = useCallback(
    async (source: 'library' | 'camera') => {
      const picked =
        source === 'library'
          ? await pickFromGallery({ aspect: [4, 3], quality: 0.85 })
          : await takePhoto({ aspect: [4, 3], quality: 0.85 });
      if (picked?.uri) {
        setIdentityPhotoUri(picked.uri);
        setErrors((e) => ({ ...e, identityPhoto: undefined }));
      }
    },
    [pickFromGallery, takePhoto]
  );

  const promptIdentityPhotoSource = useCallback(() => {
    Alert.alert(
      'Document photo',
      'Choose where to add the document photo from.',
      [
        { text: 'Take photo', onPress: () => void pickIdentityPhoto('camera') },
        { text: 'Choose from gallery', onPress: () => void pickIdentityPhoto('library') },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true }
    );
  }, [pickIdentityPhoto]);

  const canContinue =
    termsAccepted &&
    validation.dateOfBirth(dateOfBirth) &&
    !!gender &&
    validation.gender(gender) &&
    validation.phoneNational(phoneNational) &&
    (!identityIsTouched ||
      (!!identityType &&
        validation.identityNumber(identityNumber, identityType) &&
        (identityType !== 'other' || validation.identityLabel(identityLabel)) &&
        !!identityPhotoUri)) &&
    !saving &&
    !finishing;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Complete your info</Text>
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

      <View style={styles.body}>
        <KeyboardAvoidingView
          style={styles.kav}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 16 : 0}
        >
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={[
              styles.scroll,
              { paddingBottom: SCROLL_PADDING_ABOVE_FOOTER + insets.bottom + keyboardBottomInset },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <View ref={scrollContentRef} collapsable={false} style={styles.scrollInner}>
          <View style={styles.panel}>
            <Text style={styles.panelOverline}>Personal</Text>

            <Text style={styles.panelLead}>
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
                accessibilityRole="button"
                accessibilityLabel="Pick date of birth"
              >
                <Ionicons name="calendar-outline" size={20} color={COLORS.textSecondary} style={styles.leadingIcon} />
                <Text style={[styles.dobText, !dateOfBirth.trim() && styles.placeholderText]}>
                  {dateOfBirth.trim() ? formatDobDisplay(dateOfBirth.trim()) : 'DD/MM/YYYY'}
                </Text>
                <Ionicons name="chevron-down" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}
            {errors.dateOfBirth ? <Text style={styles.errText}>{errors.dateOfBirth}</Text> : null}

            <Text style={[styles.panelLead, styles.panelLeadSpaced]}>
              Gender <Text style={styles.asterisk}>*</Text>
            </Text>
            <TouchableOpacity
              style={[styles.dropdown, errors.gender ? styles.fieldError : null]}
              onPress={() => {
                setGenderPickerOpen(true);
                setErrors((e) => ({ ...e, gender: undefined }));
              }}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Select gender"
            >
              <Text
                style={[styles.dropdownText, !gender && styles.placeholderText]}
                numberOfLines={1}
              >
                {gender ? GENDER_DISPLAY[gender] : 'Select gender'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
            {errors.gender ? <Text style={styles.errText}>{errors.gender}</Text> : null}
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelOverline}>Contact</Text>
            <Text style={styles.panelLead}>
              Phone <Text style={styles.asterisk}>*</Text>
            </Text>
            <View style={[styles.phoneWrap, errors.phone ? styles.fieldError : null]}>
              <Text style={styles.dial}>{DIAL_CODE}</Text>
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
            {errors.phone ? <Text style={styles.errText}>{errors.phone}</Text> : null}
          </View>

          <IdentityVerificationCard
            value={{
              type: identityType,
              number: identityNumber,
              photoUri: identityPhotoUri,
              label: identityLabel,
            }}
            onChange={(next) => {
              setIdentityType(next.type);
              setIdentityNumber(next.number);
              setIdentityPhotoUri(next.photoUri);
              setIdentityLabel(next.label ?? '');
              setErrors((e) => ({
                ...e,
                identity: undefined,
                identityPhoto: undefined,
                identityLabel: undefined,
              }));
            }}
            errors={{
              identity: errors.identity,
              identityPhoto: errors.identityPhoto,
              identityLabel: errors.identityLabel,
            }}
            onPickPhoto={promptIdentityPhotoSource}
            scrollRef={scrollRef}
            scrollContentRef={scrollContentRef}
            mode="optional"
            disabled={saving || finishing}
            style={styles.identityPanelSpacing}
          />

          <View style={styles.panel}>
            <Text style={styles.panelOverline}>Agreement</Text>
            <TouchableOpacity
              style={styles.termsRow}
              onPress={() => setTermsAccepted((v) => !v)}
              activeOpacity={0.8}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: termsAccepted }}
            >
              <View style={[styles.checkbox, termsAccepted && styles.checkboxOn]}>
                {termsAccepted ? <Ionicons name="checkmark" size={14} color={COLORS.white} /> : null}
              </View>
              <Text style={styles.termsText}>
                I agree to the <Text style={styles.termsBold}>Terms and Privacy Policy</Text>
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => navigation.navigate('LegalAgreement', { source: 'complete_profile' })}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="link"
              accessibilityLabel="Read the Terms and Privacy Policy"
              style={styles.termsLinkRow}
            >
              <Text style={styles.termsLink}>Read the Terms and Privacy Policy</Text>
              <Ionicons name="chevron-forward" size={14} color={COLORS.secondary} />
            </TouchableOpacity>
          </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

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

        <View
          style={[
            styles.footer,
            {
              paddingBottom: Math.max(insets.bottom, 12),
              bottom: keyboardBottomInset,
            },
          ]}
        >
          <TouchableOpacity
            style={[styles.continueBtn, !canContinue && styles.continueBtnDisabled]}
            onPress={() => void handleContinue()}
            disabled={!canContinue}
            activeOpacity={0.85}
          >
            {saving || finishing ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={[styles.continueBtnText, !canContinue && styles.continueBtnTextDisabled]}>
                Continue
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
      {signingOut || finishing ? (
        <View style={styles.thinkingOverlay} pointerEvents="auto">
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.thinkingLabel}>
            {signingOut ? 'Signing out' : 'Saving'}
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
  body: {
    flex: 1,
    position: 'relative',
  },
  kav: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.35,
  },
  signOutBtn: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  signOutBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.error,
  },
  signOutBtnTextDisabled: {
    opacity: 0.4,
  },
  scroll: {
    paddingHorizontal: 20,
  },
  scrollInner: {
    paddingTop: 16,
  },
  panel: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginBottom: 14,
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
  asterisk: {
    color: COLORS.error,
    fontWeight: '800',
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
  dobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    backgroundColor: COLORS.backgroundSecondary,
    minHeight: 54,
  },
  leadingIcon: {
    marginRight: 10,
  },
  dobText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  placeholderText: {
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    backgroundColor: COLORS.backgroundSecondary,
    minHeight: 54,
  },
  dropdownText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
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
  phoneWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    backgroundColor: COLORS.backgroundSecondary,
    minHeight: 54,
  },
  dial: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginRight: 8,
  },
  phoneInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
  },
  identityPanelSpacing: {
    marginBottom: 14,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxOn: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  termsText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: 20,
  },
  termsBold: {
    fontWeight: '800',
    color: COLORS.secondary,
  },
  termsLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginLeft: 34,
    gap: 4,
  },
  termsLink: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.secondary,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.surface,
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
  continueBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  continueBtnDisabled: {
    opacity: 0.55,
  },
  continueBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: -0.2,
  },
  continueBtnTextDisabled: {
    color: COLORS.white,
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
    fontWeight: '800',
    color: COLORS.text,
  },
  dobModalCancel: {
    fontSize: 16,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  dobModalDone: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '800',
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
    fontWeight: '800',
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
    fontWeight: '600',
    color: COLORS.text,
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
    fontWeight: '700',
    fontSize: 15,
  },
});
