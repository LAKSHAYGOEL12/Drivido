import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  Pressable,
  Platform,
  ScrollView,
  Animated,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Keyboard,
  InteractionManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { isFirebaseAuthConfigured } from '../../config/firebase';
import { validation } from '../../constants/validation';
import Button from '../common/Button';
import Input from '../common/Input';
import { COLORS } from '../../constants/colors';
import type { RootStackParamList } from '../../navigation/types';
import { hasAuthAccessToken } from '../../services/api';
import { getFirebaseAuth } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { resetNavigationToCompleteProfile } from '../../navigation/navigateToCompleteProfile';
import { requestForegroundLocationAfterAuth } from '../../services/location-permission-auth';
import {
  firebaseAuthErrorToMessage,
  signInWithEmailPassword,
} from '../../services/firebaseAuthBridge';

export type LoginBottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Fired after Firebase sign-in + backend JWT exchange (see AuthContext). Parent should read latest `user.id` from a ref. */
  onLoggedIn?: () => void;
  navigation: NavigationProp<ParamListBase>;
};

export default function LoginBottomSheet({
  visible,
  onClose,
  onLoggedIn,
  navigation,
}: LoginBottomSheetProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { isAwaitingBackendSession, needsEmailVerification, isAuthenticated, needsProfileCompletion } = useAuth();
  const authGateRef = useRef({
    isAwaitingBackendSession,
    needsEmailVerification,
    isAuthenticated,
    needsProfileCompletion,
  });
  useEffect(() => {
    authGateRef.current = {
      isAwaitingBackendSession,
      needsEmailVerification,
      isAuthenticated,
      needsProfileCompletion,
    };
  }, [isAwaitingBackendSession, needsEmailVerification, isAuthenticated, needsProfileCompletion]);

  const [phoneOrEmail, setPhoneOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ phoneOrEmail?: string; password?: string }>({});
  const [signingIn, setSigningIn] = useState(false);
  const [overlaySuccess, setOverlaySuccess] = useState(false);
  const slideY = useRef(new Animated.Value(520)).current;
  /** Modal stays mounted until slide-out finishes — avoids flicker when keyboard + close race. */
  const [modalShown, setModalShown] = useState(visible);
  const exitAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const [keyboardPad, setKeyboardPad] = useState(0);

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
      exitAnimRef.current?.stop();
      setModalShown(true);
      slideY.setValue(520);
      Animated.spring(slideY, {
        toValue: 0,
        useNativeDriver: true,
        friction: 9,
        tension: 68,
      }).start();
    }
  }, [visible, slideY]);

  useEffect(() => {
    if (!visible && modalShown) {
      Keyboard.dismiss();
      exitAnimRef.current?.stop();
      exitAnimRef.current = Animated.timing(slideY, {
        toValue: 520,
        duration: Platform.OS === 'ios' ? 220 : 260,
        useNativeDriver: true,
      });
      exitAnimRef.current.start(({ finished }) => {
        exitAnimRef.current = null;
        if (finished) setModalShown(false);
      });
    }
  }, [visible, modalShown, slideY]);

  const requestClose = useCallback(() => {
    if (signingIn) return;
    Keyboard.dismiss();
    InteractionManager.runAfterInteractions(() => {
      onClose();
    });
  }, [onClose, signingIn]);

  const finishGuestSuccess = useCallback(
    (opts?: { profileIncomplete?: boolean }) => {
      const profileIncomplete = opts?.profileIncomplete ?? false;
      setSigningIn(true);
      setOverlaySuccess(true);
      const SUCCESS_MS = 420;
      setTimeout(() => {
        void requestForegroundLocationAfterAuth();
        if (profileIncomplete) {
          resetNavigationToCompleteProfile();
        }
        setSigningIn(false);
        setOverlaySuccess(false);
        setPhoneOrEmail('');
        setPassword('');
        setErrors({});
        onClose();
        InteractionManager.runAfterInteractions(() => {
          requestAnimationFrame(() => {
            if (!profileIncomplete) onLoggedIn?.();
          });
        });
      }, SUCCESS_MS);
    },
    [onClose, onLoggedIn]
  );

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
      /**
       * Wait for POST /auth/firebase + JWT (onAuthStateChanged). Do **not** break early when
       * `!isAwaitingBackendSession` — that flag can still be false for the first ticks before the
       * listener runs, which caused false "Sign in failed" while the user was actually signing in.
       */
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 80));
        const firebaseUser = getFirebaseAuth()?.currentUser;
        const { needsEmailVerification: nev, isAuthenticated: authed, needsProfileCompletion: npc } =
          authGateRef.current;
        if (firebaseUser && hasAuthAccessToken() && !nev) {
          finishGuestSuccess({ profileIncomplete: npc });
          return;
        }
        if (nev) {
          setSigningIn(false);
          onClose();
          return;
        }
        if (authed && !nev) {
          finishGuestSuccess({ profileIncomplete: npc });
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 150));
      const firebaseUserFinal = getFirebaseAuth()?.currentUser;
      const {
        needsEmailVerification: nevFinal,
        isAuthenticated: authedFinal,
        needsProfileCompletion: npcFinal,
      } = authGateRef.current;
      if (firebaseUserFinal && hasAuthAccessToken() && !nevFinal) {
        finishGuestSuccess({ profileIncomplete: npcFinal });
        return;
      }
      if (nevFinal) {
        setSigningIn(false);
        onClose();
        return;
      }
      if (authedFinal) {
        finishGuestSuccess({ profileIncomplete: npcFinal });
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

  const openRegister = () => {
    if (signingIn) return;
    Keyboard.dismiss();
    InteractionManager.runAfterInteractions(() => {
      onClose();
      (navigation as NavigationProp<RootStackParamList>).navigate('Register');
    });
  };

  const openForgotPassword = () => {
    if (signingIn) return;
    Keyboard.dismiss();
    InteractionManager.runAfterInteractions(() => {
      onClose();
      (navigation as NavigationProp<RootStackParamList>).navigate('ForgotPassword');
    });
  };

  return (
    <Modal
      visible={visible || modalShown}
      transparent
      animationType="fade"
      onRequestClose={signingIn ? () => {} : requestClose}
      statusBarTranslucent
    >
      <View style={styles.modalRoot}>
        {signingIn || overlaySuccess ? (
          <View style={styles.loaderOverlay} pointerEvents="auto">
            <View style={styles.loaderBox}>
              {overlaySuccess ? (
                <>
                  <Ionicons name="checkmark-circle" size={48} color={COLORS.primary} />
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
        ) : null}
        <View style={styles.keyboardWrap}>
          <Pressable style={styles.backdrop} onPress={signingIn ? undefined : requestClose} />
          <Animated.View
            style={[
              styles.sheet,
              {
                paddingBottom: Math.max(insets.bottom, 16) + keyboardPad,
                transform: [{ translateY: slideY }],
              },
            ]}
          >
          <View style={styles.handleBarWrap}>
            <View style={styles.handleBar} />
          </View>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Sign in to book</Text>
            <TouchableOpacity
              onPress={requestClose}
              disabled={signingIn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={24} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.sheetSubtitle}>Email and password</Text>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
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
              secureTextEntry
              editable={!signingIn}
            />
            <TouchableOpacity
              onPress={openForgotPassword}
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
              style={styles.signInBtn}
            />
            <View style={styles.footerRow}>
              <Text style={styles.footerMuted}>New here? </Text>
              <TouchableOpacity onPress={openRegister} disabled={signingIn}>
                <Text style={styles.footerLink}>Create account</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
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
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '88%',
    paddingHorizontal: 20,
    paddingTop: 4,
    shadowColor: '#000',
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
    backgroundColor: '#cbd5e1',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    flex: 1,
  },
  closeBtn: {
    marginLeft: 8,
  },
  sheetSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  forgotWrap: {
    alignSelf: 'flex-end',
    marginTop: 2,
    marginBottom: 2,
  },
  forgotLink: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  signInBtn: {
    marginTop: 6,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    flexWrap: 'wrap',
  },
  footerMuted: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  footerLink: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  loaderBox: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingVertical: 22,
    paddingHorizontal: 28,
    alignItems: 'center',
    minWidth: 150,
  },
  loaderText: {
    marginTop: 10,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
});
