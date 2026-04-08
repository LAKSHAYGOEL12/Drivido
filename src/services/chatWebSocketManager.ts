interface WSMessage {
  type: 'chat_message' | 'subscribe_ack' | 'error' | 'pong';
  data?: any;
  error?: string;
  threadKey?: string;
}

class ChatWebSocketManager {
  private ws: WebSocket | null = null;
  private url: string = '';
  private token: string = '';
  private subscriptions = new Map<string, (msg: any) => void>();
  private subscriptionParams = new Map<string, { rideId?: string; otherUserId?: string }>();
  private pendingSubscribeQueue: string[] = [];
  private invalidThreadKeys = new Set<string>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  /** Single heartbeat interval; cleared on close / reconnect / disconnect. */
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatStartTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isManualDisconnect = false;
  private connectionListeners = new Set<(connected: boolean) => void>();
  private orphanMessageListener: ((msg: WSMessage) => void) | null = null;
  /** Serialize subscribe frames so we do not burst N messages in one tick (some servers/RN stacks choke). */
  private subscribeSendQueue: string[] = [];
  private subscribeSendTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly SUBSCRIBE_SEND_GAP_MS = 80;
  /** Last close looked like a server/protocol fault — back off hard instead of tight reconnect loops. */
  private lastCloseSuggestedServerBug = false;

  private emitConnectionState(connected: boolean) {
    this.connectionListeners.forEach((listener) => {
      try {
        listener(connected);
      } catch (e) {
        console.error('[WS] Connection listener error:', e);
      }
    });
  }

  private normalizeThreadKey(key: string): string {
    return String(key ?? '')
      .split('|')
      .map((p) => p.trim())
      .filter(Boolean)
      .sort()
      .join('|');
  }

