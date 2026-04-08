import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Alert } from '../../utils/themedAlert';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RootStackScreenProps } from '../../navigation/types';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../../components/common/Button';
import { COLORS } from '../../constants/colors';
import {
  firebaseAuthErrorToMessage,
  resendEmailVerificationForCurrentUser,
} from '../../services/firebaseAuthBridge';
import { rootNavigationRef } from '../../navigation/rootNavigationRef';
import { resetNavigationToCompleteProfile } from '../../navigation/navigateToCompleteProfile';

type Props = RootStackScreenProps<'VerifyEmail'>;

export default function VerifyEmail(): React.JSX.Element {
  const navigation = useNavigation<Props['navigation']>();
  const route = useRoute<Props['route']>();
  const paramEmail = route.params?.email;
  const { pendingVerificationEmail, retrySessionAfterEmailVerified, logout } = useAuth();
  const displayEmail = paramEmail ?? pendingVerificationEmail ?? 'your email';

  const [resending, setResending] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [resendAttempts, setResendAttempts] = useState(0);
  const [windowStartMs, setWindowStartMs] = useState<number>(() => Date.now());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const RESEND_MAX_ATTEMPTS = 3;
  const RESEND_WINDOW_MS = 10 * 60 * 1000;
  const RESEND_COOLDOWN_MS = 45 * 1000;

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (nowMs - windowStartMs >= RESEND_WINDOW_MS) {
      setWindowStartMs(nowMs);
      setResendAttempts(0);
    }
  }, [nowMs, windowStartMs]);

  const windowLeftMs = Math.max(0, RESEND_WINDOW_MS - (nowMs - windowStartMs));
  const cooldownLeftMs = Math.max(0, RESEND_COOLDOWN_MS - (nowMs - windowStartMs));
  const blockedByMaxAttempts = resendAttempts >= RESEND_MAX_ATTEMPTS;
  const blockedByCooldown = resendAttempts > 0 && cooldownLeftMs > 0;
  const resendBlocked = blockedByMaxAttempts || blockedByCooldown;

  const resendButtonTitle = useMemo(() => {
    if (resending) return 'Sending…';
    if (blockedByMaxAttempts) {
      const mins = Math.ceil(windowLeftMs / 60000);
      return `Try again in ${mins} min`;
    }
    if (blockedByCooldown) {
      const secs = Math.ceil(cooldownLeftMs / 1000);
      return `Resend in ${secs}s`;
    }
    return 'Resend verification email';
  }, [resending, blockedByMaxAttempts, blockedByCooldown, windowLeftMs, cooldownLeftMs]);

  const goToCompleteProfileAfterSuccess = () => {
    resetNavigationToCompleteProfile();
  };

  const handleResend = async () => {
    if (blockedByMaxAttempts) {
      const mins = Math.ceil(windowLeftMs / 60000);
      Alert.alert('Too many attempts', `You can resend up to 3 times. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
      return;
    }
    if (blockedByCooldown) {
      const secs = Math.ceil(cooldownLeftMs / 1000);
      Alert.alert('Please wait', `Try again in ${secs} second${secs === 1 ? '' : 's'}.`);
      return;
    }
    setResending(true);
    try {
      await resendEmailVerificationForCurrentUser();
      setResendAttempts((n) => n + 1);
      Alert.alert('Email sent', 'Check your inbox for the verification link.');
    } catch (e: unknown) {
      Alert.alert('Could not resend', firebaseAuthErrorToMessage(e));
    } finally {
      setResending(false);
    }
  };

  const handleContinue = async () => {
    setContinuing(true);
    try {
      const result = await retrySessionAfterEmailVerified();
      if (result.ok) {
        goToCompleteProfileAfterSuccess();
        return;
      }
      Alert.alert('Not verified yet', result.message ?? 'Try again after opening the email link.');
    } finally {
      setContinuing(false);
    }
  };

  const handleSignOut = async () => {
    /** Wait for Firebase sign-out + auth state before resetting nav, or `onAuthStateChanged` can
     * briefly still see a user, re-run exchange, set `needsEmailVerification` again, and reopen Verify Email. */
    await logout();
    if (rootNavigationRef.isReady()) {
      rootNavigationRef.reset({ index: 0, routes: [{ name: 'Main' }] });
    } else {
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
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
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.logoBox}>
              <Ionicons name="mail-outline" size={30} color={COLORS.text} />
            </View>
            <Text style={styles.title}>Verify your email</Text>
            <Text style={styles.subtitle}>
              We sent a verification link to{' '}
              <Text style={styles.emailEmphasis}>{displayEmail}</Text>. Open it, then tap Continue below.
              (Firebase uses a secure link in the email rather than typing a code in the app.)
            </Text>
          </View>

          <View style={styles.form}>
            <Button
              title={continuing ? 'Checking…' : "I've verified — Continue"}
              onPress={() => void handleContinue()}
              disabled={continuing || resending}
              variant="primary"
              style={styles.button}
            />
            <Button
              title={resendButtonTitle}
              onPress={() => void handleResend()}
              disabled={resending || continuing || resendBlocked}
              variant="secondary"
              style={styles.buttonMuted}
            />
            <Button
              title="Sign out"
              onPress={() => void handleSignOut()}
              disabled={continuing || resending}
              variant="secondary"
              style={styles.buttonMuted}
            />
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
    marginBottom: 28,
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
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  emailEmphasis: {
    fontWeight: '700',
    color: COLORS.text,
  },
  form: {
    gap: 12,
  },
  button: {
    marginTop: 8,
  },
  buttonMuted: {
    marginTop: 0,
  },
});
