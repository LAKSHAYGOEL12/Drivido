import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { COLORS } from '../../constants/colors';
import type { ProfileStackParamList } from '../../navigation/types';
import {
  patchUserPhoneOnly,
  patchUserVehicleProfile,
  clearLegacyUserVehicleProfile,
} from '../../services/userProfile';
import { createUserVehicle, deleteUserVehicle, updateUserVehicle } from '../../services/userVehicles';
import {
  validation,
  validationErrors,
  normalizePhoneForValidation,
  clampPhoneNationalInput,
} from '../../constants/validation';
import { vehiclesFromUser } from '../../utils/userVehicle';

/** Scroll padding so last fields clear the fixed save bar (~footer + spacing). */
const SCROLL_PADDING_ABOVE_FOOTER = 120;

/** Approx. Y offset from vehicle card top to plate/color row (scroll target). */
const CARD_OFFSET_PLATE_COLOR = 168;
const CARD_OFFSET_MODEL = 48;
/** Keep focused field this many px below the top of the visible scroll area. */
const FOCUS_SCROLL_TOP_MARGIN = 96;

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
  const [rows, setRows] = useState<VehicleFormRow[]>(() => buildInitialRows(user));
  const [saving, setSaving] = useState(false);
  const [phoneError, setPhoneError] = useState<string | undefined>();
  /** Lifts the save bar above the keyboard; reset to 0 on hide avoids stuck gap from KeyboardAvoidingView. */
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  /** Y of each vehicle card top inside scroll content (from onLayout). */
  const vehicleCardY = useRef<Record<string, number>>({});

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
        'Remove this vehicle from your profile? You can add another one later.',
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
                  const msg = e instanceof Error ? e.message : 'Could not remove vehicle.';
                  Alert.alert('Remove failed', msg);
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
    if (!validation.phoneNational(phoneNational)) {
      setPhoneError(validationErrors.phone);
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
              'Enter both vehicle name and license plate, or leave all fields empty to skip adding a vehicle.'
            );
            return;
          }
        }
      } else if (!m || !p) {
        Alert.alert('Vehicle', 'Enter vehicle name and license plate for each saved vehicle.');
        return;
      }
    }

    Keyboard.dismiss();
    setSaving(true);
    try {
      await patchUserPhoneOnly(phoneNational);
      const national = clampPhoneNationalInput(phoneNational);
      patchUser({ phone: national });

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
      navigation.goBack();
    } catch (e) {
      const msg =
        e instanceof Error && e.message === 'INVALID_PHONE'
          ? validationErrors.phone
          : e instanceof Error
            ? e.message
            : 'Try again.';
      Alert.alert('Could not save', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      <View style={[styles.statusBarFill, { height: insets.top }]} />
      <View style={styles.header}>
        <Pressable
          style={styles.headerBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Edit profile</Text>
        <View style={styles.headerBtn} />
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
        <Text style={styles.hint}>
          You can update your phone number and vehicle details. Name, email, and date of birth are not editable here.
        </Text>

        <Text style={styles.sectionLabel}>Phone</Text>
        <View style={styles.inputWrap}>
          <Text style={styles.dial}>+91</Text>
          <TextInput
            style={styles.input}
            value={phoneNational}
            onChangeText={(t) => {
              setPhoneNational(clampPhoneNationalInput(t));
              setPhoneError(undefined);
            }}
            placeholder="10-digit mobile"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="number-pad"
            maxLength={10}
            editable={!saving}
          />
        </View>
        {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}

        <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Vehicles</Text>
        {rows.map((r, index) => (
          <View
            key={r.key}
            style={styles.vehicleCard}
            onLayout={(e) => {
              vehicleCardY.current[r.key] = e.nativeEvent.layout.y;
            }}
          >
            <View style={styles.editVehicleHeader}>
              <View style={styles.editVehicleHeaderLeft}>
                <View style={styles.editVehicleIcon}>
                  <Ionicons name="car-sport-outline" size={16} color={COLORS.primary} />
                </View>
                <Text style={styles.editVehicleTitle}>
                  {rows.length > 1 ? `Vehicle ${index + 1}` : 'Vehicle'}
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
                  <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.fieldLabel}>Model</Text>
            <TextInput
              style={styles.fieldInput}
              value={r.vehicleModel}
              onChangeText={(t) => updateRow(r.key, { vehicleModel: t })}
              onFocus={() => scrollFieldIntoView(r.key, 'model')}
              placeholder="Toyota Innova"
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
                  placeholder="KA01AB1234"
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
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
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
    backgroundColor: COLORS.white,
  },
  statusBarFill: {
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
    backgroundColor: COLORS.white,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
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
    paddingTop: 16,
  },
  saveFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
    backgroundColor: COLORS.white,
  },
  hint: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textSecondary,
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  sectionLabelSpaced: {
    marginTop: 4,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundSecondary,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  dial: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    paddingVertical: 10,
  },
  errorText: {
    fontSize: 13,
    color: COLORS.error,
    marginTop: 6,
  },
  vehicleCard: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    marginBottom: 10,
    backgroundColor: COLORS.white,
  },
  editVehicleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  editVehicleHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  vehicleDeleteBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  vehicleDeleteBtnPressed: {
    opacity: 0.85,
  },
  editVehicleIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editVehicleTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.2,
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
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginBottom: 4,
    marginTop: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 15,
    color: COLORS.text,
    backgroundColor: COLORS.backgroundSecondary,
    minHeight: 42,
  },
  saveBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  saveBtnDisabled: {
    opacity: 0.7,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
});
