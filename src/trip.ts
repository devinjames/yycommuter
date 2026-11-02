import { haversineM, walkMinutes } from './geo';
import { nextArrival } from './realtime';
import type { Bus, Direction, LatLon, Place, Stop } from './types';

export type Level = 'green' | 'amber' | 'red';
export type BusEta = { bus: Bus; etaSec: number; leaveInMin: number; level: Level };
export type RouteStatus = {
  route: string;
  stop: Stop | null;
  verified: boolean;
  next: BusEta | null;
  following: BusEta | null;
  walkMin: number;
  reason?: 'noStops' | 'noBuses';
};

/** Origin is the saved place nearer the user; an explicit override always wins. */
export function chooseDirection(user: LatLon | null, home: Place, work: Place, override: Direction | null): Direction {
  if (override) return override;
  if (!user) return 'toWork';
  return haversineM(user, home) <= haversineM(user, work) ? 'toWork' : 'toHome';
}

/** True if some bus on `route` visits `origin` before a (different) destination stop. */
function servesTowards(route: string, origin: Stop, destStops: Stop[], buses: Bus[]): boolean {
  for (const b of buses) {
    if (b.routeId !== route) continue;
    const o = b.stopEtas.get(origin.id);
    if (!o?.length) continue;
    const firstOrigin = o[0].seq;
    for (const d of destStops) {
      if (d.id === origin.id) continue;
      if (b.stopEtas.get(d.id)?.some((x) => x.seq > firstOrigin)) return true;
    }
  }
  return false;
}

export function selectDepartureStop(
  route: string,
  originStops: Stop[],
  destStops: Stop[],
  buses: Bus[],
  cached: string | undefined,
  origin: LatLon,
): { stop: Stop; verified: boolean } | null {
  if (!originStops.length) return null;
  const byDistance = [...originStops].sort((a, b) => haversineM(origin, a.pos) - haversineM(origin, b.pos));
  const valid = byDistance.find((s) => servesTowards(route, s, destStops, buses));
  if (valid) return { stop: valid, verified: true };
  const fromCache = cached ? byDistance.find((s) => s.id === cached) : undefined;
  return { stop: fromCache ?? byDistance[0], verified: false };
}

export function levelFor(leaveInMin: number): Level {
  if (leaveInMin > 2) return 'green';
  if (leaveInMin >= 0) return 'amber';
  return 'red';
}

export function formatEta(etaSec: number): string {
  return etaSec < 60 ? 'Due' : `${Math.round(etaSec / 60)} min`;
}

export function computeRouteStatus(
  route: string,
  stop: Stop | null,
  verified: boolean,
  buses: Bus[],
  user: LatLon | null,
  origin: LatLon,
  nowSec: number,
): RouteStatus {
  if (!stop) return { route, stop, verified, next: null, following: null, walkMin: 0, reason: 'noStops' };
  const walkMin = walkMinutes(user ?? origin, stop.pos);
  const etas: BusEta[] = [];
  for (const bus of buses) {
    if (bus.routeId !== route) continue;
    const t = nextArrival(bus, stop.id, nowSec);
    if (t == null) continue;
    const etaSec = t - nowSec;
    const leaveInMin = etaSec / 60 - walkMin;
    etas.push({ bus, etaSec, leaveInMin, level: levelFor(leaveInMin) });
  }
  etas.sort((a, b) => a.etaSec - b.etaSec);
  const next = etas[0] ?? null;
  const following = next?.level === 'red' ? (etas[1] ?? null) : null;
  return { route, stop, verified, next, following, walkMin, ...(next ? {} : { reason: 'noBuses' as const }) };
}
