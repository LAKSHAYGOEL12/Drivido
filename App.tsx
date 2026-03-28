import React, { useEffect } from 'react';
import { Platform, StatusBar } from 'react-native';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import {
  Roboto_300Light,
  Roboto_400Regular,
  Roboto_500Medium,
  Roboto_600SemiBold,
  Roboto_700Bold,
  Roboto_800ExtraBold,
  Roboto_900Black,
} from '@expo-google-fonts/roboto';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/contexts/AuthContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { ToastProvider } from './src/contexts/ToastContext';
import { LocationProvider } from './src/contexts/LocationContext';
import { InboxProvider } from './src/contexts/InboxContext';
import RootNavigator from './src/navigation/RootNavigator';
import { COLORS } from './src/constants/colors';
import { applyGlobalRobotoFont } from './src/constants/typography';

void SplashScreen.preventAutoHideAsync();

/**
 * Light UI needs dark status-bar icons on Android; `expo-status-bar` "auto" often picked light icons → white-on-white.
 */
function ThemedStatusBar(): React.JSX.Element {
  const { isDark } = useTheme();
  return (
    <StatusBar
      barStyle={isDark ? 'light-content' : 'dark-content'}
      backgroundColor={
        Platform.OS === 'android'
          ? isDark
            ? COLORS.dark.background
            : COLORS.backgroundSecondary
          : undefined
      }
      translucent={Platform.OS === 'android' ? false : undefined}
    />
  );
}

/**
 * App.tsx
 * └── AuthProvider
 *     └── RootNavigator
 *         └── RootStack: Main (BottomTabs) + modal Login | Register (guests browse Search; book opens auth)
 */
export default function App(): React.JSX.Element | null {
  const [fontsLoaded, fontError] = useFonts({
    Roboto_300Light,
    Roboto_400Regular,
    Roboto_500Medium,
    Roboto_600SemiBold,
    Roboto_700Bold,
    Roboto_800ExtraBold,
    Roboto_900Black,
  });

  useEffect(() => {
    if (!fontsLoaded && !fontError) return;
    void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  // Must run before this render’s children mount: `Text.defaultProps` is read when each Text renders.
  // Applying in useEffect ran too late, so the first screen never picked up Roboto (Android + iOS).
  if (fontsLoaded) {
    applyGlobalRobotoFont();
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ThemeProvider>
          <ToastProvider>
            <ThemedStatusBar />
            <LocationProvider>
              <InboxProvider>
                <RootNavigator />
              </InboxProvider>
            </LocationProvider>
          </ToastProvider>
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
