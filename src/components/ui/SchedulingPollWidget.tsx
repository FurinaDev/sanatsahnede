import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiRequest, getSessionToken } from '../../services/api';
import { triggerBrowserDownload } from '../../utils/exportHelpers';
import { SchedulingPoll, SchedulingPollOptionEvaluation } from '../../types';
import {
  AlertCircle,
  Calendar,
  CalendarCheck2,
  Check,
  CheckCircle2,
  Clock,
  Download,
  HelpCircle,
  MapPin,
  Plus,
  Sparkles,
  Trash2,
  Users,
  X,
  XCircle,
} from 'lucide-react';

interface SchedulingPollWidgetProps {
  contextType: 'project' | 'booking' | 'production';
  contextId: string;
  defaultTitle?: string;
  onFinalized?: () => void;
}

interface DraftOption {
  optionDate: string;
  startTime: string;
  endTime: string;
  notes: string;
}

export const SchedulingPollWidget: React.FC<SchedulingPollWidgetProps> = ({
  contextType,
  contextId,
  defaultTitle = 'Proje / Prova Zamanlama Anketi',
  onFinalized,
}) => {
  const { isAuthenticated, venues, refreshBootstrap } = useApp();

  const [polls, setPolls] = useState<SchedulingPoll[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState('');
  const [venueId, setVenueId] = useState('');
  const [durationMins, setDurationMins] = useState(90);
  const [responseDeadline, setResponseDeadline] = useState('');
  const [draftOptions, setDraftOptions] = useState<DraftOption[]>([
    { optionDate: '2027-02-12', startTime: '18:00', endTime: '20:00', notes: '' },
    { optionDate: '2027-02-14', startTime: '14:00', endTime: '16:00', notes: '' },
  ]);

  // Add option inline per open poll
  const [addingOptionPollId, setAddingOptionPollId] = useState<string | null>(null);
  const [newOptDate, setNewOptDate] = useState('2027-02-15');
  const [newOptStart, setNewOptStart] = useState('17:00');
  const [newOptEnd, setNewOptEnd] = useState('19:00');
  const [newOptNote, setNewOptNote] = useState('');

  const loadPolls = useCallback(async () => {
    if (!isAuthenticated || !contextId) return;
    setLoading(true);
    try {
      const res = await apiRequest<{ polls: SchedulingPoll[] }>(
        `/api/scheduling-polls?contextType=${encodeURIComponent(contextType)}&contextId=${encodeURIComponent(contextId)}`
      );
      setPolls(Array.isArray(res.polls) ? res.polls : []);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Zamanlama anketleri yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, contextType, contextId]);

  useEffect(() => {
    loadPolls();
  }, [loadPolls]);

  useEffect(() => {
    setTitle(defaultTitle);
  }, [defaultTitle]);

  const handleCreatePoll = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setNoticeMsg(null);
    if (!title.trim() || draftOptions.length === 0) {
      setErrorMsg('Anket başlığı ve en az bir zaman seçeneği zorunludur.');
      return;
    }

    setBusyId('create');
    try {
      const res = await apiRequest<{ poll: SchedulingPoll }>('/api/scheduling-polls', {
        method: 'POST',
        body: {
          contextType,
          contextId,
          title: title.trim(),
          description: description.trim(),
          venueId: venueId || null,
          durationMins: Number(durationMins || 90),
          responseDeadline: responseDeadline || null,
          options: draftOptions,
        },
      });
      if (res.poll) {
        setPolls((prev) => [res.poll, ...prev]);
      }
      setShowCreateForm(false);
      setDescription('');
      setNoticeMsg('Ortak zamanlama anketi başlatıldı ve ekip üyelerine bildirim gönderildi.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Zamanlama anketi oluşturulamadı.');
    } finally {
      setBusyId(null);
    }
  };

  const handleVote = async (
    pollId: string,
    optionId: string,
    response: 'available' | 'unavailable' | 'maybe'
  ) => {
    setErrorMsg(null);
    setBusyId(`vote:${optionId}`);
    try {
      const res = await apiRequest<{ poll: SchedulingPoll }>(`/api/scheduling-polls/${pollId}/vote`, {
        method: 'POST',
        body: { optionId, response },
      });
      if (res.poll) {
        setPolls((prev) => prev.map((p) => (p.id === pollId ? res.poll : p)));
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Oyunuz kaydedilemedi.');
    } finally {
      setBusyId(null);
    }
  };

  const handleAddOption = async (pollId: string) => {
    setErrorMsg(null);
    setBusyId(`addopt:${pollId}`);
    try {
      const res = await apiRequest<{ poll: SchedulingPoll }>(`/api/scheduling-polls/${pollId}/options`, {
        method: 'POST',
        body: {
          optionDate: newOptDate,
          startTime: newOptStart,
          endTime: newOptEnd,
          notes: newOptNote.trim(),
        },
      });
      if (res.poll) {
        setPolls((prev) => prev.map((p) => (p.id === pollId ? res.poll : p)));
      }
      setAddingOptionPollId(null);
      setNewOptNote('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Yeni seçenek eklenemedi.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteOption = async (pollId: string, optId: string) => {
    setErrorMsg(null);
    setBusyId(`delopt:${optId}`);
    try {
      const res = await apiRequest<{ poll: SchedulingPoll }>(
        `/api/scheduling-polls/${pollId}/options/${optId}`,
        { method: 'DELETE' }
      );
      if (res.poll) {
        setPolls((prev) => prev.map((p) => (p.id === pollId ? res.poll : p)));
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Seçenek silinemedi.');
    } finally {
      setBusyId(null);
    }
  };

  const handleFinalize = async (pollId: string, optionId: string) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    setBusyId(`fin:${optionId}`);
    try {
      const res = await apiRequest<{ poll: SchedulingPoll }>(`/api/scheduling-polls/${pollId}/finalize`, {
        method: 'POST',
        body: { optionId },
      });
      if (res.poll) {
        setPolls((prev) => prev.map((p) => (p.id === pollId ? res.poll : p)));
      }
      await refreshBootstrap();
      if (onFinalized) onFinalized();
      setNoticeMsg('Ortak zaman kesinleştirildi ve ilgili takvim akışına otomatik işlendi.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Zaman kesinleştirilemedi.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelPoll = async (pollId: string) => {
    setErrorMsg(null);
    setBusyId(`cancel:${pollId}`);
    try {
      const res = await apiRequest<{ poll: SchedulingPoll }>(`/api/scheduling-polls/${pollId}/cancel`, {
        method: 'POST',
      });
      if (res.poll) {
        setPolls((prev) => prev.map((p) => (p.id === pollId ? res.poll : p)));
      }
      setNoticeMsg('Zamanlama anketi iptal edildi.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Anket iptal edilemedi.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDownloadPollIcs = async (pollId: string) => {
    try {
      const token = getSessionToken();
      const resp = await fetch(`/api/scheduling-polls/${pollId}/ics`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!resp.ok) throw new Error('ICS indirilemedi.');
      const text = await resp.text();
      triggerBrowserDownload(`ortak-zamanlama-${pollId}.ics`, text, 'text/calendar;charset=utf-8');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Takvim dosyası indirilemedi.');
    }
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <section className="bg-[#F8FAFC] dark:bg-[#0B1120] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#DE5626]">
            <CalendarCheck2 className="w-3.5 h-3.5" />
            <span>Ortak Zamanlama Motoru</span>
          </div>
          <h3 className="font-display text-base font-bold text-[#16274e] dark:text-white mt-0.5">
            Ortak Zamanlama Anketleri (Doodle Tarzı)
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Ekip müsaitliklerini, onaylı sahne rezervasyonlarını ve seçili mekân takvimini çakışmasız eşleştirin.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setErrorMsg(null);
            setShowCreateForm((p) => !p);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#DE5626] hover:bg-[#c2451a] text-white text-xs font-bold cursor-pointer transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{showCreateForm ? 'Formu Kapat' : 'Yeni Zamanlama Anketi Başlat'}</span>
        </button>
      </div>

      {errorMsg && (
        <div role="alert" className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs font-medium flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {noticeMsg && (
        <div role="status" className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-medium flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{noticeMsg}</span>
        </div>
      )}

      {showCreateForm && (
        <form
          onSubmit={handleCreatePoll}
          className="bg-white dark:bg-[#13213e] rounded-2xl border border-slate-200 dark:border-[#1e335a] p-4 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-[#16274e] dark:text-slate-200 mb-1">
                Anket Başlığı *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Örn: Genel Prova & Soundcheck Saati"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[#16274e] dark:text-slate-200 mb-1">
                Hedef Mekân (Opsiyonel)
              </label>
              <select
                value={venueId}
                onChange={(e) => setVenueId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
              >
                <option value="">Mekân belirtilmedi</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.city})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[#16274e] dark:text-slate-200 mb-1">
                Süre / Son Yanıt
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={15}
                  step={15}
                  value={durationMins}
                  onChange={(e) => setDurationMins(Number(e.target.value))}
                  aria-label="Süre (dakika)"
                  className="w-20 px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs tabular-nums"
                />
                <input
                  type="date"
                  value={responseDeadline}
                  onChange={(e) => setResponseDeadline(e.target.value)}
                  aria-label="Son Yanıt Tarihi"
                  className="flex-1 px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-[#16274e] dark:text-slate-200 mb-1">
              Açıklama (Opsiyonel)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Gündem, gerekli ekipman veya toplantı bağlantısı notu..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#16274e] dark:text-slate-200">
                Önerilen Tarih &amp; Saat Seçenekleri ({draftOptions.length})
              </span>
              <button
                type="button"
                onClick={() =>
                  setDraftOptions((prev) => [
                    ...prev,
                    { optionDate: '2027-02-16', startTime: '19:00', endTime: '21:00', notes: '' },
                  ])
                }
                className="text-xs font-bold text-[#DE5626] hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Seçenek Ekle</span>
              </button>
            </div>
            <div className="space-y-2">
              {draftOptions.map((opt, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center p-2.5 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800"
                >
                  <input
                    type="date"
                    required
                    value={opt.optionDate}
                    onChange={(e) =>
                      setDraftOptions((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, optionDate: e.target.value } : item))
                      )
                    }
                    className="sm:col-span-3 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#13213e] text-xs"
                  />
                  <input
                    type="time"
                    required
                    value={opt.startTime}
                    onChange={(e) =>
                      setDraftOptions((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, startTime: e.target.value } : item))
                      )
                    }
                    className="sm:col-span-2 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#13213e] text-xs"
                  />
                  <input
                    type="time"
                    required
                    value={opt.endTime}
                    onChange={(e) =>
                      setDraftOptions((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, endTime: e.target.value } : item))
                      )
                    }
                    className="sm:col-span-2 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#13213e] text-xs"
                  />
                  <input
                    type="text"
                    value={opt.notes}
                    onChange={(e) =>
                      setDraftOptions((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, notes: e.target.value } : item))
                      )
                    }
                    placeholder="Not (opsiyonel)"
                    className="sm:col-span-4 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#13213e] text-xs"
                  />
                  {draftOptions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setDraftOptions((prev) => prev.filter((_, i) => i !== idx))}
                      className="sm:col-span-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 p-1.5 rounded-lg justify-self-end cursor-pointer"
                      aria-label="Seçeneği Kaldır"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={busyId === 'create'}
              className="px-5 py-2 rounded-xl bg-[#16274e] hover:bg-[#1E2B4F] text-white text-xs font-bold cursor-pointer disabled:opacity-60"
            >
              {busyId === 'create' ? 'Oluşturuluyor...' : 'Anketi Başlat'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-xs text-slate-500 py-4 text-center">Zamanlama anketleri yükleniyor...</div>
      ) : polls.length === 0 ? (
        <div className="p-4 rounded-xl bg-white dark:bg-[#13213e] border border-dashed border-slate-200 dark:border-[#1e335a] text-xs text-slate-500 text-center">
          Bu çalışma alanında henüz ortak zamanlama anketi yok. Yukarıdaki butondan ekibiniz için tarih seçenekleri önerebilirsiniz.
        </div>
      ) : (
        <div className="space-y-4">
          {polls.map((poll) => {
            const finalizedOpt =
              poll.status === 'finalized' && poll.finalizedOptionId
                ? poll.options.find((o) => o.id === poll.finalizedOptionId)
                : null;

            return (
              <article
                key={poll.id}
                className="bg-white dark:bg-[#13213e] rounded-2xl border border-slate-200 dark:border-[#1e335a] p-4 sm:p-5 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-display text-sm sm:text-base font-bold text-[#16274e] dark:text-white">
                        {poll.title}
                      </h4>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                          poll.status === 'finalized'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : poll.status === 'cancelled'
                            ? 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                            : 'bg-orange-100 text-[#DE5626] dark:bg-orange-500/20 dark:text-orange-300'
                        }`}
                      >
                        {poll.status === 'finalized'
                          ? 'Kesinleşti'
                          : poll.status === 'cancelled'
                          ? 'İptal Edildi'
                          : 'Oylamaya Açık'}
                      </span>
                    </div>
                    {poll.description && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{poll.description}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                      <span>Başlatan: {poll.organizerName}</span>
                      {poll.venueName && (
                        <span className="inline-flex items-center gap-1 text-[#16274e] dark:text-slate-200 font-semibold">
                          <MapPin className="w-3 h-3 text-[#DE5626]" />
                          {poll.venueName}
                        </span>
                      )}
                      {poll.responseDeadline && <span>Son Yanıt: {poll.responseDeadline}</span>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDownloadPollIcs(poll.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-bold hover:border-[#DE5626] cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-[#DE5626]" />
                      <span>.ICS İndir</span>
                    </button>
                    {poll.canManage && poll.status === 'open' && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setAddingOptionPollId((prev) => (prev === poll.id ? null : poll.id))
                          }
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-bold hover:border-[#DE5626] cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5 text-[#DE5626]" />
                          <span>Seçenek Ekle</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelPoll(poll.id)}
                          disabled={busyId === `cancel:${poll.id}`}
                          className="px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-[11px] font-bold cursor-pointer"
                        >
                          Anketi İptal Et
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {finalizedOpt && (
                  <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 font-bold text-emerald-900 dark:text-emerald-200">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span>
                        Kesinleşen Zaman: {finalizedOpt.optionDate} · {finalizedOpt.startTime} – {finalizedOpt.endTime}
                      </span>
                    </div>
                    <span className="text-[11px] text-emerald-700 dark:text-emerald-300">
                      Takvim ve çalışma akışına işlendi
                    </span>
                  </div>
                )}

                {addingOptionPollId === poll.id && (
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      value={newOptDate}
                      onChange={(e) => setNewOptDate(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#13213e] text-xs"
                    />
                    <input
                      type="time"
                      value={newOptStart}
                      onChange={(e) => setNewOptStart(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#13213e] text-xs"
                    />
                    <input
                      type="time"
                      value={newOptEnd}
                      onChange={(e) => setNewOptEnd(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#13213e] text-xs"
                    />
                    <input
                      type="text"
                      value={newOptNote}
                      onChange={(e) => setNewOptNote(e.target.value)}
                      placeholder="Not"
                      className="flex-1 min-w-[140px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#13213e] text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddOption(poll.id)}
                      disabled={busyId === `addopt:${poll.id}`}
                      className="px-3.5 py-1.5 rounded-lg bg-[#DE5626] text-white text-xs font-bold cursor-pointer"
                    >
                      Ekle
                    </button>
                  </div>
                )}

                <div className="space-y-3">
                  {poll.options.map((opt) => {
                    const ev: SchedulingPollOptionEvaluation | undefined = poll.evaluations.find(
                      (item) => item.optionId === opt.id
                    );
                    const myVote = poll.myVotes[opt.id];
                    const isFinalChosen = poll.finalizedOptionId === opt.id;

                    return (
                      <div
                        key={opt.id}
                        className={`p-3.5 rounded-xl border space-y-3 ${
                          isFinalChosen
                            ? 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-700'
                            : ev?.isRecommended
                            ? 'bg-orange-50/40 dark:bg-orange-500/5 border-[#DE5626]/40'
                            : 'bg-slate-50/70 dark:bg-[#0B1120] border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#16274e] dark:text-white tabular-nums">
                              <Calendar className="w-3.5 h-3.5 text-[#DE5626]" />
                              {opt.optionDate}
                            </span>
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                              <Clock className="w-3.5 h-3.5 text-slate-400" />
                              {opt.startTime} – {opt.endTime}
                            </span>
                            {ev?.isRecommended && poll.status === 'open' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#DE5626] text-white text-[10px] font-bold">
                                <Sparkles className="w-3 h-3" />
                                Önerilen Zaman
                              </span>
                            )}
                            {ev && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-[#13213e] border border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-700 dark:text-slate-200 tabular-nums">
                                <Users className="w-3 h-3 text-emerald-600" />
                                {ev.availableCount}/{ev.totalParticipants} kişi uygun
                              </span>
                            )}
                            {ev && ev.calendarConflictCount > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 text-[10px] font-bold">
                                <AlertCircle className="w-3 h-3" />
                                {ev.calendarConflictCount} takvim çakışması
                              </span>
                            )}
                            {ev && ev.venueStatus === 'conflict' && (
                              <span className="px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 text-[10px] font-bold">
                                Mekân Çakışması
                              </span>
                            )}
                            {ev && ev.venueStatus === 'available' && (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold">
                                Mekân Müsait
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            {poll.canVote && (
                              <>
                                <button
                                  type="button"
                                  disabled={busyId === `vote:${opt.id}`}
                                  onClick={() => handleVote(poll.id, opt.id, 'available')}
                                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer transition-colors ${
                                    myVote === 'available'
                                      ? 'bg-emerald-600 text-white border-emerald-600'
                                      : 'bg-white dark:bg-[#13213e] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-emerald-500'
                                  }`}
                                >
                                  <Check className="w-3 h-3" />
                                  <span>Uygunum</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={busyId === `vote:${opt.id}`}
                                  onClick={() => handleVote(poll.id, opt.id, 'maybe')}
                                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer transition-colors ${
                                    myVote === 'maybe'
                                      ? 'bg-amber-500 text-white border-amber-500'
                                      : 'bg-white dark:bg-[#13213e] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-amber-400'
                                  }`}
                                >
                                  <HelpCircle className="w-3 h-3" />
                                  <span>Belki</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={busyId === `vote:${opt.id}`}
                                  onClick={() => handleVote(poll.id, opt.id, 'unavailable')}
                                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer transition-colors ${
                                    myVote === 'unavailable'
                                      ? 'bg-rose-600 text-white border-rose-600'
                                      : 'bg-white dark:bg-[#13213e] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-rose-500'
                                  }`}
                                >
                                  <X className="w-3 h-3" />
                                  <span>Uygun Değilim</span>
                                </button>
                              </>
                            )}

                            {poll.canManage && poll.status === 'open' && (
                              <>
                                <button
                                  type="button"
                                  disabled={busyId === `fin:${opt.id}`}
                                  onClick={() => handleFinalize(poll.id, opt.id)}
                                  className="px-3 py-1.5 rounded-lg bg-[#16274e] hover:bg-[#1E2B4F] text-white text-[11px] font-bold cursor-pointer disabled:opacity-60"
                                >
                                  {busyId === `fin:${opt.id}` ? 'İşleniyor...' : 'Kesinleştir'}
                                </button>
                                {poll.options.length > 1 && (
                                  <button
                                    type="button"
                                    disabled={busyId === `delopt:${opt.id}`}
                                    onClick={() => handleDeleteOption(poll.id, opt.id)}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 cursor-pointer"
                                    aria-label="Seçeneği Sil"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {opt.notes && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">{opt.notes}</div>
                        )}

                        {ev && ev.participants.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {ev.participants.map((p) => (
                              <span
                                key={p.userId}
                                title={p.conflictReasonLabel || ''}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                                  p.calendarStatus === 'conflict'
                                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                                    : p.vote === 'available'
                                    ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                                    : p.vote === 'maybe'
                                    ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
                                    : p.vote === 'unavailable'
                                    ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500'
                                    : 'bg-white dark:bg-[#13213e] border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                                }`}
                              >
                                {p.calendarStatus === 'conflict' ? (
                                  <XCircle className="w-2.5 h-2.5 text-rose-600" />
                                ) : p.vote === 'available' ? (
                                  <Check className="w-2.5 h-2.5 text-emerald-600" />
                                ) : p.vote === 'maybe' ? (
                                  <HelpCircle className="w-2.5 h-2.5 text-amber-500" />
                                ) : null}
                                <span>{p.displayName}</span>
                                {p.calendarStatus === 'conflict' && <span>(Çakışma)</span>}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
