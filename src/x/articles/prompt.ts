// Article assist prompt + renderer for POST /x/articles/:id/assist (A3.12, the
// Writer). ARTICLE_PROMPT_TEMPLATE is the verbatim `article prompt.md` from the
// repo root, embedded here so it ships with the code (the service deploys
// without the .md). Same convention as posts/replies/thread: edit the prose in
// `article prompt.md` AND this literal together — a bun:test asserts they stay
// byte-identical. All per-call content sits at the very end so the instruction
// block is a stable, cacheable prefix for xAI prefix caching.
//
// PURE module by construction: `prompts/registry.ts` imports
// ARTICLE_PROMPT_TEMPLATE as the `article` key's default (the D5 registry move),
// so this file must never import a route or the registry (that would cycle — the
// RL.4 rule). The persona is hardcoded here rather than niche-substituted (the
// plan's tail lists only PILLARS/WINNERS/GUIDANCE/ARTICLE/INSTRUCTION, the DM
// precedent) so the whole prefix is byte-static and prompt.cacheKey alone buckets
// it — no niche suffix needed (D124).

import type { GrokMessage } from '../../grok/index.ts';
import { DEFAULT_PILLARS, type PillarDef, renderPillars } from '../posts/pillars.ts';
import type { WinnerPost } from '../posts/prompt.ts';

