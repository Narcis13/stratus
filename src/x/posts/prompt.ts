// Post drafter prompt + renderer for POST /x/posts/draft (§8.1).
//
// POST_PROMPT_TEMPLATE is the verbatim `post prompt.md` from the repo root,
// embedded here so it ships with the code (the service deploys without the
// .md). Same convention as replies/prompt.ts: when you edit the prose, change
// `post prompt.md` and this literal together (a bun:test asserts they stay
// byte-identical). Placeholders are replaced at render time; all per-call
// content sits at the very end so the instruction block stays a stable,
// cacheable prefix for xAI prefix caching. {{PERSONA}}/{{BELIEFS}} (§1/§5,
// N0.3) are the exception: constant per niche, substituted in place.

import type { GrokMessage } from '../../grok/index.ts';
import { DEFAULT_NICHE } from '../niche/defaults.ts';
import {
  DEFAULT_PILLARS,
  DEFAULT_PILLAR_SLUGS,
  NO_PILLAR,
  type PillarDef,
  renderPillars,
} from './pillars.ts';

export const POST_PROMPT_TEMPLATE = `## The job

You are drafting **original posts** for my X feed. Originals carry ~60x the engagement of a reply per unit — this is the 30%-originals side of my 70/30 doctrine. Each post must make a stranger scrolling past stop, read it, and want to tap my profile.

The profile visit must be **earned by curiosity** — never ask for a follow or a profile visit. A literal "follow me" reads as slop and kills the click it begs for. Only when my steer explicitly asks for a call to action may you include one, and even then keep it soft and specific.

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

**Off-pillar batches.** When the PILLARS block says the batch is off-pillar (my steer's \`<pillar>\` is then \`none\`), the taxonomy does not apply: write what the steer — or, with no steer, my actual life and work in §1/§6 — calls for, and declare \`none\` as the pillar on all three drafts. Off-pillar means off the taxonomy, never off-voice: every rule in §0–§3 and §7 still holds.

---

## 5. What I believe (take these positions — don't fence-sit, don't contradict them)

{{BELIEFS}}

---

## 6. Concrete details to reach for (the specificity palette)

- **Tech arc:** 386 with 4MB RAM, Turbo Pascal, DOS 3.1, FoxPro, Delphi 3 → Claude Code, AI agents, skills, MCP.
- **Career:** ASE economist; 10 years running the hospital accounting office; now IT admin; 08:00–15:00; Pitești.
- **The two laboratories:** public-hospital bureaucracy (procurement forms, 20 years inside the system); ~20 SMB accounting clients via my wife (ANAF reports, Excel reconciliations, invoices, bank statements).
- **Constraints as material:** 4h/day after the day job; building at 51; cutting distractions to protect focus.
- **Stakes:** 5K MRR → leave the hospital; ship-or-die 30-day cadence; an AI tutor I'm building for my son's med-school exam.

Use these as texture, not a checklist. One vivid, specific scene beats a paragraph of abstraction.

---

## 7. What to avoid (anti-AI-slop — zero tolerance)

**Forbidden openers:** "Great post!", "Here's a thread on…", "Hot take:", "Unpopular opinion:", "Just a quick thought…", "Random thought…", "Something I've been thinking about…".

**Forbidden words/phrases (LLM-isms):** dive deep, let's dive in, let's unpack, unlock, supercharge, turbocharge, elevate your, in today's fast-paced world, game-changer, revolutionary, disruptive, transform, seamless, holistic, robust, scalable (when imprecise), leverage as a verb (the noun is fine — it's my word), "it's not just X, it's Y", at the end of the day, when push comes to shove, synergy, and moralizing closers ("remember, anyone can do it!", "the future is now", "we're all in this together").

**Other tells to kill:** no-contraction stiffness, perfectly even sentence length, three-item lists everywhere, "Firstly/Secondly/Finally" scaffolding, em-dash-balanced both-sides framing, tidy summary closers that restate what was just said.

**Positioning anti-patterns:** never rebrand me as "AI specialist / AI expert / productivity guru". No hype, no hustle-porn, no fake vulnerability, no engagement-bait. Output-first: the brand is built from what I ship, not from titles.

---

## 8. The three registers (one draft each)

- **plain** — clear, direct, zero ornament. Hook = fact → insight. State the thing and land it.
- **spicy** — punchy and opinion-forward: contrarian hook, high confidence, short hard lines, zero hedging. Hook = challenge → evidence. Pick the side most of my timeline would argue with, then back it with something I actually lived.
- **bait** — engineered to be *answered*, not admired. Built on exactly one of the proven engagement formats in §9, it ends in a real question or a forced pick that costs a stranger one second to answer. Hook = provocation → the ask. Only ask what I'd answer myself, in public — a real question is not the engagement-bait §7 forbids.

---

## 9. X mechanics

- **First 7 words carry the hook.** No meta-preamble. The hook must stand alone.
- Single post: **~180–260 chars**. This is a post, not a thread — one claim, landed.
- **No external link in the post text.** Links go in the first reply (handled outside this draft).
- Max 0–1 hashtag, only if load-bearing. No emoji as punctuation.
- Hook patterns to rotate: stat hook ("{surprising number}. Here's what it changes:"), story hook ("Last week I killed a SaaS idea after 14 days."), constraint flex ("I build 4h/day. Here's what I cut."), flashback ("My first computer: 386, 4MB RAM. Today {contrast}."), field note ("20 years in a Romanian public hospital. {observation}.").

**Proven engagement formats** — measured on a comparable builder account: posts engineered to be *answered* beat posts engineered to be *admired*, roughly 2x the views. Each one invites a reply, never a follow — the no-begging rule at the top still holds.

- **Would-you-rather** — two concrete stakes, one forced pick, no third option. Money against time, safety against upside. The two sides have to be close enough that people argue about it.
- **Poll-list** — a short question, then 3–4 options as dashed lines, one per line, the last one self-deprecating. One second to read, one word to answer.
- **Confessional question** — "be honest — …?": the thing people only admit in a reply. Only ask what I'd answer myself, in public.
- **Audience CTA** — "show me the thing you're working on, I'll respond to every one" (X = whatever my audience actually makes). Use it only when I'm ready to reply to every single answer; a promise I don't keep costs more than the post earns.

The **bait** draft (§8) is built on exactly one of these — pick the format the topic fits, and rotate the pick across batches instead of defaulting to the same one. The plain and spicy drafts never use them. The skeleton is the borrowed part: fill it with my own material (§1/§6), the steer, or common knowledge, never with invented specifics. This is not the engagement-bait §7 forbids — no "like if you agree", no reply-for-reply trading, no question wrapped around a brag. A real question I actually want answered is not bait.

---

## 10. Remixing a tweet (only when a **Structure to remix** block is provided below)

That block is somebody else's tweet — the one I liked enough to save. It is **inspiration, never source material**. What I want back is a post a reader would place next to it as an obvious sibling in *shape*, and that shares nothing else with it.

- **Borrow the machinery only:** hook shape, the order the beats arrive in, line-break rhythm, sentence-length pattern, overall length, the closing device. If the block also lists an extracted template (hook / skeleton / line breaks / length / device), that list names the same machinery — follow it.
- **Take nothing off the surface:** not its words, phrases, claims, numbers, names, examples — and not its topic. If a phrase of the original survives into my draft, the draft is wrong.
- **The subject stays mine.** My steer, or my §1/§6 material. A remix that ends up being about the original's topic is a copy with the words swapped.
- **Loose, not traced.** Matching the skeleton beat-for-beat and word-count-for-word-count reads as a knockoff. Same shape, my rhythm.
- **The test:** if the original author read my post, they should recognise the shape and not a single sentence.
- The remix binds *structure* only. §0–§3 and §7 (voice, anti-slop) outrank it, and all three registers of §8 still ship — where the borrowed shape fights a register (a poll-list skeleton on the plain draft, say), the register wins and the structure bends.

---

## The three drafts

Produce **exactly three genuinely different drafts** — one per register (§8): plain, spicy, bait. Not three paraphrases: three different takes on the topic.

- Each draft declares the pillar it serves. If my steer names a pillar, all three serve that pillar (the registers still differ). In an off-pillar batch (§4) all three declare \`none\`.
- Every specific must come from §1/§6, the steer, or common knowledge — never invented.
- If a structure to remix is provided below, work it the way §10 says: its skeleton (hook shape, beat order, line-break rhythm, length, closing device) applied to MY topic, with none of its words, claims, specifics or subject carried over.
- Ship-ready. Final post text I could publish as-is.

## Output

Return JSON of the shape {"posts": [{"text": "…", "register": "…", "pillar": "…"}]} — exactly three posts; register one of plain / spicy / bait (one each); pillar one of the slugs listed under PILLARS — \`none\` in an off-pillar batch. Each text is ONLY the raw post text, exactly as it should appear on X — real newlines, no surrounding quotes, no markdown, no commentary.

**PILLARS** (the active content pillars — each post's \`pillar\` must be one of these slugs):

{{PILLARS}}

**My proven posts** (measured winners off my own feed — match this voice and energy, never copy them):

{{MY_WINNERS}}

**Structure to remix** (§10 — shape to borrow loosely, never material to reuse; empty means none):

{{REMIX}}

**My steer** (optional; may be in Romanian — translate the intent, write the posts in English):

<pillar>{{PILLAR}}</pillar>
<idea>{{IDEA}}</idea>`;

