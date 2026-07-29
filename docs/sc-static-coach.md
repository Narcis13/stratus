# The static coach — what it checks, what it refuses to guess

stratus reads your draft before you post it and says a few plain things about the writing. It costs
**nothing**, it happens on your machine as you type, and it never stops you from posting.

This document is the whole story in one place: the four layers, where each one shows up, and — the
longer half — **everything it deliberately does not do**, because that list is what separates a
coach you can trust from a plausible-sounding number generator.

Per-tab detail lives with the tabs: **[Composer](./composer-tab.md#the-coach-live-score-and-fix-list)**
(the live column, the cooldown line, the reach band), **[Replies](./replies-tab.md)** (the score
chips on variants), **[Playbook](./playbook-tab.md)** (the format table and the coach's own report
card).

---

## The one-sentence framing

**The score is a floor, not a target.** It catches own-goals — a link that will cost you 13× more, a
post that hides behind "show more", a closer that begs — and it is genuinely uncorrelated with how
far a post travels. Every surface says so in the same sentence, rendered from a single string:

> Signals, not verdicts — 60+ reads ship-ready; the goal is the post, not the score.

Nothing anywhere sorts, ranks, gates, blocks or refuses on the score. A 40 posts exactly as easily
as a 95. If that ever changes, this paragraph is the thing that was broken.

---

## The four layers

### 1. The checks (a 0–100 score and a short fix list)

Around 29 rules over a draft, in three groups — **hygiene** (em-dash, hashtag count, ALL-CAPS, hedge
stacking, weak openers and closers, AI tells, the "show more" cutoff at 15 raw lines), **craft** (does
the opening earn the second line, is there tension, one concrete thing, breathing room, a quotable
last line) and **signal** (does a stranger get a reason to click your profile, is the question one
anyone can answer, does the post stand on its own, `@`-pileups, and the `$0.20` URL surcharge). Each
rule returns *pass*, *nudge* or *fix*; the score is the lower of two means, so clean hygiene can't
carry a draft whose signal group failed.

Two behaviours worth knowing because they look like bugs and aren't:

- **The band and the fix rows can disagree.** A draft can read *top tier* while showing one red row:
  the score is an average over ~20 rules, so a single fix costs about five points. The rows are the
  coach's actual opinion; the number is a rough floor. Read the rows.
- **A reply is graded on a shorter list.** Two rules are *skipped*, not auto-passed — a line in the
  middle of a conversation is not supposed to have a hook or blank-line spacing.

### 2. The format classifier

A structural label for any post text: *would-you-rather, poll-list, binary-choice, hot-take,
confession, milestone, audience-CTA, question, data-comparison, story, list, one-liner* — and, when
nothing matches, *substance* or *other*.

This is a **fourth, independent axis**: pillar is the topic, register is the tone, angle is a reply's
stance, and format is the **shape**. It is computed from the text every time it is needed and never
stored, which is why it worked over your entire published history on the day it shipped, with no
backfill, and why improving the classifier retroactively improves every table that uses it.

**The three fallback labels mean "no shape recognised", not "this shape."** Everything downstream
treats them as off-axis rather than as a fourteenth format — they never trigger a cooldown and never
get a reach band. About half of a normal account's posts land there, which is fine: they are prose.

### 3. The cooldown (are you repeating a shape?)

A rolling 7-day count per format, shown in the Composer only while you are drafting that shape:
**4 in the window reads *cooldown*, 2 reads *warming*.** It counts hand-written posts too, because it
reads the text rather than a field the drafter filled in.

### 4. The reach band (only once your own history supports it)

*How have posts of this shape actually done for me?* — a stall range and an escape threshold in
absolute views, fitted **only** on your own measured posts, gated at the house n≥20 per format. Below
the gate it prints the sample count and nothing else.

There is no fallback table anywhere behind that line. See "what was not adopted" below — this is the
part where most tools quietly ship someone else's numbers.

### Plus: it speaks your vocabulary

Two rules need to know what counts as a *specific* word in your world. They don't guess: the coach
reads your active channels' keywords, your pillars' slugs and your niche label. Add a keyword on the
Channels tab and every coached surface picks it up within a minute. With nothing curated, those two
rules simply behave as they did before — the other ~two thirds are platform and prose facts that
need no niche at all.

---

## What was deliberately not adopted

The rule inventory came from a code study of another builder's static engine
(`evals/x-builder-static-engine-analysis.md`). The rules are facts about the platform and about
prose; **its numbers are not**, and this is the list of what was left on the floor and why.

| Not adopted | Why |
|---|---|
| **The reach multiplier table** (e.g. "CTA farm 3.0×, substance 0.3×") | Every entry in it is marked *calibrate* against a corpus that isn't in that repo. Taken literally it would coach *away* from the exact posts this account exists to write. stratus ships **no seed table at all** — below the gate you get a sample count, not a borrowed guess. |
| **Environment multipliers** — posting hour, media attached, account age | stratus already *measures* all three (best-times cells, the media effectiveness cell, one fixed account). Inventing multipliers next to a measured surface adds noise and lets two numbers contradict each other. |
| **A trending-term lexicon** | It shipped with an expiry date and rots between releases. Your channel keywords are a live, operator-owned version of the same thing. |
| **Idea-clustering inside the cooldown** (token-set similarity ≥ 0.45, so four *different* questions don't read as repetition) | Measured before porting: across 795 same-format pairs inside 7-day windows of real posts, the **most** similar pair scored **0.238** — a 280-character post carries ~15 content tokens, so two posts making the same point share almost none of them. At 0.45 the counter would be silent forever; at any threshold this corpus reaches it would fire on shared vocabulary, not on repeated ideas. Repetition of *ideas* already has an owner elsewhere (the near-duplicate check on the calendar). |
| **"Exactly three fix rows" on the plan's own example draft** | The engine grades an em-dash and a "thoughts?" closer as *nudges*, not *fixes*. Severity is per-rule and deliberately conservative — reserving red for things that cost money or hide the post. |

Two more were rejected during the reach fit, and they were stratus's own habits rather than borrowed
ones — which makes them the more interesting pair:

- **"Use the latest metrics snapshot per post"** — right for showing you one post, wrong for
  comparing many. Only posts that already did well get re-read, so "latest" is really two different
  measurement protocols selected on the outcome: the re-read posts' views were ~10× higher *at their
  first reading*. The fit uses the **first** snapshot, which every post gets.
- **"Normalize views by age"** — assumes views accrue evenly over time. They don't. Posts read at
  under 12 hours old and at 12–27 hours carry effectively the same raw count (129 vs 121) while their
  age-normalized rates differ by 170%; one post read four minutes after publishing produced a 696×
  multiplier. The fit instead uses only posts measured inside the daily pass's own 3–27 hour window
  and compares raw counts. Posts measured outside it are dropped, not rescaled.

The pattern behind all seven rows is one rule: **a number here is a measurement or it is absent.**

---

## Does the coach actually help?

The Playbook answers that on your own data, and it shipped in the same release as the coach — see
**[Playbook → Does the coach score predict anything?](./playbook-tab.md)**. It buckets your published
originals by score band *and* by whether the coach flagged anything, both gated at n≥20.

Expect "not enough data to say" for a long time, and possibly forever. On a healthy account nearly
everything lands in *top tier*, which leaves nothing to compare against. That is the table working:
the coach is a floor that stops obvious mistakes, and this is the section that would tell you if it
ever became more than that.

---

## Cost and privacy

**$0, always.** The checks, the score, the format label and the chips are computed in the extension
on your machine — no request, no AI call, no wait. The cooldown, the lexicon, the reach band and the
Playbook cells are `$0` SQL over rows stratus already paid for. Nothing in this feature can spend
money, and the only spend-adjacent effect is negative: the URL check warns you about the **$0.20**
surcharge while you type, one step earlier than the schedule-time guard that actually enforces it.

Verified end-to-end by `bun run scripts/smoke-coach.ts` — $0, rerunnable, leaves no rows behind.
