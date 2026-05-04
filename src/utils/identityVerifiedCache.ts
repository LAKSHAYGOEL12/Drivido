/**
 * In-memory cache of user IDs known to be identity-verified, persisted to
 * AsyncStorage so cold starts after the first one render the ✓ badge on the
 * same frame as the avatar (no flicker between "avatar painted" and
 * "tick painted").
 *
 * The backend is the single source of truth, but it does not always project
 * `publisherIdentityVerified` onto every list payload (e.g. `GET /rides`, ride
 * search results). When we *do* learn that a user is verified — via auth
 * (`/auth/me`), ratings (`GET /ratings/:userId`), chat threads, or a successful
 * public profile probe — we remember it here so subsequent renders (ride
 * cards, lists, peer profile, ride detail) can show the ✓ badge without
 * requiring every endpoint to echo the flag.
 *
 * Persistence rules:
 * - We mirror the verified Set into AsyncStorage on every change, debounced so
 *   bulk writes (a list of 50 rides) coalesce into one IO.
 * - We do **not** persist the negative ("known-not-verified") set: an admin
 *   could verify a user later and we'd otherwise stale-cache the negative
 *   answer indefinitely.
 * - Hydration runs at module import; while it's pending, all reads return
 *   their pre-hydration value (false). The moment hydration completes we
 *   `emit()` so every mounted `useIdentityVerifiedCached` subscriber re-renders
 *   and reads the now-populated set on the very next paint.
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@drivido/identityVerifiedUserIds:v1';
const PERSIST_DEBOUNCE_MS = 250;
/**
 * Cap the persisted set so it cannot grow unbounded over months of use.
 * 5000 IDs ≈ ~120 KB on disk — well under AsyncStorage's per-key limits and
 * still enough to cover any realistic per-account universe of seen drivers.
 */
const MAX_PERSISTED_IDS = 5000;

const VERIFIED_USER_IDS = new Set<string>();
const KNOWN_NOT_VERIFIED_USER_IDS = new Set<string>();
const LISTENERS = new Set<() => void>();

let hydrated = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function emit(): void {
  for (const cb of LISTENERS) {
    try {
      cb();
    } catch {
      /* listeners must not break each other */
    }
  }
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistNow();
  }, PERSIST_DEBOUNCE_MS);
}

async function persistNow(): Promise<void> {
  try {
    const ids = Array.from(VERIFIED_USER_IDS);
    const trimmed = ids.length > MAX_PERSISTED_IDS ? ids.slice(-MAX_PERSISTED_IDS) : ids;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* AsyncStorage failures are not user-facing — cache still works in memory */
  }
}

async function hydrateFromStorage(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const v of parsed) {
          if (typeof v === 'string' && v.trim()) VERIFIED_USER_IDS.add(v.trim());
        }
      }
    }
  } catch {
    /* corrupted cache → start fresh, will repopulate from /auth/me + probes */
  }
  hydrated = true;
  // Wake every subscribed component so they re-derive `verified` with the new
  // hydrated state on the very next paint after launch.
  emit();
}

void hydrateFromStorage();

function normalizeId(userId: unknown): string | null {
  if (typeof userId !== 'string') return null;
  const trimmed = userId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Mark a user as identity-verified. No-ops on falsy/empty IDs. */
export function markUserIdentityVerified(userId: string | null | undefined): void {
  const id = normalizeId(userId);
  if (!id) return;
  if (VERIFIED_USER_IDS.has(id)) return;
  VERIFIED_USER_IDS.add(id);
  KNOWN_NOT_VERIFIED_USER_IDS.delete(id);
  schedulePersist();
  emit();
}

/**
 * Record an authoritative verified flag for a user (from a backend payload).
 * Pass `true` to mark verified, `false` to mark known-not-verified (so we stop
 * probing them this session). `undefined` is a no-op.
 */
export function setUserIdentityVerified(
  userId: string | null | undefined,
  verified: boolean | undefined
): void {
  const id = normalizeId(userId);
  if (!id) return;
  if (verified === true) {
    if (!VERIFIED_USER_IDS.has(id)) {
      VERIFIED_USER_IDS.add(id);
      KNOWN_NOT_VERIFIED_USER_IDS.delete(id);
      schedulePersist();
      emit();
    }
    return;
  }
  if (verified === false) {
    const wasVerified = VERIFIED_USER_IDS.has(id);
    if (!KNOWN_NOT_VERIFIED_USER_IDS.has(id) || wasVerified) {
      VERIFIED_USER_IDS.delete(id);
      KNOWN_NOT_VERIFIED_USER_IDS.add(id);
      // Persist only if we removed a previously-verified entry; the negative
      // set itself is intentionally not stored (admins may flip a user later).
      if (wasVerified) schedulePersist();
      emit();
    }
  }
}

/** Synchronous read — true only if we have positive knowledge of verification. */
export function isUserIdentityVerifiedCached(
  userId: string | null | undefined
): boolean {
  const id = normalizeId(userId);
  if (!id) return false;
  return VERIFIED_USER_IDS.has(id);
}

/** True if we already know this user's status (verified or not) — i.e. don't re-probe. */
export function userIdentityVerifiedKnown(userId: string | null | undefined): boolean {
  const id = normalizeId(userId);
  if (!id) return false;
  return VERIFIED_USER_IDS.has(id) || KNOWN_NOT_VERIFIED_USER_IDS.has(id);
}

function subscribe(listener: () => void): () => void {
  LISTENERS.add(listener);
  return () => {
    LISTENERS.delete(listener);
  };
}

/**
 * React hook — returns the current cached verified state for a user ID and
 * re-renders whenever the cache updates. Use as a fallback when the immediate
 * payload (ride, booking, conversation) does not carry the flag.
 */
export function useIdentityVerifiedCached(
  userId: string | null | undefined
): boolean {
  const [, setTick] = useState(0);
  useEffect(() => {
    const unsub = subscribe(() => setTick((n) => (n + 1) & 0x7fffffff));
    return unsub;
  }, []);
  return isUserIdentityVerifiedCached(userId);
}

/** True once the on-disk cache has been merged into memory (or load failed). */
export function identityVerifiedCacheHydrated(): boolean {
  return hydrated;
}

/** Test-only: clear the in-memory cache. Not exported to non-test callers. */
export function __resetIdentityVerifiedCacheForTests(): void {
  VERIFIED_USER_IDS.clear();
  KNOWN_NOT_VERIFIED_USER_IDS.clear();
  emit();
}
