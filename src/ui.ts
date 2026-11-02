import { formatEta, leaveText, type RouteStatus } from './trip';
import type { MapView } from './map';
import { routeColor } from './map';
import type { Direction, LatLon, Place, Settings } from './types';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const placeName = (d: Direction, which: 'origin' | 'dest') =>
  (d === 'toWork') === (which === 'origin') ? 'Home' : 'Work';

export type StatusModel = {
  configured: boolean;
  direction: Direction;
  updatedAgoSec: number | null;
  error: string | null;
  noGeo: boolean;
  radiusFor: (route: string) => number;
  rows: RouteStatus[];
};

export type StatusHandlers = {
  onToggleDirection(): void;
  onRowTap(r: RouteStatus): void;
  onWiden(route: string): void;
  onOpenSettings(): void;
};

function ago(sec: number | null): string {
  if (sec == null) return 'loading…';
  if (sec < 60) return `updated ${Math.max(0, Math.round(sec))} s ago`;
  return `updated ${Math.round(sec / 60)} min ago`;
}

function rowHtml(r: RouteStatus, m: StatusModel): string {
  const chip = `<span class="route-chip" style="--c:${routeColor(r.route)}">${esc(r.route)}</span>`;
  const origin = placeName(m.direction, 'origin');
  if (r.reason === 'noStops') {
    const radius = m.radiusFor(r.route);
    return `<li class="row row--empty">${chip}<div class="row-body">
      <div class="row-title">No route ${esc(r.route)} stop within ${radius} m of ${origin}</div>
      ${radius < 1500 ? `<button class="link" data-widen="${esc(r.route)}">Search within 1500 m</button>` : ''}
    </div></li>`;
  }
  const stopLine = `${esc(r.stop!.name)}${r.verified ? '' : ' <span class="muted">(direction unverified)</span>'}`;
  if (!r.next) {
    return `<li class="row row--empty" data-route="${esc(r.route)}">${chip}<div class="row-body">
      <div class="row-title">${stopLine}</div>
      <div class="row-meta">No live buses on route ${esc(r.route)}</div></div></li>`;
  }
  const n = r.next;
  return `<li class="row" data-route="${esc(r.route)}" tabindex="0" role="button">${chip}<div class="row-body">
      <div class="row-title">${stopLine}</div>
      <div class="row-meta">Bus in ${formatEta(n.etaSec)} · Walk ${Math.round(r.walkMin)} min</div>
    </div>
    <div class="leave leave--${n.level}">${esc(leaveText(n, r.following))}</div></li>`;
}

