import type { FeedMessage } from './feeds';
import type { Bus, StopEta } from './types';

/** Seconds past an arrival for which a bus still counts as "at the stop". */
export const PASSED_GRACE_SEC = 30;

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Join vehicle positions with trip updates on tripId, keeping only the selected routes. */
export function buildBuses(vp: FeedMessage, tu: FeedMessage, routes: string[]): Bus[] {
  const wanted = new Set(routes);
  const trips = new Map<string, { routeId: string; stopEtas: Map<string, StopEta[]> }>();

  for (const e of tu.entity ?? []) {
    const t = e.tripUpdate;
    const tripId = t?.trip?.tripId;
    const routeId = t?.trip?.routeId;
    if (!t || !tripId || !routeId || !wanted.has(routeId)) continue;
    const stopEtas = new Map<string, StopEta[]>();
    for (const u of t.stopTimeUpdate ?? []) {
      const time = num(u.arrival?.time) ?? num(u.departure?.time);
      if (!u.stopId || time == null) continue;
      const list = stopEtas.get(u.stopId) ?? [];
      list.push({ seq: num(u.stopSequence) ?? 0, time });
      stopEtas.set(u.stopId, list);
    }
    for (const list of stopEtas.values()) list.sort((a, b) => a.seq - b.seq);
    trips.set(tripId, { routeId, stopEtas });
  }

  const buses: Bus[] = [];
  for (const e of vp.entity ?? []) {
    const v = e.vehicle;
    const tripId = v?.trip?.tripId;
    const trip = tripId ? trips.get(tripId) : undefined;
    const lat = num(v?.position?.latitude);
    const lon = num(v?.position?.longitude);
    if (!v || !tripId || !trip || lat == null || lon == null) continue;
    buses.push({
      vehicleId: v.vehicle?.id ?? e.id ?? tripId,
      tripId,
      routeId: trip.routeId,
      pos: { lat, lon },
      updatedAt: num(v.timestamp) ?? 0,
      stopEtas: trip.stopEtas,
    });
  }
  return buses;
}

/** Earliest visit to `stopId` that is not more than PASSED_GRACE_SEC in the past, or null. */
export function nextArrival(bus: Bus, stopId: string, nowSec: number): number | null {
  for (const s of bus.stopEtas.get(stopId) ?? []) {
    if (s.time >= nowSec - PASSED_GRACE_SEC) return s.time;
  }
  return null;
}
