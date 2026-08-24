// Saved searches — the server half of the Outliers hunt (OU.4). CRUD over
// `saved_searches` plus the three stateless helpers the panel opens with.
// Mounted under `/x` by `mountX` in ../index.ts — always mounted, and EVERY
// route here is $0: pure SQL over two tables plus the dependency-free compiler
// in `src/shared/searchQuery.ts`. Nothing in this file can reach `xFetch` or
// `askLLM`, and nothing should: X API v2 has no `min_faves`/`min_retweets`/
// `min_replies` operator at any tier, so the API version of this feature would
// pay ~$0.005 per returned result to discard most of them. This router is the
// out-loud opposite of adding a billed read back (CLAUDE.md invariant #8).
//
// Routes:
//   POST   /searches/compile     { query, sort? }  → CompileResult + url; writes nothing
//   GET    /searches/defaults    → { query, ladder, problems } built from x.outliers.*
//   GET    /searches             → { searches: [{saved, compiled, url}], capture }
//   POST   /searches             { name, query, sort?, pinned? } → 201 {saved, compiled, url}
//   POST   /searches/:id/run     → { url, lastRunAt } · 409 uncompilable (no stamp)
//   GET    /searches/:id         → { saved, compiled, url } · 404
//   PATCH  /searches/:id         partial { name?, query?, sort?, pinned? }
//   DELETE /searches/:id         → 204 · 404
//
// **§7.20 — `compile` and `defaults` register BEFORE `/searches/:id`.** Both are
// syntactically fine `:id` values and Hono matches in registration order, so a
// reorder turns `GET /x/searches/defaults` into a `400 invalid_id`. Two tests
// pin the order rather than a comment alone.
//
// **Storage discipline.** Every write path runs the body's `query` through
// `parseSearchQuery` and stores `JSON.stringify` of the NORMALIZED value, never
// the raw body, so the read path never re-validates — the `reply_lists.humanizer`
// / `parseHumanizerConfig` pattern. An uncompilable query is refused at write
// time: storing one only moves the failure to read time, where the row's Copy
// button can never work.
//
// **`sort` has exactly one authority, and it is the column** (D200/D201). The
// stored JSON is stripped of `sort` on the way in and the column is merged back
// on the way out, so the API always hands out a complete `SearchQuery` while the
// two can never disagree. An omitted `sort` resolves from the `x.outliers.sort`
// knob — never from the column's `'live'` default, which exists only so the
// column can be notNull. `parseSearchQuery` returns `undefined` for an omitted
// OR unrecognized sort precisely so this file has to make that call.

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  type CompileResult,
  FAVES_LADDER,
  type Problem,
  SEARCH_LANGS,
  type SearchQuery,
  type SearchSort,
  compileSearchQuery,
  parseSearchQuery,
  searchUrl,
} from '../../shared/searchQuery.ts';
import { savedSearches, voiceTweets } from '../db/schema.ts';
import { getSetting } from '../settings/registry.ts';

const MAX_NAME_LEN = 120;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The capture footer's window. Deliberately NOT `x.outliers.sinceDays`: that
// knob is how far back a HUNT looks, and re-tuning the hunt must not silently
// redefine what the counter underneath it measures.
const CAPTURE_WINDOW_DAYS = 30;
// OU.7's writer stamps this on tweets saved off a search-results page. The
// COUNT below is real today and simply returns 0 — so OU.7 changes the writer
// and not this reader, and the field is never a lie waiting to be replaced.
const CAPTURE_SOURCE = 'outlier_search';
const DAY_MS = 86_400_000;

const UNREADABLE_QUERY: Problem = {
  level: 'error',
  field: 'query',
  message:
    'This saved query could not be read — it was edited outside the app. Delete it and save the hunt again.',
};

export const searchesRouter = new Hono();

// ---------------------------------------------------------------- helpers

function asSort(v: unknown): SearchSort | null {
  return v === 'live' || v === 'top' ? v : null;
}

/** The product default for `sort` — the one default that lives outside the pure
 *  compiler. `'top'` backstops a registry that somehow holds neither value;
 *  the knob's own default is `'top'` too. */
function defaultSort(): SearchSort {
  return asSort(getSetting<string>('x.outliers.sort')) ?? 'top';
}

/** `0` and negatives mean "no floor" — the compiler's own §7.11 carve-out, and
 *  a `min_faves:0` clause is inert noise that eats the 512-char budget. */
