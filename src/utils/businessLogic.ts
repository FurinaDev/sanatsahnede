/**
 * Business logic and pure calculations for Kültür-Sanat Pazaryeri Platform
 * Includes commission models (Model A & Model B), cancellation rate algorithms,
 * and booking state transitions.
 */

export type CommissionModel = 'A_EMPLOYER_PAYS' | 'B_ARTIST_DEDUCTS';

export interface CommissionCalculation {
  grossAmount: number;
  commissionRate: number;
  commissionAmount: number;
  performerPayout: number;
  employerTotal: number;
  model: CommissionModel;
}

/**
 * Calculates commission and net payouts based on platform commission model.
 * Model A: Employer pays commission on top of performer's net quote.
 * Model B: Commission is deducted from the total paid by the employer.
 */
export function calculateCommission(
  baseAmount: number,
  commissionRatePct: number = 10,
  model: CommissionModel = 'A_EMPLOYER_PAYS'
): CommissionCalculation {
  if (baseAmount < 0) {
    throw new Error('Amount cannot be negative');
  }
  const rate = Math.max(0, Math.min(100, commissionRatePct));
  const commissionAmount = Math.round((baseAmount * rate) / 100);

  if (model === 'A_EMPLOYER_PAYS') {
    return {
      grossAmount: baseAmount + commissionAmount,
      commissionRate: rate,
      commissionAmount,
      performerPayout: baseAmount,
      employerTotal: baseAmount + commissionAmount,
      model: 'A_EMPLOYER_PAYS',
    };
  } else {
    return {
      grossAmount: baseAmount,
      commissionRate: rate,
      commissionAmount,
      performerPayout: baseAmount - commissionAmount,
      employerTotal: baseAmount,
      model: 'B_ARTIST_DEDUCTS',
    };
  }
}

/**
 * Calculates performer's cancellation rate as a percentage.
 * Only performer-initiated cancellations for confirmed bookings count.
 */
export function calculateCancellationRate(
  performerCancelledCount: number,
  totalConfirmedBookings: number
): number {
  if (totalConfirmedBookings <= 0) return 0;
  if (performerCancelledCount <= 0) return 0;
  const rate = (performerCancelledCount / totalConfirmedBookings) * 100;
  return Math.min(100, Math.round(rate * 10) / 10);
}

export type BookingStatus =
  | 'application_received'
  | 'shortlisted'
  | 'selected'
  | 'agreement_pending'
  | 'payment_pending'
  | 'confirmed'
  | 'performer_completed'
  | 'employer_completed'
  | 'payout_processing'
  | 'completed'
  | 'cancelled'
  | 'in_dispute'
  | 'refund_in_progress';

export type UserRole = 'artist' | 'ensemble_leader' | 'business_owner' | 'admin';

/**
 * Validates whether a state transition is allowed in the booking state machine.
 */
export function canTransitionBookingStatus(
  current: BookingStatus,
  target: BookingStatus,
  role: UserRole
): boolean {
  if (role === 'admin') return true;

  switch (current) {
    case 'selected':
      return target === 'agreement_pending';

    case 'agreement_pending':
      // Both sides can accept agreement to advance to payment
      return target === 'payment_pending' || target === 'cancelled';

    case 'payment_pending':
      // Employer pays to confirm booking
      if (role === 'business_owner') {
        return target === 'confirmed' || target === 'cancelled';
      }
      return false;

    case 'confirmed':
      // Either side can report completion, or report cancellation / dispute
      if (role === 'artist' || role === 'ensemble_leader') {
        return target === 'performer_completed' || target === 'cancelled' || target === 'in_dispute';
      }
      if (role === 'business_owner') {
        return target === 'employer_completed' || target === 'cancelled' || target === 'in_dispute';
      }
      return false;

    case 'performer_completed':
      // Waiting for employer to confirm, which finishes the service
      if (role === 'business_owner') {
        return target === 'completed' || target === 'in_dispute';
      }
      return false;

    case 'employer_completed':
      // Waiting for performer to confirm
      if (role === 'artist' || role === 'ensemble_leader') {
        return target === 'completed' || target === 'in_dispute';
      }
      return false;

    default:
      return false;
  }
}

/**
 * Checks if a business profile is verified and authorized to publish listings.
 */
export function canBusinessCreateListing(profile: { isVerified: boolean; verificationStatus: string }): boolean {
  return profile.isVerified === true && profile.verificationStatus === 'approved';
}

/**
 * Currency formatter for Turkish Lira
 */
export function formatCurrencyTRY(amount: number): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Checks whether two date+time ranges overlap on the same calendar day.
 */
