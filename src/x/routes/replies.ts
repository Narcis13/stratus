// Grok-drafted manual-assist reply drafts over `reply_drafts`.
// Mounted under `/x` by `mountX` in ../index.ts.
//
// Routes:
//   POST   /replies/generate   body: { context, idea?, systemPromptOverride?, model?, reasoningEffort?, language? }
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
import {
  type AskLlmResult,
  type LlmProvider,
  type LlmReasoningEffort,
  askLLM,
  llmErrorPayload,
} from '../../llm/index.ts';
import { type TweetSignals, textLooksLikeReplyBait } from '../../shared/replyBand.ts';
import {
  GENERAL_MODE,
  REPLY_ANGLES,
  type ReplyAngle,
  type ReplyGoal,
  isReplyGoal,
} from '../../shared/replyMode.ts';
import { metricsSnapshots, postsPublished, replyDrafts } from '../db/schema.ts';
import { loadActiveNicheSafe } from '../niche/store.ts';
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
import { loadPromptSafe } from '../prompts/registry.ts';
import {
  CURATE_SCHEMA,
  type CurateScore,
  MAX_CURATE_TWEETS,
  buildCurateInput,
  parseCurateScores,
  selectCurated,
} from '../replies/curate.ts';
import { resolveReplyLanguage, trimToSingleVariant } from '../replies/language.ts';
import { type ResolvedReplyMode, resolveReplyMode, trimToModeAngles } from '../replies/mode.ts';
import { toNetworkVariants } from '../replies/networkPrompt.ts';
import {
  type PostContext,
  type PostSignals,
  type ReplyVariant,
  batchReplySchema,
  buildBatchGrokInput,
  buildGrokInput,
  parseBatchReplies,
  parseReplyVariants,
  passesSpecificityGate,
  replyVariantsSchema,
} from '../replies/prompt.ts';
import { loadReplyWinnersSafe } from '../replies/winners.ts';
import { getSetting } from '../settings/registry.ts';
import { consumeIdeaSafe } from './ideas.ts';
import { loadMeContextSafe } from './me.ts';
import { getActivePillars } from './pillars.ts';
import { loadReplyGuidanceSafe } from './playbook.ts';
import { type RadarBatchTweet, persistRadarDrafts } from './radar.ts';

const MAX_IDEA_LENGTH = 2000;
// Both cache keys come from the registry (AI.3 single, AI.5 batch): a sha of
// the effective prompt body, so a customized prompt never shares a cached
// prefix with the default; the niche suffix still busts on niche edits.
// Batch (Radar §7.2): one LLM call drafts a reply per queued hot/warm tweet.
// Settings-backed too (`x.ai.batchReplyCap`, ceiling 50); this is the pure default.
const MAX_BATCH_TWEETS = 25;

/** The house-default tier askLLM merges LAST (request body > the global `ai`
 *  blob > these). Read per request so a settings PATCH binds the next draft;
 *  exported for tests. Shared by the single and batch reply paths — one owner,
 *  two consumers, so the two can't drift on temperature or effort.
 *
 *  The token cap is a safety ceiling, not a length lever (length is enforced by
 *  the prompt, ~280 chars/variant): three variants of JSON measure ~225 output
 *  tokens and xAI does not count reasoning tokens against the cap (verified live
 *  under the old 350/two-variant cap), so the 520 default leaves real headroom. */
export function replyLlmDefaults(): {
  temperature: number;
  maxOutputTokens: number;
  reasoningEffort: LlmReasoningEffort;
} {
  return {
    temperature: getSetting<number>('x.ai.replyTemperature'),
    maxOutputTokens: getSetting<number>('x.ai.replyMaxOutputTokens'),
    reasoningEffort: getSetting<LlmReasoningEffort>('x.ai.replyReasoningEffort'),
  };
}

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

// CQ.7: the reply-language cap. Long enough for "Brazilian Portuguese", short
// enough that the clause it lands in stays one line — it rides at the variable
// tail, so its bytes are paid for on every call.
const MAX_REPLY_LANGUAGE_LEN = 40;

// CQ.7: unlike `relationship`/`me`/`guidance` (context the server scraped or
// derived, and therefore server-stamped only, §7.16) a language is a DRAFTING
// INSTRUCTION — so it may ride in the body. What stays server-side is the
// rendering: the route validates the value and `renderLanguageClause` builds the
// sentence around it, so a client string never reaches a template. Single-line
// because the clause is one line by contract — a newline would smuggle a second
// instruction into the tail.
function parseReplyLanguage(value: unknown): { language?: string } | { error: 'invalid_language' } {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'string') return { error: 'invalid_language' };
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > MAX_REPLY_LANGUAGE_LEN) {
    return { error: 'invalid_language' };
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return { error: 'invalid_language' };
  return { language: trimmed };
}

// RC.5: the mode override, same terms as the language one — a DRAFTING
// INSTRUCTION may ride in the body; the rendering never does. Deliberately NOT
// validated against the mode table: an unrecognized value falls THROUGH to the
// rest of the precedence (the curate call, the roster pin, detection) rather
// than 400ing or guessing a near neighbour (§7.11 — resolveModeId is where that
// rule lives). What is rejected here is a value that could not be an id at all:
// a non-string, an empty one, an overlong one, or one carrying control
// characters.
const MAX_REPLY_MODE_LEN = 40;

function parseReplyModeOverride(value: unknown): { mode?: string } | { error: 'invalid_mode' } {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'string') return { error: 'invalid_mode' };
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > MAX_REPLY_MODE_LEN) return { error: 'invalid_mode' };
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return { error: 'invalid_mode' };
  return { mode: trimmed };
}

