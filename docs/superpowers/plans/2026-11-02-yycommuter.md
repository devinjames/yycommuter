# YYCommuter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static, mobile-first web app that shows live Calgary Transit buses on the user's chosen routes, ETAs to their departure stop, walking time, and a "leave in X min" recommendation.

**Architecture:** Vite + TypeScript SPA, no framework. Pure logic modules (`geo`, `realtime`, `trip`, `storage` validation) are unit-tested; thin I/O modules (`feeds`, `stops`, `geocode`) are tested with mocked `fetch`; UI modules (`map`, `ui`, `main`) are verified manually against live feeds.

**Tech Stack:** Vite 5, TypeScript 5, Leaflet 1.9, gtfs-realtime-bindings 1.x, Vitest 2.

**Spec:** `docs/superpowers/specs/2026-11-02-yycommuter-design.md`

## Global Constraints

- No backend. All data via browser `fetch` from `https://data.calgary.ca` and `https://nominatim.openstreetmap.org`.
- Realtime fetch is two-step: `GET /api/views/<id>.json` → `blobId`; `GET /api/views/<id>/files/<blobId>`. Never use `/download/...` URLs (302 lacks CORS).
- Dataset ids: Vehicle Positions `am7c-qe3u`, Trip Updates `gs4m-mdc2`, Stops By Route `pm3p-838w`.
- `routeId` (TU) == `route_short_name` (stops dataset) — verified 2026-11-02 for all live routes. `stopId` == `teleride_number`.
- Protobuf int64 fields decode as `Long`; always convert with `Number(x)`.
- Walk estimate: `haversineM × 1.3 / (5000 m / 60 min)`.
- Stop search radius 800 m default, 1500 m widened.
- Status colours: green leave-in > 2 min, amber 0–2 min, red < 0.
- Stale threshold: 120 s. Refresh: 15/30/60 s, default 30. Backoff on failure 30 → 60 → 120 s.
- localStorage key `yycommuter.settings`, schema `version: 1`.
- Nominatim: only on explicit submit; `viewbox=-114.32,51.22,-113.86,50.84&bounded=1&format=json&limit=5`.

## Review Focus

1. A trip that visits the same stop twice (loop routes) — ETA must use the first occurrence whose arrival is ≥ now − 30 s. → test in Task 4.
2. Arrival time slightly in the past (bus at/just leaving stop) — `eta` between −30 s and 0 shows as "Due", below −30 s counts as passed. → test in Task 5.
3. Home and Work both inside the same 800 m radius — origin/dest candidate sets overlap; a stop must not validate against itself. → test in Task 5.
4. A selected route with no live trips at all (night) — trip computation returns an empty-buses result, not an error. → test in Task 5.
5. Metadata returns a `blobId` whose file 404s (republished between calls) — re-resolve once, then fail cleanly keeping cached data. → test in Task 3.

---

