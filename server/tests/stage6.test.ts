import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import WebSocket from 'ws';
import { createApp } from '../../server';
import { getSchemaVersion } from '../db/migrations';

function withStage6TestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanatsahnede-stage6-'));
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

test('Stage 6.1: Migration v8 adds listing coordinates/indexes and geo map-points supports listings & businesses with block filtering', async () => {
  const ctx = withStage6TestServer();
  try {
    assert.ok(getSchemaVersion(ctx.db) >= 8);

    const listCols = (ctx.db.prepare('PRAGMA table_info(listings)').all() as any[]).map((c) => c.name);
    assert.ok(listCols.includes('latitude'));
    assert.ok(listCols.includes('longitude'));

    // Public geo map points for listings & businesses
    const listingsGeoRes = await fetch(`${ctx.baseUrl}/api/geo/map-points?type=listings`);
    assert.equal(listingsGeoRes.status, 200);
    const listingsGeo = (await listingsGeoRes.json()) as any;
    assert.ok(Array.isArray(listingsGeo.points));
    assert.ok(listingsGeo.points.length > 0);
    assert.ok(listingsGeo.points.every((p: any) => p.kind === 'listing' && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)));

    const bizGeoRes = await fetch(`${ctx.baseUrl}/api/geo/map-points?type=businesses`);
    assert.equal(bizGeoRes.status, 200);
    const bizGeo = (await bizGeoRes.json()) as any;
    assert.ok(bizGeo.points.length > 0);
    assert.ok(bizGeo.points.every((p: any) => p.kind === 'business'));

    // Authenticated block filtering removes blocked owner listings/businesses from geo points
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const deniz = await loginAs(ctx.baseUrl, 'etkinlik@grandbosphorus.com');

    const blockRes = await fetch(`${ctx.baseUrl}/api/social/block/${deniz.user.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${efe.token}` },
      body: JSON.stringify({ reason: 'Test engel' }),
    });
    assert.equal(blockRes.status, 201);

    const filteredGeoRes = await fetch(`${ctx.baseUrl}/api/geo/map-points?type=listings`, {
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    const filteredGeo = (await filteredGeoRes.json()) as any;
    const denizBizIds = new Set(
      (ctx.db.prepare('SELECT id FROM business_profiles WHERE user_id = ?').all(deniz.user.id) as any[]).map((b) => b.id)
    );
    const denizListingIds = new Set(
      (ctx.db.prepare('SELECT id FROM listings WHERE business_id IN (SELECT id FROM business_profiles WHERE user_id = ?)').all(deniz.user.id) as any[]).map((l) => l.id)
    );
    assert.ok(denizBizIds.size > 0);
    assert.ok(filteredGeo.points.every((p: any) => !denizListingIds.has(p.id)));
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 6.2: Smart Match v2 returns verified artists & ensembles, excludes blocked performers, and flags calendar conflicts', async () => {
  const ctx = withStage6TestServer();
  try {
    const activeListing = ctx.db
      .prepare(`SELECT id, event_date, start_time, end_time FROM listings WHERE status = 'active' LIMIT 1`)
      .get() as any;
    assert.ok(activeListing);

    // Give Efe a confirmed/booked availability conflict on activeListing's date/time
    ctx.db
      .prepare(
        `INSERT INTO availability_slots (id, owner_type, owner_id, owner_user_id, owner_name, title, slot_date, start_time, end_time, recurrence, slot_kind, is_free, fee_amount, city, notes, created_at)
         VALUES ('slot_conflict_test', 'artist', 'artist_efe_ozkan', 'user_artist_efe', 'Efe Özkan', 'Çakışma Testi', ?, ?, ?, 'once', 'booked', 0, 20000, 'İstanbul', 'Test çakışma', ?)`
      )
      .run(
        activeListing.event_date,
        activeListing.start_time || '20:00',
        activeListing.end_time || '21:30',
        new Date().toISOString()
      );

    const deniz = await loginAs(ctx.baseUrl, 'etkinlik@grandbosphorus.com');
    const matchRes = await fetch(`${ctx.baseUrl}/api/listings/${activeListing.id}/smart-match`, {
      headers: { Authorization: `Bearer ${deniz.token}` },
    });
    assert.equal(matchRes.status, 200);
    const matchData = (await matchRes.json()) as any;
    assert.ok(Array.isArray(matchData.matches));
    assert.ok(matchData.matches.length > 0);
    assert.ok(matchData.matches.some((m: any) => m.entityType === 'artist'));
    assert.ok(matchData.matches.some((m: any) => m.entityType === 'ensemble'));

    const efeMatch = matchData.matches.find((m: any) => m.entityId === 'artist_efe_ozkan');
    if (efeMatch) {
      const dateCrit = efeMatch.criteria.find((c: any) => c.label === 'Tarih & Müsaitlik');
      assert.ok(dateCrit && dateCrit.level === 'kısmi');
    }

    // Block Selin (ensemble leader) -> Selin's ensemble disappears from Smart Match for Deniz
    const selin = await loginAs(ctx.baseUrl, 'selin@istanbulstringtrio.com');
    await fetch(`${ctx.baseUrl}/api/social/block/${selin.user.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deniz.token}` },
      body: JSON.stringify({}),
    });

    const matchAfterBlockRes = await fetch(`${ctx.baseUrl}/api/listings/${activeListing.id}/smart-match`, {
      headers: { Authorization: `Bearer ${deniz.token}` },
    });
    const matchAfterBlock = (await matchAfterBlockRes.json()) as any;
    const selinEnsembles = new Set(
      (ctx.db.prepare('SELECT id FROM ensembles WHERE leader_user_id = ?').all(selin.user.id) as any[]).map((e) => e.id)
    );
    assert.ok(matchAfterBlock.matches.every((m: any) => !selinEnsembles.has(m.entityId)));
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 6.3 & 6.6: Performer recommended listings and persistent listing bookmarks survive requests', async () => {
  const ctx = withStage6TestServer();
  try {
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');

    const recRes = await fetch(`${ctx.baseUrl}/api/performers/me/recommended-listings`, {
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(recRes.status, 200);
    const recData = (await recRes.json()) as any;
    assert.ok(Array.isArray(recData.recommendations));
    assert.ok(recData.recommendations.length > 0);
    assert.ok(recData.recommendations[0].matchedCriteriaCount >= 2);
    assert.ok(recData.recommendations[0].listing?.id);

    const targetListingId = recData.recommendations[0].listing.id;

    // Toggle persistent listing bookmark ON
    const bmOn = await fetch(`${ctx.baseUrl}/api/bookmarks/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${efe.token}` },
      body: JSON.stringify({ itemType: 'listing', itemId: targetListingId }),
    });
    assert.equal(bmOn.status, 201);
    assert.equal(((await bmOn.json()) as any).bookmarked, true);

    // Verify in bootstrap
    const bootRes = await fetch(`${ctx.baseUrl}/api/bootstrap`, {
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    const boot = (await bootRes.json()) as any;
    assert.ok(
      boot.bookmarks.some((b: any) => b.itemType === 'listing' && b.itemId === targetListingId)
    );

    // Block listing business -> listing disappears from recommended listings
    const targetBizUser = ctx.db
      .prepare('SELECT user_id FROM business_profiles WHERE id = ?')
      .get(recData.recommendations[0].listing.businessId) as any;
    if (targetBizUser) {
      await fetch(`${ctx.baseUrl}/api/social/block/${targetBizUser.user_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${efe.token}` },
        body: JSON.stringify({}),
      });
      const recAfterBlockRes = await fetch(`${ctx.baseUrl}/api/performers/me/recommended-listings`, {
        headers: { Authorization: `Bearer ${efe.token}` },
      });
      const recAfterBlock = (await recAfterBlockRes.json()) as any;
      assert.ok(recAfterBlock.recommendations.every((r: any) => r.listing.id !== targetListingId));
    }
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 6.4 & 6.5: Emergency replacement broadcasts real-time notification and booking receipt enforces strict RBAC', async () => {
  const ctx = withStage6TestServer();
  try {
    const deniz = await loginAs(ctx.baseUrl, 'etkinlik@grandbosphorus.com');
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const ece = await loginAs(ctx.baseUrl, 'izleyici@sanatsever.com');
    const admin = await loginAs(ctx.baseUrl, 'admin@sahnesanat.com');

    // Create a fresh verified Istanbul music booking under Deniz's business with a different performer so Efe receives the replacement alert
    const biz = ctx.db
      .prepare('SELECT * FROM business_profiles WHERE user_id = ? LIMIT 1')
      .get(deniz.user.id) as any;
    const origListing = ctx.db
      .prepare(`SELECT * FROM listings WHERE business_id = ? AND city = 'İstanbul' LIMIT 1`)
      .get(biz.id) as any;
    assert.ok(biz && origListing);

    const selin = await loginAs(ctx.baseUrl, 'selin@istanbulstringtrio.com');
    const now = new Date().toISOString();
    const bkId = 'bk_stage6_receipt_test';
    ctx.db
      .prepare(
        `INSERT INTO bookings (
          id, listing_id, listing_title, business_id, business_name, application_id,
          performer_type, performer_id, performer_user_id, performer_name, performer_avatar,
          event_date, start_time, end_time, venue_name, city, net_payout_amount,
          commission_amount, gross_amount, commission_model, commission_rate, status,
          performer_completed_at, employer_completed_at,
          contract_terms_accepted_by_performer, contract_terms_accepted_by_employer,
          payment_status, dispute_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'app_test', 'ensemble', 'ens_istanbul_trio', ?, 'Selin Arslan Trio', '/img.jpg', '2027-08-22', '20:00', '22:00', ?, 'İstanbul', 25000, 2500, 27500, 'A_EMPLOYER_PAYS', 10, 'cancelled', NULL, NULL, 1, 1, 'held_sandbox', 'none', ?, ?)`
      )
      .run(bkId, origListing.id, origListing.title, biz.id, biz.business_name, selin.user.id, origListing.venue_name, now, now);

    ctx.db
      .prepare(
        `INSERT INTO contracts (id, booking_id, title, terms_text, disclaimer, employer_accepted_at, performer_accepted_at, created_at)
         VALUES ('ctr_stage6', ?, 'Stage 6 İcra Sözleşmesi', 'Test sözleşme metni', 'Platform aracılık bilgilendirmesi', ?, ?, ?)`
      )
      .run(bkId, now, now, now);

    ctx.db
      .prepare(
        `INSERT INTO financial_ledger (id, booking_id, entry_type, amount, currency, provider, provider_ref, mode, notes, created_at)
         VALUES ('led_stage6', ?, 'payment_hold', 27500, 'TRY', 'iyzico_sandbox', 'sbx_stage6', 'sandbox', 'Güvence ödemesi alındı', ?)`
      )
      .run(bkId, now);

    // RBAC check on GET /api/bookings/:id/receipt
    const unauthReceipt = await fetch(`${ctx.baseUrl}/api/bookings/${bkId}/receipt`);
    assert.equal(unauthReceipt.status, 401);

    const eceReceipt = await fetch(`${ctx.baseUrl}/api/bookings/${bkId}/receipt`, {
      headers: { Authorization: `Bearer ${ece.token}` },
    });
    assert.equal(eceReceipt.status, 403);

    const employerReceiptRes = await fetch(`${ctx.baseUrl}/api/bookings/${bkId}/receipt`, {
      headers: { Authorization: `Bearer ${deniz.token}` },
    });
    assert.equal(employerReceiptRes.status, 200);
    const employerReceipt = (await employerReceiptRes.json()) as any;
    assert.ok(employerReceipt.verificationCode.startsWith('SS-'));
    assert.equal(employerReceipt.summary.totalHeldAmount, 27500);
    assert.equal(employerReceipt.contract.id, 'ctr_stage6');
    assert.equal(employerReceipt.ledgerEntries.length, 1);

    const performerReceipt = await fetch(`${ctx.baseUrl}/api/bookings/${bkId}/receipt`, {
      headers: { Authorization: `Bearer ${selin.token}` },
    });
    assert.equal(performerReceipt.status, 200);

    const adminReceipt = await fetch(`${ctx.baseUrl}/api/bookings/${bkId}/receipt`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    assert.equal(adminReceipt.status, 200);

    // Connect Efe via WebSocket and trigger Emergency Replacement from Deniz
    const efeWs = await connectWs(ctx.wsUrl, efe.token);
    try {
      const repRes = await fetch(`${ctx.baseUrl}/api/bookings/${bkId}/emergency-replacement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deniz.token}` },
        body: JSON.stringify({ urgentReason: 'Acil program değişikliği' }),
      });
      assert.equal(repRes.status, 201);
      const repData = (await repRes.json()) as any;
      assert.equal(repData.listing.isReplacement, true);
      assert.ok(repData.notifiedCount >= 1);
      assert.ok(Number.isFinite(repData.listing.latitude));

      const wsNotif = await waitForEvent(
        efeWs.events,
        (e) => e.type === 'notification:created' && e.payload?.notification?.type === 'emergency_replacement'
      );
      assert.equal(wsNotif.payload.notification.linkView, 'listing_detail');
      assert.equal(wsNotif.payload.notification.linkEntityId, repData.listing.id);
    } finally {
      efeWs.ws.close();
    }
  } finally {
    await ctx.cleanup();
  }
});
