import React, { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useApp, AppView } from '../../context/AppContext';
import {
  ArtDiscipline,
  UnifiedSearchCategory,
  UnifiedSearchHit,
  UnifiedSearchResponse,
} from '../../types';
import { ART_DISCIPLINES, CITY_LIST } from '../../utils/disciplineConfig';
import { VerifiedBadge } from './VerifiedBadge';
import {
  Briefcase,
  Building2,
  Calendar,
  Compass,
  FileText,
  Hash,
  MapPin,
  Search,
  Sparkles,
  User as UserIcon,
  Users,
  X,
} from 'lucide-react';

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_META: Array<{
  key: 'all' | UnifiedSearchCategory;
  label: string;
}> = [
  { key: 'all', label: 'Tümü' },
  { key: 'listing', label: 'İlanlar' },
  { key: 'artist', label: 'Sanatçılar' },
  { key: 'ensemble', label: 'Topluluklar' },
  { key: 'business', label: 'İşletmeler' },
  { key: 'event', label: 'Etkinlikler' },
  { key: 'opportunity', label: 'Fırsatlar' },
  { key: 'community', label: 'Kanallar' },
  { key: 'post', label: 'Akış' },
];

function getCategoryLabel(cat: UnifiedSearchCategory): string {
  return CATEGORY_META.find((m) => m.key === cat)?.label || cat;
}

