import { beforeEach, describe, expect, it } from 'bun:test';
import {
  DEFAULT_DENSITY,
  DEFAULT_THEME,
  DEFAULT_UI_SCALE,
  getSettings,
  normalizeDensity,
  normalizeScale,
  normalizeTheme,
  patchSettings,
  resolveTheme,
  saveSettings,
} from './storage.ts';

// In-memory chrome.storage.local so the round-trip runs without a browser.
let store: Record<string, unknown> = {};
beforeEach(() => {
  store = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys: string[]) => {
          const out: Record<string, unknown> = {};
          for (const k of keys) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (obj: Record<string, unknown>) => {
          Object.assign(store, obj);
        },
      },
    },
  };
});

describe('appearance settings (UI.9)', () => {
  it('defaults to system / cozy / 13 on an empty store', async () => {
    const s = await getSettings();
    expect(s.theme).toBe(DEFAULT_THEME);
    expect(s.density).toBe(DEFAULT_DENSITY);
    expect(s.uiScale).toBe(DEFAULT_UI_SCALE);
  });

  it('round-trips the three keys through saveSettings', async () => {
    await saveSettings({
      apiUrl: 'http://x',
      bearer: 'tok',
      applyPillarsToReplies: false,
      autoTypeReplyDraft: false,
      passiveCapture: true,
      theme: 'light',
      density: 'compact',
      uiScale: 14,
    });
    const s = await getSettings();
    expect(s.theme).toBe('light');
    expect(s.density).toBe('compact');
    expect(s.uiScale).toBe(14);
  });

  it('patchSettings updates one appearance key without touching others', async () => {
    await patchSettings({ density: 'compact', uiScale: 12 });
    await patchSettings({ theme: 'dark' });
    const s = await getSettings();
    expect(s.theme).toBe('dark');
    expect(s.density).toBe('compact');
    expect(s.uiScale).toBe(12);
  });

  it('normalizes out-of-range / garbage values to the defaults', () => {
    expect(normalizeTheme('neon')).toBe('system');
    expect(normalizeTheme(null)).toBe('system');
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeDensity('spacious')).toBe('cozy');
    expect(normalizeDensity('compact')).toBe('compact');
    expect(normalizeScale(11)).toBe(13);
    expect(normalizeScale(16)).toBe(13);
    expect(normalizeScale(14)).toBe(14);
    expect(normalizeScale('14' as unknown)).toBe(13);
  });
});

describe('resolveTheme', () => {
  it('follows the OS when preference is system', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
  });
  it('honors an explicit preference regardless of the OS', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });
});
