import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import type { User as FirebaseUser } from '@firebase/auth';
import { getFirestoreDb } from '../config/firebase';

export const USERS_COLLECTION = 'users';

export type UserProfileDoc = {
  /** Legacy / optional; empty for email-only accounts */
  phone: string;
  email: string;
  name: string;
  /** ISO date YYYY-MM-DD (new signups; omit on older profiles) */
  dateOfBirth?: string;
  /** e.g. male | female | non_binary | prefer_not_to_say */
  gender?: string;
  avatarUrl?: string | null;
};

/** Last 10 digits for India; empty if unknown. */
export function phoneDigitsFromFirebasePhone(fbPhone: string | null | undefined): string {
  if (!fbPhone) return '';
  const d = fbPhone.replace(/\D/g, '');
  if (d.length >= 10) return d.slice(-10);
  return d;
}

/** True when Firestore cannot read from network (do not treat as fatal for auth). */
export function isFirestoreTransientReadError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const code = String((e as { code?: string }).code || '');
  const message = String((e as { message?: string }).message || '');
  if (code === 'unavailable' || code === 'deadline-exceeded') return true;
  if (/offline|client is offline|failed to get document|timeout/i.test(message)) return true;
  return false;
}

const FIRESTORE_GET_MS = 6000;
const FIRESTORE_WRITE_MS = 8000;

/** Firestore `getDoc` can hang indefinitely while the SDK waits for connectivity — never block UI that long. */
function withFirestoreTimeout<T>(ms: number, p: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('firestore-timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export async function getUserProfileDoc(uid: string): Promise<UserProfileDoc | null> {
  const db = getFirestoreDb();
  if (!db) return null;
  const ref = doc(db, USERS_COLLECTION, uid);
  try {
    let snap = await withFirestoreTimeout(FIRESTORE_GET_MS, getDoc(ref));
    if (snap.exists()) return snap.data() as UserProfileDoc;
    await new Promise((r) => setTimeout(r, 200));
    snap = await withFirestoreTimeout(FIRESTORE_GET_MS, getDoc(ref));
    if (snap.exists()) return snap.data() as UserProfileDoc;
    return null;
  } catch (e) {
    if (__DEV__) {
      if (e instanceof Error && e.message === 'firestore-timeout') {
        console.warn('[Firestore] profile read timed out — UI will not wait for Firestore');
      } else if (isFirestoreTransientReadError(e)) {
        console.warn('[Firestore] profile read skipped (offline or transient):', (e as Error).message);
      }
    }
    return null;
  }
}

export async function setUserProfileDoc(uid: string, data: UserProfileDoc): Promise<void> {
  const db = getFirestoreDb();
  if (!db) throw new Error('Firestore is not available');
  await setDoc(
    doc(db, USERS_COLLECTION, uid),
    {
      ...data,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** First-time profile after signup — sets `createdAt` once. */
export async function createUserProfileDoc(uid: string, data: UserProfileDoc): Promise<void> {
  const db = getFirestoreDb();
  if (!db) throw new Error('Firestore is not available');
  await setDoc(doc(db, USERS_COLLECTION, uid), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Create Firestore profile from Firebase Auth when missing (Google / phone-only users). */
export async function ensureUserProfileFromFirebaseUser(fbUser: FirebaseUser): Promise<UserProfileDoc> {
  const db = getFirestoreDb();
  if (!db) throw new Error('Firestore is not available');
  const uid = fbUser.uid;
  const ref = doc(db, USERS_COLLECTION, uid);
  let snap;
  try {
    snap = await withFirestoreTimeout(FIRESTORE_GET_MS, getDoc(ref));
  } catch {
    throw new Error('firestore-timeout');
  }
  if (snap.exists()) return snap.data() as UserProfileDoc;

  const phone = phoneDigitsFromFirebasePhone(fbUser.phoneNumber);
  const email = fbUser.email ?? '';
  const name = (fbUser.displayName ?? '').trim() || 'User';
  const avatarUrl = fbUser.photoURL ?? null;
  const data: UserProfileDoc = {
    phone,
    email,
    name,
    avatarUrl,
  };
  try {
    await withFirestoreTimeout(
      FIRESTORE_WRITE_MS,
      setDoc(ref, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  } catch {
    throw new Error('firestore-timeout');
  }
  return data;
}

export function buildAppUserFromFirebase(
  fbUser: FirebaseUser,
  profile: UserProfileDoc | null
): {
  id: string;
  phone: string;
  email?: string;
  name?: string;
  dateOfBirth?: string;
  gender?: string;
  createdAt?: string;
  avatarUrl?: string;
} {
  const email = fbUser.email ?? profile?.email ?? '';
  const name = (profile?.name ?? fbUser.displayName ?? '').trim() || undefined;
  const phoneFromProfile = profile?.phone?.replace(/\D/g, '').replace(/^91(?=\d{10})/, '').slice(-10) ?? '';
  const phoneFromAuth = phoneDigitsFromFirebasePhone(fbUser.phoneNumber);
  const phone = phoneFromProfile || phoneFromAuth;
  const dateOfBirth = profile?.dateOfBirth?.trim() || undefined;
  const gender = profile?.gender?.trim() || undefined;
  const avatarUrl =
    (profile?.avatarUrl ?? fbUser.photoURL ?? undefined) || undefined;
  const createdAt = fbUser.metadata.creationTime ?? undefined;
  return {
    id: fbUser.uid,
    phone,
    email: email || undefined,
    name,
    ...(dateOfBirth ? { dateOfBirth } : {}),
    ...(gender ? { gender } : {}),
    createdAt,
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}
