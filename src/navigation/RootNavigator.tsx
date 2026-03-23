import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Text, View } from 'react-native';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { usePushNotifications } from '../hooks/usePushNotifications';
import type { MainTabParamList } from './types';
import AuthNavigator from './AuthNavigator';
import BottomTabs from './BottomTabs';
import { COLORS } from '../constants/colors';

/**
 * RootNavigator (inside AuthProvider)
 * While isLoading: show nothing (or a splash) so we don't flash login before restore.
 * ├── IF NOT LOGGED IN → AuthNavigator (Login | Register)
 * └── IF LOGGED IN    → BottomTabs (fade in for smooth transition)
 */
export default function RootNavigator(): React.JSX.Element | null {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { prefetchLocation } = useLocation();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const navigationRef = useNavigationContainerRef<MainTabParamList>();
  const [navReady, setNavReady] = useState(false);
  const MIN_HOME_GATE_MS = 1000;
  const authBecameAuthenticatedAtRef = useRef<number | null>(null);
  const [showHomeGate, setShowHomeGate] = useState(false);

  // Home gate loader: prevents abrupt/empty transitions after login/signup.
  useEffect(() => {
    if (!isAuthenticated) {
      authBecameAuthenticatedAtRef.current = null;
      setShowHomeGate(false);
      fadeAnim.setValue(0);
      return;
    }
    authBecameAuthenticatedAtRef.current = Date.now();
    setShowHomeGate(true);
  }, [isAuthenticated, fadeAnim]);

  usePushNotifications(
    navigationRef,
    navReady,
    isAuthenticated && !isLoading,
    user?.id ?? null
  );

  useEffect(() => {
    if (isAuthenticated) {
      // Fetch location when user logs in so it's ready when they open picker
      prefetchLocation();
    }
  }, [isAuthenticated, fadeAnim, prefetchLocation]);

  useEffect(() => {
    if (!isAuthenticated || !navReady) return;
    if (authBecameAuthenticatedAtRef.current == null) return;
    const elapsed = Date.now() - authBecameAuthenticatedAtRef.current;
    const remaining = Math.max(0, MIN_HOME_GATE_MS - elapsed);
    const t = setTimeout(() => setShowHomeGate(false), remaining);
    return () => clearTimeout(t);
  }, [isAuthenticated, navReady]);

  useEffect(() => {
    // Ensure fade doesn't start too early. When gate is visible, keep opacity at 0.
    if (!isAuthenticated || showHomeGate) {
      fadeAnim.setValue(0);
      return;
    }
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [isAuthenticated, showHomeGate, fadeAnim]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.backgroundSecondary, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={{ marginTop: 12, color: COLORS.textSecondary, fontWeight: '600' }}>Loading…</Text>
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        setNavReady(true);
      }}
    >
      {isAuthenticated ? (
        <View style={{ flex: 1 }}>
          {showHomeGate ? (
            <View style={{ flex: 1, backgroundColor: COLORS.backgroundSecondary, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={{ marginTop: 12, color: COLORS.textSecondary, fontWeight: '600' }}>Preparing home…</Text>
            </View>
          ) : (
            <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
              <BottomTabs />
            </Animated.View>
          )}
        </View>
      ) : (
        <AuthNavigator />
      )}
    </NavigationContainer>
  );
}
