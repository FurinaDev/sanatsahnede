import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { createApp } from '../../server';
import { getSchemaVersion } from '../db/migrations';

function withStage3TestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanatsahnede-stage3-'));
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

test('Stage 3.1: Migration v5 creates feed tables and seeds initial feed posts cleanly', async () => {
  const ctx = withStage3TestServer();
  try {
    const version = getSchemaVersion(ctx.db);
    assert.ok(version >= 5, `Expected schema version >= 5, got ${version}`);

    const fkErrors = ctx.db.prepare('PRAGMA foreign_key_check').all();
    assert.deepEqual(fkErrors, []);

    const feedRes = await fetch(`${ctx.baseUrl}/api/feed?limit=10`);
    assert.equal(feedRes.status, 200);
    const feedData = (await feedRes.json()) as any;
    assert.ok(Array.isArray(feedData.items));
    assert.ok(feedData.items.length >= 4, 'Expected at least 4 seeded feed posts');
    assert.ok(feedData.items.some((p: any) => p.repostSummary?.entityType === 'event'));
    assert.ok(feedData.items.some((p: any) => p.repostSummary?.entityType === 'listing'));
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 3.2: Follow notifications link directly to follower profile and GET /api/social/relationships returns blocked/muted details', async () => {
  const ctx = withStage3TestServer();
  try {
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const selin = await loginAs(ctx.baseUrl, 'selin@istanbulstringtrio.com');
    const biz = await loginAs(ctx.baseUrl, 'etkinlik@grandbosphorus.com');

    // Ensure fresh follow so new_follower notification is generated
    await fetch(`${ctx.baseUrl}/api/social/follow/${selin.user.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${efe.token}` },
    });

    // Efe follows Selin -> Selin's notification points directly to Efe's artist_profile
    const followRes = await fetch(`${ctx.baseUrl}/api/social/follow/${selin.user.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(followRes.status, 201);

    const selinBootRes = await fetch(`${ctx.baseUrl}/api/bootstrap/core`, {
      headers: { Authorization: `Bearer ${selin.token}` },
    });
    const selinBoot = (await selinBootRes.json()) as any;
    const followNotif = (selinBoot.notifications || []).find((n: any) => n.type === 'new_follower');
    assert.ok(followNotif, 'Expected follow notification for Selin');
    assert.equal(followNotif.linkView, 'artist_profile');
    assert.equal(followNotif.linkEntityId, 'artist_efe_ozkan');

    // Efe blocks Biz and mutes Selin -> /api/social/relationships lists both accurately
    const blockRes = await fetch(`${ctx.baseUrl}/api/social/block/${biz.user.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({ reason: 'İstenmeyen iletişim' }),
    });
    assert.equal(blockRes.status, 201);

    const muteRes = await fetch(`${ctx.baseUrl}/api/social/mute/${selin.user.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(muteRes.status, 201);

    const relRes = await fetch(`${ctx.baseUrl}/api/social/relationships`, {
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(relRes.status, 200);
    const rel = (await relRes.json()) as any;
    assert.equal(rel.blockedUsers.length, 1);
    assert.equal(rel.blockedUsers[0].userId, biz.user.id);
    assert.equal(rel.blockedUsers[0].profileView, 'business_profile');
    assert.equal(rel.mutedUsers.length, 1);
    assert.equal(rel.mutedUsers[0].userId, selin.user.id);
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 3.3: Artist private profile masks bio/repertoire/media/reviews/coordinates for non-owners while keeping owner full view', async () => {
  const ctx = withStage3TestServer();
  try {
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const selin = await loginAs(ctx.baseUrl, 'selin@istanbulstringtrio.com');

    // Set Efe to private
    const privRes = await fetch(`${ctx.baseUrl}/api/artists/me/privacy`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({ profileVisibility: 'private' }),
    });
    assert.equal(privRes.status, 200);
    const privData = (await privRes.json()) as any;
    assert.equal(privData.artist.profileVisibility, 'private');
    assert.ok(privData.artist.bioLong.length > 0, 'Owner should retain full bio');

    // Other user fetches /api/artists -> Efe identity remains, sensitive details & district masked
    const otherArtistsRes = await fetch(`${ctx.baseUrl}/api/artists?limit=50`, {
      headers: { Authorization: `Bearer ${selin.token}` },
    });
    const otherArtists = (await otherArtistsRes.json()) as any;
    const maskedEfe = otherArtists.items.find((a: any) => a.id === 'artist_efe_ozkan');
    assert.ok(maskedEfe);
    assert.equal(maskedEfe.profileVisibility, 'private');
    assert.equal(maskedEfe.fullName, 'Efe Özkan');
    assert.equal(maskedEfe.bioShort, '');
    assert.equal(maskedEfe.bioLong, '');
    assert.deepEqual(maskedEfe.repertoire, []);
    assert.deepEqual(maskedEfe.audioSamples, []);
    assert.equal(maskedEfe.district, '');
    assert.equal(maskedEfe.latitude, null);
    assert.equal(maskedEfe.longitude, null);

    // Other user bootstrap should also hide reviews targeting private artist and hide private artist's feed posts
    const selinBootRes = await fetch(`${ctx.baseUrl}/api/bootstrap/core`, {
      headers: { Authorization: `Bearer ${selin.token}` },
    });
    const selinBoot = (await selinBootRes.json()) as any;
    assert.equal(
      selinBoot.reviews.some((r: any) => r.targetId === 'artist_efe_ozkan'),
      false,
      'Reviews targeting private artist must be masked for non-owners'
    );

    const feedForSelinRes = await fetch(`${ctx.baseUrl}/api/feed?limit=20`, {
      headers: { Authorization: `Bearer ${selin.token}` },
    });
    const feedForSelin = (await feedForSelinRes.json()) as any;
    assert.equal(
      feedForSelin.items.some((p: any) => p.authorUserId === efe.user.id),
      false,
      'Feed posts by private artist should be hidden from non-owners'
    );

    // Owner directory query preserves full profile
    const ownerArtistsRes = await fetch(`${ctx.baseUrl}/api/artists?limit=50`, {
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    const ownerArtists = (await ownerArtistsRes.json()) as any;
    const ownerEfe = ownerArtists.items.find((a: any) => a.id === 'artist_efe_ozkan');
    assert.ok(ownerEfe.bioShort.length > 0);
    assert.ok(ownerEfe.repertoire.length > 0);
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 3.4: Feed CRUD, cursor pagination, reactions, comments, mute/block filtering, and SSRF protection', async () => {
  const ctx = withStage3TestServer();
  try {
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const selin = await loginAs(ctx.baseUrl, 'selin@istanbulstringtrio.com');

    // SSRF rejection checks on /api/feed/link-preview
    for (const unsafeUrl of [
      'http://127.0.0.1:3000/api/health',
      'http://localhost:3000/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/internal',
      'file:///etc/passwd',
    ]) {
      const ssrfRes = await fetch(`${ctx.baseUrl}/api/feed/link-preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${efe.token}`,
        },
        body: JSON.stringify({ url: unsafeUrl }),
      });
      assert.equal(ssrfRes.status, 400, `Expected 400 SSRF rejection for ${unsafeUrl}, got ${ssrfRes.status}`);
    }

    // Create post by Efe (with safe link skipRemoteFetch in test env)
    const createRes = await fetch(`${ctx.baseUrl}/api/feed/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${efe.token}`,
      },
      body: JSON.stringify({
        body: 'Yeni akustik caz düzenlememiz hazır! #caz #sahne',
        discipline: 'Müzik',
        postType: 'update',
        tags: ['caz', 'sahne'],
        linkUrl: 'https://sanatsahnede.com/etkinlikler',
        repostEntityType: 'event',
        repostEntityId: 'evt_1',
        skipRemoteFetch: true,
      }),
    });
    assert.equal(createRes.status, 201);
    const createdPost = ((await createRes.json()) as any).post;
    assert.ok(createdPost.id);
    assert.equal(createdPost.repostSummary.entityId, 'evt_1');
    assert.equal(createdPost.linkPreview.domain, 'sanatsahnede.com');

    // Cursor pagination check: page 1 (limit=2) and page 2 without duplicates
    const p1Res = await fetch(`${ctx.baseUrl}/api/feed?limit=2`);
    const p1 = (await p1Res.json()) as any;
    assert.equal(p1.items.length, 2);
    assert.equal(p1.hasMore, true);
    assert.ok(p1.nextCursor);

    const p2Res = await fetch(`${ctx.baseUrl}/api/feed?limit=2&cursor=${encodeURIComponent(p1.nextCursor)}`);
    const p2 = (await p2Res.json()) as any;
    assert.equal(p2.items.length, 2);
    const p1Ids = new Set(p1.items.map((x: any) => x.id));
    assert.equal(p2.items.some((x: any) => p1Ids.has(x.id)), false, 'Cursor pages must not overlap');

    // Selin reacts and toggles reaction
    const reactRes = await fetch(`${ctx.baseUrl}/api/feed/posts/${createdPost.id}/reactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${selin.token}`,
      },
      body: JSON.stringify({ reactionType: 'applause' }),
    });
    assert.equal(reactRes.status, 201 === 201 ? 200 : 200);
    const reactData = (await reactRes.json()) as any;
    assert.equal(reactData.viewerReaction, 'applause');
    assert.equal(reactData.reactionCounts.applause, 1);

    // Selin comments on Efe's post
    const commentRes = await fetch(`${ctx.baseUrl}/api/feed/posts/${createdPost.id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${selin.token}`,
      },
      body: JSON.stringify({ body: 'Harika bir akşam olacak!' }),
    });
    assert.equal(commentRes.status, 201);
    const commentData = (await commentRes.json()) as any;
    assert.equal(commentData.commentsCount, 1);

    // Selin mutes Efe -> Efe's post is hidden from Selin's feed
    await fetch(`${ctx.baseUrl}/api/social/mute/${efe.user.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${selin.token}` },
    });
    const mutedFeedRes = await fetch(`${ctx.baseUrl}/api/feed?limit=20`, {
      headers: { Authorization: `Bearer ${selin.token}` },
    });
    const mutedFeed = (await mutedFeedRes.json()) as any;
    assert.equal(mutedFeed.items.some((p: any) => p.authorUserId === efe.user.id), false);

    // Efe blocks Selin -> Selin gets 403 trying to comment or react on Efe's post
    await fetch(`${ctx.baseUrl}/api/social/block/${selin.user.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    const blockedCommentRes = await fetch(`${ctx.baseUrl}/api/feed/posts/${createdPost.id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${selin.token}`,
      },
      body: JSON.stringify({ body: 'Engelli deneme' }),
    });
    assert.equal(blockedCommentRes.status, 403);

    const blockedReactRes = await fetch(`${ctx.baseUrl}/api/feed/posts/${createdPost.id}/reactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${selin.token}`,
      },
      body: JSON.stringify({ reactionType: 'bravo' }),
    });
    assert.equal(blockedReactRes.status, 403);

    // Delete post by owner
    const delRes = await fetch(`${ctx.baseUrl}/api/feed/posts/${createdPost.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(delRes.status, 200);
  } finally {
    await ctx.cleanup();
  }
});
