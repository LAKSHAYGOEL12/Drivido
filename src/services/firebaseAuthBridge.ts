import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  deleteUser,
} from '@firebase/auth';
import { getFirebaseAuth, isFirebaseAuthConfigured } from '../config/firebase';

function getFirebaseAuthErrorCode(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'code' in e) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === 'string') return c;
  }
  return undefined;
}

export function firebaseAuthErrorToMessage(e: unknown): string {
  const code = getFirebaseAuthErrorCode(e);
  switch (code) {
    case 'auth/email-already-in-use':
      return 'This email is already registered. Sign in instead.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/weak-password':
      return 'Password is too weak.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Invalid email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection.';
    case 'auth/invalid-action-code':
    case 'auth/expired-action-code':
      return 'This link has expired. Request a new email from the app.';
    case 'auth/requires-recent-login':
      return 'For security, sign out and sign in again, then try this action.';
    default:
      if (e instanceof Error && e.message) return e.message;
      return 'Something went wrong. Try again.';
  }
}

export async function firebaseSignOutSafe(): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) return;
  try {
    await firebaseSignOut(auth);
  } catch {
    // Session may already be cleared
  }
}

function requireFirebaseAuthConfigured(): void {
  if (!isFirebaseAuthConfigured() || !getFirebaseAuth()) {
    throw new Error(
      'Firebase is not configured. Add EXPO_PUBLIC_FIREBASE_* keys to .env and restart Expo.'
    );
  }
}

export async function signInWithEmailPassword(email: string, password: string): Promise<void> {
  requireFirebaseAuthConfigured();
  const auth = getFirebaseAuth()!;
  await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
}

/**
 * Firebase Auth account; DOB/gender are stored on the backend via `setPendingFirebaseProfilePatch` + POST /api/auth/firebase.
 */
export async function signUpWithEmailAndProfile(body: {
  email: string;
  name: string;
  password: string;
}): Promise<void> {
  requireFirebaseAuthConfigured();
  const auth = getFirebaseAuth()!;
  const email = body.email.trim().toLowerCase();
  const name = body.name.trim();

  const cred = await createUserWithEmailAndPassword(auth, email, body.password);
  await updateProfile(cred.user, { displayName: name });
  await sendEmailVerification(cred.user);
}

export async function resendEmailVerificationForCurrentUser(): Promise<void> {
  requireFirebaseAuthConfigured();
  const auth = getFirebaseAuth()!;
  const u = auth.currentUser;
  if (!u?.email) {
    throw new Error('No signed-in user with an email address.');
  }
  await sendEmailVerification(u);
}

export async function sendPasswordResetEmailToAddress(email: string): Promise<void> {
  requireFirebaseAuthConfigured();
  const auth = getFirebaseAuth()!;
  await sendPasswordResetEmail(auth, email.trim().toLowerCase());
}

/** Email/password accounts only: re-authenticate, then set a new password. */
export async function changePasswordForCurrentUser(args: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  requireFirebaseAuthConfigured();
  const auth = getFirebaseAuth()!;
  const u = auth.currentUser;
  const email = u?.email?.trim();
  if (!u || !email) {
    throw new Error('Password change requires an email and password sign-in.');
  }
  const credential = EmailAuthProvider.credential(email, args.currentPassword);
  await reauthenticateWithCredential(u, credential);
  await updatePassword(u, args.newPassword);
}

/** Email/password accounts only: re-authenticate, then delete the Firebase user. */
export async function deleteFirebaseUserWithPassword(currentPassword: string): Promise<void> {
  requireFirebaseAuthConfigured();
  const auth = getFirebaseAuth()!;
  const u = auth.currentUser;
  const email = u?.email?.trim();
  if (!u || !email) {
    throw new Error('Account deletion requires an email and password sign-in.');
  }
  const credential = EmailAuthProvider.credential(email, currentPassword);
  await reauthenticateWithCredential(u, credential);
  await deleteUser(u);
}
