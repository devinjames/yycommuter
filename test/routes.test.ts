import { describe, expect, it, vi } from 'vitest';
import { fetchRouteShape } from '../src/routes';

const row = {
  route_short_name: '3',
  multilinestring: { type: 'MultiLineString', coordinates: [[[-114.07, 51.04], [-114.06, 51.05]], [[-114.05, 51.06], [-114.04, 51.07]]] },
};
const ok = (body: unknown) => vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status: 200 }));

describe('fetchRouteShape', () => {
  it('queries the routes dataset for one route', async () => {
    const f = ok([row]);
    await fetchRouteShape('3', f);
    const u = new URL(f.mock.calls[0][0]);
    expect(u.origin + u.pathname).toBe('https://data.calgary.ca/resource/hpnd-riq4.json');
    expect(u.searchParams.get('$where')).toBe("route_short_name='3'");
    expect(u.searchParams.get('$select')).toBe('multilinestring');
  });
  it('converts [lon, lat] line strings to LatLon arrays', async () => {
    expect(await fetchRouteShape('4', ok([row]))).toEqual([
      [{ lat: 51.04, lon: -114.07 }, { lat: 51.05, lon: -114.06 }],
      [{ lat: 51.06, lon: -114.05 }, { lat: 51.07, lon: -114.04 }],
    ]);
  });
  it('memoises per route', async () => {
    const f = ok([row]);
    await fetchRouteShape('5', f);
    await fetchRouteShape('5', f);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('rejects on HTTP errors and does not cache the failure', async () => {
    const bad = vi.fn(async () => new Response('', { status: 500 }));
    await expect(fetchRouteShape('6', bad)).rejects.toThrow();
    const good = ok([row]);
    await fetchRouteShape('6', good);
    expect(good).toHaveBeenCalledTimes(1);
  });
  it('returns [] for a route with no geometry', async () => expect(await fetchRouteShape('7', ok([]))).toEqual([]));
  it('rejects an invalid route name without fetching', async () => {
    const f = ok([row]);
    expect(await fetchRouteShape("3' OR '1'='1", f)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});
