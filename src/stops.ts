import type { LatLon, Stop } from './types';

const ENDPOINT = 'https://data.calgary.ca/resource/pm3p-838w.json';
type FetchFn = (url: string) => Promise<Response>;
const defaultFetch: FetchFn = (u) => fetch(u);

/** Route numbers are short alphanumerics; anything else never reaches a SoQL string. */
export const isValidRouteName = (r: string) => /^[A-Za-z0-9]{1,5}$/.test(r);

type Row = {
  route_short_name?: string;
  teleride_number?: string;
  stop_name?: string;
  point?: { coordinates?: [number, number] };
};

const memo = new Map<string, Promise<Stop[]>>();

async function query(params: Record<string, string>, fetchFn: FetchFn): Promise<Row[]> {
  const res = await fetchFn(`${ENDPOINT}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(`stops: HTTP ${res.status}`);
  return (await res.json()) as Row[];
}

/** Active stops on any of `routes` within `radiusM` metres of `p` (memoised per query). */
export function fetchStopsNear(p: LatLon, radiusM: number, routes: string[], fetchFn: FetchFn = defaultFetch): Promise<Stop[]> {
  const rs = [...new Set(routes.filter(isValidRouteName))].sort();
  if (!rs.length) return Promise.resolve([]);
  const key = `${p.lat.toFixed(5)},${p.lon.toFixed(5)}|${radiusM}|${rs.join(',')}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const where =
    `within_circle(point, ${p.lat}, ${p.lon}, ${radiusM}) AND ` +
    `route_short_name in(${rs.map((r) => `'${r}'`).join(',')}) AND status='ACTIVE'`;
  const pending = query({ $where: where, $limit: '1000' }, fetchFn).then((rows) =>
    rows.flatMap((r): Stop[] => {
      const c = r.point?.coordinates;
      if (!r.teleride_number || !r.route_short_name || !c) return [];
      return [{ id: r.teleride_number, name: r.stop_name ?? r.teleride_number, route: r.route_short_name, pos: { lat: c[1], lon: c[0] } }];
    }),
  );
  memo.set(key, pending);
  pending.catch(() => memo.delete(key)); // don't cache failures
  return pending;
}

/** True if the stops dataset has any row for this route number. */
export async function routeExists(route: string, fetchFn: FetchFn = defaultFetch): Promise<boolean> {
  if (!isValidRouteName(route)) return false;
  const rows = await query({ $where: `route_short_name='${route}'`, $limit: '1' }, fetchFn);
  return rows.length > 0;
}
