import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleCalendarUrl,
  formatEventSchedule,
  getEventTicketAction,
  isEventFree,
  validateEventRegistrationInput,
} from './eventDetailUtils';
import type { EventAnnouncement } from '../types';

const SAMPLE_FREE_EVENT: EventAnnouncement = {
  id: 'evt_free',
  title: 'Beyoğlu Tarihi Salon Dinletisi',
  category: 'Müzik & Konser',
  organizerName: 'Pera Kültür',
  organizerContact: 'bilgi@perakultur.org',
  venueName: 'Pera Tarihi Konser Salonu',
  city: 'İstanbul',
  district: 'Beyoğlu',
  eventDate: '2026-12-05',
  startTime: '18:00',
  endTime: '19:30',
  genres: ['Oda Müziği'],
  performers: 'İstanbul String Trio',
  ticketPrice: 0,
  isFree: true,
  description: 'Ücretsiz halk dinletisi.',
  status: 'published',
  createdAt: '2026-11-06T15:30:00Z',
};

const SAMPLE_PAID_EVENT: EventAnnouncement = {
  ...SAMPLE_FREE_EVENT,
  id: 'evt_paid',
  title: 'Boğaziçi Sonbahar Akustik Resitali',
  ticketPrice: 250,
  isFree: false,
  ticketUrl: 'https://biletix.com/etkinlik/ornek-bogazici-resital',
};

describe('eventDetailUtils', () => {
  it('detects free vs paid events accurately', () => {
    assert.equal(isEventFree(SAMPLE_FREE_EVENT), true);
    assert.equal(isEventFree({ isFree: false, ticketPrice: 0 }), true);
    assert.equal(isEventFree(SAMPLE_PAID_EVENT), false);
  });

  it('returns appropriate ticket/registration action modes', () => {
    const freeAction = getEventTicketAction(SAMPLE_FREE_EVENT);
    assert.equal(freeAction.mode, 'free_register');
    assert.equal(freeAction.label, 'Ücretsiz Kayıt Ol');

    const paidAction = getEventTicketAction(SAMPLE_PAID_EVENT);
    assert.equal(paidAction.mode, 'paid_ticket');
    assert.equal(paidAction.label, 'Bilet Al');
    assert.equal(paidAction.hostLabel, 'biletix.com');
    assert.equal(paidAction.href, 'https://biletix.com/etkinlik/ornek-bogazici-resital');

    const paidNoUrl = getEventTicketAction({
      isFree: false,
      ticketPrice: 180,
      ticketUrl: '',
      organizerContact: 'bilet@kurum.org',
    });
    assert.equal(paidNoUrl.mode, 'paid_contact');
    assert.equal(paidNoUrl.href, 'mailto:bilet@kurum.org');
  });

  it('formats schedule and builds Google Calendar URL', () => {
    assert.equal(formatEventSchedule(SAMPLE_FREE_EVENT), '2026-12-05 · 18:00 - 19:30');
    const url = buildGoogleCalendarUrl(SAMPLE_PAID_EVENT);
    assert.ok(url.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE'));
    assert.ok(url.includes('20261205T180000/20261205T193000'));
  });

  it('validates registration form inputs', () => {
    assert.equal(validateEventRegistrationInput({ name: 'E', email: 'test@example.com' }).valid, false);
    assert.equal(validateEventRegistrationInput({ name: 'Deniz Kaya', email: 'bad-email' }).valid, false);
    assert.equal(validateEventRegistrationInput({ name: 'Deniz Kaya', email: 'deniz@example.com' }).valid, true);
  });
});
