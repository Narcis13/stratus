// Radar curation core (RC.1) — grade a reply queue before spending on drafts.
//
// The Radar's one paid drafting click batches whatever ranked first, which
// after a long scroll session means the newest 20 of a 40+ row queue: filler
// ("drop a link, let's connect") included. This module is the cheap read that
// goes in front of it — one text-only scoring call grades every fresh tweet for
// reply payoff, flags the filler as `lowValue`, and hands back a keep/drop
// partition the panel acts on.
//
// PURE, deliberately: no db, no settings store, no route imports (the prompt
// registry imports the template from here, and a back-import cycles — RL.4).
// The score is measurement metadata, never a gate (§7.19): `classifyBand`
// already owns the numbers, and the score never reaches the drafting prompt.
//
// RC.8 turned the rubric around and gave the pass a second output.
//
// The rubric first: it used to reward a post that "sits in or near my lane" and
// punish one "far outside my lane, so any reply I write comes out generic". That
// second clause was TRUE — it described the drafter's weakness accurately — and
// it is why this pass was dropping exactly what pays. The 182 replies harvested
// 2026-08-06→07 put 96.5% of the day's reply impressions under off-lane posts
// (229 views/reply against 27 on-lane). RC.1–RC.7 fixed the drafter; this file
// is the second half, and it scores ONE question now — is there a concrete hook
// a reply can grab — regardless of topic. Decision 6: flipped AFTER the drafter,
// never before, or the queue fills with posts the drafter still cannot answer.
//
// Then the free rider: the pass reads every post carefully enough to grade it,
// so it also names the ROOM (`ReplyModeId`) on a call already paid for. That is
// the second rung of `resolveReplyMode`'s precedence — above the roster pin,
// because it read this post rather than knowing only the account — and it is $0
// by construction. The mode here is a HINT: unrecognized or missing degrades to
// `null` (§7.11), and the resolver falls through to the pin, then detection.

import type { GrokMessage } from '../../grok/index.ts';
import { REPLY_MODES, type ReplyModeId, resolveModeId } from '../../shared/replyMode.ts';
import {
  type BatchTweet,
  UNTRUSTED_CONTEXT_MARKER,
  renderBatchTweet,
  substituteReplyPersona,
} from './prompt.ts';

/** The radar ring-buffer cap — the panel can never hold more than this. */
export const MAX_CURATE_TWEETS = 100;

/** A reason longer than this is display metadata run amok; clipped, not rejected. */
export const MAX_REASON_LENGTH = 120;

const POSTS_PLACEHOLDER = '{{POSTS}}';

export interface CurateScore {
  tweetId: string;
  /** Reply payoff, integer 0–100 (clamped on the way in). */
  score: number;
  /** Filler that is not worth a reply at any score — dropped from the queue. */
  lowValue: boolean;
  /** RC.8: the room this post is in, per the scorer that just read it. `null`
   *  for a missing or unrecognized answer — a HINT into `resolveReplyMode`'s
   *  second rung, never a verdict, so unknown falls through to the roster pin
   *  and then to detection (§7.11) instead of drafting in a guessed register. */
  mode: ReplyModeId | null;
  /** One short sentence naming what decided the score. Never rendered in v1. */
  reason: string;
}

export interface CurateSelection {
  /** Ids to draft, best first — the tail is the weakest, so trimming trims worst. */
  keep: string[];
  /** Ids to dismiss: every `lowValue` post plus everything past the cut. */
  drop: string[];
  /** Asked-for ids the model never scored (a truncated response) — left alone. */
  unscored: string[];
}

