import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useApp } from '../context/AppContext';
import { ArtDiscipline } from '../types';
import { ART_DISCIPLINES, CITY_LIST } from '../utils/disciplineConfig';
import {
  GlobalSearchCategory,
  GlobalSearchHit,
  SEARCH_CATEGORY_BADGES,
  SEARCH_CATEGORY_LABELS,
  searchAllEntities,
} from '../utils/globalSearch';
import { CustomSelect } from './ui/CustomSelect';
import { AnimatedCounter } from './ui/AnimatedCounter';
import { BrandSymbol } from './ui/BrandSymbol';
import { computePlatformStats } from '../utils/platformStats';
import {
  ArrowRight,
  Briefcase,
  Building2,
  Calendar,
  Compass,
  MapPin,
  Palette,
  Search,
  Sparkles,
  User as UserIcon,
  Users,
  X,
} from 'lucide-react';

interface QuickTopic {
  label: string;
  discipline: ArtDiscipline | 'Tümü';
  query: string;
}

const QUICK_TOPICS: QuickTopic[] = [
  { label: 'Klasik & Oda Müziği', discipline: 'Müzik', query: '' },
  { label: 'Heykel & Enstalasyon', discipline: 'Heykel & Enstalasyon', query: '' },
  { label: 'Görsel Sanatlar & Sergi', discipline: 'Görsel Sanatlar & Sergi', query: '' },
  { label: 'Edebiyat & Söyleşi', discipline: 'Edebiyat & Söyleşi', query: '' },
  { label: 'Bileşik Sanatlar', discipline: 'Bileşik Sanatlar', query: '' },
  { label: 'Caz & Akustik', discipline: 'Müzik', query: 'Caz' },
];

const CATEGORY_ORDER: GlobalSearchCategory[] = [
  'listing',
  'artist',
  'ensemble',
  'business',
  'event',
];

function getCategoryIcon(category: GlobalSearchCategory) {
  switch (category) {
    case 'listing':
      return <Briefcase className="w-3.5 h-3.5" />;
    case 'artist':
      return <UserIcon className="w-3.5 h-3.5" />;
    case 'ensemble':
      return <Users className="w-3.5 h-3.5" />;
    case 'business':
      return <Building2 className="w-3.5 h-3.5" />;
    case 'event':
      return <Calendar className="w-3.5 h-3.5" />;
  }
}

function getCategoryBadgeClasses(category: GlobalSearchCategory): string {
  switch (category) {
    case 'listing':
      return 'bg-[#DE5626]/12 text-[#DE5626] dark:bg-[#DE5626]/20 dark:text-[#ffb59e]';
    case 'artist':
      return 'bg-[#162956]/10 text-[#162956] dark:bg-blue-500/20 dark:text-blue-300';
    case 'ensemble':
      return 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300';
    case 'business':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300';
    case 'event':
      return 'bg-amber-50 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300';
  }
}

