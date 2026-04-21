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
  TextInput,
  View,
} from 'react-native';
import { Alert } from '../../utils/themedAlert';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { COLORS } from '../../constants/colors';
import type { ProfileStackParamList } from '../../navigation/types';
import {
  patchUserPhoneOnly,
  patchUserProfileBio,
  patchUserOccupation,
  patchUserRidePreferences,
  patchUserVehicleProfile,
  clearLegacyUserVehicleProfile,
} from '../../services/userProfile';
import { RIDE_PREFERENCE_OPTIONS, normalizeRidePreferenceIds } from '../../constants/ridePreferences';
import { createUserVehicle, deleteUserVehicle, updateUserVehicle } from '../../services/userVehicles';
import {
  validation,
  validationErrors,
  normalizePhoneForValidation,
  clampPhoneNationalInput,
} from '../../constants/validation';
import { vehiclesFromUser } from '../../utils/userVehicle';
import { showToast } from '../../utils/toast';

/** Scroll padding so last fields clear the fixed save bar (~footer + spacing). */
const SCROLL_PADDING_ABOVE_FOOTER = 120;

/** Approx. Y offset from vehicle card top to plate/color row (scroll target). */
const CARD_OFFSET_PLATE_COLOR = 168;
const CARD_OFFSET_MODEL = 48;
/** Keep focused field this many px below the top of the visible scroll area. */
const FOCUS_SCROLL_TOP_MARGIN = 96;
const OCCUPATION_OPTIONS = [
  'Student',
  'Software Engineer',
  'Doctor',
  'Teacher',
  'Business Owner',
  'Sales Executive',
  'Designer',
  'Freelancer',
];

type VehicleFormRow = {
  key: string;
  /** `null` = new vehicle (POST). `'legacy-profile'` = flat user profile. Else `/user/vehicles/:id`. */
  vehicleId: string | null;
  vehicleModel: string;
  licensePlate: string;
  vehicleColor: string;
};

function newVehicleDraftRow(): VehicleFormRow {
  return {
    key: `new-${Date.now()}`,
    vehicleId: null,
    vehicleModel: '',
    licensePlate: '',
    vehicleColor: '',
  };
}

function buildInitialRows(user: Parameters<typeof vehiclesFromUser>[0]): VehicleFormRow[] {
  const list = vehiclesFromUser(user);
  if (list.length === 0) {
    return [newVehicleDraftRow()];
  }
  return list.map((v, i) => ({
    key: v.id || `v-${i}`,
    vehicleId: v.id === 'legacy-profile' ? 'legacy-profile' : v.id,
    vehicleModel: v.vehicleModel,
    licensePlate: v.licensePlate,
    vehicleColor: v.vehicleColor?.trim() ?? '',
  }));
}

function canShowVehicleDelete(r: VehicleFormRow, allRows: VehicleFormRow[]): boolean {
  if (r.vehicleId !== null) return true;
  const hasDraft =
    r.vehicleModel.trim().length > 0 ||
    r.licensePlate.trim().length > 0 ||
    r.vehicleColor.trim().length > 0;
  return allRows.length > 1 || hasDraft;
}

