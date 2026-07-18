// S3.1 brand kit — the export/import JSON round-trip and the lenient-parse
// contract (bad fields fall back to defaults; only non-JSON is rejected).

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_BRAND_KIT,
  normalizeHandle,
  parseBrandKit,
  serializeBrandKit,
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
