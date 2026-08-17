// Radar drafts (CIRCLES-PLAN C0) — server-side persistence for the replies
// POST /x/replies/generate-batch produces. The extension's session ring buffer
// stays the live queue (unchanged UX); these rows are the copy that survives a
// browser restart, fetched by the panel to rehydrate. Mounted under `/x` by
// `mountX` in ../index.ts — always mounted: reads and status flips are $0 and
// don't need the Grok key (only the insert path, in routes/replies.ts, does).
//
// Routes:
//   GET   /radar/drafts                 ?status=ready|clicked|expired (default ready)
//   PATCH /radar/drafts                 body: { tweetIds: string[], status: 'clicked'|'expired' }
//   PATCH /radar/drafts/:tweetId/tags   body: { tags: string[] | null } — channel tags (C8),
//                                       applied to every draft row of that tweet
//   POST  /radar/sightings              { rows: [...] } — the sighting mirror (RA.1, ≤100/call)
//
// Expiry is a lazy status flip (never a delete), applied on every GET: a radar
// reply to a post that's been dead for 48h is worthless anyway.
//
// EVERY route in this file is $0 by construction and stays that way: nothing
// here may import `xFetch` or `askLLM` (invariants #4/#8). The drafts arrive
// pre-paid from routes/replies.ts; the sightings arrive pre-scraped from the
// page.

