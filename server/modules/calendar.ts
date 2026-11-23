import { Router } from 'express';
import { DbInstance, parseJson } from '../db/database';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { newId } from '../utils/crypto';
import { logAudit } from '../services/auditService';
import { notifyUser } from '../services/notificationService';
import { isBlockedBetween } from '../services/socialGraphService';
import { getUserActiveBookings, getUserOwnedEntities } from '../services/calendarService';
import {
  AvailabilityKind,
  AvailabilityRecurrence,
  AvailabilityVisibility,
  PollVoteResponse,
  SchedulingParticipant,
  TimeSlotComparable,
  addDaysToDateStr,
  buildCalendarFeedIcs,
  evaluateSchedulingOption,
  getIstanbulTodayStr,
  isRecurringSlotActiveOnDate,
  isValidDateStr,
  isValidTimeStr,
  markRecommendedOptions,
  parseTimeToMinutes,
  rangesOverlap,
} from '../../src/utils/calendarEngine';
import {
  CalendarEntry,
  CalendarEntryType,
  SchedulingPoll,
  SchedulingPollOption,
  SchedulingPollVote,
  UpcomingScheduleItem,
} from '../../src/types';

interface PollContextResolved {
  contextType: 'project' | 'booking' | 'production';
  contextId: string;
  contextTitle: string;
  ownerUserIds: string[];
  participants: SchedulingParticipant[];
  targetWorkspaceType?: 'project' | 'booking';
}

const VALID_POLL_CONTEXTS = new Set(['project', 'booking', 'production']);
const VALID_VOTE_RESPONSES = new Set<PollVoteResponse>(['available', 'unavailable', 'maybe']);

function getUserDisplayMap(db: DbInstance, userIds: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return map;
  const placeholders = unique.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id, first_name, last_name FROM users WHERE id IN (${placeholders})`)
    .all(...unique) as Array<{ id: string; first_name: string; last_name: string }>;
  for (const u of rows) {
    map.set(u.id, `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Üye');
  }
  return map;
}

function resolvePollContext(
  db: DbInstance,
  contextType: string,
  contextId: string
): PollContextResolved | null {
  if (!VALID_POLL_CONTEXTS.has(contextType)) return null;

  if (contextType === 'project') {
    const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(contextId) as any;
    if (!proj) return null;
    const members = parseJson<Array<{ userId: string; name?: string; roleTitle?: string; status?: string }>>(
      proj.members_json,
      []
    );
    const activeMembers = members.filter((m) => m.userId && m.status !== 'left');
    const userIds = Array.from(new Set([proj.owner_user_id, ...activeMembers.map((m) => m.userId)]));
    const names = getUserDisplayMap(db, userIds);
    const participants: SchedulingParticipant[] = userIds.map((uid) => {
      const m = activeMembers.find((item) => item.userId === uid);
      return {
        userId: uid,
        displayName: names.get(uid) || m?.name || (uid === proj.owner_user_id ? proj.owner_name : 'Üye'),
        roleTitle: uid === proj.owner_user_id ? 'Proje Sahibi' : m?.roleTitle || 'Proje Üyesi',
      };
    });
    return {
      contextType: 'project',
      contextId: proj.id,
      contextTitle: proj.title,
      ownerUserIds: [proj.owner_user_id],
      participants,
      targetWorkspaceType: 'project',
    };
  }

  // Booking or Production context
  const bk = db.prepare('SELECT * FROM bookings WHERE id = ?').get(contextId) as any;
  if (bk) {
    const biz = db.prepare('SELECT user_id, business_name FROM business_profiles WHERE id = ?').get(bk.business_id) as any;
    const techReq = db
      .prepare(`SELECT id FROM technical_requests WHERE context_type = 'booking' AND context_id = ?`)
      .get(bk.id) as any;
    const techUserIds: string[] = [];
    if (techReq) {
      const acceptedTechs = db
        .prepare(
          `SELECT tp.user_id FROM technical_quotes tq
           JOIN technical_providers tp ON tp.id = tq.provider_id
           WHERE tq.request_id = ? AND tq.status = 'accepted'`
        )
        .all(techReq.id) as Array<{ user_id: string }>;
      acceptedTechs.forEach((t) => {
        if (t.user_id) techUserIds.push(t.user_id);
      });
    }
    const rawIds = [bk.performer_user_id, biz?.user_id, ...techUserIds].filter(Boolean) as string[];
    const userIds = Array.from(new Set(rawIds));
    const names = getUserDisplayMap(db, userIds);
    const participants: SchedulingParticipant[] = userIds.map((uid) => ({
      userId: uid,
      displayName: names.get(uid) || (uid === bk.performer_user_id ? bk.performer_name : bk.business_name || 'Üye'),
      roleTitle:
        uid === biz?.user_id
          ? 'Mekân / Kurum'
          : uid === bk.performer_user_id
          ? 'Sanatçı / Topluluk'
          : 'Teknik Ekip',
    }));
    return {
      contextType: contextType === 'production' ? 'production' : 'booking',
      contextId: bk.id,
      contextTitle: bk.listing_title || 'Sahne Prodüksiyonu',
      ownerUserIds: Array.from(new Set([bk.performer_user_id, biz?.user_id].filter(Boolean))),
      participants,
      targetWorkspaceType: 'booking',
    };
  }

  // Fallback if production poll targets a project id
  if (contextType === 'production') {
    const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(contextId) as any;
    if (proj) {
      const resolved = resolvePollContext(db, 'project', proj.id);
      if (resolved) {
        return { ...resolved, contextType: 'production', targetWorkspaceType: 'project' };
      }
    }
  }

  return null;
}

function getParticipantSlotsMap(
  db: DbInstance,
  userIds: string[]
): Record<string, TimeSlotComparable[]> {
  const result: Record<string, TimeSlotComparable[]> = {};
  if (userIds.length === 0) return result;
  const allSlots = db.prepare('SELECT * FROM availability_slots').all() as any[];

  for (const uid of userIds) {
    const owned = getUserOwnedEntities(db, uid);
    const userSlots: TimeSlotComparable[] = [];
    for (const row of allSlots) {
      const belongs =
        row.owner_user_id === uid ||
        (row.owner_type === 'artist' && owned.artistIds.includes(row.owner_id)) ||
        (row.owner_type === 'ensemble' && owned.ensembleIds.includes(row.owner_id)) ||
        (row.owner_type === 'venue' && owned.venueIds.includes(row.owner_id)) ||
        (row.owner_type === 'technical_provider' && owned.techIds.includes(row.owner_id));
      if (!belongs) continue;
      userSlots.push({
        id: row.id,
        ownerType: row.owner_type,
        ownerId: row.owner_id,
        slotDate: row.slot_date,
        startTime: row.start_time,
        endTime: row.end_time,
        recurrence: (row.recurrence || 'once') as AvailabilityRecurrence,
        slotKind: row.slot_kind as AvailabilityKind,
      });
    }
    result[uid] = userSlots;
  }

  return result;
}

function mapPollOption(row: any): SchedulingPollOption {
  return {
    id: row.id,
    pollId: row.poll_id,
    optionDate: row.option_date,
    startTime: row.start_time,
    endTime: row.end_time,
    notes: row.notes || '',
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
  };
}

