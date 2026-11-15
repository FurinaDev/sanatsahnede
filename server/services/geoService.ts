import crypto from 'crypto';
import { DbInstance } from '../db/database';

export interface GeoPoint {
  latitude: number;
  longitude: number;
  displayName: string;
  provider: 'local_directory' | 'nominatim' | 'google_geocoding';
  cached: boolean;
}

export type ArtistLocationPrivacy = 'city_masked' | 'district_masked' | 'hidden';

export interface MaskedCoordinates {
  latitude: number | null;
  longitude: number | null;
  locationMasked: boolean;
  locationPrecision: 'district_approx' | 'city_approx' | 'hidden';
  privacyRadiusMeters: number;
}

const CITY_CENTER_COORDS: Record<string, { lat: number; lng: number; label: string }> = {
  istanbul: { lat: 41.0082, lng: 28.9784, label: 'İstanbul, Türkiye' },
  ankara: { lat: 39.9334, lng: 32.8597, label: 'Ankara, Türkiye' },
  izmir: { lat: 38.4237, lng: 27.1428, label: 'İzmir, Türkiye' },
  antalya: { lat: 36.8969, lng: 30.7133, label: 'Antalya, Türkiye' },
  bursa: { lat: 40.1885, lng: 29.061, label: 'Bursa, Türkiye' },
  eskisehir: { lat: 39.7767, lng: 30.5206, label: 'Eskişehir, Türkiye' },
  konya: { lat: 37.8746, lng: 32.4932, label: 'Konya, Türkiye' },
  adana: { lat: 37.0, lng: 35.3213, label: 'Adana, Türkiye' },
  kayseri: { lat: 38.7312, lng: 35.4787, label: 'Kayseri, Türkiye' },
  trabzon: { lat: 41.0027, lng: 39.7168, label: 'Trabzon, Türkiye' },
  diyarbakir: { lat: 37.9144, lng: 40.2306, label: 'Diyarbakır, Türkiye' },
  gaziantep: { lat: 37.0662, lng: 37.3833, label: 'Gaziantep, Türkiye' },
  mersin: { lat: 36.8121, lng: 34.6415, label: 'Mersin, Türkiye' },
  mugla: { lat: 37.2153, lng: 28.3636, label: 'Muğla, Türkiye' },
  bodrum: { lat: 37.0344, lng: 27.4305, label: 'Bodrum, Muğla' },
  samsun: { lat: 41.2867, lng: 36.33, label: 'Samsun, Türkiye' },
  canakkale: { lat: 40.1553, lng: 26.4142, label: 'Çanakkale, Türkiye' },
  nevsehir: { lat: 38.6244, lng: 34.7239, label: 'Nevşehir, Türkiye' },
};