function getCategoryIcon(cat: UnifiedSearchCategory) {
  switch (cat) {
    case 'listing':
      return <Briefcase className="w-3.5 h-3.5 text-[#E45424]" />;
    case 'artist':
      return <UserIcon className="w-3.5 h-3.5 text-[#16274e] dark:text-blue-300" />;
    case 'ensemble':
      return <Users className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-300" />;
    case 'business':
      return <Building2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300" />;
    case 'event':
      return <Calendar className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300" />;
    case 'opportunity':
      return <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-300" />;
    case 'community':
      return <Hash className="w-3.5 h-3.5 text-[#E45424]" />;
    case 'post':
      return <FileText className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />;
  }
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({ open, onClose }) => {
  const { navigateTo } = useApp();
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('Tümü');
  const [discipline, setDiscipline] = useState<ArtDiscipline | 'Tümü'>('Tümü');
  const [activeTab, setActiveTab] = useState<'all' | UnifiedSearchCategory>('all');
  const [result, setResult] = useState<UnifiedSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 40);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set('q', query.trim());
        if (city !== 'Tümü') params.set('city', city);
        if (discipline !== 'Tümü') params.set('discipline', discipline);
        if (activeTab !== 'all') params.set('category', activeTab);
        params.set('limit', activeTab === 'all' ? '4' : '12');

        const data = await apiRequest<UnifiedSearchResponse>(`/api/search?${params.toString()}`);
        if (!cancelled) setResult(data);
      } catch {
        // leave previous results cleanly
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, city, discipline, activeTab]);

  if (!open) return null;

  const hits: UnifiedSearchHit[] = result
    ? activeTab === 'all'
      ? result.topHits
      : result.grouped[activeTab] || []
    : [];

  const handlePickHit = (hit: UnifiedSearchHit) => {
    onClose();
    navigateTo(hit.targetView as AppView, hit.entityId);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-start justify-center pt-10 sm:pt-16 px-3 sm:px-5"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Platform Genelinde Ara"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl bg-white dark:bg-[#13213e] rounded-2xl border border-[#e2e8f0] dark:border-[#1e335a] shadow-2xl overflow-hidden text-left"
      >
        {/* Search Bar Header */}
        <div className="p-3.5 sm:p-4 border-b border-[#e2e8f0] dark:border-[#1e335a] flex items-center gap-2.5">
          <Search className="w-4 h-4 text-[#E45424] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="İlan, sanatçı, topluluk, mekân, etkinlik, fırsat veya kanal ara..."
            className="flex-1 bg-transparent text-sm text-[#0f172a] dark:text-white placeholder:text-slate-400 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Aramayı Temizle"
              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Aramayı Kapat"
            className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-[#0f1c38] text-[10px] font-bold text-slate-500 cursor-pointer"
          >
            ESC
          </button>
        </div>

        {/* City & Discipline Quick Filters + Category Tabs */}
        <div className="px-3.5 sm:px-4 py-2.5 bg-[#f8fafc] dark:bg-[#0f1c38]/80 border-b border-[#e2e8f0] dark:border-[#1e335a] space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
              <MapPin className="w-3.5 h-3.5 text-[#E45424]" />
              <select
                aria-label="Arama Şehir Filtresi"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="px-2 py-1 rounded-lg border border-slate-200 dark:border-[#1e335a] bg-white dark:bg-[#13213e] text-xs font-semibold text-[#0f172a] dark:text-white"
              >
                {CITY_LIST.map((c) => (
                  <option key={c} value={c}>
                    {c === 'Tümü' ? 'Tüm Şehirler' : c}
                  </option>
                ))}
              </select>
            </div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
              <Compass className="w-3.5 h-3.5 text-[#E45424]" />
              <select
                aria-label="Arama Disiplin Filtresi"
                value={discipline}
                onChange={(e) => setDiscipline(e.target.value as ArtDiscipline | 'Tümü')}
                className="px-2 py-1 rounded-lg border border-slate-200 dark:border-[#1e335a] bg-white dark:bg-[#13213e] text-xs font-semibold text-[#0f172a] dark:text-white"
              >
                {ART_DISCIPLINES.map((d) => (
                  <option key={d} value={d}>
                    {d === 'Tümü' ? 'Tüm Sanat Dalları' : d}
                  </option>
                ))}
              </select>
            </div>
            <span className="ml-auto text-[11px] font-semibold text-slate-500 tabular-nums">
              {loading ? 'Aranıyor...' : `${result?.totalCount ?? 0} sonuç`}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {CATEGORY_META.map((cat) => {
              const count =
                cat.key === 'all'
                  ? result?.totalCount ?? 0
                  : result?.counts?.[cat.key] ?? 0;
              const active = activeTab === cat.key;
              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => setActiveTab(cat.key)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#16274e] dark:bg-[#E45424] text-white'
                      : 'bg-white dark:bg-[#13213e] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-[#1e335a] hover:border-[#E45424]/40'
                  }`}
                >
                  {cat.label} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Results List */}
        <div className="max-h-[58vh] overflow-y-auto divide-y divide-slate-100 dark:divide-[#1e335a]/70">
          {hits.length === 0 ? (
            <div className="py-12 px-4 text-center text-xs text-slate-500 dark:text-slate-400">
              {loading
                ? 'Sonuçlar getiriliyor...'
                : 'Seçili kriterlere uygun kayıt bulunamadı. Farklı bir anahtar kelime veya filtre deneyin.'}
            </div>
          ) : (
            hits.map((hit) => (
              <button
                key={`${hit.category}-${hit.id}`}
                type="button"
                onClick={() => handlePickHit(hit)}
                className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-[#0f1c38]/80 transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-[#0f1c38] border border-slate-200 dark:border-[#1e335a] flex items-center justify-center shrink-0 overflow-hidden">
                    {hit.avatarUrl ? (
                      <img src={hit.avatarUrl} alt={hit.title} className="w-full h-full object-cover" />
                    ) : (
                      getCategoryIcon(hit.category)
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs sm:text-[13px] font-bold text-[#0f172a] dark:text-white truncate">
                        {hit.title}
                      </span>
                      {hit.isVerified && (
                        <VerifiedBadge size="sm" label={hit.verifiedLabel || 'Doğrulanmış'} />
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {hit.subtitle}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end shrink-0 gap-1">
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#0f1c38] text-[10px] font-bold text-[#16274e] dark:text-slate-200 inline-flex items-center gap-1">
                    {getCategoryIcon(hit.category)}
                    <span>{getCategoryLabel(hit.category)}</span>
                  </span>
                  <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                    {hit.meta}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