export const ARTICLE_PROMPT_TEMPLATE = `## The job

You help me write **long-form articles** for X — the kind X publishes as a standalone piece with its own headline and byline, not a 280-character post. An article earns a reader's time in the first paragraph or loses it. Your job is to draft, outline, section, or polish exactly what the current request asks for, in my voice, grounded only in what I actually know.

You work in one of four modes, named in the request at the very end. Read all four so you understand the shape of the whole piece before you write your part.

---

## Who I write as (grounding — use these for specificity, NEVER invent biography)

- 51 years old. Live in **Pitesti, Romania.**
- Day job: **IT administrator at a public hospital**, 08:00–15:00, Mon–Fri. Personal projects run after 15:00 and on weekends — about 2–4h a day.
- Trained as an **economist** (ASE Bucuresti, Faculty of Management). Spent **10 years running the hospital's accounting office** before IT.
- **30 years of coding** — a serious hobby since the 386 era. The arc: 386 with 4MB RAM, Turbo Pascal, DOS 3.1, FoxPro, Delphi 3, and today AI coding agents like Claude Code, skills, and MCP servers. Four years ago a simple CRUD took me days; now I ship quality code fast.
- Building **Alteramens** — a lab that turns ideas into products, one shipped every 30 days. Goal: solopreneur income, **5K MRR**, then leave the hospital job.
- **My wife is an independent accountant** with about 20 small-business clients — ANAF reports, Excel reconciliations, invoices, bank statements. I help with the books, so I see real business problems daily, from both sides.
- **My son David** is prepping for the UMF (med-school) admission exam.
- I'm Romanian. **I think in Romanian and publish in English.** My English is plain and direct, not flowery — that's a feature, not a gap.

My unfair angle: economist plus 30-year dev plus 51 in a junior-dominated AI space, with access to two laboratories nobody on tech Twitter sees — a Romanian public hospital and about 20 SMB accounting clients. I'm not an "AI expert." I'm a practitioner who writes code and ships.

These facts are the ONLY biography you may use. Never invent or imply anything else — no client stories I didn't give you, no made-up timelines, no fabricated numbers. If the request supplies a fact, use it; otherwise stay inside this list. A fabricated "37%" or a fake anecdote is worse than no specific at all.

---

## How an article of mine reads (craft rules — every draft passes these)

1. **The first paragraph is the whole game.** X shows it as the preview — it has to make a stranger stop and open the piece. Open on a concrete scene, a hard claim, or a specific number. No throat-clearing, no "in this article I will".
2. **Scannable structure.** Break the body into short H2 sections (\`## Heading\`) a reader can skim. One idea per section. A section can be three sentences.
3. **Short paragraphs.** Two to four sentences each. White space is a feature, not a waste.
4. **Concrete over abstract.** Name the tool, the year, the number — a 386, a 30-day cadence, 5K MRR. But only real ones, from the grounding, the request, or common knowledge. Never invent a statistic to sound authoritative.
5. **My voice, not AI fluency.** Contractions. Plain words over Latinate ones — use not utilize, buy not purchase, enough not sufficient. Vary the rhythm; take a side; leave a little roughness. Smooth, hedged, both-sides prose is the AI-slop tell — cross that line and the only thing that can't be copied, me being me, is gone.
6. **No emoji. British-clean formatting.** Plain Markdown — headings, bold, lists, links where they belong. No decorative punctuation, no hashtag stuffing, no moralizing closer that restates the piece.

---

## Language

The idea, instruction, heading, selection, and even the current draft below may be written in **any language** — I often think in Romanian. Your output is **ALWAYS natural English**. In polish and full-draft modes, translate any non-English source material into clean English rather than preserving its language. Never announce that you translated; just write the English.

---

## The four modes

- **outline** — Propose the skeleton of a new article from an idea: a title, a one-line subtitle, and an ordered list of sections, each with a heading and a few beats (the points that section will make). No prose yet — beats, not paragraphs.
- **section** — Draft the finished prose for one section, given its heading and any beats or notes I supply. Return only that section's body as Markdown — no article title, no restating the heading as an H2 unless the notes ask for sub-structure.
- **polish** — Return a tighter, sharper version of a passage I selected: same meaning, my voice, no new claims, no invented facts. If the passage is not in English, translate it as you polish.
- **full** — Write the complete article end to end from an idea: a title, a one-line subtitle, and the full body as Markdown with scannable H2 sections.

## Output

Return **only** the JSON the mode requires — no commentary, no code fences:

- outline: \`{"title": "...", "subtitle": "...", "sections": [{"heading": "...", "beats": ["...", "..."]}]}\`
- section: \`{"markdown": "..."}\`
- polish: \`{"markdown": "..."}\`
- full: \`{"title": "...", "subtitle": "...", "markdown": "..."}\`

Markdown fields carry real newlines and standard Markdown (\`##\` headings, \`**bold**\`, lists, links) — never wrapped in quotes or fenced.

---

**PILLARS** (the active content pillars — if a piece declares one, use only these slugs):

{{PILLARS}}

**MY PROVEN POSTS** (measured winners off my own feed — match this voice and energy, never copy them):

{{WINNERS}}

**PLAYBOOK GUIDANCE** (what has measurably worked for me; may be empty):

{{GUIDANCE}}

**THE ARTICLE SO FAR** (current title, subtitle, outline, and body — any field may be partial or empty):

{{ARTICLE}}

**WHAT TO DO NOW:**

{{INSTRUCTION}}`;

export const ARTICLE_ASSIST_MODES = ['outline', 'section', 'polish', 'full'] as const;
export type ArticleAssistMode = (typeof ARTICLE_ASSIST_MODES)[number];

export function isArticleAssistMode(v: unknown): v is ArticleAssistMode {
  return typeof v === 'string' && (ARTICLE_ASSIST_MODES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------- schemas

// Grok/OpenRouter structured-output schemas (strict mode: additionalProperties
// false, every property in `required`; the model returns an empty string for a
// field it has nothing for rather than omitting it).
const OUTLINE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'A headline for the article' },
    subtitle: { type: 'string', description: 'A one-line subtitle (may be empty)' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          beats: { type: 'array', items: { type: 'string' } },
        },
        required: ['heading', 'beats'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'subtitle', 'sections'],
  additionalProperties: false,
} as const;

const MARKDOWN_SCHEMA = {
  type: 'object',
  properties: {
    markdown: { type: 'string', description: 'The drafted Markdown, real newlines, no code fence' },
  },
  required: ['markdown'],
  additionalProperties: false,
} as const;

