import { describe, expect, it, vi } from 'vitest';
import { fetchStopsNear, routeExists } from '../src/stops';

const row = {
  route_short_name: '3',
  teleride_number: '5431',
  stop_name: 'NB 4 ST SW@ 11 AV SW',
  status: 'ACTIVE',
  point: { type: 'Point', coordinates: [-114.0714147, 51.0428242] },
};
const ok = (body: unknown) => vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status: 200 }));

describe('fetchStopsNear', () => {
  it('queries stops within the radius for the selected routes', async () => {
    const f = ok([row]);
    await fetchStopsNear({ lat: 51.0447, lon: -114.0719 }, 800, ['36', '3'], f);
    const u = new URL(f.mock.calls[0][0]);
    expect(u.origin + u.pathname).toBe('https://data.calgary.ca/resource/pm3p-838w.json');
    const url = u.searchParams.get('$where')!;
    expect(url).toContain('within_circle(point, 51.0447, -114.0719, 800)');
    expect(url).toContain("route_short_name in('3','36')");
    expect(url).toContain("status='ACTIVE'");
  });
  it('maps rows to Stop objects', async () => {
    const stops = await fetchStopsNear({ lat: 51.1, lon: -114.1 }, 800, ['3'], ok([row]));
    expect(stops).toEqual([{ id: '5431', name: 'NB 4 ST SW@ 11 AV SW', route: '3', pos: { lat: 51.0428242, lon: -114.0714147 } }]);
  });
  it('memoises identical queries', async () => {
    const f = ok([row]);
    await fetchStopsNear({ lat: 51.2, lon: -114.2 }, 800, ['3'], f);
    await fetchStopsNear({ lat: 51.2, lon: -114.2 }, 800, ['3'], f);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('rejects on HTTP errors', async () => {
    const f = vi.fn(async () => new Response('', { status: 500 }));
    await expect(fetchStopsNear({ lat: 51.3, lon: -114.3 }, 800, ['3'], f)).rejects.toThrow();
  });
  it('returns [] without fetching when no routes are selected', async () => {
    const f = ok([row]);
    expect(await fetchStopsNear({ lat: 51.4, lon: -114.4 }, 800, [], f)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('routeExists', () => {
  it('is true when the dataset has a row for the route', async () => expect(await routeExists('3', ok([row]))).toBe(true));
  it('is false when the dataset has none', async () => expect(await routeExists('999', ok([]))).toBe(false));
  it('rejects a non-numeric route without fetching', async () => {
    const f = ok([row]);
    expect(await routeExists("3' OR '1'='1", f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
