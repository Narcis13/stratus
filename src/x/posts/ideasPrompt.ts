// Idea-generator prompt + renderer for POST /x/ideas/generate (AI.9).
//
// IDEAS_PROMPT_TEMPLATE is a TS-only default (AI-layer Decision 9, same as
// rewritePrompt.ts): the .md ↔ TS byte-sync convention is kept only for the
// three big authoring prompts (post/reply/thread); the smaller templates live
// as TS constants edited through the DB prompt editor. No `ideas prompt.md`, no
// byte-sync test. All per-call content ({{PILLARS}}/{{WINNERS}}/{{STEER}}) sits
// at the very end so the instruction block stays a stable, cacheable prefix
// (§7.15). This prompt carries NO persona/belief tokens — pillars + measured
// winners are the grounding, and both sit at the tail, so a niche switch does
// not change the cache bucket (unlike the post/thread drafters).

import type { GrokMessage } from '../../grok/index.ts';
import { DEFAULT_PILLARS, DEFAULT_PILLAR_SLUGS, type PillarDef, renderPillars } from './pillars.ts';
import type { WinnerPost } from './prompt.ts';

export const IDEAS_PROMPT_TEMPLATE = `## The job

Generate post ideas for my X feed. An idea is NOT a finished post — it is one
or two sentences naming the claim, the scene, or the question, plus why it
would stop a builder mid-scroll. I pick the ones worth writing; volume and
variety beat polish here.

## Rules

- Ground every idea in my content pillars (below) and, when they exist, in
  what measurably worked (my recent winners, below). An idea that extends a
  proven winner's angle is worth more than a novel one from nowhere.
- Ideas must point at MY real material — my projects, my stack, my daily
  practice. Placeholder slots are fine and encouraged: "the time an agent
  refactor went wrong", "today's exact prompt that saved an hour". I fill
  the specifics; you never invent them as if they happened.
- Mix registers: some plain observations, some spicy stances that split the
  room, some reflective. At least a third should take a side.
- No two ideas about the same thing. No generic advice ("consistency matters").
  If a stranger could tweet it, cut it.
- Each idea declares the pillar slug it serves (only slugs from the PILLARS
  block) and a one-word angle: observation | stance | story | question.

## Output

Return JSON {"ideas": [{"text": "...", "pillar": "...", "angle": "..."}]} —
8 ideas unless my steer asks otherwise. text is the idea itself, ready to
paste into my idea inbox; no numbering, no commentary.

## PILLARS

{{PILLARS}}

## RECENT WINNERS (my top measured posts — extend what works)

{{WINNERS}}

## MY STEER (optional — may be Romanian; translate the intent)

{{STEER}}`;

export type IdeaAngle = 'observation' | 'stance' | 'story' | 'question';
const IDEA_ANGLES: readonly IdeaAngle[] = ['observation', 'stance', 'story', 'question'];

export interface IdeaProposal {
  text: string;
  /** A slug from the active PILLARS block, or null when the model named one
   *  outside the set (nulled, not dropped — the idea itself is still good). */
  pillar: string | null;
  angle: IdeaAngle;
}

// An idea is one or two sentences; a proposal past this cap has ignored the
// brief and is dropped (not truncated) — same discipline as rewrite variants.
export const MAX_IDEA_TEXT = 500;
// Hard ceiling the route also clamps `count` to. The prompt asks for 8 by
// default; more than this is noise for a human to triage.
export const MAX_IDEA_COUNT = 10;

// Grok/OpenRouter structured-outputs schema. Static: `angle` is a fixed enum,
// but `pillar` is deliberately a FREE string (not enum-bound to the live slugs)
// so a mis-tagged pillar can be nulled on the way out rather than forcing the
// whole idea to be dropped. Deliberately NO minItems/maxItems on `ideas` —
// strict structured-outputs + array bounds is a documented rejection risk on
// both providers (the rewrite/thread/N.8/RU.3 convention); the route clamps
// count and 502s on zero survivors.
export const IDEAS_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The idea itself — one or two sentences, ready to paste',
          },
          pillar: {
            type: 'string',
            description: 'The slug of the content pillar this idea serves',
          },
          angle: { type: 'string', enum: ['observation', 'stance', 'story', 'question'] },
        },
        required: ['text', 'pillar', 'angle'],
        additionalProperties: false,
      },
    },
  },
  required: ['ideas'],
  additionalProperties: false,
} as const;