// RC.5: the union of every room's angles, in REPLY_ANGLES order — what a
// heterogeneous batch narrows its ONE schema to. Per-post narrowing is not
// expressible in a single structured-output schema, so the schema carries the
// union (still a real narrowing: a football-and-grief batch never offers
// `debate`) and the per-tweet `trimToModeAngles` is what holds each post to its
// own room. Empty in, whole vocabulary out — a mode-less batch is the pre-RC.5
// call and must stay byte- and schema-identical to it.
function unionAngles(modes: readonly ResolvedReplyMode[]): readonly ReplyAngle[] {
  const allowed = new Set<ReplyAngle>();
  for (const m of modes) for (const a of m.mode.angles) allowed.add(a);
  const union = REPLY_ANGLES.filter((a) => allowed.has(a));
  return union.length > 0 ? union : REPLY_ANGLES;
}

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
  systemPromptOverride?: unknown;
  model?: unknown;
  // AI.5: per-request LLM provider override ('grok' | 'openrouter'); absent →
  // the stored AI setting decides inside askLLM.
  provider?: unknown;
  reasoningEffort?: unknown;
  // §8.6 opt-in (default off, set by the extension Settings toggle): steer the
  // reply toward one of the active content pillars.
  applyPillars?: unknown;
  // CQ.7: draft in this language instead of English. A top-level body field, NOT
  // a context field — parseContext's whitelist keeps refusing it there.
  language?: unknown;
  // RC.5: draft this post as a named room, skipping the rest of the precedence.
  // Top-level for the same reason `language` is, and refused inside `context`
  // by the same whitelist: the panel's override and an operator's curl are the
  // callers, and the room the SERVER resolved is what gets stamped otherwise.
  mode?: unknown;
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

  let provider: LlmProvider | undefined;
  if (body.provider !== undefined && body.provider !== null) {
    if (body.provider !== 'grok' && body.provider !== 'openrouter') {
      return c.json({ error: 'invalid_provider' }, 400);
    }
    provider = body.provider;
  }

  // Only a body-supplied effort rides in opts — the house default goes through
  // askLLM's defaults tier so the stored AI setting can sit between them (D44).
  let reasoningEffort: LlmReasoningEffort | undefined;
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

  // CQ.7: validated up here with the rest of the body — refuse before spend
  // (§7.4). A bad language is a 400 even on a hot post that would otherwise pay
  // for a Grok call.
  const langOrErr = parseReplyLanguage(body.language);
  if ('error' in langOrErr) return c.json({ error: langOrErr.error }, 400);
  const language = langOrErr.language;

  // RC.5: validated up here with the language, and for the same reason — a
  // malformed override is a 400 before anything is spent (§7.4).
  const modeOrErr = parseReplyModeOverride(body.mode);
  if ('error' in modeOrErr) return c.json({ error: modeOrErr.error }, 400);
  const modeOverride = modeOrErr.mode;

  // No band gate here any more. It classified the post and 422'd a "dead" one
  // before the Grok call; RS.3 moved admission onto the sweep filters and this
  // was the leftover second opinion — untunable, and able to refuse a tweet the
  // user's own sweep had just admitted. What reaches this endpoint is already a
  // deliberate selection (a swept queue row or a hand-picked ⊕), so the human
  // click IS the gate. §7.4 still governs everything above: the body validation,
  // the language and the mode override all refuse before spend.
  //
  // Stamp capture signals when the caller didn't send them (CLI callers, older
  // extension builds) so every draft carries the tweet's reading at draft time —
  // the Playbook's latency table reads `signals.ageMin` off exactly this.
  if (!ctx.signals) ctx.signals = captureSignalsFor(ctx, Date.now());

  // N0.4: reply grounding comes from the active niche (server-stamped, never
  // client-supplied). Stamped into ctx before the insert so contextSnapshot
  // records which niche grounded this draft (future per-niche crosstab key).
  const niche = loadActiveNicheSafe();
  ctx.niche = { slug: niche.slug };

  // ML.3: which language this draft gets written in — explicit body value, else
  // the cannon roster's pin for this handle, else the post's own script, else
  // English (src/x/replies/language.ts owns the rule; single and batch call the
  // same function). Placed HERE on purpose: inside the refuse-before-spend
  // ladder: resolved before the paid call, never after. §7.4 is about ORDER,
  // not amount — a 400'd body must not pay for a `cannon_targets` read.
  // Stamped into ctx before the insert like niche/relationship, so
  // contextSnapshot records the language the model was actually given (§7.16).
  const resolvedLanguage = await resolveReplyLanguage({
    ...(language !== undefined ? { explicit: language } : {}),
    targets: [{ handle: ctx.handle, text: ctx.text }],
  });
  // `source` is set with `language` or not at all — the pair moves together.
  if (resolvedLanguage.language !== undefined && resolvedLanguage.source !== undefined) {
    ctx.language = resolvedLanguage.language;
    ctx.languageSource = resolvedLanguage.source;
  }
  // Decision 7: a language we have a PROFILE for ships ONE `extends` variant.
  // The profile — not the string — is the gate, because "is this string
  // English" is not decidable for free text (see language.ts).
  const singleAngle = resolvedLanguage.profile !== null;

  // RC.5: which ROOM this post is — an explicit override, else the roster pin
  // (`cannon_targets.topic`), else keyword detection, else `general`
  // (src/x/replies/mode.ts owns the rule; single and batch call the same
  // function over the same shape, so the two cannot fork). Same slot in the
  // refuse-before-spend ladder as the language: resolved before the paid call,
  // $0 either way. The `?? ` can't fire — one target in, one
  // resolution out — but a mode is not something to leave `undefined` on a path
  // that stamps it into the row.
  const resolvedMode: ResolvedReplyMode = (
    await resolveReplyMode({
      ...(modeOverride !== undefined ? { explicit: modeOverride } : {}),
      targets: [{ handle: ctx.handle, text: ctx.text }],
    })
  )[0] ?? { mode: GENERAL_MODE, source: 'fallback' };
  // Stamped before the insert, like `language`/`niche`: contextSnapshot records
  // the room the model was actually given, which is what Task 9's per-mode
  // crosstab reads instead of re-resolving against a table that has since moved.
  ctx.mode = resolvedMode.mode.id;
  ctx.modeSource = resolvedMode.source;

  // RC.7: the specificity gate speaks for exactly ONE room, and this is where
  // that is decided — once, for both of its uses below (the regenerate and the
  // primary pick), so the two cannot disagree about whether the gate has a vote.
  //
  // `passesSpecificityGate` passes on a digit, a first-person marker, or a
  // hardcoded list of MY lane's tools (claude code|grok|cursor|mcp|turbo
  // pascal|…|postgres|anaf|excel|git|sql). That is a description of an
  // `expertise` reply and of nothing else. Under `wholesome`/`banter`/`news`
  // the winning shape carries none of the three — "The little ear twitch at
  // 0:04" only passes by the accident of a timestamp — so the gate fails
  // ~always there: it burns a second paid call and then ships a failing variant
  // anyway. Worse, it is a standing PRESSURE toward the very contamination RC.1
  // exists to remove, since naming a dev tool is one of three cheap ways to
  // pass under any post at all.
  //
  // So it is SKIPPED, not rewritten — the same shape and the same reasoning as
  // ML.3's non-English skip one line up: an English-tuned, lane-tuned heuristic
  // applied to a room it was never validated against yields UNKNOWN, not FAIL
  // (§7.11), and inventing per-mode specificity regexes with nothing to
  // validate them against is how the plan says not to do this (decision 7). The
  // `expertise` path — the one the gate was eval-validated for (OVERHAUL-PLAN
  // §7.1) — is untouched.
  const gateApplies = !singleAngle && resolvedMode.mode.personaUse === 'full';

  // RC.6: my measured winners FOR THAT ROOM — the positive counterweight to
  // RC.1's negative rules, and $0 (a `harvest_rows` read plus the same pure
  // detection the resolution above already ran). Same slot in the ladder, after
  // the paid call. Language-scoped: a resolved profile only takes winners
  // written in that language, and the English path only takes ones no script
  // detector can place. Best-effort — an empty pool is the ordinary state.
  const winners = await loadReplyWinnersSafe([resolvedMode.mode.id], {
    profile: resolvedLanguage.profile,
  });
  // Stamped like `me`: contextSnapshot records whether this draft saw a few-shot
  // and how many, so the before/after split stays readable once the rows land.
  if (winners.length > 0) ctx.winners = winners.length;

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

  // Me / My Profile brief (M1, ME.3): the dynamic personal-context layer, stamped
  // into ctx BEFORE the insert (like relationship/niche/guidance) so
  // contextSnapshot records whether this draft saw it — the Playbook's me-lift
  // cell (ME.5) reads it back. Best-effort — a me-layer read never blocks a draft.
  const me = await loadMeContextSafe('reply');
  if (me) ctx.me = me;

  // Playbook guidance (C4): the gated topAngles line, stamped into ctx before
  // the insert (like relationship) so contextSnapshot records whether this
  // draft was steered by measured data. Best-effort; null under the gate.
  const guidance = await loadReplyGuidanceSafe();
  if (guidance) ctx.guidance = guidance;

  // Registry prompt (AI.3): DB override else the shipped default. Loaded after
  // any refusal above (a refused call reads nothing) — a per-request
  // systemPromptOverride still beats it inside buildGrokInput.
  const prompt = loadPromptSafe('reply');
  const pillarDefs = applyPillars ? await getActivePillars() : undefined;
  const messages = buildGrokInput(ctx, systemOverride, idea, pillarDefs, {
    replyPersona: niche.replyPersona,
    template: prompt.body,
    // Server-stamped: the route hands the builder a validated VALUE and the
    // builder owns the sentence — the client's string is never a template.
    // ML.3: the RESOLVED language (which may be one nobody sent) plus its
    // profile, so the builder never resolves a second time.
    ...(resolvedLanguage.language !== undefined
      ? { language: resolvedLanguage.language, languageProfile: resolvedLanguage.profile }
      : {}),
    // RC.5: the resolved room. Always present on this path — every post is in
    // some room, and `general` is an answer, not an absence.
    mode: resolvedMode.mode,
    // RC.6: the few-shot for that room. Empty → the prompt assembles exactly as
    // it did before, so a fresh DB costs nothing and changes nothing.
    winners,
  });

  // AI.5: askLLM dispatches grok vs openrouter (opts > DB AI settings > the
  // house defaults below — precedence encoded once in askLLM, D44).
  const callLlm = (): Promise<AskLlmResult> =>
    askLLM(
      {
        ...(model !== undefined ? { model } : {}),
        ...(provider !== undefined ? { provider } : {}),
        ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
        messages,
        // ML.3: the narrowed schema makes contrarian/debate UNREPRESENTABLE on
        // a non-English call (provider-enforced), so the model stops paying
        // output tokens for variants the trim below would discard. The trim is
        // still the contract — `maxItems` is a D164b unsupported keyword, so the
        // COUNT cannot be pinned in the schema the way the angle can.
        // RC.5: on an English call the room narrows the same way — `contrarian`
        // under a grief post becomes unrepresentable rather than merely
        // discouraged. A resolved LANGUAGE still wins outright (decision 7 is
        // one variant, and the mode clause dropped its own angle sentence to
        // match); `trimToModeAngles` below is the contract either way.
        jsonSchema: {
          name: 'reply_variants',
          schema: replyVariantsSchema({
            angles: singleAngle ? ['extends'] : resolvedMode.mode.angles,
          }),
        },
        // Sha of the effective prompt body + niche suffix — busts the cached
        // prefix on either a prompt override edit or a niche edit (grok-only).
        promptCacheKey: `${prompt.cacheKey}:${niche.slug}:${niche.updatedAt?.getTime() ?? 0}`,
      },
      { defaults: replyLlmDefaults() },
    );

  let result: AskLlmResult;
  let costUsd: number;
  let variants: ReplyVariant[] | null;
  try {
    result = await callLlm();
    costUsd = result.costUsd;
    variants = parseReplyVariants(result.text);

    // Specificity gate (§7.1): if no variant carries a digit, a first-person
    // marker, or a named tool, burn exactly one regenerate. Both calls are
    // already cost-logged by the provider client; we just sum the draft's
    // denormalized costUsd. A second all-generic round ships anyway — the
    // human edits.
    //
    // Whether the gate has a vote at all is `gateApplies`, decided up in the
    // ladder: ML.3's decision 8 (a resolved language) and RC.7's persona scope
    // (a room whose `personaUse` is not `full`) both turn it off, for the same
    // reason spelled out there. The notes below are why decision 8 does.
    //
    // Decision 8 — the gate is SKIPPED, not ported, when a language resolved.
    // Its three regexes are Latin-alphabet by construction (`/\d/` misses 全角
    // digits, `/\b(i|my|me|we|our)\b/i` can never match 私 or أنا, and `\b` is
    // meaningless in a script without spaces), so a Japanese reply fails it
    // ~always and the regenerate fires on essentially every non-English call —
    // then falls back to the same variant anyway. With ONE variant there is no
    // sibling that might pass by accident, so an occasional waste becomes a
    // systematic one. An English-tuned heuristic applied to Japanese yields
    // UNKNOWN, not FAIL (§7.11); rewriting the regexes per script would be
    // inventing a heuristic with nothing to validate it against (the existing
    // one is eval-validated for English, OVERHAUL-PLAN §7.1). The English path
    // below is untouched.
    //
    // The PARSE-failure retry still fires on both paths: a truncated body is
    // not the specificity gate, it is not language-correlated, and rescuing an
    // already-paid call is worth the second one.
    const gateFailed =
      gateApplies && !(variants?.some((v) => passesSpecificityGate(v.text)) ?? false);
    if (variants === null || gateFailed) {
      const retry = await callLlm();
      costUsd += retry.costUsd;
      const retryVariants = parseReplyVariants(retry.text);
      if (retryVariants !== null) {
        result = retry;
        variants = retryVariants;
      }
    }
  } catch (err) {
    const mapped = llmErrorPayload(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    const detail = err instanceof Error ? err.message : String(err);
    console.error('/x/replies/generate failed:', detail);
    return c.json({ error: 'generate_failed', detail }, 502);
  }

  if (variants === null) {
    return c.json({ error: 'grok_parse_error', requestId: result.requestId }, 502);
  }

  // ML.3 (decision 7): a non-English draft keeps exactly one variant, the
  // `extends` one. Applied AFTER parsing and before the primary pick, so the
  // stored `variants` column and the response carry the same one entry — the
  // panel's variant tab strip already hides itself on a single-variant draft.
  // RC.5: otherwise the room's angle set is the contract — a strict schema
  // already made the excluded angles unrepresentable, but a non-strict provider
  // and parseReplyVariants' coercion of an unknown angle to `extends` can both
  // land one anyway.
  variants = singleAngle
    ? trimToSingleVariant(variants)
    : trimToModeAngles(variants, resolvedMode.mode);

  // Primary pick = first variant that clears the gate; the rest ride along in
  // `variants` for the panel's picker. Where the gate has no vote (decision 8's
  // resolved language, RC.7's non-`full` room) the primary is `variants[0]`,
  // which is the mode's PRIMARY angle by construction — the model returns them
  // in the order the narrowed schema names them, and `mode.angles` is ordered
  // first-is-the-pick. Letting a lane-tuned regex reorder a wholesome reply's
  // variants would be the gate voting after being told it has no vote.
  const primary = gateApplies
    ? (variants.find((v) => passesSpecificityGate(v.text)) ?? variants[0])
    : variants[0];
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
      source: 'reply_master',
      status: 'generated',
    })
    .returning();

  // C6: the steer came from the Idea Inbox — consume it with the backlink.
  // A validation refusal or Grok failure never reaches here, so a failed
  // generate leaves the idea open.
  if (ideaId && row) await consumeIdeaSafe(ideaId, 'reply_drafts', row.id);

  // ML.3: echo the resolution so the panel renders WHICH language and WHY
  // without re-deriving the rule client-side (§7.4c — read the server's answer
  // rather than reproducing it). Both null on an English draft.
  return c.json(
    {
      ...row,
      language: resolvedLanguage.language ?? null,
      languageSource: resolvedLanguage.source ?? null,
      // RC.5: the same echo for the room — the panel shows WHICH and WHY so a
      // wrong resolution is visible before the paste, without re-deriving the
      // precedence client-side (§7.4c). Never null on this path.
      mode: resolvedMode.mode.id,
      modeSource: resolvedMode.source,
    },
    201,
  );
});