import { type SQL, and, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import type { TweetSignals } from '../../shared/replyBand.ts';
import { radarDrafts, radarSightings, replyDrafts } from '../db/schema.ts';
import { loadDoctrine } from '../niche/store.ts';
import { localDayKey } from '../quests.ts';
import {
  type SightingPatch,
  type SightingWireRow,
  derivePostedAt,
  mergeSightingRow,
  parseSightingWireRow,
} from '../radar/corpus.ts';
import type { BatchTweet, PostContext, PostSignals } from '../replies/prompt.ts';
import { getSetting } from '../settings/registry.ts';
import { localDayStart } from './brief.ts';
import { parseChannelTags } from './channels.ts';
import { loadCommitmentsWithDebt } from './goals.ts';
import { utcDayStart } from './harvest.ts';

export const RADAR_DRAFT_TTL_MS = 48 * 60 * 60 * 1000;

const STATUSES = ['ready', 'clicked', 'expired'] as const;
type RadarDraftStatus = (typeof STATUSES)[number];

const TWEET_ID_RE = /^\d{1,32}$/;
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 200;
const MAX_PATCH_IDS = 200;

// Sighting ingest (RA.1). Three opening guesses and one twin.
//
// The twin is `SIGHTING_RECAPTURE_MS`: it MIRRORS the extension's own
// `RADAR_RESEND_MS` (content.ts), down to the "unless the band changed" clause.
// That is not a coincidence to be tidied away later — if the client's window is
// shorter than this one the wire carries rows the server can only count as
// `skippedRecent`, and if it is longer the corpus quietly loses re-sightings.
// Change one, change the other, in the same commit.
const SIGHTING_RECAPTURE_MS = 60_000;
const SIGHTING_DAILY_NEW_CAP = 2000;
const SIGHTING_RETENTION_DAYS = 60;
const MAX_SIGHTING_BATCH = 100;

// Pure — exported for unit tests. A draft is past its useful life 48h after
// drafting; expiry flips status, it never deletes. UI.4: the TTL is a param
// defaulted to today's constant; the route passes `x.radar.draftTtlH`.
export function radarDraftExpired(
  draftedAt: Date,
  nowMs: number,
  ttlMs = RADAR_DRAFT_TTL_MS,
): boolean {
  return nowMs - draftedAt.getTime() >= ttlMs;
}

// The batch endpoint's tweets, optionally carrying the Radar's capture-time
// verdict (band + classifier inputs) and the curation pass's score. CLI callers
// may omit all of them.
export interface RadarBatchTweet extends BatchTweet {
  // 'manual' = a ⊕ pinned tweet (RU.8), 'roster' = a quiet post by someone in my
  // circle (GT.8), 'cannon' = an arbitrage capture (CQ.4), 'sweep' = an armed
  // sweep's filters admitted it (RS.2). Pure queue metadata about HOW the row
  // entered — stored on radar_drafts.band and read nowhere else. There is no
  // longer any other kind of band: the classifier that produced 'hot'/'warm'
  // verdicts is deleted, and legacy rows carrying them are folded onto 'sweep'.
  band?: 'manual' | 'roster' | 'cannon' | 'sweep';
  signals?: TweetSignals;
  // RC.2: 0–100 reply-payoff score from the curation pass that picked this
  // tweet. Absent = drafted without curation. Storage metadata like band and
  // signals — it never reaches the Grok prompt (renderBatchTweet ignores it).
  curationScore?: number;
  // RC.8: the room the SAME curation pass named for this post, riding back on a
  // call already paid for. The odd one out in this block — band, signals and
  // curationScore are storage metadata that stop at `radar_drafts`, while this
  // is an INPUT: `resolveReplyMode` reads it as the second rung of its
  // precedence, above the roster pin (it read the post; the pin only knows the
  // account). Still never rendered directly — `BatchTweet.mode` is what reaches
  // the prompt, and only the resolver writes that.
  curatedMode?: string;
}

export interface RadarDraftInsert {
  tweetId: string;
  url: string | null;
  handle: string;
  author: string | null;
  snippet: string;
  band: 'hot' | 'warm' | 'manual' | 'roster' | 'cannon' | 'sweep' | null;
  signals: TweetSignals | null;
  replyText: string;
  angle: string;
  // All 3 angle variants (RU.2); null until Task 3 supplies them in the batch
  // response. replyText/angle stay the primary (variants[0]).
  variants: { text: string; angle: string }[] | null;
  // The Grok model that drafted these; copied onto the confirmed reply_drafts
  // row later. Null when the batch didn't report one.
  model: string | null;
  // RC.2: the curation score that selected this tweet. **Null = uncurated,
  // never 0** — 0 is a real "nothing to gain replying here" verdict.
  curationScore: number | null;
}

// The batch reply shape persistRadarDrafts/buildRadarDraftRows consume: the
// primary text/angle (variants[0]) plus the full angle set. `variants` is
// optional — the batch route always supplies all 3, but a CLI/smoke caller may
// pass only the primary, in which case the column stays null (RU.2 "unknown"
// semantics; the confirm endpoint reconstructs `[{text: replyText, angle}]`).
interface BatchReplyRow {
  tweetId: string;
  text: string;
  angle: string;
  variants?: { text: string; angle: string }[];
}

// Pure — exported for unit tests. Pair each returned reply with the tweet it
// was drafted for; replies whose id we never asked about are dropped (the
// route already filters those, this is belt-and-suspenders).
export function buildRadarDraftRows(
  tweets: RadarBatchTweet[],
  replies: BatchReplyRow[],
  model: string | null,
): RadarDraftInsert[] {
  const byId = new Map(tweets.map((t) => [t.tweetId, t]));
  const rows: RadarDraftInsert[] = [];
  for (const r of replies) {
    const t = byId.get(r.tweetId);
    if (!t) continue;
    rows.push({
      tweetId: t.tweetId,
      url: t.url ?? null,
      handle: t.handle,
      author: t.author === t.handle ? null : t.author,
      snippet: t.text,
      band: t.band ?? null,
      signals: t.signals ?? null,
      replyText: r.text,
      angle: r.angle,
      // Full 3-variant set from the batch (RU.3); replyText/angle stay the
      // primary. Null when the caller supplied only the primary.
      variants: r.variants && r.variants.length > 0 ? r.variants : null,
      model,
      // `?? null` and not `|| null`: a 0 score is a real verdict, null is
      // "this draft never went through curation".
      curationScore: t.curationScore ?? null,
    });
  }
  return rows;
}

// Called by /replies/generate-batch after a successful Grok call. A failed
// insert must never fail the response — the Grok money is already spent and
// the session buffer still gets the replies; we just lose the restart copy.
export async function persistRadarDrafts(
  tweets: RadarBatchTweet[],
  replies: BatchReplyRow[],
  model: string | null,
): Promise<void> {
  const rows = buildRadarDraftRows(tweets, replies, model);
  if (rows.length === 0) return;
  try {
    await db.insert(radarDrafts).values(rows);
  } catch (err) {
    console.error(
      'radar_drafts insert failed (replies still returned):',
      err instanceof Error ? err.message : err,
    );
  }
}

export const radar = new Hono();

radar.get('/radar/drafts', async (c) => {
  const tweetId = c.req.query('tweetId');
  if (tweetId !== undefined && !TWEET_ID_RE.test(tweetId)) {
    return c.json({ error: 'invalid_tweet_id' }, 400);
  }

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

  // Lazy expiry: flip stale ready rows before serving any view of them. UI.4:
  // the window is settings-backed (`x.radar.draftTtlH`) — raising it resurrects
  // nothing, since expiry is a one-way status flip already applied on past reads.
  const ttlMs = getSetting<number>('x.radar.draftTtlH') * 60 * 60 * 1000;
  await db
    .update(radarDrafts)
    .set({ status: 'expired' })
    .where(
      and(eq(radarDrafts.status, 'ready'), lt(radarDrafts.draftedAt, new Date(Date.now() - ttlMs))),
    );

  // An explicit status wins. Otherwise a tweetId query (the on-page chip
  // fallback / variants-get) wants that tweet's whole non-expired history —
  // a row confirmed to `clicked` still carries its variants; the bare list
  // keeps its ready-queue default.
  const statusCond: SQL = statusStr
    ? eq(radarDrafts.status, statusStr)
    : tweetId
      ? ne(radarDrafts.status, 'expired')
      : eq(radarDrafts.status, 'ready');
  const where = tweetId ? and(statusCond, eq(radarDrafts.tweetId, tweetId)) : statusCond;

  const rows = await db
    .select()
    .from(radarDrafts)
    .where(where)
    .orderBy(desc(radarDrafts.draftedAt))
    .limit(limit);

  return c.json({ count: rows.length, drafts: rows });
});

radar.patch('/radar/drafts', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  const status = body.status;
  if (status !== 'clicked' && status !== 'expired') {
    return c.json({ error: 'invalid_status' }, 400);
  }

  if (!Array.isArray(body.tweetIds) || body.tweetIds.length === 0) {
    return c.json({ error: 'invalid_tweet_ids' }, 400);
  }
  if (body.tweetIds.length > MAX_PATCH_IDS) return c.json({ error: 'too_many_tweet_ids' }, 400);
  const tweetIds: string[] = [];
  for (const id of body.tweetIds) {
    if (typeof id !== 'string' || !TWEET_ID_RE.test(id)) {
      return c.json({ error: 'invalid_tweet_ids' }, 400);
    }
    tweetIds.push(id);
  }

  // 'clicked' only advances ready rows; 'expired' (dismiss) also closes
  // clicked ones. Nothing ever moves backwards.
  const from: SQL =
    status === 'clicked' ? eq(radarDrafts.status, 'ready') : ne(radarDrafts.status, 'expired');

  const updated = await db
    .update(radarDrafts)
    .set({ status })
    .where(and(inArray(radarDrafts.tweetId, tweetIds), from))
    .returning({ id: radarDrafts.id });

  return c.json({ updated: updated.length });
});

