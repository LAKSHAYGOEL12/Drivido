import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { resolveApiBaseOrigin } from '../config/apiBaseUrl';
import {
  getLastNetworkPulse,
  subscribeNetworkPulse,
  type NetworkPulse,
} from '../services/networkHeartbeat';

/**
 * App-wide network state, decided **only by what our own server can do for us**, not by
 * NetInfo's third-party reachability probes (which were the root cause of false-positive
 * "You're offline" banners on captive WiFi, VPN, slow networks, etc.).
 *
 * Three states, deliberately:
 * - `'online'`   — recent positive signal (NetInfo says connected, or our backend / API
 *                  layer answered something within {@link ONLINE_TRUST_WINDOW_MS}).
 * - `'offline'` — sustained negative signal (NetInfo says fully disconnected, OR our own
 *                  backend probe failed twice in a row, OR the API layer just emitted a
 *                  transport-level failure and {@link OFFLINE_DEBOUNCE_MS} elapsed without
 *                  any positive signal).
 * - `'checking'` — uncertain; on first mount, immediately after a transient drop, while
 *                  the backend probe is in flight. UI should NOT show an offline banner
 *                  during `'checking'`.
 *
 * Decision pipeline (every input flows through this state machine):
 * - NetInfo `isConnected: false`           → instant `offline` (OS says no link at all).
 * - API layer emits success pulse          → instant `online`, clears any pending flip.
 * - API layer emits failure pulse          → start debounce → if no success within
 *                                            `OFFLINE_DEBOUNCE_MS`, run backend probe.
 * - NetInfo `isInternetReachable: false`   → run backend probe (don't trust the third-party
 *                                            probe — captive portals, VPN, etc.).
 * - AppState `'active'` after `'background'` → run backend probe (refresh after wake).
 * - In `offline` state                     → backoff probe at 2s → 5s → 15s → 30s.
 *
 * Backend probe targets, in order of preference:
 * 1. `${origin}/api/health` (recommended; tiny no-auth route).
 * 2. `${origin}/health` (fallback if `/api` prefix is mounted differently).
 * 3. HEAD `${origin}/api` (cheap last resort; backend just needs to NOT 5xx).
 *
 * Any one of those returning ANY response (200/204/4xx/even 405 to a HEAD) is positive
 * proof of life and flips us to `online`. Only a `fetch` rejection counts as negative.
 */

export type NetworkStatus = 'online' | 'offline' | 'checking';

export type NetworkContextValue = {
  /** Coarse three-state classification used by the UI. */
  status: NetworkStatus;
  /** True iff status === 'offline'. Convenience alias for screens. */
  isOffline: boolean;
  /** True iff status === 'online'. */
  isOnline: boolean;
  /** True iff status === 'checking'. */
  isChecking: boolean;
  /** Wall-clock timestamp of the last positive signal, or null if we never had one. */
  lastOnlineAt: number | null;
  /**
   * Force an immediate backend probe. Resolves with the resulting status. Useful for
   * pull-to-refresh actions that want to give the user fast feedback.
   */
  forceProbe: () => Promise<NetworkStatus>;
};

const ONLINE_TRUST_WINDOW_MS = 10_000;
const OFFLINE_DEBOUNCE_MS = 1_500;
const PROBE_TIMEOUT_MS = 4_000;
const PROBE_BACKOFF_SCHEDULE_MS = [2_000, 5_000, 15_000, 30_000] as const;

const PROBE_HEALTH_PATHS = ['/api/health', '/health'] as const;

const NetworkContext = createContext<NetworkContextValue | null>(null);

type ProbeOutcome = 'reachable' | 'unreachable' | 'unknown';

/**
 * Run a single backend reachability probe. Resolves to:
 * - `'reachable'` — any HTTP response from our origin (proof of life).
 * - `'unreachable'` — `fetch` rejected (DNS, abort, socket reset, network failed).
 * - `'unknown'` — base origin not configured; we can't decide on our own and should defer
 *   to NetInfo / API pulses instead.
 */
