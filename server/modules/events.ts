import { Router } from 'express';
import { DbInstance } from '../db/database';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { mapEvent, mapEventRegistration } from '../db/mappers';
import { newId } from '../utils/crypto';
import { logAudit } from '../services/auditService';
import { notifyUser } from '../services/notificationService';
import { createRateLimiter } from '../middleware/rateLimit';
import { buildPaginationEnvelope, parsePaginationParams } from './directory';
import { geocodeWithCache } from '../services/geoService';

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
        id, event_id, user_id, attendee_name, attendee_email, attendee_phone, notes, ticket_code, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
    `).run(
      id,
      row.id,
      req.user ? req.user.id : null,
      attendeeName,
      attendeeEmail,
      attendeePhone,
      notes,
      ticketCode,
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
      details: { eventId: row.id, attendeeEmail },
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
