import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Alert } from '../../utils/themedAlert';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { COLORS } from '../../constants/colors';
import type { ProfileStackParamList } from '../../navigation/types';
import { validation, validationErrors } from '../../constants/validation';
import { getFirebaseAuth } from '../../config/firebase';
import { requestAccountDeactivate } from '../../services/accountDeactivate';
import { cancelAccountDeletion, requestAccountDeletion } from '../../services/accountDeletion';
import { changePasswordForCurrentUser, firebaseAuthErrorToMessage } from '../../services/firebaseAuthBridge';
import { getFreshFirebaseIdToken } from '../../services/firebaseIdToken';

const SUPPORT_MAILTO =
  'mailto:developers@drivido.in?subject=' + encodeURIComponent('EcoPickO — Account & security');

/** Green tint behind icons — matches Edit Profile vehicle chips. */
const PRIMARY_TINT = 'rgba(41, 190, 139, 0.12)';

const SCROLL_BOTTOM_PADDING = 40;
const SCROLL_EVENT_THROTTLE_MS = 16;

function currentUserHasPasswordProvider(): boolean {
  const u = getFirebaseAuth()?.currentUser;
  return Boolean(u?.providerData?.some((p) => p.providerId === 'password'));
}

function sessionIdPreview(userId: string | undefined, fbUid: string | undefined): string {
  const a = (userId ?? '').trim();
  const b = (fbUid ?? '').trim();
  const raw = a || b;
  if (!raw) return '—';
  if (raw.length <= 12) return raw;
  return `${raw.slice(0, 6)}…${raw.slice(-4)}`;
}

/**
 * Scroll just enough so the focused field sits above the keyboard. Uses window coordinates so it
 * stays correct with a custom header (ScrollView’s built-in math assumes full-screen scroll).
 */
function scheduleScrollFieldAboveKeyboard(args: {
  scrollRef: React.RefObject<ScrollView | null>;
  anchorRef: React.RefObject<View | null>;
  scrollYRef: React.MutableRefObject<number>;
  keyboardHeight: number;
  extraGap?: number;
}): void {
  const { scrollRef, anchorRef, scrollYRef, keyboardHeight, extraGap = 14 } = args;
  if (keyboardHeight <= 0) return;
  const delay = Platform.OS === 'ios' ? 120 : 80;
  setTimeout(() => {
    const anchor = anchorRef.current;
    const scroller = scrollRef.current;
    if (!anchor || !scroller) return;
    anchor.measureInWindow((_, y, __, h) => {
      const winH = Dimensions.get('window').height;
      const fieldBottom = y + h;
      /**
       * iOS: full window height; subtract keyboard.
       * Android (Expo `softwareKeyboardLayoutMode: 'resize'`): `winH` is already the visible area above the keyboard.
       */
      const safeBottom =
        Platform.OS === 'android' ? winH - extraGap : winH - keyboardHeight - extraGap;
      if (fieldBottom <= safeBottom) return;
      const overflow = fieldBottom - safeBottom;
      scroller.scrollTo({
        y: Math.max(0, scrollYRef.current + overflow),
        animated: true,
      });
    });
  }, delay);
}

