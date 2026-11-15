import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  getActiveMapProvider,
  getTurkeyDefaultCenter,
  MapMarker,
} from '../../services/mapProvider';
import { Shield, MapPin } from 'lucide-react';

interface InteractiveMapProps {
  markers: MapMarker[];
  center?: [number, number];
  zoom?: number;
  heightClassName?: string;
  onSelectMarker?: (marker: MapMarker) => void;
  hasGoogleMapsKey?: boolean;
  privacyNotice?: string;
  ariaLabel?: string;
}

function escapeHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const InteractiveMap: React.FC<InteractiveMapProps> = ({
  markers,
  center,
  zoom,
  heightClassName = 'h-80 sm:h-96',
  onSelectMarker,
  hasGoogleMapsKey = false,
  privacyNotice,
  ariaLabel = 'Etkileşimli Sanat ve Etkinlik Haritası',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelectMarker);
  onSelectRef.current = onSelectMarker;

  const [tileOfflineWarning, setTileOfflineWarning] = useState(false);
  const provider = getActiveMapProvider(hasGoogleMapsKey);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialCenter = center || getTurkeyDefaultCenter();
    const initialZoom = zoom ?? (markers.length === 1 ? 13 : 6);

    const map = L.map(containerRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      zoomControl: true,
      scrollWheelZoom: false,
    });

    const tileLayer = L.tileLayer(provider.tileUrl, {
      attribution: provider.attribution,
      maxZoom: provider.maxZoom,
    });
    let tileErrors = 0;
    tileLayer.on('tileerror', () => {
      tileErrors += 1;
      if (tileErrors >= 3) {
        setTileOfflineWarning(true);
      }
    });
    tileLayer.on('tileload', () => {
      setTileOfflineWarning(false);
    });
    tileLayer.addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    const validMarkers = markers.filter(
      (m) => Number.isFinite(m.latitude) && Number.isFinite(m.longitude)
    );

    for (const marker of validMarkers) {
      if (marker.isMasked && marker.privacyRadiusMeters && marker.privacyRadiusMeters > 0) {
        L.circle([marker.latitude, marker.longitude], {
          radius: marker.privacyRadiusMeters,
          color: '#f25922',
          weight: 1.5,
          opacity: 0.75,
          fillColor: '#f25922',
          fillOpacity: 0.14,
        }).addTo(group);
      }

      const bgColor = marker.active
        ? '#f25922'
        : marker.kind === 'artist'
        ? '#1e3a8a'
        : '#16274e';

      const iconHtml = `
        <div style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:9999px;background:${bgColor};color:#ffffff;font-family:Poppins,sans-serif;font-size:11px;font-weight:700;white-space:nowrap;border:2px solid #ffffff;box-shadow:0 4px 12px rgba(15,23,42,0.28);transform:translate(-50%,-50%);cursor:pointer;">
          <span style="display:inline-block;width:7px;height:7px;border-radius:9999px;background:${marker.active ? '#ffffff' : '#f25922'};"></span>
          <span>${escapeHtml(marker.badge || marker.title.slice(0, 18))}</span>
        </div>
      `;

      const leafletIcon = L.divIcon({
        html: iconHtml,
        className: 'ss-leaflet-pin',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const lMarker = L.marker([marker.latitude, marker.longitude], { icon: leafletIcon });

      const popupLines = [
        `<div style="font-family:Poppins,sans-serif;min-width:160px;line-height:1.4;">`,
        `<div style="font-weight:700;font-size:12px;color:#0f172a;">${escapeHtml(marker.title)}</div>`,
        marker.subtitle
          ? `<div style="font-size:11px;color:#475569;margin-top:2px;">${escapeHtml(marker.subtitle)}</div>`
          : '',
        marker.isMasked
          ? `<div style="font-size:10px;color:#b45309;margin-top:4px;font-weight:600;">Yaklaşık bölge (gizlilik korumalı)</div>`
          : '',
        `</div>`,
      ].join('');

      lMarker.bindPopup(popupLines);
      lMarker.on('click', () => {
        if (onSelectRef.current) {
          onSelectRef.current(marker);
        }
      });

      lMarker.addTo(group);
    }

    if (center) {
      map.setView(center, zoom ?? (validMarkers.length <= 1 ? 13 : 10), { animate: false });
    } else if (validMarkers.length === 1) {
      map.setView([validMarkers[0].latitude, validMarkers[0].longitude], zoom ?? 13, {
        animate: false,
      });
    } else if (validMarkers.length > 1) {
      const bounds = L.latLngBounds(validMarkers.map((m) => [m.latitude, m.longitude] as [number, number]));
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 12, animate: false });
    } else {
      map.setView(getTurkeyDefaultCenter(), 6, { animate: false });
    }
  }, [markers, center?.[0], center?.[1], zoom]);

  return (
    <div className="space-y-2">
      <div
        className={`relative w-full ${heightClassName} rounded-2xl overflow-hidden border border-[#e2e8f0] dark:border-[#1e335a] bg-[#0f1c38] z-0`}
        data-testid="interactive-map"
      >
        <div
          ref={containerRef}
          className="w-full h-full z-0"
          role="region"
          aria-label={ariaLabel}
        />

        <div className="pointer-events-none absolute top-2.5 right-2.5 z-[400] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/95 dark:bg-[#13213e]/95 border border-[#e2e8f0] dark:border-[#1e335a] text-[10px] font-bold text-[#16274e] dark:text-slate-200 shadow-xs">
          <MapPin className="w-3 h-3 text-[#f25922]" />
          <span>{provider.label}</span>
        </div>

        {tileOfflineWarning && (
          <div className="pointer-events-none absolute bottom-2.5 left-2.5 z-[400] px-2.5 py-1 rounded-lg bg-amber-50/95 border border-amber-200 text-[10px] font-semibold text-amber-900 shadow-xs">
            Harita karo sunucusuna geçici olarak ulaşılamıyor; konum işaretçileri aktif.
          </div>
        )}
      </div>

      {privacyNotice && (
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#475569] dark:text-slate-300">
          <Shield className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{privacyNotice}</span>
        </div>
      )}
    </div>
  );
};
