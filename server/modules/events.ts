import { Router } from 'express';
import { DbInstance } from '../db/database';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { mapEvent, mapEventRegistration } from '../db/mappers';
import { newId, slugifyTr } from '../utils/crypto';
import { logAudit } from '../services/auditService';
import { notifyUser } from '../services/notificationService';
import { createRateLimiter } from '../middleware/rateLimit';
import { buildPaginationEnvelope, parsePaginationParams } from './directory';
import { geocodeWithCache } from '../services/geoService';
import { getMutualBlockedUserIds, resolveUserProfileLink } from '../services/socialGraphService';
import { EventAttendeePublic, EventReminder } from '../../src/types';

export function createEventsRouter(db: DbInstance): Router {
  const router = Router();
  const registrationLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 20,
    message: 'Çok fazla etkinlik kayıt denemesi yapıldı. Lütfen kısa süre sonra tekrar deneyin.',
  });

  router.get('/', (req: AuthedRequest, res) => {
    const isStaff =
      req.user &&
      ['admin', 'moderator', 'verification_officer'].includes(req.user.activeRole);

    const { page, limit, offset } = parsePaginationParams(req.query as Record<string, any>, 100, 200);
    const city = String(req.query.city || '').trim();
    const category = String(req.query.category || '').trim();
    const discipline = String(req.query.discipline || '').trim();
    const pricing = String(req.query.pricing || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase();

    const rows = db.prepare('SELECT * FROM events ORDER BY event_date ASC').all() as any[];
    const visible = rows
      .filter((e) => isStaff || e.status === 'published' || (req.user && e.creator_user_id === req.user.id))
      .map(mapEvent)
      .filter((e) => {
        if (city && city !== 'Tümü' && e.city !== city) return false;
        if (category && category !== 'Tümü' && e.category !== category) return false;
        if (discipline && discipline !== 'Tümü' && (e.discipline || 'Müzik') !== discipline) return false;
        if (pricing === 'free' && !(e.isFree || e.ticketPrice === 0)) return false;
        if (pricing === 'paid' && (e.isFree || e.ticketPrice <= 0)) return false;
        if (q) {
          const hay = `${e.title} ${e.venueName} ${e.city} ${e.performers} ${e.organizerName}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

    const slice = visible.slice(offset, offset + limit);
    return res.json({
      ...buildPaginationEnvelope(slice, visible.length, page, limit),
      events: slice,
    });
  });

  router.post('/', requireAuth, async (req: AuthedRequest, res) => {
    const {
      title,
      discipline = 'Müzik',
      category = 'Müzik & Konser',
      organizerName,
      organizerContact,
      venueName,
      city,
      district = '',
      eventDate,
      startTime = '20:00',
      endTime,
      genres = ['Klasik Müzik'],
      performers = '',
      ticketPrice = 0,
      isFree = false,
      ticketUrl,
      description,
      posterUrl,
      accessibilitySummary = [],
    } = req.body || {};

    if (!title || !venueName || !city || !eventDate || !description) {
      return res.status(400).json({ error: 'Etkinlik başlığı, mekân, şehir, tarih ve açıklama zorunludur.' });
    }

    const id = newId('evt');
    const now = new Date().toISOString();
    const isPrivileged = ['admin', 'moderator'].includes(req.user!.activeRole);
    const status = isPrivileged ? 'published' : 'pending_moderation';

    const geo = await geocodeWithCache(db, {
      query: [venueName, district, city].filter(Boolean).join(', '),
      city: String(city).trim(),
      district: String(district || '').trim(),
    });

    db.prepare(`
      INSERT INTO events (
        id, creator_user_id, title, discipline, category, organizer_name, organizer_contact,
        venue_name, city, district, event_date, start_time, end_time, genres_json,
        performers, ticket_price, is_free, ticket_url, description, poster_url, status,
        accessibility_summary_json, latitude, longitude, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      req.user!.id,
      String(title).trim(),
      discipline,
      category,
      organizerName || `${req.user!.firstName} ${req.user!.lastName}`.trim(),
      organizerContact || req.user!.email,
      String(venueName).trim(),
      String(city).trim(),
      district,
      eventDate,
      startTime,
      endTime || null,
      JSON.stringify(Array.isArray(genres) ? genres : []),
      performers,
      isFree ? 0 : Number(ticketPrice || 0),
      isFree ? 1 : 0,
      ticketUrl || null,
      String(description).trim(),
      posterUrl || '/src/assets/images/venue_cultural_foundation_1794582678466.jpg',
      status,
      JSON.stringify(Array.isArray(accessibilitySummary) ? accessibilitySummary : []),
      geo.latitude,
      geo.longitude,
      now
    );

    if (status === 'pending_moderation') {
      notifyUser(db, {
        userId: 'user_admin',
        type: 'moderation_needed',
        title: 'Yeni Etkinlik Onayı Bekliyor',
        body: `"${title}" etkinliği moderasyon kuyruğuna eklendi.`,
        linkView: 'admin_panel',
      });
    }

    logAudit(db, {
      userId: req.user!.id,
      action: 'CREATE_EVENT',
      resourceType: 'event',
      resourceId: id,
      details: { status },
    });

    const created = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
    return res.status(201).json({ event: mapEvent(created) });
  });

  router.patch('/:id', requireAuth, (req: AuthedRequest, res) => {
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Etkinlik bulunamadı.' });

    const isStaff = ['admin', 'moderator'].includes(req.user!.activeRole);
    if (row.creator_user_id !== req.user!.id && !isStaff) {
      return res.status(403).json({ error: 'Bu etkinliği düzenleme yetkiniz yok.' });
    }

    const {
      title,
      discipline,
      category,
      organizerName,
      organizerContact,
      venueName,
      city,
      district,
      eventDate,
      startTime,
      endTime,
      genres,
      performers,
      ticketPrice,
      isFree,
      ticketUrl,
      description,
      posterUrl,
      accessibilitySummary,
    } = req.body || {};

    db.prepare(`
      UPDATE events SET
        title = COALESCE(?, title),
        discipline = COALESCE(?, discipline),
        category = COALESCE(?, category),
        organizer_name = COALESCE(?, organizer_name),
        organizer_contact = COALESCE(?, organizer_contact),
        venue_name = COALESCE(?, venue_name),
        city = COALESCE(?, city),
        district = COALESCE(?, district),
        event_date = COALESCE(?, event_date),
        start_time = COALESCE(?, start_time),
        end_time = COALESCE(?, end_time),
        genres_json = COALESCE(?, genres_json),
        performers = COALESCE(?, performers),
        ticket_price = COALESCE(?, ticket_price),
        is_free = COALESCE(?, is_free),
        ticket_url = COALESCE(?, ticket_url),
        description = COALESCE(?, description),
        poster_url = COALESCE(?, poster_url),
        accessibility_summary_json = COALESCE(?, accessibility_summary_json)
      WHERE id = ?
    `).run(
      title !== undefined ? String(title).trim() : null,
      discipline ?? null,
      category ?? null,
      organizerName ?? null,
      organizerContact ?? null,
      venueName ?? null,
      city ?? null,
      district ?? null,
      eventDate ?? null,
      startTime ?? null,
      endTime ?? null,
      genres !== undefined ? JSON.stringify(Array.isArray(genres) ? genres : []) : null,
      performers ?? null,
      isFree === true ? 0 : ticketPrice !== undefined ? Number(ticketPrice) : null,
      isFree !== undefined ? (isFree ? 1 : 0) : null,
      ticketUrl ?? null,
      description !== undefined ? String(description).trim() : null,
      posterUrl ?? null,
      accessibilitySummary !== undefined ? JSON.stringify(Array.isArray(accessibilitySummary) ? accessibilitySummary : []) : null,
      row.id
    );

    logAudit(db, { userId: req.user!.id, action: 'UPDATE_EVENT', resourceType: 'event', resourceId: row.id });
    const updated = db.prepare('SELECT * FROM events WHERE id = ?').get(row.id);
    return res.json({ event: mapEvent(updated) });
  });

  router.delete('/:id', requireAuth, (req: AuthedRequest, res) => {
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Etkinlik bulunamadı.' });

    const isStaff = ['admin', 'moderator'].includes(req.user!.activeRole);
    if (row.creator_user_id !== req.user!.id && !isStaff) {
      return res.status(403).json({ error: 'Bu etkinliği silme yetkiniz yok.' });
    }

    db.prepare('DELETE FROM events WHERE id = ?').run(row.id);
    logAudit(db, { userId: req.user!.id, action: 'DELETE_EVENT', resourceType: 'event', resourceId: row.id });
    return res.json({ success: true });
  });

  // 9.9 Calendar .ics export
  router.get('/:id/ics', (req, res) => {
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Etkinlik bulunamadı.' });

    const dateClean = String(row.event_date).replace(/-/g, '');
    const startClean = `${String(row.start_time || '20:00').replace(':', '')}00`;
    const endClean = `${String(row.end_time || '22:00').replace(':', '')}00`;

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SanatSahnede//Kultur Takvimi//TR',
      'BEGIN:VEVENT',
      `UID:${row.id}@sanatsahnede.com`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
      `DTSTART:${dateClean}T${startClean}`,
      `DTEND:${dateClean}T${endClean}`,
      `SUMMARY:${String(row.title).replace(/\n/g, ' ')}`,
      `LOCATION:${row.venue_name}, ${row.city}`,
      `DESCRIPTION:${String(row.description).replace(/\n/g, ' ')}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sanatsahnede-${row.id}.ics"`);
    return res.send(ics);
  });

  // Logged-in user's event reminders (registered BEFORE /:id to avoid route shadowing)
  router.get('/me/reminders', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare(
        `SELECT er.*, e.title as event_title, e.event_date, e.start_time, e.venue_name, e.city
         FROM event_reminders er
         JOIN events e ON e.id = er.event_id
         WHERE er.user_id = ?
         ORDER BY e.event_date ASC, er.created_at DESC`
      )
      .all(req.user!.id) as any[];

    const reminders: Array<
      EventReminder & {
        eventTitle: string;
        eventDate: string;
        startTime: string;
        venueName: string;
        city: string;
      }
    > = rows.map((r) => ({
      id: r.id,
      eventId: r.event_id,
      userId: r.user_id,
      remindAt: r.remind_at,
      note: r.note || '',
      createdAt: r.created_at,
      eventTitle: r.event_title,
      eventDate: r.event_date,
      startTime: r.start_time || '20:00',
      venueName: r.venue_name,
      city: r.city,
    }));

    return res.json({ reminders });
  });

  // Single Event Detail
  router.get('/:id', (req: AuthedRequest, res) => {
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Etkinlik bulunamadı.' });

    const isStaff =
      req.user &&
      ['admin', 'moderator', 'verification_officer'].includes(req.user.activeRole);
    const isVisible =
      isStaff ||
      row.status === 'published' ||
      (req.user && row.creator_user_id === req.user.id);

    if (!isVisible) {
      return res.status(404).json({ error: 'Etkinlik bulunamadı.' });
    }

    const countRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM event_registrations WHERE event_id = ? AND status = 'confirmed'`)
      .get(row.id) as { cnt: number };

    return res.json({
      event: mapEvent(row),
      registrationCount: Number(countRow?.cnt || 0),
    });
  });

  // Free Event Registration (authenticated or guest with name + email)
  router.post('/:id/register', registrationLimiter, (req: AuthedRequest, res) => {
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id) as any;
    if (!row || row.status !== 'published') {
      return res.status(404).json({ error: 'Kayıt yapılabilecek yayınlanmış bir etkinlik bulunamadı.' });
    }

    const isFreeEvent = Boolean(row.is_free) || Number(row.ticket_price || 0) <= 0;
    if (!isFreeEvent) {
      return res.status(400).json({ error: 'Bu etkinlik ücretlidir. Lütfen bilet satış bağlantısını kullanınız.' });
    }

    const body = req.body || {};
    const attendeeName = String(
      body.attendeeName ||
        (req.user ? `${req.user.firstName} ${req.user.lastName}`.trim() : '')
    ).trim();
    const attendeeEmail = String(
      body.attendeeEmail || (req.user ? req.user.email : '')
    )
      .trim()
      .toLowerCase();
    const attendeePhone = String(body.attendeePhone || (req.user ? req.user.phone || '' : '')).trim();
    const notes = String(body.notes || '').trim();
    const visibility = body.visibility === 'public_attendee' ? 'public_attendee' : 'private';

    if (!attendeeName || attendeeName.length < 2) {
      return res.status(400).json({ error: 'Katılımcı ad soyad bilgisi zorunludur.' });
    }
    if (!attendeeEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attendeeEmail)) {
      return res.status(400).json({ error: 'Geçerli bir e-posta adresi giriniz.' });
    }

    const existing = req.user
      ? (db
          .prepare(
            `SELECT * FROM event_registrations WHERE event_id = ? AND status = 'confirmed' AND (user_id = ? OR LOWER(attendee_email) = ?)`
          )
          .get(row.id, req.user.id, attendeeEmail) as any)
      : (db
          .prepare(
            `SELECT * FROM event_registrations WHERE event_id = ? AND status = 'confirmed' AND LOWER(attendee_email) = ?`
          )
          .get(row.id, attendeeEmail) as any);

    if (existing) {
      return res.status(409).json({
        error: 'Bu etkinlik için aktif bir kaydınız zaten bulunmaktadır.',
        registration: mapEventRegistration(existing),
      });
    }

    const id = newId('evreg');
    const now = new Date().toISOString();
    const ticketCode = `SS-${String(row.id).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-4)}-${Math.random()
      .toString(36)
      .substring(2, 6)
      .toUpperCase()}`;

    db.prepare(`
      INSERT INTO event_registrations (
        id, event_id, user_id, attendee_name, attendee_email, attendee_phone, notes, ticket_code, visibility, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
    `).run(
      id,
      row.id,
      req.user ? req.user.id : null,
      attendeeName,
      attendeeEmail,
      attendeePhone,
      notes,
      ticketCode,
      visibility,
      now
    );

    if (req.user) {
      notifyUser(db, {
        userId: req.user.id,
        type: 'event_registered',
        title: 'Etkinlik Kaydınız Onaylandı',
        body: `"${row.title}" etkinliği için ücretsiz katılım kaydınız oluşturuldu. Bilet Kodunuz: ${ticketCode}`,
        linkView: 'event_detail',
        linkEntityId: row.id,
      });
    }

    logAudit(db, {
      userId: req.user?.id || null,
      action: 'REGISTER_FREE_EVENT',
      resourceType: 'event_registration',
      resourceId: id,
      details: { eventId: row.id, attendeeEmail, visibility },
    });

    const created = db.prepare('SELECT * FROM event_registrations WHERE id = ?').get(id);
    const countRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM event_registrations WHERE event_id = ? AND status = 'confirmed'`)
      .get(row.id) as { cnt: number };

    return res.status(201).json({
      registration: mapEventRegistration(created),
      registrationCount: Number(countRow?.cnt || 0),
    });
  });

  // Update registration visibility (opt-in / opt-out of public attendees strip)
  router.patch('/:id/register/visibility', requireAuth, (req: AuthedRequest, res) => {
    const regRow = db
      .prepare(
        `SELECT * FROM event_registrations
         WHERE event_id = ? AND user_id = ? AND status = 'confirmed'`
      )
      .get(req.params.id, req.user!.id) as any;

    if (!regRow) {
      return res.status(404).json({ error: 'Bu etkinlik için aktif bir kaydınız bulunamadı.' });
    }

    const visibility = req.body?.visibility === 'public_attendee' ? 'public_attendee' : 'private';
    db.prepare('UPDATE event_registrations SET visibility = ? WHERE id = ?').run(visibility, regRow.id);

    const updated = db.prepare('SELECT * FROM event_registrations WHERE id = ?').get(regRow.id);
    return res.json({ registration: mapEventRegistration(updated) });
  });

  // Public opt-in attendees strip (never leaks opt-out registrants, email, phone or ticketCode)
  router.get('/:id/attendees', (req: AuthedRequest, res) => {
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Etkinlik bulunamadı.' });

    const isStaff =
      req.user &&
      ['admin', 'moderator', 'verification_officer'].includes(req.user.activeRole);
    const isVisible =
      isStaff ||
      row.status === 'published' ||
      (req.user && row.creator_user_id === req.user.id);

    if (!isVisible) {
      return res.status(404).json({ error: 'Etkinlik bulunamadı.' });
    }

    const totalRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM event_registrations WHERE event_id = ? AND status = 'confirmed'`)
      .get(row.id) as { cnt: number };

    const publicRows = db
      .prepare(
        `SELECT id, user_id, attendee_name, created_at
         FROM event_registrations
         WHERE event_id = ? AND status = 'confirmed' AND visibility = 'public_attendee'
         ORDER BY created_at DESC`
      )
      .all(row.id) as Array<{ id: string; user_id: string | null; attendee_name: string; created_at: string }>;

    const blockedSet = req.user ? getMutualBlockedUserIds(db, req.user.id) : new Set<string>();
    const attendees: EventAttendeePublic[] = [];

    for (const reg of publicRows) {
      if (reg.user_id && blockedSet.has(reg.user_id)) continue;

      let displayName = reg.attendee_name;
      let avatarUrl = '/src/assets/images/artist_jazz_pianist_1794440057025.jpg';
      let roleLabel = 'Katılımcı';
      let profileView: string | undefined;
      let profileEntityId: string | undefined;

      if (reg.user_id) {
        const userRow = db
          .prepare('SELECT first_name, last_name, avatar_url, active_role FROM users WHERE id = ?')
          .get(reg.user_id) as any;
        if (userRow) {
          displayName = `${userRow.first_name || ''} ${userRow.last_name || ''}`.trim() || displayName;
          avatarUrl = userRow.avatar_url || avatarUrl;
          const link = resolveUserProfileLink(db, reg.user_id);
          profileView = link.profileView;
          profileEntityId = link.profileEntityId;
          roleLabel = link.subtitle || (userRow.active_role === 'audience' ? 'Sanatsever' : 'SanatSahnede Üyesi');
        }
      }

      attendees.push({
        registrationId: reg.id,
        userId: reg.user_id || undefined,
        displayName,
        avatarUrl,
        roleLabel,
        profileView,
        profileEntityId,
        createdAt: reg.created_at,
      });
    }

    return res.json({
      attendees,
      publicCount: attendees.length,
      totalCount: Number(totalRow?.cnt || 0),
    });
  });

  // Event Lounge (auto-creates or retrieves linked community + #etkinlik-sohbeti channel)
  router.post('/:id/lounge', requireAuth, (req: AuthedRequest, res) => {
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Etkinlik bulunamadı.' });

    const isStaff = ['admin', 'moderator'].includes(req.user!.activeRole);
    if (row.status !== 'published' && row.creator_user_id !== req.user!.id && !isStaff) {
      return res.status(403).json({ error: 'Bu etkinliğin sohbet alanına erişim izniniz yok.' });
    }

    const tx = db.transaction(() => {
      const now = new Date().toISOString();
      if (row.lounge_community_id) {
        const existingComm = db
          .prepare('SELECT * FROM communities WHERE id = ?')
          .get(row.lounge_community_id) as any;
        if (existingComm) {
          db.prepare(
            `INSERT OR IGNORE INTO community_members (community_id, user_id, role, is_muted, joined_at)
             VALUES (?, ?, 'member', 0, ?)`
          ).run(existingComm.id, req.user!.id, now);
          return {
            communityId: existingComm.id,
            channelId: row.lounge_channel_id || '',
          };
        }
      }

      const communityId = newId('comm');
      const baseSlug = `etkinlik-${slugifyTr(row.title).slice(0, 32)}-${String(row.id).slice(-5)}`;
      const slugCollision = db.prepare('SELECT 1 FROM communities WHERE slug = ?').get(baseSlug);
      const slug = slugCollision ? `${baseSlug}-${Date.now().toString(36)}` : baseSlug;
      const ownerId = row.creator_user_id || req.user!.id;

      db.prepare(`
        INSERT INTO communities (
          id, slug, name, description, discipline, city, avatar_url, cover_url,
          visibility, owner_user_id, is_verified, verified_label, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'public', ?, 1, 'Etkinlik Kanalı', ?)
      `).run(
        communityId,
        slug,
        `${row.title} — Sohbet`,
        `${row.venue_name}, ${row.city} (${row.event_date}) etkinliği için katılımcı ve sahne buluşma kanalı.`,
        row.discipline || 'Müzik',
        row.city || 'İstanbul',
        row.poster_url || '',
        row.poster_url || '',
        ownerId,
        now
      );

      const annChannelId = newId('chn');
      const discussChannelId = newId('chn');

      db.prepare(`
        INSERT INTO community_channels (
          id, community_id, slug, name, description, channel_type, is_readonly, sort_order, created_at
        ) VALUES (?, ?, 'duyurular', 'duyurular', 'Etkinlik duyuruları ve program güncellemeleri.', 'announcement', 1, 0, ?)
      `).run(annChannelId, communityId, now);

      db.prepare(`
        INSERT INTO community_channels (
          id, community_id, slug, name, description, channel_type, is_readonly, sort_order, created_at
        ) VALUES (?, ?, 'etkinlik-sohbeti', 'etkinlik-sohbeti', 'Katılımcılar ve sanatçılar için açık sohbet kanalı.', 'discussion', 0, 1, ?)
      `).run(discussChannelId, communityId, now);

      db.prepare(
        `INSERT OR IGNORE INTO community_members (community_id, user_id, role, is_muted, joined_at)
         VALUES (?, ?, 'owner', 0, ?)`
      ).run(communityId, ownerId, now);

      if (req.user!.id !== ownerId) {
        db.prepare(
          `INSERT OR IGNORE INTO community_members (community_id, user_id, role, is_muted, joined_at)
           VALUES (?, ?, 'member', 0, ?)`
        ).run(communityId, req.user!.id, now);
      }

      db.prepare('UPDATE events SET lounge_community_id = ?, lounge_channel_id = ? WHERE id = ?').run(
        communityId,
        discussChannelId,
        row.id
      );

      logAudit(db, {
        userId: req.user!.id,
        action: 'CREATE_EVENT_LOUNGE',
        resourceType: 'event',
        resourceId: row.id,
        details: { communityId, channelId: discussChannelId },
      });

      return { communityId, channelId: discussChannelId };
    });

    const result = tx();
    return res.status(200).json(result);
  });

  // Add or update personal event reminder
  router.post('/:id/reminder', requireAuth, (req: AuthedRequest, res) => {
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Etkinlik bulunamadı.' });

    const now = new Date().toISOString();
    const remindAt = String(req.body?.remindAt || `${row.event_date} 09:00`).trim();
    const note = String(req.body?.note || '').trim();

    const existing = db
      .prepare('SELECT * FROM event_reminders WHERE event_id = ? AND user_id = ?')
      .get(row.id, req.user!.id) as any;

    let reminderId = existing?.id || newId('evrem');
    if (existing) {
      db.prepare('UPDATE event_reminders SET remind_at = ?, note = ? WHERE id = ?').run(remindAt, note, existing.id);
    } else {
      db.prepare(
        `INSERT INTO event_reminders (id, event_id, user_id, remind_at, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(reminderId, row.id, req.user!.id, remindAt, note, now);
    }

    const saved = db.prepare('SELECT * FROM event_reminders WHERE id = ?').get(reminderId) as any;
    return res.status(201).json({
      reminder: {
        id: saved.id,
        eventId: saved.event_id,
        userId: saved.user_id,
        remindAt: saved.remind_at,
        note: saved.note || '',
        createdAt: saved.created_at,
      } satisfies EventReminder,
    });
  });

  // Remove personal event reminder
  router.delete('/:id/reminder', requireAuth, (req: AuthedRequest, res) => {
    db.prepare('DELETE FROM event_reminders WHERE event_id = ? AND user_id = ?').run(req.params.id, req.user!.id);
    return res.json({ success: true });
  });

  // Cancel Event Registration
  router.delete('/:id/register', (req: AuthedRequest, res) => {
    const registrationId = String((req.body && req.body.registrationId) || req.query.registrationId || '').trim();
    const email = String((req.body && req.body.attendeeEmail) || req.query.email || '')
      .trim()
      .toLowerCase();

    let regRow: any;
    if (req.user) {
      regRow = registrationId
        ? db
            .prepare(`SELECT * FROM event_registrations WHERE id = ? AND event_id = ? AND status = 'confirmed'`)
            .get(registrationId, req.params.id)
        : db
            .prepare(`SELECT * FROM event_registrations WHERE event_id = ? AND user_id = ? AND status = 'confirmed'`)
            .get(req.params.id, req.user.id);
    } else if (registrationId) {
      regRow = db
        .prepare(`SELECT * FROM event_registrations WHERE id = ? AND event_id = ? AND status = 'confirmed'`)
        .get(registrationId, req.params.id);
    } else if (email) {
      regRow = db
        .prepare(`SELECT * FROM event_registrations WHERE event_id = ? AND LOWER(attendee_email) = ? AND status = 'confirmed'`)
        .get(req.params.id, email);
    }

    if (!regRow) {
      return res.status(404).json({ error: 'İptal edilecek aktif etkinlik kaydı bulunamadı.' });
    }

    if (req.user && regRow.user_id && regRow.user_id !== req.user.id) {
      const isStaff = ['admin', 'moderator'].includes(req.user.activeRole);
      if (!isStaff) {
        return res.status(403).json({ error: 'Bu kaydı iptal etme yetkiniz yok.' });
      }
    }

    db.prepare(`UPDATE event_registrations SET status = 'cancelled' WHERE id = ?`).run(regRow.id);

    const countRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM event_registrations WHERE event_id = ? AND status = 'confirmed'`)
      .get(req.params.id) as { cnt: number };

    return res.json({
      success: true,
      registrationCount: Number(countRow?.cnt || 0),
    });
  });

  return router;
}
