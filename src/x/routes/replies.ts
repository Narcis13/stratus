// Grok-drafted manual-assist reply drafts over `reply_drafts`.
// Mounted under `/x` by `mountX` in ../index.ts.
//
// Routes:
//   POST   /replies/generate   body: { context, idea?, override?, systemPromptOverride?, model?, reasoningEffort? }
//   GET    /replies            ?status=&sourceAuthor=&limit=&since=
//   GET    /replies/outcomes   ?limit=&since=   posted drafts joined to their metrics
//   GET    /replies/:id
//   PATCH  /replies/:id        body: { replyTextEdited?, status?, postedTweetId? }
//   DELETE /replies/:id
//
// Cost: askGrok already writes a `cost_events` row tagged platform='grok'.
// The denormalized `costUsd` column on `reply_drafts` is a UI convenience —
// do NOT double-log here.

import { type SQL, and, desc, eq, gte, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { GrokApiError, askGrok } from '../../grok/index.ts';
import type { ReasoningEffort } from '../../grok/index.ts';
import { type TweetSignals, classifyBand, textLooksLikeReplyBait } from '../../shared/replyBand.ts';
import { metricsSnapshots, postsPublished, replyDrafts } from '../db/schema.ts';
import {
  type RelationshipFacts,
  renderRelationship,
  renderRelationshipBrief,
} from '../people/relationship.ts';
import {
  loadRelationshipFacts,
  normalizePersonHandle,
  safeLogPersonEvents,
  snippet,
  upsertPerson,
} from '../people/store.ts';
import {
  BATCH_REPLY_SCHEMA,
  type PostContext,
  type PostSignals,
  REPLY_PROMPT_TEMPLATE,
  REPLY_VARIANTS_SCHEMA,
  type ReplyVariant,
  buildBatchGrokInput,
  buildGrokInput,
  parseBatchReplies,
  parseReplyVariants,
  passesSpecificityGate,
} from '../replies/prompt.ts';
import { consumeIdeaSafe } from './ideas.ts';
import { getActivePillars } from './pillars.ts';
import { loadReplyGuidanceSafe } from './playbook.ts';
import { type RadarBatchTweet, persistRadarDrafts } from './radar.ts';

// Safety ceiling, not a length lever — reply length is enforced by the prompt
// (~280 chars/variant). Three variants of JSON run ~225 output tokens; xAI does
// not count reasoning tokens against this cap (verified live under the old 350
// cap for two variants), so 520 leaves headroom for the third variant.
const MAX_OUTPUT_TOKENS = 520;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_REASONING: ReasoningEffort = 'low';
const MAX_IDEA_LENGTH = 2000;
// Stable key so repeat drafts land on the same xAI server — the ~17.5KB
// template is a cacheable prefix (context + idea sit at the very end).
const PROMPT_CACHE_KEY = 'stratus-x-reply-draft';
// Batch (Radar §7.2): one Grok call drafts a reply per queued hot/warm tweet.
const BATCH_PROMPT_CACHE_KEY = 'stratus-x-reply-batch';
const MAX_BATCH_TWEETS = 25;

const TWEET_ID_RE = /^\d{1,32}$/;
const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUSES = ['generated', 'copied', 'posted', 'discarded'] as const;
type Status = (typeof STATUSES)[number];

// Status transitions: see REPLY-MASTER-PLAN.md §"PATCH /x/replies/:id".
// `discarded` is terminal; `posted` only re-opens to `discarded` (drop a
// recorded reply from the history).
const ALLOWED_TRANSITIONS: Record<Status, readonly Status[]> = {
  generated: ['copied', 'posted', 'discarded'],
  copied: ['posted', 'discarded'],
  posted: ['discarded'],
  discarded: [],
};

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
// Outcomes feed the BAND recalibration crosstab, which wants the full posted
// history (≥100 rows before thresholds move) — higher cap than the list view.
const MAX_OUTCOMES_LIMIT = 1000;

interface RawBody {
  context?: unknown;
  idea?: unknown;
  // C6 Idea Inbox: when the steer came from a stored idea, its id rides along
  // so a successful draft consumes it (status flip + backlink, routes/ideas.ts).
  ideaId?: unknown;
  override?: unknown;
  systemPromptOverride?: unknown;
  model?: unknown;
  reasoningEffort?: unknown;
  // §8.6 opt-in (default off, set by the extension Settings toggle): steer the
  // reply toward one of the active content pillars.
  applyPillars?: unknown;
}

export const replies = new Hono();

replies.post('/replies/generate', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as RawBody;

  const ctxOrErr = parseContext(body.context);
  if ('error' in ctxOrErr) return c.json({ error: ctxOrErr.error }, 400);
  const ctx = ctxOrErr;

  let systemOverride: string | undefined;
  if (body.systemPromptOverride !== undefined && body.systemPromptOverride !== null) {
    if (typeof body.systemPromptOverride !== 'string') {
      return c.json({ error: 'invalid_system_prompt_override' }, 400);
    }
    systemOverride = body.systemPromptOverride;
  }

  let idea: string | undefined;
  if (body.idea !== undefined && body.idea !== null) {
    if (typeof body.idea !== 'string' || body.idea.length > MAX_IDEA_LENGTH) {
      return c.json({ error: 'invalid_idea' }, 400);
    }
    const trimmed = body.idea.trim();
    if (trimmed !== '') idea = trimmed;
  }

  let ideaId: string | undefined;
  if (body.ideaId !== undefined && body.ideaId !== null) {
    if (typeof body.ideaId !== 'string' || !UUID_RE.test(body.ideaId)) {
      return c.json({ error: 'invalid_idea_id' }, 400);
    }
    ideaId = body.ideaId;
  }

  let model: string | undefined;
  if (body.model !== undefined && body.model !== null) {
    if (typeof body.model !== 'string' || body.model.trim() === '') {
      return c.json({ error: 'invalid_model' }, 400);
    }
    model = body.model;
  }

  let reasoningEffort: ReasoningEffort = DEFAULT_REASONING;
  if (body.reasoningEffort !== undefined && body.reasoningEffort !== null) {
    const r = body.reasoningEffort;
    if (r !== 'none' && r !== 'low' && r !== 'medium' && r !== 'high') {
      return c.json({ error: 'invalid_reasoning_effort' }, 400);
    }
    reasoningEffort = r;
  }

  let override = false;
  if (body.override !== undefined && body.override !== null) {
    if (typeof body.override !== 'boolean') return c.json({ error: 'invalid_override' }, 400);
    override = body.override;
  }

  let applyPillars = false;
  if (body.applyPillars !== undefined && body.applyPillars !== null) {
    if (typeof body.applyPillars !== 'boolean')
      return c.json({ error: 'invalid_apply_pillars' }, 400);
    applyPillars = body.applyPillars;
  }

  // Band gate (§7.3): don't spend a Grok call — or a daily reply slot — on a
  // dead post. Runs BEFORE the Grok call; `override: true` is the explicit
  // escape hatch (the extension arms it on a second deliberate click).
  const gateSignals = gateSignalsFor(ctx, Date.now());
  const band = classifyBand(gateSignals);
  if ((band === null || band === 'skip') && !override) {
    return c.json({ error: 'band_gate', band, signals: { band, ...gateSignals } }, 422);
  }

  // Stamp the gate's verdict when the caller didn't send capture-time signals
  // (CLI callers, older extension builds) — every draft stays a labeled
  // training row for the BAND recalibration crosstab (§6.2).
  if (!ctx.signals) ctx.signals = { band, ...gateSignals };

  // Relationship block (C3): what the people layer knows about this handle,
  // injected at the variable tail so the prompt stops meeting everyone for the
  // first time. Stamped into ctx BEFORE the insert so contextSnapshot records
  // exactly what the model saw (outcome analysis for C4). Best-effort — a
  // people-layer read must never block the draft.
  const relationship = renderRelationship(
    await loadRelationshipFactsSafe(normalizePersonHandle(ctx.handle)),
    new Date(),
  );
  if (relationship !== '') ctx.relationship = relationship;

  // Playbook guidance (C4): the gated topAngles line, stamped into ctx before
  // the insert (like relationship) so contextSnapshot records whether this
  // draft was steered by measured data. Best-effort; null under the gate.
  const guidance = await loadReplyGuidanceSafe();
  if (guidance) ctx.guidance = guidance;

  const pillarDefs = applyPillars ? await getActivePillars() : undefined;
  const messages = buildGrokInput(ctx, systemOverride, idea, pillarDefs);

  const callGrok = (): ReturnType<typeof askGrok> =>
    askGrok({
      ...(model !== undefined ? { model } : {}),
      messages,
      reasoningEffort,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: DEFAULT_TEMPERATURE,
      jsonSchema: { name: 'reply_variants', schema: REPLY_VARIANTS_SCHEMA },
      promptCacheKey: PROMPT_CACHE_KEY,
    });

  let result: Awaited<ReturnType<typeof askGrok>>;
  let costUsd: number;
  let variants: ReplyVariant[] | null;
  try {
    result = await callGrok();
    costUsd = result.costUsd;
    variants = parseReplyVariants(result.text);

    // Specificity gate (§7.1): if no variant carries a digit, a first-person
    // marker, or a named tool, burn exactly one regenerate. Both calls are
    // already cost-logged by askGrok; we just sum the draft's denormalized
    // costUsd. A second all-generic round ships anyway — the human edits.
    const someSpecific = variants?.some((v) => passesSpecificityGate(v.text)) ?? false;
    if (variants === null || !someSpecific) {
      const retry = await callGrok();
      costUsd += retry.costUsd;
      const retryVariants = parseReplyVariants(retry.text);
      if (retryVariants !== null) {
        result = retry;
        variants = retryVariants;
      }
    }
  } catch (err) {
    if (err instanceof GrokApiError) {
      return c.json(
        {
          error: 'grok_upstream_error',
          status: err.status,
          type: err.type,
          code: err.code,
          message: err.message,
          requestId: err.requestId,
        },
        err.status === 429 ? 429 : 502,
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error('/x/replies/generate failed:', detail);
    return c.json({ error: 'generate_failed', detail }, 502);
  }

  if (variants === null) {
    return c.json({ error: 'grok_parse_error', requestId: result.requestId }, 502);
  }

  // Primary pick = first variant that clears the gate; the rest ride along in
  // `variants` for the panel's picker.
  const primary = variants.find((v) => passesSpecificityGate(v.text)) ?? variants[0];
  if (!primary) return c.json({ error: 'grok_parse_error', requestId: result.requestId }, 502);

  const [row] = await db
    .insert(replyDrafts)
    .values({
      sourceTweetId: ctx.tweetId,
      sourceAuthorUsername: ctx.handle,
      sourceAuthorDisplayName: ctx.author,
      sourceText: ctx.text,
      sourceUrl: ctx.url,
      sourcePostedAt: new Date(ctx.postedAt),
      contextSnapshot: ctx,
      replyText: primary.text,
      variants,
      idea: idea ?? null,
      model: result.model,
      promptTokens: result.usage.inputTokens,
      completionTokens: result.usage.outputTokens,
      costUsd: costUsd.toFixed(5),
      grokRequestId: result.requestId,
      systemPromptOverride: systemOverride ?? null,
      status: 'generated',
    })
    .returning();

  // C6: the steer came from the Idea Inbox — consume it with the backlink.
  // A band-gate refusal or Grok failure never reaches here, so a failed
  // generate leaves the idea open.
  if (ideaId && row) await consumeIdeaSafe(ideaId, 'reply_drafts', row.id);

  return c.json(row, 201);
});

// --------------------------------------------------------- batch (Radar §7.2)
//
// One Grok call drafts a reply for a whole queue of hot/warm tweets the Radar
// collected. Unlike /replies/generate this does NOT create reply_drafts rows or
// run the band gate (the Radar already filtered to hot/warm): the replies live
// in the extension's session ring buffer, copied to the clipboard when the user
// opens a tweet. Since CIRCLES-PLAN C0 each reply also lands in `radar_drafts`
// so a browser restart no longer loses paid-for drafts (routes/radar.ts).

interface BatchBody {
  tweets?: unknown;
  idea?: unknown;
  systemPromptOverride?: unknown;
  model?: unknown;
  reasoningEffort?: unknown;
  applyPillars?: unknown;
}

replies.post('/replies/generate-batch', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as BatchBody;

  const parsed = parseBatchTweets(body.tweets);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const tweets = parsed.tweets;

  let systemOverride: string | undefined;
  if (body.systemPromptOverride !== undefined && body.systemPromptOverride !== null) {
    if (typeof body.systemPromptOverride !== 'string') {
      return c.json({ error: 'invalid_system_prompt_override' }, 400);
    }
    systemOverride = body.systemPromptOverride;
  }

  let idea: string | undefined;
  if (body.idea !== undefined && body.idea !== null) {
    if (typeof body.idea !== 'string' || body.idea.length > MAX_IDEA_LENGTH) {
      return c.json({ error: 'invalid_idea' }, 400);
    }
    const trimmed = body.idea.trim();
    if (trimmed !== '') idea = trimmed;
  }

  let model: string | undefined;
  if (body.model !== undefined && body.model !== null) {
    if (typeof body.model !== 'string' || body.model.trim() === '') {
      return c.json({ error: 'invalid_model' }, 400);
    }
    model = body.model;
  }

  let reasoningEffort: ReasoningEffort = DEFAULT_REASONING;
  if (body.reasoningEffort !== undefined && body.reasoningEffort !== null) {
    const r = body.reasoningEffort;
    if (r !== 'none' && r !== 'low' && r !== 'medium' && r !== 'high') {
      return c.json({ error: 'invalid_reasoning_effort' }, 400);
    }
    reasoningEffort = r;
  }

  let applyPillars = false;
  if (body.applyPillars !== undefined && body.applyPillars !== null) {
    if (typeof body.applyPillars !== 'boolean')
      return c.json({ error: 'invalid_apply_pillars' }, 400);
    applyPillars = body.applyPillars;
  }

  // Relationship briefs (C3): same block per tweet, capped to 2 lines/person
  // (renderRelationshipBrief) to protect the token budget. One lookup per
  // distinct handle; best-effort.
  const now = new Date();
  const briefByHandle = new Map<string, string>();
  for (const t of tweets) {
    const handle = normalizePersonHandle(t.handle);
    if (!handle || briefByHandle.has(handle)) continue;
    briefByHandle.set(
      handle,
      renderRelationshipBrief(await loadRelationshipFactsSafe(handle), now),
    );
  }
  for (const t of tweets) {
    const brief = briefByHandle.get(normalizePersonHandle(t.handle) ?? '');
    if (brief) t.relationship = brief;
  }

  const pillarDefs = applyPillars ? await getActivePillars() : undefined;
  // Playbook guidance (C4): one gated line for the whole batch, variable tail.
  const guidance = (await loadReplyGuidanceSafe()) ?? undefined;
  const messages = buildBatchGrokInput(tweets, idea, systemOverride, pillarDefs, guidance);
  // ~280 chars/reply ≈ 90 tokens + JSON overhead; scale with the batch, capped.
  const maxOutputTokens = Math.min(4000, 200 + tweets.length * 140);

  let result: Awaited<ReturnType<typeof askGrok>>;
  try {
    result = await askGrok({
      ...(model !== undefined ? { model } : {}),
      messages,
      reasoningEffort,
      maxOutputTokens,
      temperature: DEFAULT_TEMPERATURE,
      jsonSchema: { name: 'batch_replies', schema: BATCH_REPLY_SCHEMA },
      promptCacheKey: BATCH_PROMPT_CACHE_KEY,
    });
  } catch (err) {
    if (err instanceof GrokApiError) {
      return c.json(
        {
          error: 'grok_upstream_error',
          status: err.status,
          type: err.type,
          code: err.code,
          message: err.message,
          requestId: err.requestId,
        },
        err.status === 429 ? 429 : 502,
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error('/x/replies/generate-batch failed:', detail);
    return c.json({ error: 'generate_failed', detail }, 502);
  }

  const batch = parseBatchReplies(result.text);
  if (batch === null) {
    return c.json({ error: 'grok_parse_error', requestId: result.requestId }, 502);
  }

  // Anchor: keep only replies whose id is one we asked for, first occurrence
  // wins (a model that doubled up on an id can't shadow the right tweet).
  const wanted = new Set(tweets.map((t) => t.tweetId));
  const seen = new Set<string>();
  const out: { tweetId: string; text: string; angle: string }[] = [];
  for (const r of batch) {
    if (!wanted.has(r.tweetId) || seen.has(r.tweetId)) continue;
    seen.add(r.tweetId);
    out.push({ tweetId: r.tweetId, text: r.text, angle: r.angle });
  }

  // C0: the server keeps the copy — the session ring buffer alone lost every
  // draft on browser restart. Never fails the response (money already spent).
  await persistRadarDrafts(tweets, out);

  return c.json({
    replies: out,
    count: out.length,
    requested: tweets.length,
    costUsd: result.costUsd,
    model: result.model,
    requestId: result.requestId,
  });
});

// Pure validator — exported for unit tests. Dedups by id, clamps the batch.
// Optional band/signals (C0) carry the Radar's capture-time verdict into
// `radar_drafts`; they never reach the Grok prompt.
export function parseBatchTweets(
  value: unknown,
): { tweets: RadarBatchTweet[] } | { error: string } {
  if (!Array.isArray(value)) return { error: 'invalid_tweets' };
  if (value.length === 0) return { error: 'empty_tweets' };
  if (value.length > MAX_BATCH_TWEETS) return { error: 'too_many_tweets' };

  const tweets: RadarBatchTweet[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const t = value[i];
    if (!t || typeof t !== 'object' || Array.isArray(t)) return { error: `invalid_tweet_${i}` };
    const r = t as Record<string, unknown>;

    const tweetId = typeof r.tweetId === 'string' ? r.tweetId.trim() : '';
    if (!TWEET_ID_RE.test(tweetId)) return { error: `invalid_tweet_id_${i}` };
    if (seen.has(tweetId)) continue;

    const handleRaw = typeof r.handle === 'string' ? r.handle.trim().replace(/^@/, '') : '';
    if (!USERNAME_RE.test(handleRaw)) return { error: `invalid_tweet_handle_${i}` };
    if (typeof r.text !== 'string' || r.text.trim() === '') {
      return { error: `invalid_tweet_text_${i}` };
    }

    let band: 'hot' | 'warm' | undefined;
    if (r.band !== undefined && r.band !== null) {
      if (r.band !== 'hot' && r.band !== 'warm') return { error: `invalid_tweet_band_${i}` };
      band = r.band;
    }

    let signals: TweetSignals | undefined;
    if (r.signals !== undefined && r.signals !== null) {
      const parsed = parseTweetSignals(r.signals);
      if (parsed === null) return { error: `invalid_tweet_signals_${i}` };
      signals = parsed;
    }

    seen.add(tweetId);
    const author =
      typeof r.author === 'string' && r.author.trim() !== '' ? r.author.trim() : handleRaw;
    const url = typeof r.url === 'string' ? r.url : undefined;
    tweets.push({
      tweetId,
      handle: handleRaw,
      author,
      text: r.text,
      ...(url ? { url } : {}),
      ...(band ? { band } : {}),
      ...(signals ? { signals } : {}),
    });
  }
  return { tweets };
}

// Classifier inputs without the verdict (TweetSignals, not PostSignals).
function parseTweetSignals(value: unknown): TweetSignals | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const s = value as Record<string, unknown>;
  const nums: Record<'views' | 'replies' | 'ageMin' | 'vpm', number> = {
    views: 0,
    replies: 0,
    ageMin: 0,
    vpm: 0,
  };
  for (const k of ['views', 'replies', 'ageMin', 'vpm'] as const) {
    const n = s[k];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
    nums[k] = n;
  }
  if (typeof s.bait !== 'boolean') return null;
  return { ...nums, bait: s.bait };
}

// ---------------------------------------------------------------- list/get

// The default Grok system prompt used when no `systemPromptOverride` is set.
// Surfaced so the extension can show what the override replaces ($0, no Grok).
replies.get('/replies/default-prompt', (c) => {
  return c.json({ prompt: REPLY_PROMPT_TEMPLATE });
});

replies.get('/replies', async (c) => {
  const statusStr = c.req.query('status');
  const sourceAuthorStr = c.req.query('sourceAuthor')?.trim().replace(/^@/, '');
  const limitStr = c.req.query('limit');
  const sinceStr = c.req.query('since');

  const filters: SQL[] = [];

  if (statusStr !== undefined) {
    if (!isStatus(statusStr)) return c.json({ error: 'invalid_status' }, 400);
    filters.push(eq(replyDrafts.status, statusStr));
  }
  if (sourceAuthorStr !== undefined && sourceAuthorStr !== '') {
    if (!USERNAME_RE.test(sourceAuthorStr)) {
      return c.json({ error: 'invalid_source_author' }, 400);
    }
    filters.push(eq(replyDrafts.sourceAuthorUsername, sourceAuthorStr));
  }
  if (sinceStr !== undefined) {
    const since = new Date(sinceStr);
    if (Number.isNaN(since.getTime())) return c.json({ error: 'invalid_since' }, 400);
    filters.push(gte(replyDrafts.createdAt, since));
  }

  let limit = DEFAULT_LIST_LIMIT;
  if (limitStr !== undefined) {
    const n = Number(limitStr);
    if (!Number.isInteger(n) || n < 1) return c.json({ error: 'invalid_limit' }, 400);
    limit = Math.min(MAX_LIST_LIMIT, n);
  }

  const rows = await db
    .select()
    .from(replyDrafts)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(replyDrafts.createdAt))
    .limit(limit);

  return c.json(rows);
});

// ---------------------------------------------------------------- outcomes

// First-party calibration data (OVERHAUL-PLAN §6.2): every posted draft joined
// to its published row and latest metrics snapshot via postedTweetId. All $0 —
// pure SQL over already-billed dailyMetrics reads. `signals` is the band
// verdict stamped at capture time; `outcome` stays null until the 03:00 UTC
// pass has snapshotted the reply (or while postedTweetId is unlinked).
// Registered before `/replies/:id` so "outcomes" isn't parsed as an id.

interface OutcomeDraftRow {
  id: string;
  sourceTweetId: string;
  sourceAuthorUsername: string;
  sourceText: string;
  sourceUrl: string;
  sourcePostedAt: Date | null;
  contextSnapshot: unknown;
  replyText: string;
  replyTextEdited: string | null;
  postedTweetId: string | null;
  createdAt: Date;
}

interface OutcomePostRow {
  tweetId: string;
  postedAt: Date;
  retired: boolean;
}

interface OutcomeSnapRow {
  tweetId: string;
  snapshotAt: Date;
  publicMetrics: unknown;
  nonPublicMetrics: unknown;
}

export interface ReplyOutcome {
  draftId: string;
  sourceTweetId: string;
  sourceAuthorUsername: string;
  sourceText: string;
  sourceUrl: string;
  sourcePostedAt: Date | null;
  /** What actually went out: the human edit when there is one. */
  replyText: string;
  /** Band verdict + classifier inputs stamped at capture; null on old drafts. */
  signals: PostSignals | null;
  /** Capture-time metrics of the tweet replied to (from contextSnapshot). */
  sourceMetrics: PostContext['metrics'] | null;
  draftCreatedAt: Date;
  postedTweetId: string | null;
  postedAt: Date | null;
  retired: boolean | null;
  measuredAt: Date | null;
  outcome: {
    views: number | null;
    likes: number | null;
    replies: number | null;
    retweets: number | null;
    quotes: number | null;
    bookmarks: number | null;
    /** user_profile_clicks — the follow-precursor, free on the owned read. */
    profileVisits: number | null;
  } | null;
}

// Pure join/shape — exported for unit tests. `snaps` must arrive newest-first;
// the first row seen per tweet is its latest snapshot (same pattern as
// routes/metrics.ts listPerformance).
export function buildReplyOutcomes(
  drafts: OutcomeDraftRow[],
  posts: OutcomePostRow[],
  snaps: OutcomeSnapRow[],
): ReplyOutcome[] {
  const postById = new Map(posts.map((p) => [p.tweetId, p]));
  const latestSnap = new Map<string, OutcomeSnapRow>();
  for (const s of snaps) if (!latestSnap.has(s.tweetId)) latestSnap.set(s.tweetId, s);

  return drafts.map((d) => {
    const ctx = d.contextSnapshot as Partial<PostContext> | null;
    const post = d.postedTweetId ? postById.get(d.postedTweetId) : undefined;
    const snap = d.postedTweetId ? latestSnap.get(d.postedTweetId) : undefined;
    const pub = (snap?.publicMetrics ?? null) as Record<string, number> | null;
    const priv = (snap?.nonPublicMetrics ?? null) as Record<string, number> | null;

    return {
      draftId: d.id,
      sourceTweetId: d.sourceTweetId,
      sourceAuthorUsername: d.sourceAuthorUsername,
      sourceText: d.sourceText,
      sourceUrl: d.sourceUrl,
      sourcePostedAt: d.sourcePostedAt,
      replyText: d.replyTextEdited ?? d.replyText,
      signals: ctx?.signals ?? null,
      sourceMetrics: ctx?.metrics ?? null,
      draftCreatedAt: d.createdAt,
      postedTweetId: d.postedTweetId,
      postedAt: post?.postedAt ?? null,
      retired: post?.retired ?? null,
      measuredAt: snap?.snapshotAt ?? null,
      outcome: snap
        ? {
            views: pub?.impression_count ?? priv?.impression_count ?? null,
            likes: pub?.like_count ?? null,
            replies: pub?.reply_count ?? null,
            retweets: pub?.retweet_count ?? null,
            quotes: pub?.quote_count ?? null,
            bookmarks: pub?.bookmark_count ?? null,
            profileVisits: priv?.user_profile_clicks ?? null,
          }
        : null,
    };
  });
}

replies.get('/replies/outcomes', async (c) => {
  const limitStr = c.req.query('limit');
  const sinceStr = c.req.query('since');

  const filters: SQL[] = [eq(replyDrafts.status, 'posted')];
  if (sinceStr !== undefined) {
    const since = new Date(sinceStr);
    if (Number.isNaN(since.getTime())) return c.json({ error: 'invalid_since' }, 400);
    filters.push(gte(replyDrafts.createdAt, since));
  }

  let limit = MAX_LIST_LIMIT;
  if (limitStr !== undefined) {
    const n = Number(limitStr);
    if (!Number.isInteger(n) || n < 1) return c.json({ error: 'invalid_limit' }, 400);
    limit = Math.min(MAX_OUTCOMES_LIMIT, n);
  }

  const drafts = await db
    .select({
      id: replyDrafts.id,
      sourceTweetId: replyDrafts.sourceTweetId,
      sourceAuthorUsername: replyDrafts.sourceAuthorUsername,
      sourceText: replyDrafts.sourceText,
      sourceUrl: replyDrafts.sourceUrl,
      sourcePostedAt: replyDrafts.sourcePostedAt,
      contextSnapshot: replyDrafts.contextSnapshot,
      replyText: replyDrafts.replyText,
      replyTextEdited: replyDrafts.replyTextEdited,
      postedTweetId: replyDrafts.postedTweetId,
      createdAt: replyDrafts.createdAt,
    })
    .from(replyDrafts)
    .where(and(...filters))
    .orderBy(desc(replyDrafts.createdAt))
    .limit(limit);

  const ids = drafts.flatMap((d) => (d.postedTweetId ? [d.postedTweetId] : []));

  const posts = ids.length
    ? await db
        .select({
          tweetId: postsPublished.tweetId,
          postedAt: postsPublished.postedAt,
          retired: postsPublished.retired,
        })
        .from(postsPublished)
        .where(inArray(postsPublished.tweetId, ids))
    : [];

  const snaps = ids.length
    ? await db
        .select({
          tweetId: metricsSnapshots.tweetId,
          snapshotAt: metricsSnapshots.snapshotAt,
          publicMetrics: metricsSnapshots.publicMetrics,
          nonPublicMetrics: metricsSnapshots.nonPublicMetrics,
        })
        .from(metricsSnapshots)
        .where(inArray(metricsSnapshots.tweetId, ids))
        .orderBy(desc(metricsSnapshots.snapshotAt))
    : [];

  const outcomes = buildReplyOutcomes(drafts, posts, snaps);
  const measured = outcomes.filter((o) => o.outcome !== null).length;
  return c.json({
    count: outcomes.length,
    measured,
    unlinked: outcomes.filter((o) => o.postedTweetId === null).length,
    outcomes,
  });
});

replies.get('/replies/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const [row] = await db.select().from(replyDrafts).where(eq(replyDrafts.id, id));
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(row);
});

