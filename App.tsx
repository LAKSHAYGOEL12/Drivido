import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StatusBar, StyleSheet, View } from 'react-native';
import BootSplash from './src/components/common/BootSplash';
import { AppErrorBoundary } from './src/components/common/AppErrorBoundary';
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
import { NotificationPreferencesProvider } from './src/contexts/NotificationPreferencesContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { AppAlertProvider } from './src/contexts/AppAlertProvider';
import { ToastProvider } from './src/contexts/ToastContext';
import { LocationProvider } from './src/contexts/LocationContext';
import { InboxProvider } from './src/contexts/InboxContext';
import { OwnerPendingRequestsProvider } from './src/contexts/OwnerPendingRequestsContext';
import RootNavigator from './src/navigation/RootNavigator';
import { COLORS } from './src/constants/colors';
import { applyGlobalRobotoFont } from './src/constants/typography';

SplashScreen.setOptions({ fade: false, duration: 0 });
void SplashScreen.preventAutoHideAsync();

const BOOT_MIN_MS = 850;
const BOOT_MAX_MS = 3000;

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
            : COLORS.background
          : undefined
      }
      translucent={Platform.OS === 'android' ? false : undefined}
    />
  );
}

/**
 * App.tsx
 * └── AuthProvider
 *     └── NotificationPreferencesProvider
 *         └── RootNavigator (via Theme, Toast, Location, Inbox)
 *         └── RootStack: Main (BottomTabs) + modal Login | Register (guests browse Search; book opens auth)
 */
export default function App(): React.JSX.Element | null {
  const [bootMinElapsed, setBootMinElapsed] = useState(false);
  const [bootMaxElapsed, setBootMaxElapsed] = useState(false);
  const nativeHiddenRef = useRef(false);
  const splashContentReadyRef = useRef(false);
  const [fontsLoaded, fontError] = useFonts({
    Roboto_300Light,
    Roboto_400Regular,
    Roboto_500Medium,
    Roboto_600SemiBold,
    Roboto_700Bold,
    Roboto_800ExtraBold,
    Roboto_900Black,
  });

  const hideNativeSplashOnce = useCallback((): void => {
    if (nativeHiddenRef.current) return;
    if (!splashContentReadyRef.current) return;
    nativeHiddenRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void SplashScreen.hideAsync().catch(() => {
          // Ignore: splash can already be hidden on some devices/runtimes.
        });
      });
    });
  }, []);

  const onJsSplashContentReady = useCallback(() => {
    splashContentReadyRef.current = true;
    hideNativeSplashOnce();
  }, [hideNativeSplashOnce]);

  useEffect(() => {
    const minTimer = setTimeout(() => setBootMinElapsed(true), BOOT_MIN_MS);
    const maxTimer = setTimeout(() => setBootMaxElapsed(true), BOOT_MAX_MS);
    return () => {
      clearTimeout(minTimer);
      clearTimeout(maxTimer);
    };
  }, []);

  const resourcesReady = fontsLoaded || Boolean(fontError) || bootMaxElapsed;
  const appCoreReady = bootMinElapsed && resourcesReady;

  /** Must run in the same render pass as the first `RootNavigator` commit — `useEffect` is too late for first-frame `Text`. */
  if (appCoreReady && fontsLoaded) {
    applyGlobalRobotoFont();
  }

  /** If the bitmap never fires `onLoadEnd` (corrupt asset, etc.), do not leave the native splash up forever. */
  useEffect(() => {
    if (!bootMaxElapsed) return;
    const t = setTimeout(() => {
      if (nativeHiddenRef.current) return;
      splashContentReadyRef.current = true;
      hideNativeSplashOnce();
    }, 80);
    return () => clearTimeout(t);
  }, [bootMaxElapsed, hideNativeSplashOnce]);

  /** Marketing splash only while fonts / min boot time run; auth restore uses `SearchRidesSkeleton` in `RootNavigator`. */
  const showBootSplashOverlay = !appCoreReady;

  return (
    <View style={styles.appRoot}>
      {appCoreReady ? (
        <SafeAreaProvider style={styles.appRoot}>
          <AppErrorBoundary>
            <AuthProvider>
              <NotificationPreferencesProvider>
                <ThemeProvider>
                  <AppAlertProvider>
                    <ToastProvider>
                      <ThemedStatusBar />
                      <LocationProvider>
                        <OwnerPendingRequestsProvider>
                          <InboxProvider>
                            <RootNavigator />
                          </InboxProvider>
                        </OwnerPendingRequestsProvider>
                      </LocationProvider>
                    </ToastProvider>
                  </AppAlertProvider>
                </ThemeProvider>
              </NotificationPreferencesProvider>
            </AuthProvider>
          </AppErrorBoundary>
        </SafeAreaProvider>
      ) : null}
      {showBootSplashOverlay ? (
        <View style={styles.jsSplashLayer} pointerEvents="none">
          <BootSplash onContentReady={onJsSplashContentReady} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  appRoot: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  jsSplashLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    elevation: 99999,
    backgroundColor: COLORS.background,
  },
});
