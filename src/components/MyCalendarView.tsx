import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppView, useApp } from '../context/AppContext';
import { apiRequest, getSessionToken } from '../services/api';
import { triggerBrowserDownload } from '../utils/exportHelpers';
import { addDaysToDateStr, getIstanbulTodayStr } from '../utils/calendarEngine';
import { AvailabilitySlot, CalendarEntry, CalendarEntryType } from '../types';
import {
  AlertCircle,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Edit3,
  ExternalLink,
  List,
  Lock,
  MapPin,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react';

type CalendarDisplayMode = 'month' | 'week' | 'day' | 'upcoming';
type FilterGroupKey =
  | 'all'
  | 'bookings'
  | 'events'
  | 'projects'
  | 'production'
  | 'availability'
  | 'polls';

const FILTER_GROUPS: Array<{ key: FilterGroupKey; label: string; types: CalendarEntryType[] }> = [
  { key: 'all', label: 'Tümü', types: [] },
  { key: 'bookings', label: 'Rezervasyonlar', types: ['booking'] },
  {
    key: 'events',
    label: 'Etkinlikler',
    types: ['event_organizing', 'event_attending', 'event_reminder'],
  },
  {
    key: 'projects',
    label: 'Proje & Toplantılar',
    types: ['project_meeting', 'project_deadline'],
  },
  { key: 'production', label: 'Prodüksiyon', types: ['production_schedule'] },
  { key: 'availability', label: 'Müsaitlik & Blokaj', types: ['availability'] },
  { key: 'polls', label: 'Zamanlama Anketleri', types: ['scheduling_poll'] },
];

const ENTRY_TYPE_STYLES: Record<CalendarEntryType, { badge: string; dot: string; label: string }> = {
  booking: {
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    label: 'Sahne Rezervasyonu',
  },
  event_organizing: {
    badge: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300',
    dot: 'bg-indigo-500',
    label: 'Düzenlediğim Etkinlik',
  },
  event_attending: {
    badge: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
    dot: 'bg-sky-500',
    label: 'Katılacağım Etkinlik',
  },
  event_reminder: {
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
    dot: 'bg-amber-500',
    label: 'Etkinlik Hatırlatıcısı',
  },
  project_meeting: {
    badge: 'bg-orange-100 text-[#DE5626] dark:bg-orange-500/20 dark:text-orange-300',
    dot: 'bg-[#DE5626]',
    label: 'Proje Toplantısı',
  },
  project_deadline: {
    badge: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
    dot: 'bg-rose-500',
    label: 'Proje Teslim / Görev',
  },
  production_schedule: {
    badge: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300',
    dot: 'bg-violet-500',
    label: 'Prodüksiyon Akışı',
  },
  availability: {
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    dot: 'bg-slate-500',
    label: 'Müsaitlik / Blokaj',
  },
  scheduling_poll: {
    badge: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
    dot: 'bg-amber-500',
    label: 'Ortak Zamanlama Anketi',
  },
};

const TR_MONTHS = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

const TR_DAYS_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

function getMonthRange(anchorDate: string): {
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  gridDays: Array<{ date: string; inCurrentMonth: boolean }>;
} {
  const [yStr, mStr] = anchorDate.split('-');
  const year = Number(yStr) || 2026;
  const month = Number(mStr) || 1;
  const firstOfMonth = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  const firstDateObj = new Date(Date.UTC(year, month - 1, 1));
  const jsDay = firstDateObj.getUTCDay(); // 0=Sun..6=Sat
  const offsetFromMonday = jsDay === 0 ? 6 : jsDay - 1;
  const gridStart = addDaysToDateStr(firstOfMonth, -offsetFromMonday);

  const gridDays: Array<{ date: string; inCurrentMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const d = addDaysToDateStr(gridStart, i);
    const inCurrentMonth = d.startsWith(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-`);
    gridDays.push({ date: d, inCurrentMonth });
  }
  return {
    year,
    month,
    startDate: gridDays[0].date,
    endDate: gridDays[41].date,
    gridDays,
  };
}

function getWeekDays(anchorDate: string): string[] {
  const [y, m, d] = anchorDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const jsDay = dt.getUTCDay();
  const offsetFromMonday = jsDay === 0 ? 6 : jsDay - 1;
  const monday = addDaysToDateStr(anchorDate, -offsetFromMonday);
  return Array.from({ length: 7 }, (_, i) => addDaysToDateStr(monday, i));
}

export const MyCalendarView: React.FC = () => {
  const {
    isAuthenticated,
    currentUser,
    setAuthModalMode,
    navigateTo,
    artists,
    ensembles,
    venues,
    technicalProviders,
    availabilitySlots,
    refreshBootstrap,
  } = useApp();

  const todayStr = useMemo(() => getIstanbulTodayStr(), []);
  const [mode, setMode] = useState<CalendarDisplayMode>('month');
  const [filterGroup, setFilterGroup] = useState<FilterGroupKey>('all');
  const [anchorDate, setAnchorDate] = useState<string>(todayStr);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Availability Slot Modal (create or edit)
  const [slotModalOpen, setSlotModalOpen] = useState(false);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [slotSaving, setSlotSaving] = useState(false);
  const [slotModalError, setSlotModalError] = useState<string | null>(null);
  const [slotForm, setSlotForm] = useState({
    ownerKey: '',
    title: 'Müsait / Prova Penceresi',
    slotDate: todayStr,
    startTime: '14:00',
    endTime: '17:00',
    recurrence: 'once' as 'once' | 'weekly' | 'monthly',
    slotKind: 'available' as AvailabilitySlot['slotKind'],
    visibility: 'private' as 'private' | 'project_team' | 'public',
    notes: '',
  });

  const ownedProfiles = useMemo(() => {
    if (!isAuthenticated) return [];
    const list: Array<{
      ownerType: 'artist' | 'ensemble' | 'venue' | 'technical_provider';
      ownerId: string;
      label: string;
      city: string;
    }> = [];
    artists
      .filter((a) => a.userId === currentUser.id)
      .forEach((a) =>
        list.push({ ownerType: 'artist', ownerId: a.id, label: `Sanatçı: ${a.fullName}`, city: a.city })
      );
    ensembles
      .filter((e) => e.leaderUserId === currentUser.id)
      .forEach((e) =>
        list.push({ ownerType: 'ensemble', ownerId: e.id, label: `Topluluk: ${e.name}`, city: e.city })
      );
    venues
      .filter((v) => v.managerUserId === currentUser.id || currentUser.activeRole === 'admin')
      .forEach((v) =>
        list.push({ ownerType: 'venue', ownerId: v.id, label: `Mekân: ${v.name}`, city: v.city })
      );
    technicalProviders
      .filter((tp) => tp.userId === currentUser.id)
      .forEach((tp) =>
        list.push({
          ownerType: 'technical_provider',
          ownerId: tp.id,
          label: `Teknik: ${tp.name}`,
          city: tp.city,
        })
      );
    return list;
  }, [isAuthenticated, currentUser.id, currentUser.activeRole, artists, ensembles, venues, technicalProviders]);

  const activeRange = useMemo(() => {
    if (mode === 'month') {
      const m = getMonthRange(anchorDate);
      return { startDate: m.startDate, endDate: m.endDate };
    }
    if (mode === 'week') {
      const days = getWeekDays(anchorDate);
      return { startDate: days[0], endDate: days[6] };
    }
    if (mode === 'day') {
      return { startDate: selectedDate, endDate: selectedDate };
    }
    return { startDate: todayStr, endDate: addDaysToDateStr(todayStr, 180) };
  }, [mode, anchorDate, selectedDate, todayStr]);

  const fetchCalendarEntries = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const groupMeta = FILTER_GROUPS.find((g) => g.key === filterGroup);
      const params = new URLSearchParams();
      params.set('startDate', activeRange.startDate);
      params.set('endDate', activeRange.endDate);
      if (groupMeta && groupMeta.types.length > 0) {
        params.set('types', groupMeta.types.join(','));
      }
      const res = await apiRequest<{ entries: CalendarEntry[] }>(`/api/calendar/me?${params.toString()}`);
      setEntries(Array.isArray(res.entries) ? res.entries : []);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Takvim verileri alınamadı.' });
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, activeRange.startDate, activeRange.endDate, filterGroup]);

  useEffect(() => {
    fetchCalendarEntries();
  }, [fetchCalendarEntries]);

  const entriesByDate = useMemo(() => {
    const map: Record<string, CalendarEntry[]> = {};
    for (const entry of entries) {
      if (!map[entry.date]) map[entry.date] = [];
      map[entry.date].push(entry);
    }
    return map;
  }, [entries]);

  const monthMeta = useMemo(() => getMonthRange(anchorDate), [anchorDate]);
  const weekDays = useMemo(() => getWeekDays(anchorDate), [anchorDate]);

  const shiftAnchor = (delta: number) => {
    if (mode === 'month') {
      const [y, m] = anchorDate.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
      const next = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-01`;
      setAnchorDate(next);
      setSelectedDate(next);
    } else if (mode === 'week') {
      const next = addDaysToDateStr(anchorDate, delta * 7);
      setAnchorDate(next);
      setSelectedDate(next);
    } else {
      const next = addDaysToDateStr(selectedDate, delta);
      setAnchorDate(next);
      setSelectedDate(next);
    }
  };

  const openCreateSlotModal = (dateStr?: string) => {
    setEditingSlotId(null);
    setSlotModalError(null);
    const defaultOwner = ownedProfiles[0]
      ? `${ownedProfiles[0].ownerType}:${ownedProfiles[0].ownerId}`
      : '';
    setSlotForm({
      ownerKey: defaultOwner,
      title: 'Müsait / Çalışma Penceresi',
      slotDate: dateStr || selectedDate || todayStr,
      startTime: '14:00',
      endTime: '17:00',
      recurrence: 'once',
      slotKind: 'available',
      visibility: 'private',
      notes: '',
    });
    setSlotModalOpen(true);
  };

  const openEditSlotModal = (slotId: string) => {
    const found = availabilitySlots.find((s) => s.id === slotId);
    if (!found) return;
    setEditingSlotId(found.id);
    setSlotModalError(null);
    setSlotForm({
      ownerKey: `${found.ownerType}:${found.ownerId}`,
      title: found.title,
      slotDate: found.slotDate,
      startTime: found.startTime,
      endTime: found.endTime,
      recurrence: found.recurrence,
      slotKind: found.slotKind,
      visibility: found.visibility || 'private',
      notes: found.notes || '',
    });
    setSlotModalOpen(true);
  };

  const handleSaveSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSlotModalError(null);
    setFeedback(null);

    const chosenOwner =
      ownedProfiles.find((o) => `${o.ownerType}:${o.ownerId}` === slotForm.ownerKey) || ownedProfiles[0];
    if (!chosenOwner && !editingSlotId) {
      setSlotModalError('Takvim kaydı oluşturmak için bir Sanatçı, Topluluk, Mekân veya Teknik profiliniz olmalıdır.');
      return;
    }

    setSlotSaving(true);
    try {
      if (editingSlotId) {
        await apiRequest(`/api/availability/${editingSlotId}`, {
          method: 'PATCH',
          body: {
            title: slotForm.title.trim(),
            slotDate: slotForm.slotDate,
            startTime: slotForm.startTime,
            endTime: slotForm.endTime,
            recurrence: slotForm.recurrence,
            slotKind: slotForm.slotKind,
            visibility: slotForm.visibility,
            notes: slotForm.notes.trim(),
          },
        });
        setFeedback({ type: 'success', text: 'Takvim müsaitlik / blokaj kaydı güncellendi.' });
      } else if (chosenOwner) {
        await apiRequest('/api/availability', {
          method: 'POST',
          body: {
            ownerType: chosenOwner.ownerType,
            ownerId: chosenOwner.ownerId,
            ownerName: chosenOwner.label.replace(/^[^:]+:\s*/, ''),
            title: slotForm.title.trim(),
            slotDate: slotForm.slotDate,
            startTime: slotForm.startTime,
            endTime: slotForm.endTime,
            recurrence: slotForm.recurrence,
            slotKind: slotForm.slotKind,
            visibility: slotForm.visibility,
            isFree: slotForm.slotKind === 'open_stage' || slotForm.slotKind === 'free_rehearsal',
            feeAmount: 0,
            city: chosenOwner.city,
            notes: slotForm.notes.trim(),
          },
        });
        setFeedback({ type: 'success', text: 'Yeni müsaitlik / blokaj penceresi takviminize eklendi.' });
      }
      setSlotModalOpen(false);
      await refreshBootstrap();
      await fetchCalendarEntries();
    } catch (err: any) {
      setSlotModalError(err?.message || 'Takvim kaydı kaydedilemedi.');
    } finally {
      setSlotSaving(false);
    }
  };

  const handleDeleteSlot = async (slotId: string) => {
    setFeedback(null);
    try {
      await apiRequest(`/api/availability/${slotId}`, { method: 'DELETE' });
      setSlotModalOpen(false);
      setFeedback({ type: 'success', text: 'Takvim müsaitlik kaydı silindi.' });
      await refreshBootstrap();
      await fetchCalendarEntries();
    } catch (err: any) {
      setSlotModalError(err?.message || 'Kayıt silinemedi.');
    }
  };

  const handleDownloadIcs = async () => {
    setFeedback(null);
    try {
      const token = getSessionToken();
      const params = new URLSearchParams();
      params.set('startDate', activeRange.startDate);
      params.set('endDate', activeRange.endDate);
      const resp = await fetch(`/api/calendar/me/ics?${params.toString()}`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!resp.ok) throw new Error('Takvim dosyası oluşturulamadı.');
      const text = await resp.text();
      triggerBrowserDownload('sanatsahnede-takvimim.ics', text, 'text/calendar;charset=utf-8');
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Takvim dışa aktarılamadı.' });
    }
  };

  const handleEntryClick = (entry: CalendarEntry) => {
    if (entry.type === 'availability' && entry.sourceEntityId && entry.sourceView === 'my_calendar') {
      openEditSlotModal(entry.sourceEntityId);
      return;
    }
    if (entry.sourceView && entry.sourceView !== 'my_calendar') {
      navigateTo(entry.sourceView as AppView, entry.sourceEntityId);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="bg-white dark:bg-[#13213e] rounded-3xl border border-slate-200 dark:border-[#1e335a] p-10 text-center space-y-4">
        <CalendarDays className="w-10 h-10 text-[#DE5626] mx-auto" />
        <h1 className="font-display text-2xl font-bold text-[#16274e] dark:text-white">
          Kişisel Üretim Takvimim
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 max-w-lg mx-auto">
          Tüm sahne rezervasyonlarınızı, kayıtlı etkinliklerinizi, proje toplantılarınızı, prodüksiyon akışlarını ve müsaitlik pencerelerinizi tek bir takvimde görmek için giriş yapın.
        </p>
        <button
          type="button"
          onClick={() => setAuthModalMode('login')}
          className="px-6 py-2.5 rounded-xl bg-[#DE5626] hover:bg-[#c2451a] text-white text-xs font-bold cursor-pointer"
        >
          Giriş Yap
        </button>
      </div>
    );
  }

  const actionRequiredPolls = entries.filter((e) => e.type === 'scheduling_poll' && e.isActionRequired);
  const selectedDayEntries = entriesByDate[selectedDate] || [];

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-widest text-[#DE5626]">
            Akıllı Üretim Takvimi · Takvimim
          </span>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-[#16274e] dark:text-white mt-1">
            Ortak Zamanlama &amp; Üretim Takvimim
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-2xl">
            Sahne rezervasyonları, katıldığınız etkinlikler, proje toplantıları, prodüksiyon akışları ve müsaitlik pencereleriniz tek bir zaman çizelgesinde toplanır.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadIcs}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#13213e] text-xs font-bold text-[#16274e] dark:text-slate-200 hover:border-[#DE5626] cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#DE5626]" />
            <span>.ICS Dışa Aktar</span>
          </button>
          <button
            type="button"
            onClick={() => openCreateSlotModal()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#DE5626] hover:bg-[#c2451a] text-white text-xs font-bold cursor-pointer shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Müsaitlik / Blokaj Ekle</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role="alert"
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {actionRequiredPolls.length > 0 && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-amber-900 dark:text-amber-200">
            <Users className="w-4 h-4 text-[#DE5626] shrink-0" />
            <span>
              <strong>{actionRequiredPolls.length} ortak zamanlama anketinde</strong> müsaitlik yanıtınız bekleniyor.
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {actionRequiredPolls.slice(0, 3).map((pollEntry) => (
              <button
                key={pollEntry.id}
                type="button"
                onClick={() => navigateTo(pollEntry.sourceView as AppView, pollEntry.sourceEntityId)}
                className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#13213e] border border-amber-300 dark:border-amber-700 text-[11px] font-bold text-[#16274e] dark:text-white hover:border-[#DE5626] cursor-pointer"
              >
                {pollEntry.title.replace('Zamanlama Anketi: ', '')} →
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Controls & View Switcher */}
      <div className="bg-white dark:bg-[#13213e] rounded-2xl border border-slate-200 dark:border-[#1e335a] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* View Tabs */}
          <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800">
            {[
              { key: 'month', label: 'Aylık', icon: CalendarDays },
              { key: 'week', label: 'Haftalık', icon: Calendar },
              { key: 'day', label: 'Günlük', icon: Clock },
              { key: 'upcoming', label: 'Yaklaşan', icon: List },
            ].map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setMode(t.key as CalendarDisplayMode)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                    mode === t.key
                      ? 'bg-[#16274e] dark:bg-[#DE5626] text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-[#16274e] dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* Date Range Navigator */}
          {mode !== 'upcoming' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => shiftAnchor(-1)}
                aria-label="Önceki Dönem"
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-[#DE5626] cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 text-xs font-bold text-[#16274e] dark:text-white min-w-[140px] text-center tabular-nums">
                {mode === 'month'
                  ? `${TR_MONTHS[(monthMeta.month - 1) % 12]} ${monthMeta.year}`
                  : mode === 'week'
                  ? `${weekDays[0]} – ${weekDays[6].slice(5)}`
                  : selectedDate}
              </div>
              <button
                type="button"
                onClick={() => shiftAnchor(1)}
                aria-label="Sonraki Dönem"
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-[#DE5626] cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setAnchorDate(todayStr);
                  setSelectedDate(todayStr);
                }}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold hover:border-[#DE5626] cursor-pointer"
              >
                Bugün
              </button>
            </div>
          )}
        </div>

        {/* Type Filter Chips */}
        <div className="flex flex-wrap gap-1.5">
          {FILTER_GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setFilterGroup(g.key)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer transition-colors ${
                filterGroup === g.key
                  ? 'bg-[#DE5626] text-white border-[#DE5626]'
                  : 'bg-slate-50 dark:bg-[#0B1120] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-[#DE5626]'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Calendar Area */}
      {loading ? (
        <div className="bg-white dark:bg-[#13213e] rounded-2xl border border-slate-200 dark:border-[#1e335a] p-10 text-center text-xs text-slate-500">
          Takvim kayıtları yükleniyor...
        </div>
      ) : mode === 'month' ? (
        <div className="space-y-4">
          <div className="bg-white dark:bg-[#13213e] rounded-2xl border border-slate-200 dark:border-[#1e335a] overflow-hidden">
            <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1120]">
              {TR_DAYS_SHORT.map((day) => (
                <div
                  key={day}
                  className="py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                >
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {monthMeta.gridDays.map((cell) => {
                const dayEntries = entriesByDate[cell.date] || [];
                const isSelected = cell.date === selectedDate;
                const isToday = cell.date === todayStr;

                return (
                  <div
                    key={cell.date}
                    onClick={() => setSelectedDate(cell.date)}
                    className={`min-h-[68px] sm:min-h-[104px] p-1.5 sm:p-2 border-b border-r border-slate-100 dark:border-slate-800/70 cursor-pointer transition-colors flex flex-col justify-between ${
                      !cell.inCurrentMonth
                        ? 'bg-slate-50/60 dark:bg-[#0B1120]/50 text-slate-400'
                        : isSelected
                        ? 'bg-orange-50/70 dark:bg-orange-500/10 ring-1 ring-inset ring-[#DE5626]'
                        : 'hover:bg-slate-50 dark:hover:bg-[#0f1c38]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center tabular-nums ${
                          isToday
                            ? 'bg-[#DE5626] text-white'
                            : cell.inCurrentMonth
                            ? 'text-[#16274e] dark:text-slate-200'
                            : 'text-slate-400'
                        }`}
                      >
                        {Number(cell.date.split('-')[2])}
                      </span>
                      {dayEntries.length > 0 && (
                        <span className="sm:hidden px-1.5 py-0.5 rounded-full bg-[#16274e] text-white text-[9px] font-bold tabular-nums">
                          {dayEntries.length}
                        </span>
                      )}
                    </div>

                    {/* Desktop item previews */}
                    <div className="hidden sm:block space-y-1 mt-1">
                      {dayEntries.slice(0, 2).map((en) => {
                        const st = ENTRY_TYPE_STYLES[en.type];
                        return (
                          <div
                            key={en.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEntryClick(en);
                            }}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold truncate ${st.badge}`}
                            title={`${en.startTime} ${en.title}`}
                          >
                            {en.startTime} {en.title}
                          </div>
                        );
                      })}
                      {dayEntries.length > 2 && (
                        <div className="text-[10px] font-bold text-[#DE5626] pl-1">
                          +{dayEntries.length - 2} kayıt
                        </div>
                      )}
                    </div>

                    {/* Mobile dot indicators */}
                    {dayEntries.length > 0 && (
                      <div className="flex sm:hidden flex-wrap gap-0.5 mt-1">
                        {dayEntries.slice(0, 4).map((en) => (
                          <span
                            key={en.id}
                            className={`w-1.5 h-1.5 rounded-full ${ENTRY_TYPE_STYLES[en.type].dot}`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selected Day Detail Drawer */}
          <div className="bg-white dark:bg-[#13213e] rounded-2xl border border-slate-200 dark:border-[#1e335a] p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h2 className="font-display text-sm font-bold text-[#16274e] dark:text-white tabular-nums">
                  {selectedDate} Günü Programı ({selectedDayEntries.length})
                </h2>
                <p className="text-[11px] text-slate-500">
                  Bir kayda tıklayarak ilgili detay sayfasına veya müsaitlik düzenleyicisine geçebilirsiniz.
                </p>
              </div>
              <button
                type="button"
                onClick={() => openCreateSlotModal(selectedDate)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold hover:border-[#DE5626] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#DE5626]" />
                <span>Bu Güne Müsaitlik Ekle</span>
              </button>
            </div>

            {selectedDayEntries.length === 0 ? (
              <p className="text-xs text-slate-500 py-3">
                Seçili tarihte kayıtlı rezervasyon, etkinlik veya müsaitlik penceresi bulunmuyor.
              </p>
            ) : (
              <div className="space-y-2.5">
                {selectedDayEntries.map((entry) => (
                  <CalendarEntryRow key={entry.id} entry={entry} onOpen={() => handleEntryClick(entry)} />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : mode === 'week' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
          {weekDays.map((dayStr, idx) => {
            const list = entriesByDate[dayStr] || [];
            const isToday = dayStr === todayStr;
            return (
              <div
                key={dayStr}
                className={`bg-white dark:bg-[#13213e] rounded-2xl border p-3 space-y-2.5 ${
                  isToday
                    ? 'border-[#DE5626] ring-1 ring-[#DE5626]/30'
                    : 'border-slate-200 dark:border-[#1e335a]'
                }`}
              >
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {TR_DAYS_SHORT[idx]}
                    </div>
                    <div className="text-xs font-bold text-[#16274e] dark:text-white tabular-nums">
                      {dayStr}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openCreateSlotModal(dayStr)}
                    aria-label={`${dayStr} gününe slot ekle`}
                    className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-[#DE5626] cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {list.length === 0 ? (
                  <div className="text-[11px] text-slate-400 py-2">Kayıt yok</div>
                ) : (
                  <div className="space-y-2">
                    {list.map((entry) => {
                      const st = ENTRY_TYPE_STYLES[entry.type];
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => handleEntryClick(entry)}
                          className="w-full text-left p-2.5 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 hover:border-[#DE5626] transition-colors space-y-1 cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[10px] font-bold text-[#DE5626] tabular-nums">
                              {entry.startTime}–{entry.endTime}
                            </span>
                            {entry.visibility === 'private' && <Lock className="w-3 h-3 text-slate-400" />}
                          </div>
                          <div className="text-xs font-bold text-[#16274e] dark:text-white line-clamp-2">
                            {entry.title}
                          </div>
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold ${st.badge}`}>
                            {entry.statusLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white dark:bg-[#13213e] rounded-2xl border border-slate-200 dark:border-[#1e335a] p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2 className="font-display text-sm font-bold text-[#16274e] dark:text-white">
              {mode === 'day'
                ? `${selectedDate} Günlük Akışı (${entries.length})`
                : `Yaklaşan Tüm Üretim & Sahne Kayıtları (${entries.length})`}
            </h2>
          </div>

          {entries.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              Seçili aralıkta eşleşen takvim kaydı bulunamadı.
            </div>
          ) : (
            <div className="space-y-2.5">
              {entries.map((entry) => (
                <CalendarEntryRow key={entry.id} entry={entry} showDate onOpen={() => handleEntryClick(entry)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Availability Create / Edit Modal */}
      {slotModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg bg-white dark:bg-[#13213e] rounded-2xl border border-slate-200 dark:border-[#1e335a] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="font-display text-base font-bold text-[#16274e] dark:text-white">
                {editingSlotId ? 'Müsaitlik / Blokaj Kaydını Düzenle' : 'Yeni Müsaitlik / Blokaj Ekle'}
              </h2>
              <button
                type="button"
                onClick={() => setSlotModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {slotModalError && (
              <div role="alert" className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs font-medium flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{slotModalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveSlot} className="space-y-3">
              {!editingSlotId && ownedProfiles.length > 0 && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    Takvim Sahibi
                  </label>
                  <select
                    value={slotForm.ownerKey}
                    onChange={(e) => setSlotForm((p) => ({ ...p, ownerKey: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
                  >
                    {ownedProfiles.map((o) => (
                      <option key={`${o.ownerType}:${o.ownerId}`} value={`${o.ownerType}:${o.ownerId}`}>
                        {o.label} ({o.city})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                  Başlık *
                </label>
                <input
                  type="text"
                  required
                  value={slotForm.title}
                  onChange={(e) => setSlotForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="Örn: Akşam Provasına Uygun veya Özel Blokaj"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    Tarih *
                  </label>
                  <input
                    type="date"
                    required
                    value={slotForm.slotDate}
                    onChange={(e) => setSlotForm((p) => ({ ...p, slotDate: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    Başlangıç *
                  </label>
                  <input
                    type="time"
                    required
                    value={slotForm.startTime}
                    onChange={(e) => setSlotForm((p) => ({ ...p, startTime: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    Bitiş *
                  </label>
                  <input
                    type="time"
                    required
                    value={slotForm.endTime}
                    onChange={(e) => setSlotForm((p) => ({ ...p, endTime: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    Kayıt Türü
                  </label>
                  <select
                    value={slotForm.slotKind}
                    onChange={(e) =>
                      setSlotForm((p) => ({
                        ...p,
                        slotKind: e.target.value as AvailabilitySlot['slotKind'],
                      }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
                  >
                    <option value="available">Müsaitim</option>
                    <option value="blocked">Kapalı / Blokaj</option>
                    <option value="free_rehearsal">Ücretsiz Prova</option>
                    <option value="open_stage">Açık Sahne</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    Tekrar
                  </label>
                  <select
                    value={slotForm.recurrence}
                    onChange={(e) =>
                      setSlotForm((p) => ({
                        ...p,
                        recurrence: e.target.value as 'once' | 'weekly' | 'monthly',
                      }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
                  >
                    <option value="once">Tek Seferlik</option>
                    <option value="weekly">Her Hafta</option>
                    <option value="monthly">Her Ay</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    Görünürlük
                  </label>
                  <select
                    value={slotForm.visibility}
                    onChange={(e) =>
                      setSlotForm((p) => ({
                        ...p,
                        visibility: e.target.value as 'private' | 'project_team' | 'public',
                      }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
                  >
                    <option value="private">Yalnızca Ben (Gizli)</option>
                    <option value="project_team">Proje &amp; Sahne Ekibim</option>
                    <option value="public">Herkese Açık</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                  Not (Opsiyonel)
                </label>
                <input
                  type="text"
                  value={slotForm.notes}
                  onChange={(e) => setSlotForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Gizli seçiliyse yalnızca sizin tarafınızdan görülür"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-2">
                {editingSlotId ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteSlot(editingSlotId)}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Sil</span>
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSlotModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    disabled={slotSaving}
                    className="px-5 py-2 rounded-xl bg-[#DE5626] hover:bg-[#c2451a] text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                  >
                    {slotSaving ? 'Kaydediliyor...' : 'Kaydet'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const CalendarEntryRow: React.FC<{
  entry: CalendarEntry;
  showDate?: boolean;
  onOpen: () => void;
}> = ({ entry, showDate = false, onOpen }) => {
  const st = ENTRY_TYPE_STYLES[entry.type];
  const isEditableSlot = entry.type === 'availability' && entry.sourceView === 'my_calendar';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left p-3.5 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 hover:border-[#DE5626] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer"
    >
      <div className="space-y-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${st.badge}`}>
            {entry.statusLabel}
          </span>
          {showDate && (
            <span className="text-[11px] font-bold text-[#16274e] dark:text-slate-200 tabular-nums">
              {entry.date}
            </span>
          )}
          <span className="text-[11px] font-bold text-[#DE5626] tabular-nums">
            {entry.startTime} – {entry.endTime}
          </span>
          {entry.visibility === 'private' && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500">
              <Lock className="w-3 h-3" />
              Gizli
            </span>
          )}
          {entry.isActionRequired && (
            <span className="px-2 py-0.5 rounded-md bg-amber-500 text-white text-[10px] font-bold">
              Yanıt Bekleniyor
            </span>
          )}
        </div>
        <div className="text-xs sm:text-sm font-bold text-[#16274e] dark:text-white truncate">
          {entry.title}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
          <span>{entry.subtitle}</span>
          {entry.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3 text-slate-400" />
              {entry.location}
            </span>
          )}
        </div>
      </div>

      <div className="inline-flex items-center gap-1 text-[11px] font-bold text-[#DE5626] shrink-0">
        {isEditableSlot ? (
          <>
            <Edit3 className="w-3.5 h-3.5" />
            <span>Düzenle</span>
          </>
        ) : (
          <>
            <span>Aç</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </>
        )}
      </div>
    </button>
  );
};
