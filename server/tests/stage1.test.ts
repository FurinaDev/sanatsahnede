import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { createApp } from '../../server';
import { runMigrations, getSchemaVersion } from '../db/migrations';
import { maskArtistCoordinates } from '../services/geoService';

const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function withStage1TestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanatsahnede-stage1-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const uploadDir = path.join(tmpDir, 'uploads');
  const { app, db } = createApp({ dbPath, uploadDir });
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    db,
    uploadDir,
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

async function loginAs(baseUrl: string, email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.ok(data.sessionToken);
  return data.sessionToken as string;
}

test('Stage 1.1: SQLite schema_migrations tracks versions idempotently and passes FK checks', async () => {
  const ctx = withStage1TestServer();
  try {
    const v1 = getSchemaVersion(ctx.db);
    assert.ok(v1 >= 3, `Expected schema version >= 3, got ${v1}`);

    const secondRun = runMigrations(ctx.db);
    assert.deepEqual(secondRun.appliedVersions, []);
    assert.equal(secondRun.currentVersion, v1);

    const fkErrors = ctx.db.prepare('PRAGMA foreign_key_check').all();
    assert.deepEqual(fkErrors, []);

    const healthRes = await fetch(`${ctx.baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = (await healthRes.json()) as any;
    assert.equal(health.dbSchemaVersion, v1);
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 1.2: Artist coordinate privacy masking is deterministic, coarse, and hides when disabled', () => {
  const exactLat = 41.0369123;
  const exactLng = 28.9775432;

  const masked1 = maskArtistCoordinates({
    entityId: 'artist_test_1',
    latitude: exactLat,
    longitude: exactLng,
    city: 'İstanbul',
    district: 'Beyoğlu',
    privacyMode: 'district_masked',
  });
  const masked2 = maskArtistCoordinates({
    entityId: 'artist_test_1',
    latitude: exactLat,
    longitude: exactLng,
    city: 'İstanbul',
    district: 'Beyoğlu',
    privacyMode: 'district_masked',
  });

  assert.deepEqual(masked1, masked2);
  assert.equal(masked1.locationMasked, true);
  assert.equal(masked1.locationPrecision, 'district_approx');
  assert.notEqual(masked1.latitude, exactLat);
  assert.notEqual(masked1.longitude, exactLng);
  assert.ok(Math.abs((masked1.latitude || 0) - exactLat) < 0.05);
  assert.ok(Math.abs((masked1.longitude || 0) - exactLng) < 0.05);

  const hidden = maskArtistCoordinates({
    entityId: 'artist_test_1',
    latitude: exactLat,
    longitude: exactLng,
    privacyMode: 'hidden',
  });
  assert.equal(hidden.latitude, null);
  assert.equal(hidden.longitude, null);
  assert.equal(hidden.locationPrecision, 'hidden');
});

test('Stage 1.3: Multipart media upload validates auth & magic bytes, serves /uploads, and enforces owner delete', async () => {
  const ctx = withStage1TestServer();
  try {
    // 1. Unauthenticated upload -> 401
    const unauthForm = new FormData();
    unauthForm.append('file', new Blob([VALID_1X1_PNG], { type: 'image/png' }), 'avatar.png');
    const unauthRes = await fetch(`${ctx.baseUrl}/api/media/upload`, {
      method: 'POST',
      body: unauthForm,
    });
    assert.equal(unauthRes.status, 401);

    const artistToken = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const otherToken = await loginAs(ctx.baseUrl, 'selin@istanbulstringtrio.com');

    // 2. Spoofed magic bytes (text labeled as image/png) -> 400
    const badForm = new FormData();
    badForm.append('file', new Blob([Buffer.from('<script>alert(1)</script>')], { type: 'image/png' }), 'evil.png');
    const badRes = await fetch(`${ctx.baseUrl}/api/media/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${artistToken}` },
      body: badForm,
    });
    assert.equal(badRes.status, 400);

    // 3. Valid PNG upload -> 201 and static file served at /uploads/...
    const goodForm = new FormData();
    goodForm.append('file', new Blob([VALID_1X1_PNG], { type: 'image/png' }), 'sahne-avatar.png');
    goodForm.append('category', 'profile');
    const goodRes = await fetch(`${ctx.baseUrl}/api/media/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${artistToken}` },
      body: goodForm,
    });
    assert.equal(goodRes.status, 201);
    const uploaded = (await goodRes.json()) as any;
    assert.ok(uploaded.asset.url.startsWith('/uploads/profile/'));
    assert.equal(uploaded.asset.mimeType, 'image/png');

    const servedRes = await fetch(`${ctx.baseUrl}${uploaded.asset.url}`);
    assert.equal(servedRes.status, 200);
    assert.equal(servedRes.headers.get('x-content-type-options'), 'nosniff');
    const servedBuf = Buffer.from(await servedRes.arrayBuffer());
    assert.deepEqual(servedBuf, VALID_1X1_PNG);

    // 4. Other user cannot delete -> 403
    const forbiddenDel = await fetch(`${ctx.baseUrl}/api/media/${uploaded.asset.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    assert.equal(forbiddenDel.status, 403);

    // 5. Owner can list and delete -> 200 & static file gone
    const mineRes = await fetch(`${ctx.baseUrl}/api/media/mine`, {
      headers: { Authorization: `Bearer ${artistToken}` },
    });
    assert.equal(mineRes.status, 200);
    const mineData = (await mineRes.json()) as any;
    assert.equal(mineData.assets.length, 1);

    const ownerDel = await fetch(`${ctx.baseUrl}/api/media/${uploaded.asset.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${artistToken}` },
    });
    assert.equal(ownerDel.status, 200);

    const afterDelServed = await fetch(`${ctx.baseUrl}${uploaded.asset.url}`);
    assert.equal(afterDelServed.status, 404);
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 1.4: Paginated domain endpoints and lightweight /api/bootstrap/core work cleanly', async () => {
  const ctx = withStage1TestServer();
  try {
    const coreRes = await fetch(`${ctx.baseUrl}/api/bootstrap/core`);
    assert.equal(coreRes.status, 200);
    const coreData = (await coreRes.json()) as any;
    assert.equal(coreData.scope, 'core');
    assert.deepEqual(coreData.artists, []);
    assert.deepEqual(coreData.listings, []);
    assert.ok(Array.isArray(coreData.featureFlags));

    const artistsRes = await fetch(`${ctx.baseUrl}/api/artists?page=1&limit=2`);
    assert.equal(artistsRes.status, 200);
    const artistsData = (await artistsRes.json()) as any;
    assert.equal(artistsData.page, 1);
    assert.equal(artistsData.limit, 2);
    assert.ok(artistsData.total >= 2);
    assert.equal(artistsData.items.length, 2);
    assert.equal(artistsData.items[0].locationMasked, true);

    const [ensRes, bizRes, listRes, evtRes] = await Promise.all([
      fetch(`${ctx.baseUrl}/api/ensembles?page=1&limit=3`),
      fetch(`${ctx.baseUrl}/api/businesses?page=1&limit=3`),
      fetch(`${ctx.baseUrl}/api/listings?page=1&limit=3`),
      fetch(`${ctx.baseUrl}/api/events?page=1&limit=3&city=Ankara`),
    ]);
    assert.equal(ensRes.status, 200);
    assert.equal(bizRes.status, 200);
    assert.equal(listRes.status, 200);
    assert.equal(evtRes.status, 200);

    const evtData = (await evtRes.json()) as any;
    assert.ok(evtData.events.every((e: any) => e.city === 'Ankara'));
    assert.equal(evtData.events.length, evtData.total);
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 1.5: /api/geo/geocode caches results in geo_cache and /api/geo/map-points masks artists', async () => {
  const ctx = withStage1TestServer();
  try {
    const geo1Res = await fetch(`${ctx.baseUrl}/api/geo/geocode?city=%C4%B0stanbul&district=Kad%C4%B1k%C3%B6y`);
    assert.equal(geo1Res.status, 200);
    const geo1 = (await geo1Res.json()) as any;
    assert.equal(geo1.cached, false);
    assert.ok(geo1.latitude > 40 && geo1.latitude < 42);
    assert.ok(geo1.longitude > 28 && geo1.longitude < 30);

    const geo2Res = await fetch(`${ctx.baseUrl}/api/geo/geocode?city=%C4%B0stanbul&district=Kad%C4%B1k%C3%B6y`);
    assert.equal(geo2Res.status, 200);
    const geo2 = (await geo2Res.json()) as any;
    assert.equal(geo2.cached, true);
    assert.equal(geo2.latitude, geo1.latitude);

    const pointsRes = await fetch(`${ctx.baseUrl}/api/geo/map-points?type=artists`);
    assert.equal(pointsRes.status, 200);
    const pointsData = (await pointsRes.json()) as any;
    assert.ok(pointsData.points.length > 0);
    assert.ok(pointsData.points.every((p: any) => p.kind === 'artist' && p.locationMasked === true && p.privacyRadiusMeters > 0));
  } finally {
    await ctx.cleanup();
  }
});