export function hasTimeConflict(
  slotA: { date: string; startTime: string; endTime: string },
  slotB: { date: string; startTime: string; endTime: string }
): boolean {
  if (slotA.date !== slotB.date) return false;
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map((n) => Number(n) || 0);
    return h * 60 + m;
  };
  const startA = toMinutes(slotA.startTime);
  const endA = toMinutes(slotA.endTime);
  const startB = toMinutes(slotB.startTime);
  const endB = toMinutes(slotB.endTime);
  return startA < endB && startB < endA;
}

/**
 * Dual-confirmation payout guard: both performer and employer must confirm
 * completion and there must be no active dispute.
 */
export function canReleaseEscrowPayout(input: {
  performerCompletedAt?: string | null;
  employerCompletedAt?: string | null;
  disputeStatus?: string;
  paymentStatus?: string;
}): boolean {
  if (!input.performerCompletedAt || !input.employerCompletedAt) return false;
  if (input.disputeStatus === 'open') return false;
  if (input.paymentStatus === 'released' || input.paymentStatus === 'refunded') return false;
  return true;
}

export interface SmartMatchExplanation {
  entityId: string;
  entityName: string;
  entityType?: 'artist' | 'ensemble';
  city?: string;
  subtitle?: string;
  isVerified?: boolean;
  isAvailableThisWeek?: boolean;
  ratingAvg?: number;
  criteria: {
    label: string;
    level: 'tam' | 'yüksek' | 'uygun' | 'kısmi';
    reason: string;
  }[];
  matchedCriteriaCount: number;
}

/**
 * Explainable, auditable smart match helper (never reduces a human artist to a single opaque score).
 */
export function explainArtistListingMatch(
  listing: {
    city: string;
    discipline?: string;
    genres: string[];
    requiredInstruments: string[];
    eventDate: string;
    soundSystemProvided: boolean;
  },
  artist: {
    id: string;
    fullName: string;
    city: string;
    discipline?: string;
    genres: string[];
    instruments: string[];
    isVerified: boolean;
    completedJobsCount: number;
  },
  hasCalendarConflict: boolean
): SmartMatchExplanation {
  const criteria: SmartMatchExplanation['criteria'] = [];

  criteria.push({
    label: 'Tarih Uygunluğu',
    level: hasCalendarConflict ? 'kısmi' : 'yüksek',
    reason: hasCalendarConflict
      ? `${listing.eventDate} tarihinde takvim çakışması mevcut`
      : `${listing.eventDate} tarihinde takvim müsait`,
  });

  const cityMatch = artist.city.toLowerCase() === listing.city.toLowerCase();
  criteria.push({
    label: 'Konum Uyumu',
    level: cityMatch ? 'tam' : 'uygun',
    reason: cityMatch
      ? `Aynı şehir (${listing.city})`
      : `${artist.city} merkezli — seyahat planlaması gerekir`,
  });

  const genreOverlap = artist.genres.filter((g) => listing.genres.includes(g));
  const instOverlap = artist.instruments.filter((i) => listing.requiredInstruments.includes(i));
  criteria.push({
    label: 'Repertuvar & Enstrüman Uyumu',
    level: genreOverlap.length > 0 && instOverlap.length > 0 ? 'tam' : genreOverlap.length > 0 || instOverlap.length > 0 ? 'yüksek' : 'kısmi',
    reason:
      instOverlap.length > 0 || genreOverlap.length > 0
        ? `Eşleşen alanlar: ${[...instOverlap, ...genreOverlap].join(', ')}`
        : 'Alternatif disiplin / repertuvar uyarlaması gerekir',
  });

  criteria.push({
    label: 'Doğrulama & Tecrübe',
    level: artist.isVerified && artist.completedJobsCount > 0 ? 'yüksek' : 'uygun',
    reason: artist.isVerified
      ? `Doğrulanmış profil · ${artist.completedJobsCount} tamamlanan sahne`
      : 'Doğrulama süreci tamamlanmamış',
  });

  const matchedCriteriaCount = criteria.filter((c) => c.level === 'tam' || c.level === 'yüksek').length;

  return {
    entityId: artist.id,
    entityName: artist.fullName,
    entityType: 'artist',
    city: artist.city,
    isVerified: artist.isVerified,
    criteria,
    matchedCriteriaCount,
  };
}

/**
 * Unified Stage 6 explainable smart match for both individual artists and ensembles.
 */