### Task 1: Scaffold + `geo`

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts` (placeholder), `src/types.ts`, `src/geo.ts`, `test/geo.test.ts`, `.gitignore`

**Interfaces:**
- Produces (`src/types.ts`): `LatLon`, `Place = LatLon & { label: string }`, `Settings`, `Stop`, `Bus`, `Direction` exactly as in spec §4. `Bus.stopEtas: Map<string, { seq: number; time: number }[]>` (array per stop to support loops, sorted by seq).
- Produces (`src/geo.ts`): `haversineM(a: LatLon, b: LatLon): number`, `walkMinutes(a: LatLon, b: LatLon): number`.

- [ ] **Step 1:** `npm create vite@latest . -- --template vanilla-ts`, then `npm i leaflet gtfs-realtime-bindings` and `npm i -D vitest @types/leaflet`. Add `"test": "vitest run"` script. `vite.config.ts`: `base: './'`, `test.environment: 'node'`.
- [ ] **Step 2: Failing tests** in `test/geo.test.ts`:
  - `haversineM` Calgary Tower (51.0443, −114.0631) → City Hall (51.0453, −114.0581) ≈ 370 m (±15).
  - `haversineM(a, a) === 0`.
  - `walkMinutes` for two points 1000 m apart ≈ 15.6 (±0.1).
- [ ] **Step 3:** Run `npm test` → FAIL (module missing).
- [ ] **Step 4:** Implement `src/geo.ts`.
- [ ] **Step 5:** `npm test` → PASS. `npm run build` → succeeds.
- [ ] **Step 6:** Commit `feat: scaffold vite app and geo utilities`.

### Task 2: `storage`

**Files:** Create `src/storage.ts`, `test/storage.test.ts`

**Interfaces:**
- Produces: `defaultSettings(): Settings`, `parseSettings(raw: string | null): Settings` (pure; returns defaults on null/invalid/wrong version), `loadSettings(): Settings`, `saveSettings(s: Settings): void`. Key `yycommuter.settings`. All `localStorage` access in try/catch.
- `isConfigured(s: Settings): boolean` — home, work set and `routes.length > 0`.

- [ ] **Step 1: Failing tests:** round-trip `parseSettings(JSON.stringify(s))` deep-equals `s`; `parseSettings(null)`, `parseSettings('{bad')`, `parseSettings('{"version":2}')`, and a payload with `home.lat: "x"` each return `defaultSettings()`; `refreshSec: 45` coerces to 30; `isConfigured` false for defaults, true when filled.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with hand-written type guards (no schema library).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: settings persistence with validation`.

### Task 3: `feeds` + fixtures

**Files:** Create `src/feeds.ts`, `scripts/capture-fixtures.mjs`, `test/fixtures/vp.pb`, `test/fixtures/tu.pb`, `test/feeds.test.ts`

**Interfaces:**
- Produces: `type FeedMessage = transit_realtime.IFeedMessage`; `const VP_ID = 'am7c-qe3u'`, `TU_ID = 'gs4m-mdc2'`; `createFeedClient(fetchFn = fetch): { fetchFeed(id: string): Promise<FeedMessage> }`. Client caches `{ blobId, message }` per id; returns cached message without file request when `blobId` unchanged; on file non-OK re-fetches metadata and retries once; throws `FeedError` if still failing (caller keeps old data).
- `decodeFeed(buf: Uint8Array): FeedMessage`.

- [ ] **Step 1:** Write `scripts/capture-fixtures.mjs` (Node): two-step fetch both feeds, decode, keep 5 VP entities whose tripId exists in TU plus those 5 TU entities, re-encode, write to `test/fixtures/`. Run it: `node scripts/capture-fixtures.mjs`.
- [ ] **Step 2: Failing tests** (mock `fetchFn` returning metadata JSON then fixture bytes):
  - `decodeFeed(fixture tu.pb)` yields 5 entities each with `tripUpdate.trip.routeId`.
  - First `fetchFeed(VP_ID)` calls `/api/views/am7c-qe3u.json` then `/api/views/am7c-qe3u/files/<blobId>`.
  - Second call with same `blobId` makes exactly 1 request (metadata only) and returns the same message.
  - File 404 → metadata re-fetched → file succeeds → returns message (4 calls total).
  - File 404 twice → rejects with `FeedError`.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Implement. Base URL `https://data.calgary.ca`. Use `cache: 'no-store'` on metadata.
- [ ] **Step 5:** Run → PASS.
- [ ] **Step 6:** Commit `feat: GTFS-RT two-step feed client`.

### Task 4: `realtime`

**Files:** Create `src/realtime.ts`, `test/realtime.test.ts`

**Interfaces:**
- Consumes: `FeedMessage` (Task 3), `Bus` (Task 1).
- Produces: `buildBuses(vp: FeedMessage, tu: FeedMessage, routes: string[]): Bus[]`. Vehicles without position skipped. Vehicles whose trip has no TU are excluded (VP carries no routeId, so the route is unknowable). `stopEtas` uses `arrival.time ?? departure.time`.
- `nextArrival(bus: Bus, stopId: string, nowSec: number): number | null` — earliest entry for `stopId` with `time >= nowSec - 30`, else null.

