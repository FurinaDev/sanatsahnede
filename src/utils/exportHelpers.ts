import { CareerRecord, ProductionWorkspace, ProjectMeeting } from '../types';

function escapeIcsText(value: string): string {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function toIcsDateTime(dateStr: string, timeStr = '20:00'): string {
  const cleanDate = String(dateStr || '2026-12-01').replace(/[^0-9]/g, '').slice(0, 8).padEnd(8, '0');
  const [hhRaw, mmRaw] = String(timeStr || '20:00').split(':');
  const hh = String(hhRaw || '20').replace(/[^0-9]/g, '').padStart(2, '0').slice(0, 2);
  const mm = String(mmRaw || '00').replace(/[^0-9]/g, '').padStart(2, '0').slice(0, 2);
  return `${cleanDate}T${hh}${mm}00`;
}

export interface IcsEventInput {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  eventDate: string;
  startTime?: string;
  endTime?: string;
}

export function generateIcsCalendarEvent(input: IcsEventInput): string {
  return generateIcsCalendarBatch([input]);
}

export function generateIcsCalendarBatch(events: IcsEventInput[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SanatSahnede//Takvim Export//TR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const ev of events) {
    const start = toIcsDateTime(ev.eventDate, ev.startTime || '20:00');
    const end = toIcsDateTime(ev.eventDate, ev.endTime || '21:30');
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeIcsText(ev.uid)}@sanatsahnede.com`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;TZID=Europe/Istanbul:${start}`);
    lines.push(`DTEND;TZID=Europe/Istanbul:${end}`);
    lines.push(`SUMMARY:${escapeIcsText(ev.title)}`);
    if (ev.location) lines.push(`LOCATION:${escapeIcsText(ev.location)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function formatTechnicalRiderDocument(workspace: ProductionWorkspace): string {
  const lines: string[] = [
    'SANATSAHNEDE — TEKNİK RİDER VE SAHNE PROGRAMI',
    '====================================================',
    `Başlık       : ${workspace.title}`,
    `Tarih        : ${workspace.eventDate}`,
    `Mekân        : ${workspace.venueName}`,
    `Güncelleme   : ${workspace.updatedAt}`,
    '',
    '1. SAHNE VE TEKNİK RİDER',
    '------------------------',
    `Sahne Ölçüsü      : ${workspace.rider.stageSize || '-'}`,
    `Ses Gereksinimi   : ${workspace.rider.soundRequirements || '-'}`,
    `Işık Gereksinimi  : ${workspace.rider.lightRequirements || '-'}`,
    `Monitör İhtiyacı  : ${workspace.rider.monitors || '-'}`,
    `I/O Kanal Listesi : ${workspace.rider.ioPatchList || '-'}`,
    `Mikrofonlar       : ${workspace.rider.microphones.length > 0 ? workspace.rider.microphones.join(', ') : '-'}`,
    `Backline          : ${workspace.rider.backline.length > 0 ? workspace.rider.backline.join(', ') : '-'}`,
    `Özel Notlar       : ${workspace.rider.specialNotes || '-'}`,
    '',
    '2. SAHNE YERLEŞİMİ (STAGE PLOT)',
    '-------------------------------',
    ...(workspace.stagePlot.length > 0
      ? workspace.stagePlot.map((item, idx) => `${idx + 1}. [${item.kind}] ${item.label} (Konum: X %${item.x}, Y %${item.y})`)
      : ['Henüz sahne yerleşim öğesi eklenmemiş.']),
    '',
    '3. SAHNE AKIŞ PROGRAMI (RUN OF SHOW)',
    '------------------------------------',
    ...(workspace.schedule.length > 0
      ? workspace.schedule.map((s) => `${s.time} — ${s.title} (${s.ownerRole})`)
      : ['Henüz program akışı eklenmemiş.']),
    '',
    '4. LOJİSTİK VE VARIS PLANI',
    '--------------------------',
    `Varış Saati : ${workspace.logistics.arrivalTime || '-'}`,
    `Ulaşım      : ${workspace.logistics.travelSummary || '-'}`,
    `Konaklama   : ${workspace.logistics.accommodationSummary || '-'}`,
    `Transfer    : ${workspace.logistics.transferNotes || '-'}`,
    '',
    '5. KONTROL LİSTESİ',
    '------------------',
    ...(workspace.tasks.length > 0
      ? workspace.tasks.map((t) => `[${t.completed ? 'X' : ' '}] ${t.title} (${t.assigneeRole} · ${t.dueDate})`)
      : ['Görev bulunmuyor.']),
  ];
  return lines.join('\n');
}

function escapeCsvCell(value: string): string {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function formatCareerPassportCsv(artistName: string, records: CareerRecord[]): string {
  const headers = ['Sanatçı', 'Etkinlik / Sahne', 'Kurum / Organizatör', 'Mekân', 'Rol', 'Tarih', 'Doğrulama Durumu'];
  const rows = records.map((r) => [
    escapeCsvCell(artistName),
    escapeCsvCell(r.title),
    escapeCsvCell(r.organizationName),
    escapeCsvCell(r.venueName),
    escapeCsvCell(r.roleTitle),
    escapeCsvCell(r.eventDate),
    escapeCsvCell(r.isVerifiedRecord ? 'Platform Doğrulamalı' : 'Sanatçı Beyanı'),
  ]);
  // UTF-8 BOM for clean Turkish character rendering in Excel
  return '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}

export function formatProjectMeetingsIcs(projectTitle: string, city: string, meetings: ProjectMeeting[]): string {
  return generateIcsCalendarBatch(
    meetings.map((m) => ({
      uid: `proj-mtg-${m.id}`,
      title: `${projectTitle} — ${m.title}`,
      description: m.notes || 'Proje çalışma toplantısı',
      location: city,
      eventDate: m.meetingDate,
      startTime: '19:00',
      endTime: '20:30',
    }))
  );
}

export function triggerBrowserDownload(filename: string, content: string, mimeType = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
