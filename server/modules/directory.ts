import { Router } from 'express';
import { DbInstance } from '../db/database';
import { AuthedRequest } from '../middleware/auth';
import {
  applyArtistPrivacyMask,
  mapBusinessProfile,
  mapEnsemble,
  mapIndividualProfile,
  mapListing,
} from '../db/mappers';
import { getFollowCountMaps, getMutualBlockedUserIds } from '../services/socialGraphService';

export function parsePaginationParams(query: Record<string, any>, defaultLimit = 24, maxLimit = 100) {
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1);
  const rawLimit = Number.parseInt(String(query.limit || String(defaultLimit)), 10) || defaultLimit;
  const limit = Math.min(maxLimit, Math.max(1, rawLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export function buildPaginationEnvelope<T>(items: T[], total: number, page: number, limit: number) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    items,
    total,
    page,
    limit,
    totalPages,
    hasMore: page < totalPages,
  };
}

export function createDirectoryRouter(db: DbInstance): Router {
  const router = Router();

  router.get('/artists', (req: AuthedRequest, res) => {
    const { page, limit, offset } = parsePaginationParams(req.query as Record<string, any>);
    const city = String(req.query.city || '').trim();
    const discipline = String(req.query.discipline || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase();
    const onlyVerified = req.query.verified === 'true';
    const onlyAvailable = req.query.availableThisWeek === 'true';

    const blockedIds = getMutualBlockedUserIds(db, req.user?.id);
    const { followerCounts, followingCounts } = getFollowCountMaps(db);

    const isStaff =
      req.user &&
      ['admin', 'moderator', 'finance_admin', 'verification_officer', 'support'].includes(
        req.user.activeRole
      );

    const allRows = db
      .prepare('SELECT * FROM individual_profiles ORDER BY is_recommended DESC, rating_avg DESC')
      .all() as any[];

    const mapped = allRows
      .filter((r) => !blockedIds.has(r.user_id))
      .map((r) =>
        applyArtistPrivacyMask(
          mapIndividualProfile(r, {
            followersCount: followerCounts[r.user_id] || 0,
            followingCount: followingCounts[r.user_id] || 0,
          }),
          req.user?.id,
          Boolean(isStaff)
        )
      )
      .filter((a) => {
        if (city && city !== 'Tümü' && a.city !== city) return false;
        if (discipline && discipline !== 'Tümü' && (a.discipline || 'Müzik') !== discipline) return false;
        if (onlyVerified && !a.isVerified) return false;
        if (onlyAvailable && !a.isAvailableThisWeek) return false;
        if (q) {
          const hay = `${a.fullName} ${a.stageName || ''} ${a.title} ${a.city} ${a.district} ${a.primaryInstrument} ${a.genres.join(' ')} ${(a.specialtyTags || []).join(' ')}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

    const slice = mapped.slice(offset, offset + limit);
    return res.json({
      ...buildPaginationEnvelope(slice, mapped.length, page, limit),
      artists: slice,
    });
  });

  router.get('/ensembles', (req: AuthedRequest, res) => {
    const { page, limit, offset } = parsePaginationParams(req.query as Record<string, any>);
    const city = String(req.query.city || '').trim();
    const discipline = String(req.query.discipline || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase();

    const blockedIds = getMutualBlockedUserIds(db, req.user?.id);
    const { followerCounts, followingCounts } = getFollowCountMaps(db);

    const allRows = db
      .prepare('SELECT * FROM ensembles ORDER BY is_recommended DESC, rating_avg DESC')
      .all() as any[];

    const mapped = allRows
      .filter((r) => !blockedIds.has(r.leader_user_id))
      .map((r) =>
        mapEnsemble(db, r, {
          followersCount: followerCounts[r.leader_user_id] || 0,
          followingCount: followingCounts[r.leader_user_id] || 0,
        })
      )
      .filter((e) => {
        if (city && city !== 'Tümü' && e.city !== city) return false;
        if (discipline && discipline !== 'Tümü' && (e.discipline || 'Müzik') !== discipline) return false;
        if (q) {
          const hay = `${e.name} ${e.ensembleType} ${e.city} ${e.bio} ${e.genres.join(' ')}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

    const slice = mapped.slice(offset, offset + limit);
    return res.json({
      ...buildPaginationEnvelope(slice, mapped.length, page, limit),
      ensembles: slice,
    });
  });

  router.get('/businesses', (req: AuthedRequest, res) => {
    const { page, limit, offset } = parsePaginationParams(req.query as Record<string, any>);
    const city = String(req.query.city || '').trim();
    const type = String(req.query.type || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase();

    const blockedIds = getMutualBlockedUserIds(db, req.user?.id);
    const { followerCounts, followingCounts } = getFollowCountMaps(db);

    const activeListingsCountByBiz = new Map<string, number>();
    for (const row of db
      .prepare(`SELECT business_id, COUNT(*) as cnt FROM listings WHERE status = 'active' GROUP BY business_id`)
      .all() as any[]) {
      activeListingsCountByBiz.set(row.business_id, Number(row.cnt));
    }

    const allRows = db
      .prepare('SELECT * FROM business_profiles ORDER BY is_recommended DESC, rating_avg DESC')
      .all() as any[];

    const mapped = allRows
      .filter((b) => !blockedIds.has(b.user_id))
      .map((b) =>
        mapBusinessProfile(b, activeListingsCountByBiz.get(b.id) || 0, {
          followersCount: followerCounts[b.user_id] || 0,
          followingCount: followingCounts[b.user_id] || 0,
        })
      )
      .filter((b) => {
        if (city && city !== 'Tümü' && b.city !== city) return false;
        if (type && type !== 'Tümü' && b.businessType !== type) return false;
        if (q) {
          const hay = `${b.businessName} ${b.businessType} ${b.city} ${b.district} ${b.description}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

    const slice = mapped.slice(offset, offset + limit);
    return res.json({
      ...buildPaginationEnvelope(slice, mapped.length, page, limit),
      businesses: slice,
    });
  });

  router.get('/listings', (req: AuthedRequest, res) => {
    const user = req.user || null;
    const isStaff =
      user &&
      ['admin', 'moderator', 'finance_admin', 'verification_officer', 'support'].includes(
        user.activeRole
      );
    const myBizIds = user
      ? (db.prepare('SELECT id FROM business_profiles WHERE user_id = ?').all(user.id) as any[]).map((b) => b.id)
      : [];
    const blockedIds = getMutualBlockedUserIds(db, user?.id);
    const blockedBizIds = blockedIds.size > 0
      ? new Set(
          (db.prepare('SELECT id, user_id FROM business_profiles').all() as Array<{ id: string; user_id: string }>)
            .filter((b) => blockedIds.has(b.user_id))
            .map((b) => b.id)
        )
      : new Set<string>();

    const { page, limit, offset } = parsePaginationParams(req.query as Record<string, any>);
    const city = String(req.query.city || '').trim();
    const discipline = String(req.query.discipline || '').trim();
    const status = String(req.query.status || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase();

    const rows = db.prepare('SELECT * FROM listings ORDER BY created_at DESC').all() as any[];
    const visible = rows
      .filter((l) => {
        if (blockedBizIds.has(l.business_id)) return false;
        if (isStaff) return true;
        if (['active', 'assigned', 'completed'].includes(l.status)) return true;
        if (myBizIds.includes(l.business_id)) return true;
        return false;
      })
      .map(mapListing)
      .filter((l) => {
        if (city && city !== 'Tümü' && l.city !== city) return false;
        if (discipline && discipline !== 'Tümü' && (l.discipline || 'Müzik') !== discipline) return false;
        if (status && status !== 'all' && l.status !== status) return false;
        if (q) {
          const hay = `${l.title} ${l.businessName} ${l.venueName} ${l.city} ${l.description}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

    const slice = visible.slice(offset, offset + limit);
    return res.json({
      ...buildPaginationEnvelope(slice, visible.length, page, limit),
      listings: slice,
    });
  });

  return router;
}
