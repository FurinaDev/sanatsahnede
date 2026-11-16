import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCareerPassportCsv,
  formatProjectMeetingsIcs,
  formatTechnicalRiderDocument,
  generateIcsCalendarEvent,
} from './exportHelpers';
import { ProductionWorkspace } from '../types';

test('generateIcsCalendarEvent produces valid RFC 5545 VCALENDAR with escaped Turkish text', () => {
  const ics = generateIcsCalendarEvent({
    uid: 'bk_123',
    title: 'Gala Gecesi, Piyano Resitali; İstanbul',
    description: 'Soundcheck 18:00\nKonser 20:00',
    location: 'Bosphorus Balo Salonu, Beşiktaş',
    eventDate: '2026-11-28',
    startTime: '20:00',
    endTime: '21:30',
  });

  assert.ok(ics.includes('BEGIN:VCALENDAR'));
  assert.ok(ics.includes('END:VCALENDAR'));
  assert.ok(ics.includes('DTSTART;TZID=Europe/Istanbul:20261128T200000'));
  assert.ok(ics.includes('DTEND;TZID=Europe/Istanbul:20261128T213000'));
  assert.ok(ics.includes('SUMMARY:Gala Gecesi\\, Piyano Resitali\\; İstanbul'));
  assert.ok(ics.includes('DESCRIPTION:Soundcheck 18:00\\nKonser 20:00'));
});

test('formatTechnicalRiderDocument summarizes rider, stage plot, schedule, logistics, and tasks', () => {
  const ws: ProductionWorkspace = {
    id: 'prod_1',
    contextType: 'booking',
    contextId: 'bk_1',
    title: 'Oda Müziği Akşamı',
    eventDate: '2026-12-10',
    venueName: 'Kadıköy Akustik',
    rider: {
      stageSize: '6x4m',
      soundRequirements: 'Akustik piyano + 2 condenser',
      lightRequirements: 'Sıcak sahne ışığı',
      microphones: ['Neumann KM184'],
      backline: ['Steinway D-274'],
      monitors: '2 wedge',
      ioPatchList: 'Ch1-2 Piano L/R',
      specialNotes: '442Hz akort',
    },
    stagePlot: [{ id: 's1', kind: 'instrument', label: 'Piyano', x: 50, y: 40 }],
    schedule: [{ id: 'sch1', time: '18:00', title: 'Soundcheck', ownerRole: 'İcracı' }],
    tasks: [{ id: 't1', title: 'Akort onayı', assigneeRole: 'business_owner', dueDate: '2026-12-10', completed: true }],
    logistics: {
      travelSummary: 'Araç tahsis edildi',
      accommodationSummary: 'Yok',
      transferNotes: '17:30 karşılama',
      arrivalTime: '17:45',
    },
    updatedAt: '2026-11-16T10:00:00Z',
  };

  const doc = formatTechnicalRiderDocument(ws);
  assert.ok(doc.includes('Oda Müziği Akşamı'));
  assert.ok(doc.includes('Steinway D-274'));
  assert.ok(doc.includes('[X] Akort onayı'));
  assert.ok(doc.includes('18:00 — Soundcheck'));
});

test('formatCareerPassportCsv outputs UTF-8 BOM CSV with escaped quotes and verified labels', () => {
  const csv = formatCareerPassportCsv('Efe Özkan', [
    {
      id: 'c1',
      artistId: 'a1',
      userId: 'u1',
      title: 'Gala "Boğaz", Konseri',
      organizationName: 'Grand Bosphorus',
      venueName: 'Balo Salonu',
      roleTitle: 'Solist',
      eventDate: '2026-10-12',
      sourceType: 'booking',
      isVerifiedRecord: true,
      createdAt: '2026-10-13T00:00:00Z',
    },
  ]);

  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"Gala ""Boğaz"", Konseri"'));
  assert.ok(csv.includes('Platform Doğrulamalı'));
});

test('formatProjectMeetingsIcs exports all project meetings into one ICS calendar', () => {
  const ics = formatProjectMeetingsIcs('Anadolu Akustik Projesi', 'İstanbul', [
    { id: 'm1', title: 'Repertuvar Toplantısı', meetingDate: '2027-01-18', notes: 'Eser seçimi' },
    { id: 'm2', title: 'Prova Planı', meetingDate: '2027-01-25', notes: 'Saatler' },
  ]);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(ics.includes('Anadolu Akustik Projesi — Prova Planı'));
});
