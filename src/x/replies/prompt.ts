// Reply prompt + context renderer for /x/replies/generate.
//
// REPLY_PROMPT_TEMPLATE is the verbatim `reply prompt.md` from the repo root,
// embedded here so it ships with the code (the service deploys without the .md).
// The single `{{TWEET_CONTEXT}}` token is replaced at render time with the post
// context the endpoint receives in the body. When you edit the prose, change
// `reply prompt.md` and this literal together so the two stay in sync.

import type { GrokMessage } from '../../grok/index.ts';
import type { Band } from '../../shared/replyBand.ts';
import { DEFAULT_NICHE } from '../niche/defaults.ts';
import { RELATIONSHIP_INSTRUCTION } from '../people/relationship.ts';
import { type PillarDef, renderPillars } from '../posts/pillars.ts';

// Band verdict + the exact classifier inputs, frozen at capture time by the
// extension (src/shared/replyBand.ts). Optional in the request: older
// extension builds don't send it, and the band gate stamps a server-derived
// one when absent (§7.3). Never rendered into the prompt — it exists so every
// draft persisted via contextSnapshot is a labeled row for recalibrating BAND
// from own outcomes (OVERHAUL-PLAN §6.2, evals/analyze-own-replies.ts).
export interface PostSignals {
  band: Band;
  views: number;
  replies: number;
  ageMin: number;
  vpm: number;
  bait: boolean;
}

export interface PostContext {
  url: string;
  tweetId: string;
  author: string;
  handle: string;
  text: string;
  postedAt: string;
  metrics: { views: number; replies: number; reposts: number; likes: number };
  topComments: { author: string; handle: string; text: string }[];
  signals?: PostSignals;
  /** Thread context (§7.5 mention inbox): my post the target tweet replies to. */
  parent?: { text: string };
  /** Rendered {{RELATIONSHIP}} block (CIRCLES-PLAN C3). Server-stamped from the
   *  people layer — parseContext never accepts it from the client. Persisted
   *  via contextSnapshot so outcome analysis can compare relationship-aware
   *  drafts against cold ones (feeds C4). */
  relationship?: string;
  /** Gated Playbook guidance line (CIRCLES-PLAN C4, topAngles). Server-stamped
   *  only, same discipline as `relationship`; persisted via contextSnapshot so
   *  guided drafts stay distinguishable from unguided ones. */
  guidance?: string;
  /** Active niche at draft time (N0.4). Server-stamped — parseContext never
   *  accepts it from the client; persisted via contextSnapshot as the key for
   *  future per-niche outcome analytics. */
  niche?: { slug: string };
}

const CONTEXT_PLACEHOLDER = '{{TWEET_CONTEXT}}';
const IDEA_PLACEHOLDER = '{{IDEA}}';
// N0.4: the "Who I am" body comes from the active niche. Constant per niche, so
// it substitutes IN PLACE (not at the variable tail) — the prefix stays byte-
// stable across calls and xAI prefix caching survives; the route's cache key
// carries slug+updatedAt to bust on niche edits.
export const REPLY_PERSONA_PLACEHOLDER = '{{REPLY_PERSONA}}';
const MAX_TOP_COMMENTS = 10;

