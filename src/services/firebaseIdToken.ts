import { getFirebaseAuth } from '../config/firebase';

/** Force-refresh Firebase ID token for API Authorization (short-lived JWT). */
export async function getFreshFirebaseIdToken(): Promise<string | null> {
  const auth = getFirebaseAuth();
  const u = auth?.currentUser;
  if (!u) return null;
  try {
    return await u.getIdToken(true);
  } catch {
    return null;
  }
}
