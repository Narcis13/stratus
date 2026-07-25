// UI.1 settings routes over the real (in-memory, auto-migrated) SQLite DB;
// bun test runs with SQLITE_PATH=:memory:. Covers GET shape + isDefault flip,
// the mirrored-scope filter, PATCH atomicity (one bad key writes nothing), the
// validation ladder, reset by key and by group, and the bearer guard.

import { afterEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { resetSettings } from '../settings/registry.ts';
import { settingsRouter } from './settings.ts';

const app = new Hono();
app.route('/x', settingsRouter);

// Every test starts from defaults — drop any doctrine overrides it wrote (this
// also invalidates the store cache, so no override leaks into a later suite).
afterEach(() => {
  resetSettings({ group: 'doctrine' });
});

interface SettingEntry {
  key: string;
  value: unknown;
  isDefault: boolean;
  type: string;
}
interface Group {
  id: string;
  label: string;
  settings: SettingEntry[];
}

async function send<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const parsed = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  return { status: res.status, body: parsed };
}

function findSetting(groups: Group[], key: string): SettingEntry | undefined {
  for (const g of groups) {
    const s = g.settings.find((x) => x.key === key);
    if (s) return s;
  }
  return undefined;
}

describe('GET /x/settings', () => {
  test('returns the doctrine group with defaults, all isDefault=true', async () => {
    const { status, body } = await send<{ groups: Group[] }>('/x/settings', 'GET');
    expect(status).toBe(200);
    const doctrine = body.groups.find((g) => g.id === 'doctrine');
    expect(doctrine?.label).toBe('Doctrine');

    const ladder = findSetting(body.groups, 'x.doctrine.ladderSwitchAt');
    expect(ladder?.value).toBe(4);
    expect(ladder?.isDefault).toBe(true);
    expect(ladder?.type).toBe('number');

    const anchors = findSetting(body.groups, 'x.doctrine.anchors3');
    expect(anchors?.value).toEqual([9, 13, 18]);
    expect(anchors?.isDefault).toBe(true);
  });
});

describe('GET /x/settings/values', () => {
  test('scope=mirrored returns only mirrored keys', async () => {
    const { status, body } = await send<Record<string, unknown>>(
      '/x/settings/values?scope=mirrored',
      'GET',
    );
    expect(status).toBe(200);
    expect(body['x.doctrine.anchors3']).toEqual([9, 13, 18]);
    expect(body['x.doctrine.anchors4']).toEqual([8, 12, 16, 20]);
    expect(body['x.doctrine.ladderSwitchAt']).toBe(4);
    // Server-scope keys are NOT in the mirror payload (the display group is server).
    expect('x.display.sparklineDays' in body).toBe(false);
  });

  test('bad scope → 400', async () => {
    expect((await send('/x/settings/values?scope=bogus', 'GET')).status).toBe(400);
  });
});

