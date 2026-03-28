import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
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
import { requestForegroundLocationAfterAuth } from '../../services/location-permission-auth';
import { rootNavigationRef } from '../../navigation/rootNavigationRef';

type Props = RootStackScreenProps<'VerifyEmail'>;

export default function VerifyEmail(): React.JSX.Element {
  const navigation = useNavigation<Props['navigation']>();
  const route = useRoute<Props['route']>();
  const paramEmail = route.params?.email;
  const { pendingVerificationEmail, retrySessionAfterEmailVerified, logout } = useAuth();
  const displayEmail = paramEmail ?? pendingVerificationEmail ?? 'your email';

  const [resending, setResending] = useState(false);
  const [continuing, setContinuing] = useState(false);

  const goMainAfterSuccess = () => {
    void requestForegroundLocationAfterAuth();
    if (rootNavigationRef.isReady()) {
      rootNavigationRef.reset({
        index: 0,
        routes: [{ name: 'Main' }],
      });
    } else {
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await resendEmailVerificationForCurrentUser();
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
        goMainAfterSuccess();
        return;
      }
      Alert.alert('Not verified yet', result.message ?? 'Try again after opening the email link.');
    } finally {
      setContinuing(false);
    }
  };

  const handleSignOut = () => {
    void logout();
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
              title={resending ? 'Sending…' : 'Resend verification email'}
              onPress={() => void handleResend()}
              disabled={resending || continuing}
              variant="secondary"
              style={styles.buttonMuted}
            />
            <Button
              title="Sign out"
              onPress={handleSignOut}
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
