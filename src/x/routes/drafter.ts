// Grok-drafted original posts (§8.1) + self-quote re-up (§8.5) over
// `scheduled_posts`. Mounted under `/x` by `mountX` — only when XAI_API_KEY is
// set (same shape as the replies router).
//
//   POST /posts/draft  body: { pillar?, idea?, voiceTweetId?, model?, reasoningEffort? }
//     One Grok structured-outputs call returning three register-distinct
//     drafts (plain/spicy/reflective), each landing as a status='draft' row in
//     the calendar with its pillar declared. Nothing posts until the human
//     flips a row to 'pending' — the drafter writes drafts, never schedules.
//
//   POST /posts/reup   body: { tweetId, idea?, pillar?, model?, reasoningEffort? }
//     Same pipeline steered toward a quote-tweet take on one of MY published
//     posts (tweetId must exist in posts_published — the self-quote check).
//     Drafts land with quote_tweet_id set; the publisher re-verifies ownership
//     before the createPost call. Manual approve each time, never scheduled blind.
//
// Few-shot grounding: the top own posts by measured views (latest snapshot per
// tweet) ride along as "my proven posts" — the voice clone anchors on measured
// performance, not taste. All $0: pure SQL over already-billed reads.
//
// Cost: the provider client (askGrok / askOpenRouter via askLLM) already
// writes the cost_events row — don't double-log here. ~$0.01/draft call at
// the 12KB cached prefix on Grok.

import { randomUUID } from 'node:crypto';
import { desc, eq, inArray } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  type AskLlmResult,
  type LlmProvider,
  type LlmReasoningEffort,
  askLLM,
  llmErrorPayload,
} from '../../llm/index.ts';
import { metricsSnapshots, postsPublished, scheduledPosts, voiceTweets } from '../db/schema.ts';
import { loadActiveNicheSafe } from '../niche/store.ts';
import { type PillarDef, parsePillar } from '../posts/pillars.ts';
import {
  type PostPillar,
  type RemixSource,
  type WinnerPost,
  buildPostDraftInput,
  buildPostDraftsSchema,
  parsePostDrafts,
} from '../posts/prompt.ts';
import { REWRITE_SCHEMA, buildRewriteInput, parseRewrite } from '../posts/rewritePrompt.ts';
import {
  type ThreadDraft,
  buildThreadDraftInput,
  buildThreadDraftSchema,
  parseThreadDraft,
} from '../posts/threadPrompt.ts';
import { loadPromptSafe } from '../prompts/registry.ts';
import { consumeIdeaSafe } from './ideas.ts';
import { loadMeContextSafe } from './me.ts';
import { getActivePillars } from './pillars.ts';
import { loadPostGuidanceSafe } from './playbook.ts';

// Three posts of JSON run ~300 tokens; xAI doesn't count reasoning tokens
// against the cap (verified live on the reply route under a 350 cap).
const MAX_OUTPUT_TOKENS = 600;
// A thread is up to 8 tweets of text plus JSON — much larger than 3 short posts.
const THREAD_MAX_OUTPUT_TOKENS = 2000;
const MIN_THREAD_TWEETS = 3;
const MAX_THREAD_TWEETS = 8;
// Three variants of ≤560 chars plus JSON scaffolding — larger than 3 short posts
// but well under the thread cap.
const REWRITE_MAX_OUTPUT_TOKENS = 900;
const MAX_REWRITE_TEXT = 2000;
const MAX_REWRITE_INSTRUCTION = 500;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_REASONING: LlmReasoningEffort = 'low';
const MAX_IDEA_LENGTH = 2000;
const WINNERS_LIMIT = 5;
// Recent non-reply posts scanned for measured winners. The account is far from
// outgrowing an in-memory rank at this size.
const WINNERS_SCAN_LIMIT = 200;
// The post cache key comes from the registry (AI.3): a sha of the effective
// prompt body, niche-suffixed at the call site.