const DISTRICT_COORDS: Record<string, { lat: number; lng: number; label: string }> = {
  'istanbul:kadikoy': { lat: 40.9903, lng: 29.0297, label: 'Kadıköy, İstanbul' },
  'istanbul:moda': { lat: 40.9822, lng: 29.0246, label: 'Moda, Kadıköy, İstanbul' },
  'istanbul:beyoglu': { lat: 41.0369, lng: 28.9775, label: 'Beyoğlu, İstanbul' },
  'istanbul:pera': { lat: 41.0318, lng: 28.9746, label: 'Pera, Beyoğlu, İstanbul' },
  'istanbul:besiktas': { lat: 41.043, lng: 29.0094, label: 'Beşiktaş, İstanbul' },
  'istanbul:sisli': { lat: 41.0602, lng: 28.9877, label: 'Şişli, İstanbul' },
  'istanbul:nisantasi': { lat: 41.0499, lng: 28.9942, label: 'Nişantaşı, Şişli, İstanbul' },
  'istanbul:sariyer': { lat: 41.1669, lng: 29.057, label: 'Sarıyer, İstanbul' },
  'istanbul:uskudar': { lat: 41.0235, lng: 29.0153, label: 'Üsküdar, İstanbul' },
  'istanbul:bakirkoy': { lat: 40.9799, lng: 28.8726, label: 'Bakırköy, İstanbul' },
  'istanbul:fatih': { lat: 41.0186, lng: 28.9497, label: 'Fatih, İstanbul' },
  'ankara:cankaya': { lat: 39.9032, lng: 32.8597, label: 'Çankaya, Ankara' },
  'ankara:altindag': { lat: 39.9397, lng: 32.8647, label: 'Altındağ, Ankara' },
  'ankara:yenimahalle': { lat: 39.9675, lng: 32.8103, label: 'Yenimahalle, Ankara' },
  'izmir:konak': { lat: 38.4189, lng: 27.1287, label: 'Konak, İzmir' },
  'izmir:alsancak': { lat: 38.4357, lng: 27.1422, label: 'Alsancak, Konak, İzmir' },
  'izmir:karsiyaka': { lat: 38.4602, lng: 27.1169, label: 'Karşıyaka, İzmir' },
  'izmir:bornova': { lat: 38.4622, lng: 27.2169, label: 'Bornova, İzmir' },
  'antalya:muratpasa': { lat: 36.8841, lng: 30.7056, label: 'Muratpaşa, Antalya' },
  'antalya:konyaalti': { lat: 36.8686, lng: 30.6378, label: 'Konyaaltı, Antalya' },
  'bursa:nilufer': { lat: 40.2116, lng: 28.9837, label: 'Nilüfer, Bursa' },
  'bursa:osmangazi': { lat: 40.1955, lng: 29.0601, label: 'Osmangazi, Bursa' },
};

export function normalizeTurkishGeoKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/İ/gi, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ');
}

export function resolveLocalTurkishCoordinates(city: string, district = '', query = ''): GeoPoint | null {
  const normCity = normalizeTurkishGeoKey(city);
  const normDistrict = normalizeTurkishGeoKey(district);
  const normQuery = normalizeTurkishGeoKey(query);

  if (normCity && normDistrict) {
    const exactDistrict = DISTRICT_COORDS[`${normCity}:${normDistrict}`];
    if (exactDistrict) {
      return {
        latitude: exactDistrict.lat,
        longitude: exactDistrict.lng,
        displayName: exactDistrict.label,
        provider: 'local_directory',
        cached: false,
      };
    }
  }

  for (const [key, coords] of Object.entries(DISTRICT_COORDS)) {
    const [, distKey] = key.split(':');
    if ((normDistrict && normDistrict.includes(distKey)) || (normQuery && normQuery.includes(distKey))) {
      return {
        latitude: coords.lat,
        longitude: coords.lng,
        displayName: coords.label,
        provider: 'local_directory',
        cached: false,
      };
    }
  }

  if (normCity && CITY_CENTER_COORDS[normCity]) {
    const c = CITY_CENTER_COORDS[normCity];
    return {
      latitude: c.lat,
      longitude: c.lng,
      displayName: c.label,
      provider: 'local_directory',
      cached: false,
    };
  }

  for (const [cityKey, coords] of Object.entries(CITY_CENTER_COORDS)) {
    if (normQuery.includes(cityKey)) {
      return {
        latitude: coords.lat,
        longitude: coords.lng,
        displayName: coords.label,
        provider: 'local_directory',
        cached: false,
      };
    }
  }

  return null;
}

/**
 * Deterministic coarse privacy masking for individual artists.
 * Applies a ~1.1km - 2.2km deterministic offset seeded by entityId so exact residential coordinates
 * are never exposed publicly while preserving map clustering within the artist's district/city.
 */
