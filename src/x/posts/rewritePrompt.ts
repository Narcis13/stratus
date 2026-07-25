// Rewrite-assist prompt + renderer for POST /x/posts/rewrite (AI.8).
//
// REWRITE_PROMPT_TEMPLATE is a TS-only default (AI-layer Decision 9: the .md ↔ TS
// byte-sync convention is kept only for the three big authoring prompts —
// post/reply/thread; the seven smaller templates live as TS constants and their
// editing surface is the DB prompt editor). No `rewrite prompt.md`, no byte-sync
// test. All per-call content ({{DRAFT}}/{{INSTRUCTION}}) sits at the very end so
// the instruction block stays a stable, cacheable prefix (§7.15). This prompt
// carries NO persona/pillar tokens — a rewrite improves the writing, never adds
// biography, so a niche switch doesn't affect its cache bucket.

import type { GrokMessage } from '../../grok/index.ts';

export const REWRITE_PROMPT_TEMPLATE = `## The job

You are rewriting a draft X post of mine. The idea is good — the execution
isn't there yet. Return three sharper versions of the SAME post. You improve
the writing; you never change the substance.

## Hard rules

- Same core claim, same facts, same stance as the draft. You may cut, reorder,
  sharpen, and rebuild sentences — you may NOT add facts, numbers, names,
  anecdotes, or biography that are not in the draft or my instruction. A
  fabricated specific is worse than a vague line.
- Sound spoken, not written: contractions, plain words, short sentences, hard
  claims, first person singular. A fragment when it lands. No corporate
  hedging, no "could potentially", no "it's worth noting".
- The first line is the hook. It gets rebuilt in every variant — the reader
  sees only it before deciding to stop.
- Zero emoji. No hashtags. Keep any URL exactly where the draft put it.
- Under 280 characters per variant unless the draft itself is longer.
- Forbidden (LLM-isms): dive deep, unpack, unlock, supercharge, elevate,
  game-changer, revolutionary, seamless, robust, "it's not just X, it's Y",
  at the end of the day, moralizing closers.

## The three variants

- "tightened" — same structure, every word earning its place. Usually the
  draft minus a third.
- "rehooked" — the first line rebuilt to stop the scroll: lead with the
  number, the tension, or the scene the draft buried.
- "restructured" — a genuinely different shape: flip the order, turn prose
  into a list, or land the punchline first and explain after.

## Output

Return JSON {"variants": [{"text": "...", "kind": "tightened"}, {"text": "...",
"kind": "rehooked"}, {"text": "...", "kind": "restructured"}]} — each text
ship-ready, real newlines, no surrounding quotes, no commentary.

## The draft

{{DRAFT}}

## My instruction (optional — may be Romanian; translate the intent)

{{INSTRUCTION}}`;

export type RewriteKind = 'tightened' | 'rehooked' | 'restructured';
const REWRITE_KINDS: readonly RewriteKind[] = ['tightened', 'rehooked', 'restructured'];

export interface RewriteVariant {
  text: string;
  kind: RewriteKind;
}

// A variant longer than this is dropped, not truncated (AI.8): a rewrite should
// be tweet-shaped; a wall of text is a sign the model changed the substance.
export const MAX_VARIANT_LENGTH = 560;

// Grok/OpenRouter structured-outputs schema. Static (the kind enum is fixed).
// Deliberately NO minItems/maxItems on `variants` — strict structured-outputs
// + array bounds is a documented rejection risk on both providers (the
// threadPrompt/N.8/RU.3 convention). The route drops over-long variants and
// 502s on zero survivors instead.
export const REWRITE_SCHEMA = {
  type: 'object',
  properties: {
    variants: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The rewritten post, ship-ready, real newlines' },
          kind: { type: 'string', enum: ['tightened', 'rehooked', 'restructured'] },
        },
        required: ['text', 'kind'],
        additionalProperties: false,
      },
    },
  },
  required: ['variants'],
  additionalProperties: false,
} as const;

// Strict-mode structured outputs guarantee the shape, but a truncated body
// (max_output_tokens) must degrade to null, never to malformed variants. null =
// the `variants` field is missing/not an array (parse error). An individual
// entry that's empty, over-long, or an unknown kind is dropped — the returned
// array may be empty (the route 502s on that), never carries a bad row.
export function parseRewrite(raw: string, maxLen = MAX_VARIANT_LENGTH): RewriteVariant[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const arr = (parsed as Record<string, unknown>).variants;
  if (!Array.isArray(arr)) return null;

  const out: RewriteVariant[] = [];
  for (const v of arr) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    if (typeof o.text !== 'string' || typeof o.kind !== 'string') continue;
    if (!REWRITE_KINDS.includes(o.kind as RewriteKind)) continue;
    const text = o.text.trim();
    if (text === '' || text.length > maxLen) continue;
    out.push({ text, kind: o.kind as RewriteKind });
  }
  return out;
}

const DRAFT_PLACEHOLDER = '{{DRAFT}}';
const INSTRUCTION_PLACEHOLDER = '{{INSTRUCTION}}';

export interface BuildRewriteOptions {
  /** The draft post to rewrite (1–2000 chars, validated at the route). */
  draft: string;
  /** Optional steer (Romanian OK). */
  instruction?: string;
  /** Registry-loaded prompt body (AI.3): the DB override when one exists, else
   *  the shipped default. Defaults to REWRITE_PROMPT_TEMPLATE. */
  template?: string;
}

export function buildRewriteInput(opts: BuildRewriteOptions): GrokMessage[] {
  // split/join (not replace) so '$' in the draft can't trigger
  // String.prototype.replace's special replacement patterns.
  let content = (opts.template ?? REWRITE_PROMPT_TEMPLATE)
    .split(DRAFT_PLACEHOLDER)
    .join(opts.draft);
  const instruction = opts.instruction?.trim();
  content = content
    .split(INSTRUCTION_PLACEHOLDER)
    .join(instruction && instruction !== '' ? instruction : '(none — just sharpen it)');
  return [{ role: 'user', content }];
}
