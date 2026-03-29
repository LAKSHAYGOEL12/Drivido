import React, { useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  TouchableOpacity,
  Modal,
  Pressable,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { RootStackScreenProps } from '../../navigation/types';
import { isFirebaseAuthConfigured } from '../../config/firebase';
import {
  firebaseAuthErrorToMessage,
  signUpWithEmailAndProfile,
} from '../../services/firebaseAuthBridge';
import {
  setPendingFirebaseProfilePatch,
  clearPendingFirebaseProfilePatch,
} from '../../services/pendingFirebaseProfile';
import {
  validation,
  validationErrors,
  GENDER_OPTIONS,
  type GenderValue,
} from '../../constants/validation';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import { COLORS } from '../../constants/colors';
type Props = RootStackScreenProps<'Register'>;

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

export default function Register(): React.JSX.Element {
  const navigation = useNavigation<Props['navigation']>();
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<GenderValue | ''>('');
  const [errors, setErrors] = useState<{
    email?: string;
    username?: string;
    password?: string;
    dateOfBirth?: string;
    gender?: string;
  }>({});
  const scrollRef = useRef<ScrollView | null>(null);
  const passwordFieldYRef = useRef(0);
  const [dobPickerOpen, setDobPickerOpen] = useState(false);
  const [dobPickerDate, setDobPickerDate] = useState(() => new Date());

  const { dobMin, dobMax } = useMemo(() => {
    const max = new Date();
    max.setFullYear(max.getFullYear() - 13);
    const min = new Date();
    min.setFullYear(min.getFullYear() - 120);
    return { dobMin: min, dobMax: max };
  }, []);

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

  const scrollFieldIntoView = () => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 80);
  };

  const scrollPasswordIntoView = () => {
    setTimeout(() => {
      const target = Math.max(0, passwordFieldYRef.current - 24);
      scrollRef.current?.scrollTo({ y: target, animated: true });
    }, 80);
    setTimeout(() => {
      const target = Math.max(0, passwordFieldYRef.current - 24);
      scrollRef.current?.scrollTo({ y: target, animated: true });
    }, 260);
  };

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!validation.email(email)) next.email = validationErrors.email;
    if (!validation.name(username)) next.username = validationErrors.name;
    if (!validation.password(password)) next.password = validationErrors.password;
    if (!validation.dateOfBirth(dateOfBirth)) next.dateOfBirth = validationErrors.dateOfBirth;
    if (!gender || !validation.gender(gender)) next.gender = validationErrors.gender;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleRegister = async () => {
    if (!validate() || isLoading) return;
    if (!isFirebaseAuthConfigured()) {
      Alert.alert(
        'Firebase not configured',
        'Add EXPO_PUBLIC_FIREBASE_* keys to .env (see .env.example), then run npx expo start --clear.'
      );
      return;
    }
    setIsLoading(true);
    setErrors({});
    try {
      setPendingFirebaseProfilePatch({
        dateOfBirth: dateOfBirth.trim(),
        gender: gender as string,
      });
      await signUpWithEmailAndProfile({
        email: email.trim().toLowerCase(),
        name: username.trim(),
        password,
      });
    } catch (e: unknown) {
      clearPendingFirebaseProfilePatch();
      const message = firebaseAuthErrorToMessage(e);
      setErrors({ password: message });
      Alert.alert('Sign up failed', message);
      return;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 16 : 20}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.logoBox}>
              <Text style={styles.logoText}>D</Text>
            </View>
            <Text style={styles.title}>Create account</Text>
            <Text style={styles.subtitle}>
              Enter your name, date of birth, gender, email, and password
            </Text>
          </View>

          <View style={styles.form}>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              error={errors.email}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              editable={!isLoading}
            />
            <Input
              label="Name"
              value={username}
              onChangeText={setUsername}
              placeholder="Your name (2–100 characters)"
              error={errors.username}
              autoCapitalize="words"
              autoComplete="name"
              editable={!isLoading}
              onFocus={scrollFieldIntoView}
            />
            {Platform.OS === 'web' ? (
              <Input
                label="Date of birth"
                value={dateOfBirth}
                onChangeText={setDateOfBirth}
                placeholder="YYYY-MM-DD (e.g. 1995-03-15)"
                error={errors.dateOfBirth}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                editable={!isLoading}
                onFocus={scrollFieldIntoView}
              />
            ) : (
              <View style={styles.dobBlock}>
                <Text style={styles.dobLabel}>Date of birth</Text>
                <TouchableOpacity
                  style={[styles.dobTouchable, errors.dateOfBirth ? styles.dobTouchableError : null]}
                  onPress={openDobPicker}
                  disabled={isLoading}
                  accessibilityRole="button"
                  accessibilityLabel="Open calendar to choose date of birth"
                >
                  <Text style={[styles.dobValue, !dateOfBirth.trim() ? styles.dobPlaceholder : null]}>
                    {dateOfBirth.trim() ? dateOfBirth.trim() : 'Tap to choose date'}
                  </Text>
                  <Ionicons name="calendar-outline" size={22} color="#64748b" />
                </TouchableOpacity>
                {errors.dateOfBirth ? <Text style={styles.genderError}>{errors.dateOfBirth}</Text> : null}
              </View>
            )}

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
              <Modal
                visible={dobPickerOpen}
                animationType="slide"
                transparent
                onRequestClose={() => setDobPickerOpen(false)}
              >
                <View style={styles.dobModalRoot}>
                  <Pressable style={styles.dobModalBackdrop} onPress={() => setDobPickerOpen(false)} />
                  <SafeAreaView edges={['bottom']} style={styles.dobModalSheet}>
                    <View style={styles.dobModalHeader}>
                      <TouchableOpacity onPress={() => setDobPickerOpen(false)} hitSlop={12}>
                        <Text style={styles.dobModalCancel}>Cancel</Text>
                      </TouchableOpacity>
                      <Text style={styles.dobModalTitle}>Date of birth</Text>
                      <TouchableOpacity onPress={confirmIosDob} hitSlop={12}>
                        <Text style={styles.dobModalDone}>Done</Text>
                      </TouchableOpacity>
                    </View>
                    <DateTimePicker
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
                  </SafeAreaView>
                </View>
              </Modal>
            ) : null}
            <View style={styles.genderBlock}>
              <Text style={styles.genderLabel}>Gender</Text>
              <View style={styles.genderGrid}>
                {GENDER_OPTIONS.map((opt) => {
                  const selected = gender === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.genderChip, selected && styles.genderChipSelected]}
                      onPress={() => {
                        setGender(opt.value);
                        setErrors((e) => ({ ...e, gender: undefined }));
                      }}
                      disabled={isLoading}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.genderChipText, selected && styles.genderChipTextSelected]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {errors.gender ? <Text style={styles.genderError}>{errors.gender}</Text> : null}
            </View>
            <View
              onLayout={(e) => {
                passwordFieldYRef.current = e.nativeEvent.layout.y;
              }}
            >
              <Input
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="Min 8 characters, letter + number"
                error={errors.password}
                secureTextEntry={true}
                editable={!isLoading}
                onFocus={scrollPasswordIntoView}
              />
            </View>

            <Button
              title={isLoading ? 'Signing up…' : 'Sign up'}
              onPress={handleRegister}
              disabled={isLoading}
              variant="primary"
              style={styles.button}
            />
          </View>
          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('Login')}
              disabled={isLoading}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.loginLink}>Log in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoBox: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoText: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  form: {
    marginBottom: 18,
  },
  dobBlock: {
    marginBottom: 16,
  },
  dobLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#334155',
    marginBottom: 6,
  },
  dobTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: COLORS.background,
  },
  dobTouchableError: {
    borderColor: COLORS.error,
  },
  dobValue: {
    fontSize: 16,
    color: COLORS.text,
    flex: 1,
  },
  dobPlaceholder: {
    color: '#94a3b8',
  },
  dobModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  dobModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  dobModalSheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 8,
  },
  dobModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  dobModalTitle: {
    fontSize: 16,
    fontWeight: '700',
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
    fontWeight: '700',
  },
  genderBlock: {
    marginBottom: 12,
  },
  genderLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  genderGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genderChip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.textSecondary + '55',
    backgroundColor: COLORS.background,
  },
  genderChipSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '22',
  },
  genderChipText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  genderChipTextSelected: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  genderError: {
    marginTop: 6,
    fontSize: 13,
    color: COLORS.error,
  },
  button: {
    marginTop: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  footerText: {
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  loginLink: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
  },
});
