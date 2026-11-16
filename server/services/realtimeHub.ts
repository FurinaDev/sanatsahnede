import crypto from 'crypto';
import type http from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import { DbInstance, parseJson } from '../db/database';
import { getSessionSecret, verifySignedValue } from '../utils/crypto';
import { SESSION_COOKIE_NAME, rowToUser } from '../middleware/auth';
import { isBlockedBetween } from './socialGraphService';
import { User } from '../../src/types';

export interface RealtimeHub {
  attachToServer: (server: http.Server) => void;
  sendToUser: (userId: string, event: { type: string; payload: any }) => void;
  sendToUsers: (userIds: string[], event: { type: string; payload: any }) => void;
  sendToCommunity: (communityId: string, memberUserIds: string[], event: { type: string; payload: any }) => void;
  isUserOnline: (userId: string) => boolean;
  getOnlineUserIds: () => string[];
  closeAll: () => void;
}

const dbHubMap = new WeakMap<DbInstance, RealtimeHub>();

export function registerDbRealtimeHub(db: DbInstance, hub: RealtimeHub): void {
  dbHubMap.set(db, hub);
}

export function getDbRealtimeHub(db: DbInstance): RealtimeHub | undefined {
  return dbHubMap.get(db);
}

function parseCookiesHeader(cookieHeader?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

function authenticateUpgradeRequest(db: DbInstance, req: http.IncomingMessage): User | null {
  try {
    const baseUrl = `http://${req.headers.host || 'localhost'}`;
    const parsedUrl = new URL(req.url || '/', baseUrl);
    const queryToken = parsedUrl.searchParams.get('token') || '';
    const cookies = parseCookiesHeader(req.headers.cookie);
    const rawCookie = cookies[SESSION_COOKIE_NAME] || queryToken;
    if (!rawCookie) return null;

    const token = verifySignedValue(rawCookie, getSessionSecret());
    if (!token) return null;

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const session = db
      .prepare('SELECT id, user_id, expires_at FROM sessions WHERE token_hash = ?')
      .get(tokenHash) as { id: string; user_id: string; expires_at: string } | undefined;

    if (!session || new Date(session.expires_at).getTime() < Date.now()) {
      return null;
    }

    const userRow = db
      .prepare('SELECT * FROM users WHERE id = ? AND status = ?')
      .get(session.user_id, 'active') as any;

    return userRow ? rowToUser(userRow) : null;
  } catch {
    return null;
  }
}

export function createRealtimeHub(db: DbInstance): RealtimeHub {
  const wss = new WebSocketServer({ noServer: true });
  const userSockets = new Map<string, Set<WebSocket>>();
  const socketToUser = new Map<WebSocket, User>();
  const communitySockets = new Map<string, Set<WebSocket>>();
  const attachedServers = new WeakSet<http.Server>();

  const sendRaw = (ws: WebSocket, event: { type: string; payload: any }) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(
        JSON.stringify({
          type: event.type,
          payload: event.payload,
          timestamp: new Date().toISOString(),
        })
      );
    } catch {
      // ignore transient closed socket write errors
    }
  };

  const sendToUser = (userId: string, event: { type: string; payload: any }) => {
    const sockets = userSockets.get(userId);
    if (!sockets || sockets.size === 0) return;
    for (const ws of sockets) {
      sendRaw(ws, event);
    }
  };

  const sendToUsers = (userIds: string[], event: { type: string; payload: any }) => {
    const unique = new Set(userIds.filter(Boolean));
    for (const uid of unique) {
      sendToUser(uid, event);
    }
  };

  const sendToCommunity = (
    communityId: string,
    memberUserIds: string[],
    event: { type: string; payload: any }
  ) => {
    const delivered = new Set<WebSocket>();
    const roomSockets = communitySockets.get(communityId);
    if (roomSockets) {
      for (const ws of roomSockets) {
        if (!delivered.has(ws)) {
          delivered.add(ws);
          sendRaw(ws, event);
        }
      }
    }
    for (const uid of new Set(memberUserIds.filter(Boolean))) {
      const sockets = userSockets.get(uid);
      if (!sockets) continue;
      for (const ws of sockets) {
        if (!delivered.has(ws)) {
          delivered.add(ws);
          sendRaw(ws, event);
        }
      }
    }
  };

  const broadcastAll = (event: { type: string; payload: any }, excludeUserId?: string) => {
    for (const [uid, sockets] of userSockets.entries()) {
      if (excludeUserId && uid === excludeUserId) continue;
      for (const ws of sockets) {
        sendRaw(ws, event);
      }
    }
  };

  const isUserOnline = (userId: string) => {
    const set = userSockets.get(userId);
    return Boolean(set && set.size > 0);
  };

  const getOnlineUserIds = () => Array.from(userSockets.keys());

  wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, user: User) => {
    socketToUser.set(ws, user);
    let set = userSockets.get(user.id);
    const wasOffline = !set || set.size === 0;
    if (!set) {
      set = new Set();
      userSockets.set(user.id, set);
    }
    set.add(ws);

    sendRaw(ws, {
      type: 'ws:connected',
      payload: {
        userId: user.id,
        onlineUserIds: getOnlineUserIds(),
      },
    });

    if (wasOffline) {
      broadcastAll(
        {
          type: 'presence:update',
          payload: { userId: user.id, isOnline: true },
        },
        user.id
      );
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (!msg || typeof msg.type !== 'string') return;

        if (msg.type === 'ping') {
          sendRaw(ws, { type: 'pong', payload: {} });
          return;
        }

        if (msg.type === 'typing') {
          const conversationId = String(msg.payload?.conversationId || '');
          const isTyping = Boolean(msg.payload?.isTyping);
          if (!conversationId) return;

          const conv = db
            .prepare('SELECT participant_user_ids_json, status FROM conversations WHERE id = ?')
            .get(conversationId) as { participant_user_ids_json: string; status: string } | undefined;
          if (!conv || conv.status === 'declined') return;

          const participants = parseJson<string[]>(conv.participant_user_ids_json, []);
          if (!participants.includes(user.id)) return;

          const otherParticipants = participants.filter(
            (pId) => pId !== user.id && !isBlockedBetween(db, user.id, pId)
          );
          if (otherParticipants.length === 0) return;

          sendToUsers(otherParticipants, {
            type: 'typing:update',
            payload: {
              conversationId,
              userId: user.id,
              userName: `${user.firstName} ${user.lastName}`.trim(),
              isTyping,
            },
          });
        }

        if (msg.type === 'community:subscribe') {
          const cid = String(msg.payload?.communityId || '');
          if (!cid) return;
          let set = communitySockets.get(cid);
          if (!set) {
            set = new Set();
            communitySockets.set(cid, set);
          }
          set.add(ws);
          return;
        }

        if (msg.type === 'community:unsubscribe') {
          const cid = String(msg.payload?.communityId || '');
          if (!cid) return;
          const set = communitySockets.get(cid);
          if (set) {
            set.delete(ws);
            if (set.size === 0) communitySockets.delete(cid);
          }
          return;
        }
      } catch {
        // Ignore malformed client frames
      }
    });

    ws.on('close', () => {
      socketToUser.delete(ws);
      for (const [cid, set] of communitySockets.entries()) {
        set.delete(ws);
        if (set.size === 0) communitySockets.delete(cid);
      }
      const existing = userSockets.get(user.id);
      if (existing) {
        existing.delete(ws);
        if (existing.size === 0) {
          userSockets.delete(user.id);
          broadcastAll(
            {
              type: 'presence:update',
              payload: { userId: user.id, isOnline: false },
            },
            user.id
          );
        }
      }
    });
  });

  const attachToServer = (server: http.Server) => {
    if (attachedServers.has(server)) return;
    attachedServers.add(server);

    server.on('upgrade', (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
      const baseUrl = `http://${req.headers.host || 'localhost'}`;
      let pathname = '/';
      try {
        pathname = new URL(req.url || '/', baseUrl).pathname;
      } catch {
        pathname = '/';
      }

      if (pathname !== '/ws') {
        // Leave non-/ws upgrades (if any) untouched
        return;
      }

      const user = authenticateUpgradeRequest(db, req);
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, user);
      });
    });
  };

  const closeAll = () => {
    for (const client of wss.clients) {
      try {
        client.terminate();
      } catch {
        // ignore
      }
    }
    userSockets.clear();
    socketToUser.clear();
    communitySockets.clear();
    wss.close();
  };

  return {
    attachToServer,
    sendToUser,
    sendToUsers,
    sendToCommunity,
    isUserOnline,
    getOnlineUserIds,
    closeAll,
  };
}
