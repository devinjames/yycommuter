# YYCommuter — Design Spec

Date: 2026-11-02
Status: Draft for review

## 1. Purpose

A serverless, mobile-first web app that helps a Calgary Transit commuter avoid missing their bus. The user saves a Home and Work location and the bus routes they consider viable between them. The app shows, in real time:

1. A map centred on the user's current location with every live bus on their selected routes, each labelled with its ETA to the user's departure stop.
2. A status card giving, per route, the ETA of the next bus at the departure stop nearest the user's origin (Home or Work).
3. The estimated walking time from the user's current location to that departure stop, combined into a "leave in X min" recommendation.

**Success criteria**
- Runs entirely as static files (no backend); deployable to GitHub Pages / Netlify.
- Settings (Home, Work, routes, refresh interval) persist in `localStorage`.
- From opening the app, the user can tell within a glance whether they need to leave now to catch the next bus on any of their routes.

## 2. Data sources (verified 2026-11-02)

All on `data.calgary.ca` (Socrata). All endpoints below return `Access-Control-Allow-Origin: *`.

| Data | Dataset id | Access |
|---|---|---|
| GTFS-RT Vehicle Positions (~14 KB) | `am7c-qe3u` | see two-step fetch |
| GTFS-RT Trip Updates (~850 KB) | `gs4m-mdc2` | see two-step fetch |
| Stops By Route cross reference | `pm3p-838w` | SODA JSON: `/resource/pm3p-838w.json` |

**Two-step realtime fetch.** The `/download/<id>/...` URLs respond with a 302 that lacks CORS headers, so browsers cannot follow them. Instead:
1. `GET https://data.calgary.ca/api/views/<id>.json` → read `blobId`.
2. `GET https://data.calgary.ca/api/views/<id>/files/<blobId>` → protobuf `FeedMessage`.

`blobId` changes whenever the feed is republished; if unchanged since the last poll, step 2 is skipped.

**Observed feed shapes**
- Vehicle Positions entity: `vehicle.trip.tripId`, `vehicle.position.{latitude,longitude}`, `vehicle.timestamp`, `vehicle.vehicle.id`. **No `routeId`.**
- Trip Updates entity: `tripUpdate.trip.{tripId, routeId}` (e.g. `routeId: "36"`), `stopTimeUpdate[]` with `stopSequence`, `stopId` (4-digit, matches `teleride_number` in the stops dataset), `arrival.time`, `departure.time` (epoch seconds).
- Stops By Route row: `route_short_name`, `teleride_number`, `stop_name`, `status`, `point.coordinates [lon, lat]`.

**Join:** vehicle → trip update via `tripId`; trip update `routeId` ↔ `route_short_name`; `stopId` ↔ `teleride_number`.

**Assumption to verify during implementation:** `routeId` equals `route_short_name` for all routes. If not, add a mapping via the Calgary Transit Routes dataset (`hpnd-riq4`).

**Geocoding:** OpenStreetMap Nominatim (`https://nominatim.openstreetmap.org/search`, `format=json`, `viewbox` bounded to Calgary, `bounded=1`). Called only on explicit submit (usage policy: ≤1 req/s).

**Map tiles:** OpenStreetMap standard tiles with attribution.

## 3. Tech stack

- Vite + TypeScript, no UI framework.
- Leaflet for the map.
- `gtfs-realtime-bindings` (protobufjs) for decoding.
- Vitest for unit tests.
- Output: static `dist/` folder.

## 4. Architecture

All modules in `src/`. Pure logic is separated from I/O so it can be unit tested.

| Module | Kind | Responsibility |
|---|---|---|
| `feeds.ts` | I/O | `fetchFeed(datasetId): Promise<FeedMessage \| null>` — two-step fetch, caches last `blobId` + decoded message per dataset; returns cached message when `blobId` unchanged. On file fetch failure, re-resolves `blobId` and retries once. |
| `realtime.ts` | pure | `buildBuses(vp, tu, routes): Bus[]` — join on `tripId`, filter to selected routes. |
| `stops.ts` | I/O + pure | `fetchStopsNear(lat, lon, radiusM, routes): Stop[]` via SODA `$where=within_circle(point, lat, lon, r) AND route_short_name in (...) AND status='ACTIVE'`. Results cached in memory per (place, routes, radius). |
| `trip.ts` | pure | Direction, departure-stop selection, ETA, walk time, leave-by. |
| `geo.ts` | pure | `haversineM(a, b)`, `walkMinutes(a, b) = haversineM × 1.3 / (5 km/h)`. |
| `geocode.ts` | I/O | `searchAddress(q): Place[]` via Nominatim. |
| `storage.ts` | I/O | `loadSettings()/saveSettings()` with schema version and validation. |
| `map.ts` | UI | Leaflet map, markers for user, Home, Work, departure stops, buses (with ETA tag). |
| `ui.ts` | UI | Status card and settings sheet rendering + events. |
| `main.ts` | glue | Refresh loop, geolocation watch, wiring. |