const FULL_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    subtitle: { type: 'string', description: 'A one-line subtitle (may be empty)' },
    markdown: { type: 'string', description: 'The full article body as Markdown' },
  },
  required: ['title', 'subtitle', 'markdown'],
  additionalProperties: false,
} as const;

export const ASSIST_SCHEMAS: Record<ArticleAssistMode, Record<string, unknown>> = {
  outline: OUTLINE_SCHEMA,
  section: MARKDOWN_SCHEMA,
  polish: MARKDOWN_SCHEMA,
  full: FULL_SCHEMA,
};

export interface OutlineSection {
  heading: string;
  beats: string[];
}
export interface OutlineProposal {
  title: string;
  subtitle: string;
  sections: OutlineSection[];
}
export interface MarkdownProposal {
  markdown: string;
}
export interface FullProposal {
  title: string;
  subtitle: string;
  markdown: string;
}
export type AssistProposal = OutlineProposal | MarkdownProposal | FullProposal;

/** Parse a structured-output reply per mode. Strict mode guarantees the shape,
 *  but a truncated body (maxOutputTokens) must degrade to null, never to a
 *  half-formed proposal — the parsePostDrafts discipline. */
export function parseAssist(mode: ArticleAssistMode, raw: string): AssistProposal | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const v = parsed as Record<string, unknown>;

  if (mode === 'outline') {
    if (typeof v.title !== 'string' || typeof v.subtitle !== 'string') return null;
    if (!Array.isArray(v.sections)) return null;
    const sections: OutlineSection[] = [];
    for (const s of v.sections) {
      if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
      const sec = s as Record<string, unknown>;
      if (typeof sec.heading !== 'string' || sec.heading.trim() === '') return null;
      if (!Array.isArray(sec.beats)) return null;
      const beats = sec.beats.filter((b): b is string => typeof b === 'string');
      sections.push({ heading: sec.heading.trim(), beats });
    }
    if (sections.length === 0) return null;
    return { title: v.title.trim(), subtitle: v.subtitle.trim(), sections };
  }

  if (mode === 'full') {
    if (typeof v.title !== 'string' || typeof v.subtitle !== 'string') return null;
    if (typeof v.markdown !== 'string' || v.markdown.trim() === '') return null;
    return { title: v.title.trim(), subtitle: v.subtitle.trim(), markdown: v.markdown.trim() };
  }

  // section | polish
  if (typeof v.markdown !== 'string' || v.markdown.trim() === '') return null;
  return { markdown: v.markdown.trim() };
}

// ---------------------------------------------------------------- render

// The current article body is clipped when huge so a long piece can't blow the
// context budget; the model still sees the opening (which sets voice) and the
// ending (where a section slots in).
export const MAX_ARTICLE_BODY_IN_PROMPT = 6000;

export interface ArticleState {
  title: string;
  subtitle: string | null;
  outline: unknown;
  bodyMd: string;
}

export function renderArticleState(a: ArticleState): string {
  const parts: string[] = [`Title: ${a.title}`, `Subtitle: ${a.subtitle ?? '(none)'}`];
  if (a.outline != null) parts.push(`Outline (JSON):\n${JSON.stringify(a.outline)}`);
  const body = a.bodyMd ?? '';
  if (body.trim() === '') {
    parts.push('Body: (empty — nothing drafted yet)');
  } else if (body.length <= MAX_ARTICLE_BODY_IN_PROMPT) {
    parts.push(`Body:\n${body}`);
  } else {
    const half = Math.floor(MAX_ARTICLE_BODY_IN_PROMPT / 2);
    const head = body.slice(0, half);
    const tail = body.slice(body.length - half);
    parts.push(
      `Body (clipped — the opening and the ending):\n${head}\n\n…[middle omitted]…\n\n${tail}`,
    );
  }
  return parts.join('\n\n');
}

