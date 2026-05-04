/**
 * Tiny module-level pub/sub the API layer pings whenever it observes proof that the
 * network is currently usable.
 *
 * "Proof of life" sources today:
 * - {@link emitNetworkSuccess}: a real `fetch` returned ANY HTTP status (including 4xx/5xx —
 *   a 401 from /auth still proves transport works, which is what `NetworkProvider` cares
 *   about).
 * - {@link emitNetworkFailure}: a real `fetch` rejected with a transport-level error (DNS,
 *   socket reset, abort, "Network request failed", …). This is the *only* signal that
 *   should ever push the status toward `offline` from the API side.
 *
 * `NetworkProvider` subscribes via {@link subscribeNetworkPulse}. Keeping this isolated
 * from React (no hooks, no context) means `api.ts` can pulse from any call site, including
 * pre-mount auth-restore requests, without prop-drilling or circular imports.
 */

export type NetworkPulseKind = 'success' | 'failure';

export type NetworkPulse = {
  kind: NetworkPulseKind;
  at: number;
};

type Listener = (pulse: NetworkPulse) => void;

const listeners = new Set<Listener>();
let lastPulse: NetworkPulse | null = null;

/** Subscribe to every subsequent network pulse. Returns an `unsubscribe` function. */
export function subscribeNetworkPulse(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Latest pulse observed by the API layer (null until the first request completes). */
export function getLastNetworkPulse(): NetworkPulse | null {
  return lastPulse;
}

function emit(kind: NetworkPulseKind): void {
  const pulse: NetworkPulse = { kind, at: Date.now() };
  lastPulse = pulse;
  listeners.forEach((l) => {
    try {
      l(pulse);
    } catch {
      // A listener should never break the API hot path.
    }
  });
}

/** Call after any HTTP response that proves transport works (any status, including 4xx/5xx). */
export function emitNetworkSuccess(): void {
  emit('success');
}

/**
 * Call only when `fetch` itself rejected with a transport-level error (DNS, socket reset,
 * abort, "Network request failed"). HTTP error statuses are NOT failures here.
 */
export function emitNetworkFailure(): void {
  emit('failure');
}
