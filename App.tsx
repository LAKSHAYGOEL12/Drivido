import { Platform, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/contexts/AuthContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { ToastProvider } from './src/contexts/ToastContext';
import { LocationProvider } from './src/contexts/LocationContext';
import { InboxProvider } from './src/contexts/InboxContext';
import RootNavigator from './src/navigation/RootNavigator';
import { COLORS } from './src/constants/colors';

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
 *         ├── IF NOT LOGGED IN → AuthNavigator (Login | Register)
 *         └── IF LOGGED IN    → BottomTabs (SearchRides | PublishRide | YourRides | Inbox | Profile)
 */
export default function App(): React.JSX.Element {
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