export function maskArtistCoordinates(params: {
  entityId: string;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  city?: string;
  district?: string;
  privacyMode?: ArtistLocationPrivacy;
}): MaskedCoordinates {
  const mode: ArtistLocationPrivacy = params.privacyMode || 'city_masked';
  if (mode === 'hidden') {
    return {
      latitude: null,
      longitude: null,
      locationMasked: true,
      locationPrecision: 'hidden',
      privacyRadiusMeters: 0,
    };
  }

  let baseLat = typeof params.latitude === 'number' && Number.isFinite(params.latitude) ? params.latitude : null;
  let baseLng = typeof params.longitude === 'number' && Number.isFinite(params.longitude) ? params.longitude : null;

  if (baseLat === null || baseLng === null) {
    const resolved = resolveLocalTurkishCoordinates(params.city || '', params.district || '');
    if (!resolved) {
      return {
        latitude: null,
        longitude: null,
        locationMasked: true,
        locationPrecision: 'hidden',
        privacyRadiusMeters: 0,
      };
    }
    baseLat = resolved.latitude;
    baseLng = resolved.longitude;
  }

  const hash = crypto.createHash('sha256').update(`ss-geo-mask:${params.entityId}`).digest();
  const angleRad = ((hash.readUInt16BE(0) / 65535) * Math.PI * 2);
  const radiusDeg = mode === 'district_masked' ? 0.011 + (hash[2] / 255) * 0.008 : 0.016 + (hash[2] / 255) * 0.012;

  const maskedLat = Number((baseLat + Math.sin(angleRad) * radiusDeg).toFixed(3));
  const maskedLng = Number((baseLng + Math.cos(angleRad) * radiusDeg).toFixed(3));

  return {
    latitude: maskedLat,
    longitude: maskedLng,
    locationMasked: true,
    locationPrecision: mode === 'district_masked' ? 'district_approx' : 'city_approx',
    privacyRadiusMeters: mode === 'district_masked' ? 1800 : 2800,
  };
}

export async function geocodeWithCache(
  db: DbInstance,
  params: { query?: string; city?: string; district?: string }
): Promise<GeoPoint> {
  const city = String(params.city || '').trim();
  const district = String(params.district || '').trim();
  const rawQuery = String(params.query || [district, city, 'Türkiye'].filter(Boolean).join(', ')).trim();
  const normalizedQuery = normalizeTurkishGeoKey(rawQuery || `${district} ${city}`);
  const queryKey = crypto.createHash('sha256').update(`${normalizedQuery}|${normalizeTurkishGeoKey(city)}|${normalizeTurkishGeoKey(district)}`).digest('hex');

  const nowIso = new Date().toISOString();
  const cachedRow = db
    .prepare('SELECT * FROM geo_cache WHERE query_key = ? AND expires_at > ?')
    .get(queryKey, nowIso) as any;

  if (cachedRow) {
    return {
      latitude: Number(cachedRow.latitude),
      longitude: Number(cachedRow.longitude),
      displayName: cachedRow.display_name,
      provider: cachedRow.provider,
      cached: true,
    };
  }

  let resolved: GeoPoint | null = null;

  // Optional external lookup if enabled and not in test mode
  const allowExternal =
    process.env.GEO_EXTERNAL_LOOKUP === 'true' && process.env.NODE_ENV !== 'test';
  if (allowExternal && rawQuery) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('q', rawQuery);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('countrycodes', 'tr');
      url.searchParams.set('limit', '1');
      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': 'SanatSahnede/1.0 (https://sanatsahnede.com)' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const items = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
        if (Array.isArray(items) && items.length > 0) {
          const lat = Number(items[0].lat);
          const lng = Number(items[0].lon);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            resolved = {
              latitude: Number(lat.toFixed(5)),
              longitude: Number(lng.toFixed(5)),
              displayName: items[0].display_name || rawQuery,
              provider: 'nominatim',
              cached: false,
            };
          }
        }
      }
    } catch {
      // Fallback cleanly to local Turkish city/district gazetteer
    }
  }

  if (!resolved) {
    resolved = resolveLocalTurkishCoordinates(city, district, rawQuery) || {
      latitude: 39.9334,
      longitude: 32.8597,
      displayName: city ? `${city}, Türkiye` : 'Türkiye',
      provider: 'local_directory',
      cached: false,
    };
  }

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO geo_cache (
      query_key, city, district, normalized_query, latitude, longitude, provider, display_name, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    queryKey,
    city,
    district,
    normalizedQuery,
    resolved.latitude,
    resolved.longitude,
    resolved.provider,
    resolved.displayName,
    expiresAt,
    nowIso
  );

  return resolved;
}
