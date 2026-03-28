const path = require('path');

// Load .env from project root (needed for prebuild so key is in native build)
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

/** Backend origin only — same variable the app uses: `src/config/apiBaseUrl.ts` + `services/api.ts` */
const apiBaseUrlFromEnv = (process.env.EXPO_PUBLIC_API_URL || '').trim();
/** Expo project UUID — required for `getExpoPushTokenAsync` when not in Expo Go (dev build / APK). See https://expo.dev → Project settings, or `eas project:info`. */
const easProjectIdFromEnv = (process.env.EXPO_PUBLIC_EAS_PROJECT_ID || '').trim();

const appJson = require('./app.json');

const extraEasMerged = {
  ...(typeof appJson.expo.extra?.eas === 'object' && appJson.expo.extra.eas !== null
    ? appJson.expo.extra.eas
    : {}),
  ...(easProjectIdFromEnv ? { projectId: easProjectIdFromEnv } : {}),
};

// Google Maps API key from .env (required for Android; black screen if missing)
const androidMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY || '';
const iosMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY || '';

const config = {
  ...appJson,
  expo: {
    ...appJson.expo,
    // Mirrors EXPO_PUBLIC_API_URL from .env (native / Constants.extra). App prefers Metro .env first.
    extra: {
      ...(appJson.expo.extra || {}),
      apiUrl: apiBaseUrlFromEnv,
      /** Push: Expo needs `projectId` in dev/bare/APK builds for `getExpoPushTokenAsync`. */
      eas: extraEasMerged,
    },
    plugins: [
      ...appJson.expo.plugins.map((plugin) => {
        if (Array.isArray(plugin) && plugin[0] === 'react-native-maps') {
          return [
            'react-native-maps',
            {
              iosGoogleMapsApiKey: iosMapsKey || 'YOUR_GOOGLE_MAPS_IOS_KEY',
              androidGoogleMapsApiKey: androidMapsKey || 'YOUR_GOOGLE_MAPS_ANDROID_KEY',
            },
          ];
        }
        return plugin;
      }),
      'expo-secure-store',
      'expo-font',
    ],
    // Android Maps key and package (required for prebuild)
    android: {
      ...(appJson.expo.android || {}),
      package: appJson.expo.android?.package || 'com.drivido.app',
      /** Firebase / FCM — file at project root; required for Android push (expo-notifications). */
      googleServicesFile: './google-services.json',
      // http:// LAN API (EXPO_PUBLIC_API_URL) on device — required on Android 9+
      usesCleartextTraffic: true,
      softwareKeyboardLayoutMode: 'resize',
      config: {
        ...(appJson.expo.android?.config || {}),
        googleMaps: { apiKey: androidMapsKey },
      },
    },
    // iOS bundle identifier (required for prebuild with dynamic config)
    ios: {
      ...(appJson.expo.ios || {}),
      bundleIdentifier: appJson.expo.ios?.bundleIdentifier || 'com.drivido.app',
    },
  },
};

module.exports = config;
