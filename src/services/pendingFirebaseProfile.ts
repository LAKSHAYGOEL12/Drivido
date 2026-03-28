/**
 * DOB/gender collected on Register are sent on the next POST /api/auth/firebase (first session exchange).
 * Cleared only after a successful exchange so retries still include the payload.
 */
type Pending = { dateOfBirth: string; gender: string };

let pending: Pending | null = null;

export function setPendingFirebaseProfilePatch(patch: Pending): void {
  pending = patch;
}

export function clearPendingFirebaseProfilePatch(): void {
  pending = null;
}

export function peekPendingFirebaseProfileForExchange(): { dateOfBirth?: string; gender?: string } {
  if (!pending) return {};
  return { dateOfBirth: pending.dateOfBirth, gender: pending.gender };
}
