import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from '../../utils/themedAlert';
import { COLORS } from '../../constants/colors';
import { allowedPublishFareRange } from '../../utils/publishFare';
import { alertFareOutsideAllowedRange } from '../../utils/publishAlerts';

const STEP_RUPEES = 10;
/** Space between sheet bottom and top of keyboard (sheet moves up by keyboard height minus this). */
const KEYBOARD_GAP_PX = 12;
const KEYBOARD_ANIM_MS_ANDROID = 220;

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n) || Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

export type PublishFareBottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  distanceKm: number;
  initialAmount: number;
  onConfirm: (amount: number) => void;
};

export default function PublishFareBottomSheet({
  visible,
  onClose,
  distanceKm,
  initialAmount,
  onConfirm,
}: PublishFareBottomSheetProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [inputText, setInputText] = useState(() =>
    String(Math.max(1, Math.round(initialAmount)))
  );
  /** Negative translateY moves the sheet up with the keyboard (animated — avoids snap glitch). */
  const keyboardShift = useRef(new Animated.Value(0)).current;
  const keyboardAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  const runKeyboardAnim = (toValue: number, durationMs: number) => {
    keyboardAnimRef.current?.stop?.();
    const anim = Animated.timing(keyboardShift, {
      toValue,
      duration: Math.max(120, Math.min(400, durationMs)),
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: true,
    });
    keyboardAnimRef.current = anim;
    anim.start(() => {
      keyboardAnimRef.current = null;
    });
  };

  const { minRecommended, maxRecommended, minAllowed, maxAllowed } = useMemo(
    () => allowedPublishFareRange(Math.max(0.1, distanceKm)),
    [distanceKm]
  );

  useEffect(() => {
    if (!visible) return;
    const clamped = clampInt(initialAmount, minAllowed, maxAllowed);
    if (clamped >= maxAllowed) {
      setInputText(String(minAllowed));
      return;
    }
    setInputText(String(clamped));
  }, [visible, initialAmount, minAllowed, maxAllowed]);

  useEffect(() => {
    if (!visible) {
      keyboardAnimRef.current?.stop?.();
      keyboardAnimRef.current = null;
      keyboardShift.setValue(0);
      return;
    }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: { endCoordinates?: { height: number }; duration?: number }) => {
      const h = e.endCoordinates?.height ?? 0;
      const lift = Math.max(0, Math.round(h) - KEYBOARD_GAP_PX);
      const duration =
        Platform.OS === 'ios' && typeof e.duration === 'number' && e.duration > 0
          ? e.duration
          : KEYBOARD_ANIM_MS_ANDROID;
      runKeyboardAnim(-lift, duration);
    };
    const onHide = (e: { duration?: number }) => {
      const duration =
        Platform.OS === 'ios' && typeof e.duration === 'number' && e.duration > 0
          ? e.duration
          : KEYBOARD_ANIM_MS_ANDROID;
      runKeyboardAnim(0, duration);
    };
    const subShow = Keyboard.addListener(showEvt, onShow);
    const subHide = Keyboard.addListener(hideEvt, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
      keyboardAnimRef.current?.stop?.();
      keyboardAnimRef.current = null;
      keyboardShift.setValue(0);
    };
  }, [visible, keyboardShift]);

  const parseInputAmount = (): number | null => {
    const digits = inputText.replace(/\D/g, '');
    if (digits === '') return null;
    const n = parseInt(digits, 10);
    return Number.isNaN(n) ? null : n;
  };

  const setClampedToInput = (n: number) => {
    setInputText(String(clampInt(n, minAllowed, maxAllowed)));
  };

  const decrementStep = () => {
    const cur = parseInputAmount();
    const base = cur ?? minAllowed;
    setClampedToInput(base - STEP_RUPEES);
  };

  const incrementStep = () => {
    const cur = parseInputAmount();
    const base = cur ?? minAllowed;
    setClampedToInput(base + STEP_RUPEES);
  };

  const currentVal = parseInputAmount();
  const effectiveForBounds = currentVal ?? minAllowed;
  const atMin = effectiveForBounds <= minAllowed;
  const atMax = effectiveForBounds >= maxAllowed;

  const handleDone = () => {
    const n = parseInputAmount();
    if (n === null || n < 1) {
      Alert.alert('Fare', 'Enter a valid amount in rupees.');
      return;
    }
    if (n < minAllowed || n > maxAllowed) {
      alertFareOutsideAllowedRange(minAllowed, maxAllowed);
      return;
    }
    onConfirm(n);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      hardwareAccelerated={Platform.OS === 'android'}
      {...(Platform.OS === 'ios' ? ({ presentationStyle: 'overFullScreen' } as const) : {})}
    >
      <View style={styles.modalRoot} pointerEvents="box-none">
        <View style={styles.keyboardWrap}>
          <Pressable
            style={styles.backdrop}
            onPress={onClose}
            accessibilityLabel="Dismiss"
            accessibilityRole="button"
          />
          <Animated.View
            style={[
              styles.sheet,
              {
                paddingBottom: Math.max(insets.bottom, 18),
                transform: [{ translateY: keyboardShift }],
              },
            ]}
          >
            <View style={styles.handleBarWrap}>
              <View style={styles.handleBar} />
            </View>

            <View style={styles.headerRow}>
              <Text style={styles.title}>Fare per seat</Text>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={12}
                style={styles.iconBtn}
                accessibilityLabel="Close"
                accessibilityRole="button"
              >
                <Ionicons name="close" size={22} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.rangeBlock}>
              <View style={styles.rangeLine}>
                <Ionicons name="sparkles" size={16} color={COLORS.success} />
                <Text style={styles.rangeMain}>
                  Suggested ₹{minRecommended}–₹{maxRecommended}
                </Text>
              </View>
            </View>

            <View style={styles.amountCard}>
              <Pressable
                style={({ pressed }) => [
                  styles.stepPad,
                  styles.stepPadMinus,
                  atMin && styles.stepPadDisabled,
                  pressed && !atMin && styles.stepPadMinusPressed,
                ]}
                onPress={decrementStep}
                disabled={atMin}
                accessibilityRole="button"
                accessibilityLabel={`Decrease by ${STEP_RUPEES} rupees`}
                android_ripple={{ color: 'rgba(15, 23, 42, 0.06)', borderless: true }}
              >
                <Ionicons name="remove" size={26} color={atMin ? COLORS.textMuted : COLORS.primary} />
              </Pressable>

              <View style={styles.inputCenter}>
                <TextInput
                  style={styles.input}
                  value={inputText}
                  onChangeText={(t) => setInputText(t.replace(/\D/g, '').slice(0, 6))}
                  keyboardType={Platform.OS === 'android' ? 'numeric' : 'number-pad'}
                  placeholderTextColor={COLORS.textMuted}
                  selectionColor={COLORS.primary}
                  maxLength={6}
                  textAlign="center"
                />
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.stepPad,
                  styles.stepPadPlus,
                  atMax && styles.stepPadDisabled,
                  pressed && !atMax && styles.stepPadPlusPressed,
                ]}
                onPress={incrementStep}
                disabled={atMax}
                accessibilityRole="button"
                accessibilityLabel={`Increase by ${STEP_RUPEES} rupees`}
                android_ripple={{ color: 'rgba(255, 255, 255, 0.22)', borderless: true }}
              >
                <Ionicons
                  name="add"
                  size={28}
                  color={atMax ? 'rgba(255, 255, 255, 0.42)' : COLORS.white}
                />
              </Pressable>
            </View>

            <TouchableOpacity style={styles.doneBtn} onPress={handleDone} activeOpacity={0.9}>
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </Animated.View>
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
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 16,
      },
      android: { elevation: 24 },
    }),
  },
  handleBarWrap: { alignItems: 'center', paddingVertical: 8 },
  handleBar: { width: 36, height: 4, borderRadius: 2, backgroundColor: COLORS.border },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: '800', color: COLORS.text, letterSpacing: -0.2 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeBlock: {
    marginBottom: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  rangeLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rangeMain: { flex: 1, fontSize: 15, fontWeight: '700', color: COLORS.text },
  amountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      },
      android: { elevation: 2 },
    }),
  },
  stepPad: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepPadMinus: {
    backgroundColor: COLORS.white,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
      },
      android: { elevation: 1 },
    }),
  },
  stepPadPlus: {
    backgroundColor: COLORS.primary,
    borderWidth: 0,
    ...Platform.select({
      ios: {
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.35,
        shadowRadius: 6,
      },
      android: { elevation: 4 },
    }),
  },
  stepPadMinusPressed: {
    backgroundColor: COLORS.borderLight,
    borderColor: COLORS.textMuted,
  },
  stepPadPlusPressed: {
    backgroundColor: COLORS.primaryDark,
  },
  stepPadDisabled: {
    opacity: 0.38,
  },
  inputCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  input: {
    flex: 1,
    minWidth: 48,
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  doneBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
  },
  doneBtnText: { fontSize: 16, fontWeight: '800', color: COLORS.white },
});