// Pillars are dynamic now (DB-backed `content_pillars`, §8.6) — the slug is an
// arbitrary string declared by the active set, not a closed union.
export type PostPillar = string;

// The three registers the drafter writes one draft each in. 'reflective' was
// retired 2026-08-23 for 'bait' — the answer-me formats (§9) measured ~2x the
// views of admire-me posts, so the third slot is now always one of them.
// Historical rows keep register='reflective'; the Playbook reads the column as
// free text, so old cells still aggregate.
export const POST_REGISTERS = ['plain', 'spicy', 'bait'] as const;
export type PostRegister = (typeof POST_REGISTERS)[number];

export interface PostDraftVariant {
  text: string;
  register: PostRegister;
  pillar: PostPillar;
}

// Grok structured-outputs schema for the three register-distinct drafts — built
// per-call so the `pillar` enum reflects the live slug set. Passed via askGrok's
// jsonSchema option, same shape the prompt states in prose.
export function buildPostDraftsSchema(slugs: string[] = DEFAULT_PILLAR_SLUGS) {
  return {
    type: 'object',
    properties: {
      posts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Raw post text exactly as it appears on X' },
            register: { type: 'string', enum: [...POST_REGISTERS] },
            pillar: { type: 'string', enum: slugs },
          },
          required: ['text', 'register', 'pillar'],
          additionalProperties: false,
        },
      },
    },
    required: ['posts'],
    additionalProperties: false,
  } as const;
}

