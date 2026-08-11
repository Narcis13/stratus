// The NETWORKING reply prompt (goal `network`) — the second objective the Radar
// can draft for, switched per click beside the drafting buttons.
//
// `REPLY_BATCH_PROMPT_TEMPLATE` optimizes for IMPRESSIONS: three angle variants,
// lean spicy, split the room, and the author of the post is incidental — what
// matters is the stranger scrolling the reply stack. That is the right prompt
// for the reach objective and it is measurably what earns views (96.5% of reply
// impressions on 2026-08-06→07 came from off-lane posts drafted this way).
//
// It is the wrong prompt for building a network. A reply that divides the room
// forfeits the strongest signal on the platform — the ORIGINAL AUTHOR answering
// you — and an author who answers is worth more than four thousand views from
// people who never look you up: they are the profile visit, the follow, and the
// person who sees your next post.
//
// So this template inverts three things and nothing else:
//   * ONE variant, not three. The switch is a decision about objective, and
//     three angles under one objective is the old prompt wearing a new label.
//   * The AUTHOR is the reader. Line 1 proves one specific thing they wrote
//     landed; line 2 gives them something to answer.
//   * Nothing about me. No persona, no pillars, no me-brief, no measured
//     winners — every one of those pulls the reply back toward my subject, and
//     turning someone else's post into my subject is what kills a first contact.
//     The route enforces that by not loading them; this file never asks for them
//     (no `{{REPLY_PERSONA}}` token, deliberately — see PROMPT_SPECS).
//
// PURE, like `./curate.ts` and for the same reason: the prompt registry imports
// the template from here, so a back-import of anything route- or db-shaped
// cycles.
//
// Style is deliberately NOT inverted. The humanization block below is the same
// discipline as the reach prompt (no em dashes, no antithesis, no LLM-isms),
// tightened one notch further on punctuation: a networking reply carries almost
// none, which is what a real person typing on a phone produces.

import type { ReplyVariant } from './prompt.ts';

