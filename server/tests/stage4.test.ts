import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import WebSocket from 'ws';
import { createApp } from '../../server';
import { getSchemaVersion } from '../db/migrations';

function withStage4TestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanatsahnede-stage4-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const uploadDir = path.join(tmpDir, 'uploads');
  const { app, db, attachWebSocket, realtimeHub } = createApp({ dbPath, uploadDir });
  const server = app.listen(0);
  attachWebSocket(server);
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  return {
    baseUrl,
    wsUrl,
    db,
    cleanup: async () => {
      realtimeHub.closeAll();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        db.close();
      } catch {
        // ignore
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

async function loginAs(baseUrl: string, email: string): Promise<{ token: string; user: any }> {
  const res = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.ok(data.sessionToken);
  return { token: data.sessionToken as string, user: data.user };
}

function connectWs(wsUrl: string, token?: string): Promise<{ ws: WebSocket; events: any[] }> {
  return new Promise((resolve, reject) => {
    const target = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
    const ws = new WebSocket(target);
    const events: any[] = [];
    ws.on('message', (raw) => {
      try {
        events.push(JSON.parse(raw.toString()));
      } catch {
        // ignore
      }
    });
    ws.once('open', () => resolve({ ws, events }));
    ws.once('error', (err) => reject(err));
  });
}

async function waitForEvent(
  events: any[],
  predicate: (e: any) => boolean,
  timeoutMs = 3000
): Promise<any> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for WebSocket event. Received: ${JSON.stringify(events.map((e) => e.type))}`);
}

test('Stage 4.1: Migration v6 creates messaging columns and conversation_reads table cleanly', async () => {
  const ctx = withStage4TestServer();
  try {
    assert.ok(getSchemaVersion(ctx.db) >= 6);
    const convCols = (ctx.db.prepare('PRAGMA table_info(conversations)').all() as any[]).map((c) => c.name);
    assert.ok(convCols.includes('conversation_type'));
    assert.ok(convCols.includes('status'));
    assert.ok(convCols.includes('created_by_user_id'));

    const msgCols = (ctx.db.prepare('PRAGMA table_info(messages)').all() as any[]).map((c) => c.name);
    assert.ok(msgCols.includes('reply_to_message_id'));
    assert.ok(msgCols.includes('reactions_json'));
    assert.ok(msgCols.includes('edited_at'));
    assert.ok(msgCols.includes('deleted_at'));

    const readsTable = ctx.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_reads'")
      .get();
    assert.ok(readsTable);
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 4.2: 1:1 deduplication, cold DM pending_request workflow, and accept/decline/block', async () => {
  const ctx = withStage4TestServer();
  try {
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const tech = await loginAs(ctx.baseUrl, 'teknik@sesvesahne.com');

    // Cold DM (efe -> tech) with no prior follow/booking/project creates pending_request
    const createRes = await fetch(`${ctx.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({
        contextType: 'direct',
        conversationType: 'direct',
        title: 'Teknik İş Birliği',
        participantUserIds: [tech.user.id],
        initialMessage: 'Merhaba, sahne ses sistemi hakkında görüşebilir miyiz?',
      }),
    });
    assert.equal(createRes.status, 201);
    const createdData = (await createRes.json()) as any;
    assert.equal(createdData.conversation.status, 'pending_request');
    assert.equal(createdData.conversation.conversationType, 'direct');

    // Duplicate 1:1 direct creation reuses existing conversation (status 200, existing: true)
    const dupRes = await fetch(`${ctx.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({
        contextType: 'direct',
        conversationType: 'direct',
        title: 'İkinci Deneme',
        participantUserIds: [tech.user.id],
      }),
    });
    assert.equal(dupRes.status, 200);
    const dupData = (await dupRes.json()) as any;
    assert.equal(dupData.existing, true);
    assert.equal(dupData.conversation.id, createdData.conversation.id);

    // Sender cannot accept their own pending_request
    const selfAcceptRes = await fetch(`${ctx.baseUrl}/api/conversations/${createdData.conversation.id}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({ decision: 'accept' }),
    });
    assert.equal(selfAcceptRes.status, 403);

    // Recipient accepts pending_request -> becomes active
    const acceptRes = await fetch(`${ctx.baseUrl}/api/conversations/${createdData.conversation.id}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tech.token}`,
      },
      body: JSON.stringify({ decision: 'accept' }),
    });
    assert.equal(acceptRes.status, 200);
    const acceptedData = (await acceptRes.json()) as any;
    assert.equal(acceptedData.conversation.status, 'active');
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 4.3: Group chat creation, member add/leave, replies, reactions, edit, soft-delete, and read receipts', async () => {
  const ctx = withStage4TestServer();
  try {
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const selen = await loginAs(ctx.baseUrl, 'selin@istanbulstringtrio.com');
    const biz = await loginAs(ctx.baseUrl, 'etkinlik@grandbosphorus.com');
    const tech = await loginAs(ctx.baseUrl, 'teknik@sesvesahne.com');

    // Group with < 2 other participants rejected (400)
    const invalidGroupRes = await fetch(`${ctx.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({
        conversationType: 'group',
        title: 'Eksik Grup',
        participantUserIds: [selen.user.id],
      }),
    });
    assert.equal(invalidGroupRes.status, 400);

    // Valid group creation (efe + selen + biz)
    const groupRes = await fetch(`${ctx.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({
        conversationType: 'group',
        contextType: 'group',
        title: 'Boğaziçi Gala Ekibi',
        participantUserIds: [selen.user.id, biz.user.id],
        initialMessage: 'Herkese merhaba, prova saatini netleştirelim.',
      }),
    });
    assert.equal(groupRes.status, 201);
    const groupConv = ((await groupRes.json()) as any).conversation;
    assert.equal(groupConv.conversationType, 'group');
    assert.equal(groupConv.participantUserIds.length, 3);
    const firstMsgId = groupConv.messages[0].id;

    // Add tech member to group
    const addMemberRes = await fetch(`${ctx.baseUrl}/api/conversations/${groupConv.id}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({ userId: tech.user.id }),
    });
    assert.equal(addMemberRes.status, 200);
    const afterAdd = ((await addMemberRes.json()) as any).conversation;
    assert.equal(afterAdd.participantUserIds.includes(tech.user.id), true);

    // Selen sends a reply referencing firstMsgId
    const replyRes = await fetch(`${ctx.baseUrl}/api/conversations/${groupConv.id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${selen.token}`,
      },
      body: JSON.stringify({
        body: 'Saat 18:00 benim için uygundur!',
        replyToMessageId: firstMsgId,
      }),
    });
    assert.equal(replyRes.status, 201);
    const replyData = (await replyRes.json()) as any;
    assert.equal(replyData.message.replyToMessageId, firstMsgId);
    assert.ok(replyData.message.replyToSnippet);

    // Efe reacts with 👏 and toggles
    const reactRes = await fetch(
      `${ctx.baseUrl}/api/conversations/${groupConv.id}/messages/${replyData.message.id}/reactions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${efe.token}`,
        },
        body: JSON.stringify({ emoji: '👏' }),
      }
    );
    assert.equal(reactRes.status, 200);
    const reactData = (await reactRes.json()) as any;
    assert.deepEqual(reactData.reactions['👏'], [efe.user.id]);

    // Invalid emoji rejected (400)
    const badReactRes = await fetch(
      `${ctx.baseUrl}/api/conversations/${groupConv.id}/messages/${replyData.message.id}/reactions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${efe.token}`,
        },
        body: JSON.stringify({ emoji: '💩' }),
      }
    );
    assert.equal(badReactRes.status, 400);

    // Non-sender cannot edit Selen's message (403)
    const forbiddenEditRes = await fetch(
      `${ctx.baseUrl}/api/conversations/${groupConv.id}/messages/${replyData.message.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${efe.token}`,
        },
        body: JSON.stringify({ body: 'Değiştirdim' }),
      }
    );
    assert.equal(forbiddenEditRes.status, 403);

    // Selen edits her own message
    const editRes = await fetch(
      `${ctx.baseUrl}/api/conversations/${groupConv.id}/messages/${replyData.message.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${selen.token}`,
        },
        body: JSON.stringify({ body: 'Saat 18:30 benim için uygundur!' }),
      }
    );
    assert.equal(editRes.status, 200);
    const editedData = (await editRes.json()) as any;
    assert.equal(editedData.message.body, 'Saat 18:30 benim için uygundur!');
    assert.ok(editedData.message.editedAt);

    // Biz marks conversation read -> unreadCount becomes 0
    const readRes = await fetch(`${ctx.baseUrl}/api/conversations/${groupConv.id}/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${biz.token}`,
      },
      body: JSON.stringify({ lastReadMessageId: replyData.message.id }),
    });
    assert.equal(readRes.status, 200);
    const readData = (await readRes.json()) as any;
    assert.equal(readData.conversation.unreadCount, 0);
    assert.ok(readData.conversation.readBy[biz.user.id]);

    // Selen soft-deletes her message -> body masked as 'Bu mesaj silindi.'
    const delRes = await fetch(
      `${ctx.baseUrl}/api/conversations/${groupConv.id}/messages/${replyData.message.id}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${selen.token}` },
      }
    );
    assert.equal(delRes.status, 200);
    const delData = (await delRes.json()) as any;
    const deletedMsg = delData.conversation.messages.find((m: any) => m.id === replyData.message.id);
    assert.equal(deletedMsg.body, 'Bu mesaj silindi.');
    assert.ok(deletedMsg.deletedAt);

    // Tech leaves group
    const leaveRes = await fetch(
      `${ctx.baseUrl}/api/conversations/${groupConv.id}/members/${tech.user.id}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tech.token}` },
      }
    );
    assert.equal(leaveRes.status, 200);
    const afterLeave = ((await leaveRes.json()) as any).conversation;
    assert.equal(afterLeave.participantUserIds.includes(tech.user.id), false);
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 4.4: Real-time WebSocket rejects unauthenticated connections and delivers live messages, reactions, typing, and read receipts', async () => {
  const ctx = withStage4TestServer();
  let wsEfe: WebSocket | null = null;
  let wsSelen: WebSocket | null = null;
  try {
    // 1. Unauthenticated WebSocket upgrade must be rejected
    await assert.rejects(
      () => connectWs(ctx.wsUrl),
      (err: any) => Boolean(err)
    );

    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const selen = await loginAs(ctx.baseUrl, 'festival@istanbuloda.org');

    // Follow each other so direct DM starts active
    await fetch(`${ctx.baseUrl}/api/social/follow/${selen.user.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${efe.token}` },
    });

    const efeConn = await connectWs(ctx.wsUrl, efe.token);
    wsEfe = efeConn.ws;
    const selenConn = await connectWs(ctx.wsUrl, selen.token);
    wsSelen = selenConn.ws;

    await waitForEvent(efeConn.events, (e) => e.type === 'ws:connected');
    await waitForEvent(selenConn.events, (e) => e.type === 'ws:connected');

    // Efe creates DM -> Selen receives conversation:created via WS
    const convRes = await fetch(`${ctx.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({
        conversationType: 'direct',
        contextType: 'direct',
        title: 'WebSocket Test',
        participantUserIds: [selen.user.id],
        initialMessage: 'Selam Selen!',
      }),
    });
    assert.equal(convRes.status, 201);
    const conv = ((await convRes.json()) as any).conversation;

    const createdEvt = await waitForEvent(
      selenConn.events,
      (e) => e.type === 'conversation:created' && e.payload?.conversation?.id === conv.id
    );
    assert.equal(createdEvt.payload.conversation.title, 'WebSocket Test');

    // Efe emits typing -> Selen receives typing:update
    efeConn.ws.send(
      JSON.stringify({
        type: 'typing',
        payload: { conversationId: conv.id, isTyping: true },
      })
    );
    const typingEvt = await waitForEvent(
      selenConn.events,
      (e) => e.type === 'typing:update' && e.payload?.conversationId === conv.id
    );
    assert.equal(typingEvt.payload.userId, efe.user.id);
    assert.equal(typingEvt.payload.isTyping, true);

    // Efe sends message via REST -> Selen receives message:created in real time
    const msgRes = await fetch(`${ctx.baseUrl}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({ body: 'Canlı WebSocket mesajı' }),
    });
    assert.equal(msgRes.status, 201);

    const msgEvt = await waitForEvent(
      selenConn.events,
      (e) =>
        e.type === 'message:created' &&
        e.payload?.conversationId === conv.id &&
        e.payload?.message?.body === 'Canlı WebSocket mesajı'
    );
    assert.ok(msgEvt.payload.message.id);

    // Selen marks read -> Efe receives conversation:read
    await fetch(`${ctx.baseUrl}/api/conversations/${conv.id}/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${selen.token}`,
      },
      body: JSON.stringify({ lastReadMessageId: msgEvt.payload.message.id }),
    });
    const readEvt = await waitForEvent(
      efeConn.events,
      (e) =>
        e.type === 'conversation:read' &&
        e.payload?.conversationId === conv.id &&
        e.payload?.userId === selen.user.id
    );
    assert.equal(readEvt.payload.lastReadMessageId, msgEvt.payload.message.id);
  } finally {
    try {
      wsEfe?.close();
    } catch {
      // ignore
    }
    try {
      wsSelen?.close();
    } catch {
      // ignore
    }
    await ctx.cleanup();
  }
});