// Strict-mode structured outputs guarantee the shape, but a truncated body
// (max_output_tokens) must degrade to null, never to malformed draft rows.
// `allowedSlugs` defaults to the seed set so existing callers/tests keep working;
// an unknown pillar falls back to the first allowed slug.
export function parsePostDrafts(
  raw: string,
  allowedSlugs: string[] = DEFAULT_PILLAR_SLUGS,
): PostDraftVariant[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const posts = (parsed as Record<string, unknown>).posts;
  if (!Array.isArray(posts) || posts.length === 0) return null;

  const fallbackPillar = allowedSlugs[0] ?? DEFAULT_PILLAR_SLUGS[0] ?? 'ai-craft';
  const out: PostDraftVariant[] = [];
  for (const p of posts) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    const v = p as Record<string, unknown>;
    if (typeof v.text !== 'string' || v.text.trim() === '') return null;
    const register = (POST_REGISTERS as readonly string[]).includes(v.register as string)
      ? (v.register as PostRegister)
      : 'plain';
    const pillar = allowedSlugs.includes(v.pillar as string)
      ? (v.pillar as string)
      : fallbackPillar;
    out.push({ text: v.text.trim(), register, pillar });
  }
  return out;
}

/** A measured own post injected as a few-shot voice anchor ("this worked,
 *  sound like this") — grounded in metrics_snapshots, not taste. */