export const REPLY_PROMPT_TEMPLATE = `## The job

You are replying to an X post. Write a reply that makes a stranger scrolling past stop, read it, and tap my profile. Replies are my single biggest growth lever on X — a sharp reply under a bigger account puts me in front of their audience for free.

The profile visit must be **earned by curiosity** — never ask for a follow or a profile visit. A literal "check my profile" or "follow me" reads as slop and kills the click it begs for. Only when my steer explicitly asks for a call to action may you include one, and even then keep it soft and specific.

---

## Who I am (the COMPLETE persona — infer nothing beyond these three facts)

{{REPLY_PERSONA}}

---

## How the replies sound

1. **Plain spoken English.** Write it the way a builder says it out loud. Contractions (I'm, isn't, don't, here's). A sentence fragment when it lands.
2. **Short sentences. Hard claims.** State it; don't qualify it to death. Take a side — balanced both-sides prose reads like a model covering itself.
3. **First person singular** — I, my. No rhetorical "we".
4. **Punchy over polished.** A blunt one-liner beats a smooth paragraph. Leave a rough edge in.
5. **Specific beats generic.** A number from the post, a named tool, a concrete scenario — specificity is what makes a stranger curious enough to click. But every specific must come from the post itself, common knowledge, or my steer — never invented.
6. **Zero emoji. No hashtags. No links. No @mention of the author** (I'm replying in-thread, they're tagged already).

**Forbidden openers:** "Great post!", "Thanks for sharing", "Hot take:", "Unpopular opinion:", "Exactly", "True, but", "Sounds like", "Agreed", "This.", "So true", "Love this", "Great point", "100%", "Couldn't agree more", "Same here", "Well said", "Spot on". Opening with agreement is the #1 dead-reply pattern — 42% of a failed reference account's replies started that way. Open with the claim, the number, or the scene instead.

**Forbidden words/phrases (LLM-isms):** dive deep, let's unpack, unlock, supercharge, elevate your, in today's fast-paced world, game-changer, revolutionary, disruptive, transform, seamless, holistic, robust, "it's not just X, it's Y", at the end of the day, synergy, and moralizing closers ("the future is now", "we're all in this together").

---

## The three variants

Produce **exactly three genuinely different variants — one per angle** (extends, contrarian, and debate each appear exactly once), not three paraphrases. Each angle earns attention a different way:

- **extends** — push the post's idea further. The next step, the sharper consequence, the part the author left unsaid. Make the author want to reply back.
- **contrarian** — lightly controversial. Disagree with a sharp, defensible claim and give the reason. Not "well actually" — a real counter-position. Heat, not hate.
- **debate** — dividing. Reframe the post so people in the replies have to pick a side. Tension, not aggression.

Lean spicy: a reply that splits the room earns more profile taps than one everyone nods at. Never agreement-bait. Never "great post, so true."

**Hard rules for each variant:**

- **ONE punchy proposition is the default.** Add a second (own line, blank line between) only when the angle genuinely earns it — two flabby lines lose to one sharp one every time.
- The first line is the hook and must stand alone. The reader sees that line first; it has to land before they read anything else.
- Length: tight. This is a reply, not a thread. Usually under ~280 chars per variant unless the angle genuinely needs more.
- Fit the actual context of the post. If a top reply already made my point, find a different angle.
- Ship-ready. Final reply text, nothing to polish.

---

## Output

Return JSON of the shape \`{"replies": [{"text": "…", "angle": "…"}, {"text": "…", "angle": "…"}, {"text": "…", "angle": "…"}]}\` — exactly three variants, one per angle (\`extends\`, \`contrarian\`, and \`debate\` each appear once). Each \`text\` is ONLY the raw reply text, exactly as it should appear on X — real newlines between propositions, no surrounding quotes, no backticks, no markdown, no commentary.

**My optional steer** comes in the \`<idea>\` tag after the post. If it has content, that's the seed — build all three variants around it, in English (the idea may be in Romanian; translate the intent, don't translate word-for-word). If it's empty, you decide the angles from the post and the rules above.

**The post I'm replying to** (author, body, and top replies extracted below):

{{TWEET_CONTEXT}}

**My optional steer:**

<idea>{{IDEA}}</idea>`;

// Grok structured-outputs schema for the three-variant reply (OVERHAUL-PLAN
// §7.1). Passed via askGrok's jsonSchema option (`text.format` on the
// Responses API); the prompt's Output section states the same shape in prose.
export const REPLY_ANGLES = ['extends', 'contrarian', 'debate'] as const;
export type ReplyAngle = (typeof REPLY_ANGLES)[number];

export interface ReplyVariant {
  text: string;
  angle: ReplyAngle;
}

