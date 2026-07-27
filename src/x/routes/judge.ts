// JD.4 — the LLM judge: one structured-outputs call that grades ONE draft on
// the 13-dimension rubric and comes back with a headline, up to twelve anchored
// fixes, and a band derived from the overall score.
//
//   POST /judge  body: { text (1–2000), surface? ('post'), model?, provider? }
//     ~$0.003, human-triggered only. There is no worker, no batch, no automatic
//     invocation anywhere: x-builder auto-judges all three generated candidates
//     because its LLM is a subscription CLI with $0 marginal cost, and we pay
//     per token (JD decision 1). One button, on the draft you are about to
//     schedule.
//
// Mounted beside `drafter` under the `llmConfigured()` gate (§7.22).
//
// Three invariants this file exists to hold:
//   - §7.4 refuse-before-spend: every validation, and the niche/pillar/prompt
//     loads, land before `askLLM`. A malformed body costs nothing.
//   - Decision 3, the verdict is DERIVED: nothing here computes a band.
//     `parseVerdict` (JD.3) calls `deriveVerdictBand` and hands back the label
//     with the number, so the route spreads the parsed object whole. A second
//     derivation here would be the twin that eventually disagrees (§7 rule 4c).
//   - §7.8 best-effort persist: the row is written inside a try/catch and the
//     verdict is returned either way, with `id: null` when the insert failed
//     (decision 9). The money is already spent — refusing to hand back what it
//     bought is strictly worse than losing the measurement row.
//
// No `GET /judge/:id`: nothing needs it, the panel holds the verdict in state,
// and JD.5 loads by id in-process.

import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  type AskLlmResult,
  type LlmProvider,
  type LlmReasoningEffort,
  askLLM,
  llmErrorPayload,
} from '../../llm/index.ts';
import type { JudgeVerdict } from '../../shared/judge.ts';
import { draftJudgments } from '../db/schema.ts';
import {
  JUDGE_SCHEMA,
  buildJudgeInput,
  judgeTextHash,
  parseVerdict,
  renderJudgeGrounding,
} from '../judge/prompt.ts';
import { loadActiveNicheSafe } from '../niche/store.ts';
import { loadPromptSafe } from '../prompts/registry.ts';
import { getActivePillars } from './pillars.ts';

/** Same ceiling as the rewrite assist — a single X post plus room for a draft
 *  that is still being cut down. A thread is judged one tweet at a time or not
 *  at all. */
const MAX_JUDGE_TEXT = 2000;
/** A grader, not a writer. Low temperature is what makes re-judging the same
 *  text twice mean something (JD.5's never-worse compare depends on it). */
const JUDGE_TEMPERATURE = 0.2;
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
    draft: text,
    template: prompt.body,
    ...(grounding !== null ? { grounding } : {}),
  });

  let result: AskLlmResult;
  try {
    result = await askLLM(
      {
        ...(model !== undefined ? { model } : {}),
        ...(provider !== undefined ? { provider } : {}),
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
    if (mapped) return c.json(mapped.body, mapped.status);
    const detail = err instanceof Error ? err.message : String(err);
    console.error('/x/judge failed:', detail);
    return c.json({ error: 'judge_failed', detail }, 502);
  }

  // The ONLY 502 the parser can produce (JD.3): `parseVerdict` returns null for
  // an unparseable body or a bad `scores` object, and degrades everything else.
  // A verdict with an empty headline, null confidence and zero annotations is a
  // SUCCESS — adding a second refusal on top would throw away a paid call over
  // a model that simply had nothing to flag.
  const verdict = parseVerdict(result.text);
  if (verdict === null) {
    return c.json({ error: 'judge_parse_error', requestId: result.requestId }, 502);
  }

  const id = await insertJudgment({
    text,
    surface,
    verdict,
    model: result.model,
    provider: result.provider,
    costUsd: result.costUsd,
  });

  return c.json({
    id,
    textHash: judgeTextHash(text),
    ...verdict,
    model: result.model,
    provider: result.provider,
    costUsd: result.costUsd,
    requestId: result.requestId,
  });
});
