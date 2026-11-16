import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { createApp } from '../../server';
import { getSchemaVersion } from '../db/migrations';
import { notifyUser } from '../services/notificationService';

function withStage7TestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanatsahnede-stage7-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const uploadDir = path.join(tmpDir, 'uploads');
  const { app, db, attachWebSocket, realtimeHub } = createApp({ dbPath, uploadDir });
  const server = app.listen(0);
  attachWebSocket(server);
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
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

test('Stage 7.1: Migration v9 creates user_preferences table and search indexes', async () => {
  const ctx = withStage7TestServer();
  try {
    assert.ok(getSchemaVersion(ctx.db) >= 9);

    const tables = (
      ctx.db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as Array<{ name: string }>
    ).map((t) => t.name);
    assert.ok(tables.includes('user_preferences'));

    const indexes = (
      ctx.db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
        .all() as Array<{ name: string }>
    ).map((i) => i.name);
    assert.ok(indexes.includes('idx_opportunities_status_disc'));
    assert.ok(indexes.includes('idx_communities_vis_disc'));
    assert.ok(indexes.includes('idx_posts_status_created'));
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 7.2: Unified search returns categorized results with Turkish folding, block filtering, and private artist visibility checks', async () => {
  const ctx = withStage7TestServer();
  try {
    // Broad search across İstanbul returns multiple categories
    const allRes = await fetch(`${ctx.baseUrl}/api/search?city=${encodeURIComponent('İstanbul')}`);
    assert.equal(allRes.status, 200);
    const allData = (await allRes.json()) as any;
    assert.ok(allData.totalCount > 0);
    assert.ok(allData.grouped.artist.length > 0);
    assert.ok(allData.grouped.business.length > 0);
    assert.ok(allData.grouped.listing.length > 0);
    assert.ok(Array.isArray(allData.topHits));

    // Turkish case-insensitive / accent folding query ("piyano" finds Efe Özkan / Jazz listings)
    const turkishRes = await fetch(`${ctx.baseUrl}/api/search?q=${encodeURIComponent('İSTANBUL')}`);
    assert.equal(turkishRes.status, 200);
    const turkishData = (await turkishRes.json()) as any;
    assert.ok(turkishData.totalCount > 0);

    // Set Efe's artist profile to private -> hidden from unauthenticated & non-follower users
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const ece = await loginAs(ctx.baseUrl, 'izleyici@sanatsever.com');
    const deniz = await loginAs(ctx.baseUrl, 'etkinlik@grandbosphorus.com');

    ctx.db
      .prepare('DELETE FROM follows WHERE follower_user_id = ? AND following_user_id = ?')
      .run(ece.user.id, efe.user.id);

    ctx.db
      .prepare(`UPDATE individual_profiles SET profile_visibility = 'private' WHERE user_id = ?`)
      .run(efe.user.id);

    const anonSearch = await (
      await fetch(`${ctx.baseUrl}/api/search?q=${encodeURIComponent('Efe Özkan')}&category=artist`)
    ).json() as any;
    assert.ok(anonSearch.grouped.artist.every((a: any) => a.entityId !== 'artist_efe_ozkan'));

    const eceSearch = await (
      await fetch(`${ctx.baseUrl}/api/search?q=${encodeURIComponent('Efe Özkan')}&category=artist`, {
        headers: { Authorization: `Bearer ${ece.token}` },
      })
    ).json() as any;
    assert.ok(eceSearch.grouped.artist.every((a: any) => a.entityId !== 'artist_efe_ozkan'));

    // Self still sees own profile in search
    const selfSearch = await (
      await fetch(`${ctx.baseUrl}/api/search?q=${encodeURIComponent('Efe Özkan')}&category=artist`, {
        headers: { Authorization: `Bearer ${efe.token}` },
      })
    ).json() as any;
    assert.ok(selfSearch.grouped.artist.some((a: any) => a.entityId === 'artist_efe_ozkan'));

    // When Ece follows Efe, Ece can find Efe again
    const followRes = await fetch(`${ctx.baseUrl}/api/social/follow/${efe.user.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ece.token}` },
    });
    assert.ok([200, 201].includes(followRes.status));
    const followerSearch = await (
      await fetch(`${ctx.baseUrl}/api/search?q=${encodeURIComponent('Efe Özkan')}&category=artist`, {
        headers: { Authorization: `Bearer ${ece.token}` },
      })
    ).json() as any;
    assert.ok(followerSearch.grouped.artist.some((a: any) => a.entityId === 'artist_efe_ozkan'));

    // Block Deniz -> Deniz's business disappears from Efe's search
    await fetch(`${ctx.baseUrl}/api/social/block/${deniz.user.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${efe.token}` },
      body: JSON.stringify({}),
    });
    const afterBlock = await (
      await fetch(`${ctx.baseUrl}/api/search?q=${encodeURIComponent('Bosphorus')}&category=business`, {
        headers: { Authorization: `Bearer ${efe.token}` },
      })
    ).json() as any;
    const denizBizIds = new Set(
      (ctx.db.prepare('SELECT id FROM business_profiles WHERE user_id = ?').all(deniz.user.id) as any[]).map((b) => b.id)
    );
    assert.ok(afterBlock.grouped.business.every((b: any) => !denizBizIds.has(b.entityId)));
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 7.3: User notification and privacy preferences persist, filter non-critical notifications, and block cold DMs when disabled', async () => {
  const ctx = withStage7TestServer();
  try {
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const ece = await loginAs(ctx.baseUrl, 'izleyici@sanatsever.com');

    // Clear seeded relationship/conversations between Ece and Efe to test clean cold DM protection
    ctx.db
      .prepare('DELETE FROM follows WHERE (follower_user_id = ? AND following_user_id = ?) OR (follower_user_id = ? AND following_user_id = ?)')
      .run(ece.user.id, efe.user.id, efe.user.id, ece.user.id);

    // Default preferences
    const initialPrefRes = await fetch(`${ctx.baseUrl}/api/social/preferences`, {
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(initialPrefRes.status, 200);
    const initialPref = (await initialPrefRes.json()) as any;
    assert.equal(initialPref.preferences.notifFollowers, true);
    assert.equal(initialPref.preferences.allowDirectMessages, true);

    // Disable follower notifications and cold direct messages
    const updateRes = await fetch(`${ctx.baseUrl}/api/social/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${efe.token}` },
      body: JSON.stringify({
        notifFollowers: false,
        allowDirectMessages: false,
      }),
    });
    assert.equal(updateRes.status, 200);
    const updated = (await updateRes.json()) as any;
    assert.equal(updated.preferences.notifFollowers, false);
    assert.equal(updated.preferences.allowDirectMessages, false);
    assert.equal(updated.preferences.notifBookings, true);

    // Reload via GET to confirm DB persistence
    const reloadRes = await fetch(`${ctx.baseUrl}/api/social/preferences`, {
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    const reloaded = (await reloadRes.json()) as any;
    assert.equal(reloaded.preferences.notifFollowers, false);
    assert.equal(reloaded.preferences.allowDirectMessages, false);

    // notifyUser skips new_follower when opted out, but still delivers dispute_opened
    const beforeCount = (
      ctx.db.prepare('SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ?').get(efe.user.id) as { cnt: number }
    ).cnt;

    notifyUser(ctx.db, {
      userId: efe.user.id,
      type: 'new_follower',
      title: 'Yeni Takipçi',
      body: 'Bu bildirim iletilmemeli',
    });

    const afterSkipCount = (
      ctx.db.prepare('SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ?').get(efe.user.id) as { cnt: number }
    ).cnt;
    assert.equal(afterSkipCount, beforeCount);

    notifyUser(ctx.db, {
      userId: efe.user.id,
      type: 'dispute_opened',
      title: 'Kritik İhtilaf Bildirimi',
      body: 'Bu kritik bildirim iletilmeli',
    });

    const afterCriticalCount = (
      ctx.db.prepare('SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ?').get(efe.user.id) as { cnt: number }
    ).cnt;
    assert.equal(afterCriticalCount, beforeCount + 1);

    // Cold DM from Ece to Efe is rejected with 403 when allowDirectMessages is false
    const coldDmRes = await fetch(`${ctx.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ece.token}` },
      body: JSON.stringify({
        conversationType: 'direct',
        title: 'Efe Özkan',
        participantUserIds: [efe.user.id],
        initialMessage: 'Merhaba, cold DM denemesi',
      }),
    });
    assert.equal(coldDmRes.status, 403);
  } finally {
    await ctx.cleanup();
  }
});
