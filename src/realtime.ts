import type { FeedMessage } from './feeds';
import type { Bus, StopEta } from './types';

/** Seconds past an arrival for which a bus still counts as "at the stop". */
export const PASSED_GRACE_SEC = 30;

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const DAY_SEC = 86400;
const HALF_DAY_SEC = 43200;
export const TRIP_MEMORY_SEC = 900;

/**
 * Correct a published stop time against the feed's own timestamp.
 *
 * Calgary's trip updates are sometimes stamped a whole day off (in the evening the
 * service date appears to be taken in UTC), and occasionally carry garbage like 0.
 * Shift by one day when more than 12 h off; drop anything still implausible.
 */
export function normalizeTime(t: number, refSec: number | null): number | null {
  if (refSec == null) return t;
  const d = t - refSec;
  if (Math.abs(d) <= HALF_DAY_SEC) return t;
  const shifted = t - Math.sign(d) * DAY_SEC; // only the observed ±1 day error is corrected
  return Math.abs(shifted - refSec) <= HALF_DAY_SEC ? shifted : null;
}

/**
 * Remembers trip updates across polls. The published file is often truncated, so a
 * trip present in one poll can be missing from the next; keep its last copy for
 * TRIP_MEMORY_SEC so its bus keeps a route and ETAs.
 */
export function createTripMemory(maxAgeSec = TRIP_MEMORY_SEC) {
  const seen = new Map<string, { entity: NonNullable<FeedMessage['entity']>[number]; at: number }>();
  return {
    merge(tu: FeedMessage, nowSec: number): FeedMessage {
      for (const e of tu.entity ?? []) {
        const id = e.tripUpdate?.trip?.tripId;
        if (id) seen.set(id, { entity: e, at: nowSec });
      }
      for (const [id, v] of seen) if (nowSec - v.at > maxAgeSec) seen.delete(id);
      return { header: tu.header, entity: [...seen.values()].map((v) => v.entity) };
    },
  };
}

/** Join vehicle positions with trip updates on tripId, keeping only the selected routes. */
export function buildBuses(vp: FeedMessage, tu: FeedMessage, routes: string[]): Bus[] {
  const wanted = new Set(routes);
  const ref = num(tu.header?.timestamp) || null;
  const trips = new Map<string, { routeId: string; stopEtas: Map<string, StopEta[]> }>();

  for (const e of tu.entity ?? []) {
    const t = e.tripUpdate;
    const tripId = t?.trip?.tripId;
    const routeId = t?.trip?.routeId;
    if (!t || !tripId || !routeId || !wanted.has(routeId)) continue;
    const stopEtas = new Map<string, StopEta[]>();
    for (const u of t.stopTimeUpdate ?? []) {
      const raw = num(u.arrival?.time) ?? num(u.departure?.time);
      const time = raw == null ? null : normalizeTime(raw, ref);
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
