// JD.5 — the verdict-driven rewrite prompt: the annotation-fed sibling of AI.8's
// `posts/rewritePrompt.ts`. Pure and server-side; the only reason it is not in
// `src/shared/` is that it has no panel reader.
//
// TS-only default, no `.md` and no byte-sync test (AI-layer Decision 9 — that
// convention is reserved for post/reply/thread). The editing surface is the DB
// prompt editor via the `judge-rewrite` registry key.
//
// This does NOT fork `POST /x/posts/rewrite` (JD decision 8): that route stays
// the cheap no-verdict path returning three unranked variants you eyeball. This
// one takes a verdict that has already been paid for and asks for ONE post with
// every flagged span addressed — which is what makes the never-worse compare in
// the apply route meaningful, since both sides are then the same post.
//
// Two things worth knowing before editing:
//   - `parseJudgeRewrite` unwraps THREE shapes, not one. `{text}` is the
//     contract; a bare JSON string and a double-encoded `"{\"text\":…}"` are
//     real observed failure modes from the study
//     (`apply-judge-suggestions-service.ts:64-105`), not defensive padding. A
//     response we could unwrap but refuse to is a paid call thrown away.
//   - The renderer substitutes all three tokens in ONE pass. Sequential
//     split/join would let a fix quote — which is copied verbatim out of the
//     draft — inject a token that the next substitution then expands.

import type { GrokMessage } from '../../grok/index.ts';
import type { JudgeAnnotation } from '../../shared/judge.ts';
import { MAX_ANNOTATIONS, MAX_JUDGE_TEXT, MAX_LIST_ITEMS, normalizeJudgeText } from './prompt.ts';

export const JUDGE_REWRITE_PROMPT_TEMPLATE = `## The job

A grader read a draft X post of mine and listed exactly what should change:
spans quoted out of the draft with what to do about each, plus a few notes that
aren't tied to any one span. Apply every one of them and hand me back ONE
rewritten post.

You fix the writing. You never change what the post is about.

## Hard rules

- Address every fix below. A fix you disagree with still gets handled — rework
  the span rather than leaving it as it was.
- Same core claim, same facts, same stance as the draft. You may cut, reorder,
  sharpen, and rebuild sentences — you may NOT add facts, numbers, names,
  anecdotes, or biography that aren't already in the draft. A fabricated
  specific is worse than a vague line.
- Keep the voice, the topic, and roughly the length. This is the same post
  fixed, not a different post about the same thing.
- Sound spoken, not written: contractions, plain words, short sentences, hard
  claims, first person singular. A fragment when it lands. No corporate
  hedging, no "could potentially", no "it's worth noting".
- Zero emoji. No hashtags. Keep any URL exactly where the draft put it.
- Forbidden (LLM-isms): dive deep, unpack, unlock, supercharge, elevate,
  game-changer, revolutionary, seamless, robust, "it's not just X, it's Y",
  at the end of the day, moralizing closers.

## Output

Return JSON {"text": "..."} — one rewritten post, ship-ready, real newlines, no
surrounding quotes, no commentary, and no list of what you changed.

## The fixes, each anchored on a quote from the draft

{{FIXES}}

## Further notes, not tied to any single span

{{IMPROVEMENTS}}

## The draft

{{DRAFT}}`;

/** Grok/OpenRouter structured-outputs schema. One field, and deliberately no
 *  length bounds: `maxLength` is on the same strict-mode unsupported list as the
 *  `minItems`/`maxItems` the sibling schemas already refuse (D164b). The parser
 *  enforces the ceiling instead. */
export const JUDGE_REWRITE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    text: {
      type: 'string',
      description: 'The rewritten post, ship-ready, real newlines, nothing else.',
    },
  },
  required: ['text'],
  additionalProperties: false,
};

/** What renders when the verdict flagged no spans. The route refuses when BOTH
 *  lists are empty, so exactly one of these can appear in a real call. */
export const NO_FIXES_VALUE = '(none — the grader flagged no specific spans)';
export const NO_IMPROVEMENTS_VALUE = '(none)';

