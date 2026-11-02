import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './map.css';
import type { Bus, LatLon, Place, Stop } from './types';

export type BusMarkerItem = { bus: Bus; label: string; dim: boolean; stale: boolean };

export type RouteShape = { route: string; lines: LatLon[][] };

export type MapView = {
  setUser(p: LatLon | null, accuracyM?: number): void;
  setPlaces(home: Place | null, work: Place | null): void;
  setStops(stops: Stop[]): void;
  /** Draw each route's path in its route colour, beneath all markers. */
  setRoutes(shapes: RouteShape[]): void;
  setBuses(items: BusMarkerItem[]): void;
  recenter(): void;
  fitTo(points: LatLon[]): void;
  /** Show a draggable pin; map taps also move it. Returns a function that removes it. */
  enablePinPick(initial: LatLon, onMove: (p: LatLon) => void): () => void;
};

const CALGARY: L.LatLngTuple = [51.0447, -114.0719];
const ll = (p: LatLon): L.LatLngTuple => [p.lat, p.lon];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Stable, distinguishable colour per route number. */
export function routeColor(route: string): string {
  let h = 0;
  for (const ch of route) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${(h * 137) % 360} 70% 38%)`;
}

const icon = (cls: string, html: string) => L.divIcon({ className: cls, html, iconSize: undefined });

export function createMap(el: HTMLElement): MapView {
  const map = L.map(el, { zoomControl: false, attributionControl: true }).setView(CALGARY, 13);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Data: City of Calgary',
  }).addTo(map);

  // Route lines sit above tiles but below every marker (overlayPane is 400, markers 600).
  map.createPane('routes').style.zIndex = '350';
  const routeLines = L.layerGroup().addTo(map);

  let user: { dot: L.CircleMarker; ring: L.Circle } | null = null;
  let userPos: LatLon | null = null;
  let centredOnce = false;
  const places = L.layerGroup().addTo(map);
  const stops = L.layerGroup().addTo(map);
  const busMarkers = new Map<string, L.Marker>();

  return {
    setUser(p, accuracyM = 0) {
      userPos = p;
      if (!p) {
        user?.dot.remove();
        user?.ring.remove();
        user = null;
        return;
      }
      if (!user) {
        user = {
          ring: L.circle(ll(p), { radius: accuracyM, className: 'user-ring', interactive: false }).addTo(map),
          dot: L.circleMarker(ll(p), { radius: 8, className: 'user-dot', interactive: false }).addTo(map),
        };
      } else {
        user.dot.setLatLng(ll(p));
        user.ring.setLatLng(ll(p)).setRadius(accuracyM);
      }
      if (!centredOnce) {
        centredOnce = true;
        map.setView(ll(p), 15);
      }
    },

    setPlaces(home, work) {
      places.clearLayers();
      if (home) L.marker(ll(home), { icon: icon('place-icon', '🏠'), title: 'Home', keyboard: false }).addTo(places);
      if (work) L.marker(ll(work), { icon: icon('place-icon', '💼'), title: 'Work', keyboard: false }).addTo(places);
    },

    setStops(list) {
      stops.clearLayers();
      for (const s of list) {
        L.marker(ll(s.pos), {
          icon: icon('stop-icon', `<span style="--c:${routeColor(s.route)}">${esc(s.route)}</span>`),
          title: s.name,
        })
          .bindTooltip(esc(s.name), { direction: 'bottom', offset: [0, 10], className: 'stop-tip' })
          .addTo(stops);
      }
    },

    setRoutes(shapes) {
      routeLines.clearLayers();
      for (const { route, lines } of shapes) {
        const latlngs = lines.map((line) => line.map(ll));
        const common = { pane: 'routes', interactive: false, lineCap: 'round', lineJoin: 'round' } as const;
        L.polyline(latlngs, { ...common, color: '#ffffff', weight: 8, opacity: 0.85 }).addTo(routeLines);
        L.polyline(latlngs, { ...common, color: routeColor(route), weight: 5, opacity: 0.75 }).addTo(routeLines);
      }
    },

    setBuses(items) {
      const seen = new Set<string>();
      for (const { bus, label, dim, stale } of items) {
        seen.add(bus.vehicleId);
        const cls = `bus-icon${dim ? ' is-dim' : ''}${stale ? ' is-stale' : ''}`;
        const html =
          `<span class="bus-eta">${esc(label)}${stale ? ' · stale' : ''}</span>` +
          `<span class="bus-route" style="--c:${routeColor(bus.routeId)}">${esc(bus.routeId)}</span>`;
        const existing = busMarkers.get(bus.vehicleId);
        if (existing) {
          existing.setLatLng(ll(bus.pos));
          existing.setIcon(icon(cls, html));
        } else {
          busMarkers.set(
            bus.vehicleId,
            L.marker(ll(bus.pos), { icon: icon(cls, html), title: `Route ${bus.routeId}`, zIndexOffset: 500 }).addTo(map),
          );
        }
      }
      for (const [id, m] of busMarkers) {
        if (!seen.has(id)) {
          m.remove();
          busMarkers.delete(id);
        }
      }
    },

    recenter() {
      if (userPos) map.setView(ll(userPos), Math.max(map.getZoom(), 15));
    },

    fitTo(points) {
      if (!points.length) return;
      if (points.length === 1) map.setView(ll(points[0]), 16);
      else map.fitBounds(L.latLngBounds(points.map(ll)), { padding: [60, 60], maxZoom: 16 });
    },

    enablePinPick(initial, onMove) {
      const pin = L.marker(ll(initial), { draggable: true, icon: icon('pick-icon', '📍'), zIndexOffset: 1000 }).addTo(map);
      map.setView(ll(initial), Math.max(map.getZoom(), 16));
      const emit = () => {
        const p = pin.getLatLng();
        onMove({ lat: p.lat, lon: p.lng });
      };
      const onClick = (e: L.LeafletMouseEvent) => {
        pin.setLatLng(e.latlng);
        emit();
      };
      pin.on('dragend', emit);
      map.on('click', onClick);
      return () => {
        map.off('click', onClick);
        pin.remove();
      };
    },
  };
}