  private pickFallbackThreadKeyForMessage(msg: WSMessage): string | null {
    const rawThreadKey = String(msg.threadKey ?? '').trim();
    if (rawThreadKey && this.subscriptions.has(rawThreadKey)) return rawThreadKey;

    if (rawThreadKey) {
      const normalizedIncoming = this.normalizeThreadKey(rawThreadKey);
      for (const key of this.subscriptions.keys()) {
        if (this.normalizeThreadKey(key) === normalizedIncoming) {
          return key;
        }
      }
    }

    const data = (msg.data ?? {}) as Record<string, unknown>;
    const rideId = String(data.rideId ?? '').trim();
    const senderUserId = String(data.senderUserId ?? data.fromUserId ?? '').trim();
    const receiverUserId = String(data.receiverUserId ?? data.toUserId ?? '').trim();

    if (rideId && (senderUserId || receiverUserId)) {
      for (const [key, params] of this.subscriptionParams.entries()) {
        const subRideId = String(params.rideId ?? '').trim();
        const subOtherId = String(params.otherUserId ?? '').trim();
        if (!subRideId || !subOtherId) continue;
        if (subRideId !== rideId) continue;
        if (subOtherId === senderUserId || subOtherId === receiverUserId) {
          return key;
        }
      }
    }

    return null;
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearSubscribeSendTimer() {
    if (this.subscribeSendTimer) {
      clearTimeout(this.subscribeSendTimer);
      this.subscribeSendTimer = null;
    }
  }

  /** One subscribe JSON frame every SUBSCRIBE_SEND_GAP_MS while queue non-empty. */
  private scheduleSubscribeDrain() {
    if (this.subscribeSendTimer) return;
    const step = () => {
      this.subscribeSendTimer = null;
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      const threadKey = this.subscribeSendQueue.shift();
      if (threadKey) {
        this.sendSubscribeNow(threadKey);
      }
      if (this.subscribeSendQueue.length > 0) {
        this.subscribeSendTimer = setTimeout(step, ChatWebSocketManager.SUBSCRIBE_SEND_GAP_MS);
      }
    };
    this.subscribeSendTimer = setTimeout(step, 0);
  }

  private enqueueSubscribeSend(threadKey: string) {
    if (!this.subscribeSendQueue.includes(threadKey)) {
      this.subscribeSendQueue.push(threadKey);
    }
    this.scheduleSubscribeDrain();
  }

  /**
   * One global connection. Idempotent for same URL+token while OPEN/CONNECTING.
   * Tears down an existing socket before opening a new one (token/URL change or recovery).
   */
  connect(wsUrl: string, token: string) {
    /** New intentional connect (e.g. after login) overrides a prior `disconnect()`. */
    this.isManualDisconnect = false;

    const sameTarget = this.url === wsUrl && this.token === token;
    if (sameTarget && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    if (sameTarget && this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.clearReconnectTimer();
    this.url = wsUrl;
    this.token = token;
    this.isManualDisconnect = false;

    if (this.ws) {
      this.stopHeartbeat();
      this.clearSubscribeSendTimer();
      this.subscribeSendQueue = [];
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }

    this.attemptConnect();
  }

  private attemptConnect() {
    if (this.isManualDisconnect) {
      return;
    }

    if (this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    try {
      const wsUrl = `${this.url}?token=${this.token}`;
      if (__DEV__) {
        console.log('[WS] Connecting:', this.url, '(token len', this.token.length, ')');
      }

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        if (__DEV__) console.log('[WS] Connected');
        this.reconnectAttempts = 0;
        this.lastCloseSuggestedServerBug = false;
        /** After open, wait before app-level pings so subscribe burst finishes first. */
        this.startHeartbeatDeferred();
        this.emitConnectionState(true);

        this.subscriptions.forEach((_, threadKey) => {
          this.enqueueSubscribeSend(threadKey);
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data);

          if (msg.type === 'pong') {
            // Heartbeat response - no action needed
            return;
          }

          if (msg.type === 'chat_message' && msg.data) {
            // Route message to subscribed threads
            const matchedThreadKey = this.pickFallbackThreadKeyForMessage(msg);
            if (matchedThreadKey && this.subscriptions.has(matchedThreadKey)) {
              const callback = this.subscriptions.get(matchedThreadKey);
              callback?.(msg.data);
            } else if (this.subscriptions.size === 1) {
              // Single subscription - deliver to it regardless
              const callback = this.subscriptions.values().next().value;
              callback?.(msg.data);
            } else {
              console.warn('[WS] Dropped chat_message: no matching subscription', {
                threadKey: msg.threadKey,
                rideId: msg.data?.rideId,
                senderUserId: msg.data?.senderUserId,
              });
              this.orphanMessageListener?.(msg);
            }
          }

          if (msg.type === 'subscribe_ack') {
            if (msg.threadKey) {
              this.pendingSubscribeQueue = this.pendingSubscribeQueue.filter((k) => k !== msg.threadKey);
            }
            if (__DEV__) console.log('[WS] Subscribed:', msg.threadKey);
          }

          if (msg.type === 'error') {
            const errText = String(msg.error ?? '');
            const normalizedError = errText.toLowerCase();
            const isBenignSubscribe =
              normalizedError.includes('invalid request') || normalizedError.includes('forbidden');
            if (isBenignSubscribe) {
              console.warn('[WS] Server error:', errText, msg.threadKey ? `(threadKey: ${msg.threadKey})` : '');
            } else {
              console.error('[WS] Server error:', errText);
            }
            // Only quarantine when server tells us which thread failed (avoid wrong key on generic errors).
            const failedKey = typeof msg.threadKey === 'string' && msg.threadKey.trim() ? msg.threadKey.trim() : '';
            if (
              failedKey &&
              (normalizedError.includes('invalid request') || normalizedError.includes('forbidden'))
            ) {
              this.invalidThreadKeys.add(failedKey);
              this.subscriptions.delete(failedKey);
              this.subscriptionParams.delete(failedKey);
              this.pendingSubscribeQueue = this.pendingSubscribeQueue.filter((k) => k !== failedKey);
              console.warn('[WS] Quarantined thread after server error:', failedKey);
            }
          }
        } catch (e) {
          console.error('[WS] Parse error:', e);
        }
      };

      this.ws.onerror = () => {
        /** Never log the Event object — RN attaches socket URL with JWT. */
        const rs = this.ws?.readyState;
        if (__DEV__) console.warn('[WS] Error (readyState=', rs, ')');
      };

      this.ws.onclose = (event: CloseEvent) => {
        const reason = String(event.reason ?? '').trim();
        const code = event.code;
        this.lastCloseSuggestedServerBug =
          code === 1006 || reason.toLowerCase().includes('control frames must be final');
        if (__DEV__) {
          console.log('[WS] Closed code=', code, reason ? `reason="${reason}"` : '');
        }
        this.stopHeartbeat();
        this.clearSubscribeSendTimer();
        this.subscribeSendQueue = [];
        this.emitConnectionState(false);
        this.ws = null;

        if (!this.isManualDisconnect) {
          this.attemptReconnect();
        }
      };
    } catch (error) {
      console.error('[WS] ❌ Connection error:', error);
      this.attemptReconnect();
    }
  }

  private attemptReconnect() {
    this.clearReconnectTimer();
    if (this.isManualDisconnect) return;
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      let delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      /** Server/protocol closes will repeat until the server is fixed — avoid hammering. */
      if (this.lastCloseSuggestedServerBug) {
        delay = Math.max(delay, 15_000);
      }
      if (__DEV__) {
        console.log(`[WS] Reconnect in ${delay}ms (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      }
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.attemptConnect();
      }, delay);
    } else if (__DEV__) {
      console.warn('[WS] Max reconnects — chat will use HTTP until next app open or login');
    }
  }

  /** App-level JSON ping only if your server expects it; delayed so it does not race subscribe burst. */
  private startHeartbeatDeferred() {
    this.stopHeartbeat();
    const firstPingMs = 45_000;
    const intervalMs = 90_000;
    this.heartbeatStartTimeout = setTimeout(() => {
      this.heartbeatStartTimeout = null;
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      const tick = () => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          try {
            this.ws.send(JSON.stringify({ type: 'ping' }));
          } catch {
            // ignore
          }
        }
      };
      tick();
      this.heartbeatInterval = setInterval(tick, intervalMs);
    }, firstPingMs);
  }

  private stopHeartbeat() {
    if (this.heartbeatStartTimeout) {
      clearTimeout(this.heartbeatStartTimeout);
      this.heartbeatStartTimeout = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /** Immediate send (internal); prefer `sendSubscribe` which queues when socket is open. */
  private sendSubscribeNow(threadKey: string) {
    if (this.invalidThreadKeys.has(threadKey)) {
      return;
    }
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      const params = this.subscriptionParams.get(threadKey) || {};
      const rideId = String(params.rideId ?? '').trim();
      const otherUserId = String(params.otherUserId ?? '').trim();
      if (!rideId || !otherUserId) {
        if (__DEV__) {
          console.warn('[WS] Skip subscribe — missing rideId/otherUserId for thread:', threadKey);
        }
        return;
      }
      if (!this.pendingSubscribeQueue.includes(threadKey)) {
        this.pendingSubscribeQueue.push(threadKey);
      }
      this.ws.send(
        JSON.stringify({
          type: 'subscribe',
          threadKey,
          rideId,
          otherUserId,
        })
      );
    } catch (e) {
      if (__DEV__) console.error('[WS] Subscribe send error:', e);
    }
  }

  private sendSubscribe(threadKey: string) {
    if (this.invalidThreadKeys.has(threadKey)) {
      if (__DEV__) console.warn('[WS] Skipping quarantined thread:', threadKey);
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.enqueueSubscribeSend(threadKey);
    }
  }

  subscribe(threadKey: string, callback: (msg: any) => void, params?: { rideId?: string; otherUserId?: string }) {
    if (this.invalidThreadKeys.has(threadKey)) {
      if (__DEV__) console.warn('[WS] Ignoring subscribe for quarantined thread:', threadKey);
      return;
    }
    const rideId = String(params?.rideId ?? '').trim();
    const otherUserId = String(params?.otherUserId ?? '').trim();
    if (!rideId || !otherUserId) {
      if (__DEV__) {
        console.warn('[WS] Ignoring subscribe — invalid params for thread:', threadKey);
      }
      return;
    }
    this.subscriptions.set(threadKey, callback);
    this.subscriptionParams.set(threadKey, { rideId, otherUserId });
    if (__DEV__) {
      console.log(`[WS] Register thread (${this.subscriptions.size}):`, threadKey.slice(0, 48) + (threadKey.length > 48 ? '…' : ''));
    }
    this.sendSubscribe(threadKey);
  }

  unsubscribe(threadKey: string) {
    this.subscriptions.delete(threadKey);
    this.subscriptionParams.delete(threadKey);
    this.pendingSubscribeQueue = this.pendingSubscribeQueue.filter((k) => k !== threadKey);
    this.subscribeSendQueue = this.subscribeSendQueue.filter((k) => k !== threadKey);
    if (__DEV__) {
      console.log('[WS] Unregister thread (remaining:', this.subscriptions.size, ')');
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          type: 'unsubscribe',
          threadKey,
        }));
      } catch (e) {
        if (__DEV__) console.error('[WS] Unsubscribe send error:', e);
      }
    }
  }

  disconnect() {
    if (__DEV__) console.log('[WS] Disconnect (manual)');
    this.isManualDisconnect = true;
    this.clearReconnectTimer();
    this.clearSubscribeSendTimer();
    this.subscribeSendQueue = [];
    this.reconnectAttempts = 0;
    this.stopHeartbeat();
    this.subscriptions.clear();
    this.subscriptionParams.clear();
    this.pendingSubscribeQueue = [];
    this.invalidThreadKeys.clear();
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        console.error('[WS] Close error:', e);
      }
      this.ws = null;
    }
    this.emitConnectionState(false);
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getConnectionStatus(): string {
    if (!this.ws) return 'DISCONNECTED';
    if (this.ws.readyState === WebSocket.CONNECTING) return 'CONNECTING';
    if (this.ws.readyState === WebSocket.OPEN) return 'CONNECTED';
    if (this.ws.readyState === WebSocket.CLOSING) return 'CLOSING';
    if (this.ws.readyState === WebSocket.CLOSED) return 'CLOSED';
    return 'UNKNOWN';
  }

  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.add(listener);
    listener(this.isConnected());
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  onOrphanMessage(listener: ((msg: WSMessage) => void) | null): void {
    this.orphanMessageListener = listener;
  }
}

export const chatWSManager = new ChatWebSocketManager();
