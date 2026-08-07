// The cannon roster (CQ.2) — CRUD over `cannon_targets` plus the two read-time
// scoring routes. Mounted under `/x` by `mountX` in ../index.ts; always mounted.
//
// EVERY route in this file is $0 by construction and it stays that way: nothing
// here may import `xFetch` or `askLLM`. The scores come from `harvest_rows`,
// which the extension filled by scraping the DOM — an author's yield is already
// in the data we have, and looking a handle up through the API would cost $0.010
// to measure the wrong axis (§8, and the source plan measured author size as
// nearly uncorrelated with yield).
//
// Routes:
//   GET    /cannon/targets?active=            → { floor, targets: [...] }  score desc, nulls last
//   POST   /cannon/targets                    { handle, displayName?, language?, topic?, notes?, active? } → 201
//   GET    /cannon/candidates?limit=&minSample= → { limit, minSample, candidates }
//   PATCH  /cannon/targets/:handle            partial { active?, language?, topic?, notes?, displayName? }
//   DELETE /cannon/targets/:handle            → 204
//   POST   /cannon/rescore                    { handles? } → { scored, skipped, samplePosts, minSample }
//
// `/cannon/candidates` is registered BEFORE the `:handle` routes (§7.20). The
// segment counts differ here so it cannot actually collide — keep it that way
// anyway, the way `monitor.ts` does; the next static path added to this file may
// not be so lucky.
//
// The two reads over `harvest_rows` carry `mode IN ('posts','timeline')` and
// that filter is load-bearing (§8): `mode='replies'` rows are the harvested
// account's REPLIES, not their posts, and scoring those would answer a different
// question (how many eyes their replies get) under the same column name.

import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { resolveModeId } from '../../shared/replyMode.ts';
import {
  type AuthorPost,
  CANNON_MIN_SAMPLE,
  CANNON_SAMPLE_POSTS,
  rankCannonTargets,
  scoreAuthor,
} from '../cannon/roster.ts';
import { cannonTargets, harvestRows } from '../db/schema.ts';
import { getSetting } from '../settings/registry.ts';

const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;
const MAX_LANGUAGE_LEN = 16;
const MAX_TOPIC_LEN = 32;
const MAX_NOTES_LEN = 2000;
const MAX_DISPLAY_NAME_LEN = 120;
const MAX_RESCORE_HANDLES = 200;

// The modes whose rows are the author's OWN posts. See the header — never add
// 'replies' here.
const POST_MODES = ['posts', 'timeline'] as const;

const DEFAULT_CANDIDATES_LIMIT = 20;
const MAX_CANDIDATES_LIMIT = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

export const cannonRouter = new Hono();

export interface CannonTargetView {
  handle: string;
  displayName: string | null;
  language: string | null;
  /** The reply-mode pin (RC.3), always a canonical `ReplyMode` id or null —
   *  writes go through `resolveModeId`, so 'football' is stored as 'banter'. */
  topic: string | null;
  score: number | null;
  medianViews: number | null;
  medianComments: number | null;
  sampleN: number;
  scoredAt: string | null;
  active: boolean;
  notes: string | null;
  addedAt: string;
  /** Whole days since the last rescore; null when never scored (§7.11). */
  staleDays: number | null;
  /** Under the configured `x.cannon.scoreMin` — the Sunday "drop this one" flag.
   *  Never true for an unscored handle: absent is not below. */
  belowFloor: boolean;
}

cannonRouter.get('/cannon/targets', async (c) => {
  const activeRaw = c.req.query('active');
  let activeFilter: boolean | null = null;
  if (activeRaw !== undefined) {
    if (activeRaw !== 'true' && activeRaw !== 'false')
      return c.json({ error: 'invalid_active' }, 400);
    activeFilter = activeRaw === 'true';
  }

  const rows = await db
    .select()
    .from(cannonTargets)
    .where(activeFilter === null ? undefined : eq(cannonTargets.active, activeFilter));

  // Read at request time, never captured at module load — the money-knob
  // discipline (UI.5): a floor edited in Settings has to move this list on the
  // next read, not on the next restart.
  const floor = getSetting<number>('x.cannon.scoreMin');
  const now = Date.now();

  const targets: CannonTargetView[] = rankCannonTargets(rows).map((r) => toView(r, floor, now));
  return c.json({ floor, targets });
});

