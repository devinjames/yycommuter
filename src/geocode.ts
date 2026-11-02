import type { Place } from './types';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const CALGARY_VIEWBOX = '-114.32,51.22,-113.86,50.84';
type FetchFn = (url: string) => Promise<Response>;

/** Shorten "800 Macleod Trail SE, Beltline, Calgary, ..." to its first two parts. */
const shortLabel = (name: string) => name.split(',').slice(0, 2).map((s) => s.trim()).join(', ');

/** Address search via OSM Nominatim, bounded to Calgary. Call only on explicit submit. */
export async function searchAddress(q: string, fetchFn: FetchFn = (u) => fetch(u)): Promise<Place[]> {
  const params = new URLSearchParams({ q, format: 'json', limit: '5', viewbox: CALGARY_VIEWBOX, bounded: '1' });
  const res = await fetchFn(`${ENDPOINT}?${params}`);
  if (!res.ok) throw new Error(`geocode: HTTP ${res.status}`);
  const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  return rows
    .map((r) => ({ lat: Number(r.lat), lon: Number(r.lon), label: shortLabel(r.display_name ?? '') }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}