export function renderStatus(el: HTMLElement, m: StatusModel, h: StatusHandlers): void {
  const dirLabel = m.direction === 'toWork' ? '→ Work' : '→ Home';
  const body = !m.configured
    ? `<p class="empty">Set your Home, Work and bus routes to get started.</p>
       <button class="btn btn--primary" data-open-settings>Set up</button>`
    : m.rows.length
      ? `<ul class="rows">${m.rows.map((r) => rowHtml(r, m)).join('')}</ul>`
      : `<p class="empty">Loading…</p>`;
  const collapsed = el.classList.contains('is-collapsed');
  el.innerHTML = `
    <div class="sheet-handle" data-handle aria-label="${collapsed ? 'Expand' : 'Collapse'} status"></div>
    <header class="sheet-head">
      <button class="dir" data-toggle-dir aria-label="Switch direction">${dirLabel} <span aria-hidden="true">⇄</span></button>
      <span class="updated">${ago(m.updatedAgoSec)}</span>
    </header>
    ${m.error ? `<div class="banner banner--warn">${esc(m.error)}</div>` : ''}
    ${m.noGeo && m.configured ? `<div class="banner">Location unavailable — assuming you're at ${placeName(m.direction, 'origin')}</div>` : ''}
    ${body}`;

  el.onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-toggle-dir]')) return h.onToggleDirection();
    if (t.closest('[data-open-settings]')) return h.onOpenSettings();
    const widen = t.closest<HTMLElement>('[data-widen]');
    if (widen) return h.onWiden(widen.dataset.widen!);
    if (t.closest('[data-handle]')) return void el.classList.toggle('is-collapsed');
    const row = t.closest<HTMLElement>('.row[data-route]');
    const r = row && m.rows.find((x) => x.route === row.dataset.route);
    if (r) h.onRowTap(r);
  };
  el.onkeydown = (e) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).matches('.row[data-route]')) (e.target as HTMLElement).click();
  };
}

/** Swipe the sheet handle down/up to collapse/expand. */
export function enableSheetDrag(el: HTMLElement): void {
  let startY: number | null = null;
  el.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('[data-handle], .sheet-head')) startY = e.clientY;
  });
  window.addEventListener('pointerup', (e) => {
    if (startY == null) return;
    const dy = e.clientY - startY;
    startY = null;
    if (dy > 40) el.classList.add('is-collapsed');
    else if (dy < -40) el.classList.remove('is-collapsed');
  });
}

export type SettingsDeps = {
  el: HTMLElement;
  map: MapView;
  getUserPos(): LatLon | null;
  searchAddress(q: string): Promise<Place[]>;
  routeExists(route: string): Promise<boolean>;
};

export function openSettings(initial: Settings, deps: SettingsDeps, onChange: (s: Settings) => void): void {
  const { el } = deps;
  let s: Settings = structuredClone(initial);
  let results: { which: 'home' | 'work'; places: Place[] } | null = null;
  let msg: { which: 'home' | 'work' | 'routes'; text: string } | null = null;
  let picking: { which: 'home' | 'work'; stop: () => void } | null = null;

  const commit = (next: Settings) => {
    s = next;
    onChange(structuredClone(s));
    render();
  };
  const close = () => {
    picking?.stop();
    el.hidden = true;
    document.body.classList.remove('settings-open', 'picking');
  };

  const placeBlock = (which: 'home' | 'work') => {
    const p = s[which];
    const title = which === 'home' ? '🏠 Home' : '💼 Work';
    const res = results?.which === which ? results.places : null;
    return `<fieldset class="field">
      <legend>${title}</legend>
      <div class="place-current">${p ? esc(p.label) : '<span class="muted">Not set</span>'}</div>
      <form class="search" data-search="${which}">
        <input name="q" type="search" placeholder="Search an address" autocomplete="street-address" aria-label="${title} address" />
        <button class="btn" type="submit">Search</button>
      </form>
      ${msg?.which === which ? `<div class="field-msg">${esc(msg.text)}</div>` : ''}
      ${res ? `<ul class="results">${res.map((r, i) => `<li><button class="link" data-pick="${which}" data-i="${i}">${esc(r.label)}</button></li>`).join('')}</ul>` : ''}
      <div class="btn-row">
        <button class="btn" data-here="${which}">Use current location</button>
        ${p ? `<button class="btn" data-adjust="${which}">Adjust pin</button>` : ''}
      </div>
    </fieldset>`;
  };

  function render() {
    if (picking) {
      const name = picking.which === 'home' ? 'Home' : 'Work';
      el.innerHTML = `<div class="pick-bar"><span>Drag the pin or tap the map to set ${name}</span>
        <button class="btn btn--primary" data-pick-done>Done</button></div>`;
      return;
    }
    el.innerHTML = `
      <header class="settings-head"><h2>Settings</h2><button class="btn btn--primary" data-close>Done</button></header>
      ${placeBlock('home')}
      ${placeBlock('work')}
      <fieldset class="field">
        <legend>🚌 Bus routes</legend>
        <div class="chips">${s.routes.map((r) => `<span class="route-chip route-chip--x" style="--c:${routeColor(r)}">${esc(r)}<button aria-label="Remove route ${esc(r)}" data-remove="${esc(r)}">×</button></span>`).join('') || '<span class="muted">None yet</span>'}</div>
        <form class="search" data-add-route>
          <input name="route" inputmode="numeric" placeholder="Route number, e.g. 3" aria-label="Route number" maxlength="5" />
          <button class="btn" type="submit">Add</button>
        </form>
        ${msg?.which === 'routes' ? `<div class="field-msg">${esc(msg.text)}</div>` : ''}
      </fieldset>
      <fieldset class="field">
        <legend>Refresh every</legend>
        <div class="seg">${[15, 30, 60].map((n) => `<button class="${s.refreshSec === n ? 'is-on' : ''}" data-refresh="${n}">${n} s</button>`).join('')}</div>
      </fieldset>
      <p class="fine">Live data: City of Calgary Open Data (GTFS-RT). Addresses: OpenStreetMap Nominatim. Walk times are straight-line estimates.</p>`;
  }

  const startPick = (which: 'home' | 'work', at: LatLon) => {
    picking?.stop();
    document.body.classList.add('picking');
    const label = s[which]?.label ?? 'Dropped pin';
    if (!s[which]) commit({ ...s, [which]: { ...at, label } });
    const stop = deps.map.enablePinPick(at, (p) => {
      s = { ...s, [which]: { ...p, label: s[which]?.label ?? label }, stopCache: {} };
      onChange(structuredClone(s));
    });
    picking = { which, stop };
    render();
  };

  el.onclick = async (e) => {
    const t = e.target as HTMLElement;
    const btn = t.closest<HTMLElement>('button');
    if (!btn) return;
    const d = btn.dataset;
    if (d.close !== undefined) return close();
    if (d.pickDone !== undefined) {
      picking?.stop();
      picking = null;
      document.body.classList.remove('picking');
      return render();
    }
    if (d.pick) {
      const which = d.pick as 'home' | 'work';
      const place = results?.places[Number(d.i)];
      if (!place) return;
      results = null;
      commit({ ...s, [which]: place, stopCache: {} });
      return startPick(which, place);
    }
    if (d.here) {
      const which = d.here as 'home' | 'work';
      const p = deps.getUserPos();
      if (!p) {
        msg = { which, text: 'Current location unavailable.' };
        return render();
      }
      msg = null;
      commit({ ...s, [which]: { ...p, label: 'Current location' }, stopCache: {} });
      return startPick(which, p);
    }
    if (d.adjust) {
      const which = d.adjust as 'home' | 'work';
      return startPick(which, s[which]!);
    }
    if (d.remove) return commit({ ...s, routes: s.routes.filter((r) => r !== d.remove) });
    if (d.refresh) return commit({ ...s, refreshSec: Number(d.refresh) as Settings['refreshSec'] });
  };

  el.onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const btn = form.querySelector('button');
    if (form.dataset.search) {
      const which = form.dataset.search as 'home' | 'work';
      const q = (form.elements.namedItem('q') as HTMLInputElement).value.trim();
      if (!q) return;
      btn?.setAttribute('disabled', '');
      try {
        const places = await deps.searchAddress(q);
        results = { which, places };
        msg = places.length ? null : { which, text: 'No matches in Calgary. Try another address, or use “Use current location” and adjust the pin.' };
      } catch {
        msg = { which, text: 'Address search is unavailable right now. You can still drop a pin.' };
      }
      return render();
    }
    if (form.dataset.addRoute !== undefined) {
      const route = (form.elements.namedItem('route') as HTMLInputElement).value.trim().toUpperCase();
      if (!route) return;
      if (s.routes.includes(route)) {
        msg = { which: 'routes', text: `Route ${route} is already added.` };
        return render();
      }
      btn?.setAttribute('disabled', '');
      try {
        if (!(await deps.routeExists(route))) {
          msg = { which: 'routes', text: `Route ${route} not found.` };
          return render();
        }
        msg = null;
        commit({ ...s, routes: [...s.routes, route] });
      } catch {
        msg = { which: 'routes', text: 'Couldn’t check that route right now. Try again.' };
        render();
      }
    }
  };

  el.hidden = false;
  document.body.classList.add('settings-open');
  render();
}
