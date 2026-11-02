// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { MapView } from '../src/map';
import { defaultSettings } from '../src/storage';
import { enableSheetDrag, openSettings } from '../src/ui';

function fakeMap() {
  const stops: Array<ReturnType<typeof vi.fn>> = [];
  const map = {
    enablePinPick: vi.fn(() => {
      const stop = vi.fn();
      stops.push(stop);
      return stop;
    }),
  } as unknown as MapView;
  return { map, stops };
}

describe('openSettings', () => {
  it('tears down an active pin-pick from a previous instance when reopened', () => {
    const el = document.createElement('section');
    document.body.append(el);
    const { map, stops } = fakeMap();
    const s = { ...defaultSettings(), home: { lat: 51.1, lon: -114.1, label: 'Home' } };
    const deps = { el, map, getUserPos: () => null, searchAddress: vi.fn(), routeExists: vi.fn() };
    openSettings(s, deps, vi.fn());
    el.querySelector<HTMLButtonElement>('[data-adjust="home"]')!.click();
    expect(map.enablePinPick).toHaveBeenCalledTimes(1);
    openSettings(s, deps, vi.fn());
    expect(stops[0]).toHaveBeenCalled();
  });
});

describe('enableSheetDrag', () => {
  const pointer = (type: string, y: number) => new PointerEvent(type, { clientY: y, bubbles: true });
  it('collapses on a downward swipe of the handle', () => {
    const sheet = document.createElement('section');
    sheet.innerHTML = '<div data-handle></div>';
    document.body.append(sheet);
    enableSheetDrag(sheet);
    sheet.querySelector('[data-handle]')!.dispatchEvent(pointer('pointerdown', 100));
    window.dispatchEvent(pointer('pointerup', 200));
    expect(sheet.classList.contains('is-collapsed')).toBe(true);
  });
  it('forgets a gesture the browser cancelled, so a later tap does not toggle the sheet', () => {
    const sheet = document.createElement('section');
    sheet.innerHTML = '<div data-handle></div>';
    document.body.append(sheet);
    enableSheetDrag(sheet);
    sheet.querySelector('[data-handle]')!.dispatchEvent(pointer('pointerdown', 100));
    window.dispatchEvent(pointer('pointercancel', 110));
    window.dispatchEvent(pointer('pointerup', 300));
    expect(sheet.classList.contains('is-collapsed')).toBe(false);
  });
});
