import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { createApp } from '../../server';
import { getSchemaVersion } from '../db/migrations';

function withStage6CalendarServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanatsahnede-s6cal-'));
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

test('Stage 6 Migration v10: event social & smart production calendar schema tables/columns exist', async () => {
  const ctx = withStage6CalendarServer();
  try {
    assert.ok(getSchemaVersion(ctx.db) >= 10);

    const regCols = (ctx.db.prepare('PRAGMA table_info(event_registrations)').all() as any[]).map((c) => c.name);
    assert.ok(regCols.includes('visibility'));

    const evtCols = (ctx.db.prepare('PRAGMA table_info(events)').all() as any[]).map((c) => c.name);
    assert.ok(evtCols.includes('lounge_community_id'));
    assert.ok(evtCols.includes('lounge_channel_id'));

    const availCols = (ctx.db.prepare('PRAGMA table_info(availability_slots)').all() as any[]).map((c) => c.name);
    assert.ok(availCols.includes('visibility'));

    const tableNames = (
      ctx.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>
    ).map((r) => r.name);
    assert.ok(tableNames.includes('event_reminders'));
    assert.ok(tableNames.includes('scheduling_polls'));
    assert.ok(tableNames.includes('scheduling_poll_options'));
    assert.ok(tableNames.includes('scheduling_poll_votes'));
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 6 Event Social Layer: opt-in privacy, zero PII leak, event lounge creation, reminders & upcoming schedule privacy', async () => {
  const ctx = withStage6CalendarServer();
  try {
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const selin = await loginAs(ctx.baseUrl, 'selin@istanbulstringtrio.com');
    const ece = await loginAs(ctx.baseUrl, 'izleyici@sanatsever.com');

    // Find a published free event (or create one via admin)
    const freeRow = ctx.db
      .prepare(`SELECT id, event_date FROM events WHERE status = 'published' AND (is_free = 1 OR ticket_price = 0) LIMIT 1`)
      .get() as { id: string; event_date: string } | undefined;
    assert.ok(freeRow, 'Seeded free published event must exist');

    // Ece registers as PRIVATE (opt-out)
    const eceRegRes = await fetch(`${ctx.baseUrl}/api/events/${freeRow.id}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ece.token}` },
      body: JSON.stringify({ visibility: 'private' }),
    });
    assert.equal(eceRegRes.status, 201);

    // Efe registers as PUBLIC_ATTENDEE (opt-in)
    const efeRegRes = await fetch(`${ctx.baseUrl}/api/events/${freeRow.id}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${efe.token}` },
      body: JSON.stringify({ visibility: 'public_attendee' }),
    });
    assert.equal(efeRegRes.status, 201);

    // Public attendees endpoint must ONLY include Efe and NEVER leak Ece or PII
    const attRes = await fetch(`${ctx.baseUrl}/api/events/${freeRow.id}/attendees`);
    assert.equal(attRes.status, 200);
    const attData = (await attRes.json()) as any;
    assert.equal(attData.totalCount, 2);
    assert.equal(attData.publicCount, 1);
    assert.equal(attData.attendees.length, 1);
    assert.equal(attData.attendees[0].userId, efe.user.id);
    assert.equal(attData.attendees[0].attendeeEmail, undefined);
    assert.equal(attData.attendees[0].attendeePhone, undefined);
    assert.equal(attData.attendees[0].ticketCode, undefined);

    // Toggle Ece to public_attendee -> appears; toggle back -> disappears
    const toggleOnRes = await fetch(`${ctx.baseUrl}/api/events/${freeRow.id}/register/visibility`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ece.token}` },
      body: JSON.stringify({ visibility: 'public_attendee' }),
    });
    assert.equal(toggleOnRes.status, 200);

    const attAfterOn = (await (await fetch(`${ctx.baseUrl}/api/events/${freeRow.id}/attendees`)).json()) as any;
    assert.equal(attAfterOn.publicCount, 2);

    const toggleOffRes = await fetch(`${ctx.baseUrl}/api/events/${freeRow.id}/register/visibility`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ece.token}` },
      body: JSON.stringify({ visibility: 'private' }),
    });
    assert.equal(toggleOffRes.status, 200);

    const attAfterOff = (await (await fetch(`${ctx.baseUrl}/api/events/${freeRow.id}/attendees`)).json()) as any;
    assert.equal(attAfterOff.publicCount, 1);
    assert.ok(attAfterOff.attendees.every((a: any) => a.userId !== ece.user.id));

    // Event lounge auto-creates community + #etkinlik-sohbeti channel & joins caller
    const loungeRes = await fetch(`${ctx.baseUrl}/api/events/${freeRow.id}/lounge`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(loungeRes.status, 200);
    const loungeData = (await loungeRes.json()) as any;
    assert.ok(loungeData.communityId);
    assert.ok(loungeData.channelId);

    const chRow = ctx.db
      .prepare('SELECT slug, community_id FROM community_channels WHERE id = ?')
      .get(loungeData.channelId) as any;
    assert.equal(chRow.slug, 'etkinlik-sohbeti');
    assert.equal(chRow.community_id, loungeData.communityId);

    // Reminders CRUD
    const addRemRes = await fetch(`${ctx.baseUrl}/api/events/${freeRow.id}/reminder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${efe.token}` },
      body: JSON.stringify({ remindAt: `${freeRow.event_date} 10:00`, note: 'Ses kontrolü öncesi' }),
    });
    assert.equal(addRemRes.status, 201);

    const listRemRes = await fetch(`${ctx.baseUrl}/api/events/me/reminders`, {
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(listRemRes.status, 200);
    const remData = (await listRemRes.json()) as any;
    assert.ok(remData.reminders.some((r: any) => r.eventId === freeRow.id && r.note === 'Ses kontrolü öncesi'));

    // Upcoming schedule on artist profile respects private profile visibility
    const upPublicRes = await fetch(`${ctx.baseUrl}/api/calendar/users/${efe.user.id}/upcoming`, {
      headers: { Authorization: `Bearer ${selin.token}` },
    });
    assert.equal(upPublicRes.status, 200);
    const upPublic = (await upPublicRes.json()) as any;
    assert.equal(upPublic.hidden, false);
    assert.ok(upPublic.items.some((it: any) => it.kind === 'event_attending' && it.targetEntityId === freeRow.id));

    // Set Efe's profile to private -> Selin gets hidden: true and empty items, Efe still sees own
    ctx.db.prepare(`UPDATE individual_profiles SET profile_visibility = 'private' WHERE user_id = ?`).run(efe.user.id);
    const upPrivateOther = (await (
      await fetch(`${ctx.baseUrl}/api/calendar/users/${efe.user.id}/upcoming`, {
        headers: { Authorization: `Bearer ${selin.token}` },
      })
    ).json()) as any;
    assert.equal(upPrivateOther.hidden, true);
    assert.equal(upPrivateOther.items.length, 0);

    const upPrivateSelf = (await (
      await fetch(`${ctx.baseUrl}/api/calendar/users/${efe.user.id}/upcoming`, {
        headers: { Authorization: `Bearer ${efe.token}` },
      })
    ).json()) as any;
    assert.equal(upPrivateSelf.hidden, false);
    assert.ok(upPrivateSelf.items.length > 0);

    // Delete reminder
    const delRemRes = await fetch(`${ctx.baseUrl}/api/events/${freeRow.id}/reminder`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(delRemRes.status, 200);
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 6 Availability Engine: visibility sanitization, recurring conflict 409, owner isolation, and PATCH validation', async () => {
  const ctx = withStage6CalendarServer();
  try {
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const selin = await loginAs(ctx.baseUrl, 'selin@istanbulstringtrio.com');
    const ece = await loginAs(ctx.baseUrl, 'izleyici@sanatsever.com');
    const venueMgr = await loginAs(ctx.baseUrl, 'sahne@kadikoyakustik.com');

    // Efe creates a private booked slot (should NOT expose private title/notes to outsiders)
    const privRes = await fetch(`${ctx.baseUrl}/api/availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${efe.token}` },
      body: JSON.stringify({
        ownerType: 'artist',
        ownerId: 'artist_efe_ozkan',
        ownerName: 'Efe Özkan',
        title: 'Gizli Stüdyo Kaydı',
        slotDate: '2027-06-10',
        startTime: '14:00',
        endTime: '16:00',
        recurrence: 'weekly',
        slotKind: 'booked',
        visibility: 'private',
        notes: 'Çok gizli kontrat detayı',
      }),
    });
    assert.equal(privRes.status, 201);
    const privData = (await privRes.json()) as any;
    const privSlotId = privData.slot.id;

    // Efe creates a project_team slot -> visible to teammate Selin (in proj_bogaz_senfonisi), hidden from outsider Ece
    const teamRes = await fetch(`${ctx.baseUrl}/api/availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${efe.token}` },
      body: JSON.stringify({
        ownerType: 'artist',
        ownerId: 'artist_efe_ozkan',
        ownerName: 'Efe Özkan',
        title: 'Boğaz Projesi Takım Provası',
        slotDate: '2027-06-11',
        startTime: '15:00',
        endTime: '17:00',
        recurrence: 'once',
        slotKind: 'available',
        visibility: 'project_team',
        notes: 'Ekip içi not',
      }),
    });
    assert.equal(teamRes.status, 201);
    const teamSlotId = ((await teamRes.json()) as any).slot.id;

    // Unauthenticated & Ece must NOT see private or project_team slots
    const anonList = (await (await fetch(`${ctx.baseUrl}/api/availability`)).json()) as any;
    assert.ok(anonList.slots.every((s: any) => s.id !== privSlotId && s.id !== teamSlotId));

    const eceList = (await (
      await fetch(`${ctx.baseUrl}/api/availability`, { headers: { Authorization: `Bearer ${ece.token}` } })
    ).json()) as any;
    assert.ok(eceList.slots.every((s: any) => s.id !== privSlotId && s.id !== teamSlotId));

    // Teammate Selin sees project_team slot but NOT private slot
    const selinList = (await (
      await fetch(`${ctx.baseUrl}/api/availability`, { headers: { Authorization: `Bearer ${selin.token}` } })
    ).json()) as any;
    assert.ok(selinList.slots.some((s: any) => s.id === teamSlotId));
    assert.ok(selinList.slots.every((s: any) => s.id !== privSlotId));

    // Recurring weekly conflict check: 2027-06-17 is +7 days after 2027-06-10 -> overlaps 14:30-15:30 => 409
    const recConflictRes = await fetch(`${ctx.baseUrl}/api/availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${efe.token}` },
      body: JSON.stringify({
        ownerType: 'artist',
        ownerId: 'artist_efe_ozkan',
        ownerName: 'Efe Özkan',
        title: 'Çakışan Kayıt',
        slotDate: '2027-06-17',
        startTime: '14:30',
        endTime: '15:30',
        recurrence: 'once',
        slotKind: 'booked',
      }),
    });
    assert.equal(recConflictRes.status, 409);

    // Different owner (venue_kadikoy_akustik) at the exact same date & time is allowed (201)
    const otherOwnerRes = await fetch(`${ctx.baseUrl}/api/availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${venueMgr.token}` },
      body: JSON.stringify({
        ownerType: 'venue',
        ownerId: 'venue_kadikoy_akustik',
        ownerName: 'Kadıköy Akustik Sahne & Stüdyo',
        title: 'Mekân Açık Sahne',
        slotDate: '2027-06-17',
        startTime: '14:30',
        endTime: '15:30',
        recurrence: 'once',
        slotKind: 'open_stage',
      }),
    });
    assert.equal(otherOwnerRes.status, 201);

    // PATCH validation: updating teamSlot to conflict with weekly privSlot on 2027-06-24 14:30-15:30 => 409
    const patchConflictRes = await fetch(`${ctx.baseUrl}/api/availability/${teamSlotId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${efe.token}` },
      body: JSON.stringify({
        slotDate: '2027-06-24',
        startTime: '14:30',
        endTime: '15:30',
      }),
    });
    assert.equal(patchConflictRes.status, 409);

    // Confirmed booking overlap check: booking_sample_confirmed_01 is Efe's booking on 2026-11-28 20:00-21:30
    const bkRow = ctx.db
      .prepare(`SELECT event_date, start_time, end_time FROM bookings WHERE performer_user_id = ? AND status = 'confirmed' LIMIT 1`)
      .get(efe.user.id) as any;
    if (bkRow) {
      const bkConflictRes = await fetch(`${ctx.baseUrl}/api/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${efe.token}` },
        body: JSON.stringify({
          ownerType: 'artist',
          ownerId: 'artist_efe_ozkan',
          ownerName: 'Efe Özkan',
          title: 'Rezervasyon Çakışması',
          slotDate: bkRow.event_date,
          startTime: bkRow.start_time || '20:00',
          endTime: bkRow.end_time || '21:30',
          recurrence: 'once',
          slotKind: 'open_stage',
        }),
      });
      assert.equal(bkConflictRes.status, 409);
    }
  } finally {
    await ctx.cleanup();
  }
});