export const REPLY_VARIANTS_SCHEMA = {
  type: 'object',
  properties: {
    replies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Raw reply text exactly as it appears on X' },
          angle: { type: 'string', enum: [...REPLY_ANGLES] },
        },
        required: ['text', 'angle'],
        additionalProperties: false,
      },
    },
  },
  required: ['replies'],
  additionalProperties: false,
} as const;

// X reply formatting: a reply with more than one proposition reads better with
// a blank line between each. The model is inconsistent — it returns multiple
// sentences on a single line as often as it uses a lone \n where a blank line
// was asked for. So we do it deterministically: first break each sentence onto
// its own line (a run of .!? followed by whitespace and a new-sentence start),
// then normalize every newline run between non-empty lines to exactly one blank
// line and strip stray blanks / per-line trailing space. A single-proposition
// reply is left untouched. Applied to every generated reply (Reply Master +
// Radar batch) so what gets stored and copied to the clipboard is ship-ready.
//
// Guards against false splits: a decimal ("3.5") has no space after the dot so
// never matches; an ellipsis ("Hmm... ") is a run of ≥2 dots and is kept whole
// (it signals continuation, not a sentence end).
export function blankLineBetweenPropositions(text: string): string {
  const withBreaks = text.replace(/([.!?]+)\s+(?=["'(@#]?[A-Z0-9])/g, (m, punct: string) =>
    /^\.{2,}$/.test(punct) ? m : `${punct}\n`,
  );
  return withBreaks
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n\n');
}

// Strict-mode structured outputs guarantee the shape, but the parse still
// lives behind a validator: a truncated body (max_output_tokens) or a future
// non-strict call must degrade to null, never to a malformed draft row.
export function parseReplyVariants(raw: string): ReplyVariant[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const replies = (parsed as Record<string, unknown>).replies;
  if (!Array.isArray(replies) || replies.length === 0) return null;

  const out: ReplyVariant[] = [];
  for (const r of replies) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    const v = r as Record<string, unknown>;
    if (typeof v.text !== 'string' || v.text.trim() === '') return null;
    const angle = (REPLY_ANGLES as readonly string[]).includes(v.angle as string)
      ? (v.angle as ReplyAngle)
      : 'extends';
    out.push({ text: blankLineBetweenPropositions(v.text), angle });
  }
  return out;
}

// The eval-validated specificity gate (OVERHAUL-PLAN §7.1): a reply that has
// no digit, no first-person marker, and no named tool reads like it could've
// been written by anyone — the route regenerates once when every variant
// fails this.
const DIGIT_RE = /\d/;
// \b splits at the apostrophe, so /\bi\b/ also covers I'm/I've/I'd/I'll.
const FIRST_PERSON_RE = /\b(i|my|me|mine|we|our)\b/i;
const NAMED_TOOL_RE =
  /\b(claude code|claude|grok|copilot|cursor|mcp|turbo pascal|foxpro|delphi|dos|bun|typescript|postgres|anaf|excel|git|github|linux|vim|sql)\b/i;

export function passesSpecificityGate(text: string): boolean {
  return DIGIT_RE.test(text) || FIRST_PERSON_RE.test(text) || NAMED_TOOL_RE.test(text);
}

// ------------------------------------------------------ batch (Radar §7.2)
//
// The Radar drafts replies for a whole queue of hot/warm tweets in ONE Grok
// call. It reuses the reply-master VOICE/persona verbatim (sliced out of
// REPLY_PROMPT_TEMPLATE so the two can never drift) but swaps the job and the
// output: three variants (one per angle) per tweet, each block anchored to its
// tweetId — the same 3-variant shape the single-reply path returns (RU.3), so a
// radar draft carries the full angle set the on-page chips paste from.

const VOICE_BLOCK_START = '## Who I am';
const VOICE_BLOCK_END = '## The three variants';

export interface BatchTweet {
  tweetId: string;
  handle: string;
  author: string;
  text: string;
  url?: string;
  /** Rendered relationship brief (C3), ≤2 lines/person — server-stamped. */
  relationship?: string;
}

export interface BatchReply {
  tweetId: string;
  variants: ReplyVariant[];
}

// The persona + "How the replies sound" + forbidden lists, lifted verbatim
// from the single-reply template so any edit to the master voice propagates
// here without a second copy to maintain.
function sharedVoiceBlock(): string {
  const start = REPLY_PROMPT_TEMPLATE.indexOf(VOICE_BLOCK_START);
  const end = REPLY_PROMPT_TEMPLATE.indexOf(VOICE_BLOCK_END);
  if (start === -1 || end === -1) return REPLY_PROMPT_TEMPLATE;
  return REPLY_PROMPT_TEMPLATE.slice(start, end).trimEnd();
}

// Everything before the variable tail (the posts + idea). Kept as a stable
// cacheable prefix — same prompt-cache discipline as the single-reply path.
function batchReplyHead(): string {
  return `## The job

You are replying to a batch of X posts. For EACH post below, write ONE sharp reply that makes a stranger scrolling past stop, read it, and tap my profile. Replies are my single biggest growth lever on X — a sharp reply under a bigger account puts me in front of their audience for free.

The profile visit must be **earned by curiosity** — never ask for a follow or a profile visit. A literal "check my profile" or "follow me" reads as slop and kills the click it begs for. Only when my steer explicitly asks for a call to action may you include one, and even then keep it soft and specific.

---

${sharedVoiceBlock()}

---

## The three variants for each post

For EACH post, produce **exactly three variants — one per angle** (extends, contrarian, and debate each appear exactly once), anchored to that post's \`id\`. Three genuinely different takes, not restatements of one. Lean spicy: a reply that splits the room earns more profile taps than one everyone nods at.

- **extends** — push the post's idea further: the next step, the sharper consequence, the part the author left unsaid.
- **contrarian** — lightly controversial. Disagree with a sharp, defensible claim and give the reason. Heat, not hate.
- **debate** — dividing. Reframe so people in the replies have to pick a side. Tension, not aggression.

**Hard rules for each variant:**

- **ONE punchy proposition is the default.** The first line is the hook and must stand alone.
- Length: tight — usually under ~280 chars. This is a reply, not a thread.
- Specific beats generic, but every specific must come from that post, common knowledge, or my steer — never invented.
- Fit the actual context of each post. Each variant stands on its own post; never bleed one post's topic into another.
- Ship-ready. Final reply text, nothing to polish.

---

## Output

Return JSON of the shape \`{"replies": [{"id": "<post id>", "variants": [{"text": "…", "angle": "…"}, {"text": "…", "angle": "…"}, {"text": "…", "angle": "…"}]}, …]}\` — exactly one object per post, the \`id\` copied verbatim from the post it answers, and exactly three variants inside it (\`angle\` one of \`extends\`, \`contrarian\`, \`debate\`, each appearing once). Each \`text\` is ONLY the raw reply text, exactly as it should appear on X — real newlines between propositions, no surrounding quotes, no backticks, no markdown, no commentary. Include every post; never merge two posts into one object.

**My optional steer** comes in the \`<idea>\` tag. If it has content, let it shape the angle of every reply, in English (it may be in Romanian; translate the intent). If empty, you decide each angle from the post and the rules above.`;
}

function renderBatchTweet(t: BatchTweet, i: number): string {
  const lines = [
    `POST ${i + 1} (id: ${t.tweetId})`,
    `@${stripAt(t.handle)} (${t.author}):`,
    t.text,
  ];
  if (t.relationship && t.relationship.trim() !== '') lines.push(t.relationship);
  return lines.join('\n');
}

// C3: the per-post RELATIONSHIP lines carry the facts; the how-to-use-them
// instruction rides ONCE per batch, in the variable tail (never the static
// head — the cacheable prefix must not change with who's in the queue).
const BATCH_RELATIONSHIP_NOTE = `Some posts above carry a RELATIONSHIP line — my real prior history with that author. ${RELATIONSHIP_INSTRUCTION}`;

// Builds the single user message: stable instruction head, then the posts and
// the optional steer at the very end (cacheable-prefix layout).
export function buildBatchGrokInput(
  tweets: BatchTweet[],
  idea?: string,
  override?: string,
  pillars?: PillarDef[],
  guidance?: string,
  opts?: { replyPersona?: string },
): GrokMessage[] {
  // The voice block sliced into batchReplyHead() carries {{REPLY_PERSONA}}
  // (N0.4) — substitute here so single and batch ground on the same niche.
  const head = substituteReplyPersona(
    override && override.trim().length > 0 ? override : batchReplyHead(),
    opts?.replyPersona,
  );
  const rendered = tweets.map((t, i) => renderBatchTweet(t, i)).join('\n\n');
  const ideaText = idea?.trim() ?? '';
  let content = `${head}\n\n**The posts I'm replying to:**\n\n${rendered}`;
  if (tweets.some((t) => t.relationship && t.relationship.trim() !== '')) {
    content += `\n\n${BATCH_RELATIONSHIP_NOTE}`;
  }
  content += `\n\n**My optional steer:**\n\n<idea>${ideaText}</idea>`;
  if (pillars && pillars.length > 0) content += `\n\n${renderReplyPillarsBlock(pillars)}`;
  // C4: gated Playbook guidance rides once per batch, at the variable tail.
  if (guidance && guidance.trim() !== '') content += `\n\n${guidance}`;
  return [{ role: 'user', content }];
}

// §8.6 opt-in: appended to the reply prompt only when the user enables "apply
// pillars to replies" (default off). Render-time append — the reply prompt
// template / reply prompt.md stay untouched (their byte-sync test is unaffected).
function renderReplyPillarsBlock(pillars: PillarDef[]): string {
  return `## Content pillars to honor (optional)\nWhere it fits naturally, align this reply's stance with ONE of my content pillars below. Never force it — a reply that fits none is fine.\n\n${renderPillars(pillars)}`;
}

export const BATCH_REPLY_SCHEMA = {
  type: 'object',
  properties: {
    replies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The post id these variants answer, copied verbatim' },
          variants: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'Raw reply text exactly as it appears on X' },
                angle: { type: 'string', enum: [...REPLY_ANGLES] },
              },
              required: ['text', 'angle'],
              additionalProperties: false,
            },
          },
        },
        required: ['id', 'variants'],
        additionalProperties: false,
      },
    },
  },
  required: ['replies'],
  additionalProperties: false,
} as const;

