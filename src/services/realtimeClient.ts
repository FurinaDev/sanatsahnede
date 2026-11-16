import { getSessionToken } from './api';
import { RealtimeEvent } from '../types';

export type RealtimeListener = (event: RealtimeEvent) => void;

class RealtimeClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<RealtimeListener>();
  private statusListeners = new Set<(connected: boolean) => void>();
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private shouldConnect = false;
  private reconnectAttempts = 0;
  private connected = false;

  subscribe(listener: RealtimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeStatus(listener: (connected: boolean) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.connected);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setConnected(next: boolean) {
    if (this.connected === next) return;
    this.connected = next;
    for (const cb of this.statusListeners) {
      cb(next);
    }
  }

  connect() {
    if (typeof window === 'undefined') return;
    this.shouldConnect = true;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getSessionToken();
    const url = `${proto}//${window.location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;

    try {
      const socket = new WebSocket(url);
      this.ws = socket;

      socket.onopen = () => {
        this.reconnectAttempts = 0;
        this.setConnected(true);
        this.startPing();
      };

      socket.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data) as RealtimeEvent;
          if (!parsed || typeof parsed.type !== 'string') return;
          for (const listener of this.listeners) {
            listener(parsed);
          }
        } catch {
          // ignore malformed event payload
        }
      };

      socket.onclose = () => {
        this.stopPing();
        this.ws = null;
        this.setConnected(false);
        if (this.shouldConnect) {
          this.scheduleReconnect();
        }
      };

      socket.onerror = () => {
        // onclose handles cleanup and reconnect backoff
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  disconnect() {
    this.shouldConnect = false;
    this.stopPing();
    if (this.reconnectTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, 'Client disconnect');
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.setConnected(false);
  }

  sendTyping(conversationId: string, isTyping: boolean) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(
        JSON.stringify({
          type: 'typing',
          payload: { conversationId, isTyping },
        })
      );
    } catch {
      // ignore transient socket error
    }
  }

  subscribeCommunity(communityId: string) {
    if (!communityId || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(
        JSON.stringify({
          type: 'community:subscribe',
          payload: { communityId },
        })
      );
    } catch {
      // ignore
    }
  }

  unsubscribeCommunity(communityId: string) {
    if (!communityId || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(
        JSON.stringify({
          type: 'community:unsubscribe',
          payload: { communityId },
        })
      );
    } catch {
      // ignore
    }
  }

  private startPing() {
    this.stopPing();
    if (typeof window === 'undefined') return;
    this.pingTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          // ignore
        }
      }
    }, 25_000);
  }

  private stopPing() {
    if (this.pingTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect() {
    if (!this.shouldConnect || typeof window === 'undefined') return;
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(15_000, 1000 * Math.pow(2, this.reconnectAttempts));
    this.reconnectAttempts = Math.min(this.reconnectAttempts + 1, 5);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldConnect) {
        this.connect();
      }
    }, delay);
  }
}

export const realtimeClient = new RealtimeClient();
