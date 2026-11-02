import GtfsRt from 'gtfs-realtime-bindings';
import type { transit_realtime } from 'gtfs-realtime-bindings';

const rt = GtfsRt.transit_realtime;

export type FeedMessage = transit_realtime.IFeedMessage;
export const VP_ID = 'am7c-qe3u';
export const TU_ID = 'gs4m-mdc2';
const BASE = 'https://data.calgary.ca';

export class FeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedError';
  }
}

/** Read a protobuf varint at `pos`; returns [value, nextPos] or null if it runs past the end. */
function readVarint(buf: Uint8Array, pos: number): [number, number] | null {
  let value = 0;
  let mul = 1;
  for (let i = 0; i < 10; i++) {
    if (pos >= buf.length) return null;
    const b = buf[pos++];
    value += (b & 0x7f) * mul;
    if ((b & 0x80) === 0) return [value, pos];
    mul *= 128;
  }
  return null;
}

/**
 * Decode a GTFS-RT FeedMessage, tolerating truncation.
 *
 * Calgary's published files are sometimes cut off mid-entity, which makes a strict
 * decode throw. We walk the top-level fields ourselves (1 = header, 2 = entity) and
 * keep every entity that is fully present.
 */
export function decodeFeed(buf: Uint8Array): FeedMessage {
  const msg: FeedMessage = { header: null, entity: [] };
  let pos = 0;
  while (pos < buf.length) {
    const tag = readVarint(buf, pos);
    if (!tag) break;
    pos = tag[1];
    const field = Math.floor(tag[0] / 8);
    const wire = tag[0] & 7;
    if (wire === 0) {
      const v = readVarint(buf, pos);
      if (!v) break;
      pos = v[1];
    } else if (wire === 1 || wire === 5) {
      pos += wire === 1 ? 8 : 4;
    } else if (wire === 2) {
      const len = readVarint(buf, pos);
      if (!len) break;
      const start = len[1];
      const end = start + len[0];
      if (end > buf.length) break; // truncated: drop the partial field
      const slice = buf.subarray(start, end);
      try {
        if (field === 1) msg.header = rt.FeedHeader.decode(slice);
        else if (field === 2) msg.entity!.push(rt.FeedEntity.decode(slice));
      } catch {
        /* skip a malformed entity */
      }
      pos = end;
    } else {
      break; // unsupported wire type → stop
    }
  }
  return msg;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export function createFeedClient(fetchFn: FetchFn = (u, i) => fetch(u, i)) {
  const cache = new Map<string, { blobId: string; message: FeedMessage }>();

  async function resolveBlobId(id: string): Promise<string> {
    const res = await fetchFn(`${BASE}/api/views/${id}.json`, { cache: 'no-store' });
    if (!res.ok) throw new FeedError(`metadata ${id}: HTTP ${res.status}`);
    const meta = (await res.json()) as { blobId?: unknown };
    if (typeof meta.blobId !== 'string' || !meta.blobId) throw new FeedError(`metadata ${id}: no blobId`);
    return meta.blobId;
  }

  async function download(id: string, blobId: string): Promise<FeedMessage | null> {
    const res = await fetchFn(`${BASE}/api/views/${id}/files/${blobId}`);
    if (!res.ok) return null;
    return decodeFeed(new Uint8Array(await res.arrayBuffer()));
  }

  return {
    async fetchFeed(id: string): Promise<FeedMessage> {
      try {
        let blobId = await resolveBlobId(id);
        const cached = cache.get(id);
        if (cached && cached.blobId === blobId) return cached.message;
        let message = await download(id, blobId);
        if (!message) {
          blobId = await resolveBlobId(id);
          message = await download(id, blobId);
        }
        if (!message) throw new FeedError(`file ${id}/${blobId}: download failed`);
        cache.set(id, { blobId, message });
        return message;
      } catch (e) {
        throw e instanceof FeedError ? e : new FeedError(`${id}: ${(e as Error).message}`);
      }
    },
  };
}