cannonRouter.post('/cannon/targets', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const handle = normalizeHandle(b.handle);
  if (handle === null) return c.json({ error: 'invalid_handle' }, 400);

  const displayName = parseText(b.displayName, MAX_DISPLAY_NAME_LEN);
  if (displayName === 'invalid') return c.json({ error: 'invalid_display_name' }, 400);

  const language = parseText(b.language, MAX_LANGUAGE_LEN);
  if (language === 'invalid') return c.json({ error: 'invalid_language' }, 400);

  const topic = parseTopic(b.topic);
  if (topic === 'invalid') return c.json({ error: 'invalid_topic' }, 400);

  const notes = parseText(b.notes, MAX_NOTES_LEN);
  if (notes === 'invalid') return c.json({ error: 'invalid_notes' }, 400);

  if (b.active !== undefined && typeof b.active !== 'boolean')
    return c.json({ error: 'invalid_active' }, 400);

  const [existing] = await db.select().from(cannonTargets).where(eq(cannonTargets.handle, handle));

  if (!existing) {
    const [row] = await db
      .insert(cannonTargets)
      .values({
        handle,
        displayName,
        language,
        topic,
        notes,
        ...(typeof b.active === 'boolean' ? { active: b.active } : {}),
      })
      .returning();
    if (!row) throw new Error('cannon_target_insert_failed');
    const floor = getSetting<number>('x.cannon.scoreMin');
    return c.json(toView(row, floor, Date.now()), 201);
  }

  // Fill-only (upsertPerson's discipline): re-adding a handle you already camp
  // must never blank its score, its sample or its added_at — the natural way to
  // "make sure they're on the list" is to POST them again, and losing a week of
  // scoring for it would be indistinguishable from a bug. `active` is the one
  // field an explicit value overwrites: it is the only one this route exists to
  // toggle from a client that doesn't know whether the row is already there.
  const set: Partial<typeof cannonTargets.$inferInsert> = {};
  if (displayName !== null && existing.displayName === null) set.displayName = displayName;
  if (language !== null && existing.language === null) set.language = language;
  if (topic !== null && existing.topic === null) set.topic = topic;
  if (notes !== null && existing.notes === null) set.notes = notes;
  if (typeof b.active === 'boolean' && b.active !== existing.active) set.active = b.active;

  let row = existing;
  if (Object.keys(set).length > 0) {
    set.updatedAt = new Date();
    const [updated] = await db
      .update(cannonTargets)
      .set(set)
      .where(eq(cannonTargets.handle, handle))
      .returning();
    if (!updated) throw new Error('cannon_target_update_failed');
    row = updated;
  }
  const floor = getSetting<number>('x.cannon.scoreMin');
  return c.json(toView(row, floor, Date.now()), 201);
});

// Static path — registered ahead of the `:handle` routes below (§7.20).
//
// The discovery list: authors already in the harvest corpus who are NOT on the
// roster, scored exactly the way the roster is, so "who should I be camping"
// answers in the same units as "who am I camping". $0 — same rows, no API.
cannonRouter.get('/cannon/candidates', async (c) => {
  const limit = intParam(c.req.query('limit'), DEFAULT_CANDIDATES_LIMIT, 1, MAX_CANDIDATES_LIMIT);
  if (limit === null) return c.json({ error: 'invalid_limit' }, 400);

  // The module's floor is the real one; this only ever RAISES it. A caller
  // asking for minSample=2 gets `scoreAuthor`'s null gate anyway (§7.19), so
  // clamping up front keeps the reported number honest about what was applied.
  const requested = intParam(
    c.req.query('minSample'),
    CANNON_MIN_SAMPLE,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if (requested === null) return c.json({ error: 'invalid_min_sample' }, 400);
  const minSample = Math.max(requested, CANNON_MIN_SAMPLE);

  const existing = await db.select({ handle: cannonTargets.handle }).from(cannonTargets);
  const taken = existing.map((r) => r.handle);

  const rows = await db
    .select({
      handle: harvestRows.handle,
      tweetId: harvestRows.tweetId,
      views: harvestRows.views,
      comments: harvestRows.comments,
      tweetTime: harvestRows.tweetTime,
      capturedAt: harvestRows.capturedAt,
    })
    .from(harvestRows)
    .where(
      taken.length === 0
        ? inArray(harvestRows.mode, POST_MODES)
        : and(inArray(harvestRows.mode, POST_MODES), notInArray(harvestRows.handle, taken)),
    );

  const byHandle = bucketByHandle(rows);
  const candidates: {
    handle: string;
    score: number;
    medianViews: number;
    medianComments: number;
    sampleN: number;
  }[] = [];
  for (const [handle, posts] of byHandle) {
    const scored = scoreAuthor(posts);
    if (!scored || scored.sampleN < minSample) continue;
    candidates.push({ handle, ...scored });
  }
  candidates.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.handle < b.handle ? -1 : 1,
  );

  return c.json({ limit, minSample, candidates: candidates.slice(0, limit) });
});

