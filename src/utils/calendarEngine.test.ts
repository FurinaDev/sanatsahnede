import test from 'node:test';
import assert from 'node:assert/strict';
import {
  doAvailabilitySlotsConflict,
  evaluateSchedulingOption,
  getIstanbulTodayStr,
  hasConfirmedBookingOverlap,
  isRecurringSlotActiveOnDate,
  isValidDateStr,
  isValidTimeStr,
  markRecommendedOptions,
  buildCalendarFeedIcs,
} from './calendarEngine';

test('Calendar validation helpers handle valid and invalid dates/times', () => {
  assert.equal(isValidDateStr('2026-12-15'), true);
  assert.equal(isValidDateStr('2026-02-30'), false);
  assert.equal(isValidDateStr('2026/12/15'), false);
  assert.equal(isValidTimeStr('19:30'), true);
  assert.equal(isValidTimeStr('25:00'), false);
  assert.match(getIstanbulTodayStr(new Date('2026-11-16T22:30:00Z')), /^2026-11-17$/);
});

test('doAvailabilitySlotsConflict detects same ownerType+ownerId and recurring weekly/monthly overlaps while separating owner types', () => {
  const weeklyVenueSlot = {
    id: 'slot_w',
    ownerType: 'venue',
    ownerId: 'venue_1',
    slotDate: '2026-11-29', // Sunday
    startTime: '19:00',
    endTime: '22:00',
    recurrence: 'weekly' as const,
  };

  // Next Sunday (7 days later) at 20:00-21:00 conflicts
  assert.equal(
    doAvailabilitySlotsConflict(weeklyVenueSlot, {
      ownerType: 'venue',
      ownerId: 'venue_1',
      slotDate: '2026-12-06',
      startTime: '20:00',
      endTime: '21:00',
      recurrence: 'once',
    }),
    true
  );

  // Monday does not conflict
  assert.equal(
    doAvailabilitySlotsConflict(weeklyVenueSlot, {
      ownerType: 'venue',
      ownerId: 'venue_1',
      slotDate: '2026-12-07',
      startTime: '20:00',
      endTime: '21:00',
      recurrence: 'once',
    }),
    false
  );

  // Different ownerType with identical ID never falsely collides
  assert.equal(
    doAvailabilitySlotsConflict(weeklyVenueSlot, {
      ownerType: 'artist',
      ownerId: 'venue_1',
      slotDate: '2026-12-06',
      startTime: '20:00',
      endTime: '21:00',
      recurrence: 'once',
    }),
    false
  );

  // Monthly recurrence check
  assert.equal(isRecurringSlotActiveOnDate('2026-11-15', 'monthly', '2027-01-15'), true);
  assert.equal(isRecurringSlotActiveOnDate('2026-11-15', 'monthly', '2026-10-15'), false);
});

test('hasConfirmedBookingOverlap flags active bookings and ignores cancelled ones', () => {
  const bookings = [
    {
      id: 'bk_1',
      eventDate: '2026-12-10',
      startTime: '20:00',
      endTime: '22:00',
      status: 'confirmed',
    },
    {
      id: 'bk_2',
      eventDate: '2026-12-11',
      startTime: '20:00',
      endTime: '22:00',
      status: 'cancelled',
    },
  ];

  assert.equal(hasConfirmedBookingOverlap('2026-12-10', '21:00', '23:00', bookings)?.id, 'bk_1');
  assert.equal(hasConfirmedBookingOverlap('2026-12-10', '17:00', '19:30', bookings), undefined);
  assert.equal(hasConfirmedBookingOverlap('2026-12-11', '20:30', '21:30', bookings), undefined);
});

test('evaluateSchedulingOption computes real counts, venue status, conflict flags without leaking private titles, and selects best option', () => {
  const participants = [
    { userId: 'u1', displayName: 'Selin Arslan' },
    { userId: 'u2', displayName: 'Efe Özkan' },
    { userId: 'u3', displayName: 'Deniz Kaya' },
  ];

  const opt1 = evaluateSchedulingOption({
    optionId: 'opt_1',
    optionDate: '2026-12-18',
    startTime: '18:00',
    endTime: '20:00',
    durationMins: 120,
    participants,
    votesByUserId: { u1: 'available', u2: 'available', u3: 'maybe' },
    slotsByUserId: {
      u2: [
        {
          ownerType: 'artist',
          ownerId: 'a2',
          slotDate: '2026-12-18',
          startTime: '17:00',
          endTime: '22:00',
          recurrence: 'once',
          slotKind: 'available',
        },
      ],
    },
    bookingsByUserId: {
      u1: [{ id: 'bk_u1', eventDate: '2026-12-18', startTime: '19:00', endTime: '21:00', status: 'confirmed' }],
    },
    venueId: 'v1',
    venueName: 'Kadıköy Akustik',
    venueSlots: [
      {
        ownerType: 'venue',
        ownerId: 'v1',
        slotDate: '2026-12-18',
        startTime: '17:00',
        endTime: '22:00',
        recurrence: 'once',
        slotKind: 'available',
      },
    ],
  });

  const opt2 = evaluateSchedulingOption({
    optionId: 'opt_2',
    optionDate: '2026-12-19',
    startTime: '18:00',
    endTime: '20:00',
    durationMins: 120,
    participants,
    votesByUserId: { u1: 'available', u2: 'available', u3: 'available' },
    slotsByUserId: {},
    bookingsByUserId: {},
    venueId: 'v1',
    venueName: 'Kadıköy Akustik',
    venueSlots: [
      {
        ownerType: 'venue',
        ownerId: 'v1',
        slotDate: '2026-12-19',
        startTime: '17:00',
        endTime: '22:00',
        recurrence: 'once',
        slotKind: 'available',
      },
    ],
  });

  const ranked = markRecommendedOptions([opt1, opt2]);
  assert.equal(ranked[0].hasHardConflict, true);
  assert.equal(ranked[0].calendarConflictCount, 1);
  // Conflict reason uses sanitized label, never raw private slot title/notes
  assert.equal(ranked[0].participants[0].conflictReasonLabel, 'Onaylı sahne rezervasyonu çakışması');
  assert.equal(ranked[1].hasHardConflict, false);
  assert.equal(ranked[1].availableCount, 3);
  assert.equal(ranked[1].venueStatus, 'available');
  assert.equal(ranked[1].isRecommended, true);
  assert.equal(ranked[0].isRecommended, false);
});

test('buildCalendarFeedIcs emits valid VCALENDAR with Europe/Istanbul TZID', () => {
  const ics = buildCalendarFeedIcs([
    {
      uid: 'poll-1',
      title: 'Boğazın Yankıları Provası',
      description: 'Ortak Zamanlama',
      location: 'Kadıköy Akustik',
      eventDate: '2026-12-19',
      startTime: '18:00',
      endTime: '20:00',
    },
  ]);
  assert.ok(ics.includes('BEGIN:VCALENDAR'));
  assert.ok(ics.includes('DTSTART;TZID=Europe/Istanbul:20261219T180000'));
  assert.ok(ics.includes('SUMMARY:Boğazın Yankıları Provası'));
});
