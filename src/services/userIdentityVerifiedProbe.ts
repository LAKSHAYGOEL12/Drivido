/**
 * Lazy probe that resolves a peer user's `isIdentityVerified` flag from any
 * public profile endpoint the backend exposes, then writes the result into
 * {@link identityVerifiedCache} so subsequent renders (ride cards, ratings,
 * chat headers) can show the ✓ badge without re-querying.
 *
 * Why probing exists:
 * - Backend remains SSOT, but `GET /rides` / search payloads do not always
 *   project `publisherIdentityVerified` for every driver. Until that ships
 *   end-to-end, we fan out short-timeout reads against the same public
 *   endpoints already used by ratings / profile screens.
 *
 * Guarantees:
 * - Each user ID is probed at most **once per session** (in-flight + cache
 *   memoization). Duplicate calls return the same Promise.
 * - 4.5s per-route timeout; failures fall through silently. We never throw.
 * - Negative results are recorded too — so a non-verified driver does not get
 *   re-probed every time their card scrolls into view.
 */

import api from './api';
import { API } from '../constants/API';
import {
  isUserIdentityVerifiedCached,
  setUserIdentityVerified,
  userIdentityVerifiedKnown,
} from '../utils/identityVerifiedCache';
import { pickSubjectIdentityVerified } from '../utils/identityVerifiedExtract';

const IN_FLIGHT = new Map<string, Promise<boolean | null>>();

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function probeOnce(userId: string): Promise<boolean | null> {
  const id = userId.trim();
  if (!id) return null;

  const probes: string[] = [
    `/users/${encodeURIComponent(id)}`,
    `/users/${encodeURIComponent(id)}/profile`,
    `/user/${encodeURIComponent(id)}`,
    `${API.endpoints.user.profile}?userId=${encodeURIComponent(id)}`,
    `${API.endpoints.user.profile}?id=${encodeURIComponent(id)}`,
  ];

  const probeMs = 4500;
  const bodies = await Promise.all(
    probes.map((p) =>
      api.getOptional<unknown>(p, { timeout: probeMs }).catch(() => null)
    )
  );

  let anyResponded = false;
  for (const body of bodies) {
    if (body == null) continue;
    anyResponded = true;
    const top = asObject(body) ?? {};
    const nested = asObject(top.data) ?? {};
    const user = asObject(nested.user) ?? asObject(top.user) ?? {};
    if (pickSubjectIdentityVerified(user, nested, top)) {
      return true;
    }
  }

  // We got responses but no positive verification — record as known-not-verified
  // so we don't re-probe this user every render.
  return anyResponded ? false : null;
}

/**
 * Ensure we have the verified flag cached for `userId`. Returns true if known
 * verified at any point during the call, otherwise false. Safe to call from
 * effects on every render — internally deduped.
 */
export async function ensureUserIdentityVerifiedProbed(
  userId: string | null | undefined
): Promise<boolean> {
  if (typeof userId !== 'string') return false;
  const id = userId.trim();
  if (!id) return false;

  if (isUserIdentityVerifiedCached(id)) return true;
  if (userIdentityVerifiedKnown(id)) return false;

  let promise = IN_FLIGHT.get(id);
  if (!promise) {
    promise = probeOnce(id)
      .then((result) => {
        if (result === true) {
          setUserIdentityVerified(id, true);
          return true;
        }
        if (result === false) {
          setUserIdentityVerified(id, false);
          return false;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => {
        IN_FLIGHT.delete(id);
      });
    IN_FLIGHT.set(id, promise);
  }

  const settled = await promise;
  return settled === true;
}

/** Fire-and-forget batch helper for list screens. */
export function warmIdentityVerifiedProbes(userIds: Iterable<string | null | undefined>): void {
  const seen = new Set<string>();
  for (const raw of userIds) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (userIdentityVerifiedKnown(id)) continue;
    void ensureUserIdentityVerifiedProbed(id);
  }
}
