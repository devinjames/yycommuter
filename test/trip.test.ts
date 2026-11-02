import { describe, expect, it } from 'vitest';
import { chooseDirection, computeRouteStatus, formatEta, leaveText, levelFor, selectDepartureStop } from '../src/trip';
import type { Bus, LatLon, Place, Stop } from '../src/types';

const NOW = 1_793_580_000;
const home: Place = { lat: 51.1, lon: -114.1, label: 'Home' };
const work: Place = { lat: 51.04, lon: -114.06, label: 'Work' };
/** Point `m` metres north of `p`. */
const north = (p: LatLon, m: number): LatLon => ({ lat: p.lat + m / 111195, lon: p.lon });
const stop = (id: string, pos: LatLon, route = '3'): Stop => ({ id, name: `Stop ${id}`, route, pos });
const bus = (vehicleId: string, etas: Array<[string, number, number]>, routeId = '3'): Bus => {
  const stopEtas = new Map<string, { seq: number; time: number }[]>();
  for (const [id, seq, time] of etas) stopEtas.set(id, [...(stopEtas.get(id) ?? []), { seq, time }]);
  return { vehicleId, tripId: `trip-${vehicleId}`, routeId, pos: north(home, 2000), updatedAt: NOW - 10, stopEtas };
};

describe('chooseDirection', () => {
  it('goes to work when the user is near home', () => expect(chooseDirection(north(home, 50), home, work, null)).toBe('toWork'));
  it('goes home when the user is near work', () => expect(chooseDirection(north(work, 50), home, work, null)).toBe('toHome'));
  it('respects a manual override', () => expect(chooseDirection(north(home, 50), home, work, 'toHome')).toBe('toHome'));
  it('defaults to work without a location', () => expect(chooseDirection(null, home, work, null)).toBe('toWork'));
});

describe('selectDepartureStop', () => {
  const A = stop('A', north(home, 100)); // nearest, but wrong direction
  const B = stop('B', north(home, 300));
  const D = stop('D', north(work, 100));

  it('skips the nearest stop when live trips show it is the wrong direction', () => {
    const b = bus('v1', [['B', 5, NOW + 60], ['D', 10, NOW + 900], ['A', 20, NOW + 1200]]);
    expect(selectDepartureStop('3', [A, B], [D], [b], undefined, home)).toEqual({ stop: B, verified: true });
  });
  it('ignores buses on other routes when validating', () => {
    const other = bus('v9', [['A', 1, NOW + 60], ['D', 2, NOW + 120]], '36');
    expect(selectDepartureStop('3', [A, B], [D], [other], undefined, home)).toEqual({ stop: A, verified: false });
  });
  it('falls back to the cached stop when nothing validates', () => {
    expect(selectDepartureStop('3', [A, B], [D], [], 'B', home)).toEqual({ stop: B, verified: false });
  });
  it('falls back to the nearest stop with no cache', () => {
    expect(selectDepartureStop('3', [B, A], [D], [], undefined, home)).toEqual({ stop: A, verified: false });
  });
  it('returns null when there are no origin stops', () => {
    expect(selectDepartureStop('3', [], [D], [], 'B', home)).toBeNull();
  });
  it('does not validate a stop against itself when origin and destination areas overlap', () => {
    const loop = bus('v1', [['A', 5, NOW + 60], ['A', 40, NOW + 1800]]);
    expect(selectDepartureStop('3', [A], [A], [loop], undefined, home)).toEqual({ stop: A, verified: false });
  });
});

describe('levelFor', () => {
  it.each([
    [2.5, 'green'],
    [2, 'amber'],
    [0, 'amber'],
    [-0.1, 'red'],
  ] as const)('%s min → %s', (min, level) => expect(levelFor(min)).toBe(level));
});

describe('formatEta', () => {
  it('shows Due under a minute, including just-past arrivals', () => {
    expect(formatEta(59)).toBe('Due');
    expect(formatEta(-20)).toBe('Due');
  });
  it('rounds to whole minutes', () => expect(formatEta(540)).toBe('9 min'));
});

describe('computeRouteStatus', () => {
  const S = stop('S', home);
  const user = north(home, 400);

  it('computes walk time and leave-in from the user location', () => {
    const r = computeRouteStatus('3', S, true, [bus('v1', [['S', 1, NOW + 540]])], user, home, NOW);
    expect(r.walkMin).toBeCloseTo(6.24, 1);
    expect(r.next!.etaSec).toBe(540);
    expect(r.next!.leaveInMin).toBeCloseTo(2.76, 1);
    expect(r.next!.level).toBe('green');
    expect(r.following).toBeNull();
  });
  it('walks from the origin when location is unknown', () => {
    const r = computeRouteStatus('3', S, true, [bus('v1', [['S', 1, NOW + 540]])], null, home, NOW);
    expect(r.walkMin).toBe(0);
  });
  it('includes a bus that arrived up to 30 s ago and excludes older ones', () => {
    const r = computeRouteStatus('3', S, true, [bus('v1', [['S', 1, NOW - 20]]), bus('v2', [['S', 1, NOW - 60]])], home, home, NOW);
    expect(r.next!.bus.vehicleId).toBe('v1');
    expect(formatEta(r.next!.etaSec)).toBe('Due');
  });
  it('sorts by ETA and shows the following bus when the next is missed', () => {
    const r = computeRouteStatus('3', S, true, [bus('late', [['S', 1, NOW + 900]]), bus('soon', [['S', 1, NOW + 120]])], user, home, NOW);
    expect(r.next!.bus.vehicleId).toBe('soon');
    expect(r.next!.level).toBe('red');
    expect(r.following!.bus.vehicleId).toBe('late');
  });
  it('reports noBuses when no live bus serves the stop', () => {
    const r = computeRouteStatus('3', S, true, [], user, home, NOW);
    expect(r).toMatchObject({ reason: 'noBuses', next: null, following: null });
  });
  it('reports noStops when there is no departure stop', () => {
    expect(computeRouteStatus('3', null, false, [], user, home, NOW)).toMatchObject({ reason: 'noStops', next: null });
  });
});

describe('leaveText', () => {
  const eta = (leaveInMin: number, etaSec = 600) => ({ bus: bus('v', []), etaSec, leaveInMin, level: levelFor(leaveInMin) });
  it('floors minutes to stay conservative', () => expect(leaveText(eta(3.9), null)).toBe('Leave in 3 min'));
  it('says Leave now under a minute', () => expect(leaveText(eta(0.4), null)).toBe('Leave now'));
  it('says Missed with the following bus ETA', () => expect(leaveText(eta(-1), eta(10, 840))).toBe('Missed — next in 14 min'));
  it('says Missed when there is no following bus', () => expect(leaveText(eta(-1), null)).toBe('Missed'));
});
