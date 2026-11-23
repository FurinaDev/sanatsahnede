import { Router } from 'express';
import { DbInstance } from '../db/database';
import { AuthedRequest, requireAuth, requireFeatureFlag, requireRole } from '../middleware/auth';
import { mapAvailabilitySlot, mapVenue } from '../db/mappers';
import { newId, slugify } from '../utils/crypto';
import { logAudit } from '../services/auditService';
import {
  checkAvailabilityConflictInDb,
  filterAndSanitizeAvailabilitySlots,
  resolveAvailabilityDefaultVisibility,
  validateAvailabilityPayload,
  verifyAvailabilityOwnership,
} from '../services/calendarService';
import { AvailabilityKind, AvailabilityRecurrence } from '../../src/utils/calendarEngine';

export function createVenuesRouter(db: DbInstance): Router {
  const router = Router();

  router.get('/venues', (_req, res) => {
    const rows = db.prepare('SELECT * FROM venues ORDER BY created_at DESC').all() as any[];
    return res.json({ venues: rows.map((r) => mapVenue(db, r)) });
  });

  router.post('/venues', requireAuth, requireFeatureFlag(db, 'open_stage_network'), (req: AuthedRequest, res) => {
    const {
      name,
      city,
      district = '',
      address = '',
      description = '',
      contactPhone = '',
      contactEmail = '',
      spaces = [],
      accessibility,
    } = req.body || {};

    if (!name || !city) {
      return res.status(400).json({ error: 'Mekân adı ve şehir zorunludur.' });
    }

    const id = newId('venue');
    const slug = `${slugify(name)}-${id.slice(-4)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO venues (
        id, manager_user_id, name, slug, city, district, address, description,
        contact_phone, contact_email, is_verified, accessibility_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, req.user!.id, String(name).trim(), slug, city, district, address, description,
      contactPhone, contactEmail || req.user!.email, req.user!.isVerified ? 1 : 0,
      JSON.stringify(
        accessibility || {
          wheelchairAccess: false, stepFreeEntrance: false, accessibleRestroom: false,
          elevatorOrRamp: false, signLanguageInterpretation: false, liveCaptions: false,
          audioDescription: false, brailleProgram: false, hearingLoop: false,
          companionSupport: false, accessibleSeating: false, sensoryFriendly: false,
          accessibleTransitInfo: '',
        }
      ),
      now
    );

    if (Array.isArray(spaces)) {
      for (const s of spaces) {
        if (!s?.name) continue;
        db.prepare(`
          INSERT INTO venue_spaces (id, venue_id, name, seated_capacity, standing_capacity, stage_dimensions, technical_equipment_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          newId('space'), id, s.name, Number(s.seatedCapacity || 0),
          Number(s.standingCapacity || 0), s.stageDimensions || '',
          JSON.stringify(Array.isArray(s.technicalEquipment) ? s.technicalEquipment : [])
        );
      }
    }

    const created = db.prepare('SELECT * FROM venues WHERE id = ?').get(id);
    return res.status(201).json({ venue: mapVenue(db, created) });
  });

  router.patch('/venues/:id', requireAuth, requireFeatureFlag(db, 'open_stage_network'), (req: AuthedRequest, res) => {
    const venue = db.prepare('SELECT * FROM venues WHERE id = ?').get(req.params.id) as any;
    if (!venue) return res.status(404).json({ error: 'Mekân bulunamadı.' });
    if (venue.manager_user_id !== req.user!.id && req.user!.activeRole !== 'admin') {
      return res.status(403).json({ error: 'Bu mekânı düzenleme yetkiniz yok.' });
    }

    const { name, city, district, address, description, contactPhone, contactEmail } = req.body || {};
    db.prepare(`
      UPDATE venues SET
        name = COALESCE(?, name),
        city = COALESCE(?, city),
        district = COALESCE(?, district),
        address = COALESCE(?, address),
        description = COALESCE(?, description),
        contact_phone = COALESCE(?, contact_phone),
        contact_email = COALESCE(?, contact_email)
      WHERE id = ?
    `).run(
      name !== undefined ? String(name).trim() : null,
      city ?? null,
      district ?? null,
      address ?? null,
      description ?? null,
      contactPhone ?? null,
      contactEmail ?? null,
      venue.id
    );

    const updated = db.prepare('SELECT * FROM venues WHERE id = ?').get(venue.id);
    return res.json({ venue: mapVenue(db, updated) });
  });

  router.post('/venues/:id/spaces', requireAuth, requireFeatureFlag(db, 'open_stage_network'), (req: AuthedRequest, res) => {
    const venue = db.prepare('SELECT * FROM venues WHERE id = ?').get(req.params.id) as any;
    if (!venue) return res.status(404).json({ error: 'Mekân bulunamadı.' });
    if (venue.manager_user_id !== req.user!.id && req.user!.activeRole !== 'admin') {
      return res.status(403).json({ error: 'Bu mekâna salon ekleme yetkiniz yok.' });
    }

    const { name, seatedCapacity = 0, standingCapacity = 0, stageDimensions = '', technicalEquipment = [] } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Salon adı zorunludur.' });
    }

    db.prepare(`
      INSERT INTO venue_spaces (id, venue_id, name, seated_capacity, standing_capacity, stage_dimensions, technical_equipment_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId('space'),
      venue.id,
      String(name).trim(),
      Number(seatedCapacity || 0),
      Number(standingCapacity || 0),
      stageDimensions,
      JSON.stringify(Array.isArray(technicalEquipment) ? technicalEquipment : [])
    );

    const updated = db.prepare('SELECT * FROM venues WHERE id = ?').get(venue.id);
    return res.status(201).json({ venue: mapVenue(db, updated) });
  });

  router.delete('/venues/:id/spaces/:spaceId', requireAuth, (req: AuthedRequest, res) => {
    const venue = db.prepare('SELECT * FROM venues WHERE id = ?').get(req.params.id) as any;
    if (!venue) return res.status(404).json({ error: 'Mekân bulunamadı.' });
    if (venue.manager_user_id !== req.user!.id && req.user!.activeRole !== 'admin') {
      return res.status(403).json({ error: 'Bu salonu silme yetkiniz yok.' });
    }

    db.prepare('DELETE FROM venue_spaces WHERE id = ? AND venue_id = ?').run(req.params.spaceId, venue.id);
    const updated = db.prepare('SELECT * FROM venues WHERE id = ?').get(venue.id);
    return res.json({ venue: mapVenue(db, updated) });
  });

  // Update Accessibility Spec (owner or staff)
  router.put('/venues/:id/accessibility', requireAuth, requireFeatureFlag(db, 'accessible_arts'), (req: AuthedRequest, res) => {
    const venue = db.prepare('SELECT * FROM venues WHERE id = ?').get(req.params.id) as any;
    if (!venue) return res.status(404).json({ error: 'Mekân bulunamadı.' });

    const isStaff = ['admin', 'verification_officer', 'moderator'].includes(req.user!.activeRole);
    if (venue.manager_user_id !== req.user!.id && !isStaff) {
      return res.status(403).json({ error: 'Erişilebilirlik bilgisini güncelleme yetkiniz yok.' });
    }

    const nextAcc = {
      ...(JSON.parse(venue.accessibility_json || '{}')),
      ...(req.body || {}),
    };
    db.prepare('UPDATE venues SET accessibility_json = ? WHERE id = ?').run(JSON.stringify(nextAcc), venue.id);
    const updated = db.prepare('SELECT * FROM venues WHERE id = ?').get(venue.id);
    return res.json({ venue: mapVenue(db, updated) });
  });

  // Official Accessibility Verification (Verifier / Admin only)
  router.post(
    '/venues/:id/accessibility/verify',
    requireAuth,
    requireRole('admin', 'verification_officer', 'moderator'),
    (req: AuthedRequest, res) => {
      const venue = db.prepare('SELECT * FROM venues WHERE id = ?').get(req.params.id) as any;
      if (!venue) return res.status(404).json({ error: 'Mekân bulunamadı.' });

      const acc = JSON.parse(venue.accessibility_json || '{}');
      acc.verifiedBy = `${req.user!.firstName} ${req.user!.lastName}`.trim() + ' (Doğrulama Uzmanı)';
      acc.verifiedAt = new Date().toISOString();

      db.prepare('UPDATE venues SET accessibility_json = ? WHERE id = ?').run(JSON.stringify(acc), venue.id);
      logAudit(db, {
        userId: req.user!.id,
        action: 'VERIFY_VENUE_ACCESSIBILITY',
        resourceType: 'venue',
        resourceId: venue.id,
      });
      const updated = db.prepare('SELECT * FROM venues WHERE id = ?').get(venue.id);
      return res.json({ venue: mapVenue(db, updated) });
    }
  );

  // Availability Slots (privacy-enforced & strictly conflict-locked)
  router.get('/availability', (req: AuthedRequest, res) => {
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();
    const ownerType = String(req.query.ownerType || '').trim();
    const ownerId = String(req.query.ownerId || '').trim();
    const slotKind = String(req.query.slotKind || '').trim();
    const mine = req.query.mine === '1' || req.query.mine === 'true';

    let rows = db.prepare('SELECT * FROM availability_slots ORDER BY slot_date ASC, start_time ASC').all() as any[];

    if (mine) {
      if (!req.user) return res.status(401).json({ error: 'Oturum açmanız gerekiyor.' });
      rows = rows.filter((r) => r.owner_user_id === req.user!.id);
    }
    if (ownerType) rows = rows.filter((r) => r.owner_type === ownerType);
    if (ownerId) rows = rows.filter((r) => r.owner_id === ownerId);
    if (slotKind) rows = rows.filter((r) => r.slot_kind === slotKind);
    if (startDate) rows = rows.filter((r) => r.slot_date >= startDate);
    if (endDate) rows = rows.filter((r) => r.slot_date <= endDate);

    const slots = filterAndSanitizeAvailabilitySlots(db, rows, req.user?.id, req.user?.activeRole);
    return res.json({ slots });
  });

  router.post('/availability', requireAuth, requireFeatureFlag(db, 'open_stage_network'), (req: AuthedRequest, res) => {
    const {
      ownerType = 'venue',
      ownerId,
      ownerName,
      title,
      slotDate,
      startTime,
      endTime,
      recurrence = 'once',
      slotKind = 'available',
      visibility: requestedVisibility,
      isFree = false,
      feeAmount = 0,
      city = 'İstanbul',
      notes = '',
    } = req.body || {};

    if (!ownerId || !title || !slotDate || !startTime || !endTime) {
      return res.status(400).json({ error: 'Sahip, başlık, tarih, başlangıç ve bitiş saati zorunludur.' });
    }

    const visibility = resolveAvailabilityDefaultVisibility(String(slotKind), requestedVisibility);
    const validationError = validateAvailabilityPayload({
      ownerType: String(ownerType),
      slotDate: String(slotDate),
      startTime: String(startTime),
      endTime: String(endTime),
      recurrence: String(recurrence),
      slotKind: String(slotKind),
      visibility,
    });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    if (!verifyAvailabilityOwnership(db, req.user!.id, req.user!.activeRole, String(ownerType), String(ownerId))) {
      return res.status(403).json({ error: 'Yalnızca kendi profiliniz veya mekânınız için takvim kaydı ekleyebilirsiniz.' });
    }

    const outcome = db.transaction(() => {
      const conflict = checkAvailabilityConflictInDb(db, {
        ownerType: String(ownerType),
        ownerId: String(ownerId),
        slotDate: String(slotDate),
        startTime: String(startTime),
        endTime: String(endTime),
        recurrence: recurrence as AvailabilityRecurrence,
        slotKind: slotKind as AvailabilityKind,
      });
      if (conflict) {
        return { error: conflict.conflictMessage, status: 409 as const };
      }

      const id = newId('slot');
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO availability_slots (
          id, owner_type, owner_id, owner_user_id, owner_name, title, slot_date,
          start_time, end_time, recurrence, slot_kind, visibility, is_free, fee_amount, city, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        ownerType,
        ownerId,
        req.user!.id,
        ownerName || `${req.user!.firstName} ${req.user!.lastName}`.trim(),
        String(title).trim(),
        slotDate,
        startTime,
        endTime,
        recurrence,
        slotKind,
        visibility,
        isFree ? 1 : 0,
        isFree ? 0 : Number(feeAmount || 0),
        city,
        String(notes || '').trim(),
        now
      );

      const created = db.prepare('SELECT * FROM availability_slots WHERE id = ?').get(id);
      return { status: 201 as const, slot: mapAvailabilitySlot(created, false) };
    })();

    if ('error' in outcome) {
      return res.status(outcome.status).json({ error: outcome.error });
    }
    return res.status(201).json({ slot: outcome.slot });
  });

  router.patch('/availability/:id', requireAuth, (req: AuthedRequest, res) => {
    const existing = db.prepare('SELECT * FROM availability_slots WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Takvim kaydı bulunamadı.' });
    if (existing.owner_user_id !== req.user!.id && req.user!.activeRole !== 'admin') {
      return res.status(403).json({ error: 'Bu takvim kaydını düzenleme yetkiniz yok.' });
    }

    const body = req.body || {};
    const nextTitle = body.title !== undefined ? String(body.title).trim() : existing.title;
    const nextDate = body.slotDate !== undefined ? String(body.slotDate) : existing.slot_date;
    const nextStart = body.startTime !== undefined ? String(body.startTime) : existing.start_time;
    const nextEnd = body.endTime !== undefined ? String(body.endTime) : existing.end_time;
    const nextRecurrence = body.recurrence !== undefined ? String(body.recurrence) : existing.recurrence;
    const nextKind = body.slotKind !== undefined ? String(body.slotKind) : existing.slot_kind;
    const nextVisibility =
      body.visibility !== undefined
        ? String(body.visibility)
        : existing.visibility || resolveAvailabilityDefaultVisibility(nextKind);
    const nextIsFree = body.isFree !== undefined ? (body.isFree ? 1 : 0) : existing.is_free;
    const nextFee = nextIsFree ? 0 : body.feeAmount !== undefined ? Number(body.feeAmount || 0) : existing.fee_amount;
    const nextCity = body.city !== undefined ? String(body.city).trim() : existing.city;
    const nextNotes = body.notes !== undefined ? String(body.notes).trim() : existing.notes;

    if (!nextTitle) {
      return res.status(400).json({ error: 'Başlık boş bırakılamaz.' });
    }

    const validationError = validateAvailabilityPayload({
      ownerType: existing.owner_type,
      slotDate: nextDate,
      startTime: nextStart,
      endTime: nextEnd,
      recurrence: nextRecurrence,
      slotKind: nextKind,
      visibility: nextVisibility,
    });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const outcome = db.transaction(() => {
      const conflict = checkAvailabilityConflictInDb(db, {
        id: existing.id,
        ownerType: existing.owner_type,
        ownerId: existing.owner_id,
        slotDate: nextDate,
        startTime: nextStart,
        endTime: nextEnd,
        recurrence: nextRecurrence as AvailabilityRecurrence,
        slotKind: nextKind as AvailabilityKind,
      });
      if (conflict) {
        return { error: conflict.conflictMessage, status: 409 as const };
      }

      db.prepare(`
        UPDATE availability_slots
        SET title = ?, slot_date = ?, start_time = ?, end_time = ?,
            recurrence = ?, slot_kind = ?, visibility = ?,
            is_free = ?, fee_amount = ?, city = ?, notes = ?
        WHERE id = ?
      `).run(
        nextTitle,
        nextDate,
        nextStart,
        nextEnd,
        nextRecurrence,
        nextKind,
        nextVisibility,
        nextIsFree,
        nextFee,
        nextCity,
        nextNotes,
        existing.id
      );

      const updated = db.prepare('SELECT * FROM availability_slots WHERE id = ?').get(existing.id);
      return { status: 200 as const, slot: mapAvailabilitySlot(updated, false) };
    })();

    if ('error' in outcome) {
      return res.status(outcome.status).json({ error: outcome.error });
    }
    return res.json({ slot: outcome.slot });
  });

  router.delete('/availability/:id', requireAuth, (req: AuthedRequest, res) => {
    const slot = db.prepare('SELECT * FROM availability_slots WHERE id = ?').get(req.params.id) as any;
    if (!slot) return res.status(404).json({ error: 'Takvim kaydı bulunamadı.' });
    if (slot.owner_user_id !== req.user!.id && req.user!.activeRole !== 'admin') {
      return res.status(403).json({ error: 'Yetkisiz işlem.' });
    }
    db.prepare('DELETE FROM availability_slots WHERE id = ?').run(slot.id);
    return res.json({ success: true });
  });

  return router;
}
