// JD.4/JD.5 — the LLM judge: one structured-outputs call that grades ONE draft
// on the 13-dimension rubric and comes back with a headline, up to twelve
// anchored fixes, and a band derived from the overall score — plus the apply
// route that rewrites the draft from those fixes and keeps it only if it wins.
//
//   POST /judge        body: { text (1–2000), surface? ('post'), model?, provider? }
//     ~$0.003, human-triggered only. There is no worker, no batch, no automatic
//     invocation anywhere: x-builder auto-judges all three generated candidates
//     because its LLM is a subscription CLI with $0 marginal cost, and we pay
//     per token (JD decision 1). One button, on the draft you are about to
//     schedule.
//   POST /judge/apply  body: { judgmentId, text, model?, provider? }   (JD.5)
//     ~$0.007 — a rewrite call plus a re-judge. Two calls, not x-builder's
//     three: the verdict was already paid for and stored, so persisting it
//     bought a call back.
//
// Mounted beside `drafter` under the `llmConfigured()` gate (§7.22).
//
// Four invariants this file exists to hold:
//   - §7.4 refuse-before-spend: every validation, the 404, the 409s, and the
//     niche/pillar/prompt loads land before `askLLM`. A malformed body, an
//     unknown judgment and an edited draft all cost nothing.
//   - Decision 3, the verdict is DERIVED: nothing here computes a band.
//     `parseVerdict` (JD.3) calls `deriveVerdictBand` and hands back the label
//     with the number, so the route spreads the parsed object whole. A second
//     derivation here would be the twin that eventually disagrees (§7 rule 4c) —
//     which is also why the apply route returns the STORED label rather than
//     re-deriving one from the stored `overall`.
//   - §7.8 best-effort persist: the row is written inside a try/catch and the
//     verdict is returned either way, with `id: null` when the insert failed
//     (decision 9). The money is already spent — refusing to hand back what it
//     bought is strictly worse than losing the measurement row.
//   - Decision 7, the returned verdict ALWAYS describes the returned text. Every
//     `/judge/apply` exit pairs one text with the verdict of that exact text,
//     and stamps `textHash` from the text it is returning.
//
// No `GET /judge/:id`: nothing needs it, the panel holds the verdict in state,
// and the apply route loads by id in-process.

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  type AskLlmResult,
  type LlmProvider,
  type LlmReasoningEffort,
  askLLM,
  llmErrorPayload,
} from '../../llm/index.ts';
import {
  type JudgeConfidence,
  type JudgeVerdict,
  type JudgeVerdictLabel,
  deriveApproved,
} from '../../shared/judge.ts';
import { draftJudgments } from '../db/schema.ts';
import {
  JUDGE_SCHEMA,
  MAX_JUDGE_TEXT,
  buildJudgeInput,
  judgeTextHash,
  parseVerdict,
  renderJudgeGrounding,
} from '../judge/prompt.ts';
import {
  JUDGE_REWRITE_SCHEMA,
  buildJudgeRewriteInput,
  parseJudgeRewrite,
} from '../judge/rewritePrompt.ts';
import { loadActiveNicheSafe } from '../niche/store.ts';
import { loadPromptSafe } from '../prompts/registry.ts';
import { getActivePillars } from './pillars.ts';

/** A grader, not a writer. Low temperature is what makes re-judging the same
 *  text twice mean something (the never-worse compare depends on it). */
const JUDGE_TEMPERATURE = 0.2;
/** The rewrite IS a writer, but a faithful one: its job is to apply a list, not
 *  to explore variants the way the AI.8 assist does at 0.7. Lower keeps it from
 *  drifting off the substance and losing the compare for the wrong reason.
 *  Opening guess — recalibrate against real applies, not by vibes. */
const JUDGE_REWRITE_TEMPERATURE = 0.4;
/** One post of at most MAX_JUDGE_TEXT chars (~600 tokens) plus JSON scaffolding;
 *  the same ceiling the AI.8 assist uses for three shorter variants. Headroom is
 *  the cheap side of the same asymmetry as below. */
