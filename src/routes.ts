import { isValidRouteName } from './stops';
import type { LatLon } from './types';

const ENDPOINT = 'https://data.calgary.ca/resource/hpnd-riq4.json';
type FetchFn = (url: string) => Promise<Response>;
type Row = { multilinestring?: { coordinates?: Array<Array<[number, number]>> } };

const memo = new Map<string, Promise<LatLon[][]>>();

/** The route's path (both directions, as line pieces) from the Calgary Transit Routes dataset. */
export function fetchRouteShape(route: string, fetchFn: FetchFn = (u) => fetch(u)): Promise<LatLon[][]> {
  if (!isValidRouteName(route)) return Promise.resolve([]);
  const hit = memo.get(route);
  if (hit) return hit;
  const params = new URLSearchParams({ $select: 'multilinestring', $where: `route_short_name='${route}'` });
  const pending = fetchFn(`${ENDPOINT}?${params}`).then(async (res) => {
    if (!res.ok) throw new Error(`routes: HTTP ${res.status}`);
    const rows = (await res.json()) as Row[];
    return rows.flatMap((r) =>
      (r.multilinestring?.coordinates ?? []).map((line) => line.map(([lon, lat]) => ({ lat, lon }))),
    );
  });
  memo.set(route, pending);
  pending.catch(() => memo.delete(route));
  return pending;
}