// Mirrors parseReplyVariants: strict-mode guarantees the shape, but a truncated
// body (maxOutputTokens) or a future non-strict call must degrade to null, not
// to a malformed row. Maps the wire field `id` to `tweetId` and collects the
// per-post variants array (≥1 required; blank-line-normalized; a bad angle
// coerced to 'extends'). An empty replies array is a valid (if useless) batch.
export function parseBatchReplies(raw: string): BatchReply[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const replies = (parsed as Record<string, unknown>).replies;
  if (!Array.isArray(replies)) return null;

  const out: BatchReply[] = [];
  for (const r of replies) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    const v = r as Record<string, unknown>;
    const id = typeof v.id === 'string' ? v.id.trim() : '';
    if (id === '') return null;
    if (!Array.isArray(v.variants) || v.variants.length === 0) return null;
    const variants: ReplyVariant[] = [];
    for (const rawVariant of v.variants) {
      if (!rawVariant || typeof rawVariant !== 'object' || Array.isArray(rawVariant)) return null;
      const vv = rawVariant as Record<string, unknown>;
      if (typeof vv.text !== 'string' || vv.text.trim() === '') return null;
      const angle = (REPLY_ANGLES as readonly string[]).includes(vv.angle as string)
        ? (vv.angle as ReplyAngle)
        : 'extends';
      variants.push({ text: blankLineBetweenPropositions(vv.text), angle });
    }
    out.push({ tweetId: id, variants });
  }
  return out;
}

