// S3.1 brand kit — the export/import JSON round-trip and the lenient-parse
// contract (bad fields fall back to defaults; only non-JSON is rejected).

import { describe, expect, test } from 'bun:test';
import {
  type BrandKits,
  DEFAULT_BRAND_KIT,
  STARTER_ACTIVE,
  STARTER_KITS,
  canDeletePreset,
  deletePreset,
  normalizeHandle,
  parseBrandKit,
  parseBrandKitsFile,
  patchActiveKit,
  renamePreset,
  savePresetAs,
  serializeBrandKit,
  serializeBrandKits,
  setActivePreset,
} from './brandKit.ts';

describe('brand kit round-trip', () => {
  test('serialize → parse is identity', () => {
    const kit = {
      bg: '#101010',
      accent: '#ff6600',
      fontFamily: "'StudioInter', sans-serif",
      handle: 'narcis',
      watermark: false,
      watermarkText: 'made by hand',
      imageStyleSuffix: 'flat vector, no text',
      // non-default so the round-trip proves the field is read, not defaulted
      mascot: false,
    };
    expect(parseBrandKit(serializeBrandKit(kit))).toEqual(kit);
  });

  test('empty object fills every default', () => {
    expect(parseBrandKit('{}')).toEqual(DEFAULT_BRAND_KIT);
  });

  test('invalid colors and types fall back field-by-field', () => {
    const parsed = parseBrandKit(
      JSON.stringify({
        bg: 'not-a-color',
        accent: '#abc',
        handle: '@Somebody',
        watermark: 'yes',
        watermarkText: '   ',
      }),
    );
    expect(parsed).toEqual({
      ...DEFAULT_BRAND_KIT,
      accent: '#abc',
      handle: 'Somebody',
    });
  });

  test('non-object JSON and garbage are rejected outright', () => {
    expect(parseBrandKit('42')).toBeNull();
    expect(parseBrandKit('[1,2]')).toBeNull();
    expect(parseBrandKit('{nope')).toBeNull();
  });

  test('legacy kit without a mascot field reads as mascot:true', () => {
    const parsed = parseBrandKit(JSON.stringify({ bg: '#101010', accent: '#ff6600' }));
    expect(parsed?.mascot).toBe(true);
  });

  test('non-boolean mascot falls back to the default', () => {
    expect(parseBrandKit(JSON.stringify({ mascot: 'nope' }))?.mascot).toBe(true);
  });

  test('mascot:false round-trips (opt-out survives export/import)', () => {
    const off = parseBrandKit(serializeBrandKit({ ...DEFAULT_BRAND_KIT, mascot: false }));
    expect(off?.mascot).toBe(false);
  });
});

describe('normalizeHandle', () => {
  test('strips @ and whitespace, keeps case', () => {
    expect(normalizeHandle(' @Narcis13 ')).toBe('Narcis13');
    expect(normalizeHandle('plain')).toBe('plain');
  });
});

describe('multi-preset (S5.4)', () => {
  const two: BrandKits = {
    active: 'Neon',
    kits: {
      Midnight: { ...DEFAULT_BRAND_KIT },
      Neon: { ...DEFAULT_BRAND_KIT, bg: '#0a0e12', accent: '#00e5a0' },
    },
  };

  test('starter presets each carry every field (mascot included)', () => {
    expect(STARTER_ACTIVE in STARTER_KITS).toBe(true);
    for (const kit of Object.values(STARTER_KITS)) {
      expect(kit.mascot).toBe(true);
      expect(kit).toMatchObject({
        fontFamily: expect.any(String),
        watermarkText: expect.any(String),
      });
    }
  });

  test('legacy single-kit JSON imports into the multi shape', () => {
    const legacy = serializeBrandKit({ ...DEFAULT_BRAND_KIT, accent: '#ff6600', handle: 'narcis' });
    const parsed = parseBrandKitsFile(legacy);
    expect(parsed).not.toBeNull();
    expect(parsed?.active).toBe('default');
    expect(Object.keys(parsed?.kits ?? {})).toEqual(['default']);
    expect(parsed?.kits.default).toMatchObject({ accent: '#ff6600', handle: 'narcis' });
  });

  test('multi bundle round-trips through serialize → parse', () => {
    expect(parseBrandKitsFile(serializeBrandKits(two))).toEqual(two);
  });

  test('corrupt per-kit fields fall back but the kit survives', () => {
    const parsed = parseBrandKitsFile(
      JSON.stringify({ active: 'x', kits: { a: { bg: 'not-a-color', accent: '#abc' } } }),
    );
    // active pointer clamps to the only real kit; the bad bg defaults, accent kept
    expect(parsed?.active).toBe('a');
    expect(parsed?.kits.a).toEqual({ ...DEFAULT_BRAND_KIT, accent: '#abc' });
  });

  test('a bundle with no salvageable kit is null', () => {
    expect(parseBrandKitsFile(JSON.stringify({ kits: {} }))).toBeNull();
    expect(parseBrandKitsFile('42')).toBeNull();
  });

  test('the last preset cannot be deleted (pure guard + no-op)', () => {
    const one: BrandKits = { active: 'only', kits: { only: { ...DEFAULT_BRAND_KIT } } };
    expect(canDeletePreset(one, 'only')).toBe(false);
    expect(deletePreset(one, 'only')).toEqual(one);
  });

  test('deleting the active preset reassigns active to a survivor', () => {
    expect(canDeletePreset(two, 'Neon')).toBe(true);
    const next = deletePreset(two, 'Neon');
    expect(Object.keys(next.kits)).toEqual(['Midnight']);
    expect(next.active).toBe('Midnight');
  });

  test('setActivePreset only accepts a known name', () => {
    expect(setActivePreset(two, 'Midnight').active).toBe('Midnight');
    expect(setActivePreset(two, 'nope').active).toBe('Neon');
  });

  test('savePresetAs adds and activates; blank name is a no-op', () => {
    const saved = savePresetAs(two, 'Paper', { ...DEFAULT_BRAND_KIT, bg: '#f7f9f9' });
    expect(saved.active).toBe('Paper');
    expect(saved.kits.Paper).toMatchObject({ bg: '#f7f9f9' });
    expect(savePresetAs(two, '  ', DEFAULT_BRAND_KIT)).toEqual(two);
  });

  test('renamePreset moves the entry and follows the active pointer', () => {
    const renamed = renamePreset(two, 'Neon', 'Vivid');
    expect(Object.keys(renamed.kits).sort()).toEqual(['Midnight', 'Vivid']);
    expect(renamed.active).toBe('Vivid');
    expect(renamePreset(two, 'ghost', 'x')).toEqual(two);
  });

  test('patchActiveKit edits only the active kit', () => {
    const patched = patchActiveKit(two, { handle: 'edited' });
    expect(patched.kits.Neon.handle).toBe('edited');
    expect(patched.kits.Midnight.handle).toBe(DEFAULT_BRAND_KIT.handle);
  });
});
