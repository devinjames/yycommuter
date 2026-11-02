import { describe, expect, it } from 'vitest';
import { defaultSettings, isConfigured, parseSettings } from '../src/storage';
import type { Settings } from '../src/types';

const filled: Settings = {
  version: 1,
  home: { lat: 51.1, lon: -114.1, label: 'Home St' },
  work: { lat: 51.04, lon: -114.07, label: 'Work Ave' },
  routes: ['3', '300'],
  refreshSec: 15,
  stopCache: { '3|toWork': '5431' },
};

describe('parseSettings', () => {
  it('round-trips a valid settings object', () => {
    expect(parseSettings(JSON.stringify(filled))).toEqual(filled);
  });
  it.each([
    ['null', null],
    ['malformed JSON', '{bad'],
    ['wrong version', '{"version":2}'],
    ['non-numeric home lat', JSON.stringify({ ...filled, home: { lat: 'x', lon: -114, label: 'h' } })],
    ['routes not strings', JSON.stringify({ ...filled, routes: [3] })],
  ])('returns defaults for %s', (_name, raw) => {
    expect(parseSettings(raw)).toEqual(defaultSettings());
  });
  it('coerces an unsupported refreshSec to 30', () => {
    expect(parseSettings(JSON.stringify({ ...filled, refreshSec: 45 })).refreshSec).toBe(30);
  });
  it('drops non-string stopCache values', () => {
    const s = parseSettings(JSON.stringify({ ...filled, stopCache: { a: '1', b: 2 } }));
    expect(s.stopCache).toEqual({ a: '1' });
  });
});

describe('isConfigured', () => {
  it('is false for defaults', () => expect(isConfigured(defaultSettings())).toBe(false));
  it('is true when home, work and routes are set', () => expect(isConfigured(filled)).toBe(true));
  it('is false with no routes', () => expect(isConfigured({ ...filled, routes: [] })).toBe(false));
});