- [ ] **Step 1: Failing tests** (construct messages in-code with plain objects):
  - Route filter: VP for trips on routes 3 and 36, `routes=['3']` → one bus with `routeId '3'`.
  - VP with no matching TU excluded; VP with no position excluded.
  - `updatedAt` = `Number(vehicle.timestamp)`; `Long`-like `{low,high}` values handled by `Number()` on protobufjs Long.
  - Loop trip lists stop `1234` at seq 5 (time now−120) and seq 40 (time now+600) → `nextArrival(bus,'1234',now) === now+600`.
  - Stop absent → `null`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: join vehicle positions with trip updates`.

### Task 5: `trip`

**Files:** Create `src/trip.ts`, `test/trip.test.ts`

**Interfaces:**
- Consumes: `geo`, `nextArrival`, types.
- Produces:
  - `chooseDirection(user: LatLon | null, home: Place, work: Place, override: Direction | null): Direction` — override wins; null user → `'toWork'`; else nearer place is origin.
  - `selectDepartureStop(route: string, originStops: Stop[], destStops: Stop[], buses: Bus[], cached: string | undefined, origin: LatLon): { stop: Stop; verified: boolean } | null` — algorithm in spec §5.3; a candidate validates if any bus on `route` has the origin stop at seq < some dest stop's seq, where the dest stop id ≠ origin stop id.
  - `type RouteStatus = { route: string; stop: Stop | null; verified: boolean; next: BusEta | null; following: BusEta | null; walkMin: number; reason?: 'noStops' | 'noBuses' }`, `type BusEta = { bus: Bus; etaSec: number; leaveInMin: number; level: 'green' | 'amber' | 'red' }`.
  - `computeRouteStatus(route, stop, verified, buses, user: LatLon | null, origin: LatLon, nowSec): RouteStatus` — walk from `user ?? origin`; `etaSec = arrival − now`; passed if `nextArrival` null; sorted ascending; `following` only populated when `next.level === 'red'`.
  - `levelFor(leaveInMin: number): 'green'|'amber'|'red'`.
  - `formatEta(etaSec: number): string` — `etaSec < 60` → `"Due"`, else `"${Math.round(etaSec/60)} min"`.

- [ ] **Step 1: Failing tests:**
  - `chooseDirection`: user near home → `'toWork'`; near work → `'toHome'`; override `'toHome'` wins near home; null user → `'toWork'`.
  - `selectDepartureStop`: nearest origin stop A is wrong-direction (bus has dest stop at seq 10, A at seq 20), farther stop B at seq 5 → returns B, `verified: true`.
  - No bus validates, cached `'B'` present → B, `verified: false`; no cache → nearest, `verified: false`; empty `originStops` → `null`.
  - Overlapping sets (same stop id in origin and dest) → that stop doesn't validate against itself.
  - `levelFor(2.5)='green'`, `levelFor(2)='amber'`, `levelFor(0)='amber'`, `levelFor(-0.1)='red'`.
  - `computeRouteStatus`: bus arriving now+540, user 400 m straight-line from stop (walk ≈ 6.24) → `leaveInMin ≈ 2.76`, green. Arrival now−20 → included, `formatEta` `"Due"`. Arrival now−60 → excluded (passed). No buses → `reason: 'noBuses'`, `next: null`. Red next → `following` set.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: trip direction, departure stop and leave-by logic`.

### Task 6: `stops` + `geocode`

**Files:** Create `src/stops.ts`, `src/geocode.ts`, `test/stops.test.ts`, `test/geocode.test.ts`

**Interfaces:**
- Produces: `fetchStopsNear(p: LatLon, radiusM: number, routes: string[], fetchFn = fetch): Promise<Stop[]>` — SODA `/resource/pm3p-838w.json` with `$where=within_circle(point, lat, lon, r) AND route_short_name in('3','36') AND status='ACTIVE'`, `$limit=1000`; memoised by `${lat.toFixed(5)},${lon.toFixed(5)}|${radiusM}|${routes.sort()}`. `routeExists(route: string, fetchFn = fetch): Promise<boolean>` (`$limit=1`).
- `searchAddress(q: string, fetchFn = fetch): Promise<Place[]>` — Nominatim params from Global Constraints; `label = display_name` truncated at the second comma.