// Structure mirrors REPLY_BATCH_PROMPT_TEMPLATE: stable instruction head (job,
// persona, rubric, the lowValue category list), variable {{POSTS}} at the tail,
// so the cacheable prefix does not change with who is in the queue.
export const CURATE_PROMPT_TEMPLATE = `## The job

I am about to spend one paid drafting call on a queue of X posts, and I can only afford to reply under the best of them. Grade every post below for **reply payoff**: if I write one sharp reply under it, how likely is that reply to earn impressions and profile visits for me?

You are scoring, not writing. Never draft a reply, never rewrite a post, never explain the rubric back to me.

---

## Who I am — background, not the rubric

{{REPLY_PERSONA}}

**Most posts worth replying to have nothing to do with any of that.** My reach comes from replying under big, uncrowded posts about anything: football, relationships, animals, a news wire, someone's grandmother's funeral. Never score a post down for being off my lane, and never score one up for being on it. Topic is not a criterion here.

---

## What earns a high score

One question decides it: **is there a concrete hook a reply can grab?** A named thing, a number, a visible detail, a claim, a moment. Score the hook, whatever the post is about.

- The post makes a **concrete claim** I can extend, sharpen, or argue with — a number, a named thing, a decision, a lived detail.
- Something is genuinely **unsettled**, so a reply adds instead of agreeing.
- There is a **specific detail to notice** — a timestamp, an object in the frame, one line out of ten bullets. A reply that proves I actually looked needs something to look at.
- The room is **live**: people are arguing, joking, or feeling something, so a reply lands in a conversation instead of under a monument.

## What earns a low score

- Nothing to add to: a bare announcement, a link with no argument, a screenshot with no claim.
- The take is complete and uncontested — the only honest reply is a nod.
- **Unanswerable without making something up**: a personal announcement, a milestone, a memorial, where every honest reply is "congrats" or "sorry" and anything sharper would have to be invented. I have no facts to add and inventing them is the worst thing I can do.

## Low-value posts — flag these

Set \`lowValue\` to true for a post that is not worth a reply at any score, however big the account is:

- **Connection invites** — "drop a link", "let's connect", "comment your handle", "reply with what you're building", and every other collect-the-replies thread.
- **Follow trains and engagement pods** — follow-for-follow, "like and I'll follow back", boost-each-other chains.
- **Giveaways, airdrops, contests** — anything where the reply is an entry.
- **Engagement bait with no content** — "thoughts?", one-word polls, ragebait with nothing to argue against, "who else is up at 3am".
- **Pure announcements with nothing to add** — a raw changelog, a "we're live" carrying no argument, a repost with no comment.

A flagged post is removed from my queue outright, so use the flag for filler — not for a real post you merely rate low.

## How to score

Score each post 0–100 and use the whole range. Most posts in a real queue land between 20 and 70; 90+ means I would regret scrolling past it. Score the payoff **for me specifically**, not the post's general quality — a brilliant post I have nothing to add to scores low, and a small account asking a sharp open question can score high.

Give a \`reason\` of at most one short sentence (under 120 characters) naming the concrete thing that decided the score.

## Which room every post is in

You are already reading each post closely enough to grade it, so also name the **room** — the kind of conversation a reply would be landing in. It decides the register, the length and the angles of the reply I write later, and a wrong room is worse than an honest \`general\`:

- \`expertise\` — dev, AI, solo business, marketing, retro and vintage computing, hospital and enterprise IT, SMB accounting: my lane above.
- \`hot-take\` — opinion posts: relationships, masculinity, money, self-improvement, culture.
- \`news\` — a reported event: a wire story, a launch, a transfer, a headline, markets.
- \`wholesome\` — animals, kids, grief, wins, art, aesthetics, motivation.
- \`banter\` — football, memes, no-context posts, chaos.
- \`general\` — none of those fit, or you genuinely cannot tell.

Judge the room from the post itself, never from who posted it and never from the score you just gave it. A low-scoring post still has a room, and a \`lowValue\` one still gets a label.

---

## Output

Return JSON of the shape \`{"scores": [{"id": "<post id>", "score": 0, "lowValue": false, "mode": "general", "reason": "…"}, …]}\` — exactly one object per post, the \`id\` copied verbatim from the post it grades, \`score\` an integer from 0 to 100, \`lowValue\` a boolean, \`mode\` exactly one of the six room names above, \`reason\` one short sentence. Include every post; never merge two posts into one object and never invent an id.

**The posts to score:**

{{POSTS}}`;

/** The room vocabulary, derived from the one table that owns it — a mode added
 *  to `REPLY_MODES` is offerable here without a second edit, and the schema can
 *  never drift from what `resolveModeId` will accept back. */
const MODE_IDS: readonly ReplyModeId[] = REPLY_MODES.map((m) => m.id);

// No `minimum`/`maximum`/`minItems`/`maxItems` anywhere — strict structured
// outputs reject them (the JUDGE_SCHEMA lesson); the parser owns the range.
//
// RC.8: `mode` is an `enum` (variantItemSchema's `angle` is the precedent —
// enums ARE in the supported set) and it is REQUIRED, because strict mode has no
// optional properties. `general` is what the prompt asks for when the model
// cannot tell, so the vocabulary itself carries the "unknown" answer and nothing
// here needs a null.
export const CURATE_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The post id this row grades, copied verbatim' },
          score: { type: 'integer', description: 'Reply payoff for me, 0 to 100' },
          lowValue: {
            type: 'boolean',
            description: 'True for filler not worth a reply at any score',
          },
          mode: {
            type: 'string',
            enum: [...MODE_IDS],
            description: 'The room a reply to this post would land in',
          },
          reason: { type: 'string', description: 'One short sentence, under 120 characters' },
        },
        required: ['id', 'score', 'lowValue', 'mode', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['scores'],
  additionalProperties: false,
} as const;