export default function AccountSecurityScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const { user, refreshUser, logout } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const keyboardHeightRef = useRef(0);
  const anchorCurrentRef = useRef<View | null>(null);
  const anchorNewRef = useRef<View | null>(null);
  const anchorConfirmRef = useRef<View | null>(null);
  const anchorDeleteRef = useRef<View | null>(null);
  const anchorDeactivateRef = useRef<View | null>(null);

  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);

  const [passwordOpen, setPasswordOpen] = useState(true);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const [deactivateAck, setDeactivateAck] = useState(false);
  const [deactivatePassword, setDeactivatePassword] = useState('');
  const [showDeactivatePwd, setShowDeactivatePwd] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [showDeletePwd, setShowDeletePwd] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cancellingDeletion, setCancellingDeletion] = useState(false);

  const canUsePassword = currentUserHasPasswordProvider();
  const fbUid = getFirebaseAuth()?.currentUser?.uid;

  useEffect(() => {
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subShow = Keyboard.addListener(show, (e) => {
      const h = e.endCoordinates?.height ?? 0;
      keyboardHeightRef.current = h;
      setKeyboardBottomInset(h);
    });
    const subHide = Keyboard.addListener(hide, () => {
      keyboardHeightRef.current = 0;
      setKeyboardBottomInset(0);
    });
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  const newPasswordInvalid = newPassword.length > 0 && !validation.password(newPassword);

  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;
  const canSavePassword =
    canUsePassword &&
    currentPassword.length > 0 &&
    validation.password(newPassword) &&
    passwordsMatch &&
    !savingPassword;

  const canScheduleWithPassword =
    canUsePassword && deletePassword.length > 0 && !deleting && !user?.accountDeletionPending;

  const canScheduleWithIdToken =
    !canUsePassword && Boolean(fbUid) && !deleting && !user?.accountDeletionPending;

  const canDeactivateWithPassword =
    canUsePassword &&
    deactivatePassword.trim().length > 0 &&
    deactivateAck &&
    !deactivating &&
    !user?.accountDeletionPending;

  const canDeactivateWithIdToken =
    !canUsePassword && Boolean(fbUid) && deactivateAck && !deactivating && !user?.accountDeletionPending;

  const deletionEffectiveLabel = useMemo(() => {
    const raw = user?.accountDeletionEffectiveAt?.trim();
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }, [user?.accountDeletionEffectiveAt]);

  const handleSavePassword = useCallback(async () => {
    if (!canSavePassword) return;
    setSavingPassword(true);
    try {
      await changePasswordForCurrentUser({
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      Keyboard.dismiss();
      Alert.alert('Password updated', 'Your password has been changed.');
    } catch (e) {
      Alert.alert('Could not update password', firebaseAuthErrorToMessage(e));
    } finally {
      setSavingPassword(false);
    }
  }, [canSavePassword, currentPassword, newPassword]);

  const apiErrorMessage = useCallback((e: unknown): string => {
    if (e instanceof Error && e.message) return e.message;
    return 'Something went wrong. Try again.';
  }, []);

  const runScheduleAccountDeletion = useCallback(async () => {
    if (user?.accountDeletionPending) return;
    if (canUsePassword) {
      if (!deletePassword.trim()) return;
    } else if (!fbUid) {
      return;
    }

    setDeleting(true);
    try {
      const idTok = await getFreshFirebaseIdToken();
      if (canUsePassword) {
        await requestAccountDeletion({
          password: deletePassword,
          ...(idTok ? { idToken: idTok } : {}),
        });
      } else {
        if (!idTok) {
          Alert.alert(
            'Could not verify sign-in',
            'Sign out and sign in again, then try scheduling deletion.'
          );
          return;
        }
        await requestAccountDeletion({ idToken: idTok });
      }
      setDeletePassword('');
      Keyboard.dismiss();
      await refreshUser();
      Alert.alert(
        'Deletion scheduled',
        'Your account is set to be removed after the waiting period. You can cancel anytime before then from Account & Security.'
      );
    } catch (e) {
      const status =
        e && typeof e === 'object' && 'status' in e ? (e as { status?: number }).status : undefined;
      if (status === 404) {
        Alert.alert(
          'Not available yet',
          'Scheduled deletion isn’t enabled on the server yet. Contact developers@drivido.in.'
        );
      } else {
        Alert.alert('Could not schedule deletion', apiErrorMessage(e));
      }
    } finally {
      setDeleting(false);
    }
  }, [user?.accountDeletionPending, canUsePassword, deletePassword, fbUid, refreshUser, apiErrorMessage]);

  const confirmDelete = useCallback(() => {
    Alert.alert(
      'Schedule account deletion?',
      'Your account will be permanently removed after the grace period set by the server. Until then you can sign in and cancel here.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Schedule deletion', style: 'destructive', onPress: () => void runScheduleAccountDeletion() },
      ]
    );
  }, [runScheduleAccountDeletion]);

  const runCancelDeletion = useCallback(async () => {
    setCancellingDeletion(true);
    try {
      await cancelAccountDeletion();
      await refreshUser();
      Alert.alert('Deletion cancelled', 'Your account will stay active.');
    } catch (e) {
      const status =
        e && typeof e === 'object' && 'status' in e ? (e as { status?: number }).status : undefined;
      if (status === 404) {
        Alert.alert(
          'Not available yet',
          'Cancel deletion isn’t enabled on the server yet. Contact developers@drivido.in.'
        );
      } else {
        Alert.alert('Could not cancel', apiErrorMessage(e));
      }
    } finally {
      setCancellingDeletion(false);
    }
  }, [refreshUser, apiErrorMessage]);

  const runDeactivateAccount = useCallback(async () => {
    if (user?.accountDeletionPending) return;
    if (canUsePassword) {
      if (!deactivatePassword.trim()) return;
    } else if (!fbUid) {
      return;
    }

    setDeactivating(true);
    try {
      const idTok = await getFreshFirebaseIdToken();
      if (canUsePassword) {
        await requestAccountDeactivate({
          password: deactivatePassword,
          ...(idTok ? { idToken: idTok } : {}),
        });
      } else {
        if (!idTok) {
          Alert.alert(
            'Could not verify sign-in',
            'Sign out and sign in again, then try deactivating your account.'
          );
          return;
        }
        await requestAccountDeactivate({ idToken: idTok });
      }
      setDeactivatePassword('');
      setDeactivateAck(false);
      Keyboard.dismiss();
      await logout();
      Alert.alert(
        'Account deactivated',
        'You have been signed out. Sign-in will stay blocked until your account is reactivated on the server.'
      );
    } catch (e) {
      const status =
        e && typeof e === 'object' && 'status' in e ? (e as { status?: number }).status : undefined;
      if (status === 404) {
        Alert.alert(
          'Not available yet',
          'Deactivation isn’t enabled on the server yet. Contact developers@drivido.in.'
        );
      } else {
        Alert.alert('Could not deactivate', apiErrorMessage(e));
      }
    } finally {
      setDeactivating(false);
    }
  }, [
    user?.accountDeletionPending,
    canUsePassword,
    deactivatePassword,
    fbUid,
    logout,
    apiErrorMessage,
  ]);

  const confirmDeactivate = useCallback(() => {
    Alert.alert(
      'Deactivate account?',
      'Your profile will be hidden and you will be signed out. You will not be able to use the app with this account until it is reactivated.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Deactivate', style: 'destructive', onPress: () => void runDeactivateAccount() },
      ]
    );
  }, [runDeactivateAccount]);

  const openSupport = useCallback(() => {
    void Linking.openURL(SUPPORT_MAILTO).catch(() => {
      Alert.alert('Contact support', 'Email developers@drivido.in with the subject “Account & security”.');
    });
  }, []);

  const scrollPadBottom = useMemo(() => {
    const base = insets.bottom + SCROLL_BOTTOM_PADDING;
    if (Platform.OS === 'android') {
      return base + keyboardBottomInset;
    }
    return base + (keyboardBottomInset > 0 ? 32 : 0);
  }, [insets.bottom, keyboardBottomInset]);

  const bumpFieldVisible = useCallback((anchorRef: React.RefObject<View | null>) => {
    const run = () => {
      scheduleScrollFieldAboveKeyboard({
        scrollRef,
        anchorRef,
        scrollYRef,
        keyboardHeight: keyboardHeightRef.current,
      });
    };
    run();
    /** Keyboard metrics can lag `onFocus` by a frame — retry so first tap still scrolls. */
    if (keyboardHeightRef.current <= 0) {
      setTimeout(run, 200);
      setTimeout(run, 420);
    }
  }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      <View style={styles.topChrome}>
        <View style={[styles.statusBarFill, { height: insets.top }]} />
        <View style={styles.header}>
          <Pressable
            style={styles.headerBtn}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
          >
            <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Account & Security
            </Text>
          </View>
          <View style={styles.headerBtn} pointerEvents="none">
            <Ionicons name="shield-checkmark" size={22} color={COLORS.primary} />
          </View>
        </View>
      </View>

      <View style={styles.body}>
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollPadBottom }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={SCROLL_EVENT_THROTTLE_MS}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          automaticallyAdjustsScrollIndicatorInsets={Platform.OS === 'ios'}
          nestedScrollEnabled
        >
          <View style={styles.card}>
              <Pressable
                style={styles.cardHeaderRow}
                onPress={() => setPasswordOpen((o) => !o)}
                accessibilityRole="button"
                accessibilityLabel={passwordOpen ? 'Collapse change password' : 'Expand change password'}
              >
                <View style={styles.cardHeaderIcon}>
                  <Ionicons name="lock-closed-outline" size={20} color={COLORS.primary} />
                </View>
                <View style={styles.cardHeaderText}>
                  <Text style={styles.cardTitle}>Change password</Text>
                  <Text style={styles.cardSubtitle}>Update your login credentials</Text>
                </View>
                <Ionicons
                  name={passwordOpen ? 'chevron-up' : 'chevron-down'}
                  size={22}
                  color={COLORS.textMuted}
                />
              </Pressable>

              {passwordOpen ? (
                canUsePassword ? (
                  <View style={styles.cardBody}>
                    <Text style={styles.fieldLabel}>Current password</Text>
                    <View ref={anchorCurrentRef} collapsable={false} style={styles.fieldAnchor}>
                      <View style={styles.inputWrap}>
                        <TextInput
                          style={styles.input}
                          value={currentPassword}
                          onChangeText={setCurrentPassword}
                          placeholder="Enter current password"
                          placeholderTextColor={COLORS.textMuted}
                          secureTextEntry={!showCurrent}
                          autoCapitalize="none"
                          autoCorrect={false}
                          editable={!savingPassword}
                          onFocus={() => bumpFieldVisible(anchorCurrentRef)}
                        />
                        <Pressable
                          onPress={() => setShowCurrent((s) => !s)}
                          style={styles.eyeBtn}
                          accessibilityRole="button"
                          accessibilityLabel={showCurrent ? 'Hide password' : 'Show password'}
                          hitSlop={8}
                        >
                          <Ionicons
                            name={showCurrent ? 'eye-off-outline' : 'eye-outline'}
                            size={22}
                            color={COLORS.textSecondary}
                          />
                        </Pressable>
                      </View>
                    </View>

                    <Text style={styles.fieldLabel}>New password</Text>
                    <View ref={anchorNewRef} collapsable={false} style={styles.fieldAnchor}>
                      <View style={styles.inputWrap}>
                        <TextInput
                          style={styles.input}
                          value={newPassword}
                          onChangeText={setNewPassword}
                          placeholder="Create strong password"
                          placeholderTextColor={COLORS.textMuted}
                          secureTextEntry={!showNew}
                          autoCapitalize="none"
                          autoCorrect={false}
                          editable={!savingPassword}
                          onFocus={() => bumpFieldVisible(anchorNewRef)}
                        />
                        <Pressable
                          onPress={() => setShowNew((s) => !s)}
                          style={styles.eyeBtn}
                          accessibilityRole="button"
                          hitSlop={8}
                        >
                          <Ionicons
                            name={showNew ? 'eye-off-outline' : 'eye-outline'}
                            size={22}
                            color={COLORS.textSecondary}
                          />
                        </Pressable>
                      </View>
                    </View>
                    {newPasswordInvalid ? (
                      <Text style={styles.errorText}>{validationErrors.password}</Text>
                    ) : (
                      <Text style={styles.helperText}>{validationErrors.password}</Text>
                    )}

                    <Text style={styles.fieldLabel}>Confirm new password</Text>
                    <View ref={anchorConfirmRef} collapsable={false} style={styles.fieldAnchor}>
                      <View style={styles.inputWrap}>
                        <TextInput
                          style={styles.input}
                          value={confirmPassword}
                          onChangeText={setConfirmPassword}
                          placeholder="Repeat new password"
                          placeholderTextColor={COLORS.textMuted}
                          secureTextEntry={!showConfirm}
                          autoCapitalize="none"
                          autoCorrect={false}
                          editable={!savingPassword}
                          onFocus={() => bumpFieldVisible(anchorConfirmRef)}
                        />
                        <Pressable
                          onPress={() => setShowConfirm((s) => !s)}
                          style={styles.eyeBtn}
                          accessibilityRole="button"
                          hitSlop={8}
                        >
                          <Ionicons
                            name={showConfirm ? 'eye-off-outline' : 'eye-outline'}
                            size={22}
                            color={COLORS.textSecondary}
                          />
                        </Pressable>
                      </View>
                    </View>
                    {confirmPassword.length > 0 && !passwordsMatch ? (
                      <Text style={styles.errorText}>Passwords do not match</Text>
                    ) : null}

                    <Pressable
                      style={[styles.primaryBtn, !canSavePassword && styles.primaryBtnDisabled]}
                      onPress={() => void handleSavePassword()}
                      disabled={!canSavePassword}
                      accessibilityRole="button"
                    >
                      {savingPassword ? (
                        <ActivityIndicator color={COLORS.white} />
                      ) : (
                        <Text style={styles.primaryBtnText}>Save new password</Text>
                      )}
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.cardBody}>
                    <Text style={styles.infoMuted}>
                      Password changes apply to email sign-in only. If you signed in another way, use your
                      provider’s account settings or reset via email from the login screen.
                    </Text>
                  </View>
                )
              ) : null}
            </View>

            <View style={styles.sectionHeaderRow}>
              <Ionicons name="person-remove-outline" size={20} color={COLORS.primary} />
              <Text style={styles.sectionTitle}>Account actions</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.actionTitle}>Deactivate account</Text>
              <Text style={styles.actionDesc}>
                Pauses your account on the server: you are signed out and cannot use the app until the account is
                reactivated. Past rides and chats show others &quot;Deactivated user&quot; instead of your details.
              </Text>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>I understand I will be signed out</Text>
                <Switch
                  value={deactivateAck}
                  onValueChange={setDeactivateAck}
                  trackColor={{ false: COLORS.border, true: PRIMARY_TINT }}
                  thumbColor={deactivateAck ? COLORS.primary : COLORS.textMuted}
                  ios_backgroundColor={COLORS.border}
                  disabled={Boolean(user?.accountDeletionPending)}
                />
              </View>
              {user?.accountDeletionPending ? (
                <Text style={[styles.infoMuted, styles.deleteUnavailable]}>
                  Cancel scheduled deletion before deactivating, or complete deletion instead.
                </Text>
              ) : canUsePassword ? (
                <View style={styles.deleteSection}>
                  <Text style={[styles.fieldLabel, styles.deleteFieldLabel]}>Password</Text>
                  <View ref={anchorDeactivateRef} collapsable={false} style={styles.fieldAnchor}>
                    <View style={styles.inputWrap}>
                      <TextInput
                        style={styles.input}
                        value={deactivatePassword}
                        onChangeText={setDeactivatePassword}
                        placeholder="Current password"
                        placeholderTextColor={COLORS.textMuted}
                        secureTextEntry={!showDeactivatePwd}
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!deactivating && deactivateAck}
                        onFocus={() => bumpFieldVisible(anchorDeactivateRef)}
                      />
                      <Pressable
                        onPress={() => setShowDeactivatePwd((s) => !s)}
                        style={styles.eyeBtn}
                        accessibilityRole="button"
                        hitSlop={8}
                      >
                        <Ionicons
                          name={showDeactivatePwd ? 'eye-off-outline' : 'eye-outline'}
                          size={22}
                          color={COLORS.textSecondary}
                        />
                      </Pressable>
                    </View>
                  </View>
                  <Pressable
                    style={[styles.secondaryBtn, (!canDeactivateWithPassword || !deactivateAck) && styles.secondaryBtnDisabled]}
                    onPress={confirmDeactivate}
                    disabled={!canDeactivateWithPassword || !deactivateAck}
                    accessibilityRole="button"
                  >
                    {deactivating ? (
                      <ActivityIndicator color={COLORS.primary} />
                    ) : (
                      <Text
                        style={[
                          styles.secondaryBtnText,
                          (!canDeactivateWithPassword || !deactivateAck) && styles.secondaryBtnTextMuted,
                        ]}
                      >
                        Deactivate account
                      </Text>
                    )}
                  </Pressable>
                </View>
              ) : (
                <View style={styles.deleteSection}>
                  <Pressable
                    style={[styles.secondaryBtn, (!canDeactivateWithIdToken || !deactivateAck) && styles.secondaryBtnDisabled]}
                    onPress={confirmDeactivate}
                    disabled={!canDeactivateWithIdToken || !deactivateAck}
                    accessibilityRole="button"
                  >
                    {deactivating ? (
                      <ActivityIndicator color={COLORS.primary} />
                    ) : (
                      <Text
                        style={[
                          styles.secondaryBtnText,
                          (!canDeactivateWithIdToken || !deactivateAck) && styles.secondaryBtnTextMuted,
                        ]}
                      >
                        Deactivate account
                      </Text>
                    )}
                  </Pressable>
                </View>
              )}
            </View>

            <View style={styles.card}>
              {user?.accountDeletionPending ? (
                <>
                  <Text style={styles.pendingDeletionTitle}>Deletion scheduled</Text>
                  <Text style={styles.actionDesc}>
                    Your account will be permanently removed after the date below unless you cancel.
                  </Text>
                  {deletionEffectiveLabel ? (
                    <Text style={styles.pendingDeletionDate}>{deletionEffectiveLabel}</Text>
                  ) : null}
                  <Pressable
                    style={({ pressed }) => [
                      styles.cancelDeletionBtn,
                      cancellingDeletion && styles.cancelDeletionBtnDisabled,
                      pressed && !cancellingDeletion && styles.cancelDeletionBtnPressed,
                    ]}
                    onPress={() => void runCancelDeletion()}
                    disabled={cancellingDeletion}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel scheduled account deletion"
                  >
                    {cancellingDeletion ? (
                      <ActivityIndicator color={COLORS.primary} />
                    ) : (
                      <Text style={styles.cancelDeletionBtnText}>Cancel deletion</Text>
                    )}
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.deleteTitle}>Delete account</Text>
                  <Text style={styles.actionDesc}>
                    {canUsePassword
                      ? 'Schedules permanent removal after the server’s waiting period. Enter your password; we also send a fresh sign-in token when available. Cancel anytime before then from this screen.'
                      : 'Schedules permanent removal after the waiting period. We confirm it’s you with your current sign-in. Cancel anytime before then from this screen.'}
                  </Text>
                  {canUsePassword ? (
                    <View style={styles.deleteSection}>
                      <Text style={[styles.fieldLabel, styles.deleteFieldLabel]}>Password</Text>
                      <View ref={anchorDeleteRef} collapsable={false} style={styles.fieldAnchor}>
                        <View style={styles.inputWrap}>
                          <TextInput
                            style={styles.input}
                            value={deletePassword}
                            onChangeText={setDeletePassword}
                            placeholder="Current password"
                            placeholderTextColor={COLORS.textMuted}
                            secureTextEntry={!showDeletePwd}
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={!deleting}
                            onFocus={() => bumpFieldVisible(anchorDeleteRef)}
                          />
                          <Pressable
                            onPress={() => setShowDeletePwd((s) => !s)}
                            style={styles.eyeBtn}
                            accessibilityRole="button"
                            hitSlop={8}
                          >
                            <Ionicons
                              name={showDeletePwd ? 'eye-off-outline' : 'eye-outline'}
                              size={22}
                              color={COLORS.textSecondary}
                            />
                          </Pressable>
                        </View>
                      </View>
                      <Pressable
                        style={({ pressed }) => [
                          styles.deleteAccountBtn,
                          !canScheduleWithPassword && styles.deleteAccountBtnDisabled,
                          pressed && canScheduleWithPassword && styles.deleteAccountBtnPressed,
                        ]}
                        onPress={confirmDelete}
                        disabled={!canScheduleWithPassword}
                        accessibilityRole="button"
                        accessibilityLabel="Schedule account deletion"
                      >
                        {deleting ? (
                          <ActivityIndicator color={COLORS.white} />
                        ) : (
                          <Text
                            style={[
                              styles.deleteAccountBtnText,
                              !canScheduleWithPassword && styles.deleteAccountBtnTextDisabled,
                            ]}
                          >
                            Schedule deletion
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.deleteSection}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.deleteAccountBtn,
                          !canScheduleWithIdToken && styles.deleteAccountBtnDisabled,
                          pressed && canScheduleWithIdToken && styles.deleteAccountBtnPressed,
                        ]}
                        onPress={confirmDelete}
                        disabled={!canScheduleWithIdToken}
                        accessibilityRole="button"
                        accessibilityLabel="Schedule account deletion"
                      >
                        {deleting ? (
                          <ActivityIndicator color={COLORS.white} />
                        ) : (
                          <Text
                            style={[
                              styles.deleteAccountBtnText,
                              !canScheduleWithIdToken && styles.deleteAccountBtnTextDisabled,
                            ]}
                          >
                            Schedule deletion
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  )}
                </>
              )}
            </View>

            <Text style={styles.helpLead}>Need help with security settings?</Text>
            <Pressable style={styles.outlineBtn} onPress={openSupport} accessibilityRole="button">
              <Text style={styles.outlineBtnText}>Contact security support</Text>
            </Pressable>

            <View style={styles.sessionFooter}>
              <Text style={styles.sessionLabel}>Secure session ID</Text>
              <Text style={styles.sessionValue} selectable>
                {sessionIdPreview(user?.id, fbUid)}
              </Text>
            </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  topChrome: {
    backgroundColor: COLORS.white,
  },
  statusBarFill: {
    backgroundColor: COLORS.white,
  },
  body: {
    flex: 1,
    backgroundColor: COLORS.backgroundSecondary,
  },
  fieldAnchor: {
    alignSelf: 'stretch',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
    backgroundColor: COLORS.white,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    marginBottom: 12,
    overflow: 'hidden',
  },
  deleteSection: {
    paddingHorizontal: 14,
    paddingBottom: 16,
    paddingTop: 4,
  },
  deleteFieldLabel: {
    marginTop: 4,
  },
  deleteUnavailable: {
    paddingHorizontal: 14,
    paddingBottom: 16,
    marginTop: 4,
  },
  deleteAccountBtn: {
    marginTop: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: COLORS.error,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  deleteAccountBtnPressed: {
    opacity: 0.9,
  },
  deleteAccountBtnDisabled: {
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  deleteAccountBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
  deleteAccountBtnTextDisabled: {
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  pendingDeletionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  pendingDeletionDate: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    paddingHorizontal: 14,
    marginTop: 10,
    marginBottom: 4,
  },
  cancelDeletionBtn: {
    marginHorizontal: 14,
    marginTop: 14,
    marginBottom: 14,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    backgroundColor: COLORS.white,
  },
  cancelDeletionBtnPressed: {
    opacity: 0.92,
    backgroundColor: PRIMARY_TINT,
  },
  cancelDeletionBtnDisabled: {
    opacity: 0.55,
  },
  cancelDeletionBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.primary,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  cardHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: PRIMARY_TINT,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  cardSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  cardBody: {
    paddingHorizontal: 14,
    paddingBottom: 16,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginBottom: 6,
    marginTop: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  helperText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 6,
    lineHeight: 18,
  },
  errorText: {
    fontSize: 13,
    color: COLORS.error,
    marginTop: 6,
    lineHeight: 18,
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
  eyeBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    marginTop: 18,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  primaryBtnDisabled: {
    opacity: 0.55,
  },
  primaryBtnText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  deleteTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.error,
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  actionDesc: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    paddingHorizontal: 14,
    marginTop: 8,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    marginTop: 14,
    paddingVertical: 4,
  },
  switchLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
    paddingRight: 12,
    lineHeight: 20,
  },
  secondaryBtn: {
    marginHorizontal: 14,
    marginTop: 12,
    marginBottom: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.borderLight,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  secondaryBtnDisabled: {
    opacity: 0.55,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  secondaryBtnTextMuted: {
    color: COLORS.textMuted,
  },
  infoMuted: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  helpLead: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 16,
  },
  outlineBtn: {
    marginTop: 12,
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    minHeight: 48,
    justifyContent: 'center',
  },
  outlineBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primary,
  },
  sessionFooter: {
    marginTop: 28,
    alignItems: 'center',
    paddingBottom: 8,
  },
  sessionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sessionValue: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
