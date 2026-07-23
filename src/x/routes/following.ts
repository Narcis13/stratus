// $0 following ledger (Guardrails §A). Rows arrive pre-scraped from the
// extension's /following harvest — no X API is touched anywhere in this file,
// and unfollowing itself stays a manual act in the X app (no `follows.write`
// scope, no $0.010/unfollow writes, zero automated-churn exposure).
//
// Routes:
//   POST  /following/runs    {}                             create a run
//   POST  /following/rows    { runId, rows, done? }         batched upsert (≤500)
//   GET   /following         ?status=&q=&limit=             ledger view
//   PATCH /following/:handle { status:'done' } | { keep }   the user's ratchet
//
// The whole design turns on one asymmetry: a handle's PRESENCE in any scrape is
// ground truth (I follow them), but its ABSENCE only means something when the
// scroll actually reached the end of the list. So batches update what they see
// and nothing else; only a run closed with `done: true` — and only one that saw
// at least one row — reconciles the handles it never saw.
//
// GET /following/queue (the capped unfollow batch) lands in GR.3. It must be
// registered ABOVE the `:handle` param route (§7.20) — the ordering below is
// already the safe one, keep it that way.

import { type SQL, and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { following, followingRuns } from '../db/schema.ts';
import { normalizePersonHandle } from '../people/store.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUSES = ['active', 'queued', 'done', 'confirmed', 'gone'] as const;
export type FollowingStatus = (typeof STATUSES)[number];

const MAX_ROWS_PER_BATCH = 500;
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

export const followingRouter = new Hono();

followingRouter.post('/following/runs', async (c) => {
  const [run] = await db.insert(followingRuns).values({}).returning();
  return c.json(run, 201);
});

followingRouter.post('/following/rows', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  const runId = typeof body.runId === 'string' && UUID_RE.test(body.runId) ? body.runId : null;
  if (!runId) return c.json({ error: 'invalid_run_id' }, 400);

  if (body.done !== undefined && typeof body.done !== 'boolean') {
    return c.json({ error: 'invalid_done' }, 400);
  }
  const done = body.done === true;

  if (!Array.isArray(body.rows)) return c.json({ error: 'rows_required' }, 400);
  // An empty batch is meaningful only as a closing call: a scrape whose row
  // count lands on an exact batch boundary has nothing left to ship but still
  // has to close its run, or it could never reconcile.
  if (body.rows.length === 0 && !done) return c.json({ error: 'rows_required' }, 400);
  if (body.rows.length > MAX_ROWS_PER_BATCH) {
    return c.json({ error: 'too_many_rows', max: MAX_ROWS_PER_BATCH }, 400);
  }

  const parsed: FollowingIngestRow[] = [];
  for (let i = 0; i < body.rows.length; i++) {
    const row = parseFollowingRow(body.rows[i]);
    if ('error' in row) return c.json({ error: row.error, index: i }, 400);
    parsed.push(row);
  }

  const [run] = await db.select().from(followingRuns).where(eq(followingRuns.id, runId));
  if (!run) return c.json({ error: 'run_not_found' }, 404);
  if (run.completedAt) return c.json({ error: 'run_already_complete' }, 409);

  // First occurrence wins: the /following page renders top-down, so the earliest
  // sighting in a batch carries the truest list position.
  const deduped = new Map<string, FollowingIngestRow>();
  for (const r of parsed) if (!deduped.has(r.handle)) deduped.set(r.handle, r);
  const rows = [...deduped.values()];

  const known =
    rows.length > 0
      ? await db
          .select()
          .from(following)
          .where(
            inArray(
              following.handle,
              rows.map((r) => r.handle),
            ),
          )
      : [];
  const byHandle = new Map(known.map((r) => [r.handle, r]));

  const now = new Date();
  const rowsSeen = run.rowsSeen + rows.length;
  // The run is only trustworthy if it actually extracted something: a scrape
  // that yielded nothing (broken selector, instant abort) must not conclude that
  // I follow nobody. It closes, but never as `complete`.
  const complete = done && rowsSeen > 0;

  // One sync txn (§7.13 — no await inside, .run()/.all() terminals).
  const result = db.transaction((tx) => {
    const fresh = rows.filter((r) => !byHandle.has(r.handle));
    if (fresh.length > 0) {
      tx.insert(following)
        .values(
          fresh.map((r) => ({
            handle: r.handle,
            displayName: r.displayName,
            followsBack: r.followsBack,
            listPosition: r.listPosition,
            firstSeenAt: now,
            lastSeenAt: now,
            lastRunId: runId,
            status: 'active',
          })),
        )
        .run();
    }

    for (const r of rows) {
      const prev = byHandle.get(r.handle);
      if (!prev) continue;
      // Seeing a handle again is ground truth that I follow them, so a row an
      // earlier complete run wrote off comes back to life. `first_seen_at` stays
      // fill-only even then: it is the only follow-age signal that exists, and a
      // bad reconcile must not be able to erase it. A field this scrape did not
      // report is left alone rather than nulled (§7.11).
      const revived = prev.status === 'confirmed' || prev.status === 'gone';
      tx.update(following)
        .set({
          displayName: r.displayName ?? prev.displayName,
          followsBack: r.followsBack,
          listPosition: r.listPosition ?? prev.listPosition,
          lastSeenAt: now,
          lastRunId: runId,
          ...(revived ? { status: 'active' } : {}),
        })
        .where(eq(following.handle, r.handle))
        .run();
    }

    let reconcile: ReconcileCounts | null = null;
    if (complete) {
      // "Unseen" is `last_run_id != runId`: every batch stamped the run id on
      // the rows it refreshed, so absence needs no in-memory set. The three
      // updates are disjoint (seen vs unseen, then by status), so order is free.
      const unseen = ne(following.lastRunId, runId);
      const gone = tx
        .update(following)
        .set({ status: 'gone' })
        .where(and(unseen, inArray(following.status, ['active', 'queued'])))
        .returning({ handle: following.handle })
        .all();
      const confirmed = tx
        .update(following)
        .set({ status: 'confirmed' })
        .where(and(unseen, eq(following.status, 'done')))
        .returning({ handle: following.handle })
        .all();
      // The one reverse edge: the user ticked "unfollowed" but a full pass still
      // sees them, so it didn't happen and the row goes back in the batch. The
      // mark itself survives — it is churn history the 6h/24h budgets count, and
      // a failed tick must not hand back budget.
      const requeued = tx
        .update(following)
        .set({ status: 'queued' })
        .where(and(eq(following.lastRunId, runId), eq(following.status, 'done')))
        .returning({ handle: following.handle })
        .all();
      reconcile = {
        gone: gone.length,
        confirmed: confirmed.length,
        requeued: requeued.length,
      };
    }

    tx.update(followingRuns)
      .set({
        rowsSeen,
        ...(done ? { completedAt: now, complete } : {}),
      })
      .where(eq(followingRuns.id, runId))
      .run();

    return { inserted: fresh.length, updated: rows.length - fresh.length, reconcile };
  });

  return c.json(
    {
      runId,
      received: parsed.length,
      applied: rows.length,
      inserted: result.inserted,
      updated: result.updated,
      rowsSeen,
      complete,
      reconcile: result.reconcile,
    },
    201,
  );
});

