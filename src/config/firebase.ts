import Constants from 'expo-constants';
import { initializeApp, getApps, getApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore';
import {
  initializeAuth,
  getReactNativePersistence,
  getAuth,
  type Auth,
} from '@firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

type FirebaseExtra = Partial<
  Pick<
    FirebaseOptions,
    'apiKey' | 'authDomain' | 'projectId' | 'storageBucket' | 'messagingSenderId' | 'appId'
  >
>;

function readFirebaseFromExpoExtra(): FirebaseExtra {
  const extra = Constants.expoConfig?.extra as { firebase?: FirebaseExtra } | undefined;
  const f = extra?.firebase;
  return f && typeof f === 'object' ? f : {};
}

function pickStr(envVal: string | undefined, extraVal: unknown): string {
  const fromEnv = typeof envVal === 'string' ? envVal.trim() : '';
  if (fromEnv) return fromEnv;
  return typeof extraVal === 'string' ? extraVal.trim() : '';
}

/**
 * Prefer Metro-inlined `process.env.EXPO_PUBLIC_FIREBASE_*` (local `.env` + `expo start --clear`).
 * Fallback: `app.config.js` → `expo.extra.firebase` (EAS / release APK when env vars were available at build).
 */
const extraFb = readFirebaseFromExpoExtra();
const firebaseConfig: FirebaseOptions = {
  apiKey: pickStr(process.env.EXPO_PUBLIC_FIREBASE_API_KEY, extraFb.apiKey),
  authDomain: pickStr(process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN, extraFb.authDomain),
  projectId: pickStr(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID, extraFb.projectId),
  storageBucket: pickStr(process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET, extraFb.storageBucket),
  messagingSenderId: pickStr(
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    extraFb.messagingSenderId
  ),
  appId: pickStr(process.env.EXPO_PUBLIC_FIREBASE_APP_ID, extraFb.appId),
};

/** Same Firebase web config as the native app (for helpers / debugging). */
export function getFirebaseWebConfig(): FirebaseOptions {
  return { ...firebaseConfig };
}

export function isFirebaseAuthConfigured(): boolean {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.appId
  );
}

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (appInstance) return appInstance;
  if (getApps().length > 0) {
    appInstance = getApp();
    return appInstance;
  }
  appInstance = initializeApp(firebaseConfig);
  return appInstance;
}

export function getFirestoreDb(): Firestore | null {
  if (!isFirebaseAuthConfigured()) return null;
  if (firestoreInstance) return firestoreInstance;
  const app = getFirebaseApp();
  try {
    // React Native / Android often mis-detects connectivity with default WebChannel; long polling avoids false "offline".
    firestoreInstance = initializeFirestore(app, {
      experimentalForceLongPolling: true,
    });
  } catch {
    firestoreInstance = getFirestore(app);
  }
  return firestoreInstance;
}

/**
 * Firebase Auth with AsyncStorage persistence (Expo / React Native).
 * Returns null when env is incomplete — app falls back to backend-only auth.
 */
export function getFirebaseAuth(): Auth | null {
  if (!isFirebaseAuthConfigured()) return null;
  if (authInstance) return authInstance;
  const app = getFirebaseApp();
  try {
    authInstance = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    authInstance = getAuth(app);
  }
  return authInstance;
}
