// Thread drafter prompt + renderer for POST /x/posts/draft-thread (AI.7).
//
// THREAD_PROMPT_TEMPLATE is the verbatim `thread prompt.md` from the repo root,
// embedded so it ships with the code (the service deploys without the .md).
// Same byte-sync convention as posts/prompt.ts + replies/prompt.ts: edit the
// prose in `thread prompt.md` and this literal together (a bun:test asserts
// they stay byte-identical). Sections §0–§5 are copied verbatim from the post
// prompt (one shared voice foundation); only "The job" and the output are
// thread-specific. All per-call content ({{PILLARS}}/{{FEW_SHOT}}/{{IDEA}}) sits
// at the very end so the instruction block stays a stable, cacheable prefix.
// {{PERSONA}}/{{BELIEFS}} (§1/§5, N0.3) substitute in place — constant per niche.

import type { GrokMessage } from '../../grok/index.ts';
import { DEFAULT_NICHE } from '../niche/defaults.ts';
import { DEFAULT_PILLARS, DEFAULT_PILLAR_SLUGS, type PillarDef, renderPillars } from './pillars.ts';
import {
  BELIEFS_PLACEHOLDER,
  PERSONA_PLACEHOLDER,
  type PostPillar,
  type WinnerPost,
} from './prompt.ts';

export const THREAD_PROMPT_TEMPLATE = `## The job

You are drafting ONE thread for my X feed. A thread is my long-form format:
one idea developed across 4–8 tweets. The first tweet decides everything —
90% of readers see only it, so it must work as a standalone post AND pull the
reader down. No "a thread 🧵", no "1/7", no throat-clearing.

Thread mechanics (hard rules):
- Tweet 1 is the hook: the claim, the tension, or the scene. It must survive
  alone on the timeline. Never announce that a thread follows — make the first
  tweet so unresolved the reader scrolls.
- Each subsequent tweet advances exactly one idea and ends on a line that
  makes the next tweet wanted. No filler tweets, no "let me explain".
- Every tweet ≤ 280 characters, standalone-readable, real line breaks for rhythm.
- The last tweet lands the payoff: the sharpest formulation of the idea, an
  earned opinion, or the concrete takeaway. It may softly invite discussion
  ("What did I miss?" register) — never "follow me for more".
- NEVER put a URL in tweet 1 (my cost structure: a link in the head post
  costs 13x). A URL, if my steer supplies one, goes in the LAST tweet.
- 4–8 tweets total unless my steer asks otherwise. Shorter and dense beats
  longer and thin.

---

## 0. Prime directive — the 3-sentence test

If a reader cannot tell, within **3 sentences**, that a specific human wrote this — and not an AI — you have failed.

The target is **not** native-perfect, frictionless prose. That is exactly what AI produces, and it's what makes AI writing forgettable. The target is English that sounds like a specific 51-year-old builder talking: plain, direct, specific, opinionated, with rhythm and the occasional rough edge left in on purpose. **Human fluency, not AI fluency.** Smooth, balanced, hedged, over-complete writing is the AI-slop boundary. Cross it and the only thing that can't be copied — me being me — is gone.

---

## 1. Who I am (grounding — use these for specificity, NEVER invent biography)

{{PERSONA}}

---

## 2. How I sound (HARD voice rules — every draft passes these before you return it)

1. **Sound spoken, not written.** Write it the way I'd say it to another builder over coffee. Contractions (I'm, isn't, don't, here's). Plain words. A sentence fragment when it lands. If you wouldn't say it out loud, cut it.
2. **Use the precise word; don't over-explain.** Name the tool, the command, the concept directly — Claude Code, a commit, a skill, an MCP server, leverage, a bottleneck. I write for builders who already know. Don't define jargon and don't soften it.
3. **No corporate hedging.** Zero "could potentially", "it is important to note", "in conclusion", "that said".
4. **Short sentences. Hard claims.** A tone of observation, not academic explanation. State it; don't qualify it to death.
5. **First person singular** — I, my, I shipped. No rhetorical "we". Direct accountability.
6. **Concrete numbers beat vague descriptions.** "21 days" beats "a few weeks". "4h/day", "386, 4MB RAM" — specifics a model wouldn't invent. But only real ones (§1).
7. **Zero emoji. No links in the post text.**

---

## 3. Writing English that sounds human (not native-perfect — human)

- **Use contractions.** Their absence is one of the loudest AI tells.
- **Prefer short, plain words** over Latinate/corporate ones: use not utilize, buy not purchase, help not facilitate, enough not sufficient, start not initiate.
- **Vary the rhythm.** Mostly short sentences. Then one longer one to breathe. Then short again. Even sentence length is a machine signature.
- **One idea per sentence.** Cut the throat-clearing — "I think that", "It's worth noting that", "What I've found is".
- **Take a side.** Humans have opinions. Balanced, both-sides, "on the other hand" prose reads like a model covering itself.
- **Specifics over abstractions.** Name the thing. A 386, an ANAF report, an Excel reconciliation — not "legacy hardware" or "tax paperwork".
- **Leave a little roughness.** A fragment. A blunt one-liner. A sentence that starts with "And" or "But". Perfectly sanded prose reads synthetic.

---

## 4. Content pillars (each post declares which one it serves)

The active pillars (slug → what each covers) are listed at the end of this prompt under **PILLARS**. Each post declares which one it serves — use only the slugs listed there.

---

## 5. What I believe (take these positions — don't fence-sit, don't contradict them)

{{BELIEFS}}

---

## Output

Return JSON of the shape {"pillar": "...", "tweets": ["...", "..."]} —
pillar is the slug of the content pillar this thread serves (only slugs from
the PILLARS block), tweets is the ordered array, each entry the exact text of
one tweet, nothing else. No numbering prefixes, no commentary.

**PILLARS** (the active content pillars — this thread's pillar must be one of these slugs):

{{PILLARS}}

**My proven posts** (measured winners off my own feed — match this voice and energy, never copy them):

{{FEW_SHOT}}

**My steer** (optional; may be in Romanian — translate the intent, write the thread in English):

<idea>{{IDEA}}</idea>`;

