import { describe, expect, it, vi } from 'vitest';
import { searchAddress } from '../src/geocode';

describe('searchAddress', () => {
  it('queries Nominatim bounded to Calgary and maps results', async () => {
    const f = vi.fn(async (_url: string) =>
      new Response(JSON.stringify([{ lat: '51.04', lon: '-114.07', display_name: '800 Macleod Trail SE, Beltline, Calgary, Alberta' }]), { status: 200 }),
    );
    const res = await searchAddress('800 Macleod Trail', f);
    const url = new URL(f.mock.calls[0][0]).toString().replace(/%2C/g, ',');
    expect(url).toContain('https://nominatim.openstreetmap.org/search?');
    expect(url).toContain('viewbox=-114.32,51.22,-113.86,50.84');
    expect(url).toContain('bounded=1');
    expect(url).toContain('format=json');
    expect(url).toContain('limit=5');
    expect(res).toEqual([{ lat: 51.04, lon: -114.07, label: '800 Macleod Trail SE, Beltline' }]);
  });
  it('throws on a non-OK response', async () => {
    const f = vi.fn(async () => new Response('', { status: 503 }));
    await expect(searchAddress('x', f)).rejects.toThrow();
  });
});