// --------------------------------------------------------- batch (Radar §7.2)
//
// One Grok call drafts a reply for a whole queue of tweets the Radar collected.
// Unlike /replies/generate this does NOT create reply_drafts rows or run the
// per-tweet gate — the queue is already a deliberate selection (swept rows plus
// ⊕ manual pins and GT.8 roster sightings, all lanes a human armed or clicked):
// the replies live in the extension's session ring buffer, copied to the
// clipboard when the user opens a tweet. Since CIRCLES-PLAN C0 each reply also lands in `radar_drafts`
// so a browser restart no longer loses paid-for drafts (routes/radar.ts).

interface BatchBody {
  tweets?: unknown;
  idea?: unknown;
  systemPromptOverride?: unknown;
  model?: unknown;
  provider?: unknown;
  reasoningEffort?: unknown;
  applyPillars?: unknown;
  // CQ.7: ONE language for the whole batch — the batch prompt has one
  // instruction block, and a per-tweet language would need a template change.
  // Top-level, never a per-tweet field: parseBatchTweets' whitelist refuses it.
  language?: unknown;
  // RC.5: an override for the whole call. The MODE itself is per POST — the
  // resolver answers once per tweet and the prompt carries a MODE line each —
  // but an OVERRIDE is a human saying "draft this queue as banter", which is a
  // property of the click, not of a tweet. Same shape as `language`.
  mode?: unknown;
  // NW.1: which OBJECTIVE this click is drafting for — `reach` (default, the
  // shipped three-variant impressions prompt) or `network` (one reply written to
  // the author). Per CALL and never per tweet: it is the switch the human threw
  // beside the button, not a property of any post in the queue.
  goal?: unknown;
}

