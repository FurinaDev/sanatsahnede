import {
  ArtDiscipline,
  BusinessProfile,
  Ensemble,
  EventAnnouncement,
  IndividualProfile,
  Listing,
} from '../types';
import { resolveDiscipline } from './disciplineConfig';

export type GlobalSearchCategory =
  | 'listing'
  | 'artist'
  | 'ensemble'
  | 'business'
  | 'event';

export interface GlobalSearchHit {
  id: string;
  category: GlobalSearchCategory;
  title: string;
  subtitle: string;
  meta: string;
  city: string;
  discipline: ArtDiscipline;
  score: number;
  avatarUrl?: string;
  isVerified?: boolean;
  searchHint?: string;
}

export interface GlobalSearchInput {
  listings: Listing[];
  artists: IndividualProfile[];
  ensembles: Ensemble[];
  businesses: BusinessProfile[];
  events: EventAnnouncement[];
  query: string;
  city?: string;
  discipline?: ArtDiscipline | 'Tümü';
  limitPerCategory?: number;
}

export interface GlobalSearchResult {
  hasCriteria: boolean;
  totalCount: number;
  counts: Record<GlobalSearchCategory, number>;
  grouped: Record<GlobalSearchCategory, GlobalSearchHit[]>;
  topHits: GlobalSearchHit[];
  recommendedCategory: GlobalSearchCategory;
}

export const SEARCH_CATEGORY_LABELS: Record<GlobalSearchCategory, string> = {
  listing: 'İlanlar',
  artist: 'Sanatçılar',
  ensemble: 'Topluluklar',
  business: 'İşletmeler',
  event: 'Etkinlikler',
};

export const SEARCH_CATEGORY_BADGES: Record<GlobalSearchCategory, string> = {
  listing: 'İlan',
  artist: 'Sanatçı',
  ensemble: 'Topluluk',
  business: 'İşletme',
  event: 'Etkinlik',
};

export function normalizeTurkish(value: string): string {
  return value.trim().toLocaleLowerCase('tr-TR');
}

function scoreFieldMatch(
  normalizedQuery: string,
  primaryText: string,
  secondaryFields: string[]
): number {
  if (!normalizedQuery) return 10;

  const primary = normalizeTurkish(primaryText);
  if (primary === normalizedQuery) return 120;
  if (primary.startsWith(normalizedQuery)) return 95;
  if (primary.includes(normalizedQuery)) return 75;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => primary.includes(t))) {
    return 68;
  }

  for (const field of secondaryFields) {
    if (!field) continue;
    const norm = normalizeTurkish(field);
    if (norm === normalizedQuery) return 55;
    if (norm.startsWith(normalizedQuery)) return 45;
    if (norm.includes(normalizedQuery)) return 32;
  }

  if (tokens.length > 1) {
    const combined = `${primary} ${secondaryFields.map(normalizeTurkish).join(' ')}`;
    if (tokens.every((t) => combined.includes(t))) {
      return 28;
    }
  }

  return 0;
}