- [ ] **Step 1: Failing tests:** `fetchStopsNear` builds URL containing `within_circle(point, 51.0447, -114.0719, 800)` and `route_short_name in('3','36')` (decoded); maps a sample row (from spec) to `Stop { id:'5431', name:'NB 4 ST SW@ 11 AV SW', route:'3', pos:{lat:51.0428242, lon:-114.0714147} }`; second identical call makes no request. `routeExists` true/false from `[]` vs one row. `searchAddress` maps `{lat:"51.04",lon:"-114.07",display_name:"800 Macleod Trail SE, Beltline, Calgary, ..."}` → `{lat:51.04, lon:-114.07, label:'800 Macleod Trail SE, Beltline'}`; non-OK response throws.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: stop lookup and address search`.

### Task 7: `map`

**Files:** Create `src/map.ts`, `src/style.css` (map/marker portion)

**Interfaces:**
- Produces: `createMap(el: HTMLElement): MapView` where `MapView = { setUser(p: LatLon | null, accuracyM?: number): void; setPlaces(home: Place|null, work: Place|null): void; setStops(stops: Stop[]): void; setBuses(items: { bus: Bus; label: string; dim: boolean; stale: boolean }[]): void; recenter(): void; fitTo(points: LatLon[]): void; enablePinPick(initial: LatLon, onMove: (p: LatLon) => void): () => void }`.
- Bus markers are `L.divIcon` with route number circle and ETA tag above; markers reused by `vehicleId` (update position, not recreate).
- OSM tile layer with attribution; initial view Calgary (51.0447, −114.0719) zoom 13.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Verify `npm run build` passes typecheck.
- [ ] **Step 3:** Commit `feat: leaflet map view`.

### Task 8: `ui` + `main` (refresh loop)

**Files:** Create `src/ui.ts`; modify `src/main.ts`, `index.html`, `src/style.css`

**Interfaces:**
- Consumes everything above.
- `ui.ts` produces: `renderStatus(el, { direction, updatedAgoSec, error: boolean, noGeo: boolean, rows: RouteStatus[] }, handlers: { onToggleDirection(): void; onRowTap(r: RouteStatus): void; onWiden(route: string): void })`; `openSettings(settings: Settings, deps: { map: MapView; searchAddress; routeExists }, onChange: (s: Settings) => void)`.
- `main.ts`: loads settings; opens settings if `!isConfigured`; `watchPosition`; tick = fetch VP+TU in parallel → `buildBuses` → `chooseDirection` → per route `fetchStopsNear` (origin & dest, radius 800 or widened 1500 per route) → `selectDepartureStop` → persist `stopCache` → `computeRouteStatus` → render map + status. Interval per `refreshSec`, pauses when hidden, immediate tick on visible; on error keep last data, set error flag, backoff 30/60/120 s. "updated N s ago" ticks every second.
- Copy (verbatim): `⚠ Live data unavailable — retrying`, `No live buses on route N`, `No route N stop within 800 m of Home` (or Work / 1500 m), `(direction unverified)`, `Location unavailable — assuming you're at Home` (or Work), `Leave in X min` / `Leave now` (0–<1) / `Missed — next in X min`.

- [ ] **Step 1:** Implement `ui.ts` and `main.ts`; styles: bottom sheet, large leave-in text, colour levels, dark mode via `prefers-color-scheme`.
- [ ] **Step 2:** `npm test` and `npm run build` → PASS.
- [ ] **Step 3: Manual E2E:** `npm run dev`, open in browser: set Home/Work via search, add 2 real routes; confirm no CORS errors in console, buses appear, map ETA tags equal status card ETAs, direction toggle swaps origin, refresh updates "updated" counter.
- [ ] **Step 4:** Commit `feat: status card, settings sheet and refresh loop`.

### Task 9: README + deploy config

**Files:** Create `README.md`

- [ ] **Step 1:** README: what it is, `npm i`, `npm run dev`, `npm test`, `npm run build` → deploy `dist/` to any static host; data sources and attribution (City of Calgary Open Data licence, OpenStreetMap).
- [ ] **Step 2:** Commit `docs: README`.
