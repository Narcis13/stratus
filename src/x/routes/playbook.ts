// The Playbook (CIRCLES-PLAN C4) — the measured feedback signals served as one
// JSON page, plus the guidance loaders the drafter/reply prompts consume.
// Mounted under `/x` by `mountX` in ../index.ts — always mounted: the page is
// pure SQL over already-billed data ($0); only the own-winner template
// extraction needs Grok and checks XAI_API_KEY at runtime (503 without it,
// same shape as /pillars/draft).
//
// Routes:
//   GET  /playbook                 ?minN=  (per-cell gate, default 20)
//   POST /playbook/extract-winners { limit? }  ≤20 own winners → post_templates
//
// Aggregation logic is pure and lives in ../playbook.ts; this file only loads
// rows and shapes the response.

import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { GrokApiError } from '../../grok/index.ts';
import {
  type AskLlmResult,
  LlmNotConfiguredError,
  type LlmProvider,
  askLLM,
  llmConfigured,
} from '../../llm/index.ts';
import { OpenRouterApiError } from '../../openrouter/index.ts';
import { type JudgeVerdictLabel, isJudgeVerdictLabel } from '../../shared/judge.ts';
import { SWEEP, type SweepConfig } from '../../shared/radarSweep.ts';
import type { DraftFeatures } from '../../shared/xRankerSignals.ts';
import {
  accountSnapshots,
  cannonTargets,
  draftJudgments,
  harvestRows,
  ideas,
  metricsSnapshots,
  people,
  postTemplates,
  postsPublished,
  radarDrafts,
  replyDrafts,
  replyListUses,
  scheduledPosts,
  voiceAuthors,
} from '../db/schema.ts';
import { judgeTextHash } from '../judge/prompt.ts';
import { loadDoctrine } from '../niche/store.ts';
import {
  type AngleRow,
  DEFAULT_MIN_CELL_N,
  type IdeaRow,
  type JudgeRow,
  type LatencyRow,
  type MeasuredOutcome,
  type MediaRow,
  type ModelRow,
  type OriginalPostRow,
  type OwnReplyPerformance,
  type OwnReplyRow,
  type PillarRegisterRow,
  type RankerPostRow,
  type ReplyOrigin,
  type RosterCoverage,
  type StructureRow,
  type TimelineFunnel,
  buildAngleEffectiveness,
  buildBatchVsSingle,
  buildCoachScoreEffectiveness,
  buildFormatEffectiveness,
  buildIdeaEffectiveness,
  buildJudgeEffectiveness,
  buildLatencyEffectiveness,
  buildMeEffectiveness,
  buildMediaEffectiveness,
  buildModelEffectiveness,
  buildOwnReplyPerformance,
  buildPillarRegisterScorecard,
  buildRankerScoreEffectiveness,
  buildRelationshipLift,
  buildRosterCoverage,
  buildStructureEffectiveness,
  buildTimelineFunnel,
  classifyReplyOrigin,
  normalizeReplyText,
  resolveAgeMin,
  topAngles,
  topStructures,
} from '../playbook.ts';
import { loadPromptSafe, renderPrompt } from '../prompts/registry.ts';
import type { PostContext, ReplyVariant } from '../replies/prompt.ts';
import { getSetting } from '../settings/registry.ts';
import { sweepConfigFromSettings } from '../settings/sweepConfig.ts';
import {
  TEMPLATE_EXTRACT_MAX_OUTPUT_TOKENS,
  TEMPLATE_SCHEMA,
  parseExtractedTemplate,
} from '../voice/extractPrompt.ts';
import { loadActiveCoachLexicon } from './coach.ts';
import { targetBand } from './voice.ts';

// Full posted history — same ceiling as /replies/outcomes (the crosstab wants
// everything; a single user is nowhere near it).
const MAX_REPLY_ROWS = 1000;
const MAX_PUBLISHED_REPLIES = 2000;
// One-time winner extraction is bounded by the plan (≤20 × ~$0.005 ≈ $0.10).
const MAX_WINNER_EXTRACT = 20;
const MAX_MIN_N = 1000;
// §S0.7 roster coverage window — the doctrine's "where did this week's replies
// go" question (matches the Monday-Monday digest week, also 7 days).
const ROSTER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface SnapOutcome extends MeasuredOutcome {
  likes: number | null;
}

/** Latest snapshot per tweet id, reduced to the outcome fields the Playbook
 *  reads. Snapshots arrive newest-first; first seen per tweet wins (same
 *  pattern as routes/metrics.ts listPerformance). */
async function latestOutcomes(ids: string[]): Promise<Map<string, SnapOutcome>> {
  const out = new Map<string, SnapOutcome>();
  if (ids.length === 0) return out;
  const snaps = await db
    .select({
      tweetId: metricsSnapshots.tweetId,
      publicMetrics: metricsSnapshots.publicMetrics,
      nonPublicMetrics: metricsSnapshots.nonPublicMetrics,
    })
    .from(metricsSnapshots)
    .where(inArray(metricsSnapshots.tweetId, ids))
    .orderBy(desc(metricsSnapshots.snapshotAt));
  for (const s of snaps) {
    if (out.has(s.tweetId)) continue;
    const pub = (s.publicMetrics ?? null) as Record<string, number> | null;
    const priv = (s.nonPublicMetrics ?? null) as Record<string, number> | null;
    out.set(s.tweetId, {
      views: pub?.impression_count ?? priv?.impression_count ?? null,
      profileVisits: priv?.user_profile_clicks ?? null,
      likes: pub?.like_count ?? null,
    });
  }
  return out;
}