const JUDGE_REWRITE_MAX_OUTPUT_TOKENS = 900;
/** Sized once, from the schema's own worst case: 13 scores with long keys
 *  (~150) + headline (~50) + 5 strengths and 5 improvements at ~25 each (~250)
 *  + 12 annotations of quote/severity/recommendation at ~55 each (~660) + JSON
 *  scaffolding ≈ 1150. Rounded up because the failure mode is asymmetric — a
 *  cap that is too low truncates the JSON, `parseVerdict` returns null, and the
 *  call is billed for a 502; unused headroom costs nothing (output tokens bill
 *  on what is generated). xAI does not count reasoning tokens against the cap. */
const JUDGE_MAX_OUTPUT_TOKENS = 1600;
const JUDGE_REASONING: LlmReasoningEffort = 'low';
/** v1 judges originals only (decision 2). The column is wider than this list on
 *  purpose; the validator is not. */
const JUDGE_SURFACES = ['post'] as const;
type JudgeSurface = (typeof JUDGE_SURFACES)[number];

export const judgeRouter = new Hono();

/**
 * Persist one judgment. Best-effort by contract (§7.8, the `persistRadarDrafts`
 * discipline): returns the new row id, or **null** when the write failed — the
 * caller has a paid verdict in hand and returns it regardless.
 *
 * Derives `text_hash` from `row.text` itself rather than taking it as an
 * argument, so the stored hash and the hash JD.7's Playbook join computes come
 * from the same function over the same string and cannot drift.
 *
 * Exported for the route suite (the `insertThreadDraft` precedent, AI.7) and
 * reused by JD.5's apply path, which is the only caller that sets a parent.
 */