export function explainPerformerListingMatch(
  listing: {
    city: string;
    discipline?: string;
    genres: string[];
    requiredInstruments: string[];
    targetEnsembleType?: string;
    eventDate: string;
    soundSystemProvided: boolean;
  },
  performer: {
    id: string;
    name: string;
    entityType: 'artist' | 'ensemble';
    city: string;
    discipline?: string;
    genres: string[];
    instruments: string[];
    ensembleType?: string;
    subtitle?: string;
    isVerified: boolean;
    isAvailableThisWeek?: boolean;
    completedJobsCount: number;
    ratingAvg?: number;
  },
  hasCalendarConflict: boolean
): SmartMatchExplanation {
  const criteria: SmartMatchExplanation['criteria'] = [];

  criteria.push({
    label: 'Tarih & Müsaitlik',
    level: hasCalendarConflict
      ? 'kısmi'
      : performer.isAvailableThisWeek
      ? 'tam'
      : 'yüksek',
    reason: hasCalendarConflict
      ? `${listing.eventDate} tarihinde takvim çakışması mevcut`
      : performer.isAvailableThisWeek
      ? `${listing.eventDate} için takvim müsait · Bu hafta sahneye açık`
      : `${listing.eventDate} tarihinde takvim müsait`,
  });

  const cityMatch = performer.city.toLowerCase() === listing.city.toLowerCase();
  criteria.push({
    label: 'Konum Uyumu',
    level: cityMatch ? 'tam' : 'uygun',
    reason: cityMatch
      ? `Aynı şehir (${listing.city})`
      : `${performer.city} merkezli — seyahat planlaması gerekir`,
  });

  const listingDisc = (listing.discipline || 'Müzik').toLowerCase();
  const perfDisc = (performer.discipline || 'Müzik').toLowerCase();
  const disciplineMatch = listingDisc === perfDisc;
  const genreOverlap = performer.genres.filter((g) => listing.genres.includes(g));
  const instOverlap = performer.instruments.filter((i) => listing.requiredInstruments.includes(i));
  const ensembleFormatMatch =
    performer.entityType === 'ensemble' &&
    listing.targetEnsembleType &&
    performer.ensembleType &&
    listing.targetEnsembleType.toLowerCase() === performer.ensembleType.toLowerCase();

  const repLevel: 'tam' | 'yüksek' | 'uygun' | 'kısmi' =
    disciplineMatch && (instOverlap.length > 0 || ensembleFormatMatch) && genreOverlap.length > 0
      ? 'tam'
      : disciplineMatch && (genreOverlap.length > 0 || instOverlap.length > 0 || ensembleFormatMatch)
      ? 'yüksek'
      : disciplineMatch
      ? 'uygun'
      : 'kısmi';

  const matchedTags = [
    ...(disciplineMatch ? [performer.discipline || 'Müzik'] : []),
    ...instOverlap,
    ...genreOverlap,
    ...(ensembleFormatMatch && performer.ensembleType ? [performer.ensembleType] : []),
  ];

  criteria.push({
    label: 'Disiplin & Repertuvar',
    level: repLevel,
    reason:
      matchedTags.length > 0
        ? `Eşleşen alanlar: ${Array.from(new Set(matchedTags)).join(', ')}`
        : 'Alternatif disiplin / repertuvar uyarlaması gerekir',
  });

  criteria.push({
    label: 'Doğrulama & Sahne Sicili',
    level: performer.isVerified && performer.completedJobsCount > 0 ? 'tam' : performer.isVerified ? 'yüksek' : 'uygun',
    reason: performer.isVerified
      ? `${performer.entityType === 'ensemble' ? 'Doğrulanmış topluluk' : 'Doğrulanmış sanatçı'} · ${performer.completedJobsCount} tamamlanan sahne`
      : 'Doğrulama süreci tamamlanmamış',
  });

  const matchedCriteriaCount = criteria.filter((c) => c.level === 'tam' || c.level === 'yüksek').length;

  return {
    entityId: performer.id,
    entityName: performer.name,
    entityType: performer.entityType,
    city: performer.city,
    subtitle: performer.subtitle,
    isVerified: performer.isVerified,
    isAvailableThisWeek: performer.isAvailableThisWeek,
    ratingAvg: performer.ratingAvg,
    criteria,
    matchedCriteriaCount,
  };
}

export interface RecommendedListingMatch {
  listingId: string;
  performerType: 'individual' | 'ensemble';
  performerId: string;
  performerName: string;
  hasCalendarConflict: boolean;
  matchedCriteriaCount: number;
  criteria: SmartMatchExplanation['criteria'];
}

