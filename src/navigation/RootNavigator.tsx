import React, { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { usePushNotifications } from '../hooks/usePushNotifications';
import type { MainTabParamList } from './types';
import AuthNavigator from './AuthNavigator';
import BottomTabs from './BottomTabs';

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

  usePushNotifications(
    navigationRef,
    navReady,
    isAuthenticated && !isLoading,
    user?.id ?? null
  );

  useEffect(() => {
    if (isAuthenticated) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
      // Fetch location when user logs in so it's ready when they open picker
      prefetchLocation();
    } else {
      fadeAnim.setValue(0);
    }
  }, [isAuthenticated, fadeAnim, prefetchLocation]);

  if (isLoading) {
    return null;
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        setNavReady(true);
      }}
    >
      {isAuthenticated ? (
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          <BottomTabs />
        </Animated.View>
      ) : (
        <AuthNavigator />
      )}
    </NavigationContainer>
  );
}
