// SP.1 — the sweep-preset store. Two halves: the PURE parsers (no DB) and the
// read/write path over the real (in-memory, auto-migrated) SQLite DB. The DB is
// shared across suites and `app_settings` is a table other suites read, so the
// 'sweep-presets' row is dropped before every test AND in afterAll — a leaked
// row would change what a later suite's GET (or an explorer listing) sees.

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { appSettings } from '../../db/shared-schema.ts';
import { SWEEP, type SweepConfig } from '../../shared/radarSweep.ts';
import {
  MAX_NAME_CHARS,
  MAX_PRESETS,
  SWEEP_PRESETS_KEY,
  deleteSweepPreset,
  findSweepPreset,
  listSweepPresets,
  parsePresetName,
  parseStoredPresets,
  saveSweepPreset,
  sortPresets,
} from './sweepPresets.ts';

function dropRow(): void {
  db.delete(appSettings).where(eq(appSettings.key, SWEEP_PRESETS_KEY)).run();
}

function writeRaw(value: unknown): void {
  db.insert(appSettings)
    .values({ key: SWEEP_PRESETS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run();
}

const BIG: SweepConfig = { ...SWEEP, minViews: 5000, maxViews: 100_000, maxLikes: 0 };

beforeEach(() => {
  dropRow();
});

afterAll(() => {
  dropRow();
});

describe('parsePresetName', () => {
  test('trims and accepts', () => {
    expect(parsePresetName('  Big accounts  ')).toEqual({ ok: true, name: 'Big accounts' });
  });

  test('refuses empty, whitespace-only and non-strings', () => {
    for (const raw of ['', '   ', 42, null, undefined, {}]) {
      expect(parsePresetName(raw).ok).toBe(false);
    }
  });

  test('exactly MAX_NAME_CHARS passes, one over fails', () => {
    expect(parsePresetName('n'.repeat(MAX_NAME_CHARS)).ok).toBe(true);
    expect(parsePresetName('n'.repeat(MAX_NAME_CHARS + 1)).ok).toBe(false);
  });
});

describe('parseStoredPresets', () => {
  test('a garbage row is no presets, never a throw', () => {
    for (const raw of [null, 7, 'nope', {}, { presets: 'nope' }]) {
      expect(parseStoredPresets(raw)).toEqual([]);
    }
  });

  test('skips entries without a usable name rather than failing the list', () => {
    const out = parseStoredPresets([
      { name: 'Keep', values: BIG },
      { name: '  ', values: BIG },
      { values: BIG },
      'nope',
    ]);
    expect(out.map((p) => p.name)).toEqual(['Keep']);
  });

  test('a missing or drifted field degrades to the shipped default, field by field', () => {
    const [preset] = parseStoredPresets([
      { name: 'Partial', values: { minViews: 5000, verifiedOnly: 'yes' } },
    ]);
    expect(preset?.values.minViews).toBe(5000);
    // Both the absent field and the wrong-typed one fall back — never undefined.
    expect(preset?.values.maxViews).toBe(SWEEP.maxViews);
    expect(preset?.values.verifiedOnly).toBe(SWEEP.verifiedOnly);
  });

  test('duplicate names collapse to one, last write winning', () => {
    const out = parseStoredPresets([
      { name: 'Dup', values: { ...SWEEP, minViews: 1 } },
      { name: 'DUP', values: { ...SWEEP, minViews: 2 } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.values.minViews).toBe(2);
  });

  test('reads both the bare array and the {presets} wrapper', () => {
    expect(parseStoredPresets([{ name: 'A', values: BIG }])).toHaveLength(1);
    expect(parseStoredPresets({ presets: [{ name: 'A', values: BIG }] })).toHaveLength(1);
  });
});

describe('sortPresets', () => {
  test('alphabetical, case-insensitive — never most-recently-used', () => {
    const mk = (name: string) => ({ name, values: SWEEP, updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(sortPresets([mk('zebra'), mk('Alpha'), mk('beta')]).map((p) => p.name)).toEqual([
      'Alpha',
      'beta',
      'zebra',
    ]);
  });
});

describe('save / list / find / delete', () => {
  test('no row is no presets', () => {
    expect(listSweepPresets()).toEqual([]);
  });

  test('a saved preset round-trips whole', () => {
    const saved = saveSweepPreset('Big accounts', BIG);
    expect(saved.ok).toBe(true);
    const [preset] = listSweepPresets();
    expect(preset?.name).toBe('Big accounts');
    expect(preset?.values).toEqual(BIG);
  });

  test('re-saving a name overwrites in place and does not grow the list', () => {
    saveSweepPreset('Hunt', SWEEP);
    saveSweepPreset('HUNT', BIG);
    const presets = listSweepPresets();
    expect(presets).toHaveLength(1);
    // The display case is whatever was typed LAST.
    expect(presets[0]?.name).toBe('HUNT');
    expect(presets[0]?.values.minViews).toBe(BIG.minViews);
  });

  test('the cap refuses a new name but never an overwrite', () => {
    for (let i = 0; i < MAX_PRESETS; i++) saveSweepPreset(`p${i}`, SWEEP);
    expect(saveSweepPreset('one too many', SWEEP)).toEqual({
      ok: false,
      error: 'too_many_presets',
    });
    // At the cap, re-saving an existing name still works — it adds nothing.
    expect(saveSweepPreset('p0', BIG).ok).toBe(true);
    expect(listSweepPresets()).toHaveLength(MAX_PRESETS);
  });

  test('find is case-insensitive; a miss is null', () => {
    saveSweepPreset('Small accounts', SWEEP);
    expect(findSweepPreset('SMALL ACCOUNTS')?.name).toBe('Small accounts');
    expect(findSweepPreset('nothing')).toBeNull();
  });

  test('delete removes one and reports whether it did', () => {
    saveSweepPreset('A', SWEEP);
    saveSweepPreset('B', BIG);
    expect(deleteSweepPreset('a')).toMatchObject({ deleted: true });
    expect(listSweepPresets().map((p) => p.name)).toEqual(['B']);
    expect(deleteSweepPreset('A').deleted).toBe(false);
  });

  test('emptying the list drops the ROW — "no presets" has one representation', () => {
    saveSweepPreset('Only', SWEEP);
    expect(
      db.select().from(appSettings).where(eq(appSettings.key, SWEEP_PRESETS_KEY)).get(),
    ).toBeDefined();
    deleteSweepPreset('Only');
    expect(
      db.select().from(appSettings).where(eq(appSettings.key, SWEEP_PRESETS_KEY)).get(),
    ).toBeUndefined();
    expect(listSweepPresets()).toEqual([]);
  });

  test('a hand-edited row degrades on read instead of throwing on save', () => {
    writeRaw({ nonsense: true });
    expect(listSweepPresets()).toEqual([]);
    expect(saveSweepPreset('Fresh', BIG).ok).toBe(true);
    expect(listSweepPresets().map((p) => p.name)).toEqual(['Fresh']);
  });
});
