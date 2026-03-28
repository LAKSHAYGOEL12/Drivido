import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { RootStackScreenProps } from '../../navigation/types';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { API } from '../../constants/API';
import { validation, validationErrors } from '../../constants/validation';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import { COLORS } from '../../constants/colors';
import type { RegisterResponse } from '../../types/api';
import { requestForegroundLocationAfterAuth } from '../../services/location-permission-auth';
import { pickAvatarUrlFromRecord } from '../../utils/avatarUrl';

type Props = RootStackScreenProps<'Register'>;

export default function Register(): React.JSX.Element {
  const navigation = useNavigation<Props['navigation']>();
  const { login, setLoading, isLoading } = useAuth();
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{
    phone?: string;
    email?: string;
    username?: string;
    password?: string;
  }>({});
  const scrollRef = useRef<ScrollView | null>(null);
  const passwordFieldYRef = useRef(0);

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
    if (!validation.phone(phone)) next.phone = validationErrors.phone;
    if (!validation.email(email)) next.email = validationErrors.email;
    if (!validation.name(username)) next.username = validationErrors.name;
    if (!validation.password(password)) next.password = validationErrors.password;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleRegister = async () => {
    if (!validate() || isLoading) return;
    setLoading(true);
    setErrors({});
    try {
      const res = await api.post<RegisterResponse>(API.endpoints.auth.register, {
        phone: phone.replace(/\D/g, '').replace(/^91(?=\d{10})/, '').slice(-10),
        email: email.trim().toLowerCase(),
        name: username.trim(),
        password,
      });
      const user = res?.user;
      const accessToken = res?.token;
      const refreshToken = (res as { refreshToken?: string }).refreshToken;
      if (!user || !accessToken) {
        throw new Error('Invalid response from server');
      }
      const userId = typeof user.id === 'string' ? user.id : String((user as { _id?: unknown })._id ?? '');
      const avatarUrl = pickAvatarUrlFromRecord(user as unknown as Record<string, unknown>);
      login(
        {
          id: userId,
          phone: user.phone ?? '',
          email: user.email ?? '',
          name: user.name ?? (username.trim() || undefined),
          createdAt:
            typeof (user as { createdAt?: unknown }).createdAt === 'string'
              ? String((user as { createdAt?: string }).createdAt)
              : typeof (user as { created_at?: unknown }).created_at === 'string'
                ? String((user as { created_at?: string }).created_at)
                : undefined,
          ...(avatarUrl ? { avatarUrl } : {}),
        },
        accessToken,
        refreshToken ?? accessToken
      );
      await requestForegroundLocationAfterAuth();
      Alert.alert('Sign up done', 'Welcome! You are now signed in.', [
        {
          text: 'OK',
          onPress: () => navigation.navigate('Main'),
        },
      ]);
    } catch (e: unknown) {
      const message =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : 'Sign up failed. Check your backend is running on port 3000.';
      setErrors({ password: message });
      Alert.alert('Sign up failed', message);
    } finally {
      setLoading(false);
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
              Sign up with phone, email, name and password
            </Text>
          </View>

          <View style={styles.form}>
            <Input
              label="Phone number"
              value={phone}
              onChangeText={setPhone}
              placeholder="e.g. 9876543210"
              error={errors.phone}
              keyboardType="phone-pad"
              autoCapitalize="none"
              editable={!isLoading}
            />
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