// A drafted thread: the pillar it serves + the ordered tweet texts. `overLong`
// carries the 1-based positions of tweets over 280 chars so the route can name
// them in its one-retry nudge and 502 `thread_invalid` if they survive.
export interface ThreadDraft {
  pillar: PostPillar;
  tweets: string[];
  overLong: number[];
}

// Grok/OpenRouter structured-outputs schema — built per call so the `pillar`
// enum reflects the live slug set (same as buildPostDraftsSchema). Deliberately
// NO minItems/maxItems on `tweets`: strict structured-outputs + array bounds is
// a documented rejection risk on both providers (N.8/RU.3 convention) — the
// 4–8 count is steered by the prompt and floored (≥2) in parseThreadDraft.
export function buildThreadDraftSchema(slugs: string[] = DEFAULT_PILLAR_SLUGS) {
  return {
    type: 'object',
    properties: {
      pillar: { type: 'string', enum: slugs },
      tweets: {
        type: 'array',
        items: { type: 'string', description: 'The exact text of one tweet, 280 chars or fewer' },
      },
    },
    required: ['pillar', 'tweets'],
    additionalProperties: false,
  } as const;
}

// Strict-mode structured outputs guarantee the shape, but a truncated body
// (max_output_tokens) must degrade to null, never to a malformed thread. A
// pillar outside `allowedSlugs` is an error (null) — with the enum in place
// only a hand-crafted/garbled body can produce one. `overLong` is computed, not
// rejected here: the route decides the one-retry vs 502.
export function parseThreadDraft(
  raw: string,
  allowedSlugs: string[] = DEFAULT_PILLAR_SLUGS,
): ThreadDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  const rawTweets = obj.tweets;
  // A thread is ≥2 tweets (calendar's own floor); fewer is not a thread.
  if (!Array.isArray(rawTweets) || rawTweets.length < 2) return null;
  const tweets: string[] = [];
  for (const t of rawTweets) {
    if (typeof t !== 'string') return null;
    const trimmed = t.trim();
    if (trimmed === '') return null;
    tweets.push(trimmed);
  }

  if (typeof obj.pillar !== 'string' || !allowedSlugs.includes(obj.pillar)) return null;
  const pillar = obj.pillar;

  const overLong = tweets.map((t, i) => (t.length > 280 ? i + 1 : 0)).filter((n) => n > 0);
  return { pillar, tweets, overLong };
}

