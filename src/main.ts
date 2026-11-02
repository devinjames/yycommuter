import './style.css';
import { createFeedClient, TU_ID, VP_ID, type FeedMessage } from './feeds';
import { searchAddress } from './geocode';
import { createMap, type BusMarkerItem } from './map';
import { buildBuses, createTripMemory, nextArrival } from './realtime';
import { fetchStopsNear, routeExists } from './stops';
import { isConfigured, loadSettings, saveSettings } from './storage';
import { chooseDirection, computeRouteStatus, formatEta, selectDepartureStop, sortRows, type RouteStatus } from './trip';
import type { Direction, LatLon, Settings } from './types';
import { enableSheetDrag, openSettings, renderStatus } from './ui';

const STALE_SEC = 120;
const BACKOFF_SEC = [30, 60, 120];
const RADIUS_M = 800;
const WIDE_RADIUS_M = 1500;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sheet = $('sheet');
const settingsEl = $('settings');
const map = createMap($('map'));
const feeds = createFeedClient();
const tripMemory = createTripMemory();

const state = {
  settings: loadSettings(),
  user: null as LatLon | null,
  noGeo: false,
  override: null as Direction | null,
  vp: null as FeedMessage | null,
  tu: null as FeedMessage | null,
  dataTime: null as number | null, // epoch s of last successful feed
  feedError: false,
  stopsError: false,
  failures: 0,
  widened: new Set<string>(),
  rows: [] as RouteStatus[],
  direction: 'toWork' as Direction,
  timer: 0 as number | undefined,
};

const nowSec = () => Date.now() / 1000;

// ---------- rendering ----------

function render() {
  const updatedAgo = state.dataTime == null ? null : nowSec() - state.dataTime;
  renderStatus(
    sheet,
    {
      configured: isConfigured(state.settings),
      direction: state.direction,
      updatedAgoSec: updatedAgo,
      error: state.feedError
        ? '⚠ Live data unavailable — retrying'
        : state.stopsError
          ? '⚠ Couldn’t load stops — retrying'
          : null,
      noGeo: state.noGeo,
      radiusFor: (r) => (state.widened.has(r) ? WIDE_RADIUS_M : RADIUS_M),
      rows: state.rows,
    },
    {
      onToggleDirection() {
        state.override = state.direction === 'toWork' ? 'toHome' : 'toWork';
        void compute();
      },
      onRowTap(r) {
        const pts: LatLon[] = [];
        if (r.stop) pts.push(r.stop.pos);
        if (r.next) pts.push(r.next.bus.pos);
        if (state.user) pts.push(state.user);
        map.fitTo(pts);
      },
      onWiden(route) {
        state.widened.add(route);
        void compute();
      },
      onOpenSettings: showSettings,
    },
  );
}

/** Recompute everything derived from the latest feeds, location and settings. */
let computing: Promise<void> | null = null;
let computeAgain = false;
async function compute(): Promise<void> {
  if (computing) {
    computeAgain = true;
    return computing;
  }
  computing = (async () => {
    do {
      computeAgain = false;
      await computeOnce();
    } while (computeAgain);
  })().finally(() => (computing = null));
  return computing;
}

