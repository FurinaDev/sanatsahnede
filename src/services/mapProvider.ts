export type MapProviderId = 'leaflet-osm' | 'google-maps';

export interface MapMarker {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  latitude: number;
  longitude: number;
  kind?: 'event' | 'venue' | 'artist' | 'business' | 'listing';
  isMasked?: boolean;
  privacyRadiusMeters?: number;
  active?: boolean;
}

export interface MapProviderConfig {
  id: MapProviderId;
  label: string;
  tileUrl: string;
  attribution: string;
  maxZoom: number;
}

const TURKEY_DEFAULT_CENTER: [number, number] = [39.15, 35.25];

export function getActiveMapProvider(hasGoogleMapsKey = false): MapProviderConfig {
  // Primary interactive adapter uses OpenStreetMap + Leaflet (zero-key, open-source).
  // Google Maps JS can be switched in here once a billing-enabled Maps JS key is activated.
  void hasGoogleMapsKey;
  return {
    id: 'leaflet-osm',
    label: 'OpenStreetMap (Leaflet)',
    tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap katkıda bulunanlar',
    maxZoom: 18,
  };
}

export function getTurkeyDefaultCenter(): [number, number] {
  return TURKEY_DEFAULT_CENTER;
}

export const CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
  İstanbul: { lat: 41.0082, lng: 28.9784 },
  Ankara: { lat: 39.9334, lng: 32.8597 },
  İzmir: { lat: 38.4237, lng: 27.1428 },
  Antalya: { lat: 36.8969, lng: 30.7133 },
  Bursa: { lat: 40.1885, lng: 29.061 },
  Eskişehir: { lat: 39.7767, lng: 30.5206 },
  Konya: { lat: 37.8746, lng: 32.4932 },
  Adana: { lat: 37.0, lng: 35.3213 },
  Kayseri: { lat: 38.7312, lng: 35.4787 },
  Trabzon: { lat: 41.0027, lng: 39.7168 },
  Diyarbakır: { lat: 37.9144, lng: 40.2306 },
  Gaziantep: { lat: 37.0662, lng: 37.3833 },
  Mersin: { lat: 36.8121, lng: 34.6415 },
  Muğla: { lat: 37.2153, lng: 28.3636 },
};