async function probeBackendOnce(): Promise<ProbeOutcome> {
  const origin = resolveApiBaseOrigin();
  if (!origin) return 'unknown';

  const tryFetch = async (
    url: string,
    method: 'GET' | 'HEAD'
  ): Promise<ProbeOutcome> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      // We don't care about the body — even a 4xx/405 from a HEAD on `/api` proves the
      // socket made it to our server. Pair our `cache: 'no-store'` with the backend's
      // `Cache-Control: no-store` so iOS URLSession / Android OkHttp / corporate proxies
      // never serve a stale 200 while the server is actually down.
      await fetch(url, {
        method,
        signal: controller.signal,
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
      return 'reachable';
    } catch {
      return 'unreachable';
    } finally {
      clearTimeout(timer);
    }
  };

  for (const path of PROBE_HEALTH_PATHS) {
    const outcome = await tryFetch(`${origin}${path}`, 'GET');
    if (outcome === 'reachable') return 'reachable';
    // If unreachable, keep trying the next variant — origin might still be up but the
    // path 404 might still classify as 'reachable' in the next branch. We only treat
    // ALL fallbacks failing as unreachable.
  }

  return tryFetch(`${origin}/api`, 'HEAD');
}

type ProviderProps = {
  children: React.ReactNode;
};