describe('PATCH /x/settings', () => {
  test('override flips isDefault and the value round-trips (number + numberArray)', async () => {
    const patched = await send<{ updated: { key: string; value: unknown }[] }>(
      '/x/settings',
      'PATCH',
      { 'x.doctrine.ladderSwitchAt': 6, 'x.doctrine.anchors3': [8, 14, 19] },
    );
    expect(patched.status).toBe(200);
    expect(patched.body.updated).toEqual([
      { key: 'x.doctrine.ladderSwitchAt', value: 6 },
      { key: 'x.doctrine.anchors3', value: [8, 14, 19] },
    ]);

    const { body } = await send<{ groups: Group[] }>('/x/settings', 'GET');
    const ladder = findSetting(body.groups, 'x.doctrine.ladderSwitchAt');
    expect(ladder?.value).toBe(6);
    expect(ladder?.isDefault).toBe(false);
    const anchors = findSetting(body.groups, 'x.doctrine.anchors3');
    expect(anchors?.value).toEqual([8, 14, 19]);
    expect(anchors?.isDefault).toBe(false);

    // The mirror sees the new anchors too.
    const values = await send<Record<string, unknown>>('/x/settings/values?scope=mirrored', 'GET');
    expect(values.body['x.doctrine.anchors3']).toEqual([8, 14, 19]);
  });

  test('atomicity: one bad key in a 2-key patch writes nothing', async () => {
    const res = await send<{ error: string; key: string }>('/x/settings', 'PATCH', {
      'x.doctrine.ladderSwitchAt': 6, // valid
      'x.doctrine.anchors3': [25], // hour > max 23
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_setting_value');
    expect(res.body.key).toBe('x.doctrine.anchors3');

    // The good key must NOT have been written.
    const { body } = await send<{ groups: Group[] }>('/x/settings', 'GET');
    expect(findSetting(body.groups, 'x.doctrine.ladderSwitchAt')?.isDefault).toBe(true);
  });

  test('unknown key → 400 unknown_setting', async () => {
    const res = await send<{ error: string }>('/x/settings', 'PATCH', { 'x.bogus.key': 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_setting');
  });

  test('out-of-range number → 400 invalid_setting_value', async () => {
    const res = await send<{ error: string }>('/x/settings', 'PATCH', {
      'x.doctrine.ladderSwitchAt': 0, // < min 2
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_setting_value');
  });

  test('invalid numberArray (unsorted / OOB / too many) → 400', async () => {
    expect((await send('/x/settings', 'PATCH', { 'x.doctrine.anchors3': [18, 9] })).status).toBe(
      400,
    );
    expect((await send('/x/settings', 'PATCH', { 'x.doctrine.anchors3': [25] })).status).toBe(400);
    expect(
      (await send('/x/settings', 'PATCH', { 'x.doctrine.anchors3': [1, 2, 3, 4, 5, 6, 7, 8, 9] }))
        .status,
    ).toBe(400);
  });

  test('empty patch → 400', async () => {
    expect((await send('/x/settings', 'PATCH', {})).status).toBe(400);
  });
});

describe('POST /x/settings/reset', () => {
  test('reset by key restores the default and clears the dot', async () => {
    await send('/x/settings', 'PATCH', { 'x.doctrine.ladderSwitchAt': 6 });
    const reset = await send<{ reset: string[] }>('/x/settings/reset', 'POST', {
      keys: ['x.doctrine.ladderSwitchAt'],
    });
    expect(reset.status).toBe(200);
    expect(reset.body.reset).toEqual(['x.doctrine.ladderSwitchAt']);

    const { body } = await send<{ groups: Group[] }>('/x/settings', 'GET');
    const ladder = findSetting(body.groups, 'x.doctrine.ladderSwitchAt');
    expect(ladder?.value).toBe(4);
    expect(ladder?.isDefault).toBe(true);
  });

  test('reset by group restores every knob in the group', async () => {
    await send('/x/settings', 'PATCH', {
      'x.doctrine.ladderSwitchAt': 6,
      'x.doctrine.anchors3': [8, 14, 19],
    });
    await send('/x/settings/reset', 'POST', { group: 'doctrine' });
    const { body } = await send<{ groups: Group[] }>('/x/settings', 'GET');
    expect(findSetting(body.groups, 'x.doctrine.ladderSwitchAt')?.isDefault).toBe(true);
    expect(findSetting(body.groups, 'x.doctrine.anchors3')?.isDefault).toBe(true);
  });

  test('reset guards: nothing to reset, bad keys type', async () => {
    expect((await send('/x/settings/reset', 'POST', {})).status).toBe(400);
    expect((await send('/x/settings/reset', 'POST', { keys: 'nope' })).status).toBe(400);
  });
});

describe('bearer guard', () => {
  test('GET /x/settings without a bearer → 401', async () => {
    const { app: composed } = await import('../../app.ts');
    const res = await composed.request('/x/settings');
    expect(res.status).toBe(401);
  });
});
