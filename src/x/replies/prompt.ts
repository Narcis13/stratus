// Reply prompt + context renderer for /x/replies/generate.
//
// REPLY_PROMPT_TEMPLATE is the verbatim `reply prompt.md` from the repo root,
// embedded here so it ships with the code (the service deploys without the .md).
// The single `{{TWEET_CONTEXT}}` token is replaced at render time with the post
// context the endpoint receives in the body. When you edit the prose, change
// `reply prompt.md` and this literal together so the two stay in sync.

import type { GrokMessage } from '../../grok/index.ts';

// Band verdict + the exact classifier inputs, frozen at capture time by the
// extension (replyBand.ts). Optional: older extension builds don't send it.
// Never rendered into the prompt — it exists so every draft persisted via
// contextSnapshot is a labeled row for recalibrating BAND from own outcomes
// (OVERHAUL-PLAN §6.2, evals/analyze-own-replies.ts).
export interface PostSignals {
  band: 'hot' | 'warm' | 'skip' | null;
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
}

const CONTEXT_PLACEHOLDER = '{{TWEET_CONTEXT}}';
const IDEA_PLACEHOLDER = '{{IDEA}}';
const MAX_TOP_COMMENTS = 10;

export const REPLY_PROMPT_TEMPLATE = `## The job

You are replying to an X post. Write a reply that makes a stranger scrolling past stop, read it, and tap my profile. Replies are my single biggest growth lever on X — a sharp reply under a bigger account puts me in front of their audience for free.

The profile visit must be **earned by curiosity** — never ask for a follow or a profile visit. A literal "check my profile" or "follow me" reads as slop and kills the click it begs for. Only when my steer explicitly asks for a call to action may you include one, and even then keep it soft and specific.

---

## Who I am (the COMPLETE persona — infer nothing beyond these three facts)

- I'm a **solopreneur**.
- I'm **passionate about programming, AI, and marketing**.
- I **build in public**.

That is the entire biography you have. Never invent or imply anything else — no age, no location, no day job, no family, no client stories, no career arc. You can voice opinions and stances as mine, in first person. You cannot invent autobiographical facts — no "I shipped X in 14 days", no "my clients", no made-up numbers. If the steer gives a fact, use it; otherwise stay at the level of stance and observation. A fabricated "37%" or a fake anecdote is worse than no specific at all.

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

## The two variants

Produce **exactly two genuinely different variants**, each from a different angle — not two paraphrases. Pick the two angles that earn the most attention for this specific post:

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

Return JSON of the shape \`{"replies": [{"text": "…", "angle": "…"}, {"text": "…", "angle": "…"}]}\` — exactly two variants, each tagged with its angle (\`extends\`, \`contrarian\`, or \`debate\`). Each \`text\` is ONLY the raw reply text, exactly as it should appear on X — real newlines between propositions, no surrounding quotes, no backticks, no markdown, no commentary.

**My optional steer** comes in the \`<idea>\` tag after the post. If it has content, that's the seed — build both variants around it, in English (the idea may be in Romanian; translate the intent, don't translate word-for-word). If it's empty, you decide the angles from the post and the rules above.

**The post I'm replying to** (author, body, and top replies extracted below):

{{TWEET_CONTEXT}}

**My optional steer:**

<idea>{{IDEA}}</idea>`;

// Grok structured-outputs schema for the two-variant reply (OVERHAUL-PLAN
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
    out.push({ text: v.text.trim(), angle });
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

export function buildGrokInput(ctx: PostContext, override?: string, idea?: string): GrokMessage[] {
  const template = override && override.trim().length > 0 ? override : REPLY_PROMPT_TEMPLATE;
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
  return [{ role: 'user', content }];
}

// Renders the body context into the spot `{{TWEET_CONTEXT}}` marks: the post's
// author, body, engagement, and up to MAX_TOP_COMMENTS top replies.
function renderContext(ctx: PostContext): string {
  const handle = stripAt(ctx.handle);
  const relative = relativeTime(ctx.postedAt);
  const m = ctx.metrics;
  const lines: string[] = [
    'ORIGINAL TWEET',
    `@${handle} (${ctx.author}, ${relative}):`,
    ctx.text,
    '',
    'ENGAGEMENT',
    `likes=${m.likes} reposts=${m.reposts} replies=${m.replies} views=${m.views}`,
  ];

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
