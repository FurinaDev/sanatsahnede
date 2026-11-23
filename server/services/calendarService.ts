import { DbInstance, parseJson } from '../db/database';
import { mapAvailabilitySlot } from '../db/mappers';
import {
  AvailabilityKind,
  AvailabilityRecurrence,
  AvailabilityVisibility,
  ConfirmedBookingComparable,
  doAvailabilitySlotsConflict,
  hasConfirmedBookingOverlap,
  isValidDateStr,
  isValidTimeStr,
  parseTimeToMinutes,
  TimeSlotComparable,
} from '../../src/utils/calendarEngine';
import { AvailabilitySlot } from '../../src/types';

export const VALID_OWNER_TYPES = new Set(['artist', 'ensemble', 'venue', 'technical_provider']);
export const VALID_RECURRENCES = new Set<AvailabilityRecurrence>(['once', 'weekly', 'monthly']);
export const VALID_SLOT_KINDS = new Set<AvailabilityKind>([
  'available',
  'open_stage',
  'free_rehearsal',
  'booked',
  'blocked',
]);
export const VALID_VISIBILITIES = new Set<AvailabilityVisibility>([
  'private',
  'project_team',
  'public',
]);

export function getUserOwnedEntities(db: DbInstance, userId: string): {
  artistIds: string[];
  ensembleIds: string[];
  venueIds: string[];
  techIds: string[];
  businessIds: string[];
} {
  const artistIds = (
    db.prepare('SELECT id FROM individual_profiles WHERE user_id = ?').all(userId) as Array<{ id: string }>
  ).map((r) => r.id);
  const ensembleIds = (
    db.prepare('SELECT id FROM ensembles WHERE leader_user_id = ?').all(userId) as Array<{ id: string }>
  ).map((r) => r.id);
  const venueIds = (
    db.prepare('SELECT id FROM venues WHERE manager_user_id = ?').all(userId) as Array<{ id: string }>
  ).map((r) => r.id);
  const techIds = (
    db.prepare('SELECT id FROM technical_providers WHERE user_id = ?').all(userId) as Array<{ id: string }>
  ).map((r) => r.id);
  const businessIds = (
    db.prepare('SELECT id FROM business_profiles WHERE user_id = ?').all(userId) as Array<{ id: string }>
  ).map((r) => r.id);

  return { artistIds, ensembleIds, venueIds, techIds, businessIds };
}

export function verifyAvailabilityOwnership(
  db: DbInstance,
  userId: string,
  activeRole: string,
  ownerType: string,
  ownerId: string
): boolean {
  if (activeRole === 'admin') return true;
  if (ownerType === 'venue') {
    const v = db.prepare('SELECT manager_user_id FROM venues WHERE id = ?').get(ownerId) as any;
    return v?.manager_user_id === userId;
  }
  if (ownerType === 'artist') {
    const a = db.prepare('SELECT user_id FROM individual_profiles WHERE id = ?').get(ownerId) as any;
    return a?.user_id === userId;
  }
  if (ownerType === 'ensemble') {
    const e = db.prepare('SELECT leader_user_id FROM ensembles WHERE id = ?').get(ownerId) as any;
    return e?.leader_user_id === userId;
  }
  if (ownerType === 'technical_provider') {
    const t = db.prepare('SELECT user_id FROM technical_providers WHERE id = ?').get(ownerId) as any;
    return t?.user_id === userId;
  }
  return false;
}

export function getTeamMateUserIds(db: DbInstance, viewerUserId: string): Set<string> {
  const mates = new Set<string>([viewerUserId]);

  const projRows = db.prepare('SELECT owner_user_id, members_json FROM projects').all() as any[];
  for (const p of projRows) {
    const members = parseJson<Array<{ userId?: string }>>(p.members_json, []);
    const allIds = [p.owner_user_id, ...members.map((m) => m.userId).filter(Boolean)] as string[];
    if (allIds.includes(viewerUserId)) {
      allIds.forEach((id) => mates.add(id));
    }
  }

  const bookingRows = db
    .prepare(
      `SELECT b.id, b.performer_user_id, bp.user_id as biz_user_id
       FROM bookings b
       LEFT JOIN business_profiles bp ON bp.id = b.business_id
       WHERE b.status IN ('confirmed', 'performer_completed', 'employer_completed', 'payment_pending', 'agreement_pending')`
    )
    .all() as any[];
  for (const b of bookingRows) {
    if (b.performer_user_id === viewerUserId || b.biz_user_id === viewerUserId) {
      if (b.performer_user_id) mates.add(b.performer_user_id);
      if (b.biz_user_id) mates.add(b.biz_user_id);
    }
  }

  return mates;
}

export function filterAndSanitizeAvailabilitySlots(
  db: DbInstance,
  rows: any[],
  viewerUserId?: string | null,
  viewerRole?: string | null
): AvailabilitySlot[] {
  const isStaff = Boolean(viewerRole && ['admin', 'moderator'].includes(viewerRole));
  const teamMates = viewerUserId ? getTeamMateUserIds(db, viewerUserId) : null;

  const result: AvailabilitySlot[] = [];
  for (const row of rows) {
    const isOwner = Boolean(viewerUserId && row.owner_user_id === viewerUserId);
    if (isStaff || isOwner) {
      result.push(mapAvailabilitySlot(row, false));
      continue;
    }

    const vis: AvailabilityVisibility =
      row.visibility === 'private' || row.visibility === 'project_team' || row.visibility === 'public'
        ? row.visibility
        : 'public';

    if (vis === 'private') {
      continue;
    }
    if (vis === 'project_team') {
      if (!teamMates || !teamMates.has(row.owner_user_id)) {
        continue;
      }
      result.push(mapAvailabilitySlot(row, true));
      continue;
    }

    // Public slot: sanitize notes & private fields if it's a busy/blocked slot
    result.push(mapAvailabilitySlot(row, true));
  }

  return result;
}

