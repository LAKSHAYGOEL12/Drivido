import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  InteractionManager,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { rootNavigationRef } from './rootNavigationRef';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { usePushNotifications } from '../hooks/usePushNotifications';
import RootStack from './RootStack';
import { COLORS } from '../constants/colors';
import { resetNavigationToVerifyEmail } from './navigateToVerifyEmail';
import { resetMainTabsToSearchFromRoot } from './navigateAfterBook';
import { chatWSManager } from '../services/chatWebSocketManager';
import { resolveApiBaseOrigin } from '../config/apiBaseUrl';
import { getAccessToken } from '../services/token-storage';

/**
 * RootNavigator (inside AuthProvider)
 * While isLoading: show nothing (or a splash) so we don't flash wrong state before restore.
 * Guests land on Main tabs (Search); Login/Register are modals from book / locked tabs.
 */
export default function RootNavigator(): React.JSX.Element | null {
  const { isAuthenticated, isLoading, user, needsEmailVerification, pendingVerificationEmail } = useAuth();
  const { prefetchLocation } = useLocation();
  const [navReady, setNavReady] = useState(false);
  const verifyRedirectedRef = useRef(false);
  const [startupGateOpen, setStartupGateOpen] = useState(true);
  const startupMountedAtRef = useRef<number>(Date.now());
  const STARTUP_MIN_MS = 500;
  /** Logout: full-screen loader → reset to Search → fade out (single orchestrated transition). */
  const [logoutTransitionVisible, setLogoutTransitionVisible] = useState(false);
  const logoutOverlayOpacity = useRef(new Animated.Value(0)).current;
  const logoutHoldTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasAuthenticatedRef = useRef(false);
  const LOGOUT_FADE_IN_MS = 200;
  const LOGOUT_HOLD_AFTER_RESET_MS = 480;
  const LOGOUT_FADE_OUT_MS = 320;

  usePushNotifications(
    rootNavigationRef,
    navReady,
    isAuthenticated && !isLoading,
    user?.id ?? null
  );

  useEffect(() => {
    if (isAuthenticated) {
      // Fetch location when user logs in so it's ready when they open picker
      prefetchLocation();
    }
  }, [isAuthenticated, prefetchLocation]);

  /** Initialize WebSocket connection when authenticated */
  useEffect(() => {
    if (isAuthenticated && user?.id && navReady && !isLoading) {
      (async () => {
        try {
          const apiBaseUrl = resolveApiBaseOrigin();
          console.log('[RootNav] API base URL:', apiBaseUrl);
          
          if (!apiBaseUrl) {
            console.warn('[RootNav] ❌ No API base URL configured for WebSocket');
            return;
          }

          const wsUrl = apiBaseUrl
            .replace(/^http/, 'ws')
            .replace(/\/$/, '');
          const wsEndpoint = `${wsUrl}/chat/ws`;

          console.log('[RootNav] WebSocket endpoint:', wsEndpoint);

          const token = await getAccessToken();
          if (!token) {
            console.warn('[RootNav] ❌ No access token available for WebSocket');
            return;
          }

          console.log('[RootNav] ✅ Connecting WebSocket for user:', user.id);
          console.log('[RootNav] Token available: yes (length:', token.length, ')');
          
          chatWSManager.connect(wsEndpoint, token);
        } catch (error) {
          console.error('[RootNav] ❌ WebSocket init error:', error);
        }
      })();
    } else if (!isAuthenticated && !isLoading) {
      console.log('[RootNav] Disconnecting WebSocket');
      chatWSManager.disconnect();
    }
  }, [isAuthenticated, user?.id, navReady, isLoading]);

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

  useEffect(() => {
    const loggingOut = wasAuthenticatedRef.current && !isAuthenticated && !isLoading;
    wasAuthenticatedRef.current = isAuthenticated;

    if (!loggingOut) return undefined;

    let cancelled = false;
    logoutOverlayOpacity.setValue(0);
    setLogoutTransitionVisible(true);

    const fadeIn = Animated.timing(logoutOverlayOpacity, {
      toValue: 1,
      duration: LOGOUT_FADE_IN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });

    fadeIn.start(({ finished }) => {
      if (!finished || cancelled) return;
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
    });

    return () => {
      cancelled = true;
      fadeIn.stop();
      if (logoutHoldTimeoutRef.current) {
        clearTimeout(logoutHoldTimeoutRef.current);
        logoutHoldTimeoutRef.current = null;
      }
    };
  }, [isAuthenticated, isLoading]);

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
      <View style={{ flex: 1, backgroundColor: COLORS.backgroundSecondary, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={{ marginTop: 12, color: COLORS.textSecondary, fontWeight: '600' }}>
          Thinking
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.navRoot}>
      <NavigationContainer
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
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.logoutTitle}>Shutting down</Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  navRoot: { flex: 1 },
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
  logoutTitle: {
    marginTop: 20,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.3,
  },
});