function hydratePoll(
  db: DbInstance,
  pollRow: any,
  viewerUserId: string,
  viewerRole: string
): SchedulingPoll | null {
  const ctx = resolvePollContext(db, pollRow.context_type, pollRow.context_id);
  const organizerDisplayName =
    getUserDisplayMap(db, [pollRow.organizer_user_id]).get(pollRow.organizer_user_id) || 'Organizatör';
  const participants: SchedulingParticipant[] = ctx
    ? ctx.participants
    : [{ userId: pollRow.organizer_user_id, displayName: organizerDisplayName }];

  const participantIds = participants.map((p) => p.userId);
  const isStaff = ['admin', 'moderator'].includes(viewerRole);
  const canAccess = isStaff || participantIds.includes(viewerUserId) || pollRow.organizer_user_id === viewerUserId;
  if (!canAccess) return null;

  const optionRows = db
    .prepare(
      `SELECT * FROM scheduling_poll_options
       WHERE poll_id = ?
       ORDER BY sort_order ASC, option_date ASC, start_time ASC`
    )
    .all(pollRow.id) as any[];
  const options = optionRows.map(mapPollOption);

  const voteRows = db
    .prepare('SELECT * FROM scheduling_poll_votes WHERE poll_id = ?')
    .all(pollRow.id) as any[];
  const votes: SchedulingPollVote[] = voteRows.map((v) => ({
    pollId: v.poll_id,
    optionId: v.option_id,
    userId: v.user_id,
    response: v.response as PollVoteResponse,
    updatedAt: v.updated_at,
  }));

  const slotsByUserId = getParticipantSlotsMap(db, participantIds);
  const bookingsByUserId: Record<string, ReturnType<typeof getUserActiveBookings>> = {};
  for (const uid of participantIds) {
    bookingsByUserId[uid] = getUserActiveBookings(db, uid);
  }

  let venueName: string | undefined;
  let venueSlots: TimeSlotComparable[] = [];
  if (pollRow.venue_id) {
    const vRow = db.prepare('SELECT name FROM venues WHERE id = ?').get(pollRow.venue_id) as any;
    venueName = vRow?.name || undefined;
    const vsRows = db
      .prepare(`SELECT * FROM availability_slots WHERE owner_type = 'venue' AND owner_id = ?`)
      .all(pollRow.venue_id) as any[];
    venueSlots = vsRows.map((s) => ({
      id: s.id,
      ownerType: s.owner_type,
      ownerId: s.owner_id,
      slotDate: s.slot_date,
      startTime: s.start_time,
      endTime: s.end_time,
      recurrence: (s.recurrence || 'once') as AvailabilityRecurrence,
      slotKind: s.slot_kind as AvailabilityKind,
    }));
  }

  const rawEvaluations = options.map((opt) => {
    const votesByUserId: Record<string, PollVoteResponse | undefined> = {};
    for (const v of votes) {
      if (v.optionId === opt.id) {
        votesByUserId[v.userId] = v.response;
      }
    }
    return evaluateSchedulingOption({
      optionId: opt.id,
      optionDate: opt.optionDate,
      startTime: opt.startTime,
      endTime: opt.endTime,
      durationMins: Number(pollRow.duration_mins || 90),
      participants,
      votesByUserId,
      slotsByUserId,
      bookingsByUserId,
      venueId: pollRow.venue_id,
      venueName,
      venueSlots,
    });
  });

  const evaluations = markRecommendedOptions(rawEvaluations);
  const myVotes: Record<string, PollVoteResponse> = {};
  for (const v of votes) {
    if (v.userId === viewerUserId) {
      myVotes[v.optionId] = v.response;
    }
  }

  const canManage =
    isStaff ||
    pollRow.organizer_user_id === viewerUserId ||
    Boolean(ctx?.ownerUserIds.includes(viewerUserId));

  const today = getIstanbulTodayStr();
  const isBeforeDeadline = !pollRow.response_deadline || pollRow.response_deadline >= today;
  const canVote =
    pollRow.status === 'open' &&
    isBeforeDeadline &&
    (participantIds.includes(viewerUserId) || pollRow.organizer_user_id === viewerUserId);

  return {
    id: pollRow.id,
    contextType: pollRow.context_type,
    contextId: pollRow.context_id,
    contextTitle: ctx?.contextTitle || pollRow.title,
    title: pollRow.title,
    description: pollRow.description || '',
    organizerUserId: pollRow.organizer_user_id,
    organizerName: organizerDisplayName,
    venueId: pollRow.venue_id ?? null,
    venueName,
    durationMins: Number(pollRow.duration_mins || 90),
    responseDeadline: pollRow.response_deadline ?? null,
    status: pollRow.status,
    finalizedOptionId: pollRow.finalized_option_id ?? null,
    finalizedAt: pollRow.finalized_at ?? null,
    options,
    votes,
    evaluations,
    myVotes,
    canManage,
    canVote,
    createdAt: pollRow.created_at,
    updatedAt: pollRow.updated_at,
  };
}