export default function EditProfileScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const { user, refreshUser, patchUser } = useAuth();

  const [phoneNational, setPhoneNational] = useState(() =>
    clampPhoneNationalInput(normalizePhoneForValidation(user?.phone ?? ''))
  );
  const [profileBio, setProfileBio] = useState(() => (user?.bio ?? '').trim());
  const [occupation, setOccupation] = useState(() => (user?.occupation ?? '').trim());
  const [ridePrefs, setRidePrefs] = useState<string[]>(() =>
    normalizeRidePreferenceIds(user?.ridePreferences)
  );
  const [rows, setRows] = useState<VehicleFormRow[]>(() => buildInitialRows(user));
  const [saving, setSaving] = useState(false);
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [bioError, setBioError] = useState<string | undefined>();
  /** Lifts the save bar above the keyboard; reset to 0 on hide avoids stuck gap from KeyboardAvoidingView. */
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const scrollContentRef = useRef<View>(null);
  const vehicleCardRefs = useRef<Record<string, View | null>>({});
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [occupationFocused, setOccupationFocused] = useState(false);
  /** Y of each vehicle card top inside scroll content (measureLayout vs scroll body). */
  const vehicleCardY = useRef<Record<string, number>>({});

  const updateVehicleCardScrollY = useCallback((key: string) => {
    const card = vehicleCardRefs.current[key];
    const content = scrollContentRef.current;
    if (!card || !content) return;
    requestAnimationFrame(() => {
      card.measureLayout(
        content,
        (_left, top) => {
          vehicleCardY.current[key] = top;
        },
        () => {}
      );
    });
  }, []);

  const scrollFieldIntoView = useCallback((vehicleKey: string, field: 'model' | 'plate' | 'color') => {
    const cardTop = vehicleCardY.current[vehicleKey];
    if (cardTop === undefined) return;
    const withinCard = field === 'model' ? CARD_OFFSET_MODEL : CARD_OFFSET_PLATE_COLOR;
    const y = Math.max(0, cardTop + withinCard - FOCUS_SCROLL_TOP_MARGIN);
    const run = () => scrollRef.current?.scrollTo({ y, animated: true });
    /** Lower fields need a beat so keyboard / KAV layout has applied before scrolling. */
    if (field === 'model') {
      requestAnimationFrame(run);
    } else {
      requestAnimationFrame(() => {
        setTimeout(run, Platform.OS === 'ios' ? 120 : 80);
      });
    }
  }, []);

  const scrollPhoneIntoView = useCallback(() => {
    const run = () => scrollRef.current?.scrollToEnd({ animated: true });
    requestAnimationFrame(run);
    setTimeout(run, Platform.OS === 'ios' ? 140 : 100);
  }, []);
  const scrollOccupationIntoView = useCallback(() => {
    const run = () => scrollRef.current?.scrollTo({ y: 220, animated: true });
    requestAnimationFrame(run);
    setTimeout(run, Platform.OS === 'ios' ? 120 : 90);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setProfileBio((user?.bio ?? '').trim());
      setOccupation((user?.occupation ?? '').trim());
      setRidePrefs(normalizeRidePreferenceIds(user?.ridePreferences));
      setBioError(undefined);
    }, [user?.bio, user?.occupation, user?.ridePreferences])
  );

  const toggleRidePreference = useCallback((id: string) => {
    setRidePrefs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return normalizeRidePreferenceIds([...next]);
    });
  }, []);

  useEffect(() => {
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subShow = Keyboard.addListener(show, (e) => {
      setKeyboardBottomInset(e.endCoordinates?.height ?? 0);
      if (phoneFocused) {
        requestAnimationFrame(() => {
          scrollRef.current?.scrollToEnd({ animated: true });
        });
      } else if (occupationFocused) {
        requestAnimationFrame(() => {
          scrollOccupationIntoView();
        });
      }
    });
    const subHide = Keyboard.addListener(hide, () => {
      setKeyboardBottomInset(0);
    });
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [phoneFocused, occupationFocused, scrollOccupationIntoView]);

  const updateRow = useCallback((key: string, patch: Partial<Omit<VehicleFormRow, 'key' | 'vehicleId'>>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }, []);

  const removeVehicleFromState = useCallback((key: string) => {
    setRows((prev) => {
      const next = prev.filter((x) => x.key !== key);
      return next.length === 0 ? [newVehicleDraftRow()] : next;
    });
  }, []);

  const handleDeleteVehicle = useCallback(
    (r: VehicleFormRow) => {
      if (!canShowVehicleDelete(r, rows) || saving) return;
      Alert.alert(
        'Remove vehicle',
        'Remove this vehicle from your profile?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                if (r.vehicleId === null) {
                  removeVehicleFromState(r.key);
                  return;
                }
                setSaving(true);
                try {
                  if (r.vehicleId === 'legacy-profile') {
                    await clearLegacyUserVehicleProfile();
                  } else {
                    await deleteUserVehicle(r.vehicleId);
                  }
                  removeVehicleFromState(r.key);
                  await refreshUser();
                } catch (e) {
                  const msg = e instanceof Error ? e.message : 'Could not remove vehicle. Please try again.';
                  Alert.alert('Couldn’t remove vehicle', msg);
                } finally {
                  setSaving(false);
                }
              })();
            },
          },
        ]
      );
    },
    [rows, saving, removeVehicleFromState, refreshUser]
  );

  const onSave = async () => {
    setPhoneError(undefined);
    setBioError(undefined);
    if (!validation.phoneNational(phoneNational)) {
      setPhoneError(validationErrors.phone);
      return;
    }
    if (!validation.profileBio(profileBio)) {
      setBioError(validationErrors.profileBio);
      return;
    }

    for (const r of rows) {
      const m = r.vehicleModel.trim();
      const p = r.licensePlate.trim();
      const c = r.vehicleColor.trim();
      if (r.vehicleId === null) {
        if (m || p || c) {
          if (!m || !p) {
            Alert.alert(
              'Vehicle',
              'Enter both vehicle model and plate, or leave all fields empty.'
            );
            return;
          }
        }
      } else if (!m || !p) {
        Alert.alert('Vehicle', 'Enter vehicle model and plate for each saved vehicle.');
        return;
      }
    }

    Keyboard.dismiss();
    setSaving(true);
    try {
      await patchUserPhoneOnly(phoneNational);
      const national = clampPhoneNationalInput(phoneNational);
      patchUser({ phone: national });

      await patchUserProfileBio(profileBio);
      patchUser({ bio: profileBio.trim() });

      await patchUserOccupation(occupation);
      patchUser({ occupation: occupation.trim() });

      const prefsNormalized = normalizeRidePreferenceIds(ridePrefs);
      await patchUserRidePreferences(prefsNormalized);
      patchUser({ ridePreferences: prefsNormalized });

      for (const r of rows) {
        const m = r.vehicleModel.trim();
        const p = r.licensePlate.trim();
        const c = r.vehicleColor.trim();
        if (!m || !p) continue;

        const body = {
          vehicleModel: m,
          licensePlate: p,
          ...(c ? { vehicleColor: c } : {}),
        };

        if (r.vehicleId === null) {
          await createUserVehicle(body);
        } else if (r.vehicleId === 'legacy-profile') {
          await patchUserVehicleProfile(body);
        } else {
          await updateUserVehicle(r.vehicleId, body);
        }
      }

      await refreshUser();
      showToast({
        variant: 'success',
        title: 'Profile updated',
        message: 'Your changes have been saved.',
      });
      navigation.goBack();
    } catch (e) {
      const errObj = e as {
        message?: unknown;
        status?: unknown;
        data?: { code?: unknown; message?: unknown; error?: unknown } | unknown;
      };
      const rawMsg =
        e instanceof Error
          ? e.message
          : typeof errObj?.message === 'string'
            ? errObj.message
            : String(e ?? '');
      const status = typeof errObj?.status === 'number' ? errObj.status : undefined;
      const data = errObj?.data && typeof errObj.data === 'object' ? (errObj.data as Record<string, unknown>) : null;
      const code = typeof data?.code === 'string' ? data.code.toLowerCase() : '';
      const low = rawMsg.toLowerCase();
      const duplicatePhone =
        status === 409 ||
        code.includes('phone') ||
        code.includes('duplicate') ||
        (low.includes('phone') && (low.includes('already') || low.includes('duplicate'))) ||
        (low.includes('e11000') && low.includes('phone')) ||
        low.includes('duplicate key');
      const msg =
        e instanceof Error && e.message === 'INVALID_PHONE'
          ? validationErrors.phone
          : duplicatePhone
            ? 'This phone number already exists.'
            : e instanceof Error
              ? e.message
            : 'Try again.';
      Alert.alert('Couldn’t save changes', msg);
    } finally {
      setSaving(false);
    }
  };

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
        <Text style={styles.headerTitle}>Edit profile</Text>
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
              { paddingBottom: SCROLL_PADDING_ABOVE_FOOTER + keyboardBottomInset },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <View ref={scrollContentRef} style={styles.scrollInner} collapsable={false}>
            <View style={styles.panel}>
              <Text style={styles.panelOverline}>Profile</Text>
              <Text style={styles.panelLead}>About you</Text>
              <Text style={styles.fieldHelp}>Optional — shown on your public profile.</Text>
              <TextInput
                style={styles.bioInput}
                value={profileBio}
                onChangeText={(t) => {
                  setProfileBio(t);
                  setBioError(undefined);
                }}
                placeholder="Short line about you, driving style, or interests."
                placeholderTextColor={COLORS.textMuted}
                multiline
                textAlignVertical="top"
                maxLength={300}
                editable={!saving}
              />
              <Text style={styles.charCount}>{profileBio.length}/300</Text>
              {bioError ? <Text style={styles.errorText}>{bioError}</Text> : null}

              <Text style={[styles.panelLead, styles.panelLeadSpaced]}>Occupation</Text>
              <Text style={styles.fieldHelp}>Optional — visible to other members.</Text>
              <View style={styles.occupationChipWrap}>
                {OCCUPATION_OPTIONS.map((opt) => {
                  const active = occupation.trim().toLowerCase() === opt.toLowerCase();
                  return (
                    <Pressable
                      key={opt}
                      onPress={() => setOccupation(opt)}
                      disabled={saving}
                      style={({ pressed }) => [
                        styles.occupationChip,
                        active && styles.occupationChipOn,
                        pressed && !saving && styles.occupationChipPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Select occupation ${opt}`}
                    >
                      <Text style={[styles.occupationChipLabel, active && styles.occupationChipLabelOn]}>
                        {opt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                style={styles.fieldInput}
                value={occupation}
                onChangeText={setOccupation}
                onFocus={() => {
                  setOccupationFocused(true);
                  scrollOccupationIntoView();
                }}
                onBlur={() => setOccupationFocused(false)}
                placeholder="Or type your own"
                placeholderTextColor={COLORS.textMuted}
                maxLength={80}
                editable={!saving}
              />
              <Text style={styles.charCount}>{occupation.length}/80</Text>

              <Text style={[styles.panelLead, styles.panelLeadSpaced]}>Ride preferences</Text>
              <Text style={styles.fieldHelp}>Optional tags on your profile.</Text>
              <View style={styles.prefChipWrap}>
                {RIDE_PREFERENCE_OPTIONS.map((o) => {
                  const on = ridePrefs.includes(o.id);
                  return (
                    <Pressable
                      key={o.id}
                      onPress={() => toggleRidePreference(o.id)}
                      disabled={saving}
                      style={({ pressed }) => [
                        styles.prefChip,
                        on && styles.prefChipOn,
                        pressed && !saving && styles.prefChipPressed,
                      ]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={o.label}
                    >
                      <Ionicons name={o.icon} size={15} color={on ? COLORS.white : COLORS.primaryDark} />
                      <Text style={[styles.prefChipLabel, on && styles.prefChipLabelOn]}>{o.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelOverline}>Vehicles</Text>
              <Text style={styles.fieldHelpTight}>
                Used when you publish rides. You can add up to two.
              </Text>
              {rows.map((r, index) => (
                <View
                  key={r.key}
                  ref={(el) => {
                    vehicleCardRefs.current[r.key] = el;
                  }}
                  style={styles.vehicleCard}
                  onLayout={() => updateVehicleCardScrollY(r.key)}
                >
                  <View style={styles.editVehicleHeader}>
                    <View style={styles.editVehicleHeaderLeft}>
                      <View style={styles.editVehicleIcon}>
                        <Ionicons name="car-sport-outline" size={17} color={COLORS.primaryDark} />
                      </View>
                      <Text style={styles.editVehicleTitle}>
                        {rows.length > 1 ? `Vehicle ${index + 1}` : 'Your vehicle'}
                      </Text>
                    </View>
                    {canShowVehicleDelete(r, rows) ? (
                      <Pressable
                        style={({ pressed }) => [styles.vehicleDeleteBtn, pressed && styles.vehicleDeleteBtnPressed]}
                        onPress={() => handleDeleteVehicle(r)}
                        disabled={saving}
                        accessibilityRole="button"
                        accessibilityLabel="Remove vehicle"
                        hitSlop={8}
                      >
                        <Ionicons name="trash-outline" size={18} color={COLORS.error} />
                      </Pressable>
                    ) : null}
                  </View>
                  <Text style={styles.fieldLabel}>Model</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={r.vehicleModel}
                    onChangeText={(t) => updateRow(r.key, { vehicleModel: t })}
                    onFocus={() => scrollFieldIntoView(r.key, 'model')}
                    placeholder="Make & model"
                    placeholderTextColor={COLORS.textMuted}
                    editable={!saving}
                  />
                  <View style={styles.editVehicleRow}>
                    <View style={styles.editVehicleCol}>
                      <Text style={styles.fieldLabel}>Plate</Text>
                      <TextInput
                        style={styles.fieldInput}
                        value={r.licensePlate}
                        onChangeText={(t) => updateRow(r.key, { licensePlate: t })}
                        onFocus={() => scrollFieldIntoView(r.key, 'plate')}
                        placeholder="License plate"
                        placeholderTextColor={COLORS.textMuted}
                        autoCapitalize="characters"
                        editable={!saving}
                      />
                    </View>
                    <View style={styles.editVehicleCol}>
                      <Text style={styles.fieldLabel}>Color</Text>
                      <TextInput
                        style={styles.fieldInput}
                        value={r.vehicleColor}
                        onChangeText={(t) => updateRow(r.key, { vehicleColor: t })}
                        onFocus={() => scrollFieldIntoView(r.key, 'color')}
                        placeholder="Optional"
                        placeholderTextColor={COLORS.textMuted}
                        editable={!saving}
                      />
                    </View>
                  </View>
                </View>
              ))}
            </View>

            <View style={[styles.panel, styles.panelLast]}>
              <Text style={styles.panelOverline}>Account</Text>
              <Text style={styles.panelLead}>Phone</Text>
              <Text style={styles.fieldHelp}>For booking updates and verification.</Text>
              <View style={styles.inputWrap}>
                <Text style={styles.dial}>+91</Text>
                <TextInput
                  style={styles.input}
                  value={phoneNational}
                  onChangeText={(t) => {
                    setPhoneNational(clampPhoneNationalInput(t));
                    setPhoneError(undefined);
                  }}
                  placeholder="10-digit number"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="phone-pad"
                  maxLength={10}
                  editable={!saving}
                  onPressIn={scrollPhoneIntoView}
                  onFocus={() => {
                    setPhoneFocused(true);
                    scrollPhoneIntoView();
                  }}
                  onBlur={() => setPhoneFocused(false)}
                />
              </View>
              {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}
            </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        <View
          style={[
            styles.saveFooter,
            {
              paddingBottom: Math.max(insets.bottom, 12),
              bottom: keyboardBottomInset,
            },
          ]}
        >
          <Pressable
            style={({ pressed }) => [styles.saveBtn, saving && styles.saveBtnDisabled, pressed && !saving && styles.saveBtnPressed]}
            onPress={() => void onSave()}
            disabled={saving}
            accessibilityRole="button"
          >
            {saving ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.saveBtnText}>Save changes</Text>
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
    backgroundColor: COLORS.background,
  },
  statusBarFill: {
    backgroundColor: COLORS.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  headerBack: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBackPressed: {
    backgroundColor: COLORS.tabBarSelectedWell,
  },
  headerBackPlaceholder: {
    width: 40,
    height: 40,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.35,
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
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  scrollInner: {
    paddingBottom: 4,
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
  panelLast: {
    marginBottom: 8,
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
    marginBottom: 4,
  },
  panelLeadSpaced: {
    marginTop: 18,
  },
  fieldHelp: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textSecondary,
    marginBottom: 10,
    lineHeight: 19,
  },
  fieldHelpTight: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textSecondary,
    marginBottom: 14,
    lineHeight: 19,
  },
  bioInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.text,
    backgroundColor: COLORS.backgroundSecondary,
    minHeight: 96,
    maxHeight: 168,
  },
  charCount: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
    textAlign: 'right',
    marginTop: 6,
    marginBottom: 0,
  },
  prefChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  prefChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundSecondary,
  },
  prefChipOn: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  prefChipPressed: {
    opacity: 0.9,
  },
  prefChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  prefChipLabelOn: {
    color: COLORS.white,
  },
  occupationChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  occupationChip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundSecondary,
  },
  occupationChipOn: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  occupationChipPressed: {
    opacity: 0.9,
  },
  occupationChipLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
  },
  occupationChipLabelOn: {
    color: COLORS.white,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundSecondary,
    paddingHorizontal: 14,
    minHeight: 50,
  },
  dial: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.error,
    marginTop: 8,
  },
  vehicleCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    marginBottom: 10,
    backgroundColor: COLORS.backgroundSecondary,
  },
  editVehicleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  editVehicleHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  vehicleDeleteBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(220, 38, 38, 0.18)',
  },
  vehicleDeleteBtnPressed: {
    opacity: 0.88,
  },
  editVehicleIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: COLORS.primaryRipple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editVehicleTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.25,
  },
  editVehicleRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  editVehicleCol: {
    flex: 1,
    minWidth: 0,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.textMuted,
    marginBottom: 5,
    marginTop: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  fieldInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 11 : 9,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    backgroundColor: COLORS.surface,
    minHeight: 44,
  },
  saveFooter: {
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
  saveBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  saveBtnPressed: {
    backgroundColor: COLORS.primaryDark,
  },
  saveBtnDisabled: {
    opacity: 0.65,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: -0.2,
  },
});