// N0.4: the persona substitutes FIRST — before the tweet context and idea land —
// so client-supplied content can never inject an expandable {{REPLY_PERSONA}}
// token. A template without the token (custom overrides predating it) passes
// through untouched, the same tolerance the {{IDEA}} path extends.
function substituteReplyPersona(template: string, replyPersona?: string): string {
  if (!template.includes(REPLY_PERSONA_PLACEHOLDER)) return template;
  return template.split(REPLY_PERSONA_PLACEHOLDER).join(replyPersona ?? DEFAULT_NICHE.replyPersona);
}

export function buildGrokInput(
  ctx: PostContext,
  override?: string,
  idea?: string,
  pillars?: PillarDef[],
  opts?: { replyPersona?: string },
): GrokMessage[] {
  const template = substituteReplyPersona(
    override && override.trim().length > 0 ? override : REPLY_PROMPT_TEMPLATE,
    opts?.replyPersona,
  );
  const context = renderContext(ctx);
  // split/join (not replace) so a '$' in the context can't trigger
  // String.prototype.replace's special replacement patterns.
  let content = template.includes(CONTEXT_PLACEHOLDER)
    ? template.split(CONTEXT_PLACEHOLDER).join(context)
    : `${template}\n\n${context}`;
  const ideaText = idea?.trim() ?? '';
  if (content.includes(IDEA_PLACEHOLDER)) {
    content = content.split(IDEA_PLACEHOLDER).join(ideaText);
  } else if (ideaText !== '') {
    // Custom overrides may predate the {{IDEA}} token — still honor the steer.
    content = `${content}\n\n<idea>${ideaText}</idea>`;
  }
  // C3: relationship block at the variable tail — the template (and its
  // byte-sync test against reply prompt.md) stays untouched.
  if (ctx.relationship && ctx.relationship.trim() !== '') {
    content = `${content}\n\n${ctx.relationship}`;
  }
  if (pillars && pillars.length > 0) {
    content = `${content}\n\n${renderReplyPillarsBlock(pillars)}`;
  }
  // C4: gated Playbook guidance, same variable-tail pattern.
  if (ctx.guidance && ctx.guidance.trim() !== '') {
    content = `${content}\n\n${ctx.guidance}`;
  }
  return [{ role: 'user', content }];
}