// ------------------------------------------------------------ reply rows

interface ReplyRow {
  angle: string | null;
  model: string;
  handle: string;
  hasRelationship: boolean;
  hasMe: boolean;
  signals: PostContext['signals'] | null;
  sourceMetrics: PostContext['metrics'] | null;
  sourceText: string;
  sourcePostedAt: Date | null;
  createdAt: Date;
  outcome: SnapOutcome | null;
}

async function loadReplyRows(): Promise<ReplyRow[]> {
  const drafts = await db
    .select({
      sourceAuthorUsername: replyDrafts.sourceAuthorUsername,
      sourceText: replyDrafts.sourceText,
      sourcePostedAt: replyDrafts.sourcePostedAt,
      contextSnapshot: replyDrafts.contextSnapshot,
      replyText: replyDrafts.replyText,
      variants: replyDrafts.variants,
      model: replyDrafts.model,
      postedTweetId: replyDrafts.postedTweetId,
      createdAt: replyDrafts.createdAt,
    })
    .from(replyDrafts)
    .where(eq(replyDrafts.status, 'posted'))
    .orderBy(desc(replyDrafts.createdAt))
    .limit(MAX_REPLY_ROWS);

  const outcomes = await latestOutcomes(
    drafts.flatMap((d) => (d.postedTweetId ? [d.postedTweetId] : [])),
  );

  return drafts.map((d) => {
    const ctx = d.contextSnapshot as Partial<PostContext> | null;
    const variants = d.variants as ReplyVariant[] | null;
    return {
      angle: variants?.find((v) => v.text === d.replyText)?.angle ?? null,
      model: d.model,
      handle: d.sourceAuthorUsername.toLowerCase(),
      hasRelationship: typeof ctx?.relationship === 'string' && ctx.relationship.trim() !== '',
      hasMe: typeof ctx?.me === 'string' && ctx.me.trim() !== '',
      signals: ctx?.signals ?? null,
      sourceMetrics: ctx?.metrics ?? null,
      sourceText: d.sourceText,
      sourcePostedAt: d.sourcePostedAt,
      createdAt: d.createdAt,
      outcome: d.postedTweetId ? (outcomes.get(d.postedTweetId) ?? null) : null,
    };
  });
}

/** Best-known follower count per handle: the people layer first (kept fresh by
 *  profile scrapes), the voice roster as fallback. */
export async function loadFollowersByHandle(handles: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (handles.length === 0) return map;
  const voiceRows = await db
    .select({ handle: voiceAuthors.handle, followersCount: voiceAuthors.followersCount })
    .from(voiceAuthors)
    .where(inArray(voiceAuthors.handle, handles));
  for (const r of voiceRows) {
    if (r.followersCount !== null) map.set(r.handle, r.followersCount);
  }
  const peopleRows = await db
    .select({ handle: people.handle, followersCount: people.followersCount })
    .from(people)
    .where(inArray(people.handle, handles));
  for (const r of peopleRows) {
    if (r.followersCount !== null) map.set(r.handle, r.followersCount);
  }
  return map;
}

function toAngleRows(rows: ReplyRow[], followers: Map<string, number>): AngleRow[] {
  return rows.map((r) => ({
    angle: r.angle,
    authorFollowers: followers.get(r.handle) ?? null,
    outcome: r.outcome,
  }));
}

/** Reply rows keyed by tweet-age-at-draft (§S0.5). ageMin comes from the
 *  capture-stamped signal first, else the post-time→draft-time gap. */
function toLatencyRows(rows: ReplyRow[]): LatencyRow[] {
  return rows.map((r) => ({
    ageMin: resolveAgeMin({
      signals: r.signals,
      sourcePostedAt: r.sourcePostedAt,
      draftCreatedAt: r.createdAt,
    }),
    outcome: r.outcome,
  }));
}

/** Reply rows keyed by drafting model (AI.12) — the judge of the OpenRouter
 *  experiment. `model` is non-null on every posted reply, grouped as-is. */
function toModelRows(rows: ReplyRow[]): ModelRow[] {
  return rows.map((r) => ({ model: r.model, outcome: r.outcome }));
}

// --------------------------------------------------- roster coverage (§S0.7)

/** My current 2–10x target band from the latest account snapshot, or null when
 *  no snapshot exists yet (the daily getMe hasn't run) — without my own size we
 *  can't band anyone. */
async function loadMyTargetBand(): Promise<{ min: number; max: number } | null> {
  const [acct] = await db
    .select({ followersCount: accountSnapshots.followersCount })
    .from(accountSnapshots)
    .orderBy(desc(accountSnapshots.snapshotAt))
    .limit(1);
  if (!acct) return null;
  const doctrine = loadDoctrine();
  return targetBand(acct.followersCount, {
    minX: doctrine.targetBandMinX,
    maxX: doctrine.targetBandMaxX,
  });
}

/** §S0.7 — of the posted replies pasted in [since, until), how many went to
 *  in-band / above / below / unknown-size authors. Pure SQL over reply_drafts
 *  (the only rows that carry the source author), followers resolved exactly
 *  like the angle crosstab (people first, voice fallback), banded against my
 *  own size. Shared by GET /playbook (trailing 7d) and the Sunday digest facts
 *  (the digest week). updatedAt on a posted row is paste time (invariant used
 *  by the brief quota and neglected-targets). */