export async function insertJudgment(row: {
  text: string;
  surface: string;
  verdict: JudgeVerdict;
  model: string;
  provider: string;
  costUsd: number | null;
  parentJudgmentId?: string | null;
}): Promise<string | null> {
  try {
    const inserted = await db
      .insert(draftJudgments)
      .values({
        textHash: judgeTextHash(row.text),
        text: row.text,
        surface: row.surface,
        // Both from the parsed verdict, never recomputed here — see the header.
        verdict: row.verdict.verdict,
        overall: row.verdict.scores.overall,
        headline: row.verdict.headline,
        confidence: row.verdict.confidence,
        scores: row.verdict.scores,
        annotations: row.verdict.annotations,
        strengths: row.verdict.strengths,
        improvements: row.verdict.improvements,
        model: row.model,
        provider: row.provider,
        costUsd: row.costUsd,
        parentJudgmentId: row.parentJudgmentId ?? null,
      })
      .returning({ id: draftJudgments.id });
    return inserted[0]?.id ?? null;
  } catch (err) {
    console.error(
      'draft_judgments insert failed (verdict still returned):',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Active pillar labels for the grounding block, best-effort (§7.8): the
 *  grounding is context, and losing it degrades `audienceMatch` to null rather
 *  than failing a request the user is waiting on. */
async function loadPillarLabelsSafe(): Promise<string[]> {
  try {
    return (await getActivePillars()).map((p) => p.label);
  } catch (err) {
    console.error('judge: pillar load failed, grounding without them:', err);
    return [];
  }
}

/** A judge call that produced a verdict. `costUsd` is this call's alone. */
interface JudgeCallOk {
  ok: true;
  verdict: JudgeVerdict;
  model: string;
  provider: LlmProvider;
  costUsd: number;
  requestId: string | null;
}
/** A judge call that did not — already shaped as the HTTP response to send. */
interface JudgeCallErr {
  ok: false;
  status: 429 | 502 | 503;
  body: Record<string, unknown>;
}

/**
 * ONE judge call: grounding + registry prompt + `askLLM` + `parseVerdict`.
 *
 * The whole point of the helper is that a re-judge inside `/judge/apply` is
 * indistinguishable from a first judge — same rubric body, same server-stamped
 * grounding, same schema, same temperature, same token cap. The never-worse
 * compare is two numbers from this function or it is noise.
 *
 * Deliberately does NOT persist: `/judge` always stores its verdict, while the
 * apply route stores only the rewrite it actually hands back, and the insert is
 * not part of what has to be identical.
 *
 * Derives nothing — `parseVerdict` already ran `deriveVerdictBand`/
 * `deriveApproved` (D165a, §7 rule 4c).
 */
async function judgeOnce(opts: {
  text: string;
  model?: string;
  provider?: LlmProvider;
}): Promise<JudgeCallOk | JudgeCallErr> {
  // Grounding is server-stamped and never client-supplied (§7.16), and rides
  // the variable tail behind the stable rubric (§7.15). It is what turns
  // `voiceMatch` into a check against MY voice and `audienceMatch` into a check
  // against MY audience (decision 5); with no niche content it renders as "no
  // audience described" and the rubric nulls `audienceMatch` rather than
  // inventing a number. The `me` layer is deliberately absent — it is about
  // specificity, not audience fit, and no dimension reads it.
  const niche = loadActiveNicheSafe();
  const pillarLabels = await loadPillarLabelsSafe();
  const grounding = renderJudgeGrounding({
    persona: niche.persona,
    beliefs: niche.beliefs,
    pillarLabels,
  });

  const prompt = loadPromptSafe('judge');
  const messages = buildJudgeInput({
    draft: opts.text,
    template: prompt.body,
    ...(grounding !== null ? { grounding } : {}),
  });

  let result: AskLlmResult;
  try {
    result = await askLLM(
      {
        ...(opts.model !== undefined ? { model: opts.model } : {}),
        ...(opts.provider !== undefined ? { provider: opts.provider } : {}),
        messages,
        jsonSchema: { name: 'judge', schema: JUDGE_SCHEMA },
        // Niche-suffixed like the drafter's: the grounding block sits inside the
        // cached prefix, so editing the niche must bust it or the judge keeps
        // grading against the old audience.
        promptCacheKey: `${prompt.cacheKey}:${niche.slug}:${niche.updatedAt?.getTime() ?? 0}`,
      },
      {
        defaults: {
          temperature: JUDGE_TEMPERATURE,
          maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
          reasoningEffort: JUDGE_REASONING,
        },
      },
    );
  } catch (err) {
    const mapped = llmErrorPayload(err);
    if (mapped) return { ok: false, status: mapped.status, body: mapped.body };
    const detail = err instanceof Error ? err.message : String(err);
    console.error('/x/judge failed:', detail);
    return { ok: false, status: 502, body: { error: 'judge_failed', detail } };
  }

  // The ONLY 502 the parser can produce (JD.3): `parseVerdict` returns null for
  // an unparseable body or a bad `scores` object, and degrades everything else.
  // A verdict with an empty headline, null confidence and zero annotations is a
  // SUCCESS — adding a second refusal on top would throw away a paid call over
  // a model that simply had nothing to flag.
  const verdict = parseVerdict(result.text);
  if (verdict === null) {
    return {
      ok: false,
      status: 502,
      body: { error: 'judge_parse_error', requestId: result.requestId },
    };
  }

  return {
    ok: true,
    verdict,
    model: result.model,
    provider: result.provider,
    costUsd: result.costUsd,
    requestId: result.requestId,
  };
}

judgeRouter.post('/judge', async (c) => {
  const raw = await c.req.raw.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as {
    text?: unknown;
    surface?: unknown;
    model?: unknown;
    provider?: unknown;
  };

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < 1 || text.length > MAX_JUDGE_TEXT) {
    return c.json({ error: 'invalid_text' }, 400);
  }

  let surface: JudgeSurface = 'post';
  if (body.surface !== undefined && body.surface !== null) {
    if (
      typeof body.surface !== 'string' ||
      !(JUDGE_SURFACES as readonly string[]).includes(body.surface)
    ) {
      return c.json({ error: 'invalid_surface' }, 400);
    }
    surface = body.surface as JudgeSurface;
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

  const outcome = await judgeOnce({
    text,
    ...(model !== undefined ? { model } : {}),
    ...(provider !== undefined ? { provider } : {}),
  });
  if (!outcome.ok) return c.json(outcome.body, outcome.status);

  const id = await insertJudgment({
    text,
    surface,
    verdict: outcome.verdict,
    model: outcome.model,
    provider: outcome.provider,
    costUsd: outcome.costUsd,
  });

  return c.json({
    id,
    textHash: judgeTextHash(text),
    ...outcome.verdict,
    model: outcome.model,
    provider: outcome.provider,
    costUsd: outcome.costUsd,
    requestId: outcome.requestId,
  });
});

// ------------------------------------------------------- JD.5: apply the fixes

/**
 * The never-worse guard (decision 7), in the one place it lives.
 *
 * Strictly `>`: a rewrite that TIES has not earned the swap, and the user's own
 * words win the tie. That asymmetry is the whole safety property — at
 * temperature 0.2 a cosmetic rewrite scores the same as the original far more
 * often than it scores lower, so `>=` would quietly hand back a machine's
 * rephrasing of your post on the strength of no evidence at all.
 *
 * Exported for the route suite: the guard is what this route exists for, and
 * both of its live paths cost ~$0.007 to reach.
 */
export function rewriteWins(rewriteOverall: number, originalOverall: number): boolean {
  return rewriteOverall > originalOverall;
}

/** Every exit from `/judge/apply` goes through here, which is how decision 7's
 *  one invariant is held structurally rather than by three careful hands: the
 *  hash is always computed from the text being returned, and the verdict beside
 *  it is always the verdict OF that text. Exported for the route suite. */
export function applyPayload(opts: {
  text: string;
  improved: boolean;
  judgmentId: string | null;
  verdict: JudgeVerdict;
  /** The grader of the RETURNED verdict — the original's on a kept draft, the
   *  re-judge's on a swapped one. */
  model: string;
  provider: string;
  /** What this request spent: the rewrite plus the re-judge, billed whichever
   *  text won. Not the cost stored on the judgment row. */
  costUsd: number;
}) {
  return {
    text: opts.text,
    improved: opts.improved,
    judgmentId: opts.judgmentId,
    textHash: judgeTextHash(opts.text),
    ...opts.verdict,
    model: opts.model,
    provider: opts.provider,
    costUsd: opts.costUsd,
  };
}

judgeRouter.post('/judge/apply', async (c) => {
  const raw = await c.req.raw.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as {
    judgmentId?: unknown;
    text?: unknown;
    model?: unknown;
    provider?: unknown;
  };

  const judgmentId = typeof body.judgmentId === 'string' ? body.judgmentId.trim() : '';
  if (judgmentId === '') {
    return c.json({ error: 'invalid_judgment_id' }, 400);
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < 1 || text.length > MAX_JUDGE_TEXT) {
    return c.json({ error: 'invalid_text' }, 400);
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

  const row = await db.select().from(draftJudgments).where(eq(draftJudgments.id, judgmentId)).get();
  if (!row) {
    return c.json({ error: 'judgment_not_found' }, 404);
  }

  // The reset-on-edit rule as a server check (§J4): a verdict is only valid for
  // the exact text it judged. `judgeTextHash` normalizes whitespace, so
  // reflowing a draft is not an edit — retyping a word is.
  if (judgeTextHash(text) !== row.textHash) {
    return c.json({ error: 'stale_verdict' }, 409);
  }

  const annotations = row.annotations ?? [];
  const improvements = row.improvements ?? [];
  // A verdict with nothing flagged is a SUCCESS for `/judge` (JD.3) but there is
  // nothing here to apply, and paying a rewrite call to apply zero fixes is the
  // spend §7.4 exists to refuse. The panel hides the button in this case; a
  // direct caller gets told why rather than getting a silent no-op.
  if (annotations.length === 0 && improvements.length === 0) {
    return c.json({ error: 'nothing_to_apply' }, 409);
  }

  // The stored label, narrowed — not re-derived from `row.overall`. Only
  // `insertJudgment` writes this column and only from a parsed verdict, so it is
  // a JudgeVerdictLabel by construction, and re-deriving would be exactly the
  // second derivation decision 3 exists to prevent (D165a).
  const originalLabel = row.verdict as JudgeVerdictLabel;
  const originalVerdict: JudgeVerdict = {
    verdict: originalLabel,
    approved: deriveApproved(originalLabel),
    headline: row.headline,
    confidence: row.confidence as JudgeConfidence | null,
    scores: row.scores,
    annotations,
    strengths: row.strengths ?? [],
    improvements,
  };

  // `row.text`, not the request's `text`: the annotation quotes were copied out
  // of it character for character, so it is the only spelling of the draft every
  // fix is guaranteed to anchor in. The two are hash-equal by the check above —
  // they can differ only in whitespace runs.
  const rewritePrompt = loadPromptSafe('judge-rewrite');
  const rewriteMessages = buildJudgeRewriteInput({
    draft: row.text,
    annotations,
    improvements,
    template: rewritePrompt.body,
  });

  let rewriteResult: AskLlmResult;
  try {
    rewriteResult = await askLLM(
      {
        // The caller's override steers the WRITER only. The grader is pinned
        // below, because the never-worse compare is meaningless across models.
        ...(model !== undefined ? { model } : {}),
        ...(provider !== undefined ? { provider } : {}),
        messages: rewriteMessages,
        jsonSchema: { name: 'judge_rewrite', schema: JUDGE_REWRITE_SCHEMA },
        // No niche suffix: this prompt carries no persona tokens, so a niche
        // switch does not change its cache bucket (the AI.8 convention).
        promptCacheKey: rewritePrompt.cacheKey,
      },
      {
        defaults: {
          temperature: JUDGE_REWRITE_TEMPERATURE,
          maxOutputTokens: JUDGE_REWRITE_MAX_OUTPUT_TOKENS,
          reasoningEffort: JUDGE_REASONING,
        },
      },
    );
  } catch (err) {
    const mapped = llmErrorPayload(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    const detail = err instanceof Error ? err.message : String(err);
    console.error('/x/judge/apply rewrite failed:', detail);
    return c.json({ error: 'judge_rewrite_failed', detail }, 502);
  }

  const rewritten = parseJudgeRewrite(rewriteResult.text);
  if (rewritten === null) {
    return c.json({ error: 'judge_rewrite_parse_error', requestId: rewriteResult.requestId }, 502);
  }

  // A rewrite that changed nothing the judge can see. The stored verdict IS its
  // verdict by the reset-on-edit reading, so re-judging it would spend ~$0.003
  // to reproduce a number we already have — and, at temperature 0.2, would
  // usually reproduce it as a tie and discard it anyway.
  if (judgeTextHash(rewritten) === row.textHash) {
    return c.json(
      applyPayload({
        text,
        improved: false,
        judgmentId: row.id,
        verdict: originalVerdict,
        model: row.model,
        provider: row.provider,
        costUsd: rewriteResult.costUsd,
      }),
    );
  }

  // The grader is the ORIGINAL judgment's model and provider, never the
  // caller's override: `<=` between a grok verdict and an openrouter one
  // compares two graders, not two drafts (decision 11 — a judge on the drafting
  // model likes its own prose, which is a bias only worth carrying if it is the
  // SAME bias on both sides).
  const judgeProvider: LlmProvider | undefined =
    row.provider === 'grok' || row.provider === 'openrouter' ? row.provider : undefined;
  const reJudged = await judgeOnce({
    text: rewritten,
    ...(row.model.trim() !== '' ? { model: row.model } : {}),
    ...(judgeProvider !== undefined ? { provider: judgeProvider } : {}),
  });
  if (!reJudged.ok) return c.json(reJudged.body, reJudged.status);

  const spent = rewriteResult.costUsd + reJudged.costUsd;

  // The guard (decision 7). The original text comes back as the CALLER spelled
  // it, so a kept draft leaves the composer untouched.
  if (!rewriteWins(reJudged.verdict.scores.overall, row.overall)) {
    return c.json(
      applyPayload({
        text,
        improved: false,
        judgmentId: row.id,
        verdict: originalVerdict,
        model: row.model,
        provider: row.provider,
        costUsd: spent,
      }),
    );
  }

  // Only the winner is persisted. A discarded rewrite is text the user never
  // saw, and JD.7 buckets published posts by the band their text was judged at —
  // a row nothing can ever join is noise in the one table built to be measured.
  const newId = await insertJudgment({
    text: rewritten,
    surface: row.surface,
    verdict: reJudged.verdict,
    model: reJudged.model,
    provider: reJudged.provider,
    costUsd: reJudged.costUsd,
    parentJudgmentId: row.id,
  });

  return c.json(
    applyPayload({
      text: rewritten,
      improved: true,
      judgmentId: newId,
      verdict: reJudged.verdict,
      model: reJudged.model,
      provider: reJudged.provider,
      costUsd: spent,
    }),
  );
});
