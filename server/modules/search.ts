import { Router } from 'express';
import { DbInstance, parseJson } from '../db/database';
import { AuthedRequest } from '../middleware/auth';
import {
  mapBusinessProfile,
  mapEnsemble,
  mapEvent,
  mapIndividualProfile,
  mapListing,
  mapOpportunity,
} from '../db/mappers';
import {
  getMutualBlockedUserIds,
  getMutedUserIds,
} from '../services/socialGraphService';
import { normalizeTurkish, scoreFieldMatch } from '../../src/utils/globalSearch';
import { UnifiedSearchCategory, UnifiedSearchHit } from '../../src/types';

const CATEGORIES: UnifiedSearchCategory[] = [
  'listing',
  'artist',
  'ensemble',
  'business',
  'event',
  'opportunity',
  'community',
  'post',
];

export function createSearchRouter(db: DbInstance): Router {
  const router = Router();

  router.get('/search', (req: AuthedRequest, res) => {
    const query = String(req.query.q || '').trim();
    const city = String(req.query.city || 'Tümü').trim();
    const discipline = String(req.query.discipline || 'Tümü').trim();
    const categoryFilter = String(req.query.category || 'all').trim();
    const limitPerCategory = Math.min(20, Math.max(1, Number(req.query.limit || 6)));

    const normalizedQuery = normalizeTurkish(query);
    const hasCity = Boolean(city && city !== 'Tümü');
    const hasDiscipline = Boolean(discipline && discipline !== 'Tümü');
    const viewerId = req.user?.id || null;
    const isStaff = Boolean(
      req.user && ['admin', 'moderator', 'verification_officer', 'support'].includes(req.user.activeRole)
    );

    const blockedIds = getMutualBlockedUserIds(db, viewerId);
    const mutedIds = getMutedUserIds(db, viewerId);
    const viewerFollowingIds = viewerId
      ? new Set(
          (
            db
              .prepare('SELECT following_user_id FROM follows WHERE follower_user_id = ?')
              .all(viewerId) as Array<{ following_user_id: string }>
          ).map((r) => r.following_user_id)
        )
      : new Set<string>();

    const grouped: Record<UnifiedSearchCategory, UnifiedSearchHit[]> = {
      listing: [],
      artist: [],
      ensemble: [],
      business: [],
      event: [],
      opportunity: [],
      community: [],
      post: [],
    };

    const bizUserMap = new Map<string, string>(
      (
        db.prepare('SELECT id, user_id FROM business_profiles').all() as Array<{
          id: string;
          user_id: string;
        }>
      ).map((b) => [b.id, b.user_id])
    );

    // 1. Active Listings
    if (categoryFilter === 'all' || categoryFilter === 'listing') {
      const rows = db
        .prepare(`SELECT * FROM listings WHERE status = 'active' ORDER BY is_replacement DESC, created_at DESC`)
        .all() as any[];
      for (const row of rows) {
        const ownerId = bizUserMap.get(row.business_id);
        if (ownerId && blockedIds.has(ownerId)) continue;
        const item = mapListing(row);
        const disc = item.discipline || 'Müzik';
        if (hasCity && item.city !== city) continue;
        if (hasDiscipline && disc !== discipline) continue;
        const score = scoreFieldMatch(normalizedQuery, item.title, [
          item.businessName,
          item.venueName,
          item.city,
          item.district,
          disc,
          item.eventType,
          item.targetEnsembleType,
          item.description,
          ...item.genres,
          ...item.requiredInstruments,
          ...(item.specialtyTags || []),
        ]);
        if (score > 0) {
          grouped.listing.push({
            id: item.id,
            category: 'listing',
            title: item.title,
            subtitle: `${item.businessName} · ${item.city}`,
            meta: `${item.budgetAmount.toLocaleString('tr-TR')} ₺ · ${item.eventDate}`,
            city: item.city,
            discipline: disc,
            score: score + (item.isReplacement ? 6 : 0),
            avatarUrl: item.businessLogo,
            isVerified: item.businessVerified,
            targetView: 'listing_detail',
            entityId: item.id,
          });
        }
      }
    }

    // 2. Artists (respect blocks + private visibility)
    if (categoryFilter === 'all' || categoryFilter === 'artist') {
      const rows = db.prepare('SELECT * FROM individual_profiles ORDER BY rating_avg DESC').all() as any[];
      for (const row of rows) {
        if (blockedIds.has(row.user_id)) continue;
        const isPrivate = row.profile_visibility === 'private';
        const canSeePrivate =
          !isPrivate ||
          isStaff ||
          (viewerId && (viewerId === row.user_id || viewerFollowingIds.has(row.user_id)));
        if (!canSeePrivate) continue;

        const item = mapIndividualProfile(row);
        const disc = item.discipline || 'Müzik';
        if (hasCity && item.city !== city) continue;
        if (hasDiscipline && disc !== discipline) continue;

        const score = scoreFieldMatch(normalizedQuery, item.fullName, [
          item.stageName || '',
          item.title,
          item.primaryInstrument,
          item.city,
          item.district,
          disc,
          item.bioShort,
          ...item.instruments,
          ...item.genres,
          ...(item.specialtyTags || []),
        ]);
        if (score > 0) {
          grouped.artist.push({
            id: item.id,
            category: 'artist',
            title: item.fullName,
            subtitle: `${item.title} · ${item.city}`,
            meta: `${item.primaryInstrument} · ${item.ratingAvg.toFixed(1)} ★`,
            city: item.city,
            discipline: disc,
            score: score + (item.isVerified ? 4 : 0) + (item.isAvailableThisWeek ? 2 : 0),
            avatarUrl: item.avatarUrl,
            isVerified: item.isVerified,
            verifiedLabel: item.verifiedLabel,
            targetView: 'artist_profile',
            entityId: item.id,
          });
        }
      }
    }

    // 3. Ensembles
    if (categoryFilter === 'all' || categoryFilter === 'ensemble') {
      const rows = db.prepare('SELECT * FROM ensembles ORDER BY rating_avg DESC').all() as any[];
      for (const row of rows) {
        if (blockedIds.has(row.leader_user_id)) continue;
        const item = mapEnsemble(db, row);
        const disc = item.discipline || 'Müzik';
        if (hasCity && item.city !== city) continue;
        if (hasDiscipline && disc !== discipline) continue;

        const score = scoreFieldMatch(normalizedQuery, item.name, [
          item.ensembleType,
          item.city,
          disc,
          item.bio,
          ...item.genres,
          ...(item.specialtyTags || []),
          ...item.members.flatMap((m) => [m.name, m.instrument]),
        ]);
        if (score > 0) {
          grouped.ensemble.push({
            id: item.id,
            category: 'ensemble',
            title: item.name,
            subtitle: `${item.ensembleType} · ${item.city}`,
            meta: `${item.members.length} Üye · ${item.ratingAvg.toFixed(1)} ★`,
            city: item.city,
            discipline: disc,
            score: score + (item.isVerified ? 4 : 0),
            avatarUrl: item.avatarUrl,
            isVerified: item.isVerified,
            verifiedLabel: item.verifiedLabel,
            targetView: 'ensemble_profile',
            entityId: item.id,
          });
        }
      }
    }

    // 4. Businesses / Culture Venues
    if (categoryFilter === 'all' || categoryFilter === 'business') {
      const rows = db.prepare('SELECT * FROM business_profiles ORDER BY rating_avg DESC').all() as any[];
      for (const row of rows) {
        if (blockedIds.has(row.user_id)) continue;
        const item = mapBusinessProfile(row);
        if (hasCity && item.city !== city) continue;
        if (hasDiscipline && !(item.disciplines || []).includes(discipline as any)) continue;

        const score = scoreFieldMatch(normalizedQuery, item.businessName, [
          item.businessType,
          item.city,
          item.district,
          item.description,
          ...(item.disciplines || []),
          ...(item.facilities || []),
        ]);
        if (score > 0) {
          grouped.business.push({
            id: item.id,
            category: 'business',
            title: item.businessName,
            subtitle: `${item.businessType} · ${item.city}`,
            meta: `${item.completedBookingsCount} Etkinlik · ${item.ratingAvg.toFixed(1)} ★`,
            city: item.city,
            discipline: item.disciplines?.[0] || 'Müzik',
            score: score + (item.isVerified ? 4 : 0),
            avatarUrl: item.logoUrl,
            isVerified: item.isVerified,
            verifiedLabel: item.verifiedLabel,
            targetView: 'business_profile',
            entityId: item.id,
          });
        }
      }
    }

    // 5. Published Events
    if (categoryFilter === 'all' || categoryFilter === 'event') {
      const rows = db
        .prepare(`SELECT * FROM events WHERE status = 'published' ORDER BY event_date ASC`)
        .all() as any[];
      for (const row of rows) {
        if (row.creator_user_id && blockedIds.has(row.creator_user_id)) continue;
        const item = mapEvent(row);
        const disc = item.discipline || 'Müzik';
        if (hasCity && item.city !== city) continue;
        if (hasDiscipline && disc !== discipline) continue;

        const score = scoreFieldMatch(normalizedQuery, item.title, [
          item.venueName,
          item.organizerName,
          item.performers,
          item.category,
          item.city,
          disc,
          item.description,
          ...(item.genres || []),
        ]);
        if (score > 0) {
          grouped.event.push({
            id: item.id,
            category: 'event',
            title: item.title,
            subtitle: `${item.venueName} · ${item.city}`,
            meta: `${item.eventDate} · ${item.isFree || item.ticketPrice === 0 ? 'Ücretsiz' : `${item.ticketPrice.toLocaleString('tr-TR')} ₺`}`,
            city: item.city,
            discipline: disc,
            score,
            avatarUrl: item.posterUrl,
            targetView: 'event_detail',
            entityId: item.id,
          });
        }
      }
    }

    // 6. Open / Published Opportunities (Grants, Residencies, Festivals)
    if (categoryFilter === 'all' || categoryFilter === 'opportunity') {
      const rows = db
        .prepare(`SELECT * FROM opportunities WHERE status = 'published' ORDER BY deadline ASC`)
        .all() as any[];
      for (const row of rows) {
        const item = mapOpportunity(row);
        if (hasCity && item.city !== city && item.city !== 'Çevrimiçi' && item.city !== 'Türkiye Geneli') continue;
        if (hasDiscipline && item.discipline !== discipline && String(item.discipline) !== 'Tümü') continue;

        const score = scoreFieldMatch(normalizedQuery, item.title, [
          item.organizerName,
          item.category,
          item.city,
          item.country,
          item.discipline,
          item.requirements,
          item.rewardInfo,
        ]);
        if (score > 0) {
          grouped.opportunity.push({
            id: item.id,
            category: 'opportunity',
            title: item.title,
            subtitle: `${item.organizerName} · ${item.city}`,
            meta: `${item.category} · Son: ${item.deadline}`,
            city: item.city,
            discipline: item.discipline,
            score,
            targetView: 'opportunity_radar',
            entityId: item.id,
          });
        }
      }
    }

    // 7. Communities & Channels
    if (categoryFilter === 'all' || categoryFilter === 'community') {
      const memberCommunityIds = viewerId
        ? new Set(
            (
              db
                .prepare('SELECT community_id FROM community_members WHERE user_id = ?')
                .all(viewerId) as Array<{ community_id: string }>
            ).map((r) => r.community_id)
          )
        : new Set<string>();

      const rows = db.prepare('SELECT * FROM communities ORDER BY created_at DESC').all() as any[];
      for (const row of rows) {
        if (blockedIds.has(row.owner_user_id)) continue;
        if (row.visibility !== 'public' && !memberCommunityIds.has(row.id) && !isStaff) continue;
        if (hasCity && row.city !== city) continue;
        if (hasDiscipline && row.discipline !== discipline) continue;

        const score = scoreFieldMatch(normalizedQuery, row.name, [
          row.description,
          row.city,
          row.discipline,
        ]);
        if (score > 0) {
          const memberCnt = (
            db.prepare('SELECT COUNT(*) as cnt FROM community_members WHERE community_id = ?').get(row.id) as {
              cnt: number;
            }
          ).cnt;
          grouped.community.push({
            id: row.id,
            category: 'community',
            title: row.name,
            subtitle: `${row.discipline} · ${row.city}`,
            meta: `${memberCnt} Üye`,
            city: row.city,
            discipline: row.discipline,
            score: score + (row.is_verified ? 3 : 0),
            avatarUrl: row.avatar_url,
            isVerified: Boolean(row.is_verified),
            verifiedLabel: row.verified_label || '',
            targetView: 'communities',
            entityId: row.id,
          });
        }
      }
    }

    // 8. Feed Posts (respecting blocks, mutes, followers-only visibility, and private artist authors)
    if (categoryFilter === 'all' || categoryFilter === 'post') {
      const privateArtistUserIds = new Set(
        (
          db
            .prepare(`SELECT user_id FROM individual_profiles WHERE profile_visibility = 'private'`)
            .all() as Array<{ user_id: string }>
        ).map((r) => r.user_id)
      );
      const rows = db
        .prepare(`SELECT * FROM posts WHERE status = 'published' ORDER BY created_at DESC LIMIT 80`)
        .all() as any[];
      for (const row of rows) {
        if (blockedIds.has(row.author_user_id) || mutedIds.has(row.author_user_id)) continue;
        const isAuthorSelf = viewerId === row.author_user_id;
        const followsAuthor = viewerFollowingIds.has(row.author_user_id);
        if (row.visibility === 'followers' && !isAuthorSelf && !followsAuthor && !isStaff) continue;
        if (privateArtistUserIds.has(row.author_user_id) && !isAuthorSelf && !followsAuthor && !isStaff) {
          continue;
        }
        if (hasDiscipline && row.discipline !== discipline) continue;

        const tags = parseJson<string[]>(row.tags_json, []);
        const score = scoreFieldMatch(normalizedQuery, row.body.slice(0, 120), [
          row.author_name,
          row.author_subtitle,
          row.discipline,
          row.body,
          ...tags,
        ]);
        if (score > 0) {
          grouped.post.push({
            id: row.id,
            category: 'post',
            title: `${row.author_name}: ${row.body.slice(0, 72)}${row.body.length > 72 ? '...' : ''}`,
            subtitle: `${row.author_subtitle || row.discipline} · Akış Paylaşımı`,
            meta: tags.slice(0, 2).map((t) => `#${t}`).join(' ') || row.discipline,
            city: '',
            discipline: row.discipline,
            score,
            avatarUrl: row.author_avatar,
            targetView: 'feed',
            entityId: row.id,
          });
        }
      }
    }

    const counts = {} as Record<UnifiedSearchCategory, number>;
    let totalCount = 0;

    for (const cat of CATEGORIES) {
      grouped[cat].sort((a, b) => b.score - a.score);
      counts[cat] = grouped[cat].length;
      totalCount += counts[cat];
      grouped[cat] = grouped[cat].slice(0, limitPerCategory);
    }

    const topHits = CATEGORIES.flatMap((cat) => grouped[cat])
      .sort((a, b) => b.score - a.score)
      .slice(0, 14);

    return res.json({
      query,
      city,
      discipline,
      totalCount,
      counts,
      grouped,
      topHits,
    });
  });

  return router;
}