export async function loadRosterCoverage(
  since: Date,
  until: Date,
  minN = DEFAULT_MIN_CELL_N,
): Promise<RosterCoverage> {
  const rows = await db
    .select({ handle: sql<string>`lower(${replyDrafts.sourceAuthorUsername})` })
    .from(replyDrafts)
    .where(
      and(
        eq(replyDrafts.status, 'posted'),
        gte(replyDrafts.updatedAt, since),
        lt(replyDrafts.updatedAt, until),
      ),
    );
  const followers = await loadFollowersByHandle([...new Set(rows.map((r) => r.handle))]);
  const band = await loadMyTargetBand();
  return buildRosterCoverage(
    rows.map((r) => followers.get(r.handle) ?? null),
    band,
    minN,
  );
}

// ------------------------------------------------- pillar × register rows

async function loadPillarRegisterRows(): Promise<PillarRegisterRow[]> {
  const posts = await db
    .select({
      pillar: scheduledPosts.pillar,
      register: scheduledPosts.register,
      postedTweetId: scheduledPosts.postedTweetId,
    })
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.status, 'posted'), isNotNull(scheduledPosts.postedTweetId)));
  const outcomes = await latestOutcomes(
    posts.flatMap((p) => (p.postedTweetId ? [p.postedTweetId] : [])),
  );
  return posts.map((p) => ({
    pillar: p.pillar,
    register: p.register,
    outcome: p.postedTweetId ? (outcomes.get(p.postedTweetId) ?? null) : null,
  }));
}

// ------------------------------------------------------- structure rows

async function loadStructureRows(): Promise<StructureRow[]> {
  const templates = await db
    .select({
      tweetId: postTemplates.tweetId,
      hookType: postTemplates.hookType,
      device: postTemplates.device,
    })
    .from(postTemplates);
  const outcomes = await latestOutcomes(templates.map((t) => t.tweetId));
  return templates.map((t) => ({
    hookType: t.hookType,
    device: t.device,
    outcome: outcomes.get(t.tweetId) ?? null,
  }));
}

// ------------------------------------------------------ own-original rows

/** Own ORIGINAL posts only (isReply=false) — the studio composes images for
 *  posts, and mixing reply view-distributions in would confound the baseline.
 *  hasMedia is null on rows written before §S0.2 landed (bucketed as unknown).
 *
 *  One query, three cells (SC.5): `text` rides along so the format and
 *  coach-score axes classify at read time off the same rows the media baseline
 *  uses — a second query over the same table would only invite the two
 *  populations to drift apart. */
export async function loadOriginalPostRows(): Promise<Array<MediaRow & OriginalPostRow>> {
  const posts = await db
    .select({
      tweetId: postsPublished.tweetId,
      hasMedia: postsPublished.hasMedia,
      text: postsPublished.text,
    })
    .from(postsPublished)
    .where(eq(postsPublished.isReply, false));
  const outcomes = await latestOutcomes(posts.map((p) => p.tweetId));
  return posts.map((p) => ({
    hasMedia: p.hasMedia,
    text: p.text,
    outcome: outcomes.get(p.tweetId) ?? null,
  }));
}

// ------------------------------------------- judged text → outcome (JD.7)

/** The verdict↔post link, computed at READ time (JD decision 6): no
 *  `judgment_id` column on `posts_published`, no backfill, and a re-judged post
 *  reclassifies itself on the next request. Takes the originals the caller
 *  already loaded rather than re-querying — the SC.5 rule for this table is one
 *  load feeding every own-originals cell, so the media/format/coach/judge axes
 *  cannot drift onto four different populations.
 *
 *  Newest judgment per hash wins: judging the same text twice means the second
 *  reading is the one that described it last. `surface` is filtered to `post`
 *  because that is the population — nothing writes `'reply'` in v1 (decision 2),
 *  and when something does, a reply's verdict must not grade an original. */
export async function loadJudgeRows(originals: OriginalPostRow[]): Promise<JudgeRow[]> {
  const judgments = await db
    .select({ textHash: draftJudgments.textHash, verdict: draftJudgments.verdict })
    .from(draftJudgments)
    .where(eq(draftJudgments.surface, 'post'))
    .orderBy(desc(draftJudgments.judgedAt));
  const bands = new Map<string, JudgeVerdictLabel>();
  for (const j of judgments) {
    if (bands.has(j.textHash) || !isJudgeVerdictLabel(j.verdict)) continue;
    bands.set(j.textHash, j.verdict);
  }
  return originals.map((p) => ({
    verdictBand: bands.get(judgeTextHash(p.text)) ?? null,
    outcome: p.outcome,
  }));
}

// -------------------------------------------------- idea → outcome (§S0.8)

/** §S0.8 — did the Idea Inbox pay? The C6 consume-provenance
 *  (ideas.consumed_by_table/-id) is the only thing that says which published
 *  drafts came from a captured idea; nothing read it back until now. The
 *  population is the two draft surfaces that can carry a backlink (posted
 *  scheduled_posts for originals, posted reply_drafts for replies) — a
 *  hand-written post that never went through a drafter simply reads as unseeded,
 *  which is exactly right. Outcomes via the §6.2 join (postedTweetId → latest
 *  snapshot), same as every other cell. */
