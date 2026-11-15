import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  buildGoogleCalendarUrl,
  formatEventSchedule,
  getEventTicketAction,
  isEventFree,
  validateEventRegistrationInput,
} from '../utils/eventDetailUtils';
import { formatCurrencyTRY } from '../utils/businessLogic';
import { InteractiveMap } from './ui/InteractiveMap';
import { CITY_COORDINATES } from '../services/mapProvider';
import { apiRequest } from '../services/api';
import {
  Accessibility,
  Bookmark,
  Building2,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Download,
  ExternalLink,
  Mail,
  MapPin,
  Music,
  Sparkles,
  Ticket,
  UserCheck,
  Users,
  Repeat2,
} from 'lucide-react';

interface Props {
  eventId?: string;
  onBack: () => void;
}

export const EventDetailPage: React.FC<Props> = ({ eventId, onBack }) => {
  const {
    events,
    eventRegistrations,
    eventRegistrationCounts,
    registerForEvent,
    cancelEventRegistration,
    currentUser,
    isAuthenticated,
    setAuthModalMode,
    bookmarks,
    toggleBookmark,
    navigateTo,
    businesses,
    shareToFeed,
  } = useApp();

  const event = events.find((e) => e.id === eventId);

  const [attendeeName, setAttendeeName] = useState('');
  const [attendeeEmail, setAttendeeEmail] = useState('');
  const [attendeePhone, setAttendeePhone] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [resolvedCoords, setResolvedCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (isAuthenticated && currentUser) {
      setAttendeeName(`${currentUser.firstName} ${currentUser.lastName}`.trim());
      setAttendeeEmail(currentUser.email || '');
      setAttendeePhone(currentUser.phone || '');
    }
  }, [isAuthenticated, currentUser?.id, currentUser?.firstName, currentUser?.lastName, currentUser?.email, currentUser?.phone]);

  useEffect(() => {
    setFeedback(null);
    setCancelConfirmOpen(false);
    setResolvedCoords(null);
  }, [eventId]);

  useEffect(() => {
    if (!event) return;
    if (typeof event.latitude === 'number' && typeof event.longitude === 'number') {
      setResolvedCoords({ lat: event.latitude, lng: event.longitude });
      return;
    }
    let cancelled = false;
    apiRequest<{ latitude: number; longitude: number }>(
      `/api/geo/geocode?city=${encodeURIComponent(event.city)}&district=${encodeURIComponent(event.district || '')}&q=${encodeURIComponent(`${event.venueName}, ${event.city}`)}`
    )
      .then((geo) => {
        if (!cancelled && Number.isFinite(geo?.latitude) && Number.isFinite(geo?.longitude)) {
          setResolvedCoords({ lat: geo.latitude, lng: geo.longitude });
        }
      })
      .catch(() => {
        const fallback = CITY_COORDINATES[event.city];
        if (!cancelled && fallback) setResolvedCoords(fallback);
      });
    return () => {
      cancelled = true;
    };
  }, [event?.id, event?.latitude, event?.longitude, event?.city, event?.district, event?.venueName]);

  if (!event) {
    return (
      <div className="max-w-xl mx-auto my-12 p-8 bg-white dark:bg-[#13213e] rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] text-center space-y-4">
        <h2 className="font-display text-xl font-bold text-[#0f172a] dark:text-white">Etkinlik Bulunamadı</h2>
        <p className="text-xs text-[#64748b] dark:text-slate-400">
          Aradığınız etkinlik kaldırılmış, tarihi geçmiş veya henüz yayın aşamasında olabilir.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-2.5 rounded-xl bg-[#DE5626] hover:bg-[#c2451a] text-white text-xs font-bold cursor-pointer transition-colors"
        >
          Etkinlik Takvimine Dön
        </button>
      </div>
    );
  }

  const freeEvent = isEventFree(event);
  const ticketAction = getEventTicketAction(event);
  const existingRegistration = eventRegistrations.find(
    (r) => r.eventId === event.id && r.status === 'confirmed'
  );
  const participantCount = Math.max(
    eventRegistrationCounts[event.id] || 0,
    existingRegistration ? 1 : 0
  );
  const isBookmarked = bookmarks.some((b) => b.itemType === 'event' && b.itemId === event.id);
  const matchingBusiness = businesses.find(
    (b) =>
      b.businessName.toLowerCase() === event.organizerName.toLowerCase() ||
      b.businessName.toLowerCase() === event.venueName.toLowerCase()
  );

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const validation = validateEventRegistrationInput({
      name: attendeeName,
      email: attendeeEmail,
    });
    if (!validation.valid) {
      setFeedback({ type: 'error', message: validation.error || 'Lütfen zorunlu alanları kontrol ediniz.' });
      return;
    }

    setIsSubmitting(true);
    const result = await registerForEvent(event.id, {
      attendeeName: attendeeName.trim(),
      attendeeEmail: attendeeEmail.trim(),
      attendeePhone: attendeePhone.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    setIsSubmitting(false);

    if (result.success) {
      setFeedback({
        type: 'success',
        message: 'Ücretsiz etkinlik kaydınız onaylandı! Katılım kodunuz aşağıda hazırlandı.',
      });
      setNotes('');
    } else {
      setFeedback({
        type: 'error',
        message: result.error || 'Kayıt işlemi sırasında bir hata oluştu.',
      });
    }
  };

  const handleCancelRegistration = async () => {
    setIsSubmitting(true);
    const res = await cancelEventRegistration(
      event.id,
      existingRegistration?.id,
      existingRegistration?.attendeeEmail
    );
    setIsSubmitting(false);
    setCancelConfirmOpen(false);
    if (res.success) {
      setFeedback({
        type: 'success',
        message: 'Etkinlik katılım kaydınız iptal edildi.',
      });
    } else {
      setFeedback({
        type: 'error',
        message: res.error || 'Kayıt iptal edilemedi.',
      });
    }
  };

  const handleBookmarkToggle = async () => {
    if (!isAuthenticated) {
      setAuthModalMode('login');
      return;
    }
    await toggleBookmark('event', event.id);
  };

  return (
    <div className="text-left space-y-6">
      {/* Top Breadcrumb & URL Pill */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#64748b] hover:text-[#DE5626] dark:text-slate-300 dark:hover:text-[#ffb59e] transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Etkinlik Takvimine Dön</span>
        </button>

        <span className="text-[11px] font-mono text-[#64748b] dark:text-slate-400 bg-white dark:bg-[#13213e] px-3 py-1 rounded-lg border border-[#e2e8f0] dark:border-[#1e335a]">
          /etkinlikler/{event.id}
        </span>
      </div>

      {/* Hero Poster Header Card */}
      <section className="relative rounded-3xl overflow-hidden bg-[#162956] border border-[#223c78] text-white shadow-lg">
        <div className="relative h-56 sm:h-72 w-full bg-[#0f1c38]">
          {event.posterUrl && (
            <img
              src={event.posterUrl}
              alt={event.title}
              className="w-full h-full object-cover object-center opacity-85"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0b142b] via-[#162956]/70 to-transparent" />

          <div className="absolute top-4 inset-x-4 sm:inset-x-6 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-lg bg-[#162956]/90 border border-white/15 text-white text-xs font-bold">
                {event.category}
              </span>
              {event.discipline && (
                <span className="px-3 py-1 rounded-lg bg-white/15 backdrop-blur-xs border border-white/15 text-white text-xs font-semibold">
                  {event.discipline}
                </span>
              )}
              {event.status === 'pending_moderation' && (
                <span className="px-3 py-1 rounded-lg bg-amber-400 text-amber-950 text-xs font-bold">
                  Onay Bekliyor
                </span>
              )}
            </div>

            <div>
              {freeEvent ? (
                <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500 text-white text-xs font-extrabold shadow-md">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Ücretsiz Etkinlik</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#DE5626] text-white text-xs sm:text-sm font-extrabold shadow-md tabular-nums">
                  <Ticket className="w-3.5 h-3.5" />
                  <span>{formatCurrencyTRY(event.ticketPrice)}</span>
                </span>
              )}
            </div>
          </div>

          <div className="absolute bottom-4 sm:bottom-6 inset-x-4 sm:inset-x-8 space-y-2">
            <h1 className="font-display text-xl sm:text-3xl font-extrabold text-white tracking-tight leading-snug">
              {event.title}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs sm:text-sm text-slate-200 font-medium">
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Calendar className="w-4 h-4 text-[#ffb59e]" />
                <span>{formatEventSchedule(event)}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-[#ffb59e]" />
                <span>
                  {event.venueName} — {event.district ? `${event.district}, ` : ''}
                  {event.city}
                </span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Details Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Quick Meta Summary Strip */}
          <div className="bg-white dark:bg-[#13213e] rounded-2xl border border-[#E2E8F0] dark:border-[#1e335a] p-5 sm:p-6 shadow-xs grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#F2F4F8] dark:bg-[#0f1c38] border border-[#E2E8F0] dark:border-[#1e335a] flex items-center justify-center text-[#DE5626] shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  İcracılar / Sanatçılar
                </div>
                <div className="text-xs sm:text-sm font-bold text-[#162956] dark:text-white mt-0.5">
                  {event.performers || 'Program kapsamında açıklanacaktır'}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#F2F4F8] dark:bg-[#0f1c38] border border-[#E2E8F0] dark:border-[#1e335a] flex items-center justify-center text-[#162956] dark:text-[#ffb59e] shrink-0">
                <Building2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Düzenleyen Kurum
                </div>
                <div className="text-xs sm:text-sm font-bold text-[#162956] dark:text-white mt-0.5 flex flex-wrap items-center gap-2">
                  <span>{event.organizerName}</span>
                  {matchingBusiness && (
                    <button
                      type="button"
                      onClick={() => navigateTo('business_profile', matchingBusiness.id)}
                      className="text-[11px] font-bold text-[#DE5626] hover:underline cursor-pointer"
                    >
                      Profili Gör
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#F2F4F8] dark:bg-[#0f1c38] border border-[#E2E8F0] dark:border-[#1e335a] flex items-center justify-center text-[#DE5626] shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Tarih &amp; Saat
                </div>
                <div className="text-xs sm:text-sm font-bold text-[#162956] dark:text-white mt-0.5 tabular-nums">
                  {event.eventDate} · {event.startTime}
                  {event.endTime ? ` – ${event.endTime}` : ''}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#F2F4F8] dark:bg-[#0f1c38] border border-[#E2E8F0] dark:border-[#1e335a] flex items-center justify-center text-[#162956] dark:text-[#ffb59e] shrink-0">
                <MapPin className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Mekân &amp; Konum
                </div>
                <div className="text-xs sm:text-sm font-bold text-[#162956] dark:text-white mt-0.5">
                  {event.venueName}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {event.district ? `${event.district}, ` : ''}
                  {event.city}
                </div>
              </div>
            </div>
          </div>

          {/* Program & Full Description */}
          <div className="bg-white dark:bg-[#13213e] rounded-2xl border border-[#E2E8F0] dark:border-[#1e335a] p-5 sm:p-7 shadow-xs space-y-5">
            <div>
              <h2 className="font-display text-lg font-bold text-[#162956] dark:text-white">
                Etkinlik Programı &amp; Detaylar
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed mt-3 whitespace-pre-line">
                {event.description}
              </p>
            </div>

            {event.genres && event.genres.length > 0 && (
              <div className="pt-4 border-t border-[#E2E8F0] dark:border-[#1e335a] space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Music className="w-3.5 h-3.5 text-[#DE5626]" />
                  <span>Repertuvar / Müzik &amp; Sanat Türleri</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {event.genres.map((g) => (
                    <span
                      key={g}
                      className="px-3 py-1 rounded-lg bg-[#F2F4F8] dark:bg-[#0f1c38] border border-[#E2E8F0] dark:border-[#1e335a] text-xs font-semibold text-[#162956] dark:text-slate-200"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {event.accessibilitySummary && event.accessibilitySummary.length > 0 && (
              <div className="pt-4 border-t border-[#E2E8F0] dark:border-[#1e335a] space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                  <Accessibility className="w-4 h-4" />
                  <span>Erişilebilirlik &amp; Katılım Olanakları</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {event.accessibilitySummary.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{tag}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {event.organizerContact && (
              <div className="pt-4 border-t border-[#E2E8F0] dark:border-[#1e335a] flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-500 dark:text-slate-400 font-medium">
                  Organizatör İletişim:
                </span>
                <a
                  href={
                    event.organizerContact.includes('@')
                      ? `mailto:${event.organizerContact}`
                      : undefined
                  }
                  className="inline-flex items-center gap-1.5 font-bold text-[#162956] dark:text-[#ffb59e] hover:text-[#DE5626]"
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>{event.organizerContact}</span>
                </a>
              </div>
            )}
          </div>

          {/* Calendar & Bookmark Utilities */}
          <div className="bg-white dark:bg-[#13213e] rounded-2xl border border-[#E2E8F0] dark:border-[#1e335a] p-5 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-bold text-[#162956] dark:text-white">
              Takvime Ekle &amp; Kaydet
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={buildGoogleCalendarUrl(event)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-2 rounded-xl bg-[#F2F4F8] dark:bg-[#0f1c38] border border-[#E2E8F0] dark:border-[#1e335a] hover:border-[#DE5626] text-xs font-bold text-[#162956] dark:text-slate-200 inline-flex items-center gap-1.5 transition-colors"
              >
                <CalendarPlus className="w-3.5 h-3.5 text-[#DE5626]" />
                <span>Google Takvim</span>
              </a>
              <a
                href={`/api/events/${event.id}/ics`}
                download={`sanatsahnede-${event.id}.ics`}
                className="px-3.5 py-2 rounded-xl bg-[#F2F4F8] dark:bg-[#0f1c38] border border-[#E2E8F0] dark:border-[#1e335a] hover:border-[#DE5626] text-xs font-bold text-[#162956] dark:text-slate-200 inline-flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-[#DE5626]" />
                <span>.ICS İndir</span>
              </a>
              <button
                type="button"
                onClick={handleBookmarkToggle}
                className={`px-3.5 py-2 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                  isBookmarked
                    ? 'bg-[#DE5626] text-white border-[#DE5626]'
                    : 'bg-[#F2F4F8] dark:bg-[#0f1c38] border-[#E2E8F0] dark:border-[#1e335a] text-[#162956] dark:text-slate-200 hover:border-[#DE5626]'
                }`}
              >
                <Bookmark className="w-3.5 h-3.5" />
                <span>{isBookmarked ? 'Kaydedildi' : 'Kaydet'}</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  shareToFeed({
                    entityType: 'event',
                    entityId: event.id,
                    title: event.title,
                    subtitle: `${event.organizerName} · ${event.city} · ${event.eventDate}`,
                  })
                }
                className="px-3.5 py-2 rounded-xl bg-[#F2F4F8] dark:bg-[#0f1c38] border border-[#E2E8F0] dark:border-[#1e335a] hover:border-[#DE5626] text-xs font-bold text-[#162956] dark:text-slate-200 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Repeat2 className="w-3.5 h-3.5 text-[#DE5626]" />
                <span>Akışta Paylaş</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Sticky Action Column */}
        <aside className="lg:col-span-1 space-y-4 lg:sticky lg:top-24">
          {freeEvent ? (
            <div className="bg-white dark:bg-[#13213e] rounded-2xl border border-[#E2E8F0] dark:border-[#1e335a] p-5 sm:p-6 shadow-xs space-y-4">
              <div className="flex items-start justify-between gap-2 pb-3 border-b border-[#E2E8F0] dark:border-[#1e335a]">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    Ücretsiz Katılım
                  </span>
                  <h2 className="font-display text-lg font-extrabold text-[#162956] dark:text-white mt-0.5">
                    {existingRegistration ? 'Kaydınız Onaylandı' : 'Etkinliğe Kayıt Ol'}
                  </h2>
                </div>
                <span className="px-2.5 py-1 rounded-lg bg-[#F2F4F8] dark:bg-[#0f1c38] text-[11px] font-bold text-[#162956] dark:text-slate-200 tabular-nums shrink-0">
                  {participantCount} kayıt
                </span>
              </div>

              {feedback && (
                <div
                  role={feedback.type === 'error' ? 'alert' : 'status'}
                  className={`p-3 rounded-xl text-xs font-medium border flex items-start gap-2 ${
                    feedback.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                      : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{feedback.message}</span>
                </div>
              )}

              {existingRegistration ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 space-y-2.5">
                    <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 text-xs font-bold">
                      <UserCheck className="w-4 h-4" />
                      <span>Katılım Bileti Hazır</span>
                    </div>
                    <div className="bg-white dark:bg-[#0f1c38] px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-900 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">Katılım Kodu</span>
                      <span className="font-mono text-xs font-extrabold text-[#162956] dark:text-white tracking-wider">
                        {existingRegistration.ticketCode}
                      </span>
                    </div>
                    <div className="text-xs text-slate-700 dark:text-slate-300 space-y-0.5">
                      <div>
                        <span className="font-semibold">Katılımcı:</span> {existingRegistration.attendeeName}
                      </div>
                      <div className="truncate">
                        <span className="font-semibold">E-posta:</span> {existingRegistration.attendeeEmail}
                      </div>
                    </div>
                  </div>

                  {cancelConfirmOpen ? (
                    <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 space-y-2">
                      <p className="text-xs font-semibold text-rose-900 dark:text-rose-200">
                        Katılım kaydınızı iptal etmek istediğinize emin misiniz?
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={handleCancelRegistration}
                          className="flex-1 py-2 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold cursor-pointer"
                        >
                          Evet, İptal Et
                        </button>
                        <button
                          type="button"
                          onClick={() => setCancelConfirmOpen(false)}
                          className="flex-1 py-2 rounded-lg bg-white dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
                        >
                          Vazgeç
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCancelConfirmOpen(true)}
                      className="w-full py-2.5 rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-rose-700 hover:border-rose-300 transition-colors cursor-pointer"
                    >
                      Kaydı İptal Et
                    </button>
                  )}
                </div>
              ) : (
                <form onSubmit={handleRegisterSubmit} className="space-y-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Bu etkinliğe giriş ücretsizdir. Yerinizi ayırtmak ve giriş kodunuzu oluşturmak için bilgilerinizi girin.
                  </p>

                  <div>
                    <label className="block text-[11px] font-bold text-[#162956] dark:text-slate-200 mb-1">
                      Ad Soyad *
                    </label>
                    <input
                      type="text"
                      required
                      value={attendeeName}
                      onChange={(e) => setAttendeeName(e.target.value)}
                      placeholder="Örn: Deniz Kaya"
                      className="w-full px-3 py-2.5 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white focus:outline-hidden focus:border-[#DE5626]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#162956] dark:text-slate-200 mb-1">
                      E-posta Adresi *
                    </label>
                    <input
                      type="email"
                      required
                      value={attendeeEmail}
                      onChange={(e) => setAttendeeEmail(e.target.value)}
                      placeholder="ornek@eposta.com"
                      className="w-full px-3 py-2.5 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white focus:outline-hidden focus:border-[#DE5626]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#162956] dark:text-slate-200 mb-1">
                      Telefon (Opsiyonel)
                    </label>
                    <input
                      type="tel"
                      value={attendeePhone}
                      onChange={(e) => setAttendeePhone(e.target.value)}
                      placeholder="+90 5XX XXX XX XX"
                      className="w-full px-3 py-2.5 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white focus:outline-hidden focus:border-[#DE5626]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#162956] dark:text-slate-200 mb-1">
                      Not / Erişilebilirlik Talebi (Opsiyonel)
                    </label>
                    <textarea
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Varsa özel oturum veya erişim notunuz..."
                      className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white focus:outline-hidden focus:border-[#DE5626]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-3 rounded-xl bg-[#DE5626] hover:bg-[#c2451a] text-white text-xs sm:text-sm font-bold shadow-md shadow-[#DE5626]/20 transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {isSubmitting ? 'Kaydınız Oluşturuluyor...' : 'Ücretsiz Kayıt Ol'}
                  </button>
                </form>
              )}
            </div>
          ) : (
            <div className="bg-white dark:bg-[#13213e] rounded-2xl border border-[#E2E8F0] dark:border-[#1e335a] p-5 sm:p-6 shadow-xs space-y-4">
              <div className="pb-3 border-b border-[#E2E8F0] dark:border-[#1e335a] flex items-baseline justify-between gap-2">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#DE5626]">
                    Biletli Etkinlik
                  </span>
                  <h2 className="font-display text-lg font-extrabold text-[#162956] dark:text-white mt-0.5">
                    Bilet &amp; Katılım
                  </h2>
                </div>
                <div className="font-sans text-xl font-extrabold text-[#162956] dark:text-white tabular-nums">
                  {formatCurrencyTRY(event.ticketPrice)}
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Bu etkinlik ücretlidir. Bilet satın alma işleminizi etkinliğin resmî satış sayfası üzerinden güvenle tamamlayabilirsiniz.
              </p>

              {ticketAction.mode === 'paid_ticket' && ticketAction.href ? (
                <div className="space-y-3">
                  <a
                    href={ticketAction.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-3 px-4 rounded-xl bg-[#DE5626] hover:bg-[#c2451a] text-white text-xs sm:text-sm font-bold shadow-md shadow-[#DE5626]/20 flex items-center justify-center gap-2 transition-colors"
                  >
                    <Ticket className="w-4 h-4" />
                    <span>Bilet Al</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  {ticketAction.hostLabel && (
                    <div className="text-[11px] text-center text-slate-500 dark:text-slate-400">
                      Yönlendirilecek platform: <strong className="text-[#162956] dark:text-slate-200">{ticketAction.hostLabel}</strong>
                    </div>
                  )}
                </div>
              ) : ticketAction.href ? (
                <a
                  href={ticketAction.href}
                  className="w-full py-3 px-4 rounded-xl bg-[#DE5626] hover:bg-[#c2451a] text-white text-xs sm:text-sm font-bold shadow-md shadow-[#DE5626]/20 flex items-center justify-center gap-2 transition-colors"
                >
                  <Ticket className="w-4 h-4" />
                  <span>Bilet Al (Organizatör İletişim)</span>
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => navigateTo('contact')}
                  className="w-full py-3 px-4 rounded-xl bg-[#DE5626] hover:bg-[#c2451a] text-white text-xs sm:text-sm font-bold shadow-md shadow-[#DE5626]/20 flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Ticket className="w-4 h-4" />
                  <span>Bilet Al</span>
                </button>
              )}

              <div className="pt-3 border-t border-[#E2E8F0] dark:border-[#1e335a] text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
                <div>Düzenleyen: {event.organizerName}</div>
                <div>Mekân: {event.venueName}, {event.city}</div>
              </div>
            </div>
          )}

          {resolvedCoords && (
            <div className="bg-white dark:bg-[#13213e] rounded-2xl border border-[#E2E8F0] dark:border-[#1e335a] p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-xs font-bold uppercase tracking-wider text-[#162956] dark:text-white flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-[#DE5626]" />
                  <span>Etkinlik Konumu &amp; Harita</span>
                </h3>
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  {event.district ? `${event.district}, ` : ''}
                  {event.city}
                </span>
              </div>
              <InteractiveMap
                heightClassName="h-52"
                center={[resolvedCoords.lat, resolvedCoords.lng]}
                zoom={13}
                markers={[
                  {
                    id: event.id,
                    title: event.venueName,
                    subtitle: `${event.title} · ${event.eventDate}`,
                    badge: event.venueName,
                    latitude: resolvedCoords.lat,
                    longitude: resolvedCoords.lng,
                    kind: 'event',
                    active: true,
                  },
                ]}
                ariaLabel={`${event.venueName} konum haritası`}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
