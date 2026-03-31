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
  private heartbeatTimeout: NodeJS.Timeout | null = null;
  private isManualDisconnect = false;
  private connectionListeners = new Set<(connected: boolean) => void>();

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

  connect(wsUrl: string, token: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WS] Already connected');
      return;
    }

    this.url = wsUrl;
    this.token = token;
    this.isManualDisconnect = false;
    this.attemptConnect();
  }

  private attemptConnect() {
    if (this.isManualDisconnect) {
      console.log('[WS] Manual disconnect in progress, skipping reconnect');
      return;
    }

    try {
      const wsUrl = `${this.url}?token=${this.token}`;
      console.log('[WS] Attempting to connect to:', wsUrl.replace(this.token, '***'));
      console.log('[WS] Full URL:', this.url);
      console.log('[WS] Token length:', this.token.length);
      
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WS] ✅ Connected successfully');
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.emitConnectionState(true);

        // Resubscribe to all threads after reconnection
        this.subscriptions.forEach((_, threadKey) => {
          this.sendSubscribe(threadKey);
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
            }
          }

          if (msg.type === 'subscribe_ack') {
            if (msg.threadKey) {
              this.pendingSubscribeQueue = this.pendingSubscribeQueue.filter((k) => k !== msg.threadKey);
            }
            console.log('[WS] ✅ Subscribed to thread:', msg.threadKey);
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

      this.ws.onerror = (event: Event) => {
        console.error('[WS] ❌ WebSocket error:', event);
        console.error('[WS] Connection state:', this.ws?.readyState);
        if (this.ws?.readyState === WebSocket.CLOSED) {
          console.error('[WS] Connection was closed');
        }
      };

      this.ws.onclose = (event: CloseEvent) => {
        console.log('[WS] ❌ Disconnected (code:', event.code, 'reason:', event.reason, ')');
        this.stopHeartbeat();
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
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      setTimeout(() => this.attemptConnect(), delay);
    } else {
      console.warn('[WS] Max reconnect attempts reached, falling back to HTTP polling');
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimeout = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch (e) {
          console.error('[WS] Heartbeat send error:', e);
        }
      }
    }, 30000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimeout) {
      clearInterval(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  private sendSubscribe(threadKey: string) {
    if (this.invalidThreadKeys.has(threadKey)) {
      console.warn('[WS] Skipping quarantined thread:', threadKey);
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
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
        console.error('[WS] Subscribe send error:', e);
      }
    }
  }

  subscribe(threadKey: string, callback: (msg: any) => void, params?: { rideId?: string; otherUserId?: string }) {
    if (this.invalidThreadKeys.has(threadKey)) {
      console.warn('[WS] Ignoring subscribe for quarantined thread:', threadKey);
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
    console.log(`[WS] Subscribed to thread: ${threadKey} (total subscriptions: ${this.subscriptions.size})`);
    this.sendSubscribe(threadKey);
  }

  unsubscribe(threadKey: string) {
    this.subscriptions.delete(threadKey);
    this.subscriptionParams.delete(threadKey);
    this.pendingSubscribeQueue = this.pendingSubscribeQueue.filter((k) => k !== threadKey);
    console.log(`[WS] Unsubscribed from thread: ${threadKey} (remaining subscriptions: ${this.subscriptions.size})`);

    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          type: 'unsubscribe',
          threadKey,
        }));
      } catch (e) {
        console.error('[WS] Unsubscribe send error:', e);
      }
    }
  }

  disconnect() {
    console.log('[WS] Manually disconnecting');
    this.isManualDisconnect = true;
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
}

export const chatWSManager = new ChatWebSocketManager();
