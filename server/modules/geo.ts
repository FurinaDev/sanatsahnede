import { Router } from 'express';
import { DbInstance } from '../db/database';
import { AuthedRequest } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rateLimit';
import { mapEvent, mapIndividualProfile, mapVenue } from '../db/mappers';
import { geocodeWithCache, resolveLocalTurkishCoordinates } from '../services/geoService';

export function createGeoRouter(db: DbInstance): Router {
  const router = Router();
  const geocodeLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 45,
    message: 'Çok fazla konum sorgusu yapıldı. Lütfen kısa süre sonra tekrar deneyin.',
  });

  router.get('/geocode', geocodeLimiter, async (req, res) => {
    const q = String(req.query.q || '').trim();
    const city = String(req.query.city || '').trim();
    const district = String(req.query.district || '').trim();

    if (!q && !city) {
      return res.status(400).json({ error: 'Konum sorgusu için q veya city parametresi gereklidir.' });
    }

    const result = await geocodeWithCache(db, { query: q, city, district });
    return res.json(result);
  });

  router.get('/map-points', (req: AuthedRequest, res) => {
    const isStaff =
      req.user &&
      ['admin', 'moderator', 'verification_officer'].includes(req.user.activeRole);
    const cityFilter = String(req.query.city || '').trim();
    const typeFilter = String(req.query.type || 'all').trim();

    const points: Array<{
      id: string;
      kind: 'event' | 'venue' | 'artist' | 'business';
      title: string;
      subtitle: string;
      city: string;
      district?: string;
      latitude: number;
      longitude: number;
      locationMasked: boolean;
      privacyRadiusMeters?: number;
      targetView: string;
      entityId: string;
      meta?: Record<string, any>;
    }> = [];

    if (typeFilter === 'all' || typeFilter === 'events') {
      const eventRows = db.prepare('SELECT * FROM events ORDER BY event_date ASC').all() as any[];
      for (const row of eventRows) {
        if (!isStaff && row.status !== 'published' && (!req.user || row.creator_user_id !== req.user.id)) {
          continue;
        }
        if (cityFilter && cityFilter !== 'Tümü' && row.city !== cityFilter) continue;
        const mapped = mapEvent(row);
        if (typeof mapped.latitude === 'number' && typeof mapped.longitude === 'number') {
          points.push({
            id: `pt_${mapped.id}`,
            kind: 'event',
            title: mapped.title,
            subtitle: `${mapped.venueName} · ${mapped.eventDate}`,
            city: mapped.city,
            district: mapped.district,
            latitude: mapped.latitude,
            longitude: mapped.longitude,
            locationMasked: false,
            targetView: 'event_detail',
            entityId: mapped.id,
            meta: {
              category: mapped.category,
              isFree: mapped.isFree,
              ticketPrice: mapped.ticketPrice,
            },
          });
        }
      }
    }

    if (typeFilter === 'all' || typeFilter === 'venues') {
      const venueRows = db.prepare('SELECT * FROM venues ORDER BY created_at DESC').all() as any[];
      for (const row of venueRows) {
        if (cityFilter && cityFilter !== 'Tümü' && row.city !== cityFilter) continue;
        const mapped = mapVenue(db, row);
        const coords =
          row.latitude != null && row.longitude != null
            ? { latitude: Number(row.latitude), longitude: Number(row.longitude) }
            : resolveLocalTurkishCoordinates(mapped.city, mapped.district);
        if (coords) {
          points.push({
            id: `pt_${mapped.id}`,
            kind: 'venue',
            title: mapped.name,
            subtitle: `${mapped.district}, ${mapped.city}`,
            city: mapped.city,
            district: mapped.district,
            latitude: coords.latitude,
            longitude: coords.longitude,
            locationMasked: false,
            targetView: 'open_stage',
            entityId: mapped.id,
          });
        }
      }
    }

    if (typeFilter === 'all' || typeFilter === 'artists') {
      const artistRows = db.prepare('SELECT * FROM individual_profiles ORDER BY rating_avg DESC').all() as any[];
      for (const row of artistRows) {
        if (cityFilter && cityFilter !== 'Tümü' && row.city !== cityFilter) continue;
        const mapped = mapIndividualProfile(row);
        if (typeof mapped.latitude === 'number' && typeof mapped.longitude === 'number') {
          points.push({
            id: `pt_${mapped.id}`,
            kind: 'artist',
            title: mapped.fullName,
            subtitle: `${mapped.title} · ${mapped.district ? `${mapped.district}, ` : ''}${mapped.city}`,
            city: mapped.city,
            district: mapped.district,
            latitude: mapped.latitude,
            longitude: mapped.longitude,
            locationMasked: true,
            privacyRadiusMeters: mapped.locationPrecision === 'district_approx' ? 1800 : 2800,
            targetView: 'artist_profile',
            entityId: mapped.id,
            meta: {
              discipline: mapped.discipline,
              isVerified: mapped.isVerified,
              locationPrecision: mapped.locationPrecision,
            },
          });
        }
      }
    }

    return res.json({ points });
  });

  return router;
}
