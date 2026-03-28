import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { rootNavigationRef } from './rootNavigationRef';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { usePushNotifications } from '../hooks/usePushNotifications';
import RootStack from './RootStack';
import { COLORS } from '../constants/colors';

/**
 * RootNavigator (inside AuthProvider)
 * While isLoading: show nothing (or a splash) so we don't flash wrong state before restore.
 * Guests land on Main tabs (Search); Login/Register are modals from book / locked tabs.
 */
export default function RootNavigator(): React.JSX.Element | null {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { prefetchLocation } = useLocation();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [navReady, setNavReady] = useState(false);
  const [startupGateOpen, setStartupGateOpen] = useState(true);
  const startupMountedAtRef = useRef<number>(Date.now());
  const STARTUP_MIN_MS = 500;
  const [authHomeGateOpen, setAuthHomeGateOpen] = useState(false);
  const [logoutGateOpen, setLogoutGateOpen] = useState(false);
  const prevIsAuthenticatedRef = useRef<boolean>(false);
  const AUTH_HOME_GATE_MS = 420;
  const LOGOUT_GATE_MS = 360;
  const authTransitionFrameGate =
    !prevIsAuthenticatedRef.current && isAuthenticated && !isLoading;
  const showAuthGate = authHomeGateOpen || authTransitionFrameGate;

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

  useEffect(() => {
    const wasAuthenticated = prevIsAuthenticatedRef.current;
    prevIsAuthenticatedRef.current = isAuthenticated;

    // Show a short "Thinking" gate specifically when transitioning
    // from Auth screens to Main tabs.
    if (!wasAuthenticated && isAuthenticated && !isLoading) {
      setAuthHomeGateOpen(true);
      const t = setTimeout(() => setAuthHomeGateOpen(false), AUTH_HOME_GATE_MS);
      return () => clearTimeout(t);
    }
    // Show a short shutdown gate before showing Auth screens.
    if (wasAuthenticated && !isAuthenticated && !isLoading) {
      setLogoutGateOpen(true);
      const t = setTimeout(() => setLogoutGateOpen(false), LOGOUT_GATE_MS);
      return () => clearTimeout(t);
    }
    if (!isAuthenticated) {
      setAuthHomeGateOpen(false);
    }
  }, [isAuthenticated, isLoading]);

  useEffect(() => {
    if (!isAuthenticated || showAuthGate) {
      fadeAnim.setValue(1);
      return;
    }
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isAuthenticated, showAuthGate, fadeAnim]);

  useEffect(() => {
    if (!startupGateOpen) return;
    if (isLoading) return;
    const elapsed = Date.now() - startupMountedAtRef.current;
    const remaining = Math.max(0, STARTUP_MIN_MS - elapsed);
    const t = setTimeout(() => setStartupGateOpen(false), remaining);
    return () => clearTimeout(t);
  }, [isLoading, startupGateOpen]);

  if (startupGateOpen || (isAuthenticated && showAuthGate) || logoutGateOpen) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.backgroundSecondary, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={{ marginTop: 12, color: COLORS.textSecondary, fontWeight: '600' }}>
          {logoutGateOpen ? 'Shutting down' : 'Thinking'}
        </Text>
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={rootNavigationRef}
      onReady={() => {
        setNavReady(true);
      }}
    >
      <Animated.View
        style={{
          flex: 1,
          opacity: fadeAnim,
          transform: [
            {
              translateY: fadeAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [14, 0],
              }),
            },
          ],
        }}
      >
        <RootStack />
      </Animated.View>
    </NavigationContainer>
  );
}
