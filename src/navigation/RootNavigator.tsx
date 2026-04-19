import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, InteractionManager, StyleSheet, View } from 'react-native';
import { DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { rootNavigationRef } from './rootNavigationRef';
import { useAuth } from '../contexts/AuthContext';
import { useNotificationPreferences } from '../contexts/NotificationPreferencesContext';
import { useLocation } from '../contexts/LocationContext';
import { usePushNotifications } from '../hooks/usePushNotifications';
import RootStack from './RootStack';
import SearchRidesSkeleton from '../components/search/SearchRidesSkeleton';
import { COLORS } from '../constants/colors';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { resetNavigationToVerifyEmail } from './navigateToVerifyEmail';
import { resetNavigationToCompleteProfile } from './navigateToCompleteProfile';
import { resetNavigationToAccountDeactivated } from './navigateToAccountDeactivated';
import { resetNavigationToReactivateAccount } from './navigateToReactivateAccount';
import { resetMainTabsToSearchFromRoot } from './navigateAfterBook';
import { chatWSManager } from '../services/chatWebSocketManager';
import { resolveApiBaseOrigin } from '../config/apiBaseUrl';
import { getAccessToken } from '../services/token-storage';

const NAV_THEME: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: COLORS.background,
    card: COLORS.background,
  },
};

/**
 * RootNavigator (inside AuthProvider)
 * While isLoading: startup gate blocks nav so we don't flash wrong state before restore.
 * Guests land on Main tabs (Search); Login/Register are modals from book / locked tabs.
 */