cannonRouter.patch('/cannon/targets/:handle', async (c) => {
  const handle = normalizeHandle(c.req.param('handle'));
  if (handle === null) return c.json({ error: 'invalid_handle' }, 400);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const updates: Partial<typeof cannonTargets.$inferInsert> = {};
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') return c.json({ error: 'invalid_active' }, 400);
    updates.active = b.active;
  }
  if (b.language !== undefined) {
    const language = parseText(b.language, MAX_LANGUAGE_LEN);
    if (language === 'invalid') return c.json({ error: 'invalid_language' }, 400);
    updates.language = language;
  }
  if (b.topic !== undefined) {
    const topic = parseTopic(b.topic);
    if (topic === 'invalid') return c.json({ error: 'invalid_topic' }, 400);
    updates.topic = topic;
  }
  if (b.notes !== undefined) {
    const notes = parseText(b.notes, MAX_NOTES_LEN);
    if (notes === 'invalid') return c.json({ error: 'invalid_notes' }, 400);
    updates.notes = notes;
  }
  if (b.displayName !== undefined) {
    const displayName = parseText(b.displayName, MAX_DISPLAY_NAME_LEN);
    if (displayName === 'invalid') return c.json({ error: 'invalid_display_name' }, 400);
    updates.displayName = displayName;
  }

  if (Object.keys(updates).length === 0) return c.json({ error: 'empty_patch' }, 400);

  updates.updatedAt = new Date();
  const [row] = await db
    .update(cannonTargets)
    .set(updates)
    .where(eq(cannonTargets.handle, handle))
    .returning();
  if (!row) return c.json({ error: 'not_found' }, 404);

  return c.json(toView(row, getSetting<number>('x.cannon.scoreMin'), Date.now()));
});

// Hard delete: a dropped target is not history. The scores it carried were
// derived from `harvest_rows`, which keeps every row it was computed from, so
// nothing is lost that a rescore can't rebuild.
cannonRouter.delete('/cannon/targets/:handle', async (c) => {
  const handle = normalizeHandle(c.req.param('handle'));
  if (handle === null) return c.json({ error: 'invalid_handle' }, 400);

  const deleted = await db
    .delete(cannonTargets)
    .where(eq(cannonTargets.handle, handle))
    .returning({ handle: cannonTargets.handle });
  if (deleted.length === 0) return c.json({ error: 'not_found' }, 404);
  return c.body(null, 204);
});

export interface RescoreSkip {
  handle: string;
  sampleN: number;
  reason: 'insufficient_sample';
}

// Refresh the roster from the harvest corpus. One read, one sync txn, $0.
//
// A handle under the sample gate is written `score: null` and STILL gets its
// `scored_at` and `sample_n`: "we looked on Sunday and there were 3 posts" is a
// different fact from "never scored", and only the first one tells you the
// harvest is the thing to fix rather than the handle (§7.11).
cannonRouter.post('/cannon/rescore', async (c) => {
  const raw = await c.req.json().catch(() => undefined);
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw)))
    return c.json({ error: 'invalid_body' }, 400);
  const b = (raw ?? {}) as Record<string, unknown>;

  let only: string[] | null = null;
  if (b.handles !== undefined && b.handles !== null) {
    if (!Array.isArray(b.handles) || b.handles.length > MAX_RESCORE_HANDLES)
      return c.json({ error: 'invalid_handles' }, 400);
    const parsed: string[] = [];
    for (const entry of b.handles) {
      const h = normalizeHandle(entry);
      if (h === null) return c.json({ error: 'invalid_handle' }, 400);
      parsed.push(h);
    }
    only = parsed;
  }

  const targetRows = await db
    .select({ handle: cannonTargets.handle })
    .from(cannonTargets)
    .where(only === null ? undefined : inArray(cannonTargets.handle, only));
  const handles = targetRows.map((r) => r.handle);

  // Empty roster (or a `handles` list that matches nothing): answer without
  // ever building an `in ()`, which SQLite parses as a syntax error.
  if (handles.length === 0)
    return c.json({
      scored: 0,
      skipped: [] as RescoreSkip[],
      samplePosts: CANNON_SAMPLE_POSTS,
      minSample: CANNON_MIN_SAMPLE,
    });

  const rows = await db
    .select({
      handle: harvestRows.handle,
      tweetId: harvestRows.tweetId,
      views: harvestRows.views,
      comments: harvestRows.comments,
      tweetTime: harvestRows.tweetTime,
      capturedAt: harvestRows.capturedAt,
    })
    .from(harvestRows)
    .where(and(inArray(harvestRows.mode, POST_MODES), inArray(harvestRows.handle, handles)));

  const byHandle = bucketByHandle(rows);
  const now = new Date();
  const skipped: RescoreSkip[] = [];
  let scored = 0;

  const writes = handles.map((handle) => {
    const posts = byHandle.get(handle) ?? [];
    const result = scoreAuthor(posts);
    if (result === null) {
      // sampleN isn't reported by scoreAuthor below the gate, so count the
      // deduped tweets here — the same number it would have seen.
      const sampleN = new Set(posts.map((p) => p.tweetId)).size;
      skipped.push({ handle, sampleN, reason: 'insufficient_sample' });
      return {
        handle,
        score: null,
        medianViews: null,
        medianComments: null,
        sampleN,
        scoredAt: now,
        updatedAt: now,
      };
    }
    scored += 1;
    return {
      handle,
      score: result.score,
      medianViews: result.medianViews,
      medianComments: result.medianComments,
      sampleN: result.sampleN,
      scoredAt: now,
      updatedAt: now,
    };
  });

  // One sync txn (§7.13 — no await inside, .run() terminals): the roster is read
  // as a comparable set, so a half-written rescore is worse than none.
  db.transaction((tx) => {
    for (const w of writes) {
      tx.update(cannonTargets)
        .set({
          score: w.score,
          medianViews: w.medianViews,
          medianComments: w.medianComments,
          sampleN: w.sampleN,
          scoredAt: w.scoredAt,
          updatedAt: w.updatedAt,
        })
        .where(eq(cannonTargets.handle, w.handle))
        .run();
    }
  });

  return c.json({
    scored,
    skipped,
    // The window is a POST COUNT, not a day count — the score reads an author's
    // newest N posts however long they took to write them.
    samplePosts: CANNON_SAMPLE_POSTS,
    minSample: CANNON_MIN_SAMPLE,
  });
});