**Core types**
```ts
type LatLon = { lat: number; lon: number };
type Settings = {
  version: 1;
  home: LatLon & { label: string } | null;
  work: LatLon & { label: string } | null;
  routes: string[];            // route_short_name values, e.g. ["3", "300"]
  refreshSec: 15 | 30 | 60;    // default 30
  stopCache: Record<string, string>; // `${route}|${direction}` -> teleride_number
};
type Stop = { id: string; name: string; route: string; pos: LatLon };
type Bus = {
  vehicleId: string; tripId: string; routeId: string;
  pos: LatLon; updatedAt: number;            // epoch s
  stopEtas: Map<string, { seq: number; time: number }>; // stopId -> arrival
};
type Direction = 'toWork' | 'toHome';
```

## 5. Behaviour

### 5.1 Refresh loop
- Interval = `settings.refreshSec`, default 30 s. Runs only while `document.visibilityState === 'visible'`; an immediate refresh fires on becoming visible.
- Location from `navigator.geolocation.watchPosition`.
- Each tick: fetch VP and TU in parallel → `buildBuses` → compute trip → render.

### 5.2 Direction
- Origin = the saved place (Home/Work) nearer to the user's current location; destination = the other.
- A ⇄ toggle in the status card overrides the automatic choice until the app is reloaded.

### 5.3 Departure stop selection (per route)
1. Candidate origin stops = route's stops within 800 m of origin; candidate destination stops = route's stops within 800 m of destination.
2. A candidate origin stop **S** is direction-valid if any live trip update on that route lists S with a lower `stopSequence` than some candidate destination stop.
3. Departure stop = nearest-to-origin direction-valid candidate. Persist to `stopCache[route|direction]`.
4. If none can be validated now: use cached stop if present; else nearest candidate, flagged "(direction unverified)".
5. If no candidates: row reads "No route N stop within 800 m of Home/Work" with a settings action to widen to 1500 m.

### 5.4 ETA, walking time, leave-by
- For each bus on route R: `eta = stopEtas.get(departureStop).time − now`. If the departure stop is absent from the bus's remaining stops, the bus has **passed** (or doesn't serve it in this direction).
- Walk time = `walkMinutes(userLocation, departureStop)`. With no geolocation, assume the user is at the origin (walk = 0) and show a banner.
- Leave-in = `eta − walk`.
- Per route, the status row shows the soonest non-passed bus. Status colour: **green** leave-in > 2 min, **amber** 0–2 min, **red** < 0 (and then also show the next bus).

## 6. User interface

Mobile-first, high contrast, supports dark mode (`prefers-color-scheme`).

**Map (full screen)**
- Centred on user location; re-centre button.
- User: blue dot with accuracy circle. Home/Work: house/briefcase icons. Departure stops: pins labelled with stop name.
- Buses: coloured circle with route number; an ETA tag above (`5 min`, dimmed `passed`, `—` if no trip update). Faded "stale" tag if vehicle timestamp > 2 min old.

**Status card (bottom sheet, draggable)**
- Header: direction (`→ Work`) with ⇄ toggle; "updated N s ago"; warning line on feed errors.
- One row per selected route, sorted by soonest ETA:
  `Route 3 · Centre St @ 16 Av N`
  `Bus in 9 min · Walk 6 min · Leave in 3 min` (leave-in large and colour-coded)
- Tapping a row fits the map to that bus + stop.

**Settings sheet (⚙; auto-opens when Home, Work, or routes are missing)**
- Home and Work: address input + Search → result list → selecting drops a draggable pin; "Use current location" button.
- Routes: add by number as chips; validated by checking the stops dataset has rows for that `route_short_name`.
- Refresh interval: 15 / 30 / 60 s.
- All changes save immediately.

## 7. Error handling

| Condition | Behaviour |
|---|---|
| Feed fetch/decode fails | Keep last good data; header shows "⚠ Live data unavailable — retrying"; markers grey when data > 2 min old; backoff 30 → 60 → 120 s, reset on success. |
| File fetch fails after metadata OK | Re-resolve `blobId`, retry once immediately. |
| No live buses on a route | Row: "No live buses on route N". |
| Vehicle has no matching trip update | Marker drawn with `—` tag. |
| No stops near origin/destination | See 5.3 step 5. |
| Geocode fails / no results | Inline message in settings; pin placement remains available. |
| Geolocation denied/unavailable | Banner; origin assumed as user location. |
| Corrupt / old-version settings | Discard, start fresh, open settings. |

## 8. Testing

- **Unit (Vitest):** `geo`; `trip` (direction, departure-stop selection including wrong-direction-nearest case, ETA/leave-by, passed detection); `realtime` (join, route filter, missing trip update); `storage` (round-trip, invalid input rejected); `feeds` (blobId resolution, unchanged-blob skip, retry-once) with mocked `fetch`.
- **Fixtures:** small `.pb` snapshots captured from the live feeds, trimmed to a few entities, checked into `test/fixtures/`.
- **Manual E2E:** run dev server against live feeds; confirm no CORS errors, buses render for real routes, map ETA tags agree with status card.

## 9. Out of scope (v1)

Service alerts, multi-route transfers, street-network walking routes, multiple saved place pairs, push notifications, offline tiles, LRT (CTrain) beyond whatever appears in the bus feeds.
