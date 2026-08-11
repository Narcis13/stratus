# Coach, judge & growth tactics — the quality-and-growth layer

Three things shipped together, and they are best understood together: a **free coach** that reads
every draft as you type, a **paid judge** you can summon for a second opinion on one draft, and a
set of **growth tactics** lifted from a measured study of a comparable builder account — the
reciprocity lane, launch seeding, milestone nudges, and two smarter prompts.

They share one contract, stated once here and repeated on every surface involved:
**advice is measured, never enforced.** No score sorts anything, no verdict blocks Schedule, no
gate closes because a number said so — and for each of the three, the Playbook carries a cell whose
only job is to check, on your own data, whether the advice predicts anything at all.

Per-tab detail lives with the tabs: **[Composer](./composer-tab.md#the-judge-a-paid-second-opinion-on-demand)**
(the judge panel and the live coach column), **[Replies](./replies-tab.md)** (score chips, the
"your people" gate exemption, the labelled quoted tweet), **[Radar](./radar-tab.md)** (the
`your circle` capture), **[Today](./today-tab.md)** (the reciprocity quest, the milestone card, the
launch checklist), **[Playbook](./playbook-tab.md)** (all the falsification cells). The coach also
has its own deep write-up: **[The static coach](./sc-static-coach.md)**.

---

## The three opinions, side by side

| | The coach | The judge | The Playbook |
|---|---|---|---|
| **What it is** | ~29 deterministic writing checks + a format label | One AI read against a 13-dimension rubric | Your own measured history, bucketed |
| **When it runs** | Every keystroke, automatically | Only when you click **Run judge** | Every time you open the tab |
| **Cost** | $0, computed on your machine | ~$0.003 a click (~$0.007 for Apply all) | $0 — SQL over already-billed data |
| **Speaks about** | The text in front of you | The text in front of you | Posts that actually went out |
| **Trust it because** | The rules are platform facts | It quotes your own words back | It is gated at n≥20 and says "not enough data" otherwise |

The coach is a floor that catches own-goals; the judge is an opinion with reasons attached; the
Playbook is the only one of the three that deals in outcomes. None of them outranks you.

---

## The coach, in one paragraph

As you type in the Composer, a boxed panel grades the draft: a 0–100 score with its band, red
**Fix** rows, amber **Nudge** rows, and an "N passing" disclosure — recomputed locally with no
network call. The same engine puts a compact score chip on every reply variant (graded as a reply,
on a shorter checklist), labels every published post with its structural **format** (question,
hot take, would-you-rather, milestone…), warns when the shape you're typing has gone out four times
this week (the **cooldown**), and — once a format has 20 measured posts — shows a **reach band**
fitted purely on your own history, with no fallback table behind it. Two of its rules read your
niche's vocabulary (channel keywords, pillar slugs) so a nutrition account is never graded on
whether it mentions ARR. The full story, including everything it deliberately refuses to guess, is
in **[The static coach](./sc-static-coach.md)**.

---

## The judge

The **Judge** section sits under the Composer's rewrite button, single-post mode only. It costs
money, so nothing runs it for you: no worker, no batch, no auto-judge of AI drafts. One click, one
call, and the price is printed on the button.

What comes back for ~$0.003: an **overall score and a band** (*post it* 85+ / *slight rework* 70+ /
*major rework* 40+ / *do not post*), a one-line **headline**, **twelve dimensions** behind a
disclosure (reply pull, profile pull, reach hook, save value, dwell, voice match, negative risk,
answer effort, stranger answerability, status dependency, replies-vs-quotes, audience match), and
up to twelve **anchored fixes** — each one an exact quote from your draft with a recommendation.
Clicking a fix selects that phrase in the text box. A quote the model invented is silently dropped
rather than rendered pointing at nothing.

Five properties are load-bearing, and each is enforced in code rather than promised in copy:

- **The band is derived, never model-supplied.** The model returns thirteen numbers; stratus works
  out the label from `overall` on its own side. A prompt edit asking the model for its own verdict
  is simply ignored — the label and the number can never disagree.
- **A verdict only ever describes the exact text it judged.** Edit one character and it disappears;
  undo the edit and it comes back (you don't pay twice for changing your mind). The server enforces
  the same rule by hashing the text, so a stale verdict can never be applied to a draft that moved
  on. Whitespace differences and X's own HTML-escaping of `&`, `<`, `>` are the two deliberate
  exceptions — neither is an edit.
- **Apply all fixes (~$0.007) can only improve things.** It rewrites the draft applying every fix,
  re-judges the result with the *same* grader, and keeps the rewrite **only if it scores strictly
  better** — a tie keeps your words. "Kept your version" is a success message, not an error.
- **Refuse before spend.** Every validation, the unknown-judgment 404 and the stale-text 409 all
  land before any AI call. A failed database write after the call never loses the verdict you paid
  for.
- **Two dimensions read backwards on purpose.** High **negative risk** and high **status
  dependency** ("this only lands if you already have the famous bio") are bad news, and the panel
  colours them accordingly.

**Voice match** and **audience match** are graded against *you* — your active niche's persona and
beliefs plus your active pillars — not against a generic idea of a good tweet. No niche set up
means audience match comes back as unknown, never as an invented number.

The rubric and the rewrite instructions are ordinary prompts: **draft judge** and **judge rewrite**
in **Settings → Prompts**, editable and revertable like the other thirteen.

**What the judge deliberately does not do:** judge replies (several dollars a month on the surface
with the least headroom), judge the drafter's three candidates automatically, feed its scores into
any reach forecast, or rank anything. Read *answer effort* and *stranger answerability* as
descriptions, not targets — maximised, they are the recipe for reply-farm bait, which is exactly
why nothing optimises for them.

---

## The growth tactics

These come from a harvest study of a builder account whose measured growth engine turned out to be
comment-flywheel volume plus deliberate small-account reciprocity. Everything below is that
finding, turned into surfaces — with X API spend at $0 throughout.

### Your people are exempt from the reply gate

Replying to a quiet post by someone you already have a relationship with used to require the
"dead post — force" dance. Backwards: reach is not the point of those replies, the relationship is.
GT.6 made the band gate step aside for people you had actually replied to before.

**Superseded on 2026-08-11:** the band gate itself is gone, so there is no refusal left to carve
out of and the exemption was deleted with it. Reply Master now drafts on whatever you click.
Details: **[Replies → There is no band gate any more](./replies-tab.md#there-is-no-band-gate-any-more)**.

### The reciprocity quest and the `your circle` radar lane

The Today tab counts **"N replies to your people"** as a sixth daily quest, with the target owned
by your niche's doctrine (**replies to my people · min**, default 5). It counts only people who
were *already yours when the day started* — otherwise every first reply of the day would promote
someone into the set and then count itself, and the quest would just repeat the replies quota
wearing a relationship label. `0/5` with *"today went to new faces — circle back to someone"* is a
correct reading.

Feeding the habit: a **fresh post by someone in your circle can enter the Radar queue even when
your sweep filters would pass on it** (the *circle bypass* switch), with a muted `your circle`
chip. A later sweep that admits it on its own numbers upgrades it, and under queue pressure circle
rows are dropped first — a talkative circle can't push out the rows your filters caught. The label
is bookkeeping only; it never reaches the reply snapshot.

### Launch seeding and the milestone nudge

The **Launch Room** now leads its checklist with *"Seed the first comment yourself — extend the
post, don't restate it"* and drafts that comment in one click (~$0.002–0.004), in your voice, told
outright that the post is yours. On link-in-first-reply threads the button hides — that slot is
already spoken for by the link.

The **Today** tab shows a **Milestone** card for three days after you cross a follower rung
(50 · 100 · 250 · 500 · 1,000 · …), with a one-click **Draft it** button, because milestone posts
are one of the measured best formats. It only congratulates a crossing it actually *watched*
happen (a snapshot below the rung must precede it), so a fresh install is never congratulated on a
milestone passed years ago. It is a nudge, not a tracker: it goes quiet on its own.

### Two smarter prompts, one honest few-shot block

- **Every reply anchors on the post it answers.** The reply prompt now requires each variant to
  echo one concrete term, number or phrase from the tweet's own text — the single instruction with
  the most measurable effect on whether people reply back. And the quoted tweet is handed to the
  model **labelled as an untrusted quote** to be replied to, never followed as instructions.
- **The post drafter knows four proven engagement skeletons** — would-you-rather, poll-list,
  confessional question, audience CTA — used in at most one of its three drafts, filled with your
  material only, each inviting a reply rather than a follow. Posts engineered to be *answered*
  measured ~2× the views of posts engineered to be admired.
- **The drafter's "this is your voice" examples are capped at two machine-written posts** out of
  five. Left alone the block eats itself: a post the drafter wrote and that performed well comes
  back as a voice anchor on the next draft, with the numbers confirming the drift. Dilution, not
  exclusion — a machine draft you edited is partly yours.

The study's #1 recommendation — raising reply volume — needed no code at all: it is the reply
band on **Settings → General → Niche**, yours to change.

---

## The falsification cells

Each opinion ships in the same release as the cell built to check it, on the
**[Playbook](./playbook-tab.md)** tab, everything gated at the house n≥20:

- **Post format** — which *shape* of post lands, over your entire history, no backfill.
- **Does the coach score predict anything?** — originals bucketed by score band *and* by
  fixes-flagged vs clean. Graded with the same niche lexicon the Composer used, so the cell
  measures the number you actually saw.
- **Does the judge predict anything?** — originals bucketed by the verdict band the judge gave
  *that exact text*, with `unjudged` as its own honest bucket, plus an approved-vs-rejected split
  that can clear the gate at half the sample.

Expect "not enough data to say" for months. That is the design working: the honest alternative to
quoting an unvalidated rubric as advice. Each section states its verdict in either direction when
the gate clears — including the deflating one.

---

## Costs

| Action | Cost | Trigger |
|---|---|---|
| Coach score, format label, cooldown, reach band, all chips | $0 | automatic, local or already-billed SQL |
| Run judge | ~$0.003 | your click |
| Apply all fixes (rewrite + re-judge) | ~$0.007 | your click |
| Draft seed comment / milestone draft / reply drafts | ~$0.002–0.006 (Grok) | your click |
| Reciprocity lane, radar capture, quest, all Playbook cells | $0 | ambient |

Nothing in this layer spends X API money, nothing runs an AI call without a click, and every
button that spends carries its price in its label.

---

## Verified by

`bun scripts/smoke-coach.ts`, `bun scripts/smoke-judge.ts` and
`bun scripts/smoke-growth-tactics.ts` — all $0 by default, rerunnable against the real database,
leaving no rows behind. The judge smoke's `--live` flag adds exactly one real judge call (~$0.003)
to prove the full round-trip; the other two have no paid path to prove. The gate-exemption proof is
the neat one: both AI keys are removed for the test, so a request that *clears* the gate lands on
"AI not configured" — the only status that says everything before the money passed — while a
stranger's still gets the refusal.