function floorKnob(key: string): number {
  const v = getSetting<number>(key);
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** Today minus `days` in the SERVER's local date. Built through the `Date`
 *  constructor rather than millisecond arithmetic so a month boundary or a DST
 *  shift can't land the window a day off. */
function localDaysAgo(days: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Strips `sort` on the way into the column — see the header. */
function storedQuery(q: SearchQuery): string {
  const { sort: _sort, ...rest } = q;
  return JSON.stringify(rest);
}

type SavedRow = typeof savedSearches.$inferSelect;

interface Hydrated {
  saved: {
    id: string;
    name: string;
    query: SearchQuery | null;
    sort: SearchSort;
    pinned: boolean;
    lastRunAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  compiled: CompileResult | null;
  url: string | null;
}

/** A row whose `query` column was hand-edited out of band (an `/explorer`
 *  session, a restored backup) degrades to `query/compiled/url: null` and STAYS
 *  in the list — dropping it or letting the parse throw would take the whole
 *  list with it and leave the user no way to see or delete the row that broke.
 *  This is also why the column is plain `text` and not `mode: 'json'` (D199):
 *  drizzle parses a json column inside `.all()`, where no route code can catch
 *  it. A bogus `sort` degrades the same way, to the column's own default. */
function hydrate(row: SavedRow): Hydrated {
  const sort = asSort(row.sort) ?? 'live';
  let parsed: SearchQuery | null = null;
  try {
    parsed = parseSearchQuery(JSON.parse(row.query));
  } catch {
    parsed = null;
  }
  const query = parsed === null ? null : { ...parsed, sort };
  return {
    saved: {
      id: row.id,
      name: row.name,
      query,
      sort,
      pinned: row.pinned,
      lastRunAt: row.lastRunAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    compiled: query === null ? null : compileSearchQuery(query),
    url: query === null ? null : searchUrl(query),
  };
}

function hasError(compiled: CompileResult): boolean {
  return compiled.problems.some((p) => p.level === 'error');
}

// ---------------------------------------------------------------- static paths
// These two MUST stay above `/searches/:id` (§7.20).

searchesRouter.post('/searches/compile', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const normalized = parseSearchQuery(b.query);
  if (normalized === null) return c.json({ error: 'invalid_query' }, 400);
  if (b.sort !== undefined && asSort(b.sort) === null)
    return c.json({ error: 'invalid_sort' }, 400);

  const query: SearchQuery = {
    ...normalized,
    sort: asSort(b.sort) ?? normalized.sort ?? defaultSort(),
  };
  // A preview, so errors come back as `problems` with a 200 — the form shows
  // every fault at once and disables Copy off `problems`, it does not need a
  // status code to tell it that.
  const compiled = compileSearchQuery(query);
  return c.json({ ...compiled, url: searchUrl(query) });
});

searchesRouter.get('/searches/defaults', (c) => {
  const problems: Problem[] = [];

  const minFaves = floorKnob('x.outliers.minFaves');
  const minRetweets = floorKnob('x.outliers.minRetweets');
  const minReplies = floorKnob('x.outliers.minReplies');

  const rawDays = getSetting<number>('x.outliers.sinceDays');
  const sinceDays =
    typeof rawDays === 'number' && Number.isFinite(rawDays) && rawDays >= 1
      ? Math.floor(rawDays)
      : 30;

  // `x.outliers.lang` is an unvalidated `string` at the registry BY DESIGN —
  // `''` is the shipped value and an enum has no blank option — so this is the
  // one place a code outside the compiler's allowlist gets caught. Dropped with
  // a warn, never a refusal (§7.23a): a fresh form opening without a `lang:`
  // operator is a working form.
  const rawLang = getSetting<string>('x.outliers.lang');
  const lang = typeof rawLang === 'string' ? rawLang.trim().toLowerCase() : '';
  let useLang = '';
  if (lang !== '') {
    if ((SEARCH_LANGS as readonly string[]).includes(lang)) useLang = lang;
    else
      problems.push({
        level: 'warn',
        field: 'lang',
        message: `Default language "${lang}" is not one X search accepts (${SEARCH_LANGS.join(', ')}) — a fresh hunt opens without a lang: operator.`,
      });
  }

  const query: SearchQuery = {
    ...(minFaves > 0 ? { minFaves } : {}),
    ...(minRetweets > 0 ? { minRetweets } : {}),
    ...(minReplies > 0 ? { minReplies } : {}),
    ...(useLang !== '' ? { lang: useLang } : {}),
    since: localDaysAgo(sinceDays),
    sort: defaultSort(),
  };

  // The ladder rides along so the panel's ▲▼ stepper and the server's floors can
  // never disagree about the rungs.
  return c.json({ query, ladder: [...FAVES_LADDER], problems });
});

// ---------------------------------------------------------------- collection

searchesRouter.get('/searches', async (c) => {
  const rows = await db
    .select()
    .from(savedSearches)
    .orderBy(desc(savedSearches.pinned), desc(savedSearches.updatedAt));

  const since = new Date(Date.now() - CAPTURE_WINDOW_DAYS * DAY_MS);
  const [captured] = await db
    .select({ n: sql<number>`count(*)` })
    .from(voiceTweets)
    .where(and(eq(voiceTweets.source, CAPTURE_SOURCE), gte(voiceTweets.savedAt, since)));

  return c.json({
    searches: rows.map(hydrate),
    capture: { savedFromSearch: Number(captured?.n ?? 0), days: CAPTURE_WINDOW_DAYS },
  });
});

searchesRouter.post('/searches', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name === '' || name.length > MAX_NAME_LEN) return c.json({ error: 'invalid_name' }, 400);

  const normalized = parseSearchQuery(b.query);
  if (normalized === null) return c.json({ error: 'invalid_query' }, 400);
  if (b.sort !== undefined && asSort(b.sort) === null)
    return c.json({ error: 'invalid_sort' }, 400);
  if (b.pinned !== undefined && typeof b.pinned !== 'boolean')
    return c.json({ error: 'invalid_pinned' }, 400);

  const sort = asSort(b.sort) ?? normalized.sort ?? defaultSort();
  const compiled = compileSearchQuery({ ...normalized, sort });
  if (hasError(compiled))
    return c.json({ error: 'invalid_query', problems: compiled.problems }, 400);

  const [row] = await db
    .insert(savedSearches)
    .values({
      name,
      query: storedQuery(normalized),
      sort,
      ...(typeof b.pinned === 'boolean' ? { pinned: b.pinned } : {}),
    })
    .returning();
  if (!row) return c.json({ error: 'insert_failed' }, 500);
  return c.json(hydrate(row), 201);
});

// ---------------------------------------------------------------- one row
// `/searches/:id/run` is three segments and `/searches/:id` is two, so they
// cannot shadow each other — but it stays above them anyway, so the file reads
// most-specific-first and a future `/searches/:id/*` sibling inherits the order.

searchesRouter.post('/searches/:id/run', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const [row] = await db.select().from(savedSearches).where(eq(savedSearches.id, id));
  if (!row) return c.json({ error: 'not_found' }, 404);

  const hydrated = hydrate(row);
  if (hydrated.url === null) {
    // A run that couldn't happen is not a run — `last_run_at` stays where it was.
    const problems = hydrated.compiled?.problems ?? [UNREADABLE_QUERY];
    return c.json({ error: 'uncompilable', problems }, 409);
  }

  // §7.13: a JS `Date` through the Drizzle `timestamp_ms` column, never bound
  // into a raw `sql` template. `updated_at` is deliberately untouched — a run is
  // not an edit, and stamping it would silently reorder the saved list.
  const lastRunAt = new Date();
  await db.update(savedSearches).set({ lastRunAt }).where(eq(savedSearches.id, id));
  return c.json({ url: hydrated.url, lastRunAt });
});

