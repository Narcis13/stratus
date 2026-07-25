// S1 data routes — wiring over the real (in-memory, auto-migrated) SQLite DB.
// Mounts the `data` router directly (no bearer — that's asserted in app.test.ts).

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { data, explorer } from './data.ts';

const app = new Hono();
app.route('/x', data);
app.route('/', explorer);

async function get<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as T };
}
async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

describe('GET /x/data/tables', () => {
  test('lists tables with counts and columns, tokens absent', async () => {
    const { status, body } = await get<{
      tables: { name: string; rowCount: number; columns: unknown[] }[];
    }>('/x/data/tables');
    expect(status).toBe(200);
    const names = body.tables.map((t) => t.name);
    expect(names).toContain('people');
    expect(names).not.toContain('tokens');
    const people = body.tables.find((t) => t.name === 'people');
    expect(people).toBeDefined();
    expect(typeof people?.rowCount).toBe('number');
    expect(people?.columns.length ?? 0).toBeGreaterThan(0);
  });
});

describe('GET /x/data/:table', () => {
  test('returns a page shape', async () => {
    const { status, body } = await get<{
      table: string;
      rows: unknown[];
      total: number;
      limit: number;
    }>('/x/data/people?limit=5');
    expect(status).toBe(200);
    expect(body.table).toBe('people');
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.limit).toBe(5);
  });

  test('unknown table → 404', async () => {
    const { status, body } = await get<{ error: string }>('/x/data/nope');
    expect(status).toBe(404);
    expect(body.error).toBe('unknown_table');
  });

  test('bad sort column → 400', async () => {
    const { status, body } = await get<{ error: string }>('/x/data/people?sort=bad');
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_sort');
  });

  test('tokens is a 404 through the route too', async () => {
    const { status, body } = await get<{ error: string }>('/x/data/tokens');
    expect(status).toBe(404);
    expect(body.error).toBe('unknown_table');
  });
});

describe('POST /x/data/query', () => {
  test('a plain SELECT round-trips', async () => {
    const { status, body } = await post<{ rows: unknown[]; columns: string[] }>('/x/data/query', {
      sql: 'SELECT 7 AS answer',
    });
    expect(status).toBe(200);
    expect(body.rows).toEqual([{ answer: 7 }]);
    expect(body.columns).toEqual(['answer']);
  });

  test('missing sql → 400 invalid_body', async () => {
    const { status, body } = await post<{ error: string }>('/x/data/query', { notSql: 1 });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_body');
  });

  test('a non-SELECT → 400 not_a_select', async () => {
    const { status, body } = await post<{ error: string }>('/x/data/query', {
      sql: 'DROP TABLE people',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('not_a_select');
  });

  test('tokens mention → 400 tokens_forbidden', async () => {
    const { status, body } = await post<{ error: string }>('/x/data/query', {
      sql: 'SELECT * FROM tokens',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('tokens_forbidden');
  });
});

// A3.13: the /writer shell hangs off the same public root router as /explorer —
// served with no bearer, data-free (the /x/articles fetches it makes carry the
// token). One-line mount check beside the explorer's.
describe('GET /writer (public shell)', () => {
  test('serves the writer HTML without a bearer', async () => {
    const res = await app.request('/writer');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(/stratus.*writer/i.test(html)).toBe(true);
    expect(html.includes('/x/articles')).toBe(true);
  });
});
