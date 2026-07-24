// UI.5 — the mention inbox's money bounds. Only the paths that refuse BEFORE
// any X call are exercised here: `POST /mentions/refresh` takes its daily slot
// (and validates the body) before `getValidAccessToken`, so a cap of 0 returns
// 429 without a token, a network call or a cent of spend. Anything past the
// slot would hit the real X API, so it stays out of the suite.

import { afterEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { resetSettings, setSettings } from '../settings/registry.ts';
import { createMentionsRouter } from './mentions.ts';

const app = new Hono();
app.route('/x', createMentionsRouter({ selfXUserId: '1', clientId: 'test', clientSecret: 'test' }));

// The settings store is process-global across test files — always drop the
// override, or a 0 cap leaks into another suite's refresh.
afterEach(() => {
  resetSettings({ group: 'mentions' });
});

async function refresh<T>(body: unknown): Promise<{ status: number; body: T }> {
  const res = await app.request('/x/mentions/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

describe('POST /x/mentions/refresh — server refresh cap', () => {
  test('a cap of 0 refuses every manual pull and reports the configured cap', async () => {
    setSettings({ 'x.mentions.serverRefreshCap': 0 });
    const { status, body } = await refresh<{ error: string; maxPerDay: number }>({});
    expect(status).toBe(429);
    expect(body.error).toBe('refresh_limit');
    // The 429 reports the CONFIGURED cap, not the baked constant — otherwise
    // the panel would tell the user a limit that isn't the one being enforced.
    expect(body.maxPerDay).toBe(0);
  });

  test('body validation still runs before the cap is taken', async () => {
    setSettings({ 'x.mentions.serverRefreshCap': 0 });
    const { status, body } = await refresh<{ error: string }>({ maxResults: 0 });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_max_results');
  });
});
