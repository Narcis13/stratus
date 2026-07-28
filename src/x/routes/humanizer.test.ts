// HM.2 — GET/PATCH/DELETE /x/humanizer over the real (in-memory, auto-migrated)
// SQLite DB. The DB is shared across suites and `app_settings` is a table other
// suites read, so the 'humanizer' row is deleted before every test AND in
// afterAll — a leaked row would change what a later suite's GET /x/humanizer (or
// an explorer listing) sees.

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { appSettings } from '../../db/shared-schema.ts';
import { DEFAULT_HUMANIZER } from '../../shared/humanize.ts';
import {
  HUMANIZER_SETTINGS_KEY,
  type HumanizerSettings,
  parseHumanizerPatch,
} from '../settings/humanizer.ts';
import { humanizerRouter } from './humanizer.ts';

const app = new Hono();
app.route('/x', humanizerRouter);

async function send<T>(method: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await app.request('/x/humanizer', {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  return { status: res.status, body: (await res.json()) as T };
}

function dropRow(): void {
  db.delete(appSettings).where(eq(appSettings.key, HUMANIZER_SETTINGS_KEY)).run();
}

beforeEach(() => {
  dropRow();
});

afterAll(() => {
  dropRow();
});

describe('GET /x/humanizer', () => {
  test('no row → defaults with enabled:false', async () => {
    const res = await send<HumanizerSettings>('GET');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...DEFAULT_HUMANIZER, enabled: false });
  });

  test('a garbage row degrades to defaults instead of throwing', async () => {
    db.insert(appSettings)
      .values({ key: HUMANIZER_SETTINGS_KEY, value: 'nonsense', updatedAt: new Date() })
      .run();
    const res = await send<HumanizerSettings>('GET');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...DEFAULT_HUMANIZER, enabled: false });
  });

  test('a partially-bad row falls back field by field', async () => {
    db.insert(appSettings)
      .values({
        key: HUMANIZER_SETTINGS_KEY,
        value: { enabled: true, prefixChance: 'high', suffixes: ['yep'], extra: 1 },
        updatedAt: new Date(),
      })
      .run();
    const res = await send<HumanizerSettings>('GET');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.suffixes).toEqual(['yep']);
    expect(res.body.prefixChance).toBe(DEFAULT_HUMANIZER.prefixChance);
    expect(res.body.prefixes).toEqual(DEFAULT_HUMANIZER.prefixes);
    expect('extra' in res.body).toBe(false);
  });

  test('the defaults are cloned, not aliased — a mutated response never edits DEFAULT_HUMANIZER', async () => {
    const res = await send<HumanizerSettings>('GET');
    res.body.prefixes.push('leak');
    expect(DEFAULT_HUMANIZER.prefixes).not.toContain('leak');
    const after = await send<HumanizerSettings>('GET');
    expect(after.body.prefixes).toEqual(DEFAULT_HUMANIZER.prefixes);
  });
});