// Ledger view. `q` is a plain case-insensitive substring over handle + display
// name (instr, not like — handles legitimately contain `_`, which LIKE would
// read as a wildcard).
followingRouter.get('/following', async (c) => {
  const statusStr = c.req.query('status');
  if (statusStr !== undefined && !isStatus(statusStr)) {
    return c.json({ error: 'invalid_status' }, 400);
  }

  const limitStr = c.req.query('limit');
  let limit = DEFAULT_LIST_LIMIT;
  if (limitStr !== undefined) {
    const n = Number(limitStr);
    if (!Number.isInteger(n) || n < 1) return c.json({ error: 'invalid_limit' }, 400);
    limit = Math.min(MAX_LIST_LIMIT, n);
  }

  const q = (c.req.query('q') ?? '').trim().toLowerCase();

  const conds: SQL[] = [];
  if (statusStr) conds.push(eq(following.status, statusStr));
  if (q !== '') {
    conds.push(
      sql`(instr(${following.handle}, ${q}) > 0 or instr(lower(coalesce(${following.displayName}, '')), ${q}) > 0)`,
    );
  }
  const where = conds.length > 0 ? and(...conds) : undefined;

  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(following)
      .where(where)
      .orderBy(desc(following.firstSeenAt), asc(following.handle))
      .limit(limit),
    db.select({ total: sql<number>`count(*)` }).from(following).where(where),
  ]);

  const [lastComplete] = await db
    .select({ completedAt: followingRuns.completedAt })
    .from(followingRuns)
    .where(eq(followingRuns.complete, true))
    .orderBy(desc(followingRuns.completedAt))
    .limit(1);

  return c.json({
    count: rows.length,
    total: Number(totals?.total ?? 0),
    lastCompleteRunAt: lastComplete?.completedAt?.toISOString() ?? null,
    following: rows,
  });
});

