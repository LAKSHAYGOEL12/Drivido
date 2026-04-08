import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { Alert } from '../../utils/themedAlert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { RootStackScreenProps } from '../../navigation/types';
import { isFirebaseAuthConfigured } from '../../config/firebase';
import { validation } from '../../constants/validation';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import { COLORS } from '../../constants/colors';
import {
  firebaseAuthErrorToMessage,
  sendPasswordResetEmailToAddress,
} from '../../services/firebaseAuthBridge';

type Props = RootStackScreenProps<'ForgotPassword'>;

export default function ForgotPassword(): React.JSX.Element {
  const navigation = useNavigation<Props['navigation']>();
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<{ email?: string }>({});
  const [sending, setSending] = useState(false);

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!email.trim()) next.email = 'Enter your email';
    else if (!validation.email(email)) next.email = 'Enter a valid email address';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSend = async () => {
    if (!validate() || sending) return;
    if (!isFirebaseAuthConfigured()) {
      Alert.alert(
        'Firebase not configured',
        'Add EXPO_PUBLIC_FIREBASE_* keys to .env (see .env.example), then run npx expo start --clear.'
      );
      return;
    }
    setSending(true);
    setErrors({});
    try {
      await sendPasswordResetEmailToAddress(email);
      Alert.alert(
        'Check your email',
        'If an account exists for that address, we sent a link to reset your password. Open it in your browser, then sign in with your new password.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (e: unknown) {
      Alert.alert('Request failed', firebaseAuthErrorToMessage(e));
    } finally {
      setSending(false);
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
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.backRow}
          >
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <View style={styles.header}>
            <View style={styles.logoBox}>
              <Text style={styles.logoText}>D</Text>
            </View>
            <Text style={styles.title}>Forgot password</Text>
            <Text style={styles.subtitle}>
              Enter your email and we will send a reset link (via Firebase). Use the same email you signed up
              with.
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
              editable={!sending}
            />
            <Button
              title={sending ? 'Sending…' : 'Send reset link'}
              onPress={() => void handleSend()}
              disabled={sending}
              variant="primary"
              style={styles.button}
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
    paddingTop: 8,
    paddingBottom: 32,
  },
  backRow: {
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
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
  logoText: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  form: {
    marginTop: 8,
  },
  button: {
    marginTop: 20,
  },
});