export interface WinnerPost {
  text: string;
  views: number | null;
  profileVisits: number | null;
}

/** Structure skeleton of a saved swipe-file tweet (§8.3). `rawText` carries the
 *  tweet itself — the Composer's *Tweet remix* box, or the saved row's text —
 *  and rides along even when the template columns ARE extracted: the extracted
 *  fields say what shape to borrow, the tweet says what that shape sounds like
 *  in the wild. §10 of the prompt is what keeps the second one loose (shape
 *  borrowed, words/claims/topic never). */
export interface RemixSource {
  hookType: string | null;
  skeleton: string | null;
  lineBreakPattern: string | null;
  templateLength: string | null;
  device: string | null;
  rawText: string | null;
}

// Niche identity (N0.3): §1/§5 bodies substitute IN PLACE, not at the variable
// tail — persona/beliefs are constant per niche, so the substituted prefix stays
// byte-stable across calls and the cache prefix survives. The call site's
// promptCacheKey carries the niche slug + updatedAt to bust cleanly on edits.
export const PERSONA_PLACEHOLDER = '{{PERSONA}}';
export const BELIEFS_PLACEHOLDER = '{{BELIEFS}}';
const PILLARS_PLACEHOLDER = '{{PILLARS}}';
const WINNERS_PLACEHOLDER = '{{MY_WINNERS}}';
const REMIX_PLACEHOLDER = '{{REMIX}}';
const PILLAR_PLACEHOLDER = '{{PILLAR}}';
const IDEA_PLACEHOLDER = '{{IDEA}}';
const MAX_WINNERS = 5;

export interface BuildPostDraftOptions {
  winners: WinnerPost[];
  remix?: RemixSource | null;
  pillar?: PostPillar;
  idea?: string;
  /** Active pillars rendered into the PILLARS block. Defaults to the seed set
   *  so the prompt is never pillar-less even on a fresh/empty DB. */
  pillars?: PillarDef[];
  /** Gated Playbook guidance line (CIRCLES-PLAN C4, topStructures). Appended
   *  at the variable tail — the template / post prompt.md byte-sync test is
   *  untouched, same pattern as the reply prompt's relationship block. */
  guidance?: string;
  /** Active niche's §1 grounding body. Defaults to DEFAULT_NICHE.persona so the
   *  prompt is never persona-less (fresh DB / niche-layer failure). */
  persona?: string;
  /** Active niche's §5 beliefs body. Defaults to DEFAULT_NICHE.beliefs. */
  beliefs?: string;
  /** Rendered Me / My Profile block (M1, ME.3), server-loaded via
   *  loadMeContextSafe('post'). Appended at the variable tail before `guidance`
   *  — POST_PROMPT_TEMPLATE / post prompt.md stay byte-identical, same pattern
   *  as guidance. Empty/absent → no change to the rendered prompt. */
  meContext?: string;
  /** Registry-loaded prompt body (AI.3): the DB override when one exists, else
   *  the shipped default. Defaults to POST_PROMPT_TEMPLATE so existing callers
   *  and tests are untouched. */
  template?: string;
  /** Off-pillar batch (the Composer's default "No pillar"): the PILLARS block
   *  becomes the off-pillar instruction instead of the taxonomy and the steer's
   *  <pillar> renders as `none`, so all three drafts declare `none` (§4).
   *  `pillar` is ignored when this is set. */
  offPillar?: boolean;
}