// The user's half of the ratchet. `done` is the ONLY status a client may set,
// and only out of `queued` — every other edge belongs to the complete-run
// reconcile (§7.10). `keep` is an independent pin and moves no status: GR.3's
// queue filters kept rows out of the batch instead.
followingRouter.patch('/following/:handle', async (c) => {
  const handle = normalizePersonHandle(c.req.param('handle'));
  if (!handle) return c.json({ error: 'invalid_handle' }, 400);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  const hasStatus = body.status !== undefined;
  const hasKeep = body.keep !== undefined;
  if (!hasStatus && !hasKeep) return c.json({ error: 'empty_patch' }, 400);
  if (hasStatus && !isStatus(body.status)) return c.json({ error: 'invalid_status' }, 400);
  if (hasKeep && typeof body.keep !== 'boolean') return c.json({ error: 'invalid_keep' }, 400);

  const [row] = await db.select().from(following).where(eq(following.handle, handle));
  if (!row) return c.json({ error: 'not_found' }, 404);

  const patch: Partial<typeof following.$inferInsert> = {};
  if (hasStatus) {
    if (body.status !== 'done' || row.status !== 'queued') {
      return c.json({ error: 'invalid_transition', from: row.status }, 409);
    }
    patch.status = 'done';
    patch.unfollowMarkedAt = new Date();
  }
  if (hasKeep) patch.keep = body.keep as boolean;

  const [updated] = await db
    .update(following)
    .set(patch)
    .where(eq(following.handle, handle))
    .returning();

  return c.json(updated);
});

// --------------------------------------------------------------- validation

export interface FollowingIngestRow {
  handle: string;
  displayName: string | null;
  followsBack: boolean;
  listPosition: number | null;
}

interface ReconcileCounts {
  gone: number;
  confirmed: number;
  requeued: number;
}

// Exported for unit tests (pure).
export function parseFollowingRow(value: unknown): FollowingIngestRow | { error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'invalid_row' };
  }
  const v = value as Record<string, unknown>;

  const handle = normalizePersonHandle(v.handle);
  if (!handle) return { error: 'invalid_handle' };

  let displayName: string | null = null;
  if (v.displayName !== undefined && v.displayName !== null) {
    if (typeof v.displayName !== 'string') return { error: 'invalid_display_name' };
    displayName = v.displayName.trim() === '' ? null : v.displayName.trim();
  }

  // Required, not optional-with-a-default: "did they follow back" is the entire
  // second half of the scrape, and a build that can't report it must fail loudly
  // rather than silently mark the whole roster as non-reciprocating.
  if (typeof v.followsBack !== 'boolean') return { error: 'invalid_follows_back' };

  let listPosition: number | null = null;
  if (v.listPosition !== undefined && v.listPosition !== null) {
    const n = v.listPosition;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
      return { error: 'invalid_list_position' };
    }
    listPosition = n;
  }

  return { handle, displayName, followsBack: v.followsBack, listPosition };
}

function isStatus(v: unknown): v is FollowingStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}
