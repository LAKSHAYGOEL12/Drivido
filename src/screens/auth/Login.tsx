import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { AuthStackScreenProps } from '../../navigation/types';
import { useAuth } from '../../contexts/AuthContext';
import api, { getApiBaseUrl, testServerConnection } from '../../services/api';
import { getApiBaseUrlDebug } from '../../config/apiBaseUrl';
import { API } from '../../constants/API';
import { validation, validationErrors } from '../../constants/validation';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import { COLORS } from '../../constants/colors';
import type { LoginResponse } from '../../types/api';
import { requestForegroundLocationAfterAuth } from '../../services/location-permission-auth';

type Props = AuthStackScreenProps<'Login'>;

export default function Login(): React.JSX.Element {
  const navigation = useNavigation<Props['navigation']>();
  const { login } = useAuth();
  const [phoneOrEmail, setPhoneOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ phoneOrEmail?: string; password?: string }>({});
  const [signingIn, setSigningIn] = useState(false);
  const [overlaySuccess, setOverlaySuccess] = useState(false);
  const [connectionTest, setConnectionTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  /** After 429, block repeat login attempts so the client doesn’t make rate limits worse. */
  const [loginBlockedUntil, setLoginBlockedUntil] = useState(0);
  const [, setCooldownTick] = useState(0);
  const pendingLoginRef = useRef<{ user: Parameters<typeof login>[0]; accessToken: string; refreshToken: string } | null>(null);

  useEffect(() => {
    if (loginBlockedUntil <= Date.now()) return;
    const id = setInterval(() => setCooldownTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [loginBlockedUntil]);

  const loginOnCooldown = Date.now() < loginBlockedUntil;
  const cooldownSecs = loginOnCooldown ? Math.ceil((loginBlockedUntil - Date.now()) / 1000) : 0;

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionTest(null);
    try {
      const result = await testServerConnection();
      setConnectionTest(result);
      if (!result.ok) Alert.alert('Connection test', result.message);
    } finally {
      setTestingConnection(false);
    }
  };

  const isEmail = validation.email(phoneOrEmail);
  const isPhone = validation.phone(phoneOrEmail);

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!phoneOrEmail.trim()) next.phoneOrEmail = 'Enter phone number or email';
    else if (!isPhone && !isEmail) next.phoneOrEmail = 'Enter a valid phone number or email';
    if (!password.trim()) next.password = 'Enter your password';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleLogin = async () => {
    if (loginOnCooldown || !validate() || signingIn) return;
    setSigningIn(true);
    setErrors({});
    try {
      const body = isEmail
        ? { email: phoneOrEmail.trim().toLowerCase(), password }
        : {
            phone: phoneOrEmail.replace(/\D/g, '').replace(/^91(?=\d{10})/, '').slice(-10),
            password,
          };
      const res = await api.post<LoginResponse>(API.endpoints.auth.login, body, { timeout: 25000 });
      const user = res?.user;
      const accessToken = res?.token;
      const refreshToken = res?.refreshToken;
      if (!user || !accessToken) {
        throw new Error('Invalid response from server');
      }
      const userId = typeof user.id === 'string' ? user.id : String((user as { _id?: unknown })._id ?? '');
      const userObj = {
        id: userId,
        phone: user.phone ?? '',
        email: (user as { email?: string }).email,
        name: user.name,
        createdAt:
          typeof (user as { createdAt?: unknown }).createdAt === 'string'
            ? String((user as { createdAt?: string }).createdAt)
            : typeof (user as { created_at?: unknown }).created_at === 'string'
              ? String((user as { created_at?: string }).created_at)
              : undefined,
      };
      pendingLoginRef.current = { user: userObj, accessToken, refreshToken: refreshToken ?? accessToken };
      setOverlaySuccess(true);
      setTimeout(() => {
        const pending = pendingLoginRef.current;
        if (pending) {
          pendingLoginRef.current = null;
          setLoginBlockedUntil(0);
          login(pending.user, pending.accessToken, pending.refreshToken);
          void requestForegroundLocationAfterAuth();
        }
      }, 450);
    } catch (e: unknown) {
      const status =
        e && typeof e === 'object' && 'status' in e
          ? (e as { status: unknown }).status
          : undefined;
      const is429 = status === 429;
      const message =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : 'Sign in failed. Check your credentials and backend.';
      setErrors({ password: message });
      if (is429) {
        setLoginBlockedUntil(Date.now() + 60_000);
        Alert.alert(
          'Too many requests (429)',
          'Your API server is rate-limiting login for this device/IP. Wait about 1 minute.\n\n' +
            'This is not fixable in the app alone — relax or skip limits for POST /api/auth/login in development. ' +
            'See docs/BACKEND_DEV_RATE_LIMITS.md in the Drivido project.'
        );
      } else {
        Alert.alert('Sign in failed', message);
      }
      setSigningIn(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Modal visible={signingIn} transparent animationType="fade">
        <View style={styles.loaderOverlay}>
          <View style={styles.loaderBox}>
            {overlaySuccess ? (
              <>
                <Ionicons name="checkmark-circle" size={56} color={COLORS.primary} />
                <Text style={styles.loaderText}>Welcome back!</Text>
              </>
            ) : (
              <>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.loaderText}>Signing in…</Text>
              </>
            )}
          </View>
        </View>
      </Modal>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 16 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.logoBox}>
              <Text style={styles.logoText}>D</Text>
            </View>
            <Text style={styles.title}>Log in</Text>
            <Text style={styles.subtitle}>
              Sign in with your phone number or email and password
            </Text>
          </View>

          <View style={styles.form}>
            <Input
              label="Phone number or email"
              value={phoneOrEmail}
              onChangeText={setPhoneOrEmail}
              placeholder="e.g. 9876543210 or you@example.com"
              error={errors.phoneOrEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              editable={!signingIn}
            />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              error={errors.password}
              secureTextEntry
              editable={!signingIn}
            />

            <Button
              title={
                signingIn
                  ? 'Signing in…'
                  : loginOnCooldown
                    ? `Wait ${cooldownSecs}s (rate limited)`
                    : 'Sign in'
              }
              onPress={handleLogin}
              disabled={signingIn || loginOnCooldown}
              variant="primary"
              style={styles.button}
            />

            {__DEV__ && (
              <View style={styles.connectionBox}>
                <Text style={styles.connectionLabel}>Server (from .env → EXPO_PUBLIC_API_URL)</Text>
                <Text style={styles.connectionUrl} numberOfLines={2}>
                  {getApiBaseUrl() || '(missing — set .env)'}
                </Text>
                {(() => {
                  const { fromEnv, fromExtra } = getApiBaseUrlDebug();
                  if (fromEnv && fromExtra && fromEnv !== fromExtra) {
                    return (
                      <Text style={styles.connectionHintWarn} numberOfLines={3}>
                        Native app has a different URL ({fromExtra}). Requests use .env above. Rebuild with
                        expo run:ios / run:android if login still hits the old IP.
                      </Text>
                    );
                  }
                  if (!fromEnv && fromExtra) {
                    return (
                      <Text style={styles.connectionHintWarn} numberOfLines={4}>
                        .env URL not in this bundle — using embedded native URL. After changing .env: stop
                        Metro, run npx expo start --clear, or rebuild the dev client.
                      </Text>
                    );
                  }
                  if (fromEnv) {
                    return (
                      <Text style={styles.connectionHint} numberOfLines={2}>
                        If this IP is wrong after editing .env: npx expo start --clear
                      </Text>
                    );
                  }
                  return null;
                })()}
                <TouchableOpacity
                  style={styles.testButton}
                  onPress={handleTestConnection}
                  disabled={testingConnection || signingIn}
                >
                  <Text style={styles.testButtonText}>
                    {testingConnection ? 'Testing…' : 'Test connection'}
                  </Text>
                </TouchableOpacity>
                {connectionTest && (
                  <Text style={[styles.connectionResult, connectionTest.ok ? styles.connectionOk : styles.connectionFail]}>
                    {connectionTest.ok ? '✓ ' : '✗ '}{connectionTest.message}
                  </Text>
                )}
              </View>
            )}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('Register')}
              disabled={signingIn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.signUpLink}>Sign up</Text>
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
    paddingTop: 24,
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
    marginBottom: 24,
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
  signUpLink: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
  },
  loaderOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loaderBox: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingVertical: 24,
    paddingHorizontal: 32,
    alignItems: 'center',
    minWidth: 160,
  },
  loaderText: {
    marginTop: 12,
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  connectionBox: {
    marginTop: 24,
    padding: 12,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.textSecondary + '40',
    borderRadius: 8,
  },
  connectionLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  connectionUrl: {
    fontSize: 13,
    color: COLORS.text,
    marginBottom: 8,
  },
  connectionHint: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginBottom: 8,
    lineHeight: 15,
  },
  connectionHintWarn: {
    fontSize: 11,
    color: '#b45309',
    marginBottom: 8,
    lineHeight: 15,
  },
  testButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: COLORS.primary + '30',
    borderRadius: 6,
  },
  testButtonText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
  },
  connectionResult: {
    marginTop: 8,
    fontSize: 12,
  },
  connectionOk: {
    color: '#2e7d32',
  },
  connectionFail: {
    color: '#c62828',
  },
});