test('Stage 6 Personal Calendar & Collaborative Scheduling Polls: aggregation, RBAC, conflict evaluation, atomic finalization & ICS', async () => {
  const ctx = withStage6CalendarServer();
  try {
    const efe = await loginAs(ctx.baseUrl, 'efeozkaniletisim@gmail.com');
    const selin = await loginAs(ctx.baseUrl, 'selin@istanbulstringtrio.com');
    const ece = await loginAs(ctx.baseUrl, 'izleyici@sanatsever.com');

    // Add a private booked conflict for Efe on 2027-07-15 19:00-21:00 with a private note
    await fetch(`${ctx.baseUrl}/api/availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${efe.token}` },
      body: JSON.stringify({
        ownerType: 'artist',
        ownerId: 'artist_efe_ozkan',
        ownerName: 'Efe Özkan',
        title: 'ÖZEL SÖZLEŞME KONSERİ',
        slotDate: '2027-07-15',
        startTime: '19:00',
        endTime: '21:00',
        recurrence: 'once',
        slotKind: 'booked',
        visibility: 'private',
        notes: 'GİZLİ KAŞE NOTU 99999',
      }),
    });

    // Selin creates a Scheduling Poll on proj_bogaz_senfonisi (members: Selin & Efe) using venue_kadikoy_akustik
    // Note: slot_2 in seed is weekly on Wednesday 10:00-13:00 (2026-12-02 is Wednesday).
    // Let's also add a venue booked slot on 2027-07-16 19:00-21:00 to test venue conflict!
    ctx.db
      .prepare(
        `INSERT INTO availability_slots (
          id, owner_type, owner_id, owner_user_id, owner_name, title, slot_date,
          start_time, end_time, recurrence, slot_kind, visibility, is_free, fee_amount, city, notes, created_at
        ) VALUES ('slot_venue_busy_s6', 'venue', 'venue_kadikoy_akustik', 'user_venue_akm', 'Kadıköy Akustik Sahne & Stüdyo', 'Mekân Özel Kiralama', '2027-07-16', '19:00', '21:00', 'once', 'booked', 'private', 0, 0, 'İstanbul', '', ?)`
      )
      .run(new Date().toISOString());

    const createPollRes = await fetch(`${ctx.baseUrl}/api/scheduling-polls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${selin.token}` },
      body: JSON.stringify({
        contextType: 'project',
        contextId: 'proj_bogaz_senfonisi',
        title: 'Genel Sahne & Akustik Provası',
        description: 'Boğazın Yankıları 1. sahne provası zamanlaması.',
        venueId: 'venue_kadikoy_akustik',
        durationMins: 120,
        options: [
          { optionDate: '2027-07-15', startTime: '19:00', endTime: '21:00', notes: 'Seçenek 1 (Efe çakışmalı)' },
          { optionDate: '2027-07-16', startTime: '19:00', endTime: '21:00', notes: 'Seçenek 2 (Mekân dolu)' },
          { optionDate: '2027-07-18', startTime: '19:00', endTime: '21:00', notes: 'Seçenek 3 (Herkese uygun)' },
        ],
      }),
    });
    assert.equal(createPollRes.status, 201);
    const createdPoll = ((await createPollRes.json()) as any).poll;
    assert.equal(createdPoll.options.length, 3);

    const optConflictEfe = createdPoll.options[0];
    const optConflictVenue = createdPoll.options[1];
    const optClean = createdPoll.options[2];

    // Check privacy: Selin sees Efe has a calendarConflictCount=1 on optConflictEfe, WITHOUT Efe's private slot title/notes
    const pollSerialized = JSON.stringify(createdPoll);
    assert.ok(!pollSerialized.includes('ÖZEL SÖZLEŞME KONSERİ'));
    assert.ok(!pollSerialized.includes('GİZLİ KAŞE NOTU 99999'));

    const eval1 = createdPoll.evaluations.find((e: any) => e.optionId === optConflictEfe.id);
    const eval2 = createdPoll.evaluations.find((e: any) => e.optionId === optConflictVenue.id);
    const eval3 = createdPoll.evaluations.find((e: any) => e.optionId === optClean.id);
    assert.equal(eval1.calendarConflictCount, 1);
    assert.equal(eval2.venueStatus, 'conflict');
    assert.equal(eval3.calendarConflictCount, 0);
    assert.equal(eval3.venueStatus, 'available');

    // RBAC: outsider Ece cannot view polls of proj_bogaz_senfonisi or vote on it
    const ecePollList = (await (
      await fetch(`${ctx.baseUrl}/api/scheduling-polls?contextType=project&contextId=proj_bogaz_senfonisi`, {
        headers: { Authorization: `Bearer ${ece.token}` },
      })
    ).json()) as any;
    assert.equal(ecePollList.polls.length, 0);

    const eceVoteRes = await fetch(`${ctx.baseUrl}/api/scheduling-polls/${createdPoll.id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ece.token}` },
      body: JSON.stringify({ optionId: optClean.id, response: 'available' }),
    });
    assert.equal(eceVoteRes.status, 403);

    // Selin & Efe vote available on optClean
    await fetch(`${ctx.baseUrl}/api/scheduling-polls/${createdPoll.id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${selin.token}` },
      body: JSON.stringify({
        votes: [
          { optionId: optClean.id, response: 'available' },
          { optionId: optConflictEfe.id, response: 'maybe' },
        ],
      }),
    });
    const efeVoteRes = await fetch(`${ctx.baseUrl}/api/scheduling-polls/${createdPoll.id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${efe.token}` },
      body: JSON.stringify({
        votes: [
          { optionId: optClean.id, response: 'available' },
          { optionId: optConflictEfe.id, response: 'unavailable' },
        ],
      }),
    });
    assert.equal(efeVoteRes.status, 200);
    const afterVotes = ((await efeVoteRes.json()) as any).poll;
    const cleanEval = afterVotes.evaluations.find((e: any) => e.optionId === optClean.id);
    assert.equal(cleanEval.availableCount, 2);
    assert.equal(cleanEval.isRecommended, true);

    // Finalizing optConflictVenue MUST fail atomically with 409 Conflict
    const finVenueFail = await fetch(`${ctx.baseUrl}/api/scheduling-polls/${createdPoll.id}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${selin.token}` },
      body: JSON.stringify({ optionId: optConflictVenue.id }),
    });
    assert.equal(finVenueFail.status, 409);

    // Finalizing optConflictEfe without force MUST fail with 409 Conflict
    const finEfeFail = await fetch(`${ctx.baseUrl}/api/scheduling-polls/${createdPoll.id}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${selin.token}` },
      body: JSON.stringify({ optionId: optConflictEfe.id }),
    });
    assert.equal(finEfeFail.status, 409);

    // Finalizing optClean succeeds (200), saves project meeting, reserves venue slot, & notifies Efe
    const finOkRes = await fetch(`${ctx.baseUrl}/api/scheduling-polls/${createdPoll.id}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${selin.token}` },
      body: JSON.stringify({ optionId: optClean.id }),
    });
    assert.equal(finOkRes.status, 200);
    const finPoll = ((await finOkRes.json()) as any).poll;
    assert.equal(finPoll.status, 'finalized');
    assert.equal(finPoll.finalizedOptionId, optClean.id);

    // Verify project meeting persisted
    const projRow = ctx.db.prepare('SELECT meetings_json FROM projects WHERE id = ?').get('proj_bogaz_senfonisi') as any;
    const meetings = JSON.parse(projRow.meetings_json);
    assert.ok(meetings.some((m: any) => m.title === 'Genel Sahne & Akustik Provası' && String(m.meetingDate).includes('2027-07-18')));

    // Verify venue slot reserved atomically
    const venueReserved = ctx.db
      .prepare(`SELECT * FROM availability_slots WHERE owner_type = 'venue' AND owner_id = 'venue_kadikoy_akustik' AND slot_date = '2027-07-18' AND slot_kind = 'booked'`)
      .get() as any;
    assert.ok(venueReserved);

    // Verify notification sent to Efe
    const efeNotif = ctx.db
      .prepare(`SELECT * FROM notifications WHERE user_id = ? AND type = 'scheduling_poll_finalized'`)
      .get(efe.user.id) as any;
    assert.ok(efeNotif);

    // Poll .ics export
    const pollIcsRes = await fetch(`${ctx.baseUrl}/api/scheduling-polls/${createdPoll.id}/ics`, {
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(pollIcsRes.status, 200);
    const pollIcsText = await pollIcsRes.text();
    assert.ok(pollIcsText.includes('BEGIN:VCALENDAR'));
    assert.ok(pollIcsText.includes('20270718T190000'));

    // Personal calendar aggregation (/api/calendar/me) & /api/calendar/me/ics
    const calRes = await fetch(`${ctx.baseUrl}/api/calendar/me?startDate=2027-07-01&endDate=2027-07-31`, {
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(calRes.status, 200);
    const calData = (await calRes.json()) as any;
    assert.ok(calData.entries.some((e: any) => e.type === 'project_meeting' && e.date === '2027-07-18'));
    assert.ok(calData.entries.some((e: any) => e.type === 'availability' && e.date === '2027-07-15'));

    // Filter by types=project_meeting returns only project_meeting entries
    const filteredCalRes = await fetch(
      `${ctx.baseUrl}/api/calendar/me?startDate=2027-07-01&endDate=2027-07-31&types=project_meeting`,
      { headers: { Authorization: `Bearer ${efe.token}` } }
    );
    const filteredCal = (await filteredCalRes.json()) as any;
    assert.ok(filteredCal.entries.length >= 1);
    assert.ok(filteredCal.entries.every((e: any) => e.type === 'project_meeting'));

    const meIcsRes = await fetch(`${ctx.baseUrl}/api/calendar/me/ics`, {
      headers: { Authorization: `Bearer ${efe.token}` },
    });
    assert.equal(meIcsRes.status, 200);
    const meIcs = await meIcsRes.text();
    assert.ok(meIcs.includes('BEGIN:VCALENDAR'));
    assert.ok(meIcs.includes('BEGIN:VEVENT'));
  } finally {
    await ctx.cleanup();
  }
});
