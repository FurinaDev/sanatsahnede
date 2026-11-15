import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { createApp } from '../../server';
import { getSchemaVersion } from '../db/migrations';

function withStage2TestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanatsahnede-stage2-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const uploadDir = path.join(tmpDir, 'uploads');
  const { app, db } = createApp({ dbPath, uploadDir });
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    db,
    cleanup: async () => {
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

test('Stage 2.1: Migration v4 creates social graph tables and seeds initial follows + availability', async () => {
  const ctx = withStage2TestServer();
  try {
    const version = getSchemaVersion(ctx.db);
    assert.ok(version >= 4, `Expected schema version >= 4, got ${version}`);

    const fkErrors = ctx.db.prepare('PRAGMA foreign_key_check').all();
    assert.deepEqual(fkErrors, []);

    const efeRes = await fetch(`${ctx.baseUrl}/api/artists?availableThisWeek=true&limit=20`);
    assert.equal(efeRes.status, 200);
    const efeData = (await efeRes.json()) as any;
    assert.ok(efeData.items.length >= 1);
    assert.ok(efeData.items.every((a: any) => a.isAvailableThisWeek === true));
    const efe = efeData.items.find((a: any) => a.id === 'artist_efe_ozkan');
    assert.ok(efe);
    assert.ok(efe.followersCount >= 1);
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 2.2: Follow/unfollow and mute/unmute endpoints enforce self-checks and update counts', async () => {
  const ctx = withStage2TestServer();
  try {
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const selin = await loginAs(ctx.baseUrl, 'selin@istanbulstringtrio.com');

    // Self-follow -> 400
    const selfRes = await fetch(`${ctx.baseUrl}/api/social/follow/${efe.user.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(selfRes.status, 400);

    // Efe follows Selin -> 201
    const followRes = await fetch(`${ctx.baseUrl}/api/social/follow/${selin.user.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(followRes.status, 201);
    const followData = (await followRes.json()) as any;
    assert.equal(followData.following, true);
    assert.equal(followData.summary.isFollowing, true);
    assert.ok(followData.summary.followersCount >= 1);

    // Idempotent repeat follow
    const repeatRes = await fetch(`${ctx.baseUrl}/api/social/follow/${selin.user.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(repeatRes.status, 201);
    const repeatData = (await repeatRes.json()) as any;
    assert.equal(repeatData.summary.followersCount, followData.summary.followersCount);

    // Mute & unmute
    const muteRes = await fetch(`${ctx.baseUrl}/api/social/mute/${selin.user.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(muteRes.status, 201);

    const meRes = await fetch(`${ctx.baseUrl}/api/social/me`, {
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(meRes.status, 200);
    const meData = (await meRes.json()) as any;
    assert.ok(meData.followingUserIds.includes(selin.user.id));
    assert.ok(meData.mutedUserIds.includes(selin.user.id));

    const unmuteRes = await fetch(`${ctx.baseUrl}/api/social/mute/${selin.user.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(unmuteRes.status, 200);

    const unfollowRes = await fetch(`${ctx.baseUrl}/api/social/follow/${selin.user.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(unfollowRes.status, 200);
    const unfollowData = (await unfollowRes.json()) as any;
    assert.equal(unfollowData.following, false);
    assert.equal(unfollowData.summary.isFollowing, false);
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 2.3: Mutual block severs follows, hides profiles/directories, and blocks DMs, applications & offers with 403', async () => {
  const ctx = withStage2TestServer();
  try {
    const biz = await loginAs(ctx.baseUrl, 'etkinlik@grandbosphorus.com');
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');

    // Create an active listing owned by Grand Bosphorus so Efe could otherwise apply/offer
    const bizRow = ctx.db.prepare('SELECT id FROM business_profiles WHERE user_id = ?').get(biz.user.id) as any;
    const activeListing = ctx.db
      .prepare("SELECT id FROM listings WHERE business_id = ? AND status = 'active' LIMIT 1")
      .get(bizRow.id) as any;
    assert.ok(activeListing?.id, 'Expected an active seeded listing for Grand Bosphorus');

    // Start a conversation before blocking so we can verify sending into an existing thread is also blocked
    const preConvRes = await fetch(`${ctx.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${biz.token}`,
      },
      body: JSON.stringify({
        contextType: 'direct',
        title: 'Ön Görüşme',
        participantUserIds: [efe.user.id],
        initialMessage: 'Merhaba Efe Bey',
      }),
    });
    assert.equal(preConvRes.status, 201);
    const preConv = ((await preConvRes.json()) as any).conversation;

    // Biz blocks Efe -> must sever follow relationship and hide Efe from Biz's directory/bootstrap
    const blockRes = await fetch(`${ctx.baseUrl}/api/social/block/${efe.user.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${biz.token}`,
      },
      body: JSON.stringify({ reason: 'Test block' }),
    });
    assert.equal(blockRes.status, 201);

    // Efe following Biz should have been severed automatically
    const efeGraphRes = await fetch(`${ctx.baseUrl}/api/social/me`, {
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    const efeGraph = (await efeGraphRes.json()) as any;
    assert.equal(efeGraph.followingUserIds.includes(biz.user.id), false);
    assert.equal(efeGraph.blockedUserIds.includes(efe.user.id) || efeGraph.blockedUserIds.includes(biz.user.id), true);

    // Social profile summary should mask lists when blocked
    const blockedProfileRes = await fetch(`${ctx.baseUrl}/api/social/profile/${biz.user.id}`, {
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(blockedProfileRes.status, 200);
    const blockedProfileData = (await blockedProfileRes.json()) as any;
    assert.equal(blockedProfileData.blocked, true);
    assert.deepEqual(blockedProfileData.followers, []);

    // Directory & bootstrap hide mutually blocked entities
    const artistsForBizRes = await fetch(`${ctx.baseUrl}/api/artists?limit=50`, {
      headers: { Authorization: `Bearer ${biz.token}` },
    });
    const artistsForBiz = (await artistsForBizRes.json()) as any;
    assert.equal(artistsForBiz.items.some((a: any) => a.userId === efe.user.id), false);

    const bootstrapForEfeRes = await fetch(`${ctx.baseUrl}/api/bootstrap`, {
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    const bootstrapForEfe = (await bootstrapForEfeRes.json()) as any;
    assert.equal(bootstrapForEfe.businesses.some((b: any) => b.userId === biz.user.id), false);

    // Blocked follow attempt -> 403
    const blockedFollow = await fetch(`${ctx.baseUrl}/api/social/follow/${biz.user.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(blockedFollow.status, 403);

    // Blocked new conversation -> 403
    const blockedConv = await fetch(`${ctx.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({
        contextType: 'direct',
        title: 'Engelli Deneme',
        participantUserIds: [biz.user.id],
      }),
    });
    assert.equal(blockedConv.status, 403);

    // Blocked message on existing conversation -> 403
    const blockedMsg = await fetch(`${ctx.baseUrl}/api/conversations/${preConv.id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({ body: 'Ulaşabilir miyim?' }),
    });
    assert.equal(blockedMsg.status, 403);

    // Blocked listing application -> 403
    const blockedApp = await fetch(`${ctx.baseUrl}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({
        listingId: activeListing.id,
        applicantType: 'individual',
        message: 'Başvurmak istiyorum',
      }),
    });
    assert.equal(blockedApp.status, 403);

    // Blocked offer creation -> 403
    const efeProfile = ctx.db.prepare('SELECT id FROM individual_profiles WHERE user_id = ?').get(efe.user.id) as any;
    const blockedOffer = await fetch(`${ctx.baseUrl}/api/offers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${biz.token}`,
      },
      body: JSON.stringify({
        listingId: activeListing.id,
        performerId: efeProfile.id,
        performerType: 'individual',
        proposedAmount: 15000,
      }),
    });
    assert.equal(blockedOffer.status, 403);

    // Unblock restores directory visibility
    const unblockRes = await fetch(`${ctx.baseUrl}/api/social/block/${efe.user.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${biz.token}` },
    });
    assert.equal(unblockRes.status, 200);

    const restoredArtistsRes = await fetch(`${ctx.baseUrl}/api/artists?limit=50`, {
      headers: { Authorization: `Bearer ${biz.token}` },
    });
    const restoredArtists = (await restoredArtistsRes.json()) as any;
    assert.equal(restoredArtists.items.some((a: any) => a.userId === efe.user.id), true);
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 2.4: Artist weekly availability toggle and adaptive disciplineShowcase persist via profile endpoints', async () => {
  const ctx = withStage2TestServer();
  try {
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');

    // Toggle availability off with custom note
    const toggleOff = await fetch(`${ctx.baseUrl}/api/artists/me/availability`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({
        isAvailableThisWeek: false,
        availabilityNote: 'Bu hafta turne hazırlığı',
      }),
    });
    assert.equal(toggleOff.status, 200);
    const offData = (await toggleOff.json()) as any;
    assert.equal(offData.artist.isAvailableThisWeek, false);
    assert.equal(offData.artist.availabilityNote, 'Bu hafta turne hazırlığı');

    // Update discipline + disciplineShowcase + toggle availability back on
    const patchRes = await fetch(`${ctx.baseUrl}/api/artists/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({
        discipline: 'Bileşik Sanatlar',
        specialtyTags: ['Görsel-İşitsel (AV)', 'Multimedya Sahne'],
        isAvailableThisWeek: true,
        availabilityNote: 'Cuma ve Cumartesi akşamları müsaitim',
        disciplineShowcase: {
          mediums: ['Akustik Piyano', 'Canlı Projeksiyon'],
          exhibitions: ['Pera Ses & Işık Gecesi (2026)'],
          avSetup: '4K Projeksiyon + 2x DPA Mikrofon',
          studioLocation: 'Kadıköy Moda Atölye',
          commissionOpen: true,
        },
      }),
    });
    assert.equal(patchRes.status, 200);
    const patchData = (await patchRes.json()) as any;
    assert.equal(patchData.artist.discipline, 'Bileşik Sanatlar');
    assert.equal(patchData.artist.isAvailableThisWeek, true);
    assert.equal(patchData.artist.disciplineShowcase.studioLocation, 'Kadıköy Moda Atölye');
    assert.equal(patchData.artist.disciplineShowcase.commissionOpen, true);
    assert.deepEqual(patchData.artist.specialtyTags, ['Görsel-İşitsel (AV)', 'Multimedya Sahne']);
  } finally {
    await ctx.cleanup();
  }
});