replies.post('/replies/generate-batch', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as BatchBody;

  const parsed = parseBatchTweets(body.tweets, getSetting<number>('x.ai.batchReplyCap'));
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

  let provider: LlmProvider | undefined;
  if (body.provider !== undefined && body.provider !== null) {
    if (body.provider !== 'grok' && body.provider !== 'openrouter') {
      return c.json({ error: 'invalid_provider' }, 400);
    }
    provider = body.provider;
  }

  let reasoningEffort: LlmReasoningEffort | undefined;
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

  // CQ.7: before the relationship lookups and before the call — a bad language
  // costs nothing (§7.4).
  const langOrErr = parseReplyLanguage(body.language);
  if ('error' in langOrErr) return c.json({ error: langOrErr.error }, 400);
  const language = langOrErr.language;

  // RC.5: same slot, same reason — refuse before the relationship lookups and
  // long before the call.
  const modeOrErr = parseReplyModeOverride(body.mode);
  if ('error' in modeOrErr) return c.json({ error: modeOrErr.error }, 400);
  const modeOverride = modeOrErr.mode;

  // NW.1: same slot again (refuse before spend, §7.4). Absent/null is `reach` —
  // every CLI caller, MCP tool and un-updated panel build keeps the behaviour it
  // had, and only an unrecognized STRING is an error.
  let goal: ReplyGoal = 'reach';
  if (body.goal !== undefined && body.goal !== null) {
    if (!isReplyGoal(body.goal)) return c.json({ error: 'invalid_goal' }, 400);
    goal = body.goal;
  }
  const network = goal === 'network';

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

  // NW.1: every ME-shaped block below is skipped on the networking pass, and the
  // skip lives HERE rather than in the builder so the work is never done at all
  // (loadMeContextSafe and getActivePillars are DB reads). What they have in
  // common is that each one pulls the reply back toward my subject — pillars pick
  // my stance, the me-brief supplies my facts, the Playbook guidance names the
  // angles that earned ME views, the persona is my biography, and the winners
  // few-shot is a corpus selected by IMPRESSIONS with the punctuation habits to
  // match. Under a first contact with the author, all five are the failure mode,
  // not the grounding. `relationship` above is the deliberate exception: it is
  // history with THEM, and it is what stops "congrats on the launch" going to
  // someone I have already spoken to five times.
  const pillarDefs = applyPillars && !network ? await getActivePillars() : undefined;
  // Playbook guidance (C4): one gated line for the whole batch, variable tail.
  const guidance = network ? undefined : ((await loadReplyGuidanceSafe()) ?? undefined);
  // M1 (ME.3): the personal-context brief, loaded once for the whole batch (it
  // describes me, not the 25 targets). Same 'reply' brief as the single path.
  const meBrief = network ? undefined : ((await loadMeContextSafe('reply')) ?? undefined);
  // N0.4: same niche grounding as the single path — single and batch can't drift.
  const niche = loadActiveNicheSafe();
  // ML.3: one language for the whole CALL, resolved by the same function the
  // single path uses. All-or-nothing over the set by construction (see
  // language.ts): the batch prompt has one instruction block, which is why
  // `Radar.tsx` already only sends a language when the whole draft set agrees —
  // a mixed-language queue resolves to English rather than to whichever
  // language the first tweet happened to be in. There is no DB row here to
  // stamp (the drafts live in radar_drafts), the same shape as CQ.7's niche.
  const resolvedLanguage = await resolveReplyLanguage({
    ...(language !== undefined ? { explicit: language } : {}),
    targets: tweets.map((t) => ({ handle: t.handle, text: t.text })),
  });
  const singleAngle = resolvedLanguage.profile !== null;
  // RC.5: one room PER POST — the asymmetry with the language above, and the
  // reason the mode rides inside {{POSTS}} rather than in one tail block. A
  // Cannon queue is deliberately heterogeneous, so a set-wide answer would hand
  // 24 posts the register of whichever one voted loudest. Aligned by index with
  // `tweets`; stamped onto the tweet the way the C3 relationship brief is, and
  // the resolved mode itself is never accepted from the client — only RC.8's
  // `curatedMode` HINT is, one rung down the precedence, where an unrecognized
  // value costs the rung and nothing else.
  //
  // NW.1: not resolved at all on the networking pass, and that is honest rather
  // than lazy. A mode is a bundle of three things — how much persona is allowed,
  // which angles the room permits, how long a reply runs — and the networking
  // prompt owns all three itself (no persona ever, one `network` angle, its own
  // two-line budget). Rendering the legend would hand the model a second,
  // contradicting spec; resolving it silently and not rendering it would put a
  // room chip on the panel row that had no effect on the draft it labels. So the
  // wire says `mode: null` here, which the panel already renders as "no room".
  const resolvedModes = network
    ? []
    : await resolveReplyMode({
        ...(modeOverride !== undefined ? { explicit: modeOverride } : {}),
        targets: tweets.map((t) => ({
          handle: t.handle,
          text: t.text,
          ...(t.curatedMode !== undefined ? { curated: t.curatedMode } : {}),
        })),
      });
  for (const [i, t] of tweets.entries()) {
    const r = resolvedModes[i];
    if (r) t.mode = r.mode;
  }
  const modeByTweetId = new Map(tweets.map((t, i) => [t.tweetId, resolvedModes[i]]));
  // RC.6: one few-shot pass for the DISTINCT rooms in the queue, in queue order
  // so the block reads in the same order the legend does. Distinct, not per
  // tweet: a 25-post queue camped on football would otherwise pay for the same
  // five `banter` winners 25 times. $0, same slot in the ladder as the single
  // path, best-effort.
  const winners = network
    ? []
    : await loadReplyWinnersSafe([...new Set(resolvedModes.map((r) => r.mode.id))], {
        profile: resolvedLanguage.profile,
      });
  // Registry prompt (AI.5): the standalone batch default, DB-overridable like
  // the single-reply key; a per-request systemPromptOverride still beats it.
  // NW.1: the goal picks WHICH registry key, so both objectives stay separately
  // editable in the prompts UI and a customized reach prompt never silently
  // becomes the networking one.
  const batchPrompt = loadPromptSafe(network ? 'reply-batch-network' : 'reply-batch');
  const messages = buildBatchGrokInput(tweets, idea, systemOverride, pillarDefs, guidance, {
    ...(network ? {} : { replyPersona: niche.replyPersona }),
    template: batchPrompt.body,
    ...(meBrief !== undefined ? { meBrief } : {}),
    // NW.1: the language still resolves and still ships — a Japanese post gets a
    // Japanese reply on either objective — but the PROFILE is withheld here,
    // because its clause ends in "in this language, produce only the extends
    // variant" and this pass has already produced exactly one, on `network`. The
    // bare sentence (write in X, match the parent's register) is all that is
    // wanted; the profile's char budget is superseded by the prompt's own.
    ...(resolvedLanguage.language !== undefined
      ? {
          language: resolvedLanguage.language,
          languageProfile: network ? null : resolvedLanguage.profile,
        }
      : {}),
    winners,
  });
  // 3 variants/post × ~280 chars ≈ 270 tokens + JSON overhead; ×3 output vs the
  // single-reply path (user-accepted, RU.3). Scale with the batch, capped. A
  // stored AI-settings maxOutputTokens overrides this computed cap (D44
  // precedence) — clear the setting if batches start truncating. The cap stays
  // COMPUTED (not `x.ai.replyMaxOutputTokens`, which sizes one reply): it must
  // grow with the batch or a 25-tweet call truncates.
  //
  // NW.1: a networking pass returns ONE variant per post, so its per-post budget
  // is a third of the reach path's — still well above what a ≤180-character reply
  // plus its JSON wrapper costs, because a truncated batch wastes the whole call
  // while a slack cap costs nothing (output tokens are billed as used).
  const maxOutputTokens = Math.min(9000, 200 + tweets.length * (network ? 180 : 420));

  let result: AskLlmResult;
  try {
    result = await askLLM(
      {
        ...(model !== undefined ? { model } : {}),
        ...(provider !== undefined ? { provider } : {}),
        ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
        messages,
        // ML.3: the batch twin of the single path's narrowing — same reason,
        // same non-guarantee (the per-tweet trim below is the contract).
        // RC.5: one schema for a queue of mixed rooms, so it carries the UNION
        // of their angles — still a real narrowing (a football-and-grief batch
        // never offers `debate`), and the per-tweet trim below is what holds
        // each post to its own room.
        // NW.1: the networking goal narrows hardest of the three — one angle,
        // so a room angle is unrepresentable rather than merely unasked-for. The
        // count still needs `toNetworkVariants` below (no `maxItems`, D164b).
        jsonSchema: {
          name: 'batch_replies',
          schema: batchReplySchema({
            angles: network ? ['network'] : singleAngle ? ['extends'] : unionAngles(resolvedModes),
          }),
        },
        // Sha of the effective batch body + niche suffix (grok-only) — busts
        // the cached prefix on a prompt override edit or a niche edit.
        promptCacheKey: `${batchPrompt.cacheKey}:${niche.slug}:${niche.updatedAt?.getTime() ?? 0}`,
      },
      { defaults: { ...replyLlmDefaults(), maxOutputTokens } },
    );
  } catch (err) {
    const mapped = llmErrorPayload(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    const detail = err instanceof Error ? err.message : String(err);
    console.error('/x/replies/generate-batch failed:', detail);
    return c.json({ error: 'generate_failed', detail }, 502);
  }

  const batch = parseBatchReplies(result.text);
  if (batch === null) {
    return c.json({ error: 'grok_parse_error', requestId: result.requestId }, 502);
  }

  // Anchor: keep only replies whose id is one we asked for, first occurrence
  // wins (a model that doubled up on an id can't shadow the right tweet). Each
  // reply carries all 3 angle variants; text/angle stay the primary (variants[0])
  // so an un-updated panel build still reads them (RU.3).
  const wanted = new Set(tweets.map((t) => t.tweetId));
  const seen = new Set<string>();
  const out: {
    tweetId: string;
    text: string;
    angle: string;
    variants: ReplyVariant[];
    mode: string | null;
    modeSource: string | null;
  }[] = [];
  for (const r of batch) {
    if (!wanted.has(r.tweetId) || seen.has(r.tweetId)) continue;
    // ML.3 (decision 7): the trim is PER TWEET — one `extends` variant each,
    // and every tweet still appears. Same helper as the single path.
    // RC.5: on the English path the per-tweet trim is the ROOM's angle set —
    // the one place a per-post rule can be enforced, since the schema could
    // only carry the union.
    // NW.1: the networking trim runs FIRST and unconditionally — its one-variant
    // contract is the objective itself, not a per-room narrowing, and on this
    // path there is no resolved mode to trim by anyway.
    const resolved = modeByTweetId.get(r.tweetId);
    const variants = network
      ? toNetworkVariants(r.variants)
      : singleAngle
        ? trimToSingleVariant(r.variants)
        : resolved
          ? trimToModeAngles(r.variants, resolved.mode)
          : r.variants;
    const primary = variants[0];
    if (!primary) continue;
    seen.add(r.tweetId);
    out.push({
      tweetId: r.tweetId,
      text: primary.text,
      angle: primary.angle,
      variants,
      // RC.5: echoed per reply, not per call — the panel chips each queued row
      // with its own room and the rule that picked it, so a wrong resolution is
      // visible BEFORE the paste (and fixable for good with a roster pin).
      mode: resolved?.mode.id ?? null,
      modeSource: resolved?.source ?? null,
    });
  }

  // C0: the server keeps the copy — the session ring buffer alone lost every
  // draft on browser restart. Never fails the response (money already spent).
  await persistRadarDrafts(tweets, out, result.model);

  return c.json({
    replies: out,
    count: out.length,
    requested: tweets.length,
    // ML.3: same echo as the single path — the panel reads the answer instead
    // of re-deriving the rule. Both null on an English batch.
    language: resolvedLanguage.language ?? null,
    languageSource: resolvedLanguage.source ?? null,
    // NW.1: which objective actually drafted this batch. Echoed for the same
    // reason `language` is — a switch whose effect is invisible in the response
    // is a switch you find out about by reading the replies (§7.4c).
    goal,
    costUsd: result.costUsd,
    model: result.model,
    requestId: result.requestId,
  });
});

