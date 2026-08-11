// SP.1 — GET/POST/DELETE /x/sweep/presets + POST /x/sweep/presets/load over the
// real (in-memory, auto-migrated) SQLite DB. Both the 'sweep-presets' row and any
// x.sweep.* override rows are dropped before every test AND in afterAll: they
// live in `app_settings`, which every other suite's settings reads see, and a
// leaked sweep override would silently move what `passesSweep` admits in a later
// suite.

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq, like, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { appSettings } from '../../db/shared-schema.ts';
import { invalidateSettingsCache } from '../../settings/store.ts';
import { SWEEP, type SweepConfig } from '../../shared/radarSweep.ts';
import { setSettings } from '../settings/registry.ts';
import { sweepConfigFromSettings } from '../settings/sweepConfig.ts';
import { SWEEP_PRESETS_KEY, type SweepPreset } from '../settings/sweepPresets.ts';
import { sweepPresetsRouter } from './sweepPresets.ts';

const app = new Hono();
app.route('/x', sweepPresetsRouter);

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
  return { status: res.status, body: (await res.json()) as T };
}

function clean(): void {
  db.delete(appSettings)
    .where(or(eq(appSettings.key, SWEEP_PRESETS_KEY), like(appSettings.key, 'x.sweep.%')))
    .run();
  invalidateSettingsCache();
}

beforeEach(clean);
afterAll(clean);

describe('GET /x/sweep/presets', () => {
  test('empty until something is saved', async () => {
    const res = await send<{ presets: SweepPreset[] }>('/x/sweep/presets', 'GET');
    expect(res.status).toBe(200);
    expect(res.body.presets).toEqual([]);
  });
});

describe('POST /x/sweep/presets', () => {
  test('snapshots the LIVE config, not a client-supplied one', async () => {
    setSettings({ 'x.sweep.minViews': 5000, 'x.sweep.verifiedOnly': false });

    // The `values` in the body are ignored by construction — the route never
    // reads them, which is what makes a stored preset registry-valid by default.
    const res = await send<{ presets: SweepPreset[]; saved: string }>('/x/sweep/presets', 'POST', {
      name: 'Big accounts',
      values: { minViews: -999 },
    });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe('Big accounts');
    expect(res.body.presets[0]?.values).toEqual(sweepConfigFromSettings());
    expect(res.body.presets[0]?.values.minViews).toBe(5000);
  });

  test('a blank or missing name is invalid_name; a non-object body is invalid_body', async () => {
    expect((await send('/x/sweep/presets', 'POST', { name: '  ' })).status).toBe(400);
    expect((await send<{ error: string }>('/x/sweep/presets', 'POST', {})).body.error).toBe(
      'invalid_name',
    );
    expect((await send<{ error: string }>('/x/sweep/presets', 'POST', [1])).body.error).toBe(
      'invalid_body',
    );
  });
});

describe('POST /x/sweep/presets/load', () => {
  test('applies every one of the eleven knobs and the config reads back', async () => {
    setSettings({ 'x.sweep.minViews': 5000, 'x.sweep.maxLikes': 0, 'x.sweep.autoStopMin': 45 });
    await send('/x/sweep/presets', 'POST', { name: 'Big' });

    // Move the live config somewhere else entirely, then load the preset back.
    setSettings({ 'x.sweep.minViews': 100, 'x.sweep.maxLikes': 5, 'x.sweep.autoStopMin': 10 });
    expect(sweepConfigFromSettings().minViews).toBe(100);

    const res = await send<{ loaded: string; values: SweepConfig }>(
      '/x/sweep/presets/load',
      'POST',
      { name: 'big' },
    );
    expect(res.status).toBe(200);
    expect(res.body.loaded).toBe('Big');
    // The whole config, including autoStopMin — a preset owns all eleven.
    expect(sweepConfigFromSettings()).toEqual(res.body.values);
    expect(sweepConfigFromSettings().minViews).toBe(5000);
    expect(sweepConfigFromSettings().autoStopMin).toBe(45);
  });

  test('an unknown name is 404, not a silent no-op', async () => {
    const res = await send<{ error: string }>('/x/sweep/presets/load', 'POST', { name: 'ghost' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('unknown_preset');
  });

  test('a hand-edited out-of-range preset refuses WHOLE — the registry is still the guard', async () => {
    // Bypass the route to write what no snapshot could produce: a negative floor
    // next to a legal change. The registry must refuse both, not half of them.
    const bad: SweepPreset = {
      name: 'Tampered',
      values: { ...SWEEP, minViews: -5, autoStopMin: 45 },
      updatedAt: new Date().toISOString(),
    };
    db.insert(appSettings)
      .values({ key: SWEEP_PRESETS_KEY, value: [bad], updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: [bad] } })
      .run();

    const res = await send<{ error: string; key: string }>('/x/sweep/presets/load', 'POST', {
      name: 'Tampered',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_setting_value');
    expect(res.body.key).toBe('x.sweep.minViews');
    // All-or-nothing: the legal half of the patch did not land either.
    expect(sweepConfigFromSettings().autoStopMin).toBe(SWEEP.autoStopMin);
  });
});

describe('DELETE /x/sweep/presets', () => {
  test('deletes by name, case-insensitively', async () => {
    await send('/x/sweep/presets', 'POST', { name: 'Small' });
    const res = await send<{ presets: SweepPreset[] }>('/x/sweep/presets', 'DELETE', {
      name: 'SMALL',
    });
    expect(res.status).toBe(200);
    expect(res.body.presets).toEqual([]);
  });

  test('deleting a name that is not there is 404', async () => {
    const res = await send<{ error: string }>('/x/sweep/presets', 'DELETE', { name: 'ghost' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('unknown_preset');
  });

  test('loading a preset leaves the OTHER presets alone', async () => {
    await send('/x/sweep/presets', 'POST', { name: 'A' });
    setSettings({ 'x.sweep.minViews': 4000 });
    await send('/x/sweep/presets', 'POST', { name: 'B' });
    await send('/x/sweep/presets/load', 'POST', { name: 'A' });

    const res = await send<{ presets: SweepPreset[] }>('/x/sweep/presets', 'GET');
    expect(res.body.presets.map((p) => p.name)).toEqual(['A', 'B']);
    expect(res.body.presets[1]?.values.minViews).toBe(4000);
  });
});
