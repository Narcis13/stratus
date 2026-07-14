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
import { GrokApiError, askGrok } from '../../grok/index.ts';
import {
  accountSnapshots,
  ideas,
  metricsSnapshots,
  people,
  postTemplates,
  postsPublished,
  radarDrafts,
  replyDrafts,
  scheduledPosts,
  voiceAuthors,
} from '../db/schema.ts';
import {
  type AngleRow,
  DEFAULT_MIN_CELL_N,
  type IdeaRow,
  type LatencyRow,
  type MeasuredOutcome,
  type MediaRow,
  type PillarRegisterRow,
  type ReplyOrigin,
  type RosterCoverage,
  type StructureRow,
  buildAngleEffectiveness,
  buildBandCalibration,
  buildBatchVsSingle,
  buildIdeaEffectiveness,
  buildLatencyEffectiveness,
  buildMediaEffectiveness,
  buildPillarRegisterScorecard,
  buildRelationshipLift,
  buildRosterCoverage,
  buildStructureEffectiveness,
  classifyReplyOrigin,
  resolveAgeMin,
  scoreReplyOutcome,
  topAngles,
  topStructures,
} from '../playbook.ts';
import type { PostContext, ReplyVariant } from '../replies/prompt.ts';
import { targetBand } from './voice.ts';
import {
  EXTRACT_PROMPT_PREFIX,
  TEMPLATE_EXTRACT_CACHE_KEY,
  TEMPLATE_EXTRACT_MAX_OUTPUT_TOKENS,
  TEMPLATE_SCHEMA,
  parseExtractedTemplate,
} from './voiceExtract.ts';

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
  handle: string;
  hasRelationship: boolean;
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
      handle: d.sourceAuthorUsername.toLowerCase(),
      hasRelationship: typeof ctx?.relationship === 'string' && ctx.relationship.trim() !== '',
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
 *  capture-stamped signal first, else the post-time→draft-time gap (same ladder
 *  as scoreReplyOutcome). */
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
  return acct ? targetBand(acct.followersCount) : null;
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

// -------------------------------------------------- media vs text-only rows

/** Own ORIGINAL posts only (isReply=false) — the studio composes images for
 *  posts, and mixing reply view-distributions in would confound the baseline.
 *  hasMedia is null on rows written before §S0.2 landed (bucketed as unknown). */
export async function loadMediaRows(): Promise<MediaRow[]> {
  const posts = await db
    .select({ tweetId: postsPublished.tweetId, hasMedia: postsPublished.hasMedia })
    .from(postsPublished)
    .where(eq(postsPublished.isReply, false));
  const outcomes = await latestOutcomes(posts.map((p) => p.tweetId));
  return posts.map((p) => ({
    hasMedia: p.hasMedia,
    outcome: outcomes.get(p.tweetId) ?? null,
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
    .select({ postedTweetId: replyDrafts.postedTweetId })
    .from(replyDrafts)
    .where(and(eq(replyDrafts.status, 'posted'), isNotNull(replyDrafts.postedTweetId)));
  const draftPostedIds = new Set(
    draftLinks.flatMap((d) => (d.postedTweetId ? [d.postedTweetId] : [])),
  );

  const radarRows = await db
    .select({ tweetId: radarDrafts.tweetId, replyText: radarDrafts.replyText })
    .from(radarDrafts);
  const radarByTarget = new Map<string, string[]>();
  for (const r of radarRows) {
    const list = radarByTarget.get(r.tweetId) ?? [];
    list.push(r.replyText);
    radarByTarget.set(r.tweetId, list);
  }

  const classified: Array<{ origin: ReplyOrigin; tweetId: string }> = [];
  let unattributed = 0;
  for (const p of published) {
    const origin = classifyReplyOrigin(p, draftPostedIds, radarByTarget);
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

/** Reply-prompt guidance line (gated topAngles over the full posted history).
 *  Always uses the DEFAULT gate — a prompt must never be steered by a lower
 *  bar than the page shows. */
export async function loadReplyGuidance(): Promise<string | null> {
  const rows = await loadReplyRows();
  return topAngles(buildAngleEffectiveness(toAngleRows(rows, new Map())).overall);
}

/** Post-drafter guidance line (gated topStructures over own-winner templates). */
export async function loadPostGuidance(): Promise<string | null> {
  return topStructures(buildStructureEffectiveness(await loadStructureRows()));
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
  let minN = DEFAULT_MIN_CELL_N;
  const minNStr = c.req.query('minN');
  if (minNStr !== undefined) {
    const n = Number(minNStr);
    if (!Number.isInteger(n) || n < 1 || n > MAX_MIN_N) {
      return c.json({ error: 'invalid_min_n' }, 400);
    }
    minN = n;
  }

  const replyRows = await loadReplyRows();
  const followers = await loadFollowersByHandle([...new Set(replyRows.map((r) => r.handle))]);
  const angleRows = toAngleRows(replyRows, followers);

  const scored = replyRows
    .map((r) =>
      scoreReplyOutcome({
        signals: r.signals ?? null,
        sourceMetrics: r.sourceMetrics,
        sourceText: r.sourceText,
        sourcePostedAt: r.sourcePostedAt,
        draftCreatedAt: r.createdAt,
        outcome: r.outcome,
      }),
    )
    .filter((s) => s !== null);

  const structures = buildStructureEffectiveness(await loadStructureRows(), minN);
  const origins = await loadOriginRows();

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
    bandCalibration: buildBandCalibration(scored, minN),
    relationshipLift: buildRelationshipLift(
      replyRows.map((r) => ({ hasRelationship: r.hasRelationship, outcome: r.outcome })),
      minN,
    ),
    mediaEffectiveness: buildMediaEffectiveness(await loadMediaRows(), minN),
    ideaEffectiveness: buildIdeaEffectiveness(await loadIdeaRows(), minN),
    latencyEffectiveness: buildLatencyEffectiveness(toLatencyRows(replyRows), minN),
    rosterCoverage: await loadRosterCoverage(
      new Date(Date.now() - ROSTER_WINDOW_MS),
      new Date(),
      minN,
    ),
    // What the prompts would inject right now (always the default gate).
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
  if (!process.env.XAI_API_KEY) return c.json({ error: 'grok_not_configured' }, 503);

  const raw = await c.req.json().catch(() => ({}));
  let limit = MAX_WINNER_EXTRACT;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const l = (raw as Record<string, unknown>).limit;
    if (l !== undefined && l !== null) {
      if (typeof l !== 'number' || !Number.isInteger(l) || l < 1) {
        return c.json({ error: 'invalid_limit' }, 400);
      }
      limit = Math.min(MAX_WINNER_EXTRACT, l);
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

  const batch = candidates.slice(0, limit);
  let extracted = 0;
  let costUsd = 0;
  const failures: Array<{ tweetId: string; error: string }> = [];
  for (const post of batch) {
    if (!post.text.trim()) {
      failures.push({ tweetId: post.tweetId, error: 'empty_text' });
      continue;
    }
    let result: Awaited<ReturnType<typeof askGrok>>;
    try {
      result = await askGrok({
        prompt: EXTRACT_PROMPT_PREFIX + post.text,
        reasoningEffort: 'low',
        maxOutputTokens: TEMPLATE_EXTRACT_MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        jsonSchema: { name: 'tweet_template', schema: TEMPLATE_SCHEMA },
        promptCacheKey: TEMPLATE_EXTRACT_CACHE_KEY,
      });
    } catch (err) {
      failures.push({
        tweetId: post.tweetId,
        error: err instanceof GrokApiError ? `grok_${err.status}` : String(err),
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
