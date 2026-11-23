import { generateIcsCalendarBatch, IcsEventInput } from './exportHelpers';

export type AvailabilityVisibility = 'private' | 'project_team' | 'public';
export type AvailabilityRecurrence = 'once' | 'weekly' | 'monthly';
export type AvailabilityKind = 'available' | 'open_stage' | 'free_rehearsal' | 'booked' | 'blocked';
export type PollVoteResponse = 'available' | 'unavailable' | 'maybe';

export interface TimeSlotComparable {
  id?: string;
  ownerType: string;
  ownerId: string;
  slotDate: string;
  startTime: string;
  endTime: string;
  recurrence: AvailabilityRecurrence;
  slotKind?: AvailabilityKind;
}

export interface SchedulingParticipant {
  userId: string;
  displayName: string;
  roleTitle?: string;
}

export interface SchedulingParticipantEval {
  userId: string;
  displayName: string;
  vote: PollVoteResponse | null;
  calendarStatus: 'free' | 'available_slot' | 'conflict';
  conflictReasonLabel?: string;
}

export interface SchedulingOptionEvaluation {
  optionId: string;
  optionDate: string;
  startTime: string;
  endTime: string;
  totalParticipants: number;
  availableCount: number;
  unavailableCount: number;
  maybeCount: number;
  noVoteCount: number;
  calendarConflictCount: number;
  venueStatus: 'not_specified' | 'available' | 'conflict' | 'unavailable';
  venueLabel?: string;
  score: number;
  isRecommended: boolean;
  hasHardConflict: boolean;
  participants: SchedulingParticipantEval[];
}

