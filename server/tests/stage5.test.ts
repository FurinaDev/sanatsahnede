import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import WebSocket from 'ws';
import { createApp } from '../../server';
import { getSchemaVersion } from '../db/migrations';

function withStage5TestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanatsahnede-stage5-'));
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

function connectWs(wsUrl: string, token: string): Promise<{ ws: WebSocket; events: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
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
  throw new Error(
    `Timed out waiting for WebSocket event. Received: ${JSON.stringify(events.map((e) => e.type))}`
  );
}

test('Stage 5.1: Migration v7 creates communities tables and seeds 3 communities with Duyurular & #genel', async () => {
  const ctx = withStage5TestServer();
  try {
    assert.ok(getSchemaVersion(ctx.db) >= 7);

    const res = await fetch(`${ctx.baseUrl}/api/communities`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.ok(Array.isArray(data.communities));
    assert.ok(data.communities.length >= 3);

    const caz = data.communities.find((c: any) => c.id === 'comm_istanbul_caz');
    assert.ok(caz);
    assert.equal(caz.isVerified, true);
    assert.ok(caz.channels.some((ch: any) => ch.slug === 'duyurular' && ch.isReadonly === true));
    assert.ok(caz.channels.some((ch: any) => ch.slug === 'genel' && ch.isReadonly === false));
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 5.2: Community creation, join/leave, Duyurular readonly permission, mute enforcement, and moderator promotion', async () => {
  const ctx = withStage5TestServer();
  try {
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const ece = await loginAs(ctx.baseUrl, 'izleyici@sanatsever.com');

    // Efe creates a new community -> auto gets Duyurular (readonly) and #genel + owner role
    const createRes = await fetch(`${ctx.baseUrl}/api/communities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({
        name: 'Boğaziçi Doğaçlama Atölyesi',
        discipline: 'Müzik',
        city: 'İstanbul',
        description: 'Haftalık caz ve doğaçlama seansları.',
        visibility: 'public',
      }),
    });
    assert.equal(createRes.status, 201);
    const comm = ((await createRes.json()) as any).community;
    assert.equal(comm.myRole, 'owner');
    const duyurular = comm.channels.find((ch: any) => ch.slug === 'duyurular');
    const genel = comm.channels.find((ch: any) => ch.slug === 'genel');
    assert.ok(duyurular && genel);

    // Non-member Ece cannot post to #genel (403)
    const nonMemberPost = await fetch(
      `${ctx.baseUrl}/api/communities/${comm.id}/channels/${genel.id}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ece.token}`,
        },
        body: JSON.stringify({ body: 'Katılmadan yazıyorum' }),
      }
    );
    assert.equal(nonMemberPost.status, 403);

    // Ece joins community
    const joinRes = await fetch(`${ctx.baseUrl}/api/communities/${comm.id}/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ece.token}` },
    });
    assert.equal(joinRes.status, 200);
    assert.equal(((await joinRes.json()) as any).community.myRole, 'member');

    // Plain member Ece CANNOT create sub-channel (403)
    const memberCreateChannel = await fetch(`${ctx.baseUrl}/api/communities/${comm.id}/channels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ece.token}`,
      },
      body: JSON.stringify({ name: 'izinsiz-kanal', channelType: 'discussion' }),
    });
    assert.equal(memberCreateChannel.status, 403);

    // Plain member Ece CANNOT post in Duyurular readonly channel (403)
    const memberPostAnnounce = await fetch(
      `${ctx.baseUrl}/api/communities/${comm.id}/channels/${duyurular.id}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ece.token}`,
        },
        body: JSON.stringify({ body: 'Duyuru yazmaya çalışıyorum' }),
      }
    );
    assert.equal(memberPostAnnounce.status, 403);

    // Owner Efe CAN post in Duyurular (201) and pin it
    const ownerAnnounce = await fetch(
      `${ctx.baseUrl}/api/communities/${comm.id}/channels/${duyurular.id}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${efe.token}`,
        },
        body: JSON.stringify({ body: 'Cuma akşamı ilk buluşmamızı yapıyoruz!' }),
      }
    );
    assert.equal(ownerAnnounce.status, 201);
    const annMsg = ((await ownerAnnounce.json()) as any).message;

    const pinRes = await fetch(
      `${ctx.baseUrl}/api/communities/${comm.id}/channels/${duyurular.id}/messages/${annMsg.id}/pin`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${efe.token}` },
      }
    );
    assert.equal(pinRes.status, 200);
    assert.equal(((await pinRes.json()) as any).message.isPinned, true);

    // Owner Efe creates custom sub-channel
    const subChannelRes = await fetch(`${ctx.baseUrl}/api/communities/${comm.id}/channels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({ name: 'prova-saatleri', channelType: 'discussion' }),
    });
    assert.equal(subChannelRes.status, 201);

    // Owner mutes Ece -> Ece gets 403 posting in #genel
    const muteRes = await fetch(`${ctx.baseUrl}/api/communities/${comm.id}/members/${ece.user.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({ isMuted: true }),
    });
    assert.equal(muteRes.status, 200);

    const mutedPost = await fetch(
      `${ctx.baseUrl}/api/communities/${comm.id}/channels/${genel.id}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ece.token}`,
        },
        body: JSON.stringify({ body: 'Susturuldum ama yazıyorum' }),
      }
    );
    assert.equal(mutedPost.status, 403);

    // Unmute & promote Ece to moderator -> now Ece CAN post in Duyurular & #genel
    const promoteRes = await fetch(
      `${ctx.baseUrl}/api/communities/${comm.id}/members/${ece.user.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${efe.token}`,
        },
        body: JSON.stringify({ isMuted: false, role: 'moderator' }),
      }
    );
    assert.equal(promoteRes.status, 200);

    const modPostAnnounce = await fetch(
      `${ctx.baseUrl}/api/communities/${comm.id}/channels/${duyurular.id}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ece.token}`,
        },
        body: JSON.stringify({ body: 'Moderatör olarak duyuruyu güncelliyorum.' }),
      }
    );
    assert.equal(modPostAnnounce.status, 201);
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 5.3: Real-time WebSocket community:subscribe delivers live messages and reactions across members', async () => {
  const ctx = withStage5TestServer();
  let wsEfe: WebSocket | null = null;
  let wsSelen: WebSocket | null = null;
  try {
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const selen = await loginAs(ctx.baseUrl, 'selin@istanbulstringtrio.com');

    const commRes = await fetch(`${ctx.baseUrl}/api/communities/comm_istanbul_caz`);
    assert.equal(commRes.status, 200);
    const commData = ((await commRes.json()) as any).community;
    const genel = commData.channels.find((ch: any) => ch.slug === 'genel');
    assert.ok(genel);

    const efeConn = await connectWs(ctx.wsUrl, efe.token);
    wsEfe = efeConn.ws;
    const selenConn = await connectWs(ctx.wsUrl, selen.token);
    wsSelen = selenConn.ws;

    await waitForEvent(efeConn.events, (e) => e.type === 'ws:connected');
    await waitForEvent(selenConn.events, (e) => e.type === 'ws:connected');

    selenConn.ws.send(
      JSON.stringify({ type: 'community:subscribe', payload: { communityId: commData.id } })
    );

    // Efe posts a message in #genel -> Selen receives community:message_created
    const postRes = await fetch(
      `${ctx.baseUrl}/api/communities/${commData.id}/channels/${genel.id}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${efe.token}`,
        },
        body: JSON.stringify({ body: 'Canlı prova kanalına hoş geldiniz!' }),
      }
    );
    assert.equal(postRes.status, 201);

    const wsMsg = await waitForEvent(
      selenConn.events,
      (e) =>
        e.type === 'community:message_created' &&
        e.payload?.communityId === commData.id &&
        e.payload?.message?.body === 'Canlı prova kanalına hoş geldiniz!'
    );

    // Selen toggles emoji reaction -> Efe receives community:message_reaction
    const reactRes = await fetch(
      `${ctx.baseUrl}/api/communities/${commData.id}/channels/${genel.id}/messages/${wsMsg.payload.message.id}/reactions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${selen.token}`,
        },
        body: JSON.stringify({ emoji: '🎶' }),
      }
    );
    assert.equal(reactRes.status, 200);

    const reactEvt = await waitForEvent(
      efeConn.events,
      (e) =>
        e.type === 'community:message_reaction' &&
        e.payload?.message?.id === wsMsg.payload.message.id
    );
    assert.deepEqual(reactEvt.payload.message.reactions['🎶'], [selen.user.id]);
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

