import type { EventAnnouncement } from '../types';

export function isEventFree(event: Pick<EventAnnouncement, 'isFree' | 'ticketPrice'>): boolean {
  return Boolean(event.isFree) || Number(event.ticketPrice || 0) <= 0;
}

export function formatEventSchedule(
  event: Pick<EventAnnouncement, 'eventDate' | 'startTime' | 'endTime'>
): string {
  const timePart = event.endTime
    ? `${event.startTime} - ${event.endTime}`
    : event.startTime || '20:00';
  return `${event.eventDate} · ${timePart}`;
}

export interface EventTicketAction {
  mode: 'free_register' | 'paid_ticket' | 'paid_contact';
  label: string;
  href?: string;
  hostLabel?: string;
}

export function getEventTicketAction(
  event: Pick<EventAnnouncement, 'isFree' | 'ticketPrice' | 'ticketUrl' | 'organizerContact'>
): EventTicketAction {
  if (isEventFree(event)) {
    return {
      mode: 'free_register',
      label: 'Ücretsiz Kayıt Ol',
    };
  }

  const rawUrl = (event.ticketUrl || '').trim();
  if (rawUrl) {
    let hostLabel = '';
    try {
      const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
      hostLabel = parsed.hostname.replace(/^www\./, '');
      return {
        mode: 'paid_ticket',
        label: 'Bilet Al',
        href: parsed.toString(),
        hostLabel,
      };
    } catch {
      // Fallback if URL is malformed
    }
  }

  const contact = (event.organizerContact || '').trim();
  const mailHref = contact.includes('@') ? `mailto:${contact}` : undefined;

  return {
    mode: 'paid_contact',
    label: 'Bilet Al',
    href: mailHref,
  };
}

export function buildGoogleCalendarUrl(item: EventAnnouncement): string {
  const title = encodeURIComponent(item.title);
  const details = encodeURIComponent(
    `${item.description}\n\nİcracılar: ${item.performers}\nMekân: ${item.venueName}, ${item.city}\nDüzenleyen: ${item.organizerName}`
  );
  const location = encodeURIComponent(`${item.venueName}, ${item.city}`);
  const cleanDate = item.eventDate.replace(/-/g, '');
  const startHour = item.startTime ? item.startTime.replace(/:/g, '') : '2000';
  const endHour = item.endTime ? item.endTime.replace(/:/g, '') : '2200';
  const dates = `${cleanDate}T${startHour}00/${cleanDate}T${endHour}00`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}&location=${location}`;
}

export function validateEventRegistrationInput(input: {
  name: string;
  email: string;
}): { valid: boolean; error?: string } {
  const name = input.name.trim();
  const email = input.email.trim();
  if (name.length < 2) {
    return { valid: false, error: 'Lütfen ad ve soyadınızı giriniz.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, error: 'Lütfen geçerli bir e-posta adresi giriniz.' };
  }
  return { valid: true };
}
