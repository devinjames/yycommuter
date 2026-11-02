import { describe, expect, it } from 'vitest';
import { haversineM, walkMinutes } from '../src/geo';

describe('haversineM', () => {
  it('measures Calgary Tower to City Hall as ~370 m', () => {
    const d = haversineM({ lat: 51.0443, lon: -114.0631 }, { lat: 51.0453, lon: -114.0581 });
    expect(Math.abs(d - 370)).toBeLessThanOrEqual(15);
  });
  it('is zero for identical points', () => {
    const a = { lat: 51.05, lon: -114.07 };
    expect(haversineM(a, a)).toBe(0);
  });
});

describe('walkMinutes', () => {
  it('estimates 1000 m straight-line as ~15.6 min (x1.3 detour, 5 km/h)', () => {
    const a = { lat: 51.0, lon: -114.0 };
    const b = { lat: 51.0 + 1000 / 111195, lon: -114.0 }; // ~1000 m north
    expect(Math.abs(haversineM(a, b) - 1000)).toBeLessThan(1);
    expect(Math.abs(walkMinutes(a, b) - 15.6)).toBeLessThanOrEqual(0.1);
  });
});
