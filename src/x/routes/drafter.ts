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
// Cost: askGrok already writes the platform='grok' cost_events row — don't
// double-log here. ~$0.01/draft call at the 12KB cached prefix.

import { desc, eq, inArray } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { db } from '../../db/client.ts';
import { GrokApiError, askGrok } from '../../grok/index.ts';
import type { ReasoningEffort } from '../../grok/index.ts';
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
import { loadPromptSafe } from '../prompts/registry.ts';
import { consumeIdeaSafe } from './ideas.ts';
import { loadMeContextSafe } from './me.ts';
import { getActivePillars } from './pillars.ts';
import { loadPostGuidanceSafe } from './playbook.ts';

// Three posts of JSON run ~300 tokens; xAI doesn't count reasoning tokens
// against the cap (verified live on the reply route under a 350 cap).
const MAX_OUTPUT_TOKENS = 600;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_REASONING: ReasoningEffort = 'low';
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
  model?: unknown;
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
  const { body, pillar, idea, ideaId, model, reasoningEffort } = parsed;

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
  const { body, pillar, idea, ideaId, model, reasoningEffort } = parsed;

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
    reasoningEffort,
    quoteTweetId: tweetId,
    pillars,
  });
});

// --------------------------------------------------------------- pipeline

interface GenerateOptions {
  pillar: PostPillar | undefined;
  idea: string | undefined;
  ideaId: string | undefined;
  remix: RemixSource | null;
  model: string | undefined;
  reasoningEffort: ReasoningEffort;
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

  let result: Awaited<ReturnType<typeof askGrok>>;
  try {
    result = await askGrok({
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      messages,
      reasoningEffort: opts.reasoningEffort,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: DEFAULT_TEMPERATURE,
      jsonSchema: { name: 'post_drafts', schema: buildPostDraftsSchema(slugs) },
      // Sha of the effective prompt body + niche suffix — busts the cached
      // prefix on either a prompt override edit or a niche edit.
      promptCacheKey: `${prompt.cacheKey}:${niche.slug}:${niche.updatedAt?.getTime() ?? 0}`,
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
  reasoningEffort: ReasoningEffort;
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

  let reasoningEffort: ReasoningEffort = DEFAULT_REASONING;
  if (body.reasoningEffort !== undefined && body.reasoningEffort !== null) {
    const r = body.reasoningEffort;
    if (r !== 'none' && r !== 'low' && r !== 'medium' && r !== 'high') {
      return { error: 'invalid_reasoning_effort' };
    }
    reasoningEffort = r;
  }

  return { body, pillar, idea, ideaId, model, reasoningEffort };
}