export async function loadIdeaRows(): Promise<IdeaRow[]> {
  const consumed = await db
    .select({ table: ideas.consumedByTable, refId: ideas.consumedById })
    .from(ideas)
    .where(and(eq(ideas.status, 'consumed'), isNotNull(ideas.consumedById)));
  const seededPostIds = new Set<string>();
  const seededReplyIds = new Set<string>();
  for (const c of consumed) {
    if (!c.refId) continue;
    if (c.table === 'scheduled_posts') seededPostIds.add(c.refId);
    else if (c.table === 'reply_drafts') seededReplyIds.add(c.refId);
  }

  const posts = await db
    .select({ id: scheduledPosts.id, postedTweetId: scheduledPosts.postedTweetId })
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.status, 'posted'), isNotNull(scheduledPosts.postedTweetId)));
  const replies = await db
    .select({ id: replyDrafts.id, postedTweetId: replyDrafts.postedTweetId })
    .from(replyDrafts)
    .where(and(eq(replyDrafts.status, 'posted'), isNotNull(replyDrafts.postedTweetId)));

  const outcomes = await latestOutcomes([
    ...posts.flatMap((p) => (p.postedTweetId ? [p.postedTweetId] : [])),
    ...replies.flatMap((r) => (r.postedTweetId ? [r.postedTweetId] : [])),
  ]);

  return [
    ...posts.map((p) => ({
      kind: 'post' as const,
      seeded: seededPostIds.has(p.id),
      outcome: p.postedTweetId ? (outcomes.get(p.postedTweetId) ?? null) : null,
    })),
    ...replies.map((r) => ({
      kind: 'reply' as const,
      seeded: seededReplyIds.has(r.id),
      outcome: r.postedTweetId ? (outcomes.get(r.postedTweetId) ?? null) : null,
    })),
  ];
}

// ------------------------------------- timeline opportunity funnel (HV.5)

/** Shorter than the 60-day passive retention on purpose: what I failed to reply
 *  to two months ago is history, not a decision I can still change. */
const TIMELINE_FUNNEL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** `mode` is the ONLY thing separating the ambient home-timeline corpus from
 *  the user's hand-run harvests (HV.1) — every reader carries this filter or it
 *  silently mixes two corpora. */
const PASSIVE_HARVEST_MODE = 'timeline';

/** Seen-vs-replied over the passive corpus. `min(captured_at)` with bare columns
 *  is SQLite's documented first-sighting-per-tweet form (with exactly one
 *  min/max aggregate, every bare column comes from the matching input row) — the
 *  reading that mattered is the one at first sighting, not at the tenth
 *  re-scroll.
 *  Unwindowed row volume is structurally bounded (HV.1's 2,000-rows/day cap ×
 *  the 30-day window), so no extra limit is worth a truncated denominator.
 *  $0: nothing on this path can reach xFetch. */
export async function loadTimelineFunnel(
  minN = DEFAULT_MIN_CELL_N,
  cfg: SweepConfig = SWEEP,
): Promise<TimelineFunnel> {
  const since = new Date(Date.now() - TIMELINE_FUNNEL_WINDOW_MS);
  const seen = await db
    .select({
      tweetId: harvestRows.tweetId,
      capturedAt: sql<number>`min(${harvestRows.capturedAt})`,
      views: harvestRows.views,
      comments: harvestRows.comments,
      // RS: the funnel buckets on `passesSweep`, which reads likes.
      likes: harvestRows.likes,
      text: harvestRows.text,
      tweetTime: harvestRows.tweetTime,
    })
    .from(harvestRows)
    .where(and(eq(harvestRows.mode, PASSIVE_HARVEST_MODE), gte(harvestRows.capturedAt, since)))
    .groupBy(harvestRows.tweetId);
  if (seen.length === 0) return buildTimelineFunnel([], new Set(), minN, cfg);

  // Posted drafts only — the paste-time reading every other cell uses. The set
  // is unwindowed; intersecting it with `seen` is what bounds it.
  const replied = await db
    .select({ sourceTweetId: replyDrafts.sourceTweetId })
    .from(replyDrafts)
    .where(eq(replyDrafts.status, 'posted'));

  return buildTimelineFunnel(
    seen.map((r) => ({
      tweetId: r.tweetId,
      views: r.views,
      comments: r.comments,
      likes: r.likes,
      text: r.text,
      tweetTimeMs: r.tweetTime === null ? null : r.tweetTime.getTime(),
      capturedAtMs: Number(r.capturedAt),
    })),
    new Set(replied.map((r) => r.sourceTweetId)),
    minN,
    cfg,
  );
}

// ------------------------------ own harvested replies (latest-per-tweet)

/** The §2.2 baseline window, matching the reference corpus table in
 *  `x-growth-plan-v3.md` §1. An opening guess — but a cheap one to revise,
 *  because it is a query param: a different window is a URL, not a deploy. */
const OWN_REPLY_WINDOW_DAYS = 14;
const MIN_OWN_REPLY_DAYS = 1;
const MAX_OWN_REPLY_DAYS = 90;
/** The user's hand-run reply harvests — NOT the ambient timeline corpus
 *  (`PASSIVE_HARVEST_MODE` above). §8: every `harvest_rows` reader carries a
 *  `mode` filter or the two corpora silently mix into one number. */
const OWN_REPLY_HARVEST_MODE = 'replies';

/** `harvest_rows.handle` is stored lowercased and @-stripped (`normalizeHandle`
 *  in routes/harvest.ts); `x.identity.selfHandle` is free text the user typed.
 *  Normalize before comparing or a leading '@' silently answers empty. */