test('Stage 5.4: Admin Verified Badge Governance grants/revokes badges across artist, ensemble, business, and community while rejecting non-staff', async () => {
  const ctx = withStage5TestServer();
  try {
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const admin = await loginAs(ctx.baseUrl, 'admin@sahnesanat.com');

    // Non-admin artist cannot verify a community (403)
    const forbidden = await fetch(
      `${ctx.baseUrl}/api/admin/entities/community/comm_sahne_teknik/verify`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${efe.token}`,
        },
        body: JSON.stringify({ isVerified: true }),
      }
    );
    assert.equal(forbidden.status, 403);

    // Admin verifies community & revokes and re-grants artist badge
    const verifyCommRes = await fetch(
      `${ctx.baseUrl}/api/admin/entities/community/comm_sahne_teknik/verify`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${admin.token}`,
        },
        body: JSON.stringify({ isVerified: true, note: 'Onaylı Teknik Ağ' }),
      }
    );
    assert.equal(verifyCommRes.status, 200);
    const commBadge = (await verifyCommRes.json()) as any;
    assert.equal(commBadge.isVerified, true);
    assert.equal(commBadge.verifiedLabel, 'Onaylı Teknik Ağ');

    const commCheck = (await (
      await fetch(`${ctx.baseUrl}/api/communities/comm_sahne_teknik`)
    ).json()) as any;
    assert.equal(commCheck.community.isVerified, true);
    assert.equal(commCheck.community.verifiedLabel, 'Onaylı Teknik Ağ');

    // Toggle artist badge off then back on
    const revokeArtist = await fetch(
      `${ctx.baseUrl}/api/admin/entities/artist/artist_efe_ozkan/verify`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${admin.token}`,
        },
        body: JSON.stringify({ isVerified: false }),
      }
    );
    assert.equal(revokeArtist.status, 200);
    assert.equal(((await revokeArtist.json()) as any).isVerified, false);

    const grantArtist = await fetch(
      `${ctx.baseUrl}/api/admin/entities/artist/artist_efe_ozkan/verify`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${admin.token}`,
        },
        body: JSON.stringify({ isVerified: true, note: 'Seçkin İcracı Rozeti' }),
      }
    );
    assert.equal(grantArtist.status, 200);
    assert.equal(((await grantArtist.json()) as any).isVerified, true);
  } finally {
    await ctx.cleanup();
  }
});