// Renders the body context into the spot `{{TWEET_CONTEXT}}` marks: the post's
// author, body, engagement, and up to MAX_TOP_COMMENTS top replies.
function renderContext(ctx: PostContext): string {
  const handle = stripAt(ctx.handle);
  const relative = relativeTime(ctx.postedAt);
  const m = ctx.metrics;
  const lines: string[] = [];

  // Mention-inbox drafts (§7.5): the tweet below is a reply to MY post — give
  // Grok the thread so the reply lands in context instead of cold.
  if (ctx.parent) {
    lines.push('MY POST (the tweet below is a reply to it)', ctx.parent.text, '');
  }

  lines.push(
    'ORIGINAL TWEET',
    `@${handle} (${ctx.author}, ${relative}):`,
    ctx.text,
    '',
    'ENGAGEMENT',
    `likes=${m.likes} reposts=${m.reposts} replies=${m.replies} views=${m.views}`,
  );

  if (ctx.topComments.length > 0) {
    const limited = ctx.topComments.slice(0, MAX_TOP_COMMENTS);
    lines.push('', `TOP REPLIES (oldest first, up to ${MAX_TOP_COMMENTS})`);
    limited.forEach((c, i) => {
      lines.push(`${i + 1}. @${stripAt(c.handle)}: ${c.text}`);
    });
  }

  return lines.join('\n');
}

function stripAt(handle: string): string {
  return handle.replace(/^@/, '');
}

function relativeTime(postedAt: string): string {
  const t = new Date(postedAt).getTime();
  if (Number.isNaN(t)) return 'unknown time ago';
  const diffMs = Date.now() - t;
  if (diffMs < 60_000) return 'just now';
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return `${Math.floor(day / 30)}mo ago`;
}