function normalizeSelfHandle(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/^@+/, '').toLowerCase();
}

/** `x.identity.selfHandle`, normalized, read from the settings store at REQUEST
 *  time (the money-knob discipline generalized — a handle edited in Settings
 *  must move this list on the very next read, not after a restart). */
export function configuredSelfHandle(): string {
  return normalizeSelfHandle(getSetting<string>('x.identity.selfHandle'));
}

/**
 * My own harvested replies posted since `sinceMs`, ONE ROW PER TWEET — the
 * freshest capture of each.
 *
 * `max(captured_at)` with bare columns is SQLite's documented latest-row-per-
 * group form (with exactly one min/max aggregate, every bare column comes from
 * the matching input row). **The direction is deliberately the OPPOSITE of
 * `loadTimelineFunnel`'s `min(captured_at)`, and both are correct over the same
 * table:** that one wants the band a tweet carried at FIRST sighting, because
 * it measures the decision I faced; this one wants the LATEST view count,
 * because it measures the outcome I earned. Do NOT unify them behind a shared
 * helper with a direction flag — a flag is exactly how someone later passes the
 * wrong one (decision 4).
 *
 * The dedup is not an optimization. `harvest_rows` stores every capture of the
 * same tweet on purpose (that IS the longitudinal curve), so a consumer that
 * forgets to reduce doubles every total the second time a day is harvested.
 *
 * The window is on `tweet_time` (when I posted), never `captured_at` — else a
 * fresh harvest of old replies re-dates them into the window. A reply whose DOM
 * carried no time therefore drops out entirely: it cannot be placed in or out
 * of the window, and guessing either way would be a fabricated denominator.
 *
 * $0: nothing on this path can reach xFetch.
 */
export async function latestOwnReplyRows(
  selfHandle: string,
  sinceMs: number,
): Promise<OwnReplyRow[]> {
  const handle = normalizeSelfHandle(selfHandle);
  if (handle === '') return [];
  const rows = await db
    .select({
      tweetId: harvestRows.tweetId,
      capturedAt: sql<number>`max(${harvestRows.capturedAt})`,
      // RC.6: the reply text rides on the same latest-per-tweet row the metrics
      // do — a second query for it would be a second dedup to get wrong.
      text: harvestRows.text,
      views: harvestRows.views,
      likes: harvestRows.likes,
      comments: harvestRows.comments,
      tweetTime: harvestRows.tweetTime,
      origHandle: harvestRows.origHandle,
      origText: harvestRows.origText,
      origViews: harvestRows.origViews,
      origComments: harvestRows.origComments,
      origTime: harvestRows.origTime,
    })
    .from(harvestRows)
    .where(
      and(
        eq(harvestRows.mode, OWN_REPLY_HARVEST_MODE),
        eq(harvestRows.handle, handle),
        gte(harvestRows.tweetTime, new Date(sinceMs)),
      ),
    )
    .groupBy(harvestRows.tweetId);

  return rows.map((r) => ({
    tweetId: r.tweetId,
    text: r.text,
    views: r.views,
    likes: r.likes,
    comments: r.comments,
    tweetTimeMs: r.tweetTime === null ? null : r.tweetTime.getTime(),
    parentHandle: r.origHandle,
    parentText: r.origText,
    parentViews: r.origViews,
    parentComments: r.origComments,
    parentTimeMs: r.origTime === null ? null : r.origTime.getTime(),
  }));
}

/** The passive/own-profile harvest of MY OWN posts. §8: every `harvest_rows`
 *  reader carries a `mode` filter or the corpora silently mix. */
const OWN_POST_HARVEST_MODE = 'posts';

/**
 * My own harvested ORIGINALS, one row per tweet — the latest capture of each.
 *
 * **`harvest_rows`, never `metrics_snapshots`, and that is a decision rather
 * than a convenience** (XR plan decision 6). Every other own-originals cell on
 * this page reads `loadOriginalPostRows` → `latestOutcomes` → `metrics_snapshots`,
 * which has been FROZEN since 2026-08-12 (invariant #8 deleted the billed daily
 * pass) and which never carried reply or repost counts anyway. The E score needs
 * likes + replies + reposts + views, which is exactly the `harvest_rows` column
 * set and exactly what the $0 DOM harvest already stores. Do NOT widen
 * `loadOriginalPostRows` to serve both — they are two populations measured by
 * two instruments, and one loader would invite them to be compared.
 *
 * `max(captured_at)` with bare columns is SQLite's latest-row-per-group form,
 * the same one `latestOwnReplyRows` uses and for the same reason: a published
 * post's outcome is its FINAL count, not its first sighting. (The passive
 * timeline funnel wants the opposite direction; see that loader's header.)
 *
 * No time window. Unlike the reply corpus this is the whole published history —
 * the cell is asking whether a score predicts reach at all, and throwing away
 * older posts would only shrink an already thin sample.
 *
 * $0: nothing on this path can reach xFetch.
 */
