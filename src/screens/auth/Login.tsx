import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Alert } from '../../utils/themedAlert';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { RootStackScreenProps } from '../../navigation/types';
import { getApiBaseUrl, hasAuthAccessToken, testServerConnection } from '../../services/api';
import { getApiBaseUrlDebug } from '../../config/apiBaseUrl';
import { getFirebaseAuth, isFirebaseAuthConfigured } from '../../config/firebase';
import { validation } from '../../constants/validation';
import {
  firebaseAuthErrorToMessage,
  signInWithEmailPassword,
} from '../../services/firebaseAuthBridge';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import { COLORS } from '../../constants/colors';
import { requestForegroundLocationAfterAuth } from '../../services/location-permission-auth';
import { useAuth } from '../../contexts/AuthContext';
import { resetNavigationToCompleteProfile } from '../../navigation/navigateToCompleteProfile';
import { rootNavigationRef } from '../../navigation/rootNavigationRef';
import { resetMainTabsToSearchFromRoot } from '../../navigation/navigateAfterBook';

type Props = RootStackScreenProps<'Login'>;

export default function Login(): React.JSX.Element {
  const navigation = useNavigation<Props['navigation']>();
  const postSignInNavTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    isAwaitingBackendSession,
    needsEmailVerification,
    isAuthenticated,
    needsProfileCompletion,
    needsAccountReactivation,
  } = useAuth();
  const authGateRef = useRef({
    isAwaitingBackendSession,
    needsEmailVerification,
    isAuthenticated,
    needsProfileCompletion,
    needsAccountReactivation,
  });
  useEffect(() => {
    authGateRef.current = {
      isAwaitingBackendSession,
      needsEmailVerification,
      isAuthenticated,
      needsProfileCompletion,
      needsAccountReactivation,
    };
  }, [
    isAwaitingBackendSession,
    needsEmailVerification,
    isAuthenticated,
    needsProfileCompletion,
    needsAccountReactivation,
  ]);

  useEffect(
    () => () => {
      if (postSignInNavTimeoutRef.current) {
        clearTimeout(postSignInNavTimeoutRef.current);
        postSignInNavTimeoutRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    if (isAwaitingBackendSession || needsEmailVerification || needsAccountReactivation) return;
    if (!isAuthenticated) return;
    if (needsProfileCompletion) {
      resetNavigationToCompleteProfile();
      return;
    }
    resetMainTabsToSearchFromRoot();
  }, [
    isAuthenticated,
    isAwaitingBackendSession,
    needsEmailVerification,
    needsAccountReactivation,
    needsProfileCompletion,
    navigation,
  ]);

  const schedulePostSignInNavigation = () => {
    if (postSignInNavTimeoutRef.current) clearTimeout(postSignInNavTimeoutRef.current);
    postSignInNavTimeoutRef.current = setTimeout(() => {
      postSignInNavTimeoutRef.current = null;
      void requestForegroundLocationAfterAuth();
      const snap = authGateRef.current;
      if (snap.needsProfileCompletion) {
        resetNavigationToCompleteProfile();
      } else if (rootNavigationRef.isReady()) {
        resetMainTabsToSearchFromRoot();
      }
      setSigningIn(false);
      setOverlaySuccess(false);
    }, 450);
  };

  const [phoneOrEmail, setPhoneOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ phoneOrEmail?: string; password?: string }>({});
  const [signingIn, setSigningIn] = useState(false);
  const [overlaySuccess, setOverlaySuccess] = useState(false);
  const [connectionTest, setConnectionTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
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

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!phoneOrEmail.trim()) next.phoneOrEmail = 'Enter your email';
    else if (!isEmail) next.phoneOrEmail = 'Enter a valid email address';
    if (!password.trim()) next.password = 'Enter your password';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleLogin = async () => {
    if (!validate() || signingIn) return;
    if (!isFirebaseAuthConfigured()) {
      Alert.alert(
        'Firebase not configured',
        'Add EXPO_PUBLIC_FIREBASE_* keys to .env (see .env.example), then run npx expo start --clear.'
      );
      return;
    }
    setSigningIn(true);
    setErrors({});
    try {
      await signInWithEmailPassword(phoneOrEmail.trim().toLowerCase(), password);
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 80));
        const firebaseUser = getFirebaseAuth()?.currentUser;
        const { needsEmailVerification: nev, isAuthenticated: authed } = authGateRef.current;
        if (firebaseUser && hasAuthAccessToken() && !nev) {
          setOverlaySuccess(true);
          schedulePostSignInNavigation();
          return;
        }
        if (nev) {
          setSigningIn(false);
          return;
        }
        if (authGateRef.current.needsAccountReactivation) {
          setSigningIn(false);
          return;
        }
        if (authed && !nev) {
          setOverlaySuccess(true);
          schedulePostSignInNavigation();
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 150));
      const { needsEmailVerification: nevFinal, isAuthenticated: authedFinal } = authGateRef.current;
      const firebaseUserFinal = getFirebaseAuth()?.currentUser;
      if (firebaseUserFinal && hasAuthAccessToken() && !nevFinal) {
        setOverlaySuccess(true);
        schedulePostSignInNavigation();
        return;
      }
      if (nevFinal) {
        setSigningIn(false);
        return;
      }
      if (authGateRef.current.needsAccountReactivation) {
        setSigningIn(false);
        return;
      }
      if (authedFinal) {
        setOverlaySuccess(true);
        schedulePostSignInNavigation();
        return;
      }
      setSigningIn(false);
      const failMsg = 'Could not complete sign-in. Check your connection and try again.';
      setErrors({ password: failMsg });
      Alert.alert('Sign in failed', failMsg);
    } catch (e: unknown) {
      const message = firebaseAuthErrorToMessage(e);
      setErrors({ password: message });
      Alert.alert('Sign in failed', message);
      setSigningIn(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Modal visible={signingIn || overlaySuccess} transparent animationType="fade">
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 16 : 20}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.logoBox}>
              <Text style={styles.logoText}>D</Text>
            </View>
            <Text style={styles.title}>Log in</Text>
            <Text style={styles.subtitle}>Sign in with your email and password</Text>
          </View>

          <View style={styles.form}>
            <Input
              label="Email"
              value={phoneOrEmail}
              onChangeText={setPhoneOrEmail}
              placeholder="you@example.com"
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
              secureTextEntry={true}
              editable={!signingIn}
            />

            <TouchableOpacity
              onPress={() => navigation.navigate('ForgotPassword')}
              disabled={signingIn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.forgotWrap}
            >
              <Text style={styles.forgotLink}>Forgot password?</Text>
            </TouchableOpacity>

            <Button
              title={signingIn ? 'Signing in…' : 'Sign in'}
              onPress={handleLogin}
              disabled={signingIn}
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
  forgotWrap: {
    alignSelf: 'flex-end',
    marginTop: 4,
    marginBottom: 4,
  },
  forgotLink: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
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