export function isValidDateStr(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function isValidTimeStr(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [h, m] = value.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function parseTimeToMinutes(hhmm: string): number {
  const [h, m] = String(hhmm || '00:00').split(':').map((n) => Number(n));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export function rangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  const a1 = parseTimeToMinutes(startA);
  const a2 = parseTimeToMinutes(endA);
  const b1 = parseTimeToMinutes(startB);
  const b2 = parseTimeToMinutes(endB);
  return a1 < b2 && b1 < a2;
}

export function getIstanbulTodayStr(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value || '2026';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

export function getDayOfWeekUtc(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function getDayOfMonth(dateStr: string): number {
  return Number(dateStr.split('-')[2] || 0);
}

export function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function isRecurringSlotActiveOnDate(
  slotDate: string,
  recurrence: AvailabilityRecurrence,
  targetDate: string
): boolean {
  if (!isValidDateStr(slotDate) || !isValidDateStr(targetDate)) return false;
  if (slotDate === targetDate) return true;
  if (recurrence === 'once') return false;
  if (targetDate < slotDate) return false;
  if (recurrence === 'weekly') {
    return getDayOfWeekUtc(slotDate) === getDayOfWeekUtc(targetDate);
  }
  if (recurrence === 'monthly') {
    return getDayOfMonth(slotDate) === getDayOfMonth(targetDate);
  }
  return false;
}

/**
 * Checks whether two availability slots owned by the same (ownerType, ownerId)
 * overlap in both calendar occurrence (once/weekly/monthly) and time range.
 */
export function doAvailabilitySlotsConflict(
  slotA: TimeSlotComparable,
  slotB: TimeSlotComparable
): boolean {
  if (slotA.id && slotB.id && slotA.id === slotB.id) return false;
  if (slotA.ownerType !== slotB.ownerType || slotA.ownerId !== slotB.ownerId) {
    return false;
  }
  if (!rangesOverlap(slotA.startTime, slotA.endTime, slotB.startTime, slotB.endTime)) {
    return false;
  }

  if (slotA.slotDate === slotB.slotDate) return true;

  // One-off vs recurring
  if (slotA.recurrence === 'once' && slotB.recurrence !== 'once') {
    return isRecurringSlotActiveOnDate(slotB.slotDate, slotB.recurrence, slotA.slotDate);
  }
  if (slotB.recurrence === 'once' && slotA.recurrence !== 'once') {
    return isRecurringSlotActiveOnDate(slotA.slotDate, slotA.recurrence, slotB.slotDate);
  }
  if (slotA.recurrence === 'once' && slotB.recurrence === 'once') {
    return false;
  }

  // Two recurring slots overlap if any occurrence in the next 366 days collides
  const anchor = slotA.slotDate >= slotB.slotDate ? slotA.slotDate : slotB.slotDate;
  for (let i = 0; i < 366; i++) {
    const candidate = addDaysToDateStr(anchor, i);
    if (
      isRecurringSlotActiveOnDate(slotA.slotDate, slotA.recurrence, candidate) &&
      isRecurringSlotActiveOnDate(slotB.slotDate, slotB.recurrence, candidate)
    ) {
      return true;
    }
  }
  return false;
}

export interface ConfirmedBookingComparable {
  id: string;
  eventDate: string;
  startTime?: string | null;
  endTime?: string | null;
  status: string;
  performerUserId?: string;
}

const ACTIVE_BOOKING_STATUSES = new Set([
  'confirmed',
  'performer_completed',
  'employer_completed',
  'payment_pending',
  'agreement_pending',
]);

export function hasConfirmedBookingOverlap(
  targetDate: string,
  startTime: string,
  endTime: string,
  bookings: ConfirmedBookingComparable[],
  recurrence: AvailabilityRecurrence = 'once'
): ConfirmedBookingComparable | undefined {
  return bookings.find((bk) => {
    if (!ACTIVE_BOOKING_STATUSES.has(bk.status)) return false;
    if (!isRecurringSlotActiveOnDate(targetDate, recurrence, bk.eventDate)) return false;
    const bkStart = bk.startTime && isValidTimeStr(bk.startTime) ? bk.startTime : '19:00';
    const bkEnd = bk.endTime && isValidTimeStr(bk.endTime) ? bk.endTime : '22:00';
    return rangesOverlap(startTime, endTime, bkStart, bkEnd);
  });
}

export interface EvaluateOptionInput {
  optionId: string;
  optionDate: string;
  startTime: string;
  endTime: string;
  durationMins?: number;
  participants: SchedulingParticipant[];
  votesByUserId: Record<string, PollVoteResponse | undefined>;
  slotsByUserId: Record<string, TimeSlotComparable[] | undefined>;
  bookingsByUserId: Record<string, ConfirmedBookingComparable[] | undefined>;
  venueId?: string | null;
  venueName?: string;
  venueSlots?: TimeSlotComparable[];
}

/**
 * Evaluates a scheduling poll option against real participant votes, availability slots,
 * confirmed bookings, and target venue availability WITHOUT leaking peer private details.
 */
export function evaluateSchedulingOption(input: EvaluateOptionInput): SchedulingOptionEvaluation {
  const {
    optionId,
    optionDate,
    startTime,
    endTime,
    durationMins = 90,
    participants,
    votesByUserId,
    slotsByUserId,
    bookingsByUserId,
    venueId,
    venueName,
    venueSlots = [],
  } = input;

  const optionMinutes = parseTimeToMinutes(endTime) - parseTimeToMinutes(startTime);
  const meetsDuration = optionMinutes >= Math.min(durationMins, optionMinutes || durationMins);

  let availableCount = 0;
  let unavailableCount = 0;
  let maybeCount = 0;
  let noVoteCount = 0;
  let calendarConflictCount = 0;

  const evalParticipants: SchedulingParticipantEval[] = participants.map((p) => {
    const vote = votesByUserId[p.userId] ?? null;
    if (vote === 'available') availableCount += 1;
    else if (vote === 'unavailable') unavailableCount += 1;
    else if (vote === 'maybe') maybeCount += 1;
    else noVoteCount += 1;

    const userBookings = bookingsByUserId[p.userId] || [];
    const bookingHit = hasConfirmedBookingOverlap(optionDate, startTime, endTime, userBookings, 'once');

    const userSlots = slotsByUserId[p.userId] || [];
    const blockingSlot = userSlots.find(
      (s) =>
        (s.slotKind === 'booked' || s.slotKind === 'blocked') &&
        isRecurringSlotActiveOnDate(s.slotDate, s.recurrence, optionDate) &&
        rangesOverlap(startTime, endTime, s.startTime, s.endTime)
    );
    const openSlot = userSlots.find(
      (s) =>
        (s.slotKind === 'available' || s.slotKind === 'open_stage' || s.slotKind === 'free_rehearsal') &&
        isRecurringSlotActiveOnDate(s.slotDate, s.recurrence, optionDate) &&
        parseTimeToMinutes(s.startTime) <= parseTimeToMinutes(startTime) &&
        parseTimeToMinutes(s.endTime) >= parseTimeToMinutes(endTime)
    );

    let calendarStatus: SchedulingParticipantEval['calendarStatus'] = 'free';
    let conflictReasonLabel: string | undefined;

    if (bookingHit || blockingSlot) {
      calendarStatus = 'conflict';
      calendarConflictCount += 1;
      conflictReasonLabel = bookingHit
        ? 'Onaylı sahne rezervasyonu çakışması'
        : 'Takviminde kapalı / rezerve blok var';
    } else if (openSlot) {
      calendarStatus = 'available_slot';
    }

    return {
      userId: p.userId,
      displayName: p.displayName,
      vote,
      calendarStatus,
      conflictReasonLabel,
    };
  });

  let venueStatus: SchedulingOptionEvaluation['venueStatus'] = 'not_specified';
  if (venueId) {
    const matchingVenueSlots = venueSlots.filter(
      (s) =>
        s.ownerType === 'venue' &&
        s.ownerId === venueId &&
        isRecurringSlotActiveOnDate(s.slotDate, s.recurrence, optionDate)
    );

    const venueBlocked = matchingVenueSlots.some(
      (s) =>
        (s.slotKind === 'booked' || s.slotKind === 'blocked') &&
        rangesOverlap(startTime, endTime, s.startTime, s.endTime)
    );
    const venueOpen = matchingVenueSlots.some(
      (s) =>
        (s.slotKind === 'available' || s.slotKind === 'open_stage' || s.slotKind === 'free_rehearsal') &&
        parseTimeToMinutes(s.startTime) <= parseTimeToMinutes(startTime) &&
        parseTimeToMinutes(s.endTime) >= parseTimeToMinutes(endTime)
    );

    if (venueBlocked) {
      venueStatus = 'conflict';
    } else if (venueOpen || matchingVenueSlots.length === 0) {
      venueStatus = venueOpen ? 'available' : 'available';
    } else {
      venueStatus = 'unavailable';
    }
  }

  const hasHardConflict = calendarConflictCount > 0 || venueStatus === 'conflict';

  // Deterministic, transparent scoring
  let score = availableCount * 10 + maybeCount * 4 - unavailableCount * 15 - calendarConflictCount * 12;
  if (venueStatus === 'available') score += 5;
  if (venueStatus === 'conflict') score -= 25;
  if (venueStatus === 'unavailable') score -= 8;
  if (!meetsDuration) score -= 5;
  // Bonus if participant declared an open availability window covering this option
  const openSlotParticipants = evalParticipants.filter((p) => p.calendarStatus === 'available_slot').length;
  score += openSlotParticipants * 2;

  return {
    optionId,
    optionDate,
    startTime,
    endTime,
    totalParticipants: participants.length,
    availableCount,
    unavailableCount,
    maybeCount,
    noVoteCount,
    calendarConflictCount,
    venueStatus,
    venueLabel: venueName,
    score,
    isRecommended: false,
    hasHardConflict,
    participants: evalParticipants,
  };
}

export function markRecommendedOptions(
  evaluations: SchedulingOptionEvaluation[]
): SchedulingOptionEvaluation[] {
  if (evaluations.length === 0) return [];
  const viable = evaluations.filter((e) => !e.hasHardConflict && e.unavailableCount === 0);
  const pool = viable.length > 0 ? viable : evaluations.filter((e) => !e.hasHardConflict);
  const bestPool = pool.length > 0 ? pool : evaluations;
  const maxScore = Math.max(...bestPool.map((e) => e.score));

  return evaluations.map((ev) => ({
    ...ev,
    isRecommended: bestPool.some((b) => b.optionId === ev.optionId) && ev.score === maxScore && maxScore > -10,
  }));
}

export function buildCalendarFeedIcs(items: IcsEventInput[]): string {
  return generateIcsCalendarBatch(items);
}