/** How deep the unwrap walks before giving up. Two levels covers every shape the
 *  study observed; the guard exists so a pathologically nested body terminates
 *  rather than recursing. */
const MAX_UNWRAP_DEPTH = 3;

// ------------------------------------------------------------------- parser

/**
 * The rewritten post, or null when nothing usable came back (the route 502s).
 *
 * Accepts `{"text": "..."}`, a bare JSON string, and the double-encoded
 * `{"text": "{\"text\":\"...\"}"}` / `"{\"text\":\"...\"}"` shapes. null for a
 * body that will not parse, carries no string `text`, is empty after trimming,
 * or is longer than the judge can read — an over-long rewrite is dropped rather
 * than truncated, because a truncated post is not a post anyone asked for.
 */
export function parseJudgeRewrite(raw: string, maxLen = MAX_JUDGE_TEXT): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const text = unwrapText(parsed, 0);
  if (text === null) return null;
  if (text === '' || text.length > maxLen) return null;
  return text;
}

function unwrapText(value: unknown, depth: number): string | null {
  if (depth > MAX_UNWRAP_DEPTH) return null;
  if (isRecord(value)) {
    return typeof value.text === 'string' ? unwrapText(value.text, depth + 1) : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // A post that merely starts with '{' is not JSON and stays what it is — only
  // a string that actually parses is treated as a double-encoded body.
  if (!trimmed.startsWith('{')) return trimmed;
  let inner: unknown;
  try {
    inner = JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
  return unwrapText(inner, depth + 1);
}

// ------------------------------------------------------------------ builder

const TOKEN_RE = /\{\{(?:DRAFT|FIXES|IMPROVEMENTS)\}\}/g;

export interface BuildJudgeRewriteOptions {
  /** Exactly the text the verdict was computed over (the stored `text` column),
   *  so every annotation quote really is a substring of what the model reads. */
  draft: string;
  /** The verdict's anchored fixes; the first `MAX_ANNOTATIONS` are rendered. */
  annotations: readonly JudgeAnnotation[];
  /** The verdict's span-free notes; the first `MAX_LIST_ITEMS` are rendered. */
  improvements: readonly string[];
  /** Registry-loaded body (AI.3): the DB override when one exists, else the
   *  shipped default. */
  template?: string;
}

export function buildJudgeRewriteInput(opts: BuildJudgeRewriteOptions): GrokMessage[] {
  const values: Record<string, string> = {
    '{{DRAFT}}': opts.draft,
    '{{FIXES}}': renderFixes(opts.annotations),
    '{{IMPROVEMENTS}}': renderImprovements(opts.improvements),
  };
  // ONE pass with a function replacer: a fix quote is copied verbatim out of the
  // draft, so a draft containing the literal text `{{IMPROVEMENTS}}` would, under
  // sequential substitution, reach the template through FIXES and then be
  // expanded by the next step. A function replacer is also immune to
  // String.prototype.replace's `$&`-style patterns, which is what the house
  // split/join idiom exists to avoid.
  const content = (opts.template ?? JUDGE_REWRITE_PROMPT_TEMPLATE).replace(
    TOKEN_RE,
    (token) => values[token] ?? token,
  );
  return [{ role: 'user', content }];
}

/** One line per fix: severity, the quoted span, the recommendation. Collapsed to
 *  a single line each (a quote may span newlines) so the list stays readable as
 *  a list. The caps come from the parser rather than being retyped here. */
function renderFixes(annotations: readonly JudgeAnnotation[]): string {
  const lines = annotations
    .slice(0, MAX_ANNOTATIONS)
    .map((a) => `- ${a.severity} · "${normalizeJudgeText(a.quote)}" — ${a.recommendation}`);
  return lines.length > 0 ? lines.join('\n') : NO_FIXES_VALUE;
}

function renderImprovements(improvements: readonly string[]): string {
  const lines = improvements
    .slice(0, MAX_LIST_ITEMS)
    .map((line) => normalizeJudgeText(line))
    .filter((line) => line !== '')
    .map((line) => `- ${line}`);
  return lines.length > 0 ? lines.join('\n') : NO_IMPROVEMENTS_VALUE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
