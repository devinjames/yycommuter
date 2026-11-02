import type { Place, Settings } from './types';

export const STORAGE_KEY = 'yycommuter.settings';
const REFRESH_OPTIONS = [15, 30, 60] as const;

export function defaultSettings(): Settings {
  return { version: 1, home: null, work: null, routes: [], refreshSec: 30, stopCache: {} };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isPlace(v: unknown): v is Place {
  return isObj(v) && isFiniteNum(v.lat) && isFiniteNum(v.lon) && typeof v.label === 'string';
}

/** Parse persisted settings; any invalid or unknown-version payload yields defaults. */
export function parseSettings(raw: string | null): Settings {
  if (raw == null) return defaultSettings();
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return defaultSettings();
  }
  if (!isObj(v) || v.version !== 1) return defaultSettings();
  if (v.home != null && !isPlace(v.home)) return defaultSettings();
  if (v.work != null && !isPlace(v.work)) return defaultSettings();
  if (!Array.isArray(v.routes) || !v.routes.every((r) => typeof r === 'string')) return defaultSettings();

  const refreshSec = (REFRESH_OPTIONS as readonly unknown[]).includes(v.refreshSec)
    ? (v.refreshSec as Settings['refreshSec'])
    : 30;
  const stopCache: Record<string, string> = {};
  if (isObj(v.stopCache)) {
    for (const [k, val] of Object.entries(v.stopCache)) if (typeof val === 'string') stopCache[k] = val;
  }
  const place = (p: unknown): Place | null =>
    isPlace(p) ? { lat: p.lat, lon: p.lon, label: p.label } : null;

  return {
    version: 1,
    home: place(v.home),
    work: place(v.work),
    routes: [...new Set(v.routes as string[])],
    refreshSec,
    stopCache,
  };
}

export function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode / quota) — settings live for this session only */
  }
}

export function isConfigured(s: Settings): boolean {
  return s.home != null && s.work != null && s.routes.length > 0;
}