function parseDateAndTimeFromFreeText(rawText: string, fallbackDate = ''): {
  date: string;
  startTime: string;
  endTime: string;
} | null {
  const txt = String(rawText || '').trim();
  const dateMatch = txt.match(/(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : fallbackDate;
  if (!isValidDateStr(date)) return null;

  const times = txt.match(/\b(\d{2}:\d{2})\b/g);
  const startTime = times?.[0] && isValidTimeStr(times[0]) ? times[0] : '19:00';
  let endTime = times?.[1] && isValidTimeStr(times[1]) ? times[1] : '';
  if (!endTime || parseTimeToMinutes(endTime) <= parseTimeToMinutes(startTime)) {
    const endMins = Math.min(23 * 60 + 59, parseTimeToMinutes(startTime) + 90);
    const hh = String(Math.floor(endMins / 60)).padStart(2, '0');
    const mm = String(endMins % 60).padStart(2, '0');
    endTime = `${hh}:${mm}`;
  }
  return { date, startTime, endTime };
}

export function buildPersonalCalendarEntries(
  db: DbInstance,
  userId: string,
  options?: { startDate?: string; endDate?: string; types?: Set<CalendarEntryType> }
): CalendarEntry[] {
  const entities = getUserOwnedEntities(db, userId);
  const entryMap = new Map<string, CalendarEntry>();

  const pushEntry = (entry: CalendarEntry) => {
    if (!isValidDateStr(entry.date)) return;
    if (options?.types && options.types.size > 0 && !options.types.has(entry.type)) return;
    if (options?.startDate && entry.date < options.startDate) return;
    if (options?.endDate && entry.date > options.endDate) return;
    if (!entryMap.has(entry.id)) {
      entryMap.set(entry.id, entry);
    }
  };

  // 1. Bookings (as performer, business owner, or accepted technical provider)
  const acceptedBookingIds = new Set<string>(
    (
      db
        .prepare(
          `SELECT DISTINCT tr.context_id
           FROM technical_quotes tq
           JOIN technical_requests tr ON tr.id = tq.request_id
           JOIN technical_providers tp ON tp.id = tq.provider_id
           WHERE tr.context_type = 'booking' AND tq.status = 'accepted' AND tp.user_id = ?`
        )
        .all(userId) as Array<{ context_id: string }>
    ).map((r) => r.context_id)
  );

  const allBookings = db
    .prepare(`SELECT * FROM bookings WHERE status != 'cancelled' ORDER BY event_date ASC`)
    .all() as any[];

  for (const bk of allBookings) {
    const isPerformer =
      bk.performer_user_id === userId ||
      entities.artistIds.includes(bk.performer_id) ||
      entities.ensembleIds.includes(bk.performer_id);
    const isBusiness = entities.businessIds.includes(bk.business_id);
    const isTech = acceptedBookingIds.has(bk.id);

    if (!isPerformer && !isBusiness && !isTech) continue;

    const startTime = bk.start_time && isValidTimeStr(bk.start_time) ? bk.start_time : '20:00';
    const endTime = bk.end_time && isValidTimeStr(bk.end_time) ? bk.end_time : '22:00';
    const sourceView = isTech
      ? 'production_desk'
      : isBusiness
      ? 'business_dashboard'
      : 'artist_dashboard';

    pushEntry({
      id: `bk:${bk.id}`,
      type: 'booking',
      title: bk.listing_title || 'Sahne Rezervasyonu',
      subtitle: `${bk.performer_name} · ${bk.business_name}`,
      date: bk.event_date,
      startTime,
      endTime,
      location: `${bk.venue_name}, ${bk.city}`,
      statusLabel:
        bk.status === 'confirmed'
          ? 'Onaylı Rezervasyon'
          : bk.status === 'completed'
          ? 'Tamamlandı'
          : 'Süreçteki Sahne',
      sourceView,
      sourceEntityId: isTech ? bk.id : bk.listing_id,
    });
  }

  // 2. Events organized by user
  const orgEvents = db
    .prepare('SELECT * FROM events WHERE creator_user_id = ?')
    .all(userId) as any[];
  for (const ev of orgEvents) {
    pushEntry({
      id: `evt_org:${ev.id}`,
      type: 'event_organizing',
      title: ev.title,
      subtitle: `Organizatör: ${ev.organizer_name}`,
      date: ev.event_date,
      startTime: ev.start_time && isValidTimeStr(ev.start_time) ? ev.start_time : '20:00',
      endTime: ev.end_time && isValidTimeStr(ev.end_time) ? ev.end_time : '22:00',
      location: `${ev.venue_name}, ${ev.city}`,
      statusLabel: ev.status === 'published' ? 'Yayındaki Etkinliğim' : 'Onay Bekliyor',
      sourceView: 'event_detail',
      sourceEntityId: ev.id,
    });
  }

  // 3. Events user registered to attend
  const regEvents = db
    .prepare(
      `SELECT er.id as reg_id, er.visibility, e.*
       FROM event_registrations er
       JOIN events e ON e.id = er.event_id
       WHERE er.user_id = ? AND er.status = 'confirmed'`
    )
    .all(userId) as any[];
  for (const row of regEvents) {
    pushEntry({
      id: `evt_reg:${row.id}`,
      type: 'event_attending',
      title: row.title,
      subtitle: row.visibility === 'public_attendee' ? 'Katılıyorum (Herkese Açık)' : 'Katılıyorum (Gizli)',
      date: row.event_date,
      startTime: row.start_time && isValidTimeStr(row.start_time) ? row.start_time : '20:00',
      endTime: row.end_time && isValidTimeStr(row.end_time) ? row.end_time : '22:00',
      location: `${row.venue_name}, ${row.city}`,
      statusLabel: 'Kayıtlı Etkinlik',
      sourceView: 'event_detail',
      sourceEntityId: row.id,
    });
  }

  // 4. Event reminders
  const reminderRows = db
    .prepare(
      `SELECT er.*, e.title, e.event_date, e.start_time, e.venue_name, e.city
       FROM event_reminders er
       JOIN events e ON e.id = er.event_id
       WHERE er.user_id = ?`
    )
    .all(userId) as any[];
  for (const rem of reminderRows) {
    const parsed = parseDateAndTimeFromFreeText(rem.remind_at, rem.event_date);
    if (!parsed) continue;
    pushEntry({
      id: `evt_rem:${rem.event_id}`,
      type: 'event_reminder',
      title: `Hatırlatma: ${rem.title}`,
      subtitle: rem.note || `${rem.event_date} tarihli etkinlik hatırlatıcısı`,
      date: parsed.date,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      location: `${rem.venue_name}, ${rem.city}`,
      statusLabel: 'Etkinlik Hatırlatıcısı',
      sourceView: 'event_detail',
      sourceEntityId: rem.event_id,
    });
  }

  // 5. Projects (deadlines, meetings, pending tasks)
  const projRows = db.prepare('SELECT * FROM projects').all() as any[];
  const userProjectIds = new Set<string>();
  for (const p of projRows) {
    const members = parseJson<Array<{ userId: string; status?: string }>>(p.members_json, []);
    const isMember =
      p.owner_user_id === userId || members.some((m) => m.userId === userId && m.status !== 'left');
    if (!isMember) continue;
    userProjectIds.add(p.id);

    if (isValidDateStr(p.delivery_date)) {
      pushEntry({
        id: `proj_dl:${p.id}`,
        type: 'project_deadline',
        title: `Teslim: ${p.title}`,
        subtitle: `${p.project_type} · Proje Teslim Tarihi`,
        date: p.delivery_date,
        startTime: '18:00',
        endTime: '19:00',
        location: p.is_remote ? 'Çevrimiçi' : p.city,
        statusLabel: 'Proje Teslimi',
        sourceView: 'project_workspace',
        sourceEntityId: p.id,
      });
    }

    const meetings = parseJson<Array<{ id: string; title: string; meetingDate: string; notes: string }>>(
      p.meetings_json,
      []
    );
    for (const m of meetings) {
      const parsed = parseDateAndTimeFromFreeText(m.meetingDate);
      if (!parsed) continue;
      pushEntry({
        id: `proj_mtg:${p.id}:${m.id}`,
        type: 'project_meeting',
        title: `${m.title} (${p.title})`,
        subtitle: m.notes || 'Proje Çalışma Toplantısı',
        date: parsed.date,
        startTime: parsed.startTime,
        endTime: parsed.endTime,
        location: p.is_remote ? 'Çevrimiçi' : p.city,
        statusLabel: 'Proje Toplantısı',
        sourceView: 'project_workspace',
        sourceEntityId: p.id,
      });
    }

    const tasks = parseJson<Array<{ id: string; title: string; assigneeName?: string; dueDate: string; status: string }>>(
      p.tasks_json,
      []
    );
    for (const t of tasks) {
      if (t.status === 'done' || !isValidDateStr(t.dueDate)) continue;
      pushEntry({
        id: `proj_tsk:${p.id}:${t.id}`,
        type: 'project_deadline',
        title: `Görev: ${t.title}`,
        subtitle: `${p.title}${t.assigneeName ? ` · ${t.assigneeName}` : ''}`,
        date: t.dueDate,
        startTime: '17:00',
        endTime: '18:00',
        location: p.city,
        statusLabel: 'Proje Görevi',
        sourceView: 'project_workspace',
        sourceEntityId: p.id,
      });
    }
  }

  // 6. Production workspaces schedule items
  const prodRows = db.prepare('SELECT * FROM production_workspaces').all() as any[];
  const userBookingIds = new Set<string>(
    allBookings
      .filter(
        (bk) =>
          bk.performer_user_id === userId ||
          entities.artistIds.includes(bk.performer_id) ||
          entities.ensembleIds.includes(bk.performer_id) ||
          entities.businessIds.includes(bk.business_id) ||
          acceptedBookingIds.has(bk.id)
      )
      .map((bk) => bk.id)
  );

  for (const ws of prodRows) {
    const canSeeWs =
      (ws.context_type === 'booking' && userBookingIds.has(ws.context_id)) ||
      (ws.context_type === 'project' && userProjectIds.has(ws.context_id));
    if (!canSeeWs || !isValidDateStr(ws.event_date)) continue;

    const schedule = parseJson<Array<{ id: string; time: string; title: string; ownerRole: string }>>(
      ws.schedule_json,
      []
    );
    for (const item of schedule) {
      const parsed = parseDateAndTimeFromFreeText(`${ws.event_date} ${item.time}`, ws.event_date);
      if (!parsed) continue;
      pushEntry({
        id: `prod_sch:${ws.id}:${item.id}`,
        type: 'production_schedule',
        title: `${item.title} (${ws.title})`,
        subtitle: `Sorumlu: ${item.ownerRole || 'Prodüksiyon'}`,
        date: parsed.date,
        startTime: parsed.startTime,
        endTime: parsed.endTime,
        location: ws.venue_name || 'Sahne',
        statusLabel: 'Prodüksiyon Akışı',
        sourceView: 'production_desk',
        sourceEntityId: ws.context_id,
      });
    }
  }

  // 7. User's own availability slots
  const availRows = db.prepare('SELECT * FROM availability_slots').all() as any[];
  for (const slot of availRows) {
    const isOwner =
      slot.owner_user_id === userId ||
      (slot.owner_type === 'artist' && entities.artistIds.includes(slot.owner_id)) ||
      (slot.owner_type === 'ensemble' && entities.ensembleIds.includes(slot.owner_id)) ||
      (slot.owner_type === 'venue' && entities.venueIds.includes(slot.owner_id)) ||
      (slot.owner_type === 'technical_provider' && entities.techIds.includes(slot.owner_id));
    if (!isOwner) continue;

    const recurrence = (slot.recurrence || 'once') as AvailabilityRecurrence;
    const vis = (slot.visibility || 'public') as AvailabilityVisibility;
    const kindLabels: Record<string, string> = {
      available: 'Müsaitim',
      open_stage: 'Açık Sahne',
      free_rehearsal: 'Prova Slotu',
      booked: 'Rezerve',
      blocked: 'Kapalı / Blokaj',
    };

    if (recurrence !== 'once' && options?.startDate && options?.endDate) {
      // Expand occurrences cleanly inside [startDate, endDate] (capped at 120 days for safety)
      let cursor = options.startDate;
      for (let i = 0; i < 120 && cursor <= options.endDate; i++) {
        if (isRecurringSlotActiveOnDate(slot.slot_date, recurrence, cursor)) {
          pushEntry({
            id: `avail:${slot.id}:${cursor}`,
            type: 'availability',
            title: slot.title,
            subtitle: `${slot.owner_name} · ${kindLabels[slot.slot_kind] || 'Müsaitlik'}`,
            date: cursor,
            startTime: slot.start_time,
            endTime: slot.end_time,
            location: slot.city,
            statusLabel: kindLabels[slot.slot_kind] || 'Takvim Kaydı',
            sourceView: slot.owner_type === 'venue' ? 'open_stage' : 'my_calendar',
            sourceEntityId: slot.id,
            visibility: vis,
            slotKind: slot.slot_kind,
          });
        }
        cursor = addDaysToDateStr(cursor, 1);
      }
    } else {
      pushEntry({
        id: `avail:${slot.id}`,
        type: 'availability',
        title: slot.title,
        subtitle: `${slot.owner_name} · ${kindLabels[slot.slot_kind] || 'Müsaitlik'}`,
        date: slot.slot_date,
        startTime: slot.start_time,
        endTime: slot.end_time,
        location: slot.city,
        statusLabel: kindLabels[slot.slot_kind] || 'Takvim Kaydı',
        sourceView: slot.owner_type === 'venue' ? 'open_stage' : 'my_calendar',
        sourceEntityId: slot.id,
        visibility: vis,
        slotKind: slot.slot_kind,
      });
    }
  }

  // 8. Scheduling Polls user is participating in
  const pollRows = db
    .prepare(`SELECT * FROM scheduling_polls WHERE status IN ('open', 'finalized')`)
    .all() as any[];
  for (const pr of pollRows) {
    const ctx = resolvePollContext(db, pr.context_type, pr.context_id);
    const participantIds = ctx ? ctx.participants.map((p) => p.userId) : [pr.organizer_user_id];
    if (!participantIds.includes(userId) && pr.organizer_user_id !== userId) continue;

    const opts = db
      .prepare('SELECT * FROM scheduling_poll_options WHERE poll_id = ? ORDER BY sort_order ASC, option_date ASC')
      .all(pr.id) as any[];
    if (opts.length === 0) continue;

    const chosenOpt =
      pr.status === 'finalized' && pr.finalized_option_id
        ? opts.find((o) => o.id === pr.finalized_option_id) || opts[0]
        : opts[0];

    const hasVoted = Boolean(
      db
        .prepare('SELECT 1 FROM scheduling_poll_votes WHERE poll_id = ? AND user_id = ? LIMIT 1')
        .get(pr.id, userId)
    );

    const targetView = pr.context_type === 'project' ? 'project_workspace' : 'production_desk';
    pushEntry({
      id: `poll:${pr.id}`,
      type: 'scheduling_poll',
      title: pr.status === 'finalized' ? `Kesinleşen: ${pr.title}` : `Zamanlama Anketi: ${pr.title}`,
      subtitle:
        pr.status === 'finalized'
          ? `${ctx?.contextTitle || pr.title} · Karara bağlandı`
          : `${opts.length} seçenek · ${hasVoted ? 'Oyunuz alındı' : 'Oyunuz bekleniyor'}`,
      date: chosenOpt.option_date,
      startTime: chosenOpt.start_time,
      endTime: chosenOpt.end_time,
      location: ctx?.contextTitle || 'Ortak Zamanlama',
      statusLabel: pr.status === 'finalized' ? 'Kesinleşen Zamanlama' : hasVoted ? 'Anket Açık' : 'Oyunuz Bekleniyor',
      sourceView: targetView,
      sourceEntityId: pr.context_id,
      isActionRequired: pr.status === 'open' && !hasVoted,
    });
  }

  return Array.from(entryMap.values()).sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.startTime.localeCompare(b.startTime);
  });
}