// Channel tags (C8). Keyed by tweetId — the panel's queue and the session ring
// buffer identify a sighting by tweet, not by draft row; repeated drafts of the
// same tweet all get the tags so any of them rehydrates correctly.
radar.patch('/radar/drafts/:tweetId/tags', async (c) => {
  const tweetId = c.req.param('tweetId');
  if (!TWEET_ID_RE.test(tweetId)) return c.json({ error: 'invalid_tweet_id' }, 400);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;
  if (body.tags === undefined) return c.json({ error: 'invalid_tags' }, 400);
  const tags = parseChannelTags(body.tags);
  if (tags === 'invalid') return c.json({ error: 'invalid_tags' }, 400);

  const updated = await db
    .update(radarDrafts)
    .set({ tags })
    .where(eq(radarDrafts.tweetId, tweetId))
    .returning({ id: radarDrafts.id });

  if (updated.length === 0) return c.json({ error: 'not_found' }, 404);
  return c.json({ updated: updated.length, tags });
});

// Confirm (RU.5): promote the newest live radar draft for a tweet into a real,
// measured `reply_drafts` row. Called when the user clicks a Radar row (the
// "confirmed" moment) — status `copied`; the posted flip + `my_reply` event
// stay on PATCH /x/replies/:id (never duplicated here). $0: pure DB. Idempotent
// via the soft `reply_draft_id` link. The confirmed row carries the full
// context so it flows into outcomes/angle/latency/quota like any Reply Master
// draft — the exact (no-longer-text-matched) batch-vs-single Playbook split.
radar.post('/radar/drafts/:tweetId/confirm', async (c) => {
  const tweetId = c.req.param('tweetId');
  if (!TWEET_ID_RE.test(tweetId)) return c.json({ error: 'invalid_tweet_id' }, 400);

  // Newest still-live row for this tweet. A `clicked` row counts (it's the
  // idempotent hit); only `expired` is out of scope.
  const [row] = await db
    .select()
    .from(radarDrafts)
    .where(and(eq(radarDrafts.tweetId, tweetId), ne(radarDrafts.status, 'expired')))
    .orderBy(desc(radarDrafts.draftedAt))
    .limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);

  // Idempotent: already confirmed → return the linked reply_drafts row. A
  // dangling link (the reply_drafts row was deleted) falls through to rebuild.
  if (row.replyDraftId) {
    const [existing] = await db
      .select()
      .from(replyDrafts)
      .where(eq(replyDrafts.id, row.replyDraftId));
    if (existing) return c.json(existing, 200);
  }

  // Rebuild a PostContext from what the Radar captured so buildReplyOutcomes
  // (ctx.signals / ctx.metrics) and the Playbook latency reader (signals.ageMin)
  // see the same shape a live Reply Master draft has. `row.band` is not copied
  // in: it is queue metadata that stays in its own column, and the snapshot's
  // signals never carried it even when a classifier existed.
  const sig = row.signals as TweetSignals | null;
  const signals: PostSignals | undefined = sig
    ? {
        views: sig.views,
        replies: sig.replies,
        ageMin: sig.ageMin,
        vpm: sig.vpm,
        bait: sig.bait,
      }
    : undefined;
  // postedAt derived back from draft time − age. Null-signals (CLI) rows have
  // no age → sourcePostedAt stays null and the snapshot falls back to the draft
  // time (only ever read as a last-resort age fallback).
  const sourcePostedAt = sig ? new Date(row.draftedAt.getTime() - sig.ageMin * 60000) : null;
  const url = row.url ?? `https://x.com/${row.handle}/status/${row.tweetId}`;
  const ctx: PostContext = {
    url,
    tweetId: row.tweetId,
    author: row.author ?? row.handle,
    handle: row.handle,
    text: row.snippet,
    postedAt: (sourcePostedAt ?? row.draftedAt).toISOString(),
    metrics: { views: sig?.views ?? 0, replies: sig?.replies ?? 0, reposts: 0, likes: 0 },
    topComments: [],
    ...(signals ? { signals } : {}),
  };

  // Pre-variant / CLI rows kept only the primary — reconstruct the single-entry
  // variants set so the confirmed row is well-formed.
  const variants =
    row.variants && row.variants.length > 0
      ? row.variants
      : [{ text: row.replyText, angle: row.angle }];

  // One sync txn (§7.13 — no await inside, .all()/.run() terminals): create the
  // reply_drafts row, then soft-link + ratchet the radar draft to `clicked`.
  const created = db.transaction((tx) => {
    const [draft] = tx
      .insert(replyDrafts)
      .values({
        sourceTweetId: row.tweetId,
        sourceAuthorUsername: row.handle,
        sourceAuthorDisplayName: row.author ?? null,
        sourceText: row.snippet,
        sourceUrl: url,
        sourcePostedAt,
        contextSnapshot: ctx,
        replyText: row.replyText,
        variants,
        model: row.model ?? 'radar-batch',
        costUsd: null,
        source: 'radar',
        status: 'copied',
      })
      .returning()
      .all();
    if (!draft) throw new Error('reply_drafts insert returned no row');
    tx.update(radarDrafts)
      .set({ replyDraftId: draft.id, status: 'clicked' })
      .where(eq(radarDrafts.id, row.id))
      .run();
    return draft;
  });

  return c.json(created, 201);
});