export default function RootNavigator(): React.JSX.Element | null {
  const {
    isAuthenticated,
    isLoading,
    user,
    needsEmailVerification,
    pendingVerificationEmail,
    needsProfileCompletion,
    accountDeactivated,
    needsAccountReactivation,
  } = useAuth();
  const { pushNotificationsAllowed } = useNotificationPreferences();
  const sessionReady =
    isAuthenticated &&
    !needsEmailVerification &&
    !needsProfileCompletion &&
    !needsAccountReactivation;
  const { prefetchLocation } = useLocation();
  const [navReady, setNavReady] = useState(false);
  const verifyRedirectedRef = useRef(false);
  const accountDeactivatedRedirectedRef = useRef(false);
  const reactivateRedirectedRef = useRef(false);
  /** Latest auth flags for navigation `state` listener (avoid stale closures). */
  const profileGateAuthRef = useRef({
    needsProfileCompletion: false,
    needsEmailVerification: false,
    needsAccountReactivation: false,
    isAuthenticated: false,
  });
  const lastCompleteProfileResetAtRef = useRef(0);
  const [startupGateOpen, setStartupGateOpen] = useState(true);
  const startupMountedAtRef = useRef<number>(Date.now());
  const STARTUP_MIN_MS = 500;
  /** Logout: full-screen loader → reset to Search → fade out (single orchestrated transition). */
  const [logoutTransitionVisible, setLogoutTransitionVisible] = useState(false);
  const logoutOverlayOpacity = useRef(new Animated.Value(0)).current;
  const logoutHoldTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasAuthenticatedRef = useRef(false);
  const prevAuthForLoginResetRef = useRef<boolean>(isAuthenticated);
  const prevSessionReadyForLoginResetRef = useRef<boolean>(sessionReady);
  const didPostLoginSearchResetRef = useRef(false);
  const LOGOUT_HOLD_AFTER_RESET_MS = 480;
  const LOGOUT_FADE_OUT_MS = 320;
  const shouldSkipPostLoginSearchReset = (): boolean => {
    if (!rootNavigationRef.isReady()) return false;
    const current = rootNavigationRef.getCurrentRoute()?.name;
    // Guest -> login from Ride Detail should remain on Ride Detail so confirm alert can continue.
    return current === 'RideDetail' || current === 'RideDetailScreen';
  };

  usePushNotifications(
    rootNavigationRef,
    navReady,
    sessionReady && !isLoading && pushNotificationsAllowed,
    user?.id ?? null
  );

  useEffect(() => {
    if (sessionReady) {
      // Fetch location when user is fully onboarded so it's ready when they open picker
      prefetchLocation();
    }
  }, [sessionReady, prefetchLocation]);

  const sessionUserId = (user?.id ?? '').trim();

  /**
   * Single global chat WS — connect only when session + nav are ready.
   * Deps are primitives (no `user` object, no `isLoading`) so we do not reconnect on unrelated auth re-renders.
   * Cleanup does not disconnect; logout / gated session uses the separate effect below.
   */
  useEffect(() => {
    if (!sessionReady || !sessionUserId || !navReady) {
      return undefined;
    }

    let cancelled = false;

    void (async () => {
      try {
        const apiBaseUrl = resolveApiBaseOrigin();
        if (!apiBaseUrl || cancelled) return;

        const wsEndpoint = `${apiBaseUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/chat/ws`;
        const token = await getAccessToken();
        if (!token || cancelled) {
          if (!token && __DEV__) console.warn('[RootNav] No access token for WebSocket');
          return;
        }

        chatWSManager.connect(wsEndpoint, token);
      } catch (error) {
        console.error('[RootNav] WebSocket init error:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionReady, sessionUserId, navReady]);

  /** Disconnect only when the user is truly out of a chat-eligible session (not on random effect churn). */
  useEffect(() => {
    if (isLoading) return;
    if (!sessionReady || !sessionUserId) {
      chatWSManager.disconnect();
    }
  }, [sessionReady, sessionUserId, isLoading]);

  /** Push Verify Email when `needsEmailVerification` is true (cold start, signup, unverified login). */
  useEffect(() => {
    if (!needsEmailVerification) {
      verifyRedirectedRef.current = false;
      return;
    }
    if (!navReady || isLoading) return;
    if (rootNavigationRef.isReady()) {
      const r = rootNavigationRef.getCurrentRoute();
      if (r?.name === 'VerifyEmail') {
        verifyRedirectedRef.current = true;
        return;
      }
    }
    if (verifyRedirectedRef.current) return;
    verifyRedirectedRef.current = true;
    resetNavigationToVerifyEmail(pendingVerificationEmail ?? undefined);
  }, [navReady, isLoading, needsEmailVerification, pendingVerificationEmail]);

  /** Firebase signed in, backend user deactivated — offer reactivate (after email gate). */
  useEffect(() => {
    if (!needsAccountReactivation || needsEmailVerification) {
      reactivateRedirectedRef.current = false;
      return;
    }
    if (!navReady || isLoading) return;
    if (rootNavigationRef.isReady()) {
      const r = rootNavigationRef.getCurrentRoute();
      if (r?.name === 'ReactivateAccount') {
        reactivateRedirectedRef.current = true;
        return;
      }
    }
    if (reactivateRedirectedRef.current) return;
    reactivateRedirectedRef.current = true;
    resetNavigationToReactivateAccount();
  }, [navReady, isLoading, needsAccountReactivation, needsEmailVerification]);

  useEffect(() => {
    if (!accountDeactivated) {
      accountDeactivatedRedirectedRef.current = false;
      return;
    }
    if (!navReady || isLoading) return;
    if (rootNavigationRef.isReady()) {
      const r = rootNavigationRef.getCurrentRoute();
      if (r?.name === 'AccountDeactivated') {
        accountDeactivatedRedirectedRef.current = true;
        return;
      }
    }
    if (accountDeactivatedRedirectedRef.current) return;
    accountDeactivatedRedirectedRef.current = true;
    resetNavigationToAccountDeactivated();
  }, [navReady, isLoading, accountDeactivated]);

  useEffect(() => {
    profileGateAuthRef.current = {
      needsProfileCompletion,
      needsEmailVerification,
      needsAccountReactivation,
      isAuthenticated,
    };
  }, [needsProfileCompletion, needsEmailVerification, needsAccountReactivation, isAuthenticated]);

  /**
   * Keep Complete Profile on screen whenever the session needs it.
   * Previous `profileRedirectedRef` logic could skip re-showing after the user left the modal
   * (e.g. Android back), or fight navigation during transitions — causing loops or stuck states.
   */
  useEffect(() => {
    if (!navReady || isLoading) return undefined;

    const enforceCompleteProfile = () => {
      const g = profileGateAuthRef.current;
      if (
        !g.needsProfileCompletion ||
        g.needsEmailVerification ||
        g.needsAccountReactivation ||
        !g.isAuthenticated
      ) {
        return;
      }
      if (!rootNavigationRef.isReady()) return;
      const r = rootNavigationRef.getCurrentRoute();
      /** User may open Legal Agreement from Complete Profile — do not reset stack or the modal closes immediately. */
      if (r?.name === 'CompleteProfile' || r?.name === 'LegalAgreement') return;
      const now = Date.now();
      if (now - lastCompleteProfileResetAtRef.current < 700) return;
      lastCompleteProfileResetAtRef.current = now;
      resetNavigationToCompleteProfile();
    };

    const run = () => requestAnimationFrame(() => enforceCompleteProfile());
    run();

    const unsub = rootNavigationRef.addListener('state', run);
    return () => {
      unsub();
    };
  }, [
    navReady,
    isLoading,
    needsProfileCompletion,
    needsEmailVerification,
    needsAccountReactivation,
    isAuthenticated,
  ]);

  useEffect(() => {
    const prev = prevAuthForLoginResetRef.current;
    prevAuthForLoginResetRef.current = isAuthenticated;
    const becameAuthenticated = !prev && isAuthenticated;
    if (!becameAuthenticated) return;
    if (!navReady || isLoading) return;
    if (needsEmailVerification || needsProfileCompletion || needsAccountReactivation) return;
    if (shouldSkipPostLoginSearchReset()) return;
    InteractionManager.runAfterInteractions(() => {
      resetMainTabsToSearchFromRoot();
    });
  }, [
    isAuthenticated,
    navReady,
    isLoading,
    needsEmailVerification,
    needsProfileCompletion,
    needsAccountReactivation,
  ]);

  useEffect(() => {
    if (!sessionReady) {
      didPostLoginSearchResetRef.current = false;
      prevSessionReadyForLoginResetRef.current = false;
      return;
    }
    const prevSessionReady = prevSessionReadyForLoginResetRef.current;
    prevSessionReadyForLoginResetRef.current = sessionReady;
    const becameSessionReady = !prevSessionReady && sessionReady;
    if (!becameSessionReady) return;
    if (!navReady || isLoading) return;
    if (didPostLoginSearchResetRef.current) return;
    if (shouldSkipPostLoginSearchReset()) return;
    didPostLoginSearchResetRef.current = true;
    InteractionManager.runAfterInteractions(() => {
      resetMainTabsToSearchFromRoot();
    });
  }, [sessionReady, navReady, isLoading]);

  useEffect(() => {
    const loggingOut = wasAuthenticatedRef.current && !isAuthenticated && !isLoading;
    wasAuthenticatedRef.current = isAuthenticated;

    if (!loggingOut) return undefined;

    let cancelled = false;

    /** Complete Profile shows its own full-screen "Shutting down" — avoid resetting to Main under a fading overlay (ride tabs flash). */
    const fromCompleteProfile =
      navReady &&
      rootNavigationRef.isReady() &&
      rootNavigationRef.getCurrentRoute()?.name === 'CompleteProfile';

    if (fromCompleteProfile) {
      InteractionManager.runAfterInteractions(() => {
        if (cancelled) return;
        resetMainTabsToSearchFromRoot();
      });
      return () => {
        cancelled = true;
      };
    }

    logoutOverlayOpacity.setValue(1);
    setLogoutTransitionVisible(true);

    InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      resetMainTabsToSearchFromRoot();
      if (logoutHoldTimeoutRef.current) clearTimeout(logoutHoldTimeoutRef.current);
      logoutHoldTimeoutRef.current = setTimeout(() => {
        if (cancelled) return;
        Animated.timing(logoutOverlayOpacity, {
          toValue: 0,
          duration: LOGOUT_FADE_OUT_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }).start(({ finished: done }) => {
          if (done && !cancelled) setLogoutTransitionVisible(false);
        });
      }, LOGOUT_HOLD_AFTER_RESET_MS);
    });

    return () => {
      cancelled = true;
      if (logoutHoldTimeoutRef.current) {
        clearTimeout(logoutHoldTimeoutRef.current);
        logoutHoldTimeoutRef.current = null;
      }
    };
  }, [isAuthenticated, isLoading, navReady]);

  useEffect(() => {
    if (!startupGateOpen) return;
    if (isLoading) return;
    const elapsed = Date.now() - startupMountedAtRef.current;
    const remaining = Math.max(0, STARTUP_MIN_MS - elapsed);
    const t = setTimeout(() => setStartupGateOpen(false), remaining);
    return () => clearTimeout(t);
  }, [isLoading, startupGateOpen]);

  /** Only block the first paint; never unmount `NavigationContainer` for auth/logout gates — that wiped stack state (e.g. Ride Detail → Search) and broke post-login booking. */
  if (startupGateOpen) {
    return (
      <View style={styles.startupGateRoot} accessibilityLabel="Loading">
        <SearchRidesSkeleton />
      </View>
    );
  }

  return (
    <View style={styles.navRoot}>
      <NavigationContainer
        theme={NAV_THEME}
        ref={rootNavigationRef}
        onReady={() => {
          setNavReady(true);
        }}
      >
        <View style={{ flex: 1 }}>
          <RootStack />
        </View>
      </NavigationContainer>
      {logoutTransitionVisible ? (
        <Animated.View
          style={[styles.logoutOverlay, { opacity: logoutOverlayOpacity }]}
          pointerEvents="auto"
        >
          <View style={styles.logoutCard}>
            <LoadingSpinner inline size="lg" label="Shutting down…" style={{ padding: 0 }} />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  navRoot: { flex: 1, backgroundColor: COLORS.background },
  startupGateRoot: {
    flex: 1,
    backgroundColor: COLORS.backgroundSecondary,
  },
  logoutOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(248, 250, 252, 0.97)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 36,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 6,
  },
});