/** What the PILLARS block says when the batch is deliberately off-pillar — the
 *  template's §4 keys off it, and the structured-output enum is [NO_PILLAR]. */
export const OFF_PILLAR_BLOCK = `(off-pillar batch — the content-pillar taxonomy does NOT apply to these drafts. Do not serve any pillar and do not mention the taxonomy; write what my steer asks for, or, with no steer, what my life and work in §1/§6 make me the one person who can say it. Declare \`${NO_PILLAR}\` as the \`pillar\` on all three drafts.)`;

export function buildPostDraftInput(opts: BuildPostDraftOptions): GrokMessage[] {
  // split/join (not replace) so '$' in user content can't trigger
  // String.prototype.replace's special replacement patterns.
  const pillars = opts.pillars && opts.pillars.length > 0 ? opts.pillars : DEFAULT_PILLARS;
  // Persona/beliefs go first so later user-content substitutions (idea, steer)
  // can never inject an expandable {{PERSONA}}/{{BELIEFS}} token.
  let content = (opts.template ?? POST_PROMPT_TEMPLATE)
    .split(PERSONA_PLACEHOLDER)
    .join(opts.persona ?? DEFAULT_NICHE.persona);
  content = content.split(BELIEFS_PLACEHOLDER).join(opts.beliefs ?? DEFAULT_NICHE.beliefs);
  content = content
    .split(PILLARS_PLACEHOLDER)
    .join(opts.offPillar ? OFF_PILLAR_BLOCK : renderPillars(pillars));
  content = content.split(WINNERS_PLACEHOLDER).join(renderWinners(opts.winners));
  content = content.split(REMIX_PLACEHOLDER).join(renderRemix(opts.remix ?? null));
  content = content
    .split(PILLAR_PLACEHOLDER)
    .join(opts.offPillar ? NO_PILLAR : (opts.pillar ?? ''));
  content = content.split(IDEA_PLACEHOLDER).join(opts.idea?.trim() ?? '');
  // M1 (ME.3): the dynamic personal-context block rides the variable tail,
  // before guidance — same additive pattern, empty → no change.
  if (opts.meContext && opts.meContext.trim() !== '') {
    content = `${content}\n\n${opts.meContext}`;
  }
  if (opts.guidance && opts.guidance.trim() !== '') {
    content = `${content}\n\n${opts.guidance}`;
  }
  return [{ role: 'user', content }];
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

function renderRemix(remix: RemixSource | null): string {
  if (!remix) return '(none)';
  const fields = [
    remix.hookType ? `hook: ${remix.hookType}` : null,
    remix.skeleton ? `skeleton: ${remix.skeleton}` : null,
    remix.lineBreakPattern ? `line breaks: ${remix.lineBreakPattern}` : null,
    remix.templateLength ? `length: ${remix.templateLength}` : null,
    remix.device ? `device: ${remix.device}` : null,
  ].filter(Boolean);
  const parts: string[] = [];
  if (fields.length > 0) {
    parts.push(`Extracted template — the machinery to borrow:\n${fields.join('\n')}`);
  }
  // The tweet ships alongside the extracted fields, not instead of them: a
  // skeleton line says "stat hook → consequence", the tweet says what that
  // sounds like. §10 is the leash — shape borrowed, surface never.
  if (remix.rawText) {
    const lead =
      fields.length > 0
        ? 'The tweet that template came from — LOOSE inspiration only (§10)'
        : 'No pre-extracted template — derive the machinery yourself (hook shape, beat order, line-break rhythm, length, closing device) from this tweet, LOOSE inspiration only (§10)';
    parts.push(
      `${lead}: keep its shape, take none of its words, claims, specifics or topic:\n${remix.rawText}`,
    );
  }
  return parts.length > 0 ? parts.join('\n\n') : '(none)';
}