export function NetworkProvider({ children }: ProviderProps): React.JSX.Element {
  const [status, setStatus] = useState<NetworkStatus>('checking');
  const [lastOnlineAt, setLastOnlineAt] = useState<number | null>(null);

  const statusRef = useRef<NetworkStatus>('checking');
  const lastOnlineAtRef = useRef<number | null>(null);
  const offlineFlipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffIndexRef = useRef<number>(0);
  const inFlightProbeRef = useRef<Promise<NetworkStatus> | null>(null);
  const lastNetInfoRef = useRef<{
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
  }>({ isConnected: null, isInternetReachable: null });

  const writeStatus = useCallback((next: NetworkStatus) => {
    statusRef.current = next;
    setStatus(next);
    if (next === 'online') {
      const ts = Date.now();
      lastOnlineAtRef.current = ts;
      setLastOnlineAt(ts);
    }
  }, []);

  const clearPendingOfflineFlip = useCallback(() => {
    if (offlineFlipTimerRef.current) {
      clearTimeout(offlineFlipTimerRef.current);
      offlineFlipTimerRef.current = null;
    }
  }, []);

  const clearBackoff = useCallback(() => {
    if (backoffTimerRef.current) {
      clearTimeout(backoffTimerRef.current);
      backoffTimerRef.current = null;
    }
    backoffIndexRef.current = 0;
  }, []);

  const goOnline = useCallback(() => {
    clearPendingOfflineFlip();
    clearBackoff();
    writeStatus('online');
  }, [clearBackoff, clearPendingOfflineFlip, writeStatus]);

  const goOffline = useCallback(() => {
    clearPendingOfflineFlip();
    writeStatus('offline');
    // Fall through — caller decides whether to schedule backoff probe.
  }, [clearPendingOfflineFlip, writeStatus]);

  const goChecking = useCallback(() => {
    if (statusRef.current === 'online') {
      // Don't downgrade from online → checking on transient blips; the trust window
      // protects against flicker. We'll go offline after the debounce only if confirmed.
      return;
    }
    writeStatus('checking');
  }, [writeStatus]);

  /**
   * Single entry point for "let me verify and update status from a backend probe".
   * Coalesces concurrent callers so a screen pull-to-refresh + a NetInfo blip don't
   * issue two probes at once.
   */
  const runProbe = useCallback((): Promise<NetworkStatus> => {
    if (inFlightProbeRef.current) return inFlightProbeRef.current;
    const p = (async () => {
      const outcome = await probeBackendOnce();
      if (outcome === 'reachable') {
        goOnline();
        return 'online' as const;
      }
      if (outcome === 'unreachable') {
        goOffline();
        return 'offline' as const;
      }
      // Origin not configured — fall back to whatever NetInfo last said.
      const ni = lastNetInfoRef.current;
      if (ni.isConnected === false) {
        goOffline();
        return 'offline' as const;
      }
      goOnline();
      return 'online' as const;
    })();
    inFlightProbeRef.current = p;
    p.finally(() => {
      inFlightProbeRef.current = null;
    });
    return p;
  }, [goOffline, goOnline]);

  /** Schedule the next backoff probe while we sit in `offline`. Cleared on any positive signal. */
  const scheduleBackoffProbe = useCallback(() => {
    if (backoffTimerRef.current) return;
    const idx = Math.min(backoffIndexRef.current, PROBE_BACKOFF_SCHEDULE_MS.length - 1);
    const delay = PROBE_BACKOFF_SCHEDULE_MS[idx];
    backoffTimerRef.current = setTimeout(() => {
      backoffTimerRef.current = null;
      backoffIndexRef.current = idx + 1;
      void runProbe().then((next) => {
        if (next === 'offline') scheduleBackoffProbe();
      });
    }, delay);
  }, [runProbe]);

  /** Pulse from `api.ts` after a real fetch outcome. Fast path; no probes here. */
  const handlePulse = useCallback(
    (pulse: NetworkPulse) => {
      if (pulse.kind === 'success') {
        goOnline();
        return;
      }
      // Failure pulse: don't immediately flip to offline — debounce. A burst of 401s
      // from a stale token still counts as transport success; only true `fetch` errors
      // emit failure. Even then, give it a moment in case it was a cosmic-ray flake.
      goChecking();
      clearPendingOfflineFlip();
      offlineFlipTimerRef.current = setTimeout(() => {
        offlineFlipTimerRef.current = null;
        // After debounce, verify with a backend probe before flipping the UI to offline.
        void runProbe().then((next) => {
          if (next === 'offline') scheduleBackoffProbe();
        });
      }, OFFLINE_DEBOUNCE_MS);
    },
    [clearPendingOfflineFlip, goChecking, goOnline, runProbe, scheduleBackoffProbe]
  );

  /** Apply a NetInfo state update through the same decision pipeline. */
  const handleNetInfo = useCallback(
    (s: NetInfoState) => {
      lastNetInfoRef.current = {
        isConnected: s.isConnected,
        isInternetReachable: s.isInternetReachable,
      };

      // OS-level "no link at all" → instantly offline (no debounce — this is reliable).
      if (s.isConnected === false) {
        goOffline();
        scheduleBackoffProbe();
        return;
      }

      // OS link present, NetInfo's third-party reachability check failed → DON'T trust
      // it. Run our own backend probe; only flip on its result.
      if (s.isInternetReachable === false) {
        goChecking();
        void runProbe().then((next) => {
          if (next === 'offline') scheduleBackoffProbe();
        });
        return;
      }

      // OS says connected and reachable (or reachability still null = "checking") and we
      // had a recent positive signal → trust it.
      const last = lastOnlineAtRef.current;
      if (last !== null && Date.now() - last < ONLINE_TRUST_WINDOW_MS) {
        goOnline();
        return;
      }

      // First successful NetInfo event in a while — verify with a probe before promising
      // online to the UI. Until the probe answers, stay in 'checking'.
      goChecking();
      void runProbe().then((next) => {
        if (next === 'offline') scheduleBackoffProbe();
      });
    },
    [goChecking, goOffline, goOnline, runProbe, scheduleBackoffProbe]
  );

  /** Subscribe to NetInfo + API heartbeat once. */
  useEffect(() => {
    let mounted = true;

    // Replay the most recent pulse the API layer recorded *before* this provider mounted
    // (auth restore, splash-time fetches, etc.) so we don't sit in 'checking' until the
    // first network event fires.
    const initialPulse = getLastNetworkPulse();
    if (initialPulse) handlePulse(initialPulse);

    const unsubscribePulse = subscribeNetworkPulse((p) => {
      if (!mounted) return;
      handlePulse(p);
    });

    const unsubscribeNet = NetInfo.addEventListener((s) => {
      if (!mounted) return;
      handleNetInfo(s);
    });

    void NetInfo.fetch().then((s) => {
      if (!mounted) return;
      handleNetInfo(s);
    });

    return () => {
      mounted = false;
      unsubscribePulse();
      unsubscribeNet();
      clearPendingOfflineFlip();
      clearBackoff();
    };
  }, [clearBackoff, clearPendingOfflineFlip, handleNetInfo, handlePulse]);

  /** When the app comes back to foreground, immediately re-verify so the user doesn't see stale offline UI. */
  useEffect(() => {
    let prev: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && prev !== 'active') {
        void NetInfo.fetch().then((s) => handleNetInfo(s));
      }
      prev = next;
    });
    return () => sub.remove();
  }, [handleNetInfo]);

  const forceProbe = useCallback(() => runProbe(), [runProbe]);

  const value = useMemo<NetworkContextValue>(
    () => ({
      status,
      isOffline: status === 'offline',
      isOnline: status === 'online',
      isChecking: status === 'checking',
      lastOnlineAt,
      forceProbe,
    }),
    [forceProbe, lastOnlineAt, status]
  );

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

/**
 * Read the app-wide network status. Always returns a value — when the provider is not
 * mounted (which should never happen in production, but can happen in tests / Storybook),
 * falls back to a permissive `'online'` shape so callers don't accidentally render offline
 * UI just because the provider wasn't wrapped.
 */
export function useNetworkStatus(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (ctx) return ctx;
  return {
    status: 'online',
    isOffline: false,
    isOnline: true,
    isChecking: false,
    lastOnlineAt: null,
    forceProbe: async () => 'online' as const,
  };
}