export function explainRecommendedListingForPerformer(
  performer: {
    id: string;
    name: string;
    entityType: 'artist' | 'ensemble';
    city: string;
    discipline?: string;
    genres: string[];
    instruments: string[];
    ensembleType?: string;
    isVerified: boolean;
    isAvailableThisWeek?: boolean;
    completedJobsCount: number;
  },
  listing: {
    id: string;
    city: string;
    discipline?: string;
    genres: string[];
    requiredInstruments: string[];
    targetEnsembleType?: string;
    eventDate: string;
    soundSystemProvided: boolean;
    isReplacement?: boolean;
  },
  hasCalendarConflict: boolean
): RecommendedListingMatch {
  const explanation = explainPerformerListingMatch(listing, performer, hasCalendarConflict);
  return {
    listingId: listing.id,
    performerType: performer.entityType === 'ensemble' ? 'ensemble' : 'individual',
    performerId: performer.id,
    performerName: performer.name,
    hasCalendarConflict,
    matchedCriteriaCount: explanation.matchedCriteriaCount,
    criteria: explanation.criteria,
  };
}

export interface BookingReceiptSummary {
  bookingId: string;
  commissionModelLabel: string;
  paymentStatusLabel: string;
  bookingStatusLabel: string;
  dualContractSigned: boolean;
  dualCompletionConfirmed: boolean;
  totalHeldAmount: number;
  totalReleasedAmount: number;
  totalRefundedAmount: number;
  netPerformerPayout: number;
  platformCommissionAmount: number;
  employerGrossTotal: number;
}

export function buildBookingReceiptSummary(
  booking: {
    id: string;
    commissionModel: CommissionModel;
    commissionRate: number;
    netPayoutAmount: number;
    commissionAmount: number;
    grossAmount: number;
    status: string;
    paymentStatus: string;
    contractTermsAcceptedByEmployer: boolean;
    contractTermsAcceptedByPerformer: boolean;
    performerCompletedAt?: string | null;
    employerCompletedAt?: string | null;
  },
  ledgerEntries: Array<{ entryType: string; amount: number }>
): BookingReceiptSummary {
  const paymentStatusLabels: Record<string, string> = {
    unpaid: 'Ödeme Bekleniyor',
    held_sandbox: 'Güvence Havuzunda Bloke (Sandbox)',
    held_live: 'Güvence Havuzunda Bloke (Canlı)',
    released: 'Hakediş İcracıya Aktarıldı',
    refunded: 'İade Edildi',
    partially_refunded: 'Kısmi İade Edildi',
  };

  const bookingStatusLabels: Record<string, string> = {
    agreement_pending: 'Sözleşme Onayı Bekleniyor',
    payment_pending: 'Güvence Ödemesi Bekleniyor',
    confirmed: 'Rezervasyon Kesinleşti',
    performer_completed: 'İcracı Tamamladı (İşveren Onayı Bekleniyor)',
    employer_completed: 'İşveren Onayladı (İcracı Onayı Bekleniyor)',
    completed: 'Tamamlandı & Hakediş Serbest',
    cancelled: 'İptal Edildi',
    in_dispute: 'Uyuşmazlık İncelemesinde (Donduruldu)',
  };

  const totalHeldAmount = ledgerEntries
    .filter((e) => e.entryType === 'payment_hold')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const totalReleasedAmount = ledgerEntries
    .filter((e) => e.entryType === 'payout_release')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const totalRefundedAmount = ledgerEntries
    .filter((e) => e.entryType === 'refund' || e.entryType === 'partial_refund')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  return {
    bookingId: booking.id,
    commissionModelLabel:
      booking.commissionModel === 'A_EMPLOYER_PAYS'
        ? `Model A — %${booking.commissionRate} Platform Komisyonu İşveren Tarafından Ödenir`
        : `Model B — %${booking.commissionRate} Platform Komisyonu Brüt Bütçeden Düşülür`,
    paymentStatusLabel: paymentStatusLabels[booking.paymentStatus] || booking.paymentStatus,
    bookingStatusLabel: bookingStatusLabels[booking.status] || booking.status,
    dualContractSigned: Boolean(
      booking.contractTermsAcceptedByEmployer && booking.contractTermsAcceptedByPerformer
    ),
    dualCompletionConfirmed: Boolean(booking.performerCompletedAt && booking.employerCompletedAt),
    totalHeldAmount,
    totalReleasedAmount,
    totalRefundedAmount,
    netPerformerPayout: Number(booking.netPayoutAmount || 0),
    platformCommissionAmount: Number(booking.commissionAmount || 0),
    employerGrossTotal: Number(booking.grossAmount || 0),
  };
}