async function computeOnce() {
  const s = state.settings;
  map.setPlaces(s.home, s.work);
  if (!isConfigured(s) || !s.home || !s.work) {
    state.rows = [];
    map.setStops([]);
    map.setBuses([]);
    return render();
  }
  const now = nowSec();
  const buses = state.vp && state.tu ? buildBuses(state.vp, state.tu, s.routes) : [];
  const dir = chooseDirection(state.user, s.home, s.work, state.override);
  state.direction = dir;
  const origin = dir === 'toWork' ? s.home : s.work;
  const dest = dir === 'toWork' ? s.work : s.home;

  let stopsError = false;
  const rows = await Promise.all(
    s.routes.map(async (route) => {
      const radius = state.widened.has(route) ? WIDE_RADIUS_M : RADIUS_M;
      let originStops: Awaited<ReturnType<typeof fetchStopsNear>> = [];
      let destStops: typeof originStops = [];
      try {
        [originStops, destStops] = await Promise.all([
          fetchStopsNear(origin, radius, [route]),
          fetchStopsNear(dest, radius, [route]),
        ]);
      } catch {
        stopsError = true;
      }
      const key = `${route}|${dir}`;
      const sel = selectDepartureStop(route, originStops, destStops, buses, s.stopCache[key], origin);
      if (sel?.verified && s.stopCache[key] !== sel.stop.id) {
        state.settings = { ...state.settings, stopCache: { ...state.settings.stopCache, [key]: sel.stop.id } };
        saveSettings(state.settings);
      }
      return computeRouteStatus(route, sel?.stop ?? null, sel?.verified ?? false, buses, state.user, origin, now);
    }),
  );
  state.stopsError = stopsError;

  state.rows = sortRows(rows);

  const stopFor = new Map(rows.filter((r) => r.stop).map((r) => [r.route, r.stop!]));
  const dataStale = state.dataTime == null || now - state.dataTime > STALE_SEC;
  const items: BusMarkerItem[] = buses.map((bus) => {
    const stop = stopFor.get(bus.routeId);
    const t = stop ? nextArrival(bus, stop.id, now) : null;
    return {
      bus,
      label: !stop ? '—' : t == null ? 'passed' : formatEta(t - now),
      dim: !!stop && t == null,
      stale: dataStale || now - bus.updatedAt > STALE_SEC,
    };
  });
  map.setStops([...stopFor.values()]);
  map.setBuses(items);
  render();
}

// ---------- feed polling ----------

async function poll() {
  window.clearTimeout(state.timer);
  try {
    const [vp, tu] = await Promise.all([feeds.fetchFeed(VP_ID), feeds.fetchFeed(TU_ID)]);
    state.vp = vp;
    state.tu = tripMemory.merge(tu, nowSec());
    state.dataTime = Number(vp.header?.timestamp) || nowSec();
    state.feedError = false;
    state.failures = 0;
  } catch (e) {
    console.warn('feed refresh failed', e);
    state.feedError = true;
    state.failures++;
  }
  await compute();
  schedule();
}

function schedule() {
  window.clearTimeout(state.timer);
  if (document.visibilityState !== 'visible') return;
  const delay = state.feedError
    ? BACKOFF_SEC[Math.min(state.failures - 1, BACKOFF_SEC.length - 1)]
    : state.settings.refreshSec;
  state.timer = window.setTimeout(poll, delay * 1000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void poll();
  else window.clearTimeout(state.timer);
});

// Countdowns and "updated N s ago" tick without refetching.
window.setInterval(() => {
  if (document.visibilityState === 'visible') void compute();
}, 5000);

// ---------- geolocation ----------

if ('geolocation' in navigator) {
  navigator.geolocation.watchPosition(
    (pos) => {
      const first = state.user == null;
      state.user = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      state.noGeo = false;
      map.setUser(state.user, pos.coords.accuracy);
      if (first) void compute();
    },
    () => {
      state.noGeo = state.user == null; // keep using the last fix if we had one
      render();
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
  );
} else {
  state.noGeo = true;
}

// ---------- settings ----------

function showSettings() {
  openSettings(
    state.settings,
    { el: settingsEl, map, getUserPos: () => state.user, searchAddress, routeExists },
    (next: Settings) => {
      const refreshChanged = next.refreshSec !== state.settings.refreshSec;
      state.settings = next;
      saveSettings(next);
      void compute();
      if (refreshChanged) schedule();
    },
  );
}

$('settings-btn').addEventListener('click', showSettings);
$('recenter-btn').addEventListener('click', () => map.recenter());
enableSheetDrag(sheet);

render();
if (!isConfigured(state.settings)) showSettings();
void poll();