export function createCalendarRouter(db: DbInstance): Router {
  const router = Router();

  // Personal aggregated calendar
  router.get('/calendar/me', requireAuth, (req: AuthedRequest, res) => {
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : undefined;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : undefined;
    const rawTypes = req.query.types ? String(req.query.types).trim() : '';
    const types = rawTypes
      ? new Set(rawTypes.split(',').map((t) => t.trim()).filter(Boolean) as CalendarEntryType[])
      : undefined;

    const entries = buildPersonalCalendarEntries(db, req.user!.id, { startDate, endDate, types });
    return res.json({ entries });
  });

  // Personal calendar .ics export
  router.get('/calendar/me/ics', requireAuth, (req: AuthedRequest, res) => {
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : undefined;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : undefined;
    const entries = buildPersonalCalendarEntries(db, req.user!.id, { startDate, endDate });

    const ics = buildCalendarFeedIcs(
      entries.map((e) => ({
        uid: e.id,
        title: e.title,
        description: `${e.statusLabel} — ${e.subtitle}`,
        location: e.location,
        eventDate: e.date,
        startTime: e.startTime,
        endTime: e.endTime,
      }))
    );

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sanatsahnede-takvimim.ics"');
    return res.send(ics);
  });

  // Sanitized upcoming schedule for an artist/member profile (respects privacy & blocks)
  router.get('/calendar/users/:userId/upcoming', (req: AuthedRequest, res) => {
    const targetUserId = req.params.userId;
    const viewerId = req.user?.id || null;
    const isStaff = Boolean(req.user && ['admin', 'moderator'].includes(req.user.activeRole));

    const userRow = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId);
    if (!userRow) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

    if (viewerId && isBlockedBetween(db, viewerId, targetUserId)) {
      return res.json({ items: [], hidden: true });
    }

    const artistProfile = db
      .prepare('SELECT profile_visibility FROM individual_profiles WHERE user_id = ? LIMIT 1')
      .get(targetUserId) as { profile_visibility?: string } | undefined;

    if (artistProfile?.profile_visibility === 'private' && viewerId !== targetUserId && !isStaff) {
      return res.json({ items: [], hidden: true });
    }

    const today = getIstanbulTodayStr();
    const entities = getUserOwnedEntities(db, targetUserId);
    const items: UpcomingScheduleItem[] = [];

    // Confirmed upcoming stage bookings (sanitized: title, date, startTime, venueName, city, listing link)
    const bookingRows = db
      .prepare(
        `SELECT id, listing_id, listing_title, performer_id, performer_user_id, event_date, start_time, venue_name, city
         FROM bookings
         WHERE status IN ('confirmed', 'performer_completed', 'employer_completed') AND event_date >= ?
         ORDER BY event_date ASC`
      )
      .all(today) as any[];

    for (const bk of bookingRows) {
      const isPerformer =
        bk.performer_user_id === targetUserId ||
        entities.artistIds.includes(bk.performer_id) ||
        entities.ensembleIds.includes(bk.performer_id);
      if (!isPerformer) continue;
      items.push({
        id: `bk:${bk.id}`,
        kind: 'stage_booking',
        title: bk.listing_title || 'Sahne Performansı',
        date: bk.event_date,
        startTime: bk.start_time && isValidTimeStr(bk.start_time) ? bk.start_time : '20:00',
        venueName: bk.venue_name,
        city: bk.city,
        targetView: 'listing_detail',
        targetEntityId: bk.listing_id,
      });
    }

    // Opt-in public event attendance
    const eventRows = db
      .prepare(
        `SELECT e.id, e.title, e.event_date, e.start_time, e.venue_name, e.city
         FROM event_registrations er
         JOIN events e ON e.id = er.event_id
         WHERE er.user_id = ?
           AND er.status = 'confirmed'
           AND er.visibility = 'public_attendee'
           AND e.status = 'published'
           AND e.event_date >= ?
         ORDER BY e.event_date ASC`
      )
      .all(targetUserId, today) as any[];

    for (const ev of eventRows) {
      items.push({
        id: `ev:${ev.id}`,
        kind: 'event_attending',
        title: ev.title,
        date: ev.event_date,
        startTime: ev.start_time && isValidTimeStr(ev.start_time) ? ev.start_time : '20:00',
        venueName: ev.venue_name,
        city: ev.city,
        targetView: 'event_detail',
        targetEntityId: ev.id,
      });
    }

    items.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    return res.json({ items, hidden: false });
  });

  // =========================================================================
  // COLLABORATIVE SCHEDULING POLLS
  // =========================================================================

  router.get('/scheduling-polls', requireAuth, (req: AuthedRequest, res) => {
    const contextType = req.query.contextType ? String(req.query.contextType).trim() : '';
    const contextId = req.query.contextId ? String(req.query.contextId).trim() : '';

    let rows: any[];
    if (contextType && contextId) {
      rows = db
        .prepare(
          `SELECT * FROM scheduling_polls
           WHERE context_type = ? AND context_id = ?
           ORDER BY created_at DESC`
        )
        .all(contextType, contextId) as any[];
    } else if (contextId) {
      rows = db
        .prepare('SELECT * FROM scheduling_polls WHERE context_id = ? ORDER BY created_at DESC')
        .all(contextId) as any[];
    } else {
      rows = db.prepare('SELECT * FROM scheduling_polls ORDER BY created_at DESC').all() as any[];
    }

    const polls = rows
      .map((r) => hydratePoll(db, r, req.user!.id, req.user!.activeRole))
      .filter((p): p is SchedulingPoll => Boolean(p));

    return res.json({ polls });
  });

  router.post('/scheduling-polls', requireAuth, (req: AuthedRequest, res) => {
    const {
      contextType,
      contextId,
      title,
      description = '',
      venueId = null,
      durationMins = 90,
      responseDeadline = null,
      options = [],
    } = req.body || {};

    if (!contextType || !contextId || !title) {
      return res.status(400).json({ error: 'Anket bağlamı ve başlığı zorunludur.' });
    }

    const ctx = resolvePollContext(db, String(contextType), String(contextId));
    if (!ctx) {
      return res.status(404).json({ error: 'Bağlantılı proje veya prodüksiyon kaydı bulunamadı.' });
    }

    const isStaff = ['admin', 'moderator'].includes(req.user!.activeRole);
    const isParticipant = ctx.participants.some((p) => p.userId === req.user!.id);
    if (!isParticipant && !isStaff) {
      return res.status(403).json({ error: 'Bu çalışma alanında zamanlama anketi başlatma yetkiniz yok.' });
    }

    if (!Array.isArray(options) || options.length === 0) {
      return res.status(400).json({ error: 'En az bir tarih/saat seçeneği eklemelisiniz.' });
    }

    if (venueId) {
      const venueRow = db.prepare('SELECT id FROM venues WHERE id = ?').get(String(venueId));
      if (!venueRow) {
        return res.status(404).json({ error: 'Seçilen sahne/mekân bulunamadı.' });
      }
    }

    if (responseDeadline && !isValidDateStr(String(responseDeadline))) {
      return res.status(400).json({ error: 'Geçerli bir son yanıt tarihi giriniz (YYYY-AA-GG).' });
    }

    const sanitizedOptions: Array<{ optionDate: string; startTime: string; endTime: string; notes: string }> = [];
    for (const opt of options) {
      const optionDate = String(opt?.optionDate || '').trim();
      const startTime = String(opt?.startTime || '').trim();
      const endTime = String(opt?.endTime || '').trim();
      if (!isValidDateStr(optionDate) || !isValidTimeStr(startTime) || !isValidTimeStr(endTime)) {
        return res.status(400).json({ error: 'Tüm seçenekler için geçerli tarih ve saat aralığı giriniz.' });
      }
      if (parseTimeToMinutes(startTime) >= parseTimeToMinutes(endTime)) {
        return res.status(400).json({ error: 'Seçenek bitiş saati başlangıç saatinden sonra olmalıdır.' });
      }
      sanitizedOptions.push({
        optionDate,
        startTime,
        endTime,
        notes: String(opt?.notes || '').trim(),
      });
    }

    const pollId = newId('poll');
    const now = new Date().toISOString();
    const organizerName = `${req.user!.firstName} ${req.user!.lastName}`.trim();

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO scheduling_polls (
          id, context_type, context_id, title, description, organizer_user_id,
          venue_id, duration_mins, response_deadline, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
      `).run(
        pollId,
        ctx.contextType,
        ctx.contextId,
        String(title).trim(),
        String(description).trim(),
        req.user!.id,
        venueId ? String(venueId) : null,
        Math.max(15, Number(durationMins || 90)),
        responseDeadline ? String(responseDeadline) : null,
        now,
        now
      );

      sanitizedOptions.forEach((opt, idx) => {
        db.prepare(`
          INSERT INTO scheduling_poll_options (
            id, poll_id, option_date, start_time, end_time, notes, sort_order, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(newId('popt'), pollId, opt.optionDate, opt.startTime, opt.endTime, opt.notes, idx, now);
      });

      const targetView = ctx.contextType === 'project' ? 'project_workspace' : 'production_desk';
      for (const p of ctx.participants) {
        if (p.userId === req.user!.id) continue;
        notifyUser(db, {
          userId: p.userId,
          type: 'scheduling_poll_created',
          title: 'Yeni Ortak Zamanlama Anketi',
          body: `${organizerName}, "${ctx.contextTitle}" için "${String(title).trim()}" zamanlama anketini başlattı.`,
          linkView: targetView,
          linkEntityId: ctx.contextId,
        });
      }

      logAudit(db, {
        userId: req.user!.id,
        action: 'CREATE_SCHEDULING_POLL',
        resourceType: 'scheduling_poll',
        resourceId: pollId,
        details: { contextType: ctx.contextType, contextId: ctx.contextId, optionsCount: sanitizedOptions.length },
      });
    });

    tx();

    const created = db.prepare('SELECT * FROM scheduling_polls WHERE id = ?').get(pollId);
    return res.status(201).json({
      poll: hydratePoll(db, created, req.user!.id, req.user!.activeRole),
    });
  });

  router.patch('/scheduling-polls/:id', requireAuth, (req: AuthedRequest, res) => {
    const pollRow = db.prepare('SELECT * FROM scheduling_polls WHERE id = ?').get(req.params.id) as any;
    if (!pollRow) return res.status(404).json({ error: 'Zamanlama anketi bulunamadı.' });
    if (pollRow.status !== 'open') {
      return res.status(409).json({ error: 'Yalnızca açık anketler düzenlenebilir.' });
    }

    const ctx = resolvePollContext(db, pollRow.context_type, pollRow.context_id);
    const isStaff = ['admin', 'moderator'].includes(req.user!.activeRole);
    const canManage =
      isStaff ||
      pollRow.organizer_user_id === req.user!.id ||
      Boolean(ctx?.ownerUserIds.includes(req.user!.id));
    if (!canManage) {
      return res.status(403).json({ error: 'Bu anketi düzenleme yetkiniz yok.' });
    }

    const { title, description, venueId, durationMins, responseDeadline } = req.body || {};
    if (responseDeadline && !isValidDateStr(String(responseDeadline))) {
      return res.status(400).json({ error: 'Geçerli bir son yanıt tarihi giriniz.' });
    }

    db.prepare(`
      UPDATE scheduling_polls SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        venue_id = ?,
        duration_mins = COALESCE(?, duration_mins),
        response_deadline = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      title !== undefined ? String(title).trim() : null,
      description !== undefined ? String(description).trim() : null,
      venueId !== undefined ? (venueId ? String(venueId) : null) : pollRow.venue_id,
      durationMins !== undefined ? Math.max(15, Number(durationMins)) : null,
      responseDeadline !== undefined ? (responseDeadline ? String(responseDeadline) : null) : pollRow.response_deadline,
      new Date().toISOString(),
      pollRow.id
    );

    const updated = db.prepare('SELECT * FROM scheduling_polls WHERE id = ?').get(pollRow.id);
    return res.json({ poll: hydratePoll(db, updated, req.user!.id, req.user!.activeRole) });
  });

  router.post('/scheduling-polls/:id/options', requireAuth, (req: AuthedRequest, res) => {
    const pollRow = db.prepare('SELECT * FROM scheduling_polls WHERE id = ?').get(req.params.id) as any;
    if (!pollRow) return res.status(404).json({ error: 'Zamanlama anketi bulunamadı.' });
    if (pollRow.status !== 'open') {
      return res.status(409).json({ error: 'Kesinleşmiş veya iptal edilmiş ankete seçenek eklenemez.' });
    }

    const ctx = resolvePollContext(db, pollRow.context_type, pollRow.context_id);
    const isStaff = ['admin', 'moderator'].includes(req.user!.activeRole);
    const canManage =
      isStaff ||
      pollRow.organizer_user_id === req.user!.id ||
      Boolean(ctx?.ownerUserIds.includes(req.user!.id));
    if (!canManage) {
      return res.status(403).json({ error: 'Bu ankete seçenek ekleme yetkiniz yok.' });
    }

    const optionDate = String(req.body?.optionDate || '').trim();
    const startTime = String(req.body?.startTime || '').trim();
    const endTime = String(req.body?.endTime || '').trim();
    const notes = String(req.body?.notes || '').trim();

    if (!isValidDateStr(optionDate) || !isValidTimeStr(startTime) || !isValidTimeStr(endTime)) {
      return res.status(400).json({ error: 'Geçerli tarih ve saat aralığı giriniz.' });
    }
    if (parseTimeToMinutes(startTime) >= parseTimeToMinutes(endTime)) {
      return res.status(400).json({ error: 'Bitiş saati başlangıç saatinden sonra olmalıdır.' });
    }

    const countRow = db
      .prepare('SELECT COUNT(*) as cnt FROM scheduling_poll_options WHERE poll_id = ?')
      .get(pollRow.id) as { cnt: number };
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO scheduling_poll_options (
        id, poll_id, option_date, start_time, end_time, notes, sort_order, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(newId('popt'), pollRow.id, optionDate, startTime, endTime, notes, Number(countRow?.cnt || 0), now);

    db.prepare('UPDATE scheduling_polls SET updated_at = ? WHERE id = ?').run(now, pollRow.id);

    const updated = db.prepare('SELECT * FROM scheduling_polls WHERE id = ?').get(pollRow.id);
    return res.status(201).json({ poll: hydratePoll(db, updated, req.user!.id, req.user!.activeRole) });
  });

  router.patch('/scheduling-polls/:id/options/:optId', requireAuth, (req: AuthedRequest, res) => {
    const pollRow = db.prepare('SELECT * FROM scheduling_polls WHERE id = ?').get(req.params.id) as any;
    if (!pollRow) return res.status(404).json({ error: 'Zamanlama anketi bulunamadı.' });
    if (pollRow.status !== 'open') {
      return res.status(409).json({ error: 'Yalnızca açık anket seçenekleri güncellenebilir.' });
    }

    const ctx = resolvePollContext(db, pollRow.context_type, pollRow.context_id);
    const isStaff = ['admin', 'moderator'].includes(req.user!.activeRole);
    const canManage =
      isStaff ||
      pollRow.organizer_user_id === req.user!.id ||
      Boolean(ctx?.ownerUserIds.includes(req.user!.id));
    if (!canManage) return res.status(403).json({ error: 'Yetkisiz işlem.' });

    const optRow = db
      .prepare('SELECT * FROM scheduling_poll_options WHERE id = ? AND poll_id = ?')
      .get(req.params.optId, pollRow.id) as any;
    if (!optRow) return res.status(404).json({ error: 'Anket seçeneği bulunamadı.' });

    const optionDate = req.body?.optionDate ? String(req.body.optionDate).trim() : optRow.option_date;
    const startTime = req.body?.startTime ? String(req.body.startTime).trim() : optRow.start_time;
    const endTime = req.body?.endTime ? String(req.body.endTime).trim() : optRow.end_time;
    const notes = req.body?.notes !== undefined ? String(req.body.notes).trim() : optRow.notes;

    if (!isValidDateStr(optionDate) || !isValidTimeStr(startTime) || !isValidTimeStr(endTime)) {
      return res.status(400).json({ error: 'Geçerli tarih ve saat giriniz.' });
    }
    if (parseTimeToMinutes(startTime) >= parseTimeToMinutes(endTime)) {
      return res.status(400).json({ error: 'Bitiş saati başlangıç saatinden sonra olmalıdır.' });
    }

    db.prepare(`
      UPDATE scheduling_poll_options SET
        option_date = ?, start_time = ?, end_time = ?, notes = ?
      WHERE id = ?
    `).run(optionDate, startTime, endTime, notes, optRow.id);

    const updated = db.prepare('SELECT * FROM scheduling_polls WHERE id = ?').get(pollRow.id);
    return res.json({ poll: hydratePoll(db, updated, req.user!.id, req.user!.activeRole) });
  });

  router.delete('/scheduling-polls/:id/options/:optId', requireAuth, (req: AuthedRequest, res) => {
    const pollRow = db.prepare('SELECT * FROM scheduling_polls WHERE id = ?').get(req.params.id) as any;
    if (!pollRow) return res.status(404).json({ error: 'Zamanlama anketi bulunamadı.' });
    if (pollRow.status !== 'open') {
      return res.status(409).json({ error: 'Kesinleşmiş anketteki seçenek silinemez.' });
    }

    const ctx = resolvePollContext(db, pollRow.context_type, pollRow.context_id);
    const isStaff = ['admin', 'moderator'].includes(req.user!.activeRole);
    const canManage =
      isStaff ||
      pollRow.organizer_user_id === req.user!.id ||
      Boolean(ctx?.ownerUserIds.includes(req.user!.id));
    if (!canManage) return res.status(403).json({ error: 'Yetkisiz işlem.' });

    const countRow = db
      .prepare('SELECT COUNT(*) as cnt FROM scheduling_poll_options WHERE poll_id = ?')
      .get(pollRow.id) as { cnt: number };
    if (Number(countRow?.cnt || 0) <= 1) {
      return res.status(400).json({ error: 'Ankette en az bir tarih seçeneği kalmalıdır.' });
    }

    db.prepare('DELETE FROM scheduling_poll_options WHERE id = ? AND poll_id = ?').run(req.params.optId, pollRow.id);
    const updated = db.prepare('SELECT * FROM scheduling_polls WHERE id = ?').get(pollRow.id);
    return res.json({ poll: hydratePoll(db, updated, req.user!.id, req.user!.activeRole) });
  });

  router.post('/scheduling-polls/:id/vote', requireAuth, (req: AuthedRequest, res) => {
    const pollRow = db.prepare('SELECT * FROM scheduling_polls WHERE id = ?').get(req.params.id) as any;
    if (!pollRow) return res.status(404).json({ error: 'Zamanlama anketi bulunamadı.' });
    if (pollRow.status !== 'open') {
      return res.status(409).json({ error: 'Bu zamanlama anketi oylamaya kapatılmıştır.' });
    }

    const today = getIstanbulTodayStr();
    if (pollRow.response_deadline && pollRow.response_deadline < today) {
      return res.status(409).json({ error: 'Anketin son oylama tarihi geçmiştir.' });
    }

    const ctx = resolvePollContext(db, pollRow.context_type, pollRow.context_id);
    const participantIds = ctx ? ctx.participants.map((p) => p.userId) : [pollRow.organizer_user_id];
    const isParticipant = participantIds.includes(req.user!.id) || pollRow.organizer_user_id === req.user!.id;
    if (!isParticipant) {
      return res.status(403).json({ error: 'Yalnızca ilgili ekip katılımcıları oy kullanabilir.' });
    }

    const incomingVotes: Array<{ optionId: string; response: PollVoteResponse }> = Array.isArray(req.body?.votes)
      ? req.body.votes
      : req.body?.optionId
      ? [{ optionId: String(req.body.optionId), response: req.body.response }]
      : [];

    if (incomingVotes.length === 0) {
      return res.status(400).json({ error: 'Oylanacak seçenek ve yanıt belirtilmelidir.' });
    }

    const validOptIds = new Set(
      (db.prepare('SELECT id FROM scheduling_poll_options WHERE poll_id = ?').all(pollRow.id) as Array<{ id: string }>).map(
        (o) => o.id
      )
    );

    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      for (const v of incomingVotes) {
        if (!validOptIds.has(v.optionId)) {
          throw Object.assign(new Error('Geçersiz anket seçeneği.'), { status: 400 });
        }
        if (!VALID_VOTE_RESPONSES.has(v.response)) {
          throw Object.assign(new Error('Geçersiz oy değeri (available, unavailable veya maybe olmalı).'), { status: 400 });
        }
        db.prepare(`
          INSERT INTO scheduling_poll_votes (poll_id, option_id, user_id, response, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(option_id, user_id) DO UPDATE SET response = excluded.response, updated_at = excluded.updated_at
        `).run(pollRow.id, v.optionId, req.user!.id, v.response, now);
      }
      db.prepare('UPDATE scheduling_polls SET updated_at = ? WHERE id = ?').run(now, pollRow.id);
    });

    try {
      tx();
    } catch (err: any) {
      return res.status(err?.status || 400).json({ error: err?.message || 'Oy kaydedilemedi.' });
    }

    const updated = db.prepare('SELECT * FROM scheduling_polls WHERE id = ?').get(pollRow.id);
    return res.json({ poll: hydratePoll(db, updated, req.user!.id, req.user!.activeRole) });
  });

  router.post('/scheduling-polls/:id/finalize', requireAuth, (req: AuthedRequest, res) => {
    const optionId = String(req.body?.optionId || '').trim();
    if (!optionId) {
      return res.status(400).json({ error: 'Kesinleştirilecek zaman seçeneği (optionId) zorunludur.' });
    }

    const forceFinalize = Boolean(req.body?.force);

    const tx = db.transaction(() => {
      const pollRow = db.prepare('SELECT * FROM scheduling_polls WHERE id = ?').get(req.params.id) as any;
      if (!pollRow) {
        throw Object.assign(new Error('Zamanlama anketi bulunamadı.'), { status: 404 });
      }
      if (pollRow.status !== 'open') {
        throw Object.assign(new Error('Bu zamanlama anketi zaten kesinleştirilmiş veya iptal edilmiş.'), { status: 409 });
      }

      const ctx = resolvePollContext(db, pollRow.context_type, pollRow.context_id);
      const isStaff = ['admin', 'moderator'].includes(req.user!.activeRole);
      const canManage =
        isStaff ||
        pollRow.organizer_user_id === req.user!.id ||
        Boolean(ctx?.ownerUserIds.includes(req.user!.id));
      if (!canManage) {
        throw Object.assign(new Error('Anketi kesinleştirme yetkiniz bulunmamaktadır.'), { status: 403 });
      }

      const opt = db
        .prepare('SELECT * FROM scheduling_poll_options WHERE id = ? AND poll_id = ?')
        .get(optionId, pollRow.id) as any;
      if (!opt) {
        throw Object.assign(new Error('Seçilen tarih/saat seçeneği bu ankette bulunamadı.'), { status: 404 });
      }

      // Live DB conflict checks right inside the transaction to guard against races
      if (pollRow.venue_id) {
        const venueSlots = db
          .prepare(`SELECT * FROM availability_slots WHERE owner_type = 'venue' AND owner_id = ?`)
          .all(pollRow.venue_id) as any[];
        const venueBusy = venueSlots.find(
          (s) =>
            (s.slot_kind === 'booked' || s.slot_kind === 'blocked') &&
            isRecurringSlotActiveOnDate(s.slot_date, (s.recurrence || 'once') as AvailabilityRecurrence, opt.option_date) &&
            rangesOverlap(opt.start_time, opt.end_time, s.start_time, s.end_time)
        );
        if (venueBusy) {
          throw Object.assign(
            new Error(
              `Seçilen mekân ${opt.option_date} ${opt.start_time}-${opt.end_time} aralığında başka bir rezervasyon/blokaj ile çakışıyor.`
            ),
            { status: 409 }
          );
        }
      }

      if (!forceFinalize && ctx) {
        const participantIds = ctx.participants.map((p) => p.userId);
        const slotsByUserId = getParticipantSlotsMap(db, participantIds);
        for (const p of ctx.participants) {
          const bookings = getUserActiveBookings(db, p.userId);
          const hasBk = bookings.find(
            (bk) =>
              bk.eventDate === opt.option_date &&
              rangesOverlap(
                opt.start_time,
                opt.end_time,
                bk.startTime && isValidTimeStr(bk.startTime) ? bk.startTime : '19:00',
                bk.endTime && isValidTimeStr(bk.endTime) ? bk.endTime : '22:00'
              )
          );
          if (hasBk) {
            throw Object.assign(
              new Error(`${p.displayName} için ${opt.option_date} tarihinde onaylı sahne rezervasyonu çakışması tespit edildi.`),
              { status: 409 }
            );
          }

          const bookedSlot = (slotsByUserId[p.userId] || []).find(
            (s) =>
              s.slotKind === 'booked' &&
              isRecurringSlotActiveOnDate(s.slotDate, s.recurrence, opt.option_date) &&
              rangesOverlap(opt.start_time, opt.end_time, s.startTime, s.endTime)
          );
          if (bookedSlot) {
            throw Object.assign(
              new Error(`${p.displayName} için ${opt.option_date} tarihinde kesinleşmiş takvim çakışması mevcut.`),
              { status: 409 }
            );
          }
        }
      }

      const now = new Date().toISOString();
      db.prepare(`
        UPDATE scheduling_polls
        SET status = 'finalized', finalized_option_id = ?, finalized_at = ?, updated_at = ?
        WHERE id = ?
      `).run(opt.id, now, now, pollRow.id);

      // Persist confirmed schedule item to linked Project meetings or Production Workspace
      if (ctx?.targetWorkspaceType === 'project') {
        const proj = db.prepare('SELECT meetings_json FROM projects WHERE id = ?').get(pollRow.context_id) as any;
        if (proj) {
          const meetings = parseJson<Array<any>>(proj.meetings_json, []);
          meetings.push({
            id: newId('mtg'),
            title: pollRow.title,
            meetingDate: `${opt.option_date} ${opt.start_time}-${opt.end_time}`,
            notes: opt.notes || pollRow.description || 'Ortak Zamanlama Anketi ile kesinleştirildi.',
          });
          db.prepare('UPDATE projects SET meetings_json = ? WHERE id = ?').run(
            JSON.stringify(meetings),
            pollRow.context_id
          );
        }
      }

      const ws = db
        .prepare('SELECT id, schedule_json FROM production_workspaces WHERE context_type = ? AND context_id = ?')
        .get(ctx?.targetWorkspaceType || 'booking', pollRow.context_id) as any;

      if (ws) {
        const schedule = parseJson<Array<any>>(ws.schedule_json, []);
        schedule.push({
          id: newId('sch'),
          time: `${opt.start_time}-${opt.end_time}`,
          title: `${pollRow.title} (${opt.option_date})`,
          ownerRole: 'Ortak Zamanlama',
        });
        db.prepare('UPDATE production_workspaces SET schedule_json = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(schedule),
          now,
          ws.id
        );
      } else if (ctx?.targetWorkspaceType === 'booking') {
        const bkRow = db
          .prepare('SELECT listing_title, venue_name FROM bookings WHERE id = ?')
          .get(pollRow.context_id) as any;
        db.prepare(`
          INSERT INTO production_workspaces (
            id, context_type, context_id, title, event_date, venue_name,
            rider_json, stage_plot_json, schedule_json, tasks_json, logistics_json, updated_at
          ) VALUES (?, 'booking', ?, ?, ?, ?, ?, '[]', ?, '[]', ?, ?)
        `).run(
          newId('prod'),
          pollRow.context_id,
          bkRow?.listing_title || pollRow.title,
          opt.option_date,
          bkRow?.venue_name || 'Sahne',
          JSON.stringify({ stageSize: '6m x 4m', soundRequirements: '', lightRequirements: '', microphones: [], backline: [], monitors: '', ioPatchList: '', specialNotes: '' }),
          JSON.stringify([{ id: newId('sch'), time: `${opt.start_time}-${opt.end_time}`, title: `${pollRow.title} (${opt.option_date})`, ownerRole: 'Ortak Zamanlama' }]),
          JSON.stringify({ travelSummary: '', accommodationSummary: '', transferNotes: '', arrivalTime: '' }),
          now
        );
      }

      // If venue selected, reserve venue slot atomically
      if (pollRow.venue_id) {
        const venue = db.prepare('SELECT id, manager_user_id, name, city FROM venues WHERE id = ?').get(pollRow.venue_id) as any;
        if (venue) {
          db.prepare(`
            INSERT INTO availability_slots (
              id, owner_type, owner_id, owner_user_id, owner_name, title,
              slot_date, start_time, end_time, recurrence, slot_kind, visibility,
              is_free, fee_amount, city, notes, created_at
            ) VALUES (?, 'venue', ?, ?, ?, ?, ?, ?, ?, 'once', 'booked', 'private', 0, 0, ?, ?, ?)
          `).run(
            newId('slot'),
            venue.id,
            venue.manager_user_id,
            venue.name,
            `Rezerve: ${pollRow.title}`,
            opt.option_date,
            opt.start_time,
            opt.end_time,
            venue.city || 'İstanbul',
            `Anket ID: ${pollRow.id}`,
            now
          );
        }
      }

      const targetView = pollRow.context_type === 'project' ? 'project_workspace' : 'production_desk';
      if (ctx) {
        for (const p of ctx.participants) {
          if (p.userId === req.user!.id) continue;
          notifyUser(db, {
            userId: p.userId,
            type: 'scheduling_poll_finalized',
            title: 'Ortak Zamanlama Kesinleşti',
            body: `"${pollRow.title}" için ortak zaman ${opt.option_date} ${opt.start_time}-${opt.end_time} olarak kesinleştirildi.`,
            linkView: targetView,
            linkEntityId: pollRow.context_id,
          });
        }
      }

      logAudit(db, {
        userId: req.user!.id,
        action: 'FINALIZE_SCHEDULING_POLL',
        resourceType: 'scheduling_poll',
        resourceId: pollRow.id,
        details: { optionId: opt.id, optionDate: opt.option_date, startTime: opt.start_time, endTime: opt.end_time },
      });

      return db.prepare('SELECT * FROM scheduling_polls WHERE id = ?').get(pollRow.id);
    });

    try {
      const finalizedRow = tx();
      return res.json({
        poll: hydratePoll(db, finalizedRow, req.user!.id, req.user!.activeRole),
      });
    } catch (err: any) {
      return res.status(err?.status || 500).json({ error: err?.message || 'Zamanlama kesinleştirilemedi.' });
    }
  });

  router.post('/scheduling-polls/:id/cancel', requireAuth, (req: AuthedRequest, res) => {
    const pollRow = db.prepare('SELECT * FROM scheduling_polls WHERE id = ?').get(req.params.id) as any;
    if (!pollRow) return res.status(404).json({ error: 'Zamanlama anketi bulunamadı.' });
    if (pollRow.status !== 'open') {
      return res.status(409).json({ error: 'Yalnızca açık anketler iptal edilebilir.' });
    }

    const ctx = resolvePollContext(db, pollRow.context_type, pollRow.context_id);
    const isStaff = ['admin', 'moderator'].includes(req.user!.activeRole);
    const canManage =
      isStaff ||
      pollRow.organizer_user_id === req.user!.id ||
      Boolean(ctx?.ownerUserIds.includes(req.user!.id));
    if (!canManage) {
      return res.status(403).json({ error: 'Bu anketi iptal etme yetkiniz yok.' });
    }

    const now = new Date().toISOString();
    db.prepare(`UPDATE scheduling_polls SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(now, pollRow.id);

    if (ctx) {
      const targetView = pollRow.context_type === 'project' ? 'project_workspace' : 'production_desk';
      for (const p of ctx.participants) {
        if (p.userId === req.user!.id) continue;
        notifyUser(db, {
          userId: p.userId,
          type: 'scheduling_poll_cancelled',
          title: 'Zamanlama Anketi İptal Edildi',
          body: `"${pollRow.title}" zamanlama anketi iptal edildi.`,
          linkView: targetView,
          linkEntityId: pollRow.context_id,
        });
      }
    }

    const updated = db.prepare('SELECT * FROM scheduling_polls WHERE id = ?').get(pollRow.id);
    return res.json({ poll: hydratePoll(db, updated, req.user!.id, req.user!.activeRole) });
  });

  router.get('/scheduling-polls/:id/ics', requireAuth, (req: AuthedRequest, res) => {
    const pollRow = db.prepare('SELECT * FROM scheduling_polls WHERE id = ?').get(req.params.id) as any;
    if (!pollRow) return res.status(404).json({ error: 'Zamanlama anketi bulunamadı.' });

    const hydrated = hydratePoll(db, pollRow, req.user!.id, req.user!.activeRole);
    if (!hydrated) {
      return res.status(403).json({ error: 'Bu zamanlama anketine erişim yetkiniz yok.' });
    }

    const chosenOpt =
      (hydrated.finalizedOptionId && hydrated.options.find((o) => o.id === hydrated.finalizedOptionId)) ||
      hydrated.options[0];
    if (!chosenOpt) {
      return res.status(404).json({ error: 'Dışa aktarılacak zaman seçeneği bulunamadı.' });
    }

    const ics = buildCalendarFeedIcs([
      {
        uid: `poll-${hydrated.id}-${chosenOpt.id}`,
        title: `${hydrated.title} (${hydrated.contextTitle})`,
        description: hydrated.description || 'SanatSahnede Ortak Zamanlama',
        location: hydrated.venueName || hydrated.contextTitle,
        eventDate: chosenOpt.optionDate,
        startTime: chosenOpt.startTime,
        endTime: chosenOpt.endTime,
      },
    ]);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sanatsahnede-anket-${hydrated.id}.ics"`);
    return res.send(ics);
  });

  return router;
}