// Strict-mode structured outputs guarantee the shape, but a truncated body
// (max_output_tokens) must degrade to null, never to malformed proposals. null =
// the `ideas` field is missing/not an array (parse error). An individual entry
// that's empty, over-long, or an unknown angle is dropped; a pillar outside the
// active slug set is NULLED (not dropped) — the idea stays, the tag is cleared.
// The returned array may be empty (the route 502s on that), never a bad row.
export function parseIdeaProposals(
  raw: string,
  allowedSlugs: string[] = DEFAULT_PILLAR_SLUGS,
  maxCount = MAX_IDEA_COUNT,
): IdeaProposal[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const arr = (parsed as Record<string, unknown>).ideas;
  if (!Array.isArray(arr)) return null;

  const allowed = new Set(allowedSlugs);
  const out: IdeaProposal[] = [];
  for (const v of arr) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    if (typeof o.text !== 'string' || typeof o.angle !== 'string') continue;
    if (!IDEA_ANGLES.includes(o.angle as IdeaAngle)) continue;
    const text = o.text.trim();
    if (text === '' || text.length > MAX_IDEA_TEXT) continue;
    const pillar = typeof o.pillar === 'string' && allowed.has(o.pillar) ? o.pillar : null;
    out.push({ text, pillar, angle: o.angle as IdeaAngle });
    if (out.length >= maxCount) break;
  }
  return out;
}

const PILLARS_PLACEHOLDER = '{{PILLARS}}';
const WINNERS_PLACEHOLDER = '{{WINNERS}}';
const STEER_PLACEHOLDER = '{{STEER}}';
const MAX_WINNERS = 5;

export interface BuildIdeasOptions {
  /** Active pillars rendered into the PILLARS block. Defaults to the seed set. */
  pillars?: PillarDef[];
  /** Top measured own posts — the "extend what works" grounding. */
  winners: WinnerPost[];
  /** Optional free steer (Romanian OK). */
  steer?: string;
  /** How many ideas to ask for — folded into the STEER block (the prompt's
   *  hardcoded "8 ideas" is overridden by an explicit count line). */
  count?: number;
  /** Registry-loaded prompt body (AI.3): the DB override when one exists, else
   *  the shipped default. Defaults to IDEAS_PROMPT_TEMPLATE. */
  template?: string;
}

export function buildIdeasInput(opts: BuildIdeasOptions): GrokMessage[] {
  const pillars = opts.pillars && opts.pillars.length > 0 ? opts.pillars : DEFAULT_PILLARS;
  // split/join (not replace) so '$' in user content can't trigger
  // String.prototype.replace's special replacement patterns.
  let content = (opts.template ?? IDEAS_PROMPT_TEMPLATE)
    .split(PILLARS_PLACEHOLDER)
    .join(renderPillars(pillars));
  content = content.split(WINNERS_PLACEHOLDER).join(renderWinners(opts.winners));
  content = content.split(STEER_PLACEHOLDER).join(renderSteer(opts));
  return [{ role: 'user', content }];
}

// The explicit count instruction and the free steer both ride the single
// {{STEER}} block (same as threadPrompt folds tweetCount into {{IDEA}}).
function renderSteer(opts: BuildIdeasOptions): string {
  const parts: string[] = [];
  if (typeof opts.count === 'number') parts.push(`Return exactly ${opts.count} ideas.`);
  const steer = opts.steer?.trim();
  if (steer) parts.push(steer);
  if (parts.length === 0) return '(none — spread the ideas across the pillars)';
  return parts.join('\n');
}

function renderWinners(winners: WinnerPost[]): string {
  if (winners.length === 0) return '(no measured winners yet)';
  return winners
    .slice(0, MAX_WINNERS)
    .map((w, i) => {
      const stats = [
        w.views != null ? `${w.views} views` : null,
        w.profileVisits != null ? `${w.profileVisits} profile clicks` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return `${i + 1}. [${stats || 'unmeasured'}]\n${w.text}`;
    })
    .join('\n\n');
}