// CQ.3 — today's placed-reply count, for the panel's queue header.
//
// GET /radar/placed-today?tzOffsetMin= → { dayKey, placed, target }
//
// THE POINT OF THIS ROUTE IS THAT IT WRITES NOTHING. `GET /brief` already
// reports the same number, but it upserts a `streaks` row and lazily flips goal
// statuses on the way — so it is a once-a-session read, not something a panel
// may poll. This one is a pure SELECT pair, which is what makes polling it safe.
// Keep it that way: the day a side-write lands here, the panel's polling starts
// writing a streak diary out of nothing.
//
// `placed` mirrors brief.ts's `postedDraftRows` predicate LITERALLY — status
// 'posted' with `updatedAt` inside the local day. A posted draft is near-terminal
// (only → discarded), so `updatedAt` is in effect "when the human pasted it".
// Two spellings of "a placed reply" is how this counter and the replies quest
// start disagreeing on the same screen.
radar.get('/radar/placed-today', async (c) => {
  const tzStr = c.req.query('tzOffsetMin');
  let tzOffsetMin = 0;
  if (tzStr !== undefined) {
    const n = Number(tzStr);
    if (!Number.isInteger(n) || Math.abs(n) > 16 * 60) {
      return c.json({ error: 'invalid_tz_offset_min' }, 400);
    }
    tzOffsetMin = n;
  }

  const now = new Date();
  const todayStart = localDayStart(now, tzOffsetMin);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  // The commitment is read through `loadCommitmentsWithDebt`, not re-derived
  // from the table (GR.9): "which commitment is active" is one owner's answer,
  // and a second reader of `commitments` is how the header and the quest start
  // showing different targets on the same day.
  const [placedRows, commitmentViews] = await Promise.all([
    db
      .select({ id: replyDrafts.id })
      .from(replyDrafts)
      .where(
        and(
          eq(replyDrafts.status, 'posted'),
          gte(replyDrafts.updatedAt, todayStart),
          lt(replyDrafts.updatedAt, tomorrowStart),
        ),
      ),
    loadCommitmentsWithDebt(now, tzOffsetMin),
  ]);

  // GR.8/Decision 10: an ACTIVE daily commitment is a promise I made to myself,
  // so it outranks the doctrine default. Absent or paused → the niche's reply
  // band ceiling, which is what the queue is sized against.
  const repliesCommitment = commitmentViews.find((v) => v.key === 'replies' && v.active);
  const target = repliesCommitment?.dailyTarget ?? loadDoctrine().replyTargetMax;

  return c.json({ dayKey: localDayKey(now, tzOffsetMin), placed: placedRows.length, target });
});

