import type { LatLon } from './types';

const EARTH_RADIUS_M = 6371008.8;
const DETOUR_FACTOR = 1.3;
const WALK_M_PER_MIN = 5000 / 60;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated walking minutes: straight-line distance × 1.3 detour at 5 km/h. */
export function walkMinutes(a: LatLon, b: LatLon): number {
  return (haversineM(a, b) * DETOUR_FACTOR) / WALK_M_PER_MIN;
}
