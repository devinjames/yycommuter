// Captures small GTFS-RT fixtures from the live Calgary Transit feeds.
// Usage: npx vite-node scripts/capture-fixtures.ts
import { writeFileSync } from 'node:fs';
import GtfsRt from 'gtfs-realtime-bindings';
import { createFeedClient, TU_ID, VP_ID } from '../src/feeds';

const rt = GtfsRt.transit_realtime;
const client = createFeedClient();
const [vp, tu] = await Promise.all([client.fetchFeed(VP_ID), client.fetchFeed(TU_ID)]);
const tuByTrip = new Map(tu.entity!.map((e) => [e.tripUpdate?.trip?.tripId, e]));
const vpKeep = vp.entity!.filter((e) => e.vehicle?.position && tuByTrip.has(e.vehicle?.trip?.tripId)).slice(0, 5);
const tuKeep = vpKeep.map((e) => tuByTrip.get(e.vehicle!.trip!.tripId)!);

const encode = (header: typeof vp.header, entity: typeof vpKeep) =>
  rt.FeedMessage.encode(rt.FeedMessage.create({ header: header!, entity } as never)).finish();
writeFileSync(new URL('../test/fixtures/vp.pb', import.meta.url), encode(vp.header, vpKeep));
writeFileSync(new URL('../test/fixtures/tu.pb', import.meta.url), encode(tu.header, tuKeep));
console.log(`live: ${vp.entity!.length} vehicles, ${tu.entity!.length} trip updates; wrote ${vpKeep.length} + ${tuKeep.length}`);