export function searchAllEntities({
  listings,
  artists,
  ensembles,
  businesses,
  events,
  query,
  city = 'Tümü',
  discipline = 'Tümü',
  limitPerCategory = 4,
}: GlobalSearchInput): GlobalSearchResult {
  const normalizedQuery = normalizeTurkish(query);
  const hasCity = Boolean(city && city !== 'Tümü');
  const selectedDiscipline: ArtDiscipline | null =
    discipline && discipline !== 'Tümü' ? discipline : null;
  const hasCriteria = Boolean(normalizedQuery || hasCity || selectedDiscipline);

  const grouped: Record<GlobalSearchCategory, GlobalSearchHit[]> = {
    listing: [],
    artist: [],
    ensemble: [],
    business: [],
    event: [],
  };

  // 1. Active Listings
  for (const l of listings) {
    if (l.status !== 'active') continue;
    const disc = resolveDiscipline(l.discipline);
    if (hasCity && l.city !== city) continue;
    if (selectedDiscipline && disc !== selectedDiscipline) continue;

    const score = scoreFieldMatch(normalizedQuery, l.title, [
      l.businessName,
      l.venueName,
      l.city,
      l.district,
      l.eventType,
      l.targetEnsembleType,
      disc,
      l.description,
      ...l.genres,
      ...l.requiredInstruments,
      ...(l.specialtyTags || []),
    ]);

    if (score > 0) {
      grouped.listing.push({
        id: l.id,
        category: 'listing',
        title: l.title,
        subtitle: `${l.businessName} · ${l.city}`,
        meta: `${l.budgetAmount.toLocaleString('tr-TR')} ₺ · ${l.eventDate}`,
        city: l.city,
        discipline: disc,
        score: score + (l.isReplacement ? 4 : 0),
        avatarUrl: l.businessLogo,
        isVerified: l.businessVerified,
      });
    }
  }

  // 2. Artists
  for (const a of artists) {
    const disc = resolveDiscipline(a.discipline);
    if (hasCity && a.city !== city) continue;
    if (selectedDiscipline && disc !== selectedDiscipline) continue;

    const score = scoreFieldMatch(normalizedQuery, a.fullName, [
      a.stageName || '',
      a.title,
      a.primaryInstrument,
      a.city,
      a.district,
      disc,
      a.bioShort,
      ...a.instruments,
      ...a.genres,
      ...(a.specialtyTags || []),
    ]);

    if (score > 0) {
      grouped.artist.push({
        id: a.id,
        category: 'artist',
        title: a.fullName,
        subtitle: `${a.title} · ${a.city}`,
        meta: `${a.primaryInstrument} · ${a.ratingAvg.toFixed(1)} ★`,
        city: a.city,
        discipline: disc,
        score: score + (a.isRecommended ? 3 : 0),
        avatarUrl: a.avatarUrl,
        isVerified: a.isVerified,
      });
    }
  }

  // 3. Ensembles
  for (const e of ensembles) {
    const disc = resolveDiscipline(e.discipline);
    if (hasCity && e.city !== city) continue;
    if (selectedDiscipline && disc !== selectedDiscipline) continue;

    const score = scoreFieldMatch(normalizedQuery, e.name, [
      e.ensembleType,
      e.city,
      disc,
      e.bio,
      ...e.genres,
      ...(e.specialtyTags || []),
      ...e.members.flatMap((m) => [m.name, m.instrument]),
    ]);

    if (score > 0) {
      grouped.ensemble.push({
        id: e.id,
        category: 'ensemble',
        title: e.name,
        subtitle: `${e.ensembleType} · ${e.city}`,
        meta: `${e.members.length} Üye · ${e.ratingAvg.toFixed(1)} ★`,
        city: e.city,
        discipline: disc,
        score,
        avatarUrl: e.avatarUrl,
        isVerified: e.isVerified,
      });
    }
  }

  // 4. Businesses / Venues
  for (const b of businesses) {
    const bizDisciplines: ArtDiscipline[] =
      b.disciplines && b.disciplines.length > 0 ? b.disciplines : ['Müzik'];
    if (hasCity && b.city !== city) continue;
    if (selectedDiscipline && !bizDisciplines.includes(selectedDiscipline)) continue;

    const score = scoreFieldMatch(normalizedQuery, b.businessName, [
      b.businessType,
      b.city,
      b.district,
      b.description,
      ...bizDisciplines,
      ...(b.facilities || []),
    ]);

    if (score > 0) {
      grouped.business.push({
        id: b.id,
        category: 'business',
        title: b.businessName,
        subtitle: `${b.businessType} · ${b.city}`,
        meta: `${b.completedBookingsCount} Etkinlik · ${b.ratingAvg.toFixed(1)} ★`,
        city: b.city,
        discipline: bizDisciplines[0],
        score,
        avatarUrl: b.logoUrl,
        isVerified: b.isVerified,
      });
    }
  }

  // 5. Published Events
  for (const evt of events) {
    if (evt.status !== 'published') continue;
    const disc = resolveDiscipline(evt.discipline);
    if (hasCity && evt.city !== city) continue;
    if (selectedDiscipline && disc !== selectedDiscipline) continue;

    const score = scoreFieldMatch(normalizedQuery, evt.title, [
      evt.venueName,
      evt.organizerName,
      evt.performers,
      evt.category,
      evt.city,
      disc,
      evt.description,
      ...evt.genres,
    ]);

    if (score > 0) {
      grouped.event.push({
        id: evt.id,
        category: 'event',
        title: evt.title,
        subtitle: `${evt.venueName} · ${evt.city}`,
        meta: `${evt.eventDate} · ${evt.isFree || evt.ticketPrice === 0 ? 'Ücretsiz' : `${evt.ticketPrice.toLocaleString('tr-TR')} ₺`}`,
        city: evt.city,
        discipline: disc,
        score,
        avatarUrl: evt.posterUrl,
        searchHint: evt.title,
      });
    }
  }

  const counts: Record<GlobalSearchCategory, number> = {
    listing: grouped.listing.length,
    artist: grouped.artist.length,
    ensemble: grouped.ensemble.length,
    business: grouped.business.length,
    event: grouped.event.length,
  };

  const categories: GlobalSearchCategory[] = [
    'listing',
    'artist',
    'ensemble',
    'business',
    'event',
  ];

  for (const cat of categories) {
    grouped[cat].sort((a, b) => b.score - a.score);
    grouped[cat] = grouped[cat].slice(0, limitPerCategory);
  }

  const allTop = categories
    .flatMap((cat) => grouped[cat])
    .sort((a, b) => b.score - a.score);

  const totalCount =
    counts.listing +
    counts.artist +
    counts.ensemble +
    counts.business +
    counts.event;

  // Determine the best directory route when user submits the full search form
  let recommendedCategory: GlobalSearchCategory = 'listing';
  if (normalizedQuery && allTop.length > 0) {
    // Only switch away from 'listing' if another category clearly outscores listings or listings have 0 matches
    const topListingScore = grouped.listing[0]?.score ?? 0;
    const bestOverall = allTop[0];
    if (counts.listing === 0 || bestOverall.score >= topListingScore + 20) {
      recommendedCategory = bestOverall.category;
    }
  } else if (counts.listing === 0) {
    const firstNonEmpty = categories.find((c) => counts[c] > 0);
    if (firstNonEmpty) recommendedCategory = firstNonEmpty;
  }

  return {
    hasCriteria,
    totalCount,
    counts,
    grouped,
    topHits: allTop.slice(0, 10),
    recommendedCategory,
  };
}