function renderWinners(winners: WinnerPost[]): string {
  if (winners.length === 0) return '(no measured winners yet)';
  return winners
    .slice(0, 5)
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

/** Compose the WHAT-TO-DO-NOW instruction from the mode + the present inputs.
 *  Lives at the variable tail, so any language in idea/heading/selection never
 *  shifts the cacheable prefix (the language contract sits in the prefix). */
function composeInstruction(mode: ArticleAssistMode, ctx: ArticleAssistContext): string {
  const parts: string[] = [];
  const idea = ctx.idea?.trim() || null;
  const heading = ctx.heading?.trim() || null;
  const selection = ctx.selection?.trim() || null;
  switch (mode) {
    case 'outline':
      parts.push(
        'Run OUTLINE mode. Produce a fresh structured outline — a title, a one-line subtitle, and an ordered list of sections, each with a heading and a few beats.',
      );
      if (idea) parts.push(`Idea / topic:\n${idea}`);
      break;
    case 'section':
      parts.push(
        'Run SECTION mode. Draft the finished prose for ONE section as Markdown — no article title, just the section body.',
      );
      if (heading) parts.push(`Section heading:\n${heading}`);
      if (selection)
        parts.push(
          `Beats or notes to cover (may be in another language — write the section in English):\n${selection}`,
        );
      if (idea) parts.push(`Extra steer:\n${idea}`);
      break;
    case 'polish':
      parts.push(
        'Run POLISH mode. Return a tightened, sharper version of the passage below as Markdown — same meaning, my voice, no new claims. Translate to English if it is not already.',
      );
      if (selection) parts.push(`Passage to polish:\n${selection}`);
      if (idea) parts.push(`How to polish it:\n${idea}`);
      break;
    case 'full':
      parts.push(
        'Run FULL mode. Write the complete article end to end — a title, a one-line subtitle, and the full body as Markdown with scannable H2 sections.',
      );
      if (idea) parts.push(`Idea / topic:\n${idea}`);
      break;
  }
  return parts.join('\n\n');
}

export interface ArticleAssistContext {
  pillars: PillarDef[];
  winners: WinnerPost[];
  guidance: string | null;
  article: ArticleState;
  idea: string | null;
  heading: string | null;
  selection: string | null;
}

const PILLARS_PLACEHOLDER = '{{PILLARS}}';
const WINNERS_PLACEHOLDER = '{{WINNERS}}';
const GUIDANCE_PLACEHOLDER = '{{GUIDANCE}}';
const ARTICLE_PLACEHOLDER = '{{ARTICLE}}';
const INSTRUCTION_PLACEHOLDER = '{{INSTRUCTION}}';

// `template` is the registry-loaded body (DB override or the default above). The
// five tail values substitute token-tolerantly via split/join (not replace, so a
// '$' in user content can't trigger replacement patterns). The prefix stays
// byte-identical across calls — the language clause lives in it, not the tail.
export function buildArticleAssistInput(
  mode: ArticleAssistMode,
  ctx: ArticleAssistContext,
  template: string = ARTICLE_PROMPT_TEMPLATE,
): GrokMessage[] {
  const pillars = ctx.pillars.length > 0 ? ctx.pillars : DEFAULT_PILLARS;
  const guidance = ctx.guidance?.trim() ? ctx.guidance.trim() : '(none yet)';

  let content = template.split(PILLARS_PLACEHOLDER).join(renderPillars(pillars));
  content = content.split(WINNERS_PLACEHOLDER).join(renderWinners(ctx.winners));
  content = content.split(GUIDANCE_PLACEHOLDER).join(guidance);
  content = content.split(ARTICLE_PLACEHOLDER).join(renderArticleState(ctx.article));
  content = content.split(INSTRUCTION_PLACEHOLDER).join(composeInstruction(mode, ctx));
  return [{ role: 'user', content }];
}
