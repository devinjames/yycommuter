import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createFeedClient, decodeFeed, FeedError, VP_ID } from '../src/feeds';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const VP_META = `https://data.calgary.ca/api/views/${VP_ID}.json`;
const vpFile = (blob: string) => `https://data.calgary.ca/api/views/${VP_ID}/files/${blob}`;

type Route = Record<string, Array<() => Response>>;
function mockFetch(routes: Route) {
  return vi.fn(async (url: string) => {
    const queue = routes[url];
    if (!queue?.length) throw new Error(`unexpected fetch ${url}`);
    return (queue.length > 1 ? queue.shift()! : queue[0])();
  });
}
const json = (o: unknown) => () => new Response(JSON.stringify(o), { status: 200 });
const bytes = (b: Uint8Array) => () => new Response(b as BodyInit, { status: 200 });
const notFound = () => new Response('', { status: 404 });

describe('decodeFeed', () => {
  it('decodes trip-update fixture entities with routeId', () => {
    const msg = decodeFeed(fixture('tu.pb'));
    expect(msg.entity).toHaveLength(5);
    for (const e of msg.entity!) expect(e.tripUpdate?.trip?.routeId).toBeTruthy();
  });
  it('keeps complete entities when the published file is truncated mid-entity', () => {
    const full = fixture('tu.pb');
    const msg = decodeFeed(full.slice(0, full.length - 10));
    expect(msg.entity).toHaveLength(4);
    expect(msg.header?.gtfsRealtimeVersion).toBeTruthy();
  });
});

describe('createFeedClient.fetchFeed', () => {
  it('resolves blobId from metadata then downloads the file', async () => {
    const f = mockFetch({ [VP_META]: [json({ blobId: 'b1' })], [vpFile('b1')]: [bytes(fixture('vp.pb'))] });
    const msg = await createFeedClient(f).fetchFeed(VP_ID);
    expect(msg.entity).toHaveLength(5);
    expect(f.mock.calls.map((c) => c[0])).toEqual([VP_META, vpFile('b1')]);
  });
  it('skips the file download when blobId is unchanged', async () => {
    const f = mockFetch({ [VP_META]: [json({ blobId: 'b1' })], [vpFile('b1')]: [bytes(fixture('vp.pb'))] });
    const client = createFeedClient(f);
    const first = await client.fetchFeed(VP_ID);
    const second = await client.fetchFeed(VP_ID);
    expect(second).toBe(first);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('re-resolves blobId once when the file 404s (republished between calls)', async () => {
    const f = mockFetch({
      [VP_META]: [json({ blobId: 'old' }), json({ blobId: 'new' })],
      [vpFile('old')]: [notFound],
      [vpFile('new')]: [bytes(fixture('vp.pb'))],
    });
    const msg = await createFeedClient(f).fetchFeed(VP_ID);
    expect(msg.entity).toHaveLength(5);
    expect(f).toHaveBeenCalledTimes(4);
  });
  it('rejects with FeedError when the retry also fails', async () => {
    const f = mockFetch({ [VP_META]: [json({ blobId: 'b1' })], [vpFile('b1')]: [notFound] });
    await expect(createFeedClient(f).fetchFeed(VP_ID)).rejects.toBeInstanceOf(FeedError);
  });
  it('rejects with FeedError when metadata has no blobId', async () => {
    const f = mockFetch({ [VP_META]: [json({})] });
    await expect(createFeedClient(f).fetchFeed(VP_ID)).rejects.toBeInstanceOf(FeedError);
  });
});