// Every `band` a batch tweet may claim — pure queue metadata about HOW the row
// entered (RU.8 / GT.8 / CQ.4 / RS.2), never a verdict about the tweet. Mirrors
// `RadarBatchTweet['band']` — widen both together. The old classifier verdicts
// `'hot'`/`'warm'` are still accepted so a stale extension build's queue keeps
// posting; the route folds them into `'sweep'` below.
const ACCEPTED_BATCH_BANDS: ReadonlySet<string> = new Set([
  'manual',
  'roster',
  'cannon',
  'sweep',
  'hot',
  'warm',
]);

/** Legacy verdict bands from a pre-removal extension build, folded onto the arm
 *  that would capture the row today. */
const LEGACY_BATCH_BANDS: ReadonlySet<string> = new Set(['hot', 'warm']);

// Pure validator — exported for unit tests. Dedups by id, clamps the batch.
// Optional band/signals (C0) carry the Radar's capture-time verdict — and
// optional curationScore (RC.2) the curation pass's 0–100 verdict — into
// `radar_drafts`; none of the three reaches the Grok prompt. Optional
// curatedMode (RC.8) is the exception in kind — the same pass's room label,
// which the route feeds to `resolveReplyMode` instead of storing. `maxTweets` is
// defaulted to today's constant (Decision 6) so every existing caller and test
// stays valid; the route passes `x.ai.batchReplyCap`.
export function parseBatchTweets(
  value: unknown,
  maxTweets = MAX_BATCH_TWEETS,
): { tweets: RadarBatchTweet[] } | { error: string } {
  if (!Array.isArray(value)) return { error: 'invalid_tweets' };
  if (value.length === 0) return { error: 'empty_tweets' };
  if (value.length > maxTweets) return { error: 'too_many_tweets' };

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

    let band: RadarBatchTweet['band'];
    if (r.band !== undefined && r.band !== null) {
      // 'manual' = a ⊕ add (RU.8), 'roster' = a quiet post by someone in my
      // circle (GT.8), 'cannon' = an arbitrage capture (CQ.4), 'sweep' = an
      // armed sweep's filters (RS.2); all four are
      // stored on radar_drafts.band as queue metadata, never classifier verdicts
      // — the confirm endpoint coerces them away from the reply_drafts
      // contextSnapshot signals. Not re-checked against the people layer or the
      // scorer here: the band never reaches Grok and never reaches a Playbook
      // cell, so a wrong claim costs a label, not money or a number.
      if (!ACCEPTED_BATCH_BANDS.has(r.band as string)) {
        return { error: `invalid_tweet_band_${i}` };
      }
      band = LEGACY_BATCH_BANDS.has(r.band as string)
        ? 'sweep'
        : (r.band as RadarBatchTweet['band']);
    }

    let signals: TweetSignals | undefined;
    if (r.signals !== undefined && r.signals !== null) {
      const parsed = parseTweetSignals(r.signals);
      if (parsed === null) return { error: `invalid_tweet_signals_${i}` };
      signals = parsed;
    }

    // RC.2: the curation pass's reply-payoff score for this tweet. Stored on
    // radar_drafts as measurement metadata (it gates nothing, §7.19) and never
    // rendered into the prompt. Strict: a fractional or out-of-range score means
    // the caller isn't speaking this contract, and a silently clamped number
    // would poison the very measurement the column exists for.
    let curationScore: number | undefined;
    if (r.curationScore !== undefined && r.curationScore !== null) {
      const n = r.curationScore;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100) {
        return { error: `invalid_tweet_curation_score_${i}` };
      }
      curationScore = n;
    }

    // RC.8: the room the curation pass named for this post, handed back so the
    // resolver can use a classification already paid for. Only the SHAPE is
    // refused here — an unrecognized room is not: `resolveModeId` answers null
    // for it and the resolution falls through to the roster pin and then to
    // detection (§7.11), which is a strictly better outcome than 400ing a
    // 25-post batch the user is waiting behind over one label. The vocabulary
    // check lives in exactly one place and this is not it (§7.16).
    let curatedMode: string | undefined;
    if (r.curatedMode !== undefined && r.curatedMode !== null) {
      if (typeof r.curatedMode !== 'string') return { error: `invalid_tweet_curated_mode_${i}` };
      const m = r.curatedMode.trim();
      if (m !== '') curatedMode = m;
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
      // `!== undefined`, not truthiness like band/signals above: 0 is a valid
      // score and would be dropped by a `? :` test.
      ...(curationScore !== undefined ? { curationScore } : {}),
      ...(curatedMode !== undefined ? { curatedMode } : {}),
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

// ------------------------------------------------------------- curate (RC.3)
//
// One cheap scoring call in FRONT of the paid batch draft: after a long scroll
// session the queue holds 40+ tweets and generate-batch spends on whatever
// ranked first. This grades every fresh tweet for reply payoff so the drafting
// money goes to the best 25 instead of the newest 25.
//
// Text-only (§7.19): `parseBatchTweets` still accepts band/signals/curationScore
// because the panel sends one tweet shape everywhere, but `buildCurateInput`
// projects each tweet down to four fields before rendering — the classifier
// already priced the numbers in when it admitted the tweet, and the score it
// produces is measurement metadata, never a gate.
//
// Writes NOTHING. The queue lives in the extension's session ring buffer, so
// only the panel can act on `drop`; the score reaches the DB one call later,
// on `radar_drafts.curation_score` (RC.2).

/** Scoring is judgment, not prose — the voice-extract temperature, not the
 *  reply drafter's. Deliberately NOT `x.ai.*` knobs: those size one written
 *  reply, and a user who raises reply temperature for more varied drafts must
 *  not silently make the grader flightier too. */
const CURATE_TEMPERATURE = 0.2;
const CURATE_REASONING: LlmReasoningEffort = 'low';

/** How many scored tweets survive one curated pass. The knob, clamped by the
 *  cap the drafting call itself enforces: asking for 40 keeps when
 *  generate-batch refuses anything over 25 would just move the refusal one
 *  click later. Exported because the live path costs money to reach, so the
 *  clamp is pinned by a unit test instead (the JD.5 `rewriteWins` precedent). */
export function curateKeepTarget(): number {
  return Math.min(
    getSetting<number>('x.radar.curatedCount'),
    getSetting<number>('x.ai.batchReplyCap'),
  );
}

interface CurateBody {
  tweets?: unknown;
  model?: unknown;
  provider?: unknown;
  reasoningEffort?: unknown;
}

replies.post('/replies/curate', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as CurateBody;

  // MAX_CURATE_TWEETS (the radar ring-buffer size), not `x.ai.batchReplyCap`:
  // scoring the whole queue in one cheap call is the entire point, and the
  // queue being bigger than what we will draft is the precondition, not an
  // error. The batch cap binds later, through `curateKeepTarget`.
  const parsed = parseBatchTweets(body.tweets, MAX_CURATE_TWEETS);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const tweets = parsed.tweets;

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

  let reasoningEffort: LlmReasoningEffort | undefined;
  if (body.reasoningEffort !== undefined && body.reasoningEffort !== null) {
    const r = body.reasoningEffort;
    if (r !== 'none' && r !== 'low' && r !== 'medium' && r !== 'high') {
      return c.json({ error: 'invalid_reasoning_effort' }, 400);
    }
    reasoningEffort = r;
  }

  // ---- every refusal is above this line (§7.4); everything below may spend ----

  const keepTarget = curateKeepTarget();
  // No relationship / guidance / me / pillar loading, unlike generate-batch:
  // none of it changes whether a post is worth replying to, and every skipped
  // lookup is latency on a click the user is waiting behind.
  const niche = loadActiveNicheSafe();
  const prompt = loadPromptSafe('reply-curate');
  const messages = buildCurateInput(tweets, {
    replyPersona: niche.replyPersona,
    template: prompt.body,
  });
  // ~35 output tokens per row (id + int + bool + a clipped one-liner) plus JSON
  // overhead; the 4500 ceiling covers a full 100-tweet queue. Truncation is not
  // silent — it costs coverage, not queue rows (`unscored`, decision 6).
  const maxOutputTokens = Math.min(4500, 300 + tweets.length * 35);

  let result: AskLlmResult;
  try {
    result = await askLLM(
      {
        ...(model !== undefined ? { model } : {}),
        ...(provider !== undefined ? { provider } : {}),
        ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
        messages,
        jsonSchema: { name: 'curate_scores', schema: CURATE_SCHEMA },
        // Niche-suffixed like the two drafting paths: the persona sits inside
        // the cached prefix, so a niche edit must bust it or the grader keeps
        // scoring payoff for who I used to be.
        promptCacheKey: `${prompt.cacheKey}:${niche.slug}:${niche.updatedAt?.getTime() ?? 0}`,
      },
      {
        defaults: {
          temperature: CURATE_TEMPERATURE,
          maxOutputTokens,
          reasoningEffort: CURATE_REASONING,
        },
      },
    );
  } catch (err) {
    const mapped = llmErrorPayload(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    const detail = err instanceof Error ? err.message : String(err);
    console.error('/x/replies/curate failed:', detail);
    return c.json({ error: 'curate_failed', detail }, 502);
  }

  // The call is billed. A body we can't parse is a 502 and never a retry — a
  // retry here doubles the spend on a model that just proved it is answering
  // off-contract, and `parseCurateScores` degrades to null exactly when a
  // malformed row would otherwise dismiss a queue entry nobody graded.
  const scores = parseCurateScores(result.text);
  if (scores === null) {
    return c.json({ error: 'grok_parse_error', requestId: result.requestId }, 502);
  }

  const wantedIds = tweets.map((t) => t.tweetId);
  const selection = selectCurated(scores, wantedIds, keepTarget);

  // Anchor the verdicts to what we asked about, first occurrence wins — the
  // same shape generate-batch applies to its replies, and it makes the response
  // self-consistent: `scored` ⊆ asked, and keep ∪ drop ∪ unscored = asked. The
  // panel only ever looks scores up by sighting id, so a hallucinated row is
  // inert there today; anchoring is what keeps a later consumer that ITERATES
  // `scored` from rendering a verdict for a tweet that was never in the queue.
  const wanted = new Set(wantedIds);
  const seen = new Set<string>();
  const scored: CurateScore[] = [];
  for (const s of scores) {
    if (!wanted.has(s.tweetId) || seen.has(s.tweetId)) continue;
    seen.add(s.tweetId);
    scored.push(s);
  }

  return c.json({
    scored,
    keep: selection.keep,
    drop: selection.drop,
    unscored: selection.unscored,
    keepTarget,
    costUsd: result.costUsd,
    model: result.model,
    requestId: result.requestId,
  });
});

// ---------------------------------------------------------------- list/get

// The effective Grok prompt used when no `systemPromptOverride` is set —
// registry-loaded (AI.3), so a DB override shows here too ($0, no Grok).
replies.get('/replies/default-prompt', (c) => {
  return c.json({ prompt: loadPromptSafe('reply').body });
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
    // A reply to MY OWN post tracks no person: the LaunchRoom seed comment
    // (GT.3) arrives under the placeholder handle 'me', and upserting it would
    // mint a phantom stage-`engaged` row that joins the reciprocity set — the
    // the daily quest AND the glance map (GT.6–GT.8).
    // "Own post" is structural, not a sentinel compare: the source tweet is a
    // posts_published row, which a real @me account's tweets can never be.
    // Best-effort in the §7.8 direction — a failed lookup keeps the old
    // behaviour (track the person) rather than silently dropping CRM events.
    let selfReply = false;
    if (handle) {
      try {
        const own = await db
          .select({ tweetId: postsPublished.tweetId })
          .from(postsPublished)
          .where(eq(postsPublished.tweetId, existing.sourceTweetId))
          .limit(1);
        selfReply = own.length > 0;
      } catch (err) {
        console.error('people: own-post lookup failed (person still tracked):', err);
      }
    }
    if (handle && !selfReply) {
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

// Exported for unit tests (pure). The tweet's reading at draft time, for rows
// that arrive without one: prefer the capture-time raw inputs the extension
// stamped (DOM-aware bait, exact age), else derive them from metrics + postedAt
// + the shared text-only bait check. Nothing decides on this — it is the
// measurement stamp the Playbook's latency table reads back.
export function captureSignalsFor(ctx: PostContext, nowMs: number): TweetSignals {
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

  // `band` used to be validated here. Older extension builds still send it;
  // it is accepted and DROPPED rather than 400'd, because a stale build must
  // keep drafting — the classifier that produced it no longer exists.
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

  return { signals: { ...nums, bait: s.bait } };
}