export function getActiveBookingsForOwner(
  db: DbInstance,
  ownerType: string,
  ownerId: string
): ConfirmedBookingComparable[] {
  if (ownerType === 'artist' || ownerType === 'ensemble') {
    const rows = db
      .prepare(
        `SELECT id, event_date, start_time, end_time, status, performer_user_id
         FROM bookings
         WHERE performer_id = ?
           AND status IN ('confirmed', 'performer_completed', 'employer_completed', 'payment_pending', 'agreement_pending')`
      )
      .all(ownerId) as any[];
    return rows.map((r) => ({
      id: r.id,
      eventDate: r.event_date,
      startTime: r.start_time,
      endTime: r.end_time,
      status: r.status,
      performerUserId: r.performer_user_id,
    }));
  }
  return [];
}

export function getUserActiveBookings(db: DbInstance, userId: string): ConfirmedBookingComparable[] {
  const entities = getUserOwnedEntities(db, userId);
  const rows = db
    .prepare(
      `SELECT id, business_id, performer_id, performer_user_id, event_date, start_time, end_time, status
       FROM bookings
       WHERE status IN ('confirmed', 'performer_completed', 'employer_completed', 'payment_pending', 'agreement_pending')`
    )
    .all() as any[];

  return rows
    .filter(
      (r) =>
        r.performer_user_id === userId ||
        entities.businessIds.includes(r.business_id) ||
        entities.artistIds.includes(r.performer_id) ||
        entities.ensembleIds.includes(r.performer_id)
    )
    .map((r) => ({
      id: r.id,
      eventDate: r.event_date,
      startTime: r.start_time,
      endTime: r.end_time,
      status: r.status,
      performerUserId: r.performer_user_id,
    }));
}

export function validateAvailabilityPayload(input: {
  ownerType: string;
  slotDate: string;
  startTime: string;
  endTime: string;
  recurrence: string;
  slotKind: string;
  visibility: string;
}): string | null {
  if (!VALID_OWNER_TYPES.has(input.ownerType)) {
    return 'Geçersiz takvim sahibi türü.';
  }
  if (!isValidDateStr(input.slotDate)) {
    return 'Geçerli bir tarih giriniz (YYYY-AA-GG).';
  }
  if (!isValidTimeStr(input.startTime) || !isValidTimeStr(input.endTime)) {
    return 'Geçerli bir başlangıç ve bitiş saati giriniz (SS:dd).';
  }
  if (parseTimeToMinutes(input.startTime) >= parseTimeToMinutes(input.endTime)) {
    return 'Bitiş saati başlangıç saatinden sonra olmalıdır.';
  }
  if (!VALID_RECURRENCES.has(input.recurrence as AvailabilityRecurrence)) {
    return 'Geçersiz tekrarlama seçeneği.';
  }
  if (!VALID_SLOT_KINDS.has(input.slotKind as AvailabilityKind)) {
    return 'Geçersiz takvim kayıt türü.';
  }
  if (!VALID_VISIBILITIES.has(input.visibility as AvailabilityVisibility)) {
    return 'Geçersiz gizlilik ayarı.';
  }
  return null;
}

export function checkAvailabilityConflictInDb(
  db: DbInstance,
  candidate: TimeSlotComparable & { id?: string }
): { conflictMessage: string } | null {
  const existingRows = db
    .prepare('SELECT * FROM availability_slots WHERE owner_type = ? AND owner_id = ?')
    .all(candidate.ownerType, candidate.ownerId) as any[];

  for (const row of existingRows) {
    if (candidate.id && row.id === candidate.id) continue;
    const comparable: TimeSlotComparable = {
      id: row.id,
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      slotDate: row.slot_date,
      startTime: row.start_time,
      endTime: row.end_time,
      recurrence: (row.recurrence || 'once') as AvailabilityRecurrence,
      slotKind: row.slot_kind as AvailabilityKind,
    };
    if (doAvailabilitySlotsConflict(candidate, comparable)) {
      return {
        conflictMessage: `Takvim çakışması: ${row.slot_date} tarihinde ${row.start_time}-${row.end_time} arası "${row.title}" kaydı zaten mevcut.`,
      };
    }
  }

  // Also check confirmed stage bookings overlap
  const activeBookings = getActiveBookingsForOwner(db, candidate.ownerType, candidate.ownerId);
  const bkConflict = hasConfirmedBookingOverlap(
    candidate.slotDate,
    candidate.startTime,
    candidate.endTime,
    activeBookings,
    candidate.recurrence
  );
  if (bkConflict) {
    return {
      conflictMessage: `Rezervasyon çakışması: ${bkConflict.eventDate} tarihinde onaylı sahne rezervasyonu ile çakışıyor.`,
    };
  }

  return null;
}

export function resolveAvailabilityDefaultVisibility(
  slotKind: string,
  requestedVisibility?: string
): AvailabilityVisibility {
  if (requestedVisibility && VALID_VISIBILITIES.has(requestedVisibility as AvailabilityVisibility)) {
    return requestedVisibility as AvailabilityVisibility;
  }
  if (slotKind === 'booked' || slotKind === 'blocked') {
    return 'private';
  }
  return 'public';
}
