// OU.4 `/x/searches` — CRUD over `saved_searches`, the stateless `compile` /
// `defaults` helpers, and the `run` stamp. Runs over the real (in-memory,
// auto-migrated) SQLite DB; `bun run test` sets SQLITE_PATH=:memory:.
//
// The DB is shared across suites, so this file deletes every row it creates and
// resets the `outliers` settings group in afterAll — the settings live in
// `app_settings`, which every other suite reading a knob would otherwise see.
// Ordering assertions filter the list down to ids this file created rather than
// asserting on the whole table, so a leaked row elsewhere can never make them
// pass or fail for the wrong reason.

import { afterAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import type { CompileResult, Problem, SearchQuery } from '../../shared/searchQuery.ts';
import { savedSearches, voiceAuthors, voiceTweets } from '../db/schema.ts';
import { resetSettings, setSettings } from '../settings/registry.ts';
import { searchesRouter } from './searches.ts';

const app = new Hono();
app.route('/x', searchesRouter);

const createdIds: string[] = [];
const MISSING_UUID = '00000000-0000-4000-8000-000000000000';
const AUTHOR = 'ou4_capture_fixture';
const TWEET_ID = 'ou4_capture_tweet';

interface Hydrated {
  saved: {
    id: string;
    name: string;
    query: SearchQuery | null;
    sort: string;
    pinned: boolean;
    lastRunAt: string | null;
    updatedAt: string;
  };
  compiled: CompileResult | null;
  url: string | null;
}

interface ListBody {
  searches: Hydrated[];
  capture: { savedFromSearch: number; days: number };
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

async function createSearch(body: Record<string, unknown>): Promise<Hydrated> {
  const res = await send<Hydrated>('/x/searches', 'POST', body);
  expect(res.status).toBe(201);
  createdIds.push(res.body.saved.id);
  return res.body;
}

/** Mirrors the route's own local-date arithmetic so the assertion is about the
 *  window, not about a timezone. */
function localDaysAgo(days: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

afterAll(async () => {
  if (createdIds.length > 0)
    await db.delete(savedSearches).where(inArray(savedSearches.id, createdIds));
  await db.delete(voiceTweets).where(eq(voiceTweets.tweetId, TWEET_ID));
  await db.delete(voiceAuthors).where(eq(voiceAuthors.handle, AUTHOR));
  resetSettings({ group: 'outliers' });
});

describe('POST /x/searches', () => {
  test('stores the NORMALIZED query, not the raw body, and round-trips', async () => {
    const created = await createSearch({
      name: '  Bun outliers  ',
      // Whitespace, a case-duplicate, and a floor of 0 all have to be gone by
      // the time the row lands — the read path never re-validates.
      query: { all: ['  a  ', 'A'], minFaves: 400, minRetweets: 0 },
    });
    expect(created.saved.name).toBe('Bun outliers');
    expect(created.saved.query).toEqual({ all: ['a'], minFaves: 400, sort: 'top' });
    expect(created.compiled?.query).toBe('a min_faves:400');

    // The COLUMN is what proves normalization — the response could have been
    // built from the request body.
    const [row] = await db
      .select()
      .from(savedSearches)
      .where(eq(savedSearches.id, created.saved.id));
    expect(JSON.parse(row?.query ?? 'null')).toEqual({ all: ['a'], minFaves: 400 });

    const fetched = await send<Hydrated>(`/x/searches/${created.saved.id}`, 'GET');
    expect(fetched.status).toBe(200);
    expect(fetched.body.saved.query).toEqual({ all: ['a'], minFaves: 400, sort: 'top' });
    expect(fetched.body.url).toBe('https://x.com/search?q=a%20min_faves%3A400&f=top');
  });

  test('an omitted sort resolves from x.outliers.sort, never the column default (D200)', async () => {
    const created = await createSearch({ name: 'no sort given', query: { all: ['drizzle'] } });
    // The column default is 'live'; the product default is the knob, which ships 'top'.
    expect(created.saved.sort).toBe('top');
    const [row] = await db
      .select()
      .from(savedSearches)
      .where(eq(savedSearches.id, created.saved.id));
    expect(row?.sort).toBe('top');
    // ...and the stored JSON does NOT carry a second copy of it.
    expect(JSON.parse(row?.query ?? 'null')).toEqual({ all: ['drizzle'] });
  });

  test('an explicit sort outranks the knob', async () => {
    const created = await createSearch({
      name: 'live hunt',
      query: { all: ['bun'] },
      sort: 'live',
    });
    expect(created.saved.sort).toBe('live');
    expect(created.url).toContain('&f=live');
  });

  test('a query that compiles with errors is refused and writes no row', async () => {
    const before = await db.select({ id: savedSearches.id }).from(savedSearches);
    const res = await send<{ error: string; problems: Problem[] }>('/x/searches', 'POST', {
      name: 'backwards window',
      query: { all: ['bun'], since: '2026-08-20', until: '2026-08-01' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_query');
    expect(res.body.problems.some((p) => p.level === 'error' && p.field === 'until')).toBe(true);
    const after = await db.select({ id: savedSearches.id }).from(savedSearches);
    expect(after.length).toBe(before.length);
  });

  test('an empty search (floors only, nothing to match) is refused', async () => {
    const res = await send<{ error: string; problems: Problem[] }>('/x/searches', 'POST', {
      name: 'firehose',
      query: { minFaves: 500, replies: 'exclude' },
    });
    expect(res.status).toBe(400);
    expect(res.body.problems.some((p) => p.field === 'query' && p.level === 'error')).toBe(true);
  });

  test('a warn-only query is accepted (§7.23a — the warn half never refuses)', async () => {
    const created = await createSearch({
      name: 'multi-word OR member',
      query: { all: ['bun'], any: ['build in public', 'indie hacker'] },
    });
    const warns = created.compiled?.problems ?? [];
    expect(warns.length).toBeGreaterThan(0);
    expect(warns.every((p) => p.level === 'warn')).toBe(true);
    expect(created.compiled?.query).toBe('bun (build in public OR indie hacker)');
  });

  test('rejects a bad name, a non-object query, and a bad sort', async () => {
    expect((await send('/x/searches', 'POST', { name: '   ', query: { all: ['a'] } })).status).toBe(
      400,
    );
    expect(
      (await send<{ error: string }>('/x/searches', 'POST', { name: '   ', query: { all: ['a'] } }))
        .body.error,
    ).toBe('invalid_name');
    expect(
      (await send('/x/searches', 'POST', { name: 'x'.repeat(121), query: { all: ['a'] } })).status,
    ).toBe(400);
    expect(
      (await send<{ error: string }>('/x/searches', 'POST', { name: 'ok', query: 'not an object' }))
        .body.error,
    ).toBe('invalid_query');
    expect(
      (
        await send<{ error: string }>('/x/searches', 'POST', {
          name: 'ok',
          query: { all: ['a'] },
          sort: 'newest',
        })
      ).body.error,
    ).toBe('invalid_sort');
  });
});

describe('GET /x/searches', () => {
  test('returns {searches, capture}, pinned first then updatedAt desc', async () => {
    const older = await createSearch({ name: 'zz older', query: { all: ['older'] } });
    const newer = await createSearch({ name: 'zz newer', query: { all: ['newer'] } });
    const pinned = await createSearch({
      name: 'zz pinned',
      query: { all: ['pinned'] },
      pinned: true,
    });

    // Same-millisecond inserts would make the ordering assertion a coin flip.
    await db
      .update(savedSearches)
      .set({ updatedAt: new Date(Date.now() - 60_000) })
      .where(eq(savedSearches.id, older.saved.id));
    await db
      .update(savedSearches)
      .set({ updatedAt: new Date(Date.now() - 30_000) })
      .where(eq(savedSearches.id, newer.saved.id));
    await db
      .update(savedSearches)
      .set({ updatedAt: new Date(Date.now() - 90_000) })
      .where(eq(savedSearches.id, pinned.saved.id));

    const res = await send<ListBody>('/x/searches', 'GET');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.searches)).toBe(true);
    expect(typeof res.body.capture.savedFromSearch).toBe('number');
    expect(res.body.capture.days).toBe(30);

    const mine = res.body.searches
      .map((s) => s.saved.id)
      .filter((id) => [older, newer, pinned].some((s) => s.saved.id === id));
    // Pinned wins despite being the OLDEST of the three.
    expect(mine).toEqual([pinned.saved.id, newer.saved.id, older.saved.id]);
  });

  test('a hand-corrupted query column degrades that row, not the list', async () => {
    const broken = await createSearch({ name: 'zz broken', query: { all: ['intact'] } });
    const healthy = await createSearch({ name: 'zz healthy', query: { all: ['healthy'] } });
    await db
      .update(savedSearches)
      .set({ query: '{not json' })
      .where(eq(savedSearches.id, broken.saved.id));

    const res = await send<ListBody>('/x/searches', 'GET');
    expect(res.status).toBe(200);
    const row = res.body.searches.find((s) => s.saved.id === broken.saved.id);
    expect(row).toBeDefined();
    expect(row?.saved.name).toBe('zz broken');
    expect(row?.saved.query).toBeNull();
    expect(row?.compiled).toBeNull();
    expect(row?.url).toBeNull();
    const ok = res.body.searches.find((s) => s.saved.id === healthy.saved.id);
    expect(ok?.compiled?.query).toBe('healthy');
  });

  test('capture.savedFromSearch is a real COUNT over voice_tweets.source', async () => {
    const before = (await send<ListBody>('/x/searches', 'GET')).body.capture.savedFromSearch;
    await db.insert(voiceAuthors).values({ handle: AUTHOR }).onConflictDoNothing();
    await db
      .insert(voiceTweets)
      .values({
        tweetId: TWEET_ID,
        authorHandle: AUTHOR,
        text: 'saved off a search page',
        createdAt: new Date(),
        savedAt: new Date(),
        source: 'outlier_search',
      })
      .onConflictDoNothing();
    const after = (await send<ListBody>('/x/searches', 'GET')).body.capture.savedFromSearch;
    // OU.7 makes this reachable from the extension; the reader is already real,
    // which is why it moves the moment a row carries the source.
    expect(after).toBe(before + 1);
  });
});

describe('static paths register before /searches/:id (§7.20)', () => {
  test('POST /x/searches/compile compiles and writes nothing', async () => {
    const before = await db.select({ id: savedSearches.id }).from(savedSearches);
    const res = await send<CompileResult & { url: string | null }>('/x/searches/compile', 'POST', {
      query: { any: ['bun', 'drizzle'], minFaves: 500, replies: 'exclude' },
      sort: 'live',
    });
    expect(res.status).toBe(200);
    expect(res.body.query).toBe('(bun OR drizzle) min_faves:500 -filter:replies');
    expect(res.body.length).toBe(res.body.query.length);
    expect(res.body.overLimit).toBe(false);
    expect(res.body.url).toContain('&f=live');
    const after = await db.select({ id: savedSearches.id }).from(savedSearches);
    expect(after.length).toBe(before.length);
  });

  test('compile reports errors as problems with a 200, and nulls the url', async () => {
    const res = await send<CompileResult & { url: string | null }>('/x/searches/compile', 'POST', {
      query: { all: ['bad"quote'] },
    });
    expect(res.status).toBe(200);
    expect(res.body.problems.some((p) => p.level === 'error')).toBe(true);
    expect(res.body.url).toBeNull();
  });

  test('GET /x/searches/defaults is not swallowed by /searches/:id', async () => {
    const res = await send<{ query: SearchQuery; ladder: number[]; problems: Problem[] }>(
      '/x/searches/defaults',
      'GET',
    );
    // If `/searches/:id` were registered first this would be 400 invalid_id.
    expect(res.status).toBe(200);
    expect(res.body.ladder).toEqual([50, 100, 200, 300, 500, 800, 1200, 2000, 5000]);
    expect(res.body.query.minFaves).toBe(400);
    expect(res.body.query.minRetweets).toBeUndefined();
    expect(res.body.query.sort).toBe('top');
    expect(res.body.query.since).toBe(localDaysAgo(30));
    expect(res.body.problems).toEqual([]);
  });
});

describe('GET /x/searches/defaults', () => {
  test('reflects the registry knobs, window included', async () => {
    setSettings({ 'x.outliers.minFaves': 900, 'x.outliers.sinceDays': 7 });
    const res = await send<{ query: SearchQuery }>('/x/searches/defaults', 'GET');
    expect(res.body.query.minFaves).toBe(900);
    expect(res.body.query.since).toBe(localDaysAgo(7));
    resetSettings({ group: 'outliers' });
  });

  test('a lang outside SEARCH_LANGS is dropped with a warn, never a refusal (D204)', async () => {
    setSettings({ 'x.outliers.lang': 'zz' });
    const res = await send<{ query: SearchQuery; problems: Problem[] }>(
      '/x/searches/defaults',
      'GET',
    );
    expect(res.status).toBe(200);
    expect(res.body.query.lang).toBeUndefined();
    expect(res.body.problems).toHaveLength(1);
    expect(res.body.problems[0]?.level).toBe('warn');
    expect(res.body.problems[0]?.field).toBe('lang');

    setSettings({ 'x.outliers.lang': 'ro' });
    const ok = await send<{ query: SearchQuery; problems: Problem[] }>(
      '/x/searches/defaults',
      'GET',
    );
    expect(ok.body.query.lang).toBe('ro');
    expect(ok.body.problems).toEqual([]);
    resetSettings({ group: 'outliers' });
  });
});

describe('POST /x/searches/:id/run', () => {
  test('stamps last_run_at and returns the url; a second run moves the stamp', async () => {
    const created = await createSearch({ name: 'runnable', query: { all: ['bun'] } });
    expect(created.saved.lastRunAt).toBeNull();

    const first = await send<{ url: string; lastRunAt: string }>(
      `/x/searches/${created.saved.id}/run`,
      'POST',
    );
    expect(first.status).toBe(200);
    expect(first.body.url).toBe('https://x.com/search?q=bun&f=top');
    const [afterFirst] = await db
      .select()
      .from(savedSearches)
      .where(eq(savedSearches.id, created.saved.id));
    expect(afterFirst?.lastRunAt).not.toBeNull();
    const firstStamp = afterFirst?.lastRunAt?.getTime() ?? 0;
    // A run is not an edit — the saved list must not reorder because of one.
    const updatedAtAfterFirst = afterFirst?.updatedAt?.getTime() ?? 0;

    await Bun.sleep(5);
    const second = await send<{ url: string }>(`/x/searches/${created.saved.id}/run`, 'POST');
    expect(second.status).toBe(200);
    const [afterSecond] = await db
      .select()
      .from(savedSearches)
      .where(eq(savedSearches.id, created.saved.id));
    expect(afterSecond?.lastRunAt?.getTime() ?? 0).toBeGreaterThan(firstStamp);
    expect(afterSecond?.updatedAt?.getTime() ?? 0).toBe(updatedAtAfterFirst);
  });

  test('an uncompilable row is 409 and does NOT get a stamp', async () => {
    const created = await createSearch({ name: 'goes bad', query: { all: ['bun'] } });
    // Only a hand-edit can produce this — the write path refuses an uncompilable
    // query — which is exactly the row this arm exists for.
    await db
      .update(savedSearches)
      .set({ query: JSON.stringify({ minFaves: 500 }) })
      .where(eq(savedSearches.id, created.saved.id));

    const res = await send<{ error: string; problems: Problem[] }>(
      `/x/searches/${created.saved.id}/run`,
      'POST',
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('uncompilable');
    expect(res.body.problems.some((p) => p.level === 'error')).toBe(true);
    const [row] = await db
      .select()
      .from(savedSearches)
      .where(eq(savedSearches.id, created.saved.id));
    expect(row?.lastRunAt).toBeNull();
  });

  test('an unreadable row is 409 too, with a message that says why', async () => {
    const created = await createSearch({ name: 'unreadable', query: { all: ['bun'] } });
    await db
      .update(savedSearches)
      .set({ query: 'not json at all' })
      .where(eq(savedSearches.id, created.saved.id));
    const res = await send<{ error: string; problems: Problem[] }>(
      `/x/searches/${created.saved.id}/run`,
      'POST',
    );
    expect(res.status).toBe(409);
    expect(res.body.problems[0]?.message).toContain('edited outside the app');
  });
});

describe('PATCH /x/searches/:id', () => {
  test('a name-only patch leaves the query untouched', async () => {
    const created = await createSearch({ name: 'before', query: { all: ['bun'], minFaves: 200 } });
    const res = await send<Hydrated>(`/x/searches/${created.saved.id}`, 'PATCH', {
      name: 'after',
    });
    expect(res.status).toBe(200);
    expect(res.body.saved.name).toBe('after');
    expect(res.body.saved.query).toEqual({ all: ['bun'], minFaves: 200, sort: 'top' });
  });

  test('a query patch re-normalizes and re-compiles', async () => {
    const created = await createSearch({ name: 'renorm', query: { all: ['bun'] } });
    const res = await send<Hydrated>(`/x/searches/${created.saved.id}`, 'PATCH', {
      query: { all: [' Drizzle ', 'DRIZZLE'], minFaves: -5, sort: 'live' },
    });
    expect(res.status).toBe(200);
    expect(res.body.saved.query).toEqual({ all: ['Drizzle'], sort: 'live' });
    // The sort rode in on the query object and moved the column with it.
    expect(res.body.saved.sort).toBe('live');
    expect(res.body.compiled?.query).toBe('Drizzle');
  });

  test('a query patch that no longer compiles is refused', async () => {
    const created = await createSearch({ name: 'stays valid', query: { all: ['bun'] } });
    const res = await send<{ error: string; problems: Problem[] }>(
      `/x/searches/${created.saved.id}`,
      'PATCH',
      { query: { all: ['bun'], since: '2026-02-31' } },
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_query');
    const fetched = await send<Hydrated>(`/x/searches/${created.saved.id}`, 'GET');
    expect(fetched.body.saved.query).toEqual({ all: ['bun'], sort: 'top' });
  });

  test('an empty patch and a null name are both 400', async () => {
    const created = await createSearch({ name: 'patch guards', query: { all: ['bun'] } });
    expect(
      (await send<{ error: string }>(`/x/searches/${created.saved.id}`, 'PATCH', {})).body.error,
    ).toBe('empty_patch');
    expect(
      (await send<{ error: string }>(`/x/searches/${created.saved.id}`, 'PATCH', { name: null }))
        .body.error,
    ).toBe('invalid_name');
  });

  test('pinned flips on its own', async () => {
    const created = await createSearch({ name: 'pin me', query: { all: ['bun'] } });
    const res = await send<Hydrated>(`/x/searches/${created.saved.id}`, 'PATCH', { pinned: true });
    expect(res.body.saved.pinned).toBe(true);
  });
});

describe('DELETE /x/searches/:id and the id guards', () => {
  test('204 then 404', async () => {
    const created = await createSearch({ name: 'doomed', query: { all: ['bun'] } });
    const first = await send(`/x/searches/${created.saved.id}`, 'DELETE');
    expect(first.status).toBe(204);
    const second = await send<{ error: string }>(`/x/searches/${created.saved.id}`, 'DELETE');
    expect(second.status).toBe(404);
    expect(second.body.error).toBe('not_found');
  });

  test('every :id path is 404 on an unknown uuid and 400 on a malformed one', async () => {
    for (const [path, method] of [
      [`/x/searches/${MISSING_UUID}`, 'GET'],
      [`/x/searches/${MISSING_UUID}/run`, 'POST'],
      [`/x/searches/${MISSING_UUID}`, 'DELETE'],
    ] as const) {
      expect((await send(path, method)).status).toBe(404);
    }
    expect((await send(`/x/searches/${MISSING_UUID}`, 'PATCH', { pinned: true })).status).toBe(404);

    for (const [path, method] of [
      ['/x/searches/not-a-uuid', 'GET'],
      ['/x/searches/not-a-uuid/run', 'POST'],
      ['/x/searches/not-a-uuid', 'DELETE'],
    ] as const) {
      const res = await send<{ error: string }>(path, method);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_id');
    }
  });
});

describe('the lane is $0', () => {
  test('the router imports no billed or LLM surface', async () => {
    const src = await Bun.file(new URL('./searches.ts', import.meta.url)).text();
    const imports = src.match(/^import .*$/gm) ?? [];
    const joined = imports.join('\n');
    // `../client.ts` is xFetch; `../../db/client.ts` (which this file DOES
    // import) is the SQLite handle, so the assertion has to be path-specific.
    expect(joined).not.toContain("'../client.ts'");
    expect(joined).not.toContain('endpoints.ts');
    expect(joined).not.toContain('llm');
    expect(joined).not.toContain('xFetch');
    expect(joined).not.toContain('askLLM');
  });
});