export async function latestOwnPostRows(selfHandle: string): Promise<RankerPostRow[]> {
  const handle = normalizeSelfHandle(selfHandle);
  if (handle === '') return [];
  const rows = await db
    .select({
      capturedAt: sql<number>`max(${harvestRows.capturedAt})`,
      text: harvestRows.text,
      views: harvestRows.views,
      likes: harvestRows.likes,
      comments: harvestRows.comments,
      reposts: harvestRows.reposts,
      hasPhoto: harvestRows.hasPhoto,
      hasVideo: harvestRows.hasVideo,
      isQuote: harvestRows.isQuote,
    })
    .from(harvestRows)
    .where(and(eq(harvestRows.mode, OWN_POST_HARVEST_MODE), eq(harvestRows.handle, handle)))
    .groupBy(harvestRows.tweetId);

  return rows.map((r) => {
    // The shape columns are nullable because older extension builds didn't send
    // them, and §7.11 says an unknown is absent rather than false — `scoreMeasured`
    // and `scoreDraftRanker` both drop an absent feature instead of scoring it 0.
    const feats: DraftFeatures = {};
    if (r.hasPhoto !== null) feats.hasImage = r.hasPhoto;
    if (r.hasVideo !== null) feats.hasVideo = r.hasVideo;
    if (r.isQuote !== null) feats.isQuote = r.isQuote;
    return {
      text: r.text,
      counts: { views: r.views, likes: r.likes, replies: r.comments, reposts: r.reposts },
      feats,
      // The metric columns are notNull with a 0 default, so a zero view count is
      // "the DOM carried no number", not "nobody saw it" — the same `views > 0`
      // reading `loadTimelineFunnel` and `calibrate-ranker.ts` take. Counting it
      // as measured would put a fabricated zero in every median on the page.
      outcome: r.views > 0 ? { views: r.views, profileVisits: null } : null,
    };
  });
}

/** The §2.2–§2.4 tables over my own harvested replies, plus RC.9's room /
 *  opening / contamination axes. Still two SELECTs, both $0 — the rows were
 *  scraped for free and the roster is nine local rows, one of which now also
 *  carries the mode pin. */
export async function loadOwnReplyPerformance(
  minN = DEFAULT_MIN_CELL_N,
  windowDays = OWN_REPLY_WINDOW_DAYS,
): Promise<OwnReplyPerformance> {
  const selfHandle = configuredSelfHandle();
  // §7.11 — an unset handle means the server does not know who I am, which is a
  // different fact from "no replies". Answer the empty shape BEFORE querying:
  // there is no handle to guess, and someone else's corpus is not an answer.
  if (selfHandle === '') return buildOwnReplyPerformance([], new Map(), minN);

  const rows = await latestOwnReplyRows(selfHandle, Date.now() - windowDays * 24 * 60 * 60 * 1000);
  // Arm AND mode attribution are derived at read time from the CURRENT roster
  // (decision: no stored column — either would go stale the moment a handle is
  // camped or re-pinned). `language` null = English, `topic` null = unpinned,
  // per the cannon_targets schema. RC.9 rides on the same SELECT: one more
  // column off nine local rows is not a second query.
  const roster = await db
    .select({
      handle: cannonTargets.handle,
      language: cannonTargets.language,
      topic: cannonTargets.topic,
    })
    .from(cannonTargets);

  return buildOwnReplyPerformance(
    rows,
    new Map(roster.map((r) => [r.handle, { language: r.language, topic: r.topic }])),
    minN,
  );
}

// ---------------------------------------------------- batch vs single rows

async function loadOriginRows(): Promise<{
  rows: Array<{ origin: ReplyOrigin; outcome: SnapOutcome | null }>;
  unattributed: number;
}> {
  const published = await db
    .select({
      tweetId: postsPublished.tweetId,
      inReplyToTweetId: postsPublished.inReplyToTweetId,
      text: postsPublished.text,
    })
    .from(postsPublished)
    .where(eq(postsPublished.isReply, true))
    .orderBy(desc(postsPublished.postedAt))
    .limit(MAX_PUBLISHED_REPLIES);

  const draftLinks = await db
    .select({ postedTweetId: replyDrafts.postedTweetId, source: replyDrafts.source })
    .from(replyDrafts)
    .where(and(eq(replyDrafts.status, 'posted'), isNotNull(replyDrafts.postedTweetId)));
  // postedTweetId → reply_drafts.source (RU.9): exact attribution beats the
  // radar text-match heuristic below. null source = pre-source legacy row.
  const draftSourceByPostedId = new Map<string, string | null>();
  for (const d of draftLinks) {
    if (d.postedTweetId) draftSourceByPostedId.set(d.postedTweetId, d.source ?? null);
  }

  const radarRows = await db
    .select({ tweetId: radarDrafts.tweetId, replyText: radarDrafts.replyText })
    .from(radarDrafts);
  const radarByTarget = new Map<string, string[]>();
  for (const r of radarRows) {
    const list = radarByTarget.get(r.tweetId) ?? [];
    list.push(r.replyText);
    radarByTarget.set(r.tweetId, list);
  }

  // RL.7: every canned reply the user ever composed, as its rendered text
  // (typos and all). Unwindowed like radarRows — the published side is what
  // bounds the population. A use row outlives its list/item on purpose (the
  // table is FK-free), so a deleted list never erases its own attribution.
  const useRows = await db.select({ renderedText: replyListUses.renderedText }).from(replyListUses);
  const cannedTexts = new Set<string>();
  for (const u of useRows) {
    const t = normalizeReplyText(u.renderedText);
    if (t !== '') cannedTexts.add(t);
  }

  const classified: Array<{ origin: ReplyOrigin; tweetId: string }> = [];
  let unattributed = 0;
  for (const p of published) {
    const origin = classifyReplyOrigin(p, draftSourceByPostedId, radarByTarget, cannedTexts);
    if (origin === null) {
      unattributed++;
      continue;
    }
    classified.push({ origin, tweetId: p.tweetId });
  }

  const outcomes = await latestOutcomes(classified.map((c) => c.tweetId));
  return {
    rows: classified.map((c) => ({ origin: c.origin, outcome: outcomes.get(c.tweetId) ?? null })),
    unattributed,
  };
}