export const HeroSection: React.FC = () => {
  const {
    navigateTo,
    setFilters,
    setDirectorySearchPreset,
    listings,
    artists,
    ensembles,
    businesses,
    events,
    reviews,
  } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCity, setSelectedCity] = useState('Tümü');
  const [selectedDiscipline, setSelectedDiscipline] = useState<ArtDiscipline | 'Tümü'>('Tümü');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeCategoryTab, setActiveCategoryTab] = useState<'all' | GlobalSearchCategory>('all');
  const searchConsoleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (
        searchConsoleRef.current &&
        !searchConsoleRef.current.contains(event.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const searchResults = useMemo(
    () =>
      searchAllEntities({
        listings,
        artists,
        ensembles,
        businesses,
        events,
        query: searchTerm,
        city: selectedCity,
        discipline: selectedDiscipline,
        limitPerCategory: 4,
      }),
    [listings, artists, ensembles, businesses, events, searchTerm, selectedCity, selectedDiscipline]
  );

  const navigateToCategoryDirectory = (
    category: GlobalSearchCategory,
    customQuery?: string
  ) => {
    const q = (customQuery ?? searchTerm).trim();
    setDropdownOpen(false);

    if (category === 'listing') {
      setFilters((prev) => ({
        ...prev,
        searchQuery: q,
        city: selectedCity,
        discipline: selectedDiscipline,
        specialty: 'Tümü',
        genre: 'Tümü',
        ensembleType: 'Tümü',
        instrument: 'Tümü',
      }));
      navigateTo('listings');
      return;
    }

    const viewMap: Record<
      Exclude<GlobalSearchCategory, 'listing'>,
      'artists_directory' | 'ensembles_directory' | 'businesses_directory' | 'events'
    > = {
      artist: 'artists_directory',
      ensemble: 'ensembles_directory',
      business: 'businesses_directory',
      event: 'events',
    };

    const targetView = viewMap[category];
    setDirectorySearchPreset({
      targetView,
      query: q,
      city: selectedCity,
      discipline: selectedDiscipline,
    });
    navigateTo(targetView);
  };

  const handleSelectHit = (hit: GlobalSearchHit) => {
    setDropdownOpen(false);
    switch (hit.category) {
      case 'listing':
        navigateTo('listing_detail', hit.id);
        break;
      case 'artist':
        navigateTo('artist_profile', hit.id);
        break;
      case 'ensemble':
        navigateTo('ensemble_profile', hit.id);
        break;
      case 'business':
        navigateTo('business_profile', hit.id);
        break;
      case 'event':
        navigateTo('event_detail', hit.id);
        break;
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const targetCat: GlobalSearchCategory =
      activeCategoryTab !== 'all' ? activeCategoryTab : searchResults.recommendedCategory;
    navigateToCategoryDirectory(targetCat);
  };

  const handleQuickSearch = (topic: QuickTopic) => {
    setDropdownOpen(false);
    setFilters((prev) => ({
      ...prev,
      searchQuery: topic.query,
      city: 'Tümü',
      discipline: topic.discipline,
      specialty: 'Tümü',
      genre: 'Tümü',
      ensembleType: 'Tümü',
      instrument: 'Tümü',
    }));
    navigateTo('listings');
  };

  const visibleHits = useMemo(() => {
    if (activeCategoryTab === 'all') {
      return searchResults.topHits;
    }
    return searchResults.grouped[activeCategoryTab];
  }, [activeCategoryTab, searchResults]);

  const showSuggestionsPanel =
    dropdownOpen &&
    (searchTerm.trim().length > 0 ||
      selectedCity !== 'Tümü' ||
      selectedDiscipline !== 'Tümü');

  const CITY_OPTIONS = CITY_LIST.map((city) => ({
    value: city,
    label: city === 'Tümü' ? 'Tüm Şehirler' : city,
  }));

  const DISCIPLINE_OPTIONS = ART_DISCIPLINES.map((discipline) => ({
    value: discipline,
    label: discipline === 'Tümü' ? 'Tüm Sanat Türleri' : discipline,
  }));

  const stats = useMemo(
    () =>
      computePlatformStats({
        artists,
        ensembles,
        businesses,
        listings,
        events,
        reviews,
      }),
    [artists, ensembles, businesses, listings, events, reviews]
  );

  return (
    <section className="relative z-20 pt-12 pb-14 lg:pt-16 lg:pb-18 bg-[#162956] dark:bg-[#0B1120] border-b border-[#223c78] dark:border-slate-800 transition-colors">
      {/* Clipped Decorative Background Layer (Depth Spotlights + Outer Edge Brand Wireframes) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_70%_at_50%_35%,rgba(36,68,142,0.5)_0%,rgba(22,41,86,0.18)_55%,rgba(10,20,46,0.6)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_46%,rgba(222,86,38,0.10)_0%,transparent_58%)]" />

        {/* Left & Right Architectural Brand Wireframe Textures visible and balanced across all viewports */}
        <div className="absolute left-1 sm:left-3 md:left-6 lg:left-10 xl:left-16 2xl:left-24 top-5 md:top-1/2 md:-translate-y-1/2 opacity-[0.07] text-white select-none">
          <BrandSymbol className="w-[120px] sm:w-[165px] md:w-[215px] lg:w-[250px] xl:w-[280px] h-auto" strokeWidth={0.9} />
        </div>
        <div className="absolute right-1 sm:right-3 md:right-6 lg:right-10 xl:right-16 2xl:right-24 top-5 md:top-1/2 md:-translate-y-1/2 opacity-[0.07] text-white -scale-x-100 select-none">
          <BrandSymbol className="w-[120px] sm:w-[165px] md:w-[215px] lg:w-[250px] xl:w-[280px] h-auto" strokeWidth={0.9} />
        </div>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Display Headline */}
        <motion.h1
          initial={{ opacity: 0.7, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          className="font-hero text-[1.7rem] sm:text-5xl lg:text-[3.35rem] font-semibold tracking-tight text-white leading-[1.15] mb-8 text-balance"
        >
          Her <span className="text-[#F46A36] font-bold">Sanat</span>
          <br />
          Bir <span className="text-[#F46A36] font-bold">Sahneyi</span> Hak Eder.
        </motion.h1>

        {/* Multidisciplinary Search Console + Live Instant Suggestions */}
        <motion.div
          ref={searchConsoleRef}
          initial={{ opacity: 0.75, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          className="relative max-w-4xl mx-auto bg-white dark:bg-[#111A2E] p-3 sm:p-4 rounded-2xl shadow-[0_18px_45px_rgba(8,18,44,0.38)] border border-white/15 dark:border-slate-800"
        >
          <form
            onSubmit={handleSearchSubmit}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 text-left"
          >
            <div className="sm:col-span-2 lg:col-span-4 p-2.5 sm:px-3 bg-[#F2F4F8] dark:bg-slate-900/70 rounded-xl border border-[#E2E8F0] dark:border-slate-800 focus-within:border-[#DE5626] transition-colors">
              <label className="block text-[10px] font-bold tracking-wider uppercase text-slate-500 dark:text-slate-400 mb-0.5">
                Ne Arıyorsunuz?
              </label>
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-[#162956]/80 dark:text-slate-300 shrink-0" />
                <input
                  type="text"
                  value={searchTerm}
                  onFocus={() => setDropdownOpen(true)}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setDropdownOpen(true);
                  }}
                  placeholder="Sanatçı, ilan, topluluk, işletme veya etkinlik ara..."
                  aria-label="Ne Arıyorsunuz?"
                  aria-expanded={showSuggestionsPanel}
                  aria-autocomplete="list"
                  className="w-full bg-transparent border-0 p-0 text-xs font-medium text-slate-800 dark:text-white focus:outline-hidden placeholder:text-slate-400"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchTerm('');
                      setActiveCategoryTab('all');
                    }}
                    aria-label="Arama metnini temizle"
                    className="p-0.5 text-slate-400 hover:text-[#DE5626] transition-colors cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="lg:col-span-3 p-2.5 sm:px-3 bg-[#F2F4F8] dark:bg-slate-900/70 rounded-xl border border-[#E2E8F0] dark:border-slate-800 focus-within:border-[#DE5626] transition-colors">
              <label className="block text-[10px] font-bold tracking-wider uppercase text-slate-500 dark:text-slate-400 mb-0.5">
                Şehir / Lokasyon
              </label>
              <CustomSelect
                variant="ghost"
                ariaLabel="Şehir / Lokasyon"
                value={selectedCity}
                onChange={(val) => {
                  setSelectedCity(val);
                  if (searchTerm.trim() || val !== 'Tümü') {
                    setDropdownOpen(true);
                  }
                }}
                options={CITY_OPTIONS}
                icon={<MapPin className="w-4 h-4 text-[#162956]/80 dark:text-slate-300" />}
              />
            </div>

            <div className="lg:col-span-3 p-2.5 sm:px-3 bg-[#F2F4F8] dark:bg-slate-900/70 rounded-xl border border-[#E2E8F0] dark:border-slate-800 focus-within:border-[#DE5626] transition-colors">
              <label className="block text-[10px] font-bold tracking-wider uppercase text-slate-500 dark:text-slate-400 mb-0.5">
                Tür
              </label>
              <CustomSelect
                variant="ghost"
                ariaLabel="Sanat Türü"
                value={selectedDiscipline}
                onChange={(val) => {
                  const next = val as ArtDiscipline | 'Tümü';
                  setSelectedDiscipline(next);
                  if (searchTerm.trim() || next !== 'Tümü') {
                    setDropdownOpen(true);
                  }
                }}
                options={DISCIPLINE_OPTIONS}
                icon={<Palette className="w-4 h-4 text-[#162956]/80 dark:text-slate-300" />}
              />
            </div>

            <button
              type="submit"
              className="sm:col-span-2 lg:col-span-2 bg-[#DE5626] hover:bg-[#c2451a] text-white font-bold p-3 sm:p-2.5 rounded-xl flex items-center justify-center gap-2 shadow-sm transition-transform active:scale-95 text-sm cursor-pointer"
            >
              <Search className="w-4 h-4" />
              <span>Ara</span>
            </button>
          </form>

          {/* Editorial Quick Search Links (Multidisciplinary, Zero-Pill) */}
          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-center sm:justify-start gap-x-2.5 gap-y-1.5 text-xs">
            <span className="text-slate-400 dark:text-slate-500 text-[11px] font-semibold uppercase tracking-wider">
              Hızlı arama:
            </span>
            {QUICK_TOPICS.map((topic, idx) => (
              <React.Fragment key={topic.label}>
                {idx > 0 && (
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-700 select-none">
                    ·
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleQuickSearch(topic)}
                  className="text-slate-600 dark:text-slate-300 hover:text-[#E45424] dark:hover:text-[#E45424] transition-colors text-[11px] font-medium cursor-pointer underline-offset-4 hover:underline"
                >
                  {topic.label}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* Live Multi-Entity Autocomplete Suggestions Dropdown */}
          {showSuggestionsPanel && (
            <div
              role="region"
              aria-label="Anlık arama önerileri"
              className="absolute left-0 right-0 top-[calc(100%+10px)] z-50 bg-white dark:bg-[#111A2E] rounded-2xl border border-[#E2E8F0] dark:border-[#1e335a] shadow-[0_24px_60px_rgba(8,18,44,0.32)] overflow-hidden text-left"
            >
              {/* Category Scope Tabs */}
              <div className="px-3.5 py-2.5 bg-[#F2F4F8] dark:bg-[#0d1629] border-b border-[#E2E8F0] dark:border-[#1e335a] flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActiveCategoryTab('all')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                      activeCategoryTab === 'all'
                        ? 'bg-[#162956] dark:bg-[#DE5626] text-white'
                        : 'bg-white dark:bg-[#13213e] text-slate-600 dark:text-slate-300 border border-[#E2E8F0] dark:border-[#1e335a] hover:border-[#DE5626]/50'
                    }`}
                  >
                    Tümü ({searchResults.totalCount})
                  </button>
                  {CATEGORY_ORDER.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setActiveCategoryTab(cat)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                        activeCategoryTab === cat
                          ? 'bg-[#DE5626] text-white'
                          : 'bg-white dark:bg-[#13213e] text-slate-600 dark:text-slate-300 border border-[#E2E8F0] dark:border-[#1e335a] hover:border-[#DE5626]/50'
                      }`}
                    >
                      {getCategoryIcon(cat)}
                      <span>
                        {SEARCH_CATEGORY_LABELS[cat]} ({searchResults.counts[cat]})
                      </span>
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setDropdownOpen(false)}
                  aria-label="Öneri panelini kapat"
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Results List */}
              {visibleHits.length === 0 ? (
                <div className="px-5 py-8 text-center space-y-2">
                  <Sparkles className="w-6 h-6 text-[#DE5626] mx-auto opacity-80" />
                  <p className="text-xs font-bold text-[#162956] dark:text-white">
                    Seçilen arama kriteriyle eşleşen kayıt bulunamadı
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Farklı bir sanatçı adı, enstrüman, mekân, şehir veya etkinlik anahtar kelimesi deneyebilirsiniz.
                  </p>
                </div>
              ) : (
                <div className="max-h-[340px] overflow-y-auto divide-y divide-[#E2E8F0]/70 dark:divide-[#1e335a]">
                  {visibleHits.map((hit) => (
                    <button
                      key={`${hit.category}-${hit.id}`}
                      type="button"
                      onClick={() => handleSelectHit(hit)}
                      className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#F2F4F8] dark:hover:bg-[#162442] transition-colors text-left cursor-pointer group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-[#F2F4F8] dark:bg-slate-800 border border-[#E2E8F0] dark:border-[#1e335a] overflow-hidden flex items-center justify-center shrink-0 text-[#162956] dark:text-slate-200">
                          {hit.avatarUrl ? (
                            <img
                              src={hit.avatarUrl}
                              alt={hit.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            getCategoryIcon(hit.category)
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${getCategoryBadgeClasses(
                                hit.category
                              )}`}
                            >
                              {SEARCH_CATEGORY_BADGES[hit.category]}
                            </span>
                            <span className="text-xs sm:text-sm font-bold text-[#162956] dark:text-white group-hover:text-[#DE5626] transition-colors truncate">
                              {hit.title}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {hit.subtitle}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="hidden sm:inline text-[11px] font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                          {hit.meta}
                        </span>
                        <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-[#DE5626] group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Footer Category Shortcuts */}
              <div className="px-4 py-2.5 bg-[#F2F4F8]/80 dark:bg-[#0d1629] border-t border-[#E2E8F0] dark:border-[#1e335a] flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-500 dark:text-slate-400 font-medium">
                  Tüm dizinde filtrelemek için kategori seçin:
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {CATEGORY_ORDER.filter((cat) => searchResults.counts[cat] > 0).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => navigateToCategoryDirectory(cat)}
                      className="inline-flex items-center gap-1 font-bold text-[#162956] dark:text-[#ffb59e] hover:text-[#DE5626] transition-colors cursor-pointer"
                    >
                      <span>
                        {SEARCH_CATEGORY_LABELS[cat]} ({searchResults.counts[cat]})
                      </span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </motion.div>

        {/* 5-Column Live Counter Stats Row (No Top Divider Line) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mt-10 max-w-4xl mx-auto pt-2 tabular-nums">
          <button
            type="button"
            onClick={() => navigateTo('artists_directory')}
            className="text-center group cursor-pointer rounded-xl py-1 transition-colors"
          >
            <div className="font-sans text-2xl sm:text-3xl font-extrabold tracking-tight text-white group-hover:text-[#FDBA74] transition-colors">
              <AnimatedCounter value={stats.artistCount} />
              <span className="text-[#F8B49B]">+</span>
            </div>
            <div className="text-xs text-slate-300 font-medium mt-0.5">
              Sanatçı
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigateTo('businesses_directory')}
            className="text-center group cursor-pointer rounded-xl py-1 transition-colors"
          >
            <div className="font-sans text-2xl sm:text-3xl font-extrabold tracking-tight text-white group-hover:text-[#FDBA74] transition-colors">
              <AnimatedCounter value={stats.businessCount} />
              <span className="text-[#F8B49B]">+</span>
            </div>
            <div className="text-xs text-slate-300 font-medium mt-0.5">
              İşletme
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigateTo('listings')}
            className="text-center group cursor-pointer rounded-xl py-1 transition-colors"
          >
            <div className="font-sans text-2xl sm:text-3xl font-extrabold tracking-tight text-white group-hover:text-[#FDBA74] transition-colors">
              <AnimatedCounter value={stats.listingCount} />
              <span className="text-[#F8B49B]">+</span>
            </div>
            <div className="text-xs text-slate-300 font-medium mt-0.5">
              İlan
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigateTo('events')}
            className="text-center group cursor-pointer rounded-xl py-1 transition-colors"
          >
            <div className="font-sans text-2xl sm:text-3xl font-extrabold tracking-tight text-white group-hover:text-[#FDBA74] transition-colors">
              <AnimatedCounter value={stats.eventCount} />
              <span className="text-[#F8B49B]">+</span>
            </div>
            <div className="text-xs text-slate-300 font-medium mt-0.5">
              Etkinlik
            </div>
          </button>

          <div className="col-span-2 sm:col-span-1 text-center py-1">
            <div
              className="font-sans text-2xl sm:text-3xl font-extrabold tracking-tight text-[#FDBA74]"
              title={`Ortalama ${stats.averageRating.toFixed(2)} / 5`}
            >
              <AnimatedCounter value={stats.satisfactionPercent} prefix="%" />
            </div>
            <div className="text-xs text-slate-300 font-medium mt-0.5">
              Memnuniyet
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
