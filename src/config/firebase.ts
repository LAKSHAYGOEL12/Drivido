import { initializeApp, getApps, getApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore';
import {
  initializeAuth,
  getReactNativePersistence,
  getAuth,
  type Auth,
} from '@firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
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