// -------------------------------------------------------- guidance loaders

/** UI.4: the configured per-cell sample gate (`x.gates.minCellN`), read from the
 *  settings store at request time — sync, Map-cached, no new billed read. The
 *  registry default is DEFAULT_MIN_CELL_N; `?minN=` still overrides per read. */
function configuredMinCellN(): number {
  return getSetting<number>('x.gates.minCellN');
}

/** Reply-prompt guidance line (gated topAngles over the full posted history).
 *  Always uses the CONFIGURED gate, never a lower one — a prompt must not be
 *  steered by a thinner bar than the page shows. */
export async function loadReplyGuidance(): Promise<string | null> {
  const rows = await loadReplyRows();
  return topAngles(
    buildAngleEffectiveness(toAngleRows(rows, new Map()), configuredMinCellN()).overall,
  );
}

/** Post-drafter guidance line (gated topStructures over own-winner templates). */
export async function loadPostGuidance(): Promise<string | null> {
  return topStructures(
    buildStructureEffectiveness(await loadStructureRows(), configuredMinCellN()),
  );
}

/** The playbook informs a draft; it never blocks one. Same discipline as the
 *  C3 relationship lookup. */
export async function loadReplyGuidanceSafe(): Promise<string | null> {
  try {
    return await loadReplyGuidance();
  } catch (err) {
    console.error(
      'playbook: reply guidance lookup failed (draft proceeds without):',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function loadPostGuidanceSafe(): Promise<string | null> {
  try {
    return await loadPostGuidance();
  } catch (err) {
    console.error(
      'playbook: post guidance lookup failed (draft proceeds without):',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ------------------------------------------------------------------ routes

export const playbook = new Hono();

playbook.get('/playbook', async (c) => {
  // UI.4: the store-configured gate is the default; `?minN=` still wins for a
  // one-off exploratory read (the plan's contract — the knob moves the baseline,
  // the query param moves this request).
  let minN = configuredMinCellN();
  const minNStr = c.req.query('minN');
  if (minNStr !== undefined) {
    const n = Number(minNStr);
    if (!Number.isInteger(n) || n < 1 || n > MAX_MIN_N) {
      return c.json({ error: 'invalid_min_n' }, 400);
    }
    minN = n;
  }

  // The harvested own-reply window, 14 days by default. Out of range is a 400
  // rather than a clamp: `?ownReplyDays=91` is a question about a window this
  // read cannot answer, and silently answering a different one is worse.
  let ownReplyDays = OWN_REPLY_WINDOW_DAYS;
  const ownReplyDaysStr = c.req.query('ownReplyDays');
  if (ownReplyDaysStr !== undefined) {
    const n = Number(ownReplyDaysStr);
    if (!Number.isInteger(n) || n < MIN_OWN_REPLY_DAYS || n > MAX_OWN_REPLY_DAYS) {
      return c.json({ error: 'invalid_own_reply_days' }, 400);
    }
    ownReplyDays = n;
  }

  const replyRows = await loadReplyRows();
  const followers = await loadFollowersByHandle([...new Set(replyRows.map((r) => r.handle))]);
  const angleRows = toAngleRows(replyRows, followers);

  const structures = buildStructureEffectiveness(await loadStructureRows(), minN);
  const origins = await loadOriginRows();
  // One load, four cells — media / format / coach score / judge band all read
  // own originals, so the axes can never drift onto different populations.
  const originals = await loadOriginalPostRows();
  const judgeRows = await loadJudgeRows(originals);
  // The coach cell grades the number the Composer actually showed, so it must
  // grade with the same active lexicon (never throws — degrades to the default).
  const coachLexicon = await loadActiveCoachLexicon();

  const angleEffectiveness = buildAngleEffectiveness(angleRows, minN);
  return c.json({
    minN,
    angleEffectiveness,
    pillarRegister: buildPillarRegisterScorecard(await loadPillarRegisterRows(), minN),
    structures,
    batchVsSingle: {
      ...buildBatchVsSingle(origins.rows, minN),
      unattributed: origins.unattributed,
    },
    relationshipLift: buildRelationshipLift(
      replyRows.map((r) => ({ hasRelationship: r.hasRelationship, outcome: r.outcome })),
      minN,
    ),
    meEffectiveness: buildMeEffectiveness(
      replyRows.map((r) => ({ hasMe: r.hasMe, outcome: r.outcome })),
      minN,
    ),
    mediaEffectiveness: buildMediaEffectiveness(originals, minN),
    formatEffectiveness: buildFormatEffectiveness(originals, minN),
    coachScoreEffectiveness: buildCoachScoreEffectiveness(originals, minN, coachLexicon),
    // XR.4's falsification cell. A DIFFERENT population from the four cells
    // above (own harvested originals, not `posts_published` × `metrics_snapshots`)
    // and deliberately so — see `latestOwnPostRows`. Same lexicon, because C
    // reads the same coach checks the Composer's pill did.
    rankerScoreEffectiveness: buildRankerScoreEffectiveness(
      await latestOwnPostRows(configuredSelfHandle()),
      minN,
      coachLexicon,
    ),
    judgeEffectiveness: buildJudgeEffectiveness(judgeRows, minN),
    ideaEffectiveness: buildIdeaEffectiveness(await loadIdeaRows(), minN),
    latencyEffectiveness: buildLatencyEffectiveness(toLatencyRows(replyRows), minN),
    modelEffectiveness: buildModelEffectiveness(toModelRows(replyRows), minN),
    timelineFunnel: await loadTimelineFunnel(minN, sweepConfigFromSettings()),
    // Age-at-POST over every harvested reply — a different instrument from
    // `latencyEffectiveness` above (age-at-DRAFT over reply_drafts), never one
    // number (decision 5).
    ownReplyPerformance: await loadOwnReplyPerformance(minN, ownReplyDays),
    rosterCoverage: await loadRosterCoverage(
      new Date(Date.now() - ROSTER_WINDOW_MS),
      new Date(),
      minN,
    ),
    // What the prompts would inject right now (at this read's gate).
    guidance: {
      reply: topAngles(angleEffectiveness.overall),
      post: topStructures(structures),
    },
  });
});

// One-time own-winner template extraction (§8.3 pipeline pointed at MY posts).
// Bounded ≤20/call; already-extracted winners are skipped, so re-running only
// picks up newly measured posts — rerunnable without re-spending.
playbook.post('/playbook/extract-winners', async (c) => {
  // AI.6: any-provider gate (Grok or OpenRouter); askLLM enforces the resolved
  // provider's key per candidate. String kept stable for the panel matcher.
  if (!llmConfigured()) return c.json({ error: 'grok_not_configured' }, 503);

  const raw = await c.req.json().catch(() => ({}));
  let limit = MAX_WINNER_EXTRACT;
  let provider: LlmProvider | undefined;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const l = (raw as Record<string, unknown>).limit;
    if (l !== undefined && l !== null) {
      if (typeof l !== 'number' || !Number.isInteger(l) || l < 1) {
        return c.json({ error: 'invalid_limit' }, 400);
      }
      limit = Math.min(MAX_WINNER_EXTRACT, l);
    }
    // AI.5: per-request LLM provider override; absent → the stored AI setting.
    const p = (raw as Record<string, unknown>).provider;
    if (p !== undefined && p !== null) {
      if (p !== 'grok' && p !== 'openrouter') return c.json({ error: 'invalid_provider' }, 400);
      provider = p;
    }
  }

  // Winners = own non-reply posts ranked by latest measured views, minus the
  // ones already extracted.
  const posts = await db
    .select({ tweetId: postsPublished.tweetId, text: postsPublished.text })
    .from(postsPublished)
    .where(eq(postsPublished.isReply, false));
  const existing = new Set(
    (await db.select({ tweetId: postTemplates.tweetId }).from(postTemplates)).map((t) => t.tweetId),
  );
  const outcomes = await latestOutcomes(posts.map((p) => p.tweetId));
  const candidates = posts
    .flatMap((p) => {
      if (existing.has(p.tweetId)) return [];
      const views = outcomes.get(p.tweetId)?.views;
      return views == null ? [] : [{ ...p, views }];
    })
    .sort((a, b) => b.views - a.views);

  // Registry prompt (AI.5): the same `voice-extract` key + cache bucket as the
  // §8.3 voice-tweet extract path, so the two extract paths can't drift.
  const prompt = loadPromptSafe('voice-extract');
  const batch = candidates.slice(0, limit);
  let extracted = 0;
  let costUsd = 0;
  const failures: Array<{ tweetId: string; error: string }> = [];
  for (const post of batch) {
    if (!post.text.trim()) {
      failures.push({ tweetId: post.tweetId, error: 'empty_text' });
      continue;
    }
    let result: AskLlmResult;
    try {
      result = await askLLM(
        {
          prompt: renderPrompt(prompt.body, { TWEET_TEXT: post.text }),
          ...(provider !== undefined ? { provider } : {}),
          jsonSchema: { name: 'tweet_template', schema: TEMPLATE_SCHEMA },
          promptCacheKey: prompt.cacheKey,
        },
        {
          defaults: {
            reasoningEffort: 'low',
            maxOutputTokens: TEMPLATE_EXTRACT_MAX_OUTPUT_TOKENS,
            temperature: 0.2,
          },
        },
      );
    } catch (err) {
      failures.push({
        tweetId: post.tweetId,
        error:
          err instanceof LlmNotConfiguredError
            ? 'llm_not_configured'
            : err instanceof GrokApiError
              ? `grok_${err.status}`
              : err instanceof OpenRouterApiError
                ? `openrouter_${err.status}`
                : String(err),
      });
      continue;
    }
    const template = parseExtractedTemplate(result.text);
    if (!template) {
      failures.push({ tweetId: post.tweetId, error: 'parse_error' });
      continue;
    }
    await db
      .insert(postTemplates)
      .values({
        tweetId: post.tweetId,
        hookType: template.hookType,
        skeleton: template.skeleton,
        lineBreakPattern: template.lineBreakPattern,
        templateLength: template.length,
        device: template.device,
      })
      .onConflictDoNothing();
    extracted++;
    costUsd += result.costUsd;
  }

  return c.json({
    requested: batch.length,
    extracted,
    failures,
    costUsd: Math.round(costUsd * 1e5) / 1e5,
    remaining: Math.max(0, candidates.length - batch.length),
  });
});