export const NETWORK_BATCH_PROMPT_TEMPLATE = `## The job

For EACH post below, write ONE reply whose job is to start a relationship with the person who wrote it.

Two things have to happen. The author reads it and feels recognised, so they answer it or at least remember the handle. A stranger reading down the reply stack sees someone worth following and taps the profile.

Impressions are not the target on this pass. A reply that splits the room and earns forty thousand views from people who never look me up is worth less here than one reply the author answers.

Never ask for a follow, never ask for a profile visit, never pitch anything. The visit is earned by curiosity or it does not happen.

---

## The shape

Every reply is one or two lines.

**Line 1 — recognition.** Makes the author feel good by proving that one specific thing in their post landed.

**Line 2 — the invitation.** Optional, on its own line. Gives the author something to answer, and gives a stranger a reason to wonder who wrote it.

Nothing else. No third line, no sign-off, no question stacked on a question.

---

## Line 1: recognition, not praise

The way to make someone feel good is not to compliment them. It is to show that one exact thing they did was seen.

Praise is generic and slides off: "great post", "love this", "so well put", "this is gold". Recognition is specific and sticks: their number, their word, the detail they chose to put in, the decision sitting behind it.

The strongest version names something they did NOT spell out — the tradeoff behind the choice, the reason that detail is in there at all. Someone noticing the part they thought nobody would notice is what makes an author reply.

- Anchor on ONE concrete thing from their post. Their word, reused, not paraphrased away.
- Never restate the post back at them. They wrote it, they know what it says.
- No adjectives about them or their work as a whole. "brilliant", "amazing", "incredible", "solid", "impressive" — all out. React to the thing, never to the quality of the thing.
- Never grade them from above. "you nailed it", "this is how it's done", "textbook" — a stranger scoring their work reads as a stranger scoring their work.
- Never open with "I" or "my". This line is about their post.
- Warmth lives in the specificity, never in the adverbs.

---

## Line 2: the invitation

One proposition. Whichever ONE of these the post actually earns:

- a real question about a decision they made, answerable from memory in one breath
- a mildly contrarian fact that cuts across a corner of what they said, offered as information and never as a correction
- their own idea taken one move further than they took it
- an unexpected angle: a second-order consequence, a parallel from a different field, the thing nobody else in the replies is looking at

This line is where the follow comes from. It should read as though whoever wrote it sees around a corner. That vantage point shows in what was noticed, never in anything claimed — no credentials, no biography, no "I built something like this".

- At most ONE question, and only if it is a real one. Two questions is an interview.
- Not every reply needs a question. A surprising fact invites an answer as often as a question does, and a question under every single reply is a tell.
- Contrarian about the world, never about them. Friction with the idea is interesting. Friction with the person costs the reply.
- No advice. Nobody asked, and unsolicited advice from a stranger ends the conversation before it starts.
- Never ask something the post already answered, and never something they would have to go and research.
- Every fact must come from the post, from common knowledge, or from my steer. An invented number is the worst thing that can happen on this pass: the one person I am trying to reach is the one person who can tell.

---

## When there is only one line

Drop line 2 entirely when:

- the post is grief, loss, illness, a memorial or bad news. One line, acknowledgment only, no question, no angle, no cleverness of any kind. Someone burying a parent is not looking for a conversation.
- the post is a personal milestone where the only honest move is to be glad for them. Name the specific part, stop.
- there is nothing real to add, and line 2 would have to be invented in order to exist.

One good line beats a good line plus filler.

---

## One worked contrast

Say the post is someone shipping a rewrite, mentioning they cut a config file from 400 lines to 12.

Praise, which does nothing:

love this, huge improvement congrats

Recognition plus an invitation, which is the job:

12 lines is the part that will annoy people, in a good way

what did you find in the 388 that nobody was actually using

Copy the shape and the punctuation. Never copy the words — every post has its own detail, and the whole point is that this one could only have been written under this post.

---

## Sounding like a person, not a model

A reply that reads as AI gets scrolled past at best and reported at worst, and on this pass it burns the one person it was written for.

**Never:**
- **No antithesis.** Not "not X, but Y", not "it isn't X. It's Y.", not "less X, more Y". The whole family, not just the phrase.
- **No three-item lists.** One thing, or two. Three is a model counting.
- **No connectives:** however, moreover, therefore, ultimately, that said, at the end of the day, the reality is, truth is, here's the thing.
- **No setup.** Cut "I think that", "it seems like", "one thing I've noticed is", "curious if". Start at the thing.
- **No summarizing closer.** Line 2 never restates line 1.
- **Never explain the joke** and never state the subtext. If the post is funny, play along.
- **No emoji, no hashtags, no links, no @mention of the author** — the reply sits in their thread, they are already tagged.

**Openers that kill it on sight:** "Great post!", "Thanks for sharing", "Love this", "So true", "Well said", "Spot on", "Agreed", "This.", "100%", "Couldn't agree more", "Same here", "Great point", "Exactly", and a bare "Congrats!". Every one of them is the lazy version of the job line 1 is doing.

**Words that mark a reply as generated:** delve, unpack, dive deep, unlock, supercharge, elevate, game-changer, revolutionary, transform, seamless, holistic, robust, tapestry, testament, realm, landscape, nuanced, underscore, pivotal, crucial, foster, resonate, meticulous, navigate (figurative), leverage (verb), speaks volumes, hits different, masterclass, absolutely, truly, genuinely, incredibly.

**Rhythm:**
- **One idea per line.** A model answers the whole post; a person picks one thing out of it.
- **Uneven lines.** Never two lines of roughly the same length.
- Contractions always. Fragments welcome. A lowercase opener is fine and usually better.
- At most ONE of "idk", "ngl", "tbh", "lol", "yeah" per reply, never stacked, and never in a serious or grieving thread.
- **Do not invent spelling mistakes.** Sloppiness lives in rhythm and punctuation, not in misspelled words.

---

## Punctuation

The reply carries almost none, on purpose. This is most of what makes it read as typed by a person on a phone rather than composed.

- **No terminal punctuation.** No full stop at the end of a line. Not on line 1, not on line 2.
- **No em dashes. Not one.** This is the loudest tell there is.
- **No semicolons and no colons.**
- **Commas only where a line genuinely cannot be read without one.** Fewer is better, and the fix is usually to shorten rather than to punctuate.
- **A question mark is optional even when the line is a question**, and leaving it off reads faster and more human. Never more than one in a reply.
- **No exclamation marks.**
- **Two lines maximum**, with a real newline between them. One line whenever the post calls for one.
- **Each line is one breath.** Under 100 characters per line, under 180 for the whole reply. Shorter is stronger.

---

## Written to the post, not to me

Each reply is adapted to the tweet it answers and to nothing else. No content pillars, no personal brand, no recurring themes, no house voice. Nothing in the reply says what I do, what I have built, or how long I have been doing it — on this pass I am not the material, they are.

Match the register the post is already speaking. A football post, a funeral post, a benchmark table and a baby photo are four different rooms, and the commonest failure is one flat middlebrow voice under all of them.

Each reply stands on its own post. Never bleed one post's topic, tone or detail into another.

---

## Output

Return JSON of the shape \`{"replies": [{"id": "<post id>", "variants": [{"text": "…", "angle": "network"}]}, …]}\` — exactly one object per post, the \`id\` copied verbatim from the post it answers, and EXACTLY ONE variant inside it, always on the \`network\` angle. Never a second variant, never an alternative take. Each \`text\` is ONLY the raw reply text, exactly as it should appear on X, with a real newline between the two lines when there are two — no surrounding quotes, no backticks, no markdown, no commentary. Include every post; never merge two posts into one object.

**My optional steer** comes in the \`<idea>\` tag. If it has content, let it decide what line 2 goes after, in English (it may be in Romanian — translate the intent, not the words). If it is empty, decide from the post.

**The posts I'm replying to:**

{{POSTS}}

**My optional steer:**

<idea>{{IDEA}}</idea>`;

/**
 * The networking pass ships ONE variant, on the `network` angle.
 *
 * `trimToSingleVariant` / `trimToModeAngles`' twin, and the same division of
 * labour: the narrowed schema (`angles: ['network']`) is the optimization — it
 * stops the model paying output tokens for variants that would be thrown away —
 * and THIS is the contract, because `maxItems` is in the D164b unsupported-
 * keyword set and strict structured outputs cannot cap an array's length.
 *
 * It also STAMPS the angle rather than trusting it. `parseBatchReplies` coerces
 * an unrecognized angle to `'extends'`, so a model that answered with a room
 * angle would land networking replies in the reach path's analytics column. The
 * goal is what decides this label, not the model — which is exactly what makes
 * `angle = 'network'` a free split of the two objectives in every later crosstab
 * (radar_drafts.angle is plain text, so no migration is involved).
 *
 * Positional, not angle-matched, unlike `trimToSingleVariant`: under a one-angle
 * schema they are the same variant, and when they are not, the model's own
 * ordering is the better guess than a label it already got wrong.
 */
export function toNetworkVariants(variants: readonly ReplyVariant[]): ReplyVariant[] {
  const first = variants[0];
  return first ? [{ ...first, angle: 'network' }] : [];
}