// Builds the single user message: stable head, then the queue at the very end.
// The persona substitutes FIRST (substituteReplyPersona), before any scraped
// post text lands, so client-supplied content can never inject an expandable
// token — the same ordering buildBatchGrokInput uses.
export function buildCurateInput(
  tweets: BatchTweet[],
  opts?: { replyPersona?: string; template?: string },
): GrokMessage[] {
  const template = substituteReplyPersona(
    opts?.template ?? CURATE_PROMPT_TEMPLATE,
    opts?.replyPersona,
  );
  // Text only (decision 5): the queue is projected down to the four fields the
  // renderer needs, so a server-stamped RELATIONSHIP line can never ride into a
  // scoring call — the band numbers and the person context are already priced
  // in by the classifier that admitted the tweet.
  const rendered = tweets.map((t, i) =>
    renderBatchTweet({ tweetId: t.tweetId, handle: t.handle, author: t.author, text: t.text }, i),
  );
  // The trust label heads the posts block (JD.1) — once per call, inside the
  // {{POSTS}} value, so a custom template that keeps the token keeps the label.
  const posts = [UNTRUSTED_CONTEXT_MARKER, ...rendered].join('\n\n');
  // split/join (not replace) so a '$' in a post can't trigger
  // String.prototype.replace's special replacement patterns. A custom override
  // that dropped the token still gets the queue appended.
  const content = template.includes(POSTS_PLACEHOLDER)
    ? template.split(POSTS_PLACEHOLDER).join(posts)
    : `${template}\n\n**The posts to score:**\n\n${posts}`;
  return [{ role: 'user', content }];
}

// parseBatchReplies discipline: strict-mode guarantees the shape, but a
// truncated body (maxOutputTokens) must degrade to null — never to a malformed
// row, because a malformed row here silently dismisses a queue entry. Strict on
// the three fields selection reads (id / score / lowValue), lenient on `reason`
// (display metadata; refusing over it would throw away a billed call). An empty
// scores array is valid: everything asked for lands in `unscored`.
//
// RC.8 puts `mode` on the lenient side, and deliberately: it is a HINT with two
// rules of the resolver's precedence still underneath it, so a missing or
// invented room costs a rung, not a queue row — and failing a billed pass over a
// label would be the §7.35 asymmetry backwards. `resolveModeId` is what decides
// the value is real (aliases and `hot_take` fold onto the id; anything else is
// `null`), which is the same function the resolver will run on it later.
export function parseCurateScores(raw: string): CurateScore[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const scores = (parsed as Record<string, unknown>).scores;
  if (!Array.isArray(scores)) return null;

  const out: CurateScore[] = [];
  for (const row of scores) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const v = row as Record<string, unknown>;
    const id = typeof v.id === 'string' ? v.id.trim() : '';
    if (id === '') return null;
    // A fractional or non-numeric score is a shape failure, not something to
    // round: the schema asks for an integer, so a model that ignored it is not
    // a model whose keep/drop call should be trusted.
    if (typeof v.score !== 'number' || !Number.isInteger(v.score)) return null;
    if (typeof v.lowValue !== 'boolean') return null;
    const reason = typeof v.reason === 'string' ? v.reason.trim() : '';
    out.push({
      tweetId: id,
      score: Math.min(100, Math.max(0, v.score)),
      lowValue: v.lowValue,
      mode: typeof v.mode === 'string' ? (resolveModeId(v.mode)?.id ?? null) : null,
      reason: reason.slice(0, MAX_REASON_LENGTH),
    });
  }
  return out;
}

// Partitions the asked-for queue into draft / dismiss / leave-alone.
//
// Anchored to `wanted`, never to the response: a model that scored an id nobody
// asked about is ignored, and an id it never scored lands in `unscored` — a
// truncated response costs coverage, never queue rows (decision 6). Iterating
// `wanted` also makes the tie-break the panel's own ranked order, so the sort
// below is stable without depending on how the model ordered its array.
export function selectCurated(
  scored: CurateScore[],
  wanted: string[],
  keep: number,
): CurateSelection {
  const byId = new Map<string, CurateScore>();
  // First occurrence wins — a duplicated id must not flip its own verdict.
  for (const s of scored) if (!byId.has(s.tweetId)) byId.set(s.tweetId, s);

  const drop: string[] = [];
  const unscored: string[] = [];
  const ranked: { id: string; score: number; rank: number }[] = [];
  const seen = new Set<string>();
  wanted.forEach((id, rank) => {
    if (id === '' || seen.has(id)) return;
    seen.add(id);
    const s = byId.get(id);
    if (!s) {
      unscored.push(id);
      return;
    }
    // lowValue drops at any score — that is what the flag is for.
    if (s.lowValue) {
      drop.push(id);
      return;
    }
    ranked.push({ id, score: s.score, rank });
  });

  ranked.sort((a, b) => b.score - a.score || a.rank - b.rank);
  const limit = Math.max(0, Math.floor(keep));
  const kept = ranked.slice(0, limit);
  for (const r of ranked.slice(limit)) drop.push(r.id);
  return { keep: kept.map((r) => r.id), drop, unscored };
}