describe('PATCH /x/humanizer', () => {
  test('{enabled:true} round-trips and leaves the config at defaults', async () => {
    const patched = await send<HumanizerSettings>('PATCH', { enabled: true });
    expect(patched.status).toBe(200);
    expect(patched.body).toEqual({ ...DEFAULT_HUMANIZER, enabled: true });
    const read = await send<HumanizerSettings>('GET');
    expect(read.body).toEqual({ ...DEFAULT_HUMANIZER, enabled: true });
  });

  test('successive patches merge rather than replace', async () => {
    await send('PATCH', { enabled: true, typoChance: 0 });
    await send('PATCH', { prefixes: ['  yo  ', '', 'ok'] });
    const read = await send<HumanizerSettings>('GET');
    expect(read.body.enabled).toBe(true);
    expect(read.body.typoChance).toBe(0);
    // Trimmed, empties dropped.
    expect(read.body.prefixes).toEqual(['yo', 'ok']);
    expect(read.body.suffixes).toEqual(DEFAULT_HUMANIZER.suffixes);
  });

  test('every chance field is patchable, 0 and 1 included', async () => {
    const res = await send<HumanizerSettings>('PATCH', {
      prefixChance: 1,
      suffixChance: 0,
      lowercaseChance: 0.5,
      dropPeriodChance: 0.01,
      typoChance: 0,
    });
    expect(res.status).toBe(200);
    expect(res.body.prefixChance).toBe(1);
    expect(res.body.suffixChance).toBe(0);
    expect(res.body.lowercaseChance).toBe(0.5);
    expect(res.body.dropPeriodChance).toBe(0.01);
    expect(res.body.typoChance).toBe(0);
  });

  test('an explicitly empty pool is a valid choice', async () => {
    const res = await send<HumanizerSettings>('PATCH', { prefixes: [] });
    expect(res.status).toBe(200);
    expect(res.body.prefixes).toEqual([]);
  });

  test.each([
    ['a non-object body', 'not-json-object', 'invalid_body'],
    ['an array body', [1, 2], 'invalid_body'],
    ['enabled as a string', { enabled: 'yes' }, 'invalid_enabled'],
    ['prefixes not an array', { prefixes: 'honestly,' }, 'invalid_prefixes'],
    ['a non-string pool entry', { prefixes: ['ok', 3] }, 'invalid_prefixes'],
    [
      'a 26-entry pool',
      { prefixes: Array.from({ length: 26 }, (_, i) => `p${i}`) },
      'invalid_prefixes',
    ],
    ['a 61-char entry', { suffixes: ['x'.repeat(61)] }, 'invalid_suffixes'],
    ['a chance above 1', { prefixChance: 1.5 }, 'invalid_prefix_chance'],
    ['a negative chance', { suffixChance: -0.1 }, 'invalid_suffix_chance'],
    ['a stringified chance', { lowercaseChance: '0.5' }, 'invalid_lowercase_chance'],
    ['NaN', { dropPeriodChance: Number.NaN }, 'invalid_drop_period_chance'],
    ['null', { typoChance: null }, 'invalid_typo_chance'],
    ['no recognized field', { nope: 1 }, 'empty_patch'],
    ['an empty object', {}, 'empty_patch'],
  ])('400s on %s', async (_label, body, error) => {
    const res = await send<{ error: string }>('PATCH', body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(error);
  });

  test('a refused patch writes nothing', async () => {
    await send('PATCH', { enabled: true });
    const refused = await send<{ error: string }>('PATCH', { prefixChance: 2 });
    expect(refused.status).toBe(400);
    const read = await send<HumanizerSettings>('GET');
    expect(read.body).toEqual({ ...DEFAULT_HUMANIZER, enabled: true });
  });

  test('a 25-entry pool of 60-char entries is accepted (the boundary)', async () => {
    const pool = Array.from({ length: 25 }, () => 'y'.repeat(60));
    const res = await send<HumanizerSettings>('PATCH', { suffixes: pool });
    expect(res.status).toBe(200);
    expect(res.body.suffixes).toEqual(pool);
  });
});

describe('DELETE /x/humanizer', () => {
  test('resets to defaults and removes the row', async () => {
    await send('PATCH', { enabled: true, prefixes: ['yo'] });
    const res = await send<HumanizerSettings>('DELETE');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...DEFAULT_HUMANIZER, enabled: false });
    const row = db
      .select({ key: appSettings.key })
      .from(appSettings)
      .where(eq(appSettings.key, HUMANIZER_SETTINGS_KEY))
      .get();
    expect(row).toBeUndefined();
    const read = await send<HumanizerSettings>('GET');
    expect(read.body).toEqual({ ...DEFAULT_HUMANIZER, enabled: false });
  });

  test('is idempotent with no row', async () => {
    const res = await send<HumanizerSettings>('DELETE');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...DEFAULT_HUMANIZER, enabled: false });
  });
});

describe('parseHumanizerPatch', () => {
  test('only the keys present in the body reach the patch', () => {
    const parsed = parseHumanizerPatch({ typoChance: 0.2 });
    expect(parsed).toEqual({ ok: true, patch: { typoChance: 0.2 } });
  });

  test('a present-but-undefined key is still a key (and is refused)', () => {
    const parsed = parseHumanizerPatch({ enabled: undefined });
    expect(parsed).toEqual({ ok: false, error: 'invalid_enabled' });
  });
});
