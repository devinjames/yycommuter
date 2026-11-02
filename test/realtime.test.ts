import { describe, expect, it } from 'vitest';
import type { FeedMessage } from '../src/feeds';
import { buildBuses, nextArrival } from '../src/realtime';

const NOW = 1_793_580_000;

const vehicle = (tripId: string, vehicleId: string, withPos = true) => ({
  id: vehicleId,
  vehicle: {
    trip: { tripId },
    vehicle: { id: vehicleId },
    timestamp: NOW - 15,
    ...(withPos ? { position: { latitude: 51.05, longitude: -114.07 } } : {}),
  },
});
const tripUpdate = (tripId: string, routeId: string, stops: Array<[string, number, number]>) => ({
  id: tripId,
  tripUpdate: {
    trip: { tripId, routeId },
    stopTimeUpdate: stops.map(([stopId, seq, time]) => ({ stopId, stopSequence: seq, arrival: { time } })),
  },
});

const vp = (...e: unknown[]) => ({ entity: e }) as FeedMessage;
const tu = vp;

describe('buildBuses', () => {
  it('keeps only buses on the selected routes', () => {
    const buses = buildBuses(
      vp(vehicle('t3', 'v1'), vehicle('t36', 'v2')),
      tu(tripUpdate('t3', '3', [['1001', 1, NOW + 60]]), tripUpdate('t36', '36', [['2002', 1, NOW + 60]])),
      ['3'],
    );
    expect(buses.map((b) => [b.vehicleId, b.routeId])).toEqual([['v1', '3']]);
  });
  it('excludes vehicles without a matching trip update or without a position', () => {
    const buses = buildBuses(
      vp(vehicle('orphan', 'v1'), vehicle('t3', 'v2', false)),
      tu(tripUpdate('t3', '3', [['1001', 1, NOW + 60]])),
      ['3'],
    );
    expect(buses).toEqual([]);
  });
  it('maps position, timestamp and stop ETAs', () => {
    const [bus] = buildBuses(vp(vehicle('t3', 'v1')), tu(tripUpdate('t3', '3', [['1001', 4, NOW + 60]])), ['3']);
    expect(bus.pos.lat).toBeCloseTo(51.05);
    expect(bus.pos.lon).toBeCloseTo(-114.07);
    expect(bus.updatedAt).toBe(NOW - 15);
    expect(bus.stopEtas.get('1001')).toEqual([{ seq: 4, time: NOW + 60 }]);
  });
  it('converts protobuf Long-like int64 values with Number()', () => {
    const longLike = { low: NOW + 60, high: 0, toNumber: () => NOW + 60, valueOf: () => NOW + 60 };
    const msg = tu({
      tripUpdate: { trip: { tripId: 't3', routeId: '3' }, stopTimeUpdate: [{ stopId: '1001', stopSequence: 1, arrival: { time: longLike } }] },
    });
    const [bus] = buildBuses(vp(vehicle('t3', 'v1')), msg, ['3']);
    expect(bus.stopEtas.get('1001')![0].time).toBe(NOW + 60);
  });
  it('falls back to departure time when arrival is absent', () => {
    const msg = tu({
      tripUpdate: { trip: { tripId: 't3', routeId: '3' }, stopTimeUpdate: [{ stopId: '1001', stopSequence: 1, departure: { time: NOW + 90 } }] },
    });
    const [bus] = buildBuses(vp(vehicle('t3', 'v1')), msg, ['3']);
    expect(bus.stopEtas.get('1001')![0].time).toBe(NOW + 90);
  });
});

describe('nextArrival', () => {
  const [loopBus] = buildBuses(
    vp(vehicle('t3', 'v1')),
    tu(tripUpdate('t3', '3', [['1234', 40, NOW + 600], ['1234', 5, NOW - 120], ['5555', 10, NOW + 100]])),
    ['3'],
  );
  it('uses the first visit that is not already past on a loop trip', () => {
    expect(nextArrival(loopBus, '1234', NOW)).toBe(NOW + 600);
  });
  it('still returns an arrival up to 30 s in the past', () => {
    expect(nextArrival(loopBus, '5555', NOW + 125)).toBe(NOW + 100);
  });
  it('returns null when the arrival is more than 30 s past', () => {
    expect(nextArrival(loopBus, '5555', NOW + 131)).toBeNull();
  });
  it('returns null for a stop the trip does not visit', () => {
    expect(nextArrival(loopBus, '9999', NOW)).toBeNull();
  });
});