const PILLARS_PLACEHOLDER = '{{PILLARS}}';
const FEW_SHOT_PLACEHOLDER = '{{FEW_SHOT}}';
const IDEA_PLACEHOLDER = '{{IDEA}}';
const MAX_WINNERS = 5;

export interface BuildThreadDraftOptions {
  winners: WinnerPost[];
  /** Active pillars rendered into the PILLARS block. Defaults to the seed set. */
  pillars?: PillarDef[];
  /** Active niche's §1 grounding body. Defaults to DEFAULT_NICHE.persona. */
  persona?: string;
  /** Active niche's §5 beliefs body. Defaults to DEFAULT_NICHE.beliefs. */
  beliefs?: string;
  /** A user-named pillar to serve — folded into the steer (no separate token). */
  pillar?: PostPillar;
  /** Optional steer (Romanian OK). */
  idea?: string;
  /** Clamped 3–8 target count, folded into the steer. */
  tweetCount?: number;
  /** Gated Playbook guidance line (C4), appended at the variable tail. */
  guidance?: string;
  /** Rendered Me / My Profile block (M1, ME.3), appended at the variable tail. */
  meContext?: string;
  /** Registry-loaded prompt body (AI.3): the DB override when one exists, else
   *  the shipped default. Defaults to THREAD_PROMPT_TEMPLATE. */
  template?: string;
}

export function buildThreadDraftInput(opts: BuildThreadDraftOptions): GrokMessage[] {
  const pillars = opts.pillars && opts.pillars.length > 0 ? opts.pillars : DEFAULT_PILLARS;
  // split/join (not replace) so '$' in user content can't trigger
  // String.prototype.replace's special replacement patterns. Persona/beliefs
  // first so later user-content substitutions can't inject an expandable token.
  let content = (opts.template ?? THREAD_PROMPT_TEMPLATE)
    .split(PERSONA_PLACEHOLDER)
    .join(opts.persona ?? DEFAULT_NICHE.persona);
  content = content.split(BELIEFS_PLACEHOLDER).join(opts.beliefs ?? DEFAULT_NICHE.beliefs);
  content = content.split(PILLARS_PLACEHOLDER).join(renderPillars(pillars));
  content = content.split(FEW_SHOT_PLACEHOLDER).join(renderFewShot(opts.winners));
  content = content.split(IDEA_PLACEHOLDER).join(renderSteer(opts));
  if (opts.meContext && opts.meContext.trim() !== '') {
    content = `${content}\n\n${opts.meContext}`;
  }
  if (opts.guidance && opts.guidance.trim() !== '') {
    content = `${content}\n\n${opts.guidance}`;
  }
  return [{ role: 'user', content }];
}

// A user-named pillar, an explicit tweet count, and the free steer all ride the
// single {{IDEA}} block (the thread prompt keeps only three required tail
// placeholders — no separate {{PILLAR}} token like the post prompt).
function renderSteer(opts: BuildThreadDraftOptions): string {
  const parts: string[] = [];
  if (opts.pillar) parts.push(`Serve the "${opts.pillar}" content pillar.`);
  if (typeof opts.tweetCount === 'number') parts.push(`Write exactly ${opts.tweetCount} tweets.`);
  const idea = opts.idea?.trim();
  if (idea) parts.push(idea);
  return parts.join('\n');
}

function renderFewShot(winners: WinnerPost[]): string {
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
