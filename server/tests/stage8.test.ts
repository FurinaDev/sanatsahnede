import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { createApp } from '../../server';

function withStage8TestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanatsahnede-stage8-'));
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

async function loginAs(baseUrl: string, email: string): Promise<{ token: string; user: any; setCookie: string }> {
  const res = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie') || '';
  const data = (await res.json()) as any;
  assert.ok(data.sessionToken);
  return { token: data.sessionToken as string, user: data.user, setCookie };
}

test('Stage 8.1: Security headers, x-powered-by suppression, JSON 404, and live /api/health readiness', async () => {
  const ctx = withStage8TestServer();
  try {
    const healthRes = await fetch(`${ctx.baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.headers.get('x-powered-by'), null);
    assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(healthRes.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(healthRes.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.ok((healthRes.headers.get('permissions-policy') || '').includes('camera=()'));

    const health = (await healthRes.json()) as any;
    assert.equal(health.ok, true);
    assert.equal(health.dbReady, true);
    assert.ok(health.dbSchemaVersion >= 9);

    // Unknown API path returns structured JSON 404 rather than HTML
    const notFoundRes = await fetch(`${ctx.baseUrl}/api/non-existent-endpoint-stage8`);
    assert.equal(notFoundRes.status, 404);
    const nfBody = (await notFoundRes.json()) as any;
    assert.ok(nfBody.error);

    // Closing DB causes /api/health to report 503 readiness failure cleanly
    ctx.db.close();
    const downRes = await fetch(`${ctx.baseUrl}/api/health`);
    assert.equal(downRes.status, 503);
    const downBody = (await downRes.json()) as any;
    assert.equal(downBody.ok, false);
    assert.equal(downBody.dbReady, false);
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 8.2: Auth cookie security flags, rate limit headers/429 enforcement, and RBAC route isolation', async () => {
  const ctx = withStage8TestServer();
  try {
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const ece = await loginAs(ctx.baseUrl, 'izleyici@sanatsever.com');
    const admin = await loginAs(ctx.baseUrl, 'admin@sahnesanat.com');

    // HttpOnly + SameSite + Path=/ flags on session cookie
    assert.ok(efe.setCookie.includes('ss_session='));
    assert.ok(/HttpOnly/i.test(efe.setCookie));
    assert.ok(/SameSite=/i.test(efe.setCookie));
    assert.ok(/Path=\//i.test(efe.setCookie));

    // RBAC protection: unauthenticated -> 401, non-staff -> 403, staff -> 200
    const unauthAdmin = await fetch(`${ctx.baseUrl}/api/admin/overview`);
    assert.equal(unauthAdmin.status, 401);

    const eceAdmin = await fetch(`${ctx.baseUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${ece.token}` },
    });
    assert.equal(eceAdmin.status, 403);

    const efeAdmin = await fetch(`${ctx.baseUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(efeAdmin.status, 403);

    const okAdmin = await fetch(`${ctx.baseUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    assert.equal(okAdmin.status, 200);

    // Preferences requires auth
    const unauthPref = await fetch(`${ctx.baseUrl}/api/social/preferences`);
    assert.equal(unauthPref.status, 401);

    // Rate limiting headers & 429 enforcement on auth login endpoint (max 30/min)
    let got429 = false;
    let sawRateHeaders = false;
    for (let i = 0; i < 35; i++) {
      const r = await fetch(`${ctx.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong' }),
      });
      if (r.headers.get('x-ratelimit-limit')) sawRateHeaders = true;
      if (r.status === 429) {
        got429 = true;
        assert.ok(r.headers.get('retry-after'));
        assert.equal(r.headers.get('x-ratelimit-remaining'), '0');
        break;
      }
    }
    assert.ok(sawRateHeaders);
    assert.ok(got429);
  } finally {
    await ctx.cleanup();
  }
});