const TWEET_ID_RE = /^\d{1,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RawBody {
  pillar?: unknown;
  idea?: unknown;
  // C6 Idea Inbox: id of the stored idea the steer came from — a successful
  // draft call consumes it (status flip + backlink, routes/ideas.ts).
  ideaId?: unknown;
  voiceTweetId?: unknown;
  tweetId?: unknown;
  // AI.7 draft-thread only: target tweet count, clamped 3–8.
  tweetCount?: unknown;
  model?: unknown;
  // AI.5: per-request LLM provider override ('grok' | 'openrouter'); absent →
  // the stored AI setting decides inside askLLM.
  provider?: unknown;
  reasoningEffort?: unknown;
}

export const drafter = new Hono();

drafter.post('/posts/draft', async (c) => {
  const pillars = await getActivePillars();
  // N0.6: a non-default niche with zero active pillars has an empty enum —
  // refuse BEFORE any Grok spend (§7.4) rather than leak the builder defaults.
  if (pillars.length === 0) {
    return c.json({ error: 'no_pillars_for_niche', niche: loadActiveNicheSafe().slug }, 409);
  }
  const parsed = await parseCommon(
    c.req.raw,
    pillars.map((p) => p.slug),
  );
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const { body, pillar, idea, ideaId, model, provider, reasoningEffort } = parsed;

  let remix: RemixSource | null = null;
  if (body.voiceTweetId !== undefined && body.voiceTweetId !== null) {
    if (typeof body.voiceTweetId !== 'string' || !TWEET_ID_RE.test(body.voiceTweetId.trim())) {
      return c.json({ error: 'invalid_voice_tweet_id' }, 400);
    }
    const [vt] = await db
      .select()
      .from(voiceTweets)
      .where(eq(voiceTweets.tweetId, body.voiceTweetId.trim()));
    if (!vt) return c.json({ error: 'voice_tweet_not_found' }, 404);
    remix = {
      hookType: vt.hookType,
      skeleton: vt.skeleton,
      lineBreakPattern: vt.lineBreakPattern,
      templateLength: vt.templateLength,
      device: vt.device,
      rawText: vt.templateExtractedAt ? null : vt.text,
    };
  }

  return generateAndInsert(c, {
    pillar,
    idea,
    ideaId,
    remix,
    model,
    provider,
    reasoningEffort,
    quoteTweetId: null,
    pillars,
  });
});

drafter.post('/posts/reup', async (c) => {
  const pillars = await getActivePillars();
  // N0.6: same refuse-before-spend guard as /posts/draft — an empty niche enum
  // must never reach askGrok.
  if (pillars.length === 0) {
    return c.json({ error: 'no_pillars_for_niche', niche: loadActiveNicheSafe().slug }, 409);
  }
  const parsed = await parseCommon(
    c.req.raw,
    pillars.map((p) => p.slug),
  );
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const { body, pillar, idea, ideaId, model, provider, reasoningEffort } = parsed;

  const tweetId = typeof body.tweetId === 'string' ? body.tweetId.trim() : '';
  if (!TWEET_ID_RE.test(tweetId)) return c.json({ error: 'invalid_tweet_id' }, 400);

  // Self-quote gate, first pass: only MY published tweets live in
  // posts_published. The publisher re-checks at post time (§8.5/§9.2).
  const [post] = await db
    .select({ tweetId: postsPublished.tweetId, text: postsPublished.text })
    .from(postsPublished)
    .where(eq(postsPublished.tweetId, tweetId));
  if (!post) return c.json({ error: 'not_own_tweet' }, 404);

  const steer = `Quote-tweet re-up: I'm quote-tweeting MY OWN post below to resurface it. Write the quote text — a fresh angle, a consequence, or what changed since. Never summarize or restate the post; the reader sees it right under the quote.\n\nMY POST BEING QUOTED:\n${post.text}${idea ? `\n\nExtra steer: ${idea}` : ''}`;

  return generateAndInsert(c, {
    pillar,
    idea: steer,
    ideaId,
    remix: null,
    model,
    provider,
    reasoningEffort,
    quoteTweetId: tweetId,
    pillars,
  });
});

// AI.7: one structured-outputs call drafts a whole thread (§8.2 shape). The head
// lands status='draft', tails status='segment', sharing a thread_id — the exact
// insert shape as POST /posts/threads (calendar.ts), but drafter-sourced and
// never scheduled. A URL in any segment is allowed here (drafts); the schedule-
// time guard re-checks the head on promotion. Nothing posts without a human.
drafter.post('/posts/draft-thread', async (c) => {
  const pillars = await getActivePillars();
  // N0.6: same refuse-before-spend guard as /posts/draft — an empty niche enum
  // must never reach the LLM.
  if (pillars.length === 0) {
    return c.json({ error: 'no_pillars_for_niche', niche: loadActiveNicheSafe().slug }, 409);
  }
  const slugs = pillars.map((p) => p.slug);
  const parsed = await parseCommon(c.req.raw, slugs);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const { body, pillar, idea, ideaId, model, provider, reasoningEffort } = parsed;

  let tweetCount: number | undefined;
  if (body.tweetCount !== undefined && body.tweetCount !== null) {
    const n = body.tweetCount;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
      return c.json({ error: 'invalid_tweet_count' }, 400);
    }
    tweetCount = Math.min(MAX_THREAD_TWEETS, Math.max(MIN_THREAD_TWEETS, n));
  }

  const winners = await topWinners();
  // Same variable-tail grounding as the post drafter — gated Playbook guidance
  // (C4) and the M1 personal-context block, both best-effort.
  const guidance = await loadPostGuidanceSafe();
  const meContext = await loadMeContextSafe('post');
  const niche = loadActiveNicheSafe();
  const prompt = loadPromptSafe('thread');

  const buildMessages = (nudge?: string) => {
    const msgs = buildThreadDraftInput({
      winners,
      pillars,
      persona: niche.persona,
      beliefs: niche.beliefs,
      template: prompt.body,
      ...(pillar !== undefined ? { pillar } : {}),
      ...(idea !== undefined ? { idea } : {}),
      ...(tweetCount !== undefined ? { tweetCount } : {}),
      ...(guidance !== null ? { guidance } : {}),
      ...(meContext !== null ? { meContext } : {}),
    });
    // The nudge rides a trailing message so the big cached prefix is preserved.
    if (nudge) msgs.push({ role: 'user', content: nudge });
    return msgs;
  };

  const callLlm = (nudge?: string): Promise<AskLlmResult> =>
    askLLM(
      {
        ...(model !== undefined ? { model } : {}),
        ...(provider !== undefined ? { provider } : {}),
        ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
        messages: buildMessages(nudge),
        jsonSchema: { name: 'thread_draft', schema: buildThreadDraftSchema(slugs) },
        promptCacheKey: `${prompt.cacheKey}:${niche.slug}:${niche.updatedAt?.getTime() ?? 0}`,
      },
      {
        defaults: {
          temperature: DEFAULT_TEMPERATURE,
          maxOutputTokens: THREAD_MAX_OUTPUT_TOKENS,
          reasoningEffort: DEFAULT_REASONING,
        },
      },
    );

  let result: AskLlmResult;
  let costUsd: number;
  let draft: ThreadDraft | null;
  try {
    result = await callLlm();
    costUsd = result.costUsd;
    draft = parseThreadDraft(result.text, slugs);
    // Burn exactly one regenerate if a segment is over 280 chars (same one-retry
    // discipline as the reply specificity gate). The nudge names the offenders;
    // both calls are already cost-logged by the provider client — we just sum.
    if (draft === null || draft.overLong.length > 0) {
      const nudge =
        draft && draft.overLong.length > 0
          ? `Some tweets exceed 280 characters (${draft.overLong
              .map((n) => `#${n}`)
              .join(
                ', ',
              )}). Rewrite the whole thread so EVERY tweet is 280 characters or fewer — same idea, same order.`
          : 'Return only valid JSON matching the schema: {"pillar":"...","tweets":["...","..."]} with 4-8 tweets, each 280 characters or fewer.';
      const retry = await callLlm(nudge);
      costUsd += retry.costUsd;
      const retryDraft = parseThreadDraft(retry.text, slugs);
      if (retryDraft) {
        result = retry;
        draft = retryDraft;
      }
    }
  } catch (err) {
    const mapped = llmErrorPayload(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    const detail = err instanceof Error ? err.message : String(err);
    console.error('/x/posts/draft-thread failed:', detail);
    return c.json({ error: 'thread_draft_failed', detail }, 502);
  }

  if (draft === null || draft.overLong.length > 0) {
    return c.json({ error: 'thread_invalid', requestId: result.requestId }, 502);
  }

  const { threadId, rows } = await insertThreadDraft(draft.pillar, draft.tweets, ideaId);

  return c.json(
    {
      threadId,
      segments: rows,
      model: result.model,
      costUsd,
      requestId: result.requestId,
    },
    201,
  );
});

// AI.8: rewrite assist — one structured-outputs call returns three sharper
// versions of a draft (tightened/rehooked/restructured). No DB rows: the
// Composer applies the picked variant to its own state. No pillars, no niche
// persona (a rewrite improves writing, never adds biography) — so the cache key
// is the bare prompt sha with no niche suffix. Refuse-before-spend on bad input.
drafter.post('/posts/rewrite', async (c) => {
  const raw = await c.req.raw.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as {
    text?: unknown;
    instruction?: unknown;
    model?: unknown;
    provider?: unknown;
  };

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < 1 || text.length > MAX_REWRITE_TEXT) {
    return c.json({ error: 'invalid_text' }, 400);
  }

  let instruction: string | undefined;
  if (body.instruction !== undefined && body.instruction !== null) {
    if (typeof body.instruction !== 'string' || body.instruction.length > MAX_REWRITE_INSTRUCTION) {
      return c.json({ error: 'invalid_instruction' }, 400);
    }
    const trimmed = body.instruction.trim();
    if (trimmed !== '') instruction = trimmed;
  }

  let model: string | undefined;
  if (body.model !== undefined && body.model !== null) {
    if (typeof body.model !== 'string' || body.model.trim() === '') {
      return c.json({ error: 'invalid_model' }, 400);
    }
    model = body.model;
  }

  let provider: LlmProvider | undefined;
  if (body.provider !== undefined && body.provider !== null) {
    if (body.provider !== 'grok' && body.provider !== 'openrouter') {
      return c.json({ error: 'invalid_provider' }, 400);
    }
    provider = body.provider;
  }

  const prompt = loadPromptSafe('rewrite');
  const messages = buildRewriteInput({
    draft: text,
    template: prompt.body,
    ...(instruction !== undefined ? { instruction } : {}),
  });

  let result: AskLlmResult;
  try {
    result = await askLLM(
      {
        ...(model !== undefined ? { model } : {}),
        ...(provider !== undefined ? { provider } : {}),
        messages,
        jsonSchema: { name: 'rewrite', schema: REWRITE_SCHEMA },
        promptCacheKey: prompt.cacheKey,
      },
      {
        defaults: {
          temperature: DEFAULT_TEMPERATURE,
          maxOutputTokens: REWRITE_MAX_OUTPUT_TOKENS,
          reasoningEffort: DEFAULT_REASONING,
        },
      },
    );
  } catch (err) {
    const mapped = llmErrorPayload(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    const detail = err instanceof Error ? err.message : String(err);
    console.error('/x/posts/rewrite failed:', detail);
    return c.json({ error: 'rewrite_failed', detail }, 502);
  }

  const variants = parseRewrite(result.text);
  if (variants === null) {
    return c.json({ error: 'rewrite_parse_error', requestId: result.requestId }, 502);
  }
  // Over-long variants were dropped by parseRewrite; zero survivors is a bad call.
  if (variants.length === 0) {
    return c.json({ error: 'rewrite_invalid', requestId: result.requestId }, 502);
  }

  return c.json({
    variants,
    model: result.model,
    costUsd: result.costUsd,
    requestId: result.requestId,
  });
});

// Insert a drafted thread exactly like POST /posts/threads: one head
// (position 1, status='draft') + segment tails sharing a thread_id, all
// source='drafter', unscheduled. Exported so a route test can assert the shape
// without an LLM call. Consumes the seeding idea (backlinked to the head).
export async function insertThreadDraft(pillar: string | null, tweets: string[], ideaId?: string) {
  const threadId = randomUUID();
  const rows = await db
    .insert(scheduledPosts)
    .values(
      tweets.map((text, i) => ({
        text,
        threadId,
        threadPosition: i + 1,
        pillar,
        source: 'drafter',
        scheduledFor: null,
        status: i === 0 ? 'draft' : 'segment',
      })),
    )
    .returning();
  const head = rows[0];
  if (ideaId && head) await consumeIdeaSafe(ideaId, 'scheduled_posts', head.id);
  return { threadId, rows };
}

// --------------------------------------------------------------- pipeline

interface GenerateOptions {
  pillar: PostPillar | undefined;
  idea: string | undefined;
  ideaId: string | undefined;
  remix: RemixSource | null;
  model: string | undefined;
  provider: LlmProvider | undefined;
  reasoningEffort: LlmReasoningEffort | undefined;
  quoteTweetId: string | null;
  pillars: PillarDef[];
}

async function generateAndInsert(c: Context, opts: GenerateOptions): Promise<Response> {
  const winners = await topWinners();
  const slugs = opts.pillars.map((p) => p.slug);
  // Playbook guidance (C4): gated topStructures line from my own measured
  // winners, appended at the variable tail. Best-effort; null under the gate.
  const guidance = await loadPostGuidanceSafe();
  // M1 (ME.3): the dynamic personal-context block, appended at the variable tail
  // (before guidance). Best-effort — null on an empty profile OR any error, so
  // an empty profile leaves the prompt byte-identical to before this feature.
  const meContext = await loadMeContextSafe('post');
  // N0.3: §1/§5 grounding comes from the active niche (server-stamped, never
  // client-supplied); a niche-layer failure degrades to the builder defaults.
  const niche = loadActiveNicheSafe();
  // Registry prompt (AI.3): DB override else the shipped default.
  const prompt = loadPromptSafe('post');
  const messages = buildPostDraftInput({
    winners,
    remix: opts.remix,
    pillars: opts.pillars,
    persona: niche.persona,
    beliefs: niche.beliefs,
    template: prompt.body,
    ...(opts.pillar !== undefined ? { pillar: opts.pillar } : {}),
    ...(opts.idea !== undefined ? { idea: opts.idea } : {}),
    ...(guidance !== null ? { guidance } : {}),
    ...(meContext !== null ? { meContext } : {}),
  });

  // AI.5: askLLM dispatches grok vs openrouter (opts > DB AI settings > the
  // house defaults below — precedence encoded once in askLLM, D44).
  let result: AskLlmResult;
  try {
    result = await askLLM(
      {
        ...(opts.model !== undefined ? { model: opts.model } : {}),
        ...(opts.provider !== undefined ? { provider: opts.provider } : {}),
        ...(opts.reasoningEffort !== undefined ? { reasoningEffort: opts.reasoningEffort } : {}),
        messages,
        jsonSchema: { name: 'post_drafts', schema: buildPostDraftsSchema(slugs) },
        // Sha of the effective prompt body + niche suffix — busts the cached
        // prefix on either a prompt override edit or a niche edit (grok-only).
        promptCacheKey: `${prompt.cacheKey}:${niche.slug}:${niche.updatedAt?.getTime() ?? 0}`,
      },
      {
        defaults: {
          temperature: DEFAULT_TEMPERATURE,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          reasoningEffort: DEFAULT_REASONING,
        },
      },
    );
  } catch (err) {
    const mapped = llmErrorPayload(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    const detail = err instanceof Error ? err.message : String(err);
    console.error('/x/posts/draft failed:', detail);
    return c.json({ error: 'draft_failed', detail }, 502);
  }

  const variants = parsePostDrafts(result.text, slugs);
  if (variants === null) {
    return c.json({ error: 'grok_parse_error', requestId: result.requestId }, 502);
  }

  const rows = await db
    .insert(scheduledPosts)
    .values(
      variants.map((v) => ({
        text: v.text,
        status: 'draft',
        source: 'drafter',
        pillar: v.pillar,
        // C4: the chosen register lands on the row so the Playbook's
        // pillar × register scorecard has something to aggregate.
        register: v.register,
        quoteTweetId: opts.quoteTweetId,
      })),
    )
    .returning();

  // C6: the idea seeded this batch — consume it, backlinked to the first draft
  // row (the batch shares one call; "seeded by" surfaces on that row's detail).
  const first = rows[0];
  if (opts.ideaId && first) await consumeIdeaSafe(opts.ideaId, 'scheduled_posts', first.id);

  return c.json(
    {
      drafts: rows.map((row, i) => ({ ...row, register: variants[i]?.register ?? null })),
      winnersUsed: winners.length,
      model: result.model,
      costUsd: result.costUsd,
      requestId: result.requestId,
    },
    201,
  );
}

// Top own non-reply posts by latest measured views — the few-shot block.
export async function topWinners(limit = WINNERS_LIMIT): Promise<WinnerPost[]> {
  const posts = await db
    .select({ tweetId: postsPublished.tweetId, text: postsPublished.text })
    .from(postsPublished)
    .where(eq(postsPublished.isReply, false))
    .orderBy(desc(postsPublished.postedAt))
    .limit(WINNERS_SCAN_LIMIT);
  if (posts.length === 0) return [];

  const snaps = await db
    .select({
      tweetId: metricsSnapshots.tweetId,
      snapshotAt: metricsSnapshots.snapshotAt,
      publicMetrics: metricsSnapshots.publicMetrics,
      nonPublicMetrics: metricsSnapshots.nonPublicMetrics,
    })
    .from(metricsSnapshots)
    .where(
      inArray(
        metricsSnapshots.tweetId,
        posts.map((p) => p.tweetId),
      ),
    )
    .orderBy(desc(metricsSnapshots.snapshotAt));

  // Snapshots come newest-first; first row seen per tweet is its latest.
  const latest = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) if (!latest.has(s.tweetId)) latest.set(s.tweetId, s);

  const measured: Array<WinnerPost & { sortViews: number }> = [];
  for (const p of posts) {
    const s = latest.get(p.tweetId);
    if (!s) continue;
    const pub = (s.publicMetrics ?? null) as Record<string, number> | null;
    const priv = (s.nonPublicMetrics ?? null) as Record<string, number> | null;
    const views = pub?.impression_count ?? priv?.impression_count ?? null;
    if (views == null) continue;
    measured.push({
      text: p.text,
      views,
      profileVisits: priv?.user_profile_clicks ?? null,
      sortViews: views,
    });
  }

  return measured
    .sort((a, b) => b.sortViews - a.sortViews)
    .slice(0, limit)
    .map(({ sortViews: _, ...w }) => w);
}

// -------------------------------------------------------------- validation

interface ParsedCommon {
  body: RawBody;
  pillar: PostPillar | undefined;
  idea: string | undefined;
  ideaId: string | undefined;
  model: string | undefined;
  provider: LlmProvider | undefined;
  reasoningEffort: LlmReasoningEffort | undefined;
}

async function parseCommon(
  req: Request,
  slugs: string[],
): Promise<ParsedCommon | { error: string }> {
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'invalid_body' };
  }
  const body = raw as RawBody;

  const pillar = parsePillar(body.pillar, slugs);
  if (pillar === 'invalid') return { error: 'invalid_pillar' };

  let idea: string | undefined;
  if (body.idea !== undefined && body.idea !== null) {
    if (typeof body.idea !== 'string' || body.idea.length > MAX_IDEA_LENGTH) {
      return { error: 'invalid_idea' };
    }
    const trimmed = body.idea.trim();
    if (trimmed !== '') idea = trimmed;
  }

  let ideaId: string | undefined;
  if (body.ideaId !== undefined && body.ideaId !== null) {
    if (typeof body.ideaId !== 'string' || !UUID_RE.test(body.ideaId)) {
      return { error: 'invalid_idea_id' };
    }
    ideaId = body.ideaId;
  }

  let model: string | undefined;
  if (body.model !== undefined && body.model !== null) {
    if (typeof body.model !== 'string' || body.model.trim() === '') {
      return { error: 'invalid_model' };
    }
    model = body.model;
  }

  let provider: LlmProvider | undefined;
  if (body.provider !== undefined && body.provider !== null) {
    if (body.provider !== 'grok' && body.provider !== 'openrouter') {
      return { error: 'invalid_provider' };
    }
    provider = body.provider;
  }

  // Only a body-supplied effort rides in opts — the house default goes through
  // askLLM's defaults tier so the stored AI setting can sit between them (D44).
  let reasoningEffort: LlmReasoningEffort | undefined;
  if (body.reasoningEffort !== undefined && body.reasoningEffort !== null) {
    const r = body.reasoningEffort;
    if (r !== 'none' && r !== 'low' && r !== 'medium' && r !== 'high') {
      return { error: 'invalid_reasoning_effort' };
    }
    reasoningEffort = r;
  }

  return { body, pillar, idea, ideaId, model, provider, reasoningEffort };
}
