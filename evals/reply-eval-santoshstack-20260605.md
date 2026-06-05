# Reply Eval — Reference Account #2 (@santoshstack: volume-pod + bait-original growth)

| | |
|---|---|
| **Captured** | 2026-06-05T10:54:38+0300 |
| **Source** | Scraped replies + own-post context from **@santoshstack** (NOT ours) — a second reference/negative control |
| **Sample** | 372 scraped rows → **343 replies** analysed + **26 own standalone posts** recovered from context rows |
| **Window** | ~2026-05-29 09:30 → 2026-06-04 17:00 UTC (≈6.5 days; ~53 replies/day) |
| **Purpose** | Mine a second real account to sharpen `reply prompt.md` / `src/x/replies/prompt.ts` and the reply-targeting pipeline |
| **Prompt version compared against** | `reply prompt.md` as of commit `d2d10da` (same as eval #1) |
| **Targeting model checked** | `extension/src/replyBand.ts` (recalibrated against this CSV on 2026-06-04) + `evals/analyze-santoshstack.ts` |
| **Sibling eval** | `reply-eval-20260604-201909.md` (Reference Account #1 — the "clever AI-reply-guy") |

> Second entry in the corpus. Section order kept parallel to eval #1 so trends are comparable. Where this account diverges from #1, that's called out — the two are different *species* of slop.

---

## TL;DR

Account #1 was a **clever** AI-reply-guy (contrarian "well actually" takes, fabricated stats). @santoshstack is the opposite failure: a **zero-craft volume machine**. Almost every reply is *"Exactly, {the original post, reworded}"* — 42% open by literally agreeing, 1% use first person, 1% contain a single digit. 343 replies over a week earned a **median of 0 likes**, total **177 likes**, and a **1.52% like-rate** — *worse* per view than eval #1's 3.32%.

And yet the account clearly grows. Why? **Not the replies.** Two mechanics our metrics barely capture:

1. **Engagement-bait original posts are the real engine.** His 26 own posts pulled **618 comments + 702 likes** — 3.5× the *total* engagement of all 343 replies combined, from 1/13th the posts.
2. **A reciprocal-reply pod.** 29% of his replies go to just **4 accounts** (Olivia0945 ×30, Lilly7862 ×29, GohilHardy ×21, Hazel52389 ×18). The replies are junk; the *reciprocation* is the point.

The lesson for us is not "write replies like him" — it's the inverse on craft, plus a hard reminder that **the reply box is a low-yield channel when the reply is generic**, and the real growth levers live in *targeting* and *original posts*. His mechanism (pods, bait) is explicitly forbidden by our voice doc §5 ("organic growth, no shortcuts, zero engagement pods"). This sample is valuable precisely because it shows a high-volume slop strategy "working" on follower count while producing a brand with **no identifiable human behind it** — the exact thing our prompt exists to prevent.

---

## Aggregate metrics (343 replies)

| Metric | Median | Mean | Total |
|---|---|---|---|
| Reply views | 20 | 34.0 | 11,666 |
| Reply likes | **0** | 0.52 | 177 |
| Replies-back | 0 | 0.25 | 86 |
| Reply length (chars) | 114 | 106 | — |

- **54%** of replies got **zero likes**. **49%** are fully dead (0 likes AND 0 replies-back).
- Aggregate like-rate: **1.52% of views** (eval #1 was 3.32% — this account converts attention to likes *half* as well).
- Likes track **exposure, not craft**: corr(reply views, reply likes) = **0.31**; corr(reply length, reply likes) = **0.08** (none). corr(original views, reply views) = **0.65** — he's just renting the parent post's reach.
- **First person ("I"/"my"): 2 of 343 (1%). Any digit: 2 of 343 (1%).** This is the empirical floor of "no specificity."

---

## Targeting findings (the biggest lever — and it's *inverted* from eval #1)

Capture rate = reply views ÷ original-post views.

| Original views | n replies | Reply views (med) | Reply likes (med / mean) | Capture (med) | Like-rate |
|---|---|---|---|---|---|
| **0–100** | **189** | 12 | 0 / 0.46 | 61% | 3.24% |
| 100–500 | 32 | 34 | **1** / 0.72 | 12% | 1.87% |
| 500–1,000 | 57 | 47 | 0 / 0.53 | 6.8% | 0.96% |
| 1,000–2,000 | 49 | 57 | 0 / 0.43 | 4.0% | 0.74% |
| 2,000–5,000 | 7 | 57 | 0 / 0.43 | 2.3% | 0.73% |
| 5,000–20,000 | 9 | 141 | 1 / 1.56 | 1.3% | 1.00% |

**The headline: 189 of 343 replies (55%) target sub-100-view posts** — the "let's connect" crowd and tiny accounts. They convert at 61% capture but on a base of ~30 views, so the absolute payoff is ~12 views and ~0 likes. Eval #1's mistake was the *opposite* — wasting the budget on 20k+ whales (buried at <0.2% capture). **Both extremes are traps.**

Reconciled across the two accounts: the productive band is roughly **300–3,000 original views**. Below that there's no audience to capture; above ~5k you're one voice in hundreds and capture collapses. The 100–500 bucket here is the only one that yields a median of 1 like.

**This validates the deployed band model.** We already have `extension/src/replyBand.ts`, recalibrated against *this exact CSV* on 2026-06-04 (view floor dropped 800→300). Replaying it over the 345 reply-targets: the posts it would tag **hot/warm (n=156)** earned a **median 48 reply-views at a 53% hit-rate**, vs the **null (n=189)** posts at **12 views, 3% hit-rate** — and only **1 of 96 'hot' calls flopped**. The model's `null` gate is, almost exactly, his 55% sub-100 spray. So the highest-value targeting fix already exists in code; this account is its confirmation, not a reason to rebuild it.

**Timing is the surprise — freshness barely helps here.** Median reply went out 47 min after the original (only 22% within 10 min). But reply-views by age bucket *peak at 15–60 min (median 27) and 1–3 h (median 28)*, and are **lowest under 5 min (median 13)**. Replying instantly did worse, not better. Part of that is a scrape confound (older parents had more time to accrue the views the reply rode), but the takeaway holds: on this account freshness is a **weak, possibly inverted** signal — which is exactly why `replyBand.ts` already de-weights the velocity paths. This *contradicts* eval #1 (where 17-min-median replies looked better), so treat "reply fast" as **unresolved across accounts**, not a rule. The reliable lever is the view band, not the clock.

**Rule of thumb (pipeline, not prompt): feed the generator tweets the band model already tags hot/warm (~300+ views, not yet buried past ~40 replies). Skip the sub-100 micro-posts and the 20k whales. Don't over-invest in sub-10-min freshness — the data doesn't support it.**

---

## The real engine: original posts ≫ replies

This is the finding eval #1 didn't have, because we recovered 26 of his **own standalone posts** from the scrape's context column.

| | Own posts (n=26) | Replies (n=343) |
|---|---|---|
| Views — median / total | 504 / 16,087 | 20 / 11,666 |
| Likes — median / total | 25.5 / **702** | 0 / 177 |
| Comments-in — median / total | 22.5 / **618** | 0 / 86 |
| Engagement per post | ~50 (likes+comments) | ~0.8 |

His originals are **~60× more engagement per post** than his replies. And the *format* that works is explicit:

- **Engagement-bait list/question posts** (n=13): median **28 comments**, 636 views. Examples: *"What feels most difficult as a solo founder? • Making decisions alone • Managing stress … • Anything else?"* (31 comments), *"Hey founders! … Drop what you're working on"* (49 comments).
- **Statement posts** (n=13): median 21 comments, 410 views. Slightly lower, but still dwarf the replies.

**Implication for our system (cross-feature, not a reply-prompt fix):** @santoshstack's growth is carried by *originals*, and his replies are just name-spray maintenance. Our scheduler (the calendar/publisher side) is where the equivalent lever lives. The catch: his bait format ("drop what you're building", bulleted menus, "Anything else?") is exactly the engagement-bait our voice doc §7 bans. So the takeaway is **not** "copy the bait" — it's "a voice-compatible *invitation to reply* (a sharp question rooted in the two laboratories) is probably higher-ROI than a 4th generic reply." Treat as a content-side hypothesis to test on the scheduler, separate from the reply path.

---

## The reciprocal pod (why junk replies "work" at all)

Authors he replied to **≥3×** in one week:

| Replies | Account | What they post |
|---|---|---|
| 30 | @Olivia0945 | motivational quotes |
| 29 | @Lilly7862 | motivational quotes |
| 21 | @GohilHardy | founder hot-takes |
| 18 | @Hazel52389 | motivational quotes |
| 9 | @alexabelonix | founder content |
| 7 | @NikiTsivitanou, @Audrey7866, @EmailCopyJames, @_Chemist1 | mixed |

Top 4 accounts = **98 replies (29% of everything)**. 26 of his reply *targets* are explicit "let's connect / add me" requests, which he answers with "Sure" / "Let's connect" / "Done". This is a **reciprocal-engagement ring** plus a follow-back farm — a distribution mechanic, not a content one. It's why a stream of 0-like replies still compounds into followers.

Our §5 forbids this outright. Logged here only so nobody reads his follower count and concludes "the agreeable-restatement reply works." It doesn't — the *reciprocation* works, and we've chosen not to play that game.

---

## Failure modes (the roast, with counts)

| Count | Pattern | Why it's bad |
|---|---|---|
| 144 (42%) | **Open by agreeing**: "Exactly…" (67), "Yeah…" (50), "Agree/Agreed…" (12), "True…" (10), "Yes…" (2) | This is agreement-bait — the single thing our reply prompt bans most explicitly ("Never agreement-bait. Never 'great post, so true.'") |
| ~200 | **Restate the original in different words**, add nothing | "Could've been pasted under any post" — fails the §0 3-sentence test at ~100% |
| 41 | **Networking filler**: "Sure", "Let's connect", "Done", "Nice", "Hi", "Yeah very tough" (≤15 chars) | Pure follow-farm; zero brand signal |
| 339/343 | **No first person, no number, no named tool** | The inverse of our specificity gate — literally 1% I/my, 1% digits |
| — | **Voice is a single flat register** — every reply is the same calm, balanced, hedge-free-but-also-claim-free "observation" | No person. corr(len,likes)=0.08 confirms more words ≠ more value |
| — | **Slow** (median 47 min) on posts with real reach | Misses the parent's view spike |

**Persona check** against our prime directive ("within 3 sentences, can a reader tell a SPECIFIC human wrote this?"): failure rate ~100%, same as eval #1 — but for the *opposite* reason. #1 faked specificity (invented stats); #2 omits it entirely. Both land in AI-slop; our prompt must guard both edges.

---

## Top performers (what "worked" — and it's exposure, not craft)

| Likes | Back | Views | Chars | Reply | Rode on |
|---|---|---|---|---|---|
| 8 | 0 | 211 | 102 | "The best response is to keep focusing on your own growth…" | @_Chemist1 viral post, **16,180 views** |
| 2 | 1 | 294 | 222 | "The future belongs to developers who can combine engineering judgment with AI leverage…" | 6,840-view dev post |
| 2 | 1 | 94 | 151 | "People often blame themselves for a lack of discipline when the real issue is their environment…" | 283-view post |
| 2 | 1 | 88 | 90 | "The silence after shipping can feel like failure…" | 237-view post |
| 2 | 1 | 51 | 90 | "Real demand shows up in behavior, not opinions. Paying customers are the only true signal." | 671-view post |
| 2 | 0 | 35 | 4 | "Sure" | a connect request |

His single best reply (8 likes) is a generic platitude under a 16k-view viral tweet — **pure reach rental, 0 replies-back, nothing identifiable**. The 2-like cluster is his most *specific* line ("paying customers are the only true signal") — note it's also his *shortest* and *hardest-claim* one.

**Like-rate by length bucket** (same shape as eval #1 — length doesn't buy likes):

| Length | n | Like-rate | Avg likes |
|---|---|---|---|
| 0–40 ch | 42 | **3.46%** | 0.38 |
| 40–100 ch | 54 | 1.33% | 0.50 |
| 100–180 ch | 244 | 1.49% | 0.54 |
| 180+ ch | 3 | 0.81% | 1.00 |

The bulk of his replies (244) sit in the 100–180 band — the restatement sweet spot — and underperform the short bucket on like-rate. Pattern holds across both accounts: **short + a hard claim wins on like-rate; padded restatement gets views but not likes.**

---

## Prompt-improvement candidates (for `prompt.ts` / `reply prompt.md` and the pipeline)

Derived from this eval, cross-checked against eval #1. Hypotheses — validate against future scrapes before committing.

1. **Harden the agreement ban into an explicit forbidden-openers list for replies.** Add, verbatim, to the reply hard-rules: *"Never open with 'Exactly', 'Yeah', 'Yes', 'True', 'Agree', 'Agreed', 'Absolutely', 'This is …', 'Sounds like', or any restatement of the post. First 7 words must be a standalone claim of mine, not an echo."* (Account #2 opens by agreeing 42% of the time; #1 did "concede-then-pivot." Same disease, list both.)
2. **Make specificity a hard gate, not a soft preference.** The reply path already asks for "at least one concrete thing" — make it a *gate*: no first-person lived detail / real number / named tool/scene → reject and regenerate. Empirically, the slop floor is exactly 1% I-or-my and 1% numbers; if a draft would land there, it's slop.
3. **Default to ONE punchy line.** Our format mandates "1–2 short propositions"; bias hard to one. Both accounts show length is uncorrelated with likes (0.08, −0.04) and the short bucket wins like-rate (3.46% vs 1.5%). Two lines only when the second adds a *different* proposition, never a restatement.
4. **Ban the "balanced observation" register.** @santoshstack's whole corpus is hedge-free but *claim-free* — calm, both-true, no side taken. Add to §3/the reply rules: *"Take one side. If the reply is equally agreeable to everyone in the thread, it's slop — sharpen until someone could disagree."*
5. **Don't chase sub-10-min freshness.** Eval #1 hinted early-is-better; this account says the opposite (reply-views peak 15 min–3 h, worst <5 min). The deployed `replyBand.ts` already de-weights velocity — *keep it that way*. If anything, the selector should value "post is past its first handful of replies but not yet buried (≈6–40 replies)" over raw recency; on this account the 0–5-reply posts are the dead zone (median 12 reply-views) and 6–40 replies is where reply-views jump to 44–51.
6. **Keep the deployed targeting band; this eval confirms it (biggest single lever).** `replyBand.ts`'s hot/warm calls hit 53% vs 3% for passed, 1/96 false alarms — no prompt edit competes with that. Action items are small: (a) make sure the live reply pipeline actually *routes through* `classifyBand` before a draft is generated (don't spend a Grok call on a `null` post); (b) log our own HOT-call outcomes so the margins get re-checked on first-party data instead of one scraped week (the model's own header asks for this).
7. **Don't import his "engine."** His growth comes from engagement-bait originals + a reciprocal pod, both forbidden by §5/§7. *Do* test a voice-compatible cousin on the **scheduler**: a sharp, laboratory-rooted question that invites replies (not "drop what you're building"). Keep it out of the reply prompt — it's a content-side experiment.

---

## Caveats

- **We can't see followers.** His like/reply-back numbers are dismal, but his actual objective (follows via reciprocation + connect-requests) is invisible to this scrape. "His replies fail" is true on the metrics we *have*; his account may still be growing. Don't compare our like-rate to his as if we're optimizing the same number — different objective functions.
- **Original-post metrics were scraped after the fact**, so older parents show *inflated* view counts (they had longer to accrue). This inflates capture denominators for older posts and confounds the age-vs-reply-views read (the reply rode views the parent gathered *after* the reply). It's the main reason the freshness signal here is untrustworthy, and why `replyBand.ts`'s own header says to re-check the margins against first-party logged outcomes. Same warning applies to the targeting buckets above — directional, not precise.
- **Own-post recovery is inferred.** The 26 "own posts" were reconstructed from rows where the scrape paired @santoshstack's own tweet as context; deduped by text, but counts/metrics are best-effort, not a clean timeline.
- Single week, single account — directional, not statistical. Re-check as the corpus grows.
- Low-N like-rates are noisy below ~30 views; treat the sub-100 bucket's percentages as soft.
- Scraping may have flattened reply formatting; the "single line vs propositions" read is uncertain (same caveat as eval #1).
- This is **not** our account. The persona mismatch is the *value* of the sample (a second, different negative control), not a defect in our generator.

---

*Cross-account read (evals #1 + #2): two opposite slop strategies, same ~0 median likes. #1 over-crafted and faked specificity; #2 didn't craft at all and rode pods. Our edge is the thing neither has — a real, identifiable human with two laboratories nobody else can see. The prompt's job is to force that onto the page every time; the pipeline's job is to put it under the right post, early. Both levers, not just the prompt.*