// ------------------------------------------------------------ sightings (RA.1)

// The sighting mirror. Every tweet the Radar queue admits — an armed sweep, a
// cannon capture, the roster lane, a ⊕ pin — is shipped here by background.ts
// at capture time, so what the queue admitted outlives the browser and is
// readable from outside it. $0 by construction: SQL over rows the page already
// read, no X call and no LLM call anywhere on the path.
//
// Structurally `POST /harvest/passive`'s twin (routes/harvest.ts): parse every
// row before writing any, dedup the batch, skip a re-sighting inside the
// window, cap NEW rows per UTC day, prune lazily on the ingest path, and report
// honest `skipped*` counts. The one real difference is the table shape — the
// passive harvest APPENDS a longitudinal series, this UPSERTS one row per tweet
// (see the `radar_sightings` header for why).
//
// §7.20 note for RA.3: `GET /radar/sightings/:tweetId` lands in this section and
// MUST be registered after the static `GET /radar/sightings`, adjacent to it.
radar.post('/radar/sightings', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return c.json({ error: 'rows_required' }, 400);
  }
  if (body.rows.length > MAX_SIGHTING_BATCH) {
    return c.json({ error: 'too_many_rows', max: MAX_SIGHTING_BATCH }, 400);
  }

  const now = new Date();
  const nowMs = now.getTime();

  // Parse every row BEFORE writing any: one bad row 400s with its index and the
  // batch lands nothing, so a client that drifted knows which reader broke and
  // a resend is not a partial duplicate.
  const parsed: SightingWireRow[] = [];
  for (let i = 0; i < body.rows.length; i++) {
    const row = parseSightingWireRow(body.rows[i], nowMs);
    if ('error' in row) return c.json({ error: row.error, index: i }, 400);
    parsed.push(row);
  }

  let skippedRecent = 0;

  // The same tweet twice in one flush is one sighting; the LAST copy wins
  // because it is the fresher read of the same card.
  const byId = new Map<string, SightingWireRow>();
  for (const r of parsed) {
    if (byId.has(r.tweetId)) skippedRecent++;
    byId.set(r.tweetId, r);
  }
  const unique = [...byId.values()];

  // Lazy retention, harvest's `prunePassiveRuns` rule: no worker for a job that
  // only matters while rows are arriving.
  await db
    .delete(radarSightings)
    .where(
      lt(
        radarSightings.lastSeenAt,
        new Date(nowMs - SIGHTING_RETENTION_DAYS * 24 * 60 * 60 * 1000),
      ),
    );

  const stored = await db
    .select()
    .from(radarSightings)
    .where(
      inArray(
        radarSightings.tweetId,
        unique.map((r) => r.tweetId),
      ),
    );
  const storedById = new Map(stored.map((r) => [r.tweetId, r]));

  const updates: { tweetId: string; patch: SightingPatch }[] = [];
  const inserts: SightingWireRow[] = [];
  for (const r of unique) {
    const prev = storedById.get(r.tweetId);
    if (!prev) {
      inserts.push(r);
      continue;
    }
    // A tweet re-sighted inside the window is the same sighting — UNLESS the
    // band changed, which is a real event (a ⊕ pin landing on a swept row, a
    // sweep admitting a roster capture on its numbers) and must not wait out a
    // throttle meant for scroll noise. Exactly the client's own skip rule.
    if (nowMs - prev.lastSeenAt.getTime() < SIGHTING_RECAPTURE_MS && prev.band === r.band) {
      skippedRecent++;
      continue;
    }
    updates.push({ tweetId: r.tweetId, patch: mergeSightingRow(prev, r) });
  }

  // Volume guard on NEW rows only (a volume guard, not an invariant —
  // concurrent tabs can overshoot by a batch). Re-sightings are deliberately
  // uncapped: an update costs one row of writes and capping them would freeze
  // the corpus at whatever a busy morning happened to write first.
  const [dayCount] = await db
    .select({ n: sql<number>`count(*)` })
    .from(radarSightings)
    .where(gte(radarSightings.firstSeenAt, utcDayStart(now)));
  const room = Math.max(0, SIGHTING_DAILY_NEW_CAP - (dayCount?.n ?? 0));
  const accepted = inserts.slice(0, room);
  const skippedCap = inserts.length - accepted.length;

  // One sync txn (§7.13 — `.run()` terminals, no await inside).
  if (accepted.length > 0 || updates.length > 0) {
    db.transaction((tx) => {
      if (accepted.length > 0) {
        tx.insert(radarSightings)
          .values(
            accepted.map((r) => ({
              tweetId: r.tweetId,
              url: r.url,
              handle: r.handle,
              author: r.author,
              text: r.text,
              band: r.band,
              views: r.views,
              replies: r.replies,
              likes: r.likes,
              bait: r.bait,
              verified: r.verified,
              postedAt: derivePostedAt(r.seenAt.getTime(), r.ageMin),
              sourcePath: r.sourcePath,
              firstSeenAt: r.seenAt,
              lastSeenAt: r.seenAt,
              seenCount: 1,
            })),
          )
          .run();
      }
      for (const u of updates) {
        tx.update(radarSightings).set(u.patch).where(eq(radarSightings.tweetId, u.tweetId)).run();
      }
    });
  }

  return c.json(
    { inserted: accepted.length, updated: updates.length, skippedRecent, skippedCap },
    201,
  );
});

function isStatus(v: unknown): v is RadarDraftStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}
