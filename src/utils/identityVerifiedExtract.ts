/**
 * Strict-boolean reader for the verified ✓ flag on arbitrary backend payloads.
 *
 * Backend SSOT contract:
 * - Identity verification is recorded on `users.isIdentityVerified` in Mongo.
 * - APIs may project it under any of the four aliases below, depending on
 *   serializer / endpoint version. We accept all four shapes and emit a
 *   strict boolean (only `true` / `"true"` count).
 *
 * Used by:
 * - `ratings.ts` — `getUserRatingsSummary` / per-review reviewer flag
 * - `userIdentityVerifiedProbe.ts` — public profile probe fallback
 *
 * Centralized here so we don't drift on alias names across files.
 */

const VERIFIED_KEYS = [
  'isIdentityVerified',
  'is_identity_verified',
  'identityVerified',
  'identity_verified',
] as const;

/**
 * Returns true only when an explicit `true` (or `'true'`) is present under
 * any of the supported aliases on any of the provided records.
 */
export function pickSubjectIdentityVerified(
  ...records: Array<Record<string, unknown> | null | undefined>
): boolean {
  for (const rec of records) {
    if (!rec) continue;
    for (const k of VERIFIED_KEYS) {
      const v = (rec as Record<string, unknown>)[k];
      if (v === true || v === 'true') return true;
    }
  }
  return false;
}