// ----------------------------------------------------------------- update

replies.patch('/replies/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  const [existing] = await db.select().from(replyDrafts).where(eq(replyDrafts.id, id));
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const updates: Partial<typeof replyDrafts.$inferInsert> = {};

  if (body.replyTextEdited !== undefined) {
    if (body.replyTextEdited === null) {
      updates.replyTextEdited = null;
    } else if (typeof body.replyTextEdited !== 'string') {
      return c.json({ error: 'invalid_reply_text_edited' }, 400);
    } else {
      updates.replyTextEdited = body.replyTextEdited;
    }
  }

  let nextStatus: Status | undefined;
  if (body.status !== undefined) {
    if (!isStatus(body.status)) return c.json({ error: 'invalid_status' }, 400);
    nextStatus = body.status;
    if (nextStatus !== existing.status) {
      const allowed = ALLOWED_TRANSITIONS[existing.status as Status] ?? [];
      if (!allowed.includes(nextStatus)) {
        return c.json(
          { error: 'invalid_status_transition', from: existing.status, to: nextStatus },
          409,
        );
      }
      updates.status = nextStatus;
    }
  }

  if (body.postedTweetId !== undefined) {
    if (body.postedTweetId === null) {
      updates.postedTweetId = null;
    } else if (typeof body.postedTweetId !== 'string' || !TWEET_ID_RE.test(body.postedTweetId)) {
      return c.json({ error: 'invalid_posted_tweet_id' }, 400);
    } else {
      // Only meaningful when the row is/becomes `posted`.
      const finalStatus = nextStatus ?? (existing.status as Status);
      if (finalStatus !== 'posted') {
        return c.json({ error: 'posted_tweet_id_requires_posted_status' }, 400);
      }
      updates.postedTweetId = body.postedTweetId;
    }
  }

  if (Object.keys(updates).length === 0) return c.json(existing);

  updates.updatedAt = new Date();
  const [row] = await db.update(replyDrafts).set(updates).where(eq(replyDrafts.id, id)).returning();

  // People layer (C1): a draft flipping to `posted` is my_reply on its target —
  // updatedAt is in effect paste time. Best-effort, never fails the PATCH.
  if (updates.status === 'posted') {
    const handle = normalizePersonHandle(existing.sourceAuthorUsername);
    if (handle) {
      await upsertPerson(handle, {
        source: 'reply',
        fields: { displayName: existing.sourceAuthorDisplayName },
      }).catch((err) => console.error('people: reply upsert failed:', err));
      await safeLogPersonEvents(
        [
          {
            handle,
            type: 'my_reply',
            refTable: 'reply_drafts',
            refId: id,
            summary: `replied to: "${snippet(existing.sourceText)}"`,
            at: updates.updatedAt,
          },
        ],
        { source: 'reply' },
      );
    }
  }

  return c.json(row);
});

