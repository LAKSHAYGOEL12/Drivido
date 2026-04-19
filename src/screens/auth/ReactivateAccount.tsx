import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Alert } from '../../utils/themedAlert';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { RootStackScreenProps } from '../../navigation/types';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../../components/common/Button';
import { COLORS } from '../../constants/colors';
import AppLogo from '../../components/common/AppLogo';
import { rootNavigationRef } from '../../navigation/rootNavigationRef';
import { resetNavigationToCompleteProfile } from '../../navigation/navigateToCompleteProfile';
import { getFirebaseAuth } from '../../config/firebase';

type Props = RootStackScreenProps<'ReactivateAccount'>;

function currentUserHasPasswordProvider(): boolean {
  const u = getFirebaseAuth()?.currentUser;
  return Boolean(u?.providerData?.some((p) => p.providerId === 'password'));
}

export default function ReactivateAccount(): React.JSX.Element {
  const navigation = useNavigation<Props['navigation']>();
  const { logout, reactivateAccountAndResumeSession } = useAuth();
  const fbUser = getFirebaseAuth()?.currentUser;
  const displayEmail = fbUser?.email?.trim() || fbUser?.phoneNumber?.trim() || 'your account';

  const canUsePassword = currentUserHasPasswordProvider();
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleReactivate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await reactivateAccountAndResumeSession({
        ...(canUsePassword && password.trim() ? { password: password.trim() } : {}),
      });
      if (res.ok) {
        Keyboard.dismiss();
        if (res.needsProfileCompletion) {
          resetNavigationToCompleteProfile();
        } else if (rootNavigationRef.isReady()) {
          rootNavigationRef.reset({ index: 0, routes: [{ name: 'Main' }] });
        } else {
          navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
        }
        return;
      }
      Alert.alert('Could not reactivate', res.message ?? 'Try again or contact support.');
    } finally {
      setBusy(false);
    }
  }, [busy, canUsePassword, password, reactivateAccountAndResumeSession, navigation]);

  const handleSignOut = useCallback(async () => {
    await logout();
    if (rootNavigationRef.isReady()) {
      rootNavigationRef.reset({ index: 0, routes: [{ name: 'Main' }] });
    } else {
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    }
  }, [logout, navigation]);

  const canSubmitPassword = canUsePassword && password.trim().length > 0;
  const canSubmitOAuth = !canUsePassword && Boolean(fbUser);

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
            <AppLogo />
            <Text style={styles.title}>Account deactivated</Text>
            <Text style={styles.subtitle}>
              You’re signed in as <Text style={styles.emphasis}>{displayEmail}</Text>. Reactivate to use EcoPickO
              again — your trip counts, ratings, and profile come back as normal.
            </Text>
            <Text style={styles.note}>
              Rides you had published and bookings from when you were deactivated stay cancelled; we don’t
              restore those trips.
            </Text>
          </View>

          {canUsePassword ? (
            <View style={styles.fieldBlock}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Current password"
                  placeholderTextColor={COLORS.textMuted}
                  secureTextEntry={!showPwd}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!busy}
                />
                <Pressable onPress={() => setShowPwd((s) => !s)} style={styles.eyeBtn} hitSlop={8}>
                  <Ionicons
                    name={showPwd ? 'eye-off-outline' : 'eye-outline'}
                    size={22}
                    color={COLORS.textSecondary}
                  />
                </Pressable>
              </View>
            </View>
          ) : (
            <Text style={styles.oauthHint}>
              We’ll confirm it’s you with your current sign-in (same as scheduling ride actions for social /
              phone accounts).
            </Text>
          )}

          <View style={styles.form}>
            <Button
              title={busy ? 'Reactivating…' : 'Reactivate account'}
              onPress={() => void handleReactivate()}
              disabled={busy || (!canSubmitPassword && !canSubmitOAuth)}
              variant="primary"
              style={styles.button}
            />
            {busy ? (
              <View style={styles.inlineLoader}>
                <ActivityIndicator color={COLORS.primary} />
              </View>
            ) : null}
            <Button
              title="Sign out"
              onPress={() => void handleSignOut()}
              disabled={busy}
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
  container: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
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
  emphasis: { fontWeight: '700', color: COLORS.text },
  note: {
    marginTop: 14,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  oauthHint: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  fieldBlock: { marginBottom: 8 },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundSecondary,
    minHeight: 48,
    paddingLeft: 12,
    paddingRight: 4,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    color: COLORS.text,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
  },
  eyeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  form: { gap: 12, marginTop: 8 },
  button: { marginTop: 8 },
  buttonMuted: { marginTop: 0 },
  inlineLoader: { alignItems: 'center', paddingVertical: 4 },
});
