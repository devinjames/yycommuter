import { describe, expect, it } from 'vitest';
import type { FeedMessage } from '../src/feeds';
import { buildBuses, createTripMemory, nextArrival, normalizeTime } from '../src/realtime';

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

describe('normalizeTime', () => {
  it('leaves plausible times alone', () => expect(normalizeTime(NOW + 600, NOW)).toBe(NOW + 600));
  it('shifts a time published one day ahead back to today', () => expect(normalizeTime(NOW + 86400 + 600, NOW)).toBe(NOW + 600));
  it('shifts a time published one day behind forward', () => expect(normalizeTime(NOW - 86400 + 600, NOW)).toBe(NOW + 600));
  it('drops garbage times like epoch zero', () => expect(normalizeTime(0, NOW)).toBeNull());
  it('returns the time unchanged without a reference', () => expect(normalizeTime(NOW + 86400, null)).toBe(NOW + 86400));
});

describe('buildBuses time normalisation', () => {
  it('corrects next-day trip-update times using the feed header timestamp', () => {
    const msg = { header: { gtfsRealtimeVersion: '2.0', timestamp: NOW }, entity: [tripUpdate('t3', '3', [['1001', 1, NOW + 86400 + 300], ['1002', 2, 0]])] } as FeedMessage;
    const [bus] = buildBuses(vp(vehicle('t3', 'v1')), msg, ['3']);
    expect(bus.stopEtas.get('1001')).toEqual([{ seq: 1, time: NOW + 300 }]);
    expect(bus.stopEtas.has('1002')).toBe(false);
  });
});

describe('createTripMemory', () => {
  const feed = (ts: number, ...e: unknown[]) => ({ header: { gtfsRealtimeVersion: '2.0', timestamp: ts }, entity: e }) as FeedMessage;
  it('keeps a trip that disappears from a later (truncated) feed', () => {
    const mem = createTripMemory();
    mem.merge(feed(NOW, tripUpdate('t3', '3', [['1001', 1, NOW + 600]])), NOW);
    const merged = mem.merge(feed(NOW + 30, tripUpdate('t36', '36', [['2002', 1, NOW + 600]])), NOW + 30);
    expect(merged.entity!.map((e) => e.tripUpdate!.trip!.tripId).sort()).toEqual(['t3', 't36']);
    expect(Number(merged.header!.timestamp)).toBe(NOW + 30);
  });
  it('prefers the newest copy of a trip', () => {
    const mem = createTripMemory();
    mem.merge(feed(NOW, tripUpdate('t3', '3', [['1001', 1, NOW + 600]])), NOW);
    const merged = mem.merge(feed(NOW + 30, tripUpdate('t3', '3', [['1001', 1, NOW + 660]])), NOW + 30);
    expect(merged.entity).toHaveLength(1);
    expect(Number(merged.entity![0].tripUpdate!.stopTimeUpdate![0].arrival!.time)).toBe(NOW + 660);
  });
  it('forgets trips not seen for more than 15 minutes', () => {
    const mem = createTripMemory();
    mem.merge(feed(NOW, tripUpdate('t3', '3', [['1001', 1, NOW + 600]])), NOW);
    const merged = mem.merge(feed(NOW + 901), NOW + 901);
    expect(merged.entity).toHaveLength(0);
  });
});