// ----------------------------------------------------------------- delete

replies.delete('/replies/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const result = await db
    .delete(replyDrafts)
    .where(eq(replyDrafts.id, id))
    .returning({ id: replyDrafts.id });
  if (result.length === 0) return c.json({ error: 'not_found' }, 404);
  return c.body(null, 204);
});

// --------------------------------------------------------------- validation

// The people layer informs the draft; it never blocks it. A failed lookup
// (or an invalid handle) just means the prompt meets this person cold.
async function loadRelationshipFactsSafe(handle: string | null): Promise<RelationshipFacts | null> {
  if (!handle) return null;
  try {
    return await loadRelationshipFacts(handle);
  } catch (err) {
    console.error(
      'people: relationship lookup failed (draft proceeds cold):',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

function isStatus(v: unknown): v is Status {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

// Exported for unit tests (pure). Classifier inputs for the band gate: prefer
// the capture-time raw inputs the extension stamped (DOM-aware bait, exact
// age) but always recompute the band server-side — a stale extension build
// doesn't get to spend the Grok call on its own verdict. Without signals the
// inputs derive from metrics + postedAt + the shared text-only bait check.
export function gateSignalsFor(ctx: PostContext, nowMs: number): TweetSignals {
  if (ctx.signals) {
    const { views, replies, ageMin, vpm, bait } = ctx.signals;
    return { views, replies, ageMin, vpm, bait };
  }
  const ageMin = Math.max(0, (nowMs - new Date(ctx.postedAt).getTime()) / 60000);
  return {
    views: ctx.metrics.views,
    replies: ctx.metrics.replies,
    ageMin,
    vpm: ctx.metrics.views / Math.max(ageMin, 1),
    bait: textLooksLikeReplyBait(ctx.text),
  };
}

// Exported for unit tests (pure).
export function parseContext(value: unknown): PostContext | { error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'context_required' };
  }
  const v = value as Record<string, unknown>;

  const tweetId = typeof v.tweetId === 'string' ? v.tweetId.trim() : '';
  if (!TWEET_ID_RE.test(tweetId)) return { error: 'invalid_context_tweet_id' };

  const handleRaw = typeof v.handle === 'string' ? v.handle.trim().replace(/^@/, '') : '';
  if (!USERNAME_RE.test(handleRaw)) return { error: 'invalid_context_handle' };

  if (typeof v.author !== 'string' || v.author.trim() === '') {
    return { error: 'invalid_context_author' };
  }
  if (typeof v.text !== 'string') return { error: 'invalid_context_text' };
  if (typeof v.url !== 'string' || v.url.trim() === '') {
    return { error: 'invalid_context_url' };
  }
  if (typeof v.postedAt !== 'string' || Number.isNaN(new Date(v.postedAt).getTime())) {
    return { error: 'invalid_context_posted_at' };
  }

  if (!v.metrics || typeof v.metrics !== 'object' || Array.isArray(v.metrics)) {
    return { error: 'invalid_context_metrics' };
  }
  const mRaw = v.metrics as Record<string, unknown>;
  const metrics: PostContext['metrics'] = { views: 0, replies: 0, reposts: 0, likes: 0 };
  for (const k of ['views', 'replies', 'reposts', 'likes'] as const) {
    const n = mRaw[k];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      return { error: `invalid_context_metrics_${k}` };
    }
    metrics[k] = Math.floor(n);
  }

  if (!Array.isArray(v.topComments)) return { error: 'invalid_context_top_comments' };
  const topComments: PostContext['topComments'] = [];
  for (let i = 0; i < v.topComments.length; i++) {
    const cc = v.topComments[i];
    if (!cc || typeof cc !== 'object' || Array.isArray(cc)) {
      return { error: `invalid_top_comment_${i}` };
    }
    const r = cc as Record<string, unknown>;
    if (
      typeof r.author !== 'string' ||
      typeof r.handle !== 'string' ||
      typeof r.text !== 'string'
    ) {
      return { error: `invalid_top_comment_${i}` };
    }
    topComments.push({ author: r.author, handle: r.handle, text: r.text });
  }

  // Optional capture-time band signals — absent on older extension builds.
  let signals: PostSignals | undefined;
  if (v.signals !== undefined && v.signals !== null) {
    const parsed = parseSignals(v.signals);
    if ('error' in parsed) return parsed;
    signals = parsed.signals;
  }

  // Optional thread context (§7.5): my post the target tweet replies to.
  let parent: PostContext['parent'];
  if (v.parent !== undefined && v.parent !== null) {
    if (typeof v.parent !== 'object' || Array.isArray(v.parent)) {
      return { error: 'invalid_context_parent' };
    }
    const p = v.parent as Record<string, unknown>;
    if (typeof p.text !== 'string' || p.text.trim() === '') {
      return { error: 'invalid_context_parent' };
    }
    parent = { text: p.text };
  }

  return {
    tweetId,
    handle: handleRaw,
    author: v.author,
    text: v.text,
    url: v.url,
    postedAt: v.postedAt,
    metrics,
    topComments,
    ...(signals ? { signals } : {}),
    ...(parent ? { parent } : {}),
  };
}

function parseSignals(value: unknown): { signals: PostSignals } | { error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'invalid_context_signals' };
  }
  const s = value as Record<string, unknown>;

  const band = s.band;
  if (band !== null && band !== 'hot' && band !== 'warm' && band !== 'skip') {
    return { error: 'invalid_context_signals_band' };
  }

  const nums: Record<'views' | 'replies' | 'ageMin' | 'vpm', number> = {
    views: 0,
    replies: 0,
    ageMin: 0,
    vpm: 0,
  };
  for (const k of ['views', 'replies', 'ageMin', 'vpm'] as const) {
    const n = s[k];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      return { error: `invalid_context_signals_${k}` };
    }
    nums[k] = n;
  }

  if (typeof s.bait !== 'boolean') return { error: 'invalid_context_signals_bait' };

  return { signals: { band, ...nums, bait: s.bait } };
}
