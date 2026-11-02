# YYCommuter

A serverless, phone-first web app that helps you catch your Calgary Transit bus.

Save a **Home** and **Work** location and the bus routes you'd take between them. The app shows:

- a map centred on you with every live bus on those routes, each tagged with its ETA to *your* departure stop;
- for each route, when the next bus reaches the stop nearest your origin, your estimated walking time to it, and a colour-coded **Leave in X min**.

Everything runs in the browser; settings live in `localStorage`.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (Vitest)
npm run build    # typecheck + static build into dist/
```

Deploy `dist/` to any static host (GitHub Pages, Netlify, Cloudflare Pages). The build uses relative paths, so it works from a sub-path. Geolocation requires HTTPS (or `localhost`).

Refresh test fixtures from the live feeds with `npx vite-node scripts/capture-fixtures.ts`.

## How it works

| Source | Use |
|---|---|
| [Vehicle Positions](https://data.calgary.ca/d/am7c-qe3u) (GTFS-RT) | bus locations |
| [Trip Updates](https://data.calgary.ca/d/gs4m-mdc2) (GTFS-RT) | route of each trip and predicted stop arrivals |
| [Stops By Route](https://data.calgary.ca/d/pm3p-838w) (SODA) | stops near Home/Work for your routes |
| OpenStreetMap Nominatim | address search |
| OpenStreetMap tiles | map |

Notes on the feeds, all handled in code:

- `/download/...` links redirect without CORS headers, so the app reads `api/views/<id>.json` for the current `blobId` and fetches `api/views/<id>/files/<blobId>`, skipping the download when the blob hasn't changed.
- The published trip-update file is sometimes truncated mid-record; decoding keeps every complete entity, and trips are remembered for 15 minutes across polls.
- In the evening some trip-update times are stamped a day ahead; they're corrected against the feed timestamp.

The departure stop for each route is the nearest stop to your origin that a live trip visits *before* a stop near your destination, so you don't get sent to the wrong side of the street. Walking time is a straight-line estimate (× 1.3 at 5 km/h).

## Attribution

Contains information licensed under the [Open Government Licence – City of Calgary](https://data.calgary.ca/stories/s/Open-Calgary-Terms-of-Use/u45n-7awa). Map data © OpenStreetMap contributors.