// ---------------------------------------------------------------- helpers

type TargetRow = typeof cannonTargets.$inferSelect;

function toView(row: TargetRow, floor: number, now: number): CannonTargetView {
  const scoredAt = row.scoredAt === null ? null : row.scoredAt.getTime();
  return {
    handle: row.handle,
    displayName: row.displayName,
    language: row.language,
    topic: row.topic,
    score: row.score,
    medianViews: row.medianViews,
    medianComments: row.medianComments,
    sampleN: row.sampleN,
    scoredAt: scoredAt === null ? null : new Date(scoredAt).toISOString(),
    active: row.active,
    notes: row.notes,
    addedAt: row.addedAt.toISOString(),
    staleDays: scoredAt === null ? null : Math.floor((now - scoredAt) / DAY_MS),
    belowFloor: row.score !== null && row.score < floor,
  };
}

/** Group the flat read into per-author post lists. The rows arrive in whatever
 *  order SQLite hands them back — `scoreAuthor` owns the dedupe and the sort, so
 *  this only has to bucket. */
function bucketByHandle(
  rows: {
    handle: string;
    tweetId: string;
    views: number;
    comments: number;
    tweetTime: Date | null;
    capturedAt: Date;
  }[],
): Map<string, AuthorPost[]> {
  const byHandle = new Map<string, AuthorPost[]>();
  for (const r of rows) {
    const post: AuthorPost = {
      tweetId: r.tweetId,
      views: r.views,
      comments: r.comments,
      tweetTime: r.tweetTime === null ? null : r.tweetTime.getTime(),
      capturedAt: r.capturedAt.getTime(),
    };
    const held = byHandle.get(r.handle);
    if (held) held.push(post);
    else byHandle.set(r.handle, [post]);
  }
  return byHandle;
}

/** The repo's handle normalization: no `@`, lowercased, X's own charset. */
function normalizeHandle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const h = value.trim().replace(/^@/, '').toLowerCase();
  return USERNAME_RE.test(h) ? h : null;
}

function parseText(value: unknown, maxLen: number): string | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'invalid';
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > maxLen) return 'invalid';
  return trimmed;
}

/** The reply-mode pin (RC.3). Deliberately NOT free text, unlike `language`:
 *  the language pin is normalized at read time by the profile table and an
 *  unrecognized value still names a language usefully, while an unrecognized
 *  `topic` is a silent no-op — the resolver drops it and the operator sees a
 *  pin that does nothing. So it is validated on write and STORED CANONICAL:
 *  'football' and 'Hot Take' land as 'banter' and 'hot-take', which is what
 *  makes `WHERE topic = 'banter'` answerable later.
 *
 *  Null/''/absent clears the pin — clearing has to stay possible, and an empty
 *  string is not a mode. */
function parseTopic(value: unknown): string | null | 'invalid' {
  const text = parseText(value, MAX_TOPIC_LEN);
  if (text === 'invalid' || text === null) return text;
  const mode = resolveModeId(text);
  return mode ? mode.id : 'invalid';
}

/** Absent → the default; out of range → clamped; anything that isn't a positive
 *  integer → null, which the caller turns into a 400. The affinity route's exact
 *  contract (`harvest.ts`), duplicated rather than exported because the two
 *  routers own their own query surface. */
function intParam(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return Math.min(max, Math.max(min, n));
}
