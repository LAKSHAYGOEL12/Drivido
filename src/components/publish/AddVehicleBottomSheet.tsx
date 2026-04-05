import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  Pressable,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';

export type VehicleFormValues = {
  vehicleModel: string;
  licensePlate: string;
  vehicleColor: string;
};

export type AddVehicleBottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Save vehicle to profile then caller publishes the ride. */
  onAddAndPublish: (v: VehicleFormValues) => Promise<void>;
  busy?: boolean;
};

const FIELD_SCROLL_PADDING = 28;

export default function AddVehicleBottomSheet({
  visible,
  onClose,
  onAddAndPublish,
  busy = false,
}: AddVehicleBottomSheetProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollView | null>(null);
  const nameFieldYRef = useRef(0);
  const plateFieldYRef = useRef(0);
  const colorFieldYRef = useRef(0);
  const [keyboardPad, setKeyboardPad] = useState(0);

  const [vehicleName, setVehicleName] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [color, setColor] = useState('');
  const [errors, setErrors] = useState<{ name?: string; plate?: string }>({});

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: { endCoordinates?: { height: number } }) => {
      const h = e.endCoordinates?.height ?? 0;
      setKeyboardPad(Number.isFinite(h) ? h : 0);
    };
    const onHide = () => setKeyboardPad(0);
    const subShow = Keyboard.addListener(showEvt, onShow);
    const subHide = Keyboard.addListener(hideEvt, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  useEffect(() => {
    if (visible) {
      setErrors({});
    }
  }, [visible]);

  /** Same pattern as Register — scroll so the focused field sits above the keyboard. */
  const scrollFieldIntoView = useCallback((y: number) => {
    const target = Math.max(0, y - FIELD_SCROLL_PADDING);
    const run = () => scrollRef.current?.scrollTo({ y: target, animated: true });
    setTimeout(run, 80);
    setTimeout(run, 260);
  }, []);

  const validate = useCallback((): boolean => {
    const next: typeof errors = {};
    if (!vehicleName.trim()) next.name = 'Enter a vehicle name';
    if (!licensePlate.trim()) next.plate = 'Enter license plate / vehicle number';
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [vehicleName, licensePlate]);

  const submit = useCallback(async () => {
    if (!validate() || busy) return;
    await onAddAndPublish({
      vehicleModel: vehicleName.trim(),
      licensePlate: licensePlate.trim().toUpperCase(),
      vehicleColor: color.trim(),
    });
  }, [validate, busy, vehicleName, licensePlate, color, onAddAndPublish]);

  const addFormReserved = insets.bottom + 190;
  const addScrollMaxHeight = Math.max(
    160,
    Math.min(380, windowHeight * 0.88 - addFormReserved)
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalRoot}>
        <View style={styles.keyboardWrap}>
          <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose} />
          <View
            style={[
              styles.sheet,
              {
                paddingBottom: Math.max(insets.bottom, 16),
                transform: [{ translateY: -keyboardPad }],
              },
            ]}
          >
            <View style={styles.handleBarWrap}>
              <View style={styles.handleBar} />
            </View>

            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleBlock}>
                <Text style={styles.sheetTitle}>Add vehicle</Text>
                <Text style={styles.sheetSubtitle}>Enter vehicle details to publish your ride.</Text>
              </View>
              <TouchableOpacity
                onPress={onClose}
                disabled={busy}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              ref={scrollRef}
              style={[styles.scroll, { maxHeight: addScrollMaxHeight }]}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              showsVerticalScrollIndicator={false}
            >
              <View
                onLayout={(e) => {
                  nameFieldYRef.current = e.nativeEvent.layout.y;
                }}
              >
                <Text style={styles.label}>
                  Vehicle name <Text style={styles.asterisk}>*</Text>
                </Text>
                <TextInput
                  style={[styles.input, errors.name && styles.inputError]}
                  placeholder="e.g., Toyota Innova"
                  placeholderTextColor={COLORS.textMuted}
                  value={vehicleName}
                  onChangeText={(t) => {
                    setVehicleName(t);
                    setErrors((er) => ({ ...er, name: undefined }));
                  }}
                  editable={!busy}
                  onFocus={() => scrollFieldIntoView(nameFieldYRef.current)}
                />
                {errors.name ? <Text style={styles.err}>{errors.name}</Text> : null}
              </View>

              <View
                onLayout={(e) => {
                  plateFieldYRef.current = e.nativeEvent.layout.y;
                }}
              >
                <Text style={styles.label}>
                  License plate / Vehicle number <Text style={styles.asterisk}>*</Text>
                </Text>
                <TextInput
                  style={[styles.input, errors.plate && styles.inputError]}
                  placeholder="E.G., KA-01-AB-1234"
                  placeholderTextColor={COLORS.textMuted}
                  value={licensePlate}
                  onChangeText={(t) => {
                    setLicensePlate(t);
                    setErrors((er) => ({ ...er, plate: undefined }));
                  }}
                  autoCapitalize="characters"
                  editable={!busy}
                  onFocus={() => scrollFieldIntoView(plateFieldYRef.current)}
                />
                {errors.plate ? <Text style={styles.err}>{errors.plate}</Text> : null}
              </View>

              <View
                onLayout={(e) => {
                  colorFieldYRef.current = e.nativeEvent.layout.y;
                }}
              >
                <Text style={styles.label}>
                  Color <Text style={styles.optional}>(optional)</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., Pearl White"
                  placeholderTextColor={COLORS.textMuted}
                  value={color}
                  onChangeText={setColor}
                  editable={!busy}
                  onFocus={() => scrollFieldIntoView(colorFieldYRef.current)}
                />
              </View>
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity onPress={onClose} disabled={busy} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryBtn, busy && styles.primaryBtnDisabled]}
                onPress={() => void submit()}
                disabled={busy}
                activeOpacity={0.85}
              >
                {busy ? (
                  <ActivityIndicator color={COLORS.white} size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>Add & Publish</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  keyboardWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '88%',
    paddingHorizontal: 20,
    paddingTop: 4,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 16,
  },
  handleBarWrap: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitleBlock: {
    flex: 1,
    paddingRight: 8,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
  },
  sheetSubtitle: {
    marginTop: 6,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  closeBtn: {
    marginLeft: 8,
  },
  scroll: {},
  scrollContent: {
    paddingBottom: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  optional: {
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  asterisk: {
    color: COLORS.error,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.backgroundSecondary,
    marginBottom: 14,
  },
  inputError: {
    borderColor: COLORS.error,
  },
  err: {
    fontSize: 13,
    color: COLORS.error,
    marginTop: -10,
    marginBottom: 10,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    rowGap: 10,
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    minWidth: 120,
    alignItems: 'center',
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: '100%',
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.white,
  },
});