searchesRouter.get('/searches/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const [row] = await db.select().from(savedSearches).where(eq(savedSearches.id, id));
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(hydrate(row));
});

searchesRouter.patch('/searches/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const updates: Partial<typeof savedSearches.$inferInsert> = {};

  if (b.name !== undefined) {
    // An explicit `null` lands here as `''` — the column is notNull, so there is
    // no "clear the name" arm to fall through to.
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (name === '' || name.length > MAX_NAME_LEN) return c.json({ error: 'invalid_name' }, 400);
    updates.name = name;
  }
  if (b.sort !== undefined && asSort(b.sort) === null)
    return c.json({ error: 'invalid_sort' }, 400);
  if (b.pinned !== undefined) {
    if (typeof b.pinned !== 'boolean') return c.json({ error: 'invalid_pinned' }, 400);
    updates.pinned = b.pinned;
  }

  const [existing] = await db.select().from(savedSearches).where(eq(savedSearches.id, id));
  if (!existing) return c.json({ error: 'not_found' }, 404);

  if (b.query !== undefined) {
    const normalized = parseSearchQuery(b.query);
    if (normalized === null) return c.json({ error: 'invalid_query' }, 400);
    // The form sends the whole SearchQuery, `sort` field included, so a patched
    // query carrying one moves the column too — an explicit body `sort` still
    // outranks it, and an absent pair leaves the column untouched.
    const sort = asSort(b.sort) ?? normalized.sort ?? asSort(existing.sort) ?? defaultSort();
    const compiled = compileSearchQuery({ ...normalized, sort });
    if (hasError(compiled))
      return c.json({ error: 'invalid_query', problems: compiled.problems }, 400);
    updates.query = storedQuery(normalized);
    updates.sort = sort;
  } else if (b.sort !== undefined) {
    updates.sort = asSort(b.sort) ?? defaultSort();
  }

  if (Object.keys(updates).length === 0) return c.json({ error: 'empty_patch' }, 400);

  updates.updatedAt = new Date();
  const [row] = await db
    .update(savedSearches)
    .set(updates)
    .where(eq(savedSearches.id, id))
    .returning();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(hydrate(row));
});

searchesRouter.delete('/searches/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const deleted = await db
    .delete(savedSearches)
    .where(eq(savedSearches.id, id))
    .returning({ id: savedSearches.id });
  if (deleted.length === 0) return c.json({ error: 'not_found' }, 404);
  return c.body(null, 204);
});
