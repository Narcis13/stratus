# x-growth-plan-v3.md — The Reply Arbitrage

> Written 2026-08-04 by Claude (Opus 5), from the live stratus DB, the harvested
> `@thespacerr` corpus (334 posts + 1,000 replies with parent-post metadata), spacerrx.com's
> own published documentation, and the two prior plans.
> **Supersedes `x-growth-plan-fable.md` and `x-growth-plan-opus.md`** — not because they were
> wrong, but because a measurement neither of them had is now available.
> **72 days remain (Aug 4 → Oct 15).**

---

## 0. The verdict, up front

Both prior plans agreed on one thing and both were **half wrong about it**:

> *"Your replies are worthless. 89% get under 50 impressions. Cut them and post questions instead."*

The half that's right: **your replies, as targeted, are worthless.** 675 replies in the last 14
days earned 15,269 impressions — 22.6 views each.

The half that's wrong: **replies are the single highest-yield surface on X, and you have been
pointing them at the wrong 99% of the timeline.** Here is the measurement that changes the plan:

| | replies | impressions | per reply |
|---|---|---|---|
| **You**, last 14 days | 675 | 15,269 | **22.6** |
| **@thespacerr**, his best-placed 109 replies (7 days) | 109 | 380,413 | **3,490** |

**154× per unit of effort.** Not 1.5×. Not a rounding error in a noisy dataset. One hundred and
fifty-four times, and the mechanism is fully explained by three measured variables that have
nothing to do with what you write.

His reply *median* is 20 views. **Yours is also ~20 views.** The distributions are identical.
The entire difference is that 11% of his replies land under posts with 50k+ views and 0% of
yours do.

And the punchline, from the same table:

| He replied to | parent views | existing replies | his yield |
|---|---|---|---|
| **@sama** | 824,678 | 631 | **62 views** |
| **@dokuneee** | 118,660 | 6 | **9,763 views** |

Sam Altman's post had **7× the reach** and returned **1/157th the impressions**. Every growth
guide on the timeline tells you to reply to @sama. The data says it is the worst thing you can
do with a reply.

**The strategy: a barbell.** A disciplined reply-arbitrage engine buys the *eligibility gate*
(raw impressions, which is literally what the 5M threshold counts). Your questions and identity
posts buy the *payout and the audience* (verified engagement, followers, the thing that survives
October 16). Section 5 shows the arbitrage engine alone reaching **~5.16M by Oct 8**, with the
Forge as margin rather than dependency.

Honest odds with full execution: **~65–75%** — up from ~40–50%, on three changes: the true
starting number is 2.1M not 1.74M, the verified-follower gate is cleared, and the floor is no
longer lottery-dependent. **The remaining risk is almost entirely execution consistency**, not
strategy — 20 placed replies a day, 72 days, through a day job.

---

## 1. Where you actually stand (Aug 4, 2026)

From `posts_published` / `metrics_snapshots` / `account_snapshots`, today:

| Metric | Value | vs Jul 29 plan |
|---|---|---|
| **Rolling-90d impressions (X Analytics, ground truth)** | **2,100,000** | — |
| Rolling-90d (stratus proxy) | 1,736,184 | proxy undercounts by **~21%** |
| Last 7 days, total | 19,403 proxy → **~3,355/day** native-adjusted | unchanged |
| …of which replies | 675 replies / 14d → **22.6 each** (proxy) | confirmed |
| …of which posts | 63 posts / 14d → **396 each** (proxy) | confirmed |
| Followers | **1,184** (+13 in 7 days) | stalled |
| **Verified followers** | **≥500 — GATE CLEARED ✓** | resolved 2026-08-04 |
| Premium+ | scheduled, week of Aug 10 | ✓ |
| Following | 880 | correctly frozen ✓ |
| Days to Oct 15 | **72** | — |

⚠️ **Confirm which number you read.** X Analytics tabs are 7D/2W/4W/**3M**/1Y, and only the 3M
tab approximates the rolling-90d monetization window. On Jul 30 the *2W* tab read 2,068,960
because the Jul 17 spike was still inside it — Jul 17 has since aged out of 2W. If 2.1M is the
3M tab (or the monetization page's own counter), the math below holds. If it's the 2W tab, it's
a different number and everything reprices. **Read the monetization page's own counter, not the
analytics tabs** — it is the only figure X actually gates on.

**Everything else in the previous plans' baseline held.** The daily rate did not move in six
days, which is the strongest evidence that "write 6 good questions a day" was not a real ask
after a hospital shift. This plan's core engine costs **25 minutes a day** and does not require
you to be creative on demand.

### The gap

```
Need:     5,000,000
Bank:     2,100,000   (native; the Jul 17 spike of 1.59M survives until Oct 15 exactly)
Expiry:     ~-110,000  (earned Jun 20–Jul 16, rolls out before the deadline)
─────────────────────
New required: ~2,900,000 over 72 days = 40,300/day
Current:                                 ~3,355/day  (native-adjusted)
Gap:                                        12.0×
```

Better than the 16.8× computed from the proxy, and the second monetization gate is now closed —
but the shape of the problem is unchanged: **a 12× gap does not close by trying harder at the
current activity.**

**The Oct 16 cliff is unchanged and remains the most important structural fact:** Jul 17 + 90 =
Oct 15. Your 1.59M day expires the day after your deadline. Cross the line and *apply the same
day*. The engine this plan builds is what sustains you afterward.

---

## 2. Reverse-engineering @thespacerr

### 2.1 The claim vs. the account

His screenshot claims: **2.5M impressions / 4 weeks, +286%**, marked "BEFORE V4 / AFTER V4" with
the break at ~Jul 26. Also visible and less advertised: **engagement rate 1.6%, −58%**, and
verified followers 2.4K/4K.

His harvested self-report (Jul 15, 6,789 views): *"60 days ago I had 0 followers. Today:
1.1M+ impressions, 3,500+ followers, 2,300+ verified followers, **1400 reply in 1 DAY as
personal record**."*

The claim is **substantially true and the mechanism is fully visible in your DB.** Measured from
the harvest, Jul 29 – Aug 4 (7 days):

| | volume | impressions | per unit | share |
|---|---|---|---|---|
| Replies | 999 (**143/day**) | 472,655 | 473 | **74%** |
| Posts | 36 (5.1/day) | 162,725 | 4,520 | 26% |
| **Total** | | **635,380** | | **90,769/day** |

⚠️ **Caveat, stated plainly:** harvest views are captured at scrape time, so recent posts are
undercounted; the reply corpus is truncated at exactly 1,000 rows (the scroll cap), so Jul 27
is a boundary artifact, **not** evidence that "V4" started then. His charted ~196k/day for the
post-V4 window vs. my measured 90.8k/day is consistent with young snapshots at roughly 2×.
**Treat 90.8k/day as a hard floor on what he actually does.**

### 2.2 The reply ledger — where the impressions come from

All 1,000 harvested replies, bucketed by the **view count of the post he replied to**:

| Parent post views | replies | % of replies | avg yield | total | **% of his reply impressions** |
|---|---|---|---|---|---|
| <1k | 774 | 77.4% | 61 | 47,141 | 9.9% |
| 1k–10k | 63 | 6.3% | 272 | 17,166 | 3.6% |
| 10k–50k | 54 | 5.4% | 580 | 31,327 | 6.6% |
| **50k–200k** | **58** | 5.8% | **1,907** | 110,610 | **23.2%** |
| **200k+** | **51** | 5.1% | **5,290** | 269,803 | **56.7%** |

**109 replies out of 1,000 — 10.9% — produced 79.9% of everything.** That is 15.6 well-placed
replies per day.

Note what he *also* does: 774 replies (77%) into the same <1k-view swamp you live in, earning
61 views each. **He runs your strategy and the arbitrage simultaneously.** The swamp replies are
his relationship maintenance; they are not where his numbers come from. This matters — it means
you don't have to abandon your circle. You have to *add* 15 placed replies a day.

### 2.3 The latency law

| Reply posted after parent | n | avg parent views | **avg yield** | share of impressions |
|---|---|---|---|---|
| **<15 min** | **600** | 105,570 | **720** | **90.8%** |
| 15–60 min | 123 | 61,068 | 205 | 5.3% |
| 1–6 h | 144 | 10,785 | 120 | 3.6% |
| 6–24 h | 104 | 139,248 | **12** | 0.3% |
| >24 h | 29 | 82 | 6 | 0.04% |

Look at the 6–24h row: **average parent views 139,248 — higher than the <15min row — and the
yield is 12 views.** Same quality of target, 60× worse timing, 1/60th the return.

> **The reply window is 15 minutes. After an hour it is over. After six hours you are typing
> into a void regardless of how big the post is.**

This single law invalidates every "reply queue" that shows you posts more than an hour old,
including your current Radar as configured.

### 2.4 The crowding law — the real discovery

Restricting to parents with ≥20k views, bucketed by **how many replies were already there**:

| Existing replies on parent | n | avg parent views | avg yield | **capture rate** |
|---|---|---|---|---|
| **<10** | 49 | 84,249 | 3,003 | **3.30%** |
| 10–50 | 34 | 210,476 | 2,981 | 1.07% |
| 50–200 | 33 | 565,874 | 1,138 | 0.23% |
| 200+ (mega-thread lottery) | 20 | 2,812,767 | 5,730 | 0.55% |

A post with 84k views and <10 replies pays **3,003 views**. A post with 566k views — nearly 7×
the reach — and 50–200 replies pays **1,138**. Reach is not the variable. **Reach per existing
reply is the variable.**

The scoring metric falls straight out, and it is trivially computable from a DOM scrape:

```
cannon_score = parent_views / (existing_replies + 1)
```

Ranked by that score, his targets separate cleanly:

| Target | parent views | existing replies | **views per existing reply** | his yield |
|---|---|---|---|---|
| @hiiragi2280 | 200,491 | 7.6 | **26,421** | 5,961 |
| @yoshi_majime | 107,141 | 4.8 | 22,556 | 2,827 |
| @dokuneee | 118,660 | 6.0 | 19,777 | **9,763** |
| @aktweets | 1,329,034 | 77.8 | 17,094 | 11,231 |
| @_its__sunny | 182,537 | 21.5 | 8,490 | 7,418 |
| … | | | | |
| @polymarket | 84,481 | 59.0 | 1,432 | 279 |
| **@sama** | **824,678** | **631.0** | **1,307** | **62** |
| @teppei_free | 54,159 | 61.0 | 888 | 21 |

**@sama is at the bottom of the list.** So is every account the growth-advice industry points
you at. The crowd has already arbitraged English AI-tech mega-accounts to zero. That is where
your Radar's `hot` band and your `targetBandMinX/MaxX` knobs are currently aiming you.

### 2.5 The roster, not the search

564 distinct accounts appear as parents. But **5 accounts account for 56.3% of all his reply
impressions** — 267,833 views from **65 replies**:

| Account | replies | total yield |
|---|---|---|
| @hiiragi2280 | 28 | 104,843 |
| @aktweets | 5 | 45,238 |
| @dokuneee | 17 | 44,786 |
| @chiamakaafc | 10 | 43,273 |
| @_its__sunny | 5 | 29,693 |

He is **not searching for trends.** He is camping a small roster of accounts that reliably post
high-view, low-reply content, and hitting them within minutes. @hiiragi2280 alone — 28 replies,
avg 3–8 minutes after posting — returned more impressions than your entire account has produced
in the last five weeks.

His work hours confirm it: his reply impressions peak at **10:00 UTC** (84 replies, 1,722 avg)
and **14:00 UTC** — i.e. **19:00 and 23:00 Japan time**. He works the Japanese evening prime.

### 2.6 The market: Japanese X

The parent handles are overwhelmingly Japanese — @hiiragi2280, @dokuneee, @y_ganman3,
@yoshi_majime, @ponko008, @kyoutojin_bot, @nonno_kaba, @itaparu99, @tsu_ne_tune, @yuruazabu.
His replies are substantive, contextual Japanese (the harvest stores them translated):

> *"Even if the insurance premiums paid are the same, the moment of death marks the start of
> drawing lines between…"* — 10,310 views, 0 min after a 126k-view post with 5 replies.
>
> *"After breaking through five alarm clocks and my mom, I wake up at 9:12. Less like
> oversleeping, more like a to…"* — 12,744 views.

**These are not spam.** They are genuine, specific observations about the parent's content,
better than 90% of English reply-guy output. This matters for the ethics question in §9.

**And spacerrx.com publishes the strategy openly.** From their own blog, "Grow on X without
getting shadowbanned: 10 rules," rule #7 verbatim in substance:

> **"Reply to Japanese and other Asian accounts, and be first."** *Target Japanese posts
> especially; Japan has 70 million X users with high reply engagement rates.*

Their rule #2: *"roughly 200 to 400 replies a day, spread across two or three short sessions."*
Rule #6: *"Reply early… while engagement is climbing."* Rule #8: *"one or two original posts a
day."* Every published rule matches the measured behaviour exactly. **The tool's marketing is
honest about its own method; nobody bothered to measure whether it works. Now you have.**

### 2.7 The junk tier — what to *not* copy

Two of his highest-yield moves are pure noise:

| Move | n | total views | avg |
|---|---|---|---|
| `@grok`-summons under mega-threads (*"@grok which causes the most damage?"*) | 22 | 97,426 | **4,428** |
| One-word football chants (*"MARCELOOO"* under 1.4M-view posts) | ~6 | ~50,000 | ~8,000 |

The `@grok` summon is the highest yield-per-reply move in the entire 1,000-row corpus: 2.2% of
his replies, **20% of his reply impressions**. It works because Grok answers and the whole
mega-thread reads the exchange.

It is also the move that turns an account into a hollow shell, and it is the most
shadowban-adjacent thing in the dataset. **Recommendation: zero. Not capped — zero.** It is
listed here because you should know the number and choose deliberately, not because you should
do it.

### 2.8 What his own posts prove

334 posts, avg 2,723 views. His top posts are exactly the format both prior plans identified —
short reply-bait questions and poll-lists:

| Views | Post | Chars |
|---|---|---|
| 76,390 | "Stripe had around 50 users after its first 2 years. Imagine quitting because of that." | 85 |
| 48,287 | "I got fired today because of AI. And so did 199 other people…" | 273 |
| 36,437 | "Please someone explain How does Yahoo make money? Who uses Yahoo?" | 65 |
| 18,527 | "AI will make us? - Smarter - Dumber" | 35 |
| 17,462 | "Who will win the AI race? - USA - China - Europe - India" | 60 |

**The Forge thesis from `x-growth-plan-opus.md` §1.1 is independently re-confirmed** on a third
sample. Short questions and named-option poll-lists are his post engine. That part of the
previous plan survives intact — it is now *Engine 2*, not the whole strategy.

### 2.9 The price he paid — read this before copying anything

| His metric | Value | What it means |
|---|---|---|
| Impressions | 2.5M, **+286%** | the gate, cleared |
| **Engagement rate** | 1.6%, **−58%** | he bought reach, not attention |
| 48,234-view reply | **12 likes, 0 replies** | 0.025% engagement on his single best reply |
| 26,227-view reply | **1 like** | — |
| Own posts avg | 2,723 views on 3.5k followers | his own audience barely moved |
| Follows chart | steady, with visible daily unfollow bars | churn, not compounding |

**He is renting attention, not building an audience.** His impressions tripled while his
engagement rate more than halved — the exact signature of impressions that land in front of
people who do not care.

This is the honest counterweight, and it is also why the recommendation is a barbell rather than
a copy.

### 2.10 The control group — this is not survivorship bias

Your DB contains a second reply-heavy peer, **@i_mika_el**, 500 harvested replies:

| Parent views | replies | % | avg yield |
|---|---|---|---|
| <1k | 416 | **83%** | 12 |
| 1k–10k | 44 | 9% | 34 |
| 10k–50k | 21 | 4% | 212 |
| 50k+ | 19 | 4% | 122 |

**500 replies → 13,122 total impressions. 26 views each.** Same volume as thespacerr, 18× worse
outcome, because 83% of them went into the <1k swamp.

Three accounts, one natural experiment:

| Account | replies | placement | per reply |
|---|---|---|---|
| @i_mika_el | 500 | 83% under <1k parents | 26 |
| **@13_narcissus (you)** | 675 / 14d | ~all under <1k parents | **22.6** |
| @thespacerr | 1,000 | 11% under 50k+ parents | **476** |

Effort is identical across all three. **Targeting is the only variable.**

---

## 3. The synthesis: you are chasing two different currencies

This is the strategic insight the previous plans missed, and it resolves the tension between
"copy the arbitrage" and "protect the account."

| | **The Gate** | **The Payout** |
|---|---|---|
| What it counts | raw organic impressions, rolling 90d | verified/Premium-user engagement on your content |
| Threshold | 5,000,000 | ~$8–12 per million *verified* impressions |
| What buys it | **placement + timing** | **relevance + audience quality** |
| Reply arbitrage | **buys it cheaply** | degrades it |
| Questions + identity posts | too slow alone | **the only thing that buys it** |

@thespacerr optimized purely for the gate and his engagement rate fell 58%. If you optimize
purely for the payout you will not clear the gate in 72 days — you have six days of flat data
proving the content-only approach at your available hours produces 2,772/day.

**So: arbitrage clears the gate. Content earns the payout and survives Oct 16.** Both, with a
hard wall between them, and explicit metrics watching for the arbitrage contaminating the
content side (§9).

---

## 4. The strategy — three engines and a wall

### Engine 1 — THE CANNON (the gate) — target 35–55k/day

**15–20 placed replies per day. That is the entire engine.**

The doctrine, all four rules derived from §2:

1. **Score by `parent_views / (existing_replies + 1)`, never by author size.** Minimum
   viable score: **5,000**. Below that, don't bother. @sama scores 1,307. @dokuneee scores 19,777.
2. **Reply inside 15 minutes.** Non-negotiable — 90.8% of his yield lives there. A target 60
   minutes old is dead. Set the queue's hard expiry at 30 minutes.
3. **Camp a roster, don't search a timeline.** 15–25 accounts, notifications on, checked in
   three short bursts. Five accounts produced 56% of his impressions.
4. **The reply must be a real, specific observation about the parent's content.** His best ones
   are 120–200 characters of genuine engagement. This is the rule that keeps the engine inside
   your doctrine and off the spam classifier.

**Seed roster:** §2.4's table is a pre-validated, measured target list sitting in your own
database at $0 cost. Start with @hiiragi2280, @dokuneee, @yoshi_majime, @y_ganman3, @itaparu99,
@_its__sunny, @tsu_ne_tune — every one measured at >8,000 views-per-existing-reply. Extend by
harvesting each candidate's profile and computing the score (§8).

**Working windows** (EEST, UTC+3 — fits around the hospital):
- **13:00–13:20** — 10:00 UTC, his peak hour. If you can't touch your phone at work, this is the
  one to sacrifice; note that you are giving up his single best window.
- **17:00–17:25** — 14:00 UTC, his second peak. **Your anchor session.**
- **21:00–21:15** — 18:00 UTC, JP late night + US morning.

Three short sessions, ~55 minutes total. This is what 46,500/day costs.

### Engine 2 — THE FORGE (the tail + the payout) — target 5–8k/day + tail

**Two short questions a day, not six.** The previous plan's six/day is why it wasn't executed.
Two is survivable, and the doctrine from `x-growth-plan-opus.md` §6 is unchanged and now
triple-confirmed (your 6 short questions avg 243,857; peers' 263 avg 3,972; thespacerr's top 5
posts all short questions or poll-lists):

- <80 characters, ends in `?`, no jargon, no link (invariant #1), no hashtags.
- The **hour rule** stands: *post only questions you would spend an hour answering.*
- Rotate the eight skeletons; the **era reframe** (your 1.44M shape) and the **named-option
  poll-list** (peer's 135k shape) are the two highest-ceiling ones.
- **Answer your own post within 60 seconds**, then sit in the replies.
- 20:00 EEST is your measured best slot; Sat 14:00 is the week's big swing.

144 swings over 72 days. At your observed hit rates that is 1–2 events over 100k, which is
exactly what §5 needs to close.

### Engine 3 — THE SOUL (the audience) — 1 post/day, non-negotiable

One identity post a day from the unfair angle: 51, the hospital, FoxPro→Claude Code, your wife's
20 SMB clients, the ship-or-die cadence. Measured medians: milestone 866, data_comparison 573,
story 402 — versus `substance` at 149.

**This is the load-bearing wall between the two currencies.** The Cannon buys impressions from
people who will never care about you. The Soul post is the only reason anyone who lands on your
profile stays. Skip it and you become @thespacerr — 2.5M impressions and a 1.6% engagement rate.

### What gets cut

1. **Untargeted replies: 675/14d → ~70/14d.** Keep ~5/day for genuine relationships (your 26%
   profile-click→follow conversion is real and partly comes from these). Everything else is
   reallocated to the Cannon. **You will type fewer replies, not more.**
2. **`@grok` summons, one-word chants, mega-thread lottery plays.** Zero. §2.7.
3. **Follow-for-follow.** Following is frozen at 880. It has held for a week — keep it there.
4. **`substance` posts as default.** 1–2/day max, as Soul posts, not as filler.
5. **Threads.** Nothing supports them at your size.
6. **All stratus features except §7.** One build. One.

---

## 5. Does the model close?

Ramping honestly — you do not start at his yields, you learn the market:

| Week | Dates | placed replies/day | yield each | Cannon/day | floor/day | **total/day** | week |
|---|---|---|---|---|---|---|---|
| 1 | Aug 5–11 | 10 | 400 | 4,000 | 3,000 | 7,000 | 49k |
| 2 | Aug 12–18 | 15 | 800 | 12,000 | 3,500 | 15,500 | 109k |
| 3 | Aug 19–25 | 18 | 1,200 | 21,600 | 4,000 | 25,600 | 179k |
| 4 | Aug 26–Sep 1 | 20 | 1,600 | 32,000 | 4,500 | 36,500 | 256k |
| 5 | Sep 2–8 | 20 | 2,000 | 40,000 | 5,000 | 45,000 | 315k |
| 6 | Sep 9–15 | 22 | 2,200 | 48,400 | 5,500 | 53,900 | 377k |
| 7 | Sep 16–22 | 22 | 2,400 | 52,800 | 6,000 | 58,800 | 412k |
| 8 | Sep 23–29 | 22 | 2,400 | 52,800 | 6,000 | 58,800 | 412k |
| 9 | Sep 30–Oct 6 | 24 | 2,500 | 60,000 | 6,500 | 66,500 | 465k |
| 10 | Oct 7–13 | 24 | 2,500 | 60,000 | 6,500 | 66,500 | 465k |
| — | Oct 14–15 | 24 | 2,500 | 60,000 | 6,500 | 66,500 | 133k |

**Cumulative new: ~3.17M. Plus bank (2.10M native − 110k expiry) = ~5.16M. The base case crosses
on ~Oct 8.**

Note the terminal yield assumption: **2,500 per placed reply is 72% of thespacerr's measured
3,490.** The model does not require you to beat him or match him. (Table is in native terms; the
floor rows are conservative — your true current floor is ~3,355/day, not 3,000.)

| Scenario | Assumption | Oct 15 total |
|---|---|---|
| **Pessimistic** | Cannon yields 40% of model, no tail | ~3.3M ❌ |
| **Base** (table above) | 72% of his measured yield, no tail | **~5.16M ✅** — crosses ~Oct 8 |
| **Base + one tail** | one 200k+ Forge event (144 swings) | ~5.4M ✅ late Sept |
| **Match** | his measured yields + 2 tails | ~6.9M ✅ by mid-Sept |

**The 2.1M native reading changes the character of this plan.** On the proxy's 1.74M the base
case was an agonizing 4.82M miss that *required* a tail event. On the true number the Cannon
alone crosses the line with a week to spare, and the Forge becomes **margin rather than
dependency** — insurance against a bad fortnight, not the thing the plan hangs on. That is the
difference between a coin flip and a plan.

It also means: **the Forge's two questions a day are now negotiable and the Cannon's 20 placed
replies a day are not.** If a day collapses, drop the question, never the 17:00 session.

**Post-Oct-16 reality:** at 66,500/day the machine sustains 5.98M rolling. You survive the cliff.
That is new — neither prior plan's floor did.

---

## 6. The 72-day operating system

```
06:45  (10 min, phone)  Fire Forge question #1. Answer it yourself in one line.
                        Glance at the roster: anything <15 min old scoring >5,000? Reply.
                        Go to work.

13:00  (20 min)         CANNON SESSION 1 — the 10:00 UTC peak.
                        5–7 placed replies. Score >5,000, age <15 min, specific content.
                        Nothing else. No timeline browsing.

17:00  (25 min)         CANNON SESSION 2 — your anchor. 6–8 placed replies.
17:25  (20 min)         Own-thread: answer everyone on today's posts. Every one.

20:00  (20 min)         Forge question #2 at your measured best slot.
                        The Soul post.
                        Answer your own question first, then sit in the replies.

21:00  (15 min)         CANNON SESSION 3 — 4–5 placed replies (JP late / US morning).

21:15  (10 min)         LOG + PREP. Tomorrow's two questions into the calendar.
                        One line in the ledger: placed replies, their total views,
                        best target, roster hits/misses.
```

**~2h00 on a weekday** — 25 minutes less than the previous plan, and the impressions-producing
portion is 65 minutes of mechanical work rather than 90 minutes of creative work.

**Non-negotiables, in priority order when the day collapses:**
1. The 17:00 Cannon session. (If you do one thing, do this.)
2. The Soul post.
3. Forge question #2.
4. Everything else.

**One rest day a week.** Roster stays warm, 5 placed replies, nothing else.

**Sunday (60 min):** roster review — drop any account whose score fell below 5,000, add two
candidates from the harvest. Ledger screenshot → Monday scoreboard post. Recalibrate at stated
sample sizes only.

---

## 7. What to build in stratus — one feature

The build budget was four features. **It is now one**, because the engine is a targeting change
and targeting is 80% shipped already.

### THE CANNON QUEUE — re-target the Radar (2–3 sessions)

Not a new tab. A re-scoring of what exists.

| Piece | Status | Change |
|---|---|---|
| `content.ts` DOM scrape | shipped | also capture parent view count + reply count + post age |
| `extension/src/shared/radar.ts` merge/rank | shipped, fixture-tested | **rank by `parent_views / (existing_replies + 1)`**, not author heat |
| Band union | shipped (`hot`/`roster`/…) | add `cannon`; the GT plan's `'roster'` addition is the worked precedent |
| Roster (2–10× target band) | shipped | see knob change below |
| Reply drafting `/x/replies/generate` | shipped | pass parent text + language; band-gate with `override` |
| Harvest → `harvest_rows` | shipped, $0 | reuse verbatim to score roster candidates |

**Hard requirements from the data:**
- Queue entries **expire at 30 minutes**. A stale entry is worse than an empty queue — it costs
  you a reply slot for a 12-view return.
- Sort key is the cannon score. Show it. Show parent age in minutes, in red past 15.
- Show a live counter: *placed replies today / 18*.
- Roster candidates scored from harvest: `median(views) / median(comments)` over their last ~30
  posts, refreshed weekly, $0.

**Doctrine knob change — do this today, it is a settings edit, not code:**

`targetBandMinX: 2, targetBandMaxX: 10` means you only ever target accounts with 2.4k–12k
followers. **This knob is the single line in your system that guarantees your replies stay
worthless.** The Cannon targets are 100k–2M-follower accounts — 100–2000× your size. Either raise
`targetBandMaxX` far past 10 or exempt the `cannon` band from the check entirely. Keep the 2–10×
band for the relationship/reciprocity replies, where it is correct.

Also: `replyTargetMin/Max: 10/20` is coincidentally right for the Cannon. Keep it.

### Deferred until after Oct 15

The Gauge/Impressions Ledger, the Question Forge generator, the Own-Thread Harvester, the Launch
Kit, the open-source launch, Rung 0/1, Electron, hosted SaaS. **All of it.** The Gauge was #1 in
both prior plans and it hurts to defer — but the harvest already measures per-reply views at $0,
which is the only number the two-week test needs, and every build hour between now and Sept 1 is
a Cannon session you didn't run. Revisit Sept 15 if you are ahead of pace.

---

## 8. The two-week test (Aug 5–18) — already running, and day 1 already replicated the finding

**Track B started Aug 3** (`evals/2026-08-03-reply-target-list.md`: 64 on-niche English handles,
10k–500k followers, post <60 min old, **≥10 existing replies**). First day's readout:

| Day | replies | total imps | **per reply** | best |
|---|---|---|---|---|
| Aug 2 (baseline) | 37 | 646 | **17** | 42 |
| **Aug 3 (Track B day 1)** | **70** | **2,725** | **39** | **1,160** |

**2.3× on day one — the targeting thesis is directionally confirmed on your own account.** But
read the detail, because it is the whole plan in miniature:
| Reply | Views |
|---|---|
| **@Tom_A_Lynch — "Restoring that rubylith mask could reveal the exact first 8080 logic traces."** | **1,160** |
| @Tim_Denning (137k followers, on-list) | 84 |
| @gregisenberg (on-niche) | 61 |
| @danielkleach | 56 |
| @KevinSzabo14 (60k, on-list) | 54 |
| @anupamrjp (17k, on-list) | 45 |

**One reply out of 70 — 1.4% — produced 43% of the day's reply impressions. And it was not on
the list.** Every on-niche, on-list reply landed 45–84 views. The outlier was an off-list,
off-niche post about 8080 chip die photography: high views, almost no replies, and a topic where
**30 years of computing history makes you one of maybe fifty people on X who can say something
specific.**

That is @dokuneee's pattern, in English, found by accident, on day one.

### The three corrections to yesterday's criteria

Yesterday's rules were sound a priori. Today's 1,000-row measurement overturns two of them:

| Yesterday's rule | Verdict | Replace with |
|---|---|---|
| Post is **<60 min** old | ⚠️ **too slow** | **<15 min.** The 15–60 min band yields 205 vs 720 (§2.3). |
| Post already has **≥10 replies** | ❌ **backwards** | **Prefer <10 replies.** That bucket captures 3.30% vs 0.23% for 50–200 (§2.4). ≥10 was a proxy for "the post has reach" — but reply count is precisely the thing that dilutes you. Filter on *views*, then prefer fewer replies. |
| Author has **10k–500k followers** | ❌ **wrong axis** | **Score the post, not the author:** `parent_views / (existing_replies + 1) > 5,000`. Author size is nearly uncorrelated with yield. |

The 64-handle list stays — as your **relationship roster** (Engine 3's audience, the people who
seed your posts and convert to follows). It is the wrong instrument for the Cannon: those
accounts are the crowded English build-in-public core, and 45–84 views/reply is what crowding
pays.

### The revised arms — three now, ~100 placed replies each

| Arm | Targets | Hypothesis |
|---|---|---|
| **A — Japanese** | The §2.4 seed roster (@hiiragi2280, @dokuneee, …). Replies drafted via `askLLM` in Japanese, from your genuine reading of the parent. | Yield ≥1,500/reply |
| **B — English specialist low-crowd** ⭐ | **The lane the 8080 reply found.** Retro/vintage computing, chip & hardware history, computer archaeology, hospital & enterprise IT reality, SMB accounting software. High views, few replies, and your biography (386 → Turbo Pascal → FoxPro → Delphi, hospital IT, your wife's 20 SMB clients) is genuinely rare there. **Promote this to the primary arm** — it has one measured data point at 1,160 and zero doctrine tension. | Yield ≥800/reply |
| **C — English general low-crowd** | Any account scoring >5,000 outside AI/tech: science, finance, general interest, non-tech news. Tests whether the mechanism is "uncrowded" or "specialist." | Yield ≥1,000/reply |

**Measurement, all $0:** harvest your own replies tab and run the §2.2/§2.3/§2.4 queries against
your own rows. You already own every query in this document.

**Decision rules at Aug 18:**
- If **B ≥ 800/reply** → run English-specialist as the primary engine. Same mechanism, zero
  doctrine tension, an audience that can read your posts *and* a lane where you are genuinely
  one of the few qualified repliers. **This is the outcome to hope for, and day 1 hints at it.**
- If **C ≈ B** → the mechanism is crowding, not expertise. Widen to any low-crowd English post
  and stop hand-picking topics.
- If **A ≫ B and C** → the arbitrage really is the Japanese market, and §9's decision becomes
  live. Note this is the *worst* good outcome: highest yield, lowest audience value.
- If **all three < 500/reply** → the mechanism doesn't transfer to your account. Fall back to
  `x-growth-plan-opus.md`'s Forge-at-volume, accept ~40% odds, and say so publicly — that
  post-mortem is excellent content.

**Track the one number that matters, daily:** impressions per reply. 17 → 39 on day 1. The
ladder is 39 → 150 → 400 → 800+. If it stalls under 150 for four days running, you are still
replying to crowded posts and no amount of volume fixes it.

**This test is itself your best content of August.** *"I reverse-engineered a guy selling an X
growth tool. 1,000 of his replies are in my database. Replying to @sama got him 62 views.
Replying to an account 1/10th the size got him 9,763. Here's the table."* That is a tail-class
post, it costs you nothing to write, and it is unfakeable.

---

## 9. Risks, and the line

### The doctrine collision — decide this consciously

Your niche file says: *"Organic growth, no shortcuts — zero bots, auto-reply, or engagement
pods."*

**Where the Cannon sits, honestly:**

| | Verdict |
|---|---|
| Bots | ✅ none — you type/approve every reply |
| Auto-reply | ✅ none — LLM-assisted drafting is what your whole repo already does |
| Engagement pods | ✅ none — no reciprocity arrangement exists |
| Substantive content | ✅ if rule 4 holds; his best JP replies are genuinely good |
| **Aggressive targeting** | ⚠️ **yes — this is the actual change, and it is real** |

The Cannon is not cheating. It is choosing *where* to spend replies by measured return instead of
by habit. That is what every part of your system already does with money.

**Where the line is, and I'd hold it:** `@grok` summons, one-word chants, and any reply you
wouldn't stand behind if the author read it. Those are the moves that took his engagement rate to
1.6%.

**The genuinely uncomfortable part, named:** replying at scale in Japanese, through an LLM, to an
audience that will never read your English posts or buy anything from you. It is not deceptive —
you are making real observations about real content — but it is **transactional**, and it puts
strangers into your reciprocal graph who cannot seed your posts. Arm B of the test exists
specifically to find out whether you need to. **If B works, take B.** If only A works, this is
your call, not mine — the honest framing is: *"I rented 3M impressions from a market I don't
participate in, to clear a threshold, and I told everyone I was doing it."* Said out loud, that is
defensible and it is also a post. Said quietly, it will bother you in November.

### The measured risks

| Risk | Signal | Response |
|---|---|---|
| **Graph dilution** (Grok's warning, now measurable) | your own posts' median views falls 2 weeks running | The Cannon is one-way: **never follow a Cannon target.** If median own-post views drops below 300 for 14 days, halve the Cannon and rebuild reciprocity. |
| **Engagement-rate collapse** (his −58%) | X Analytics engagement rate | Watch weekly. It *will* fall — that's arithmetic, impressions rise faster than engagement. If it falls below 1.0%, the Soul posts aren't doing their job. |
| **Payout ≠ gate** | you cross 5M and the payout is tiny | Expected. The gate is the milestone; the payout scales with the audience Engine 3 builds. Don't let a small first payout read as failure. |
| **Shadowban / spam flag** | reach collapses across all surfaces | You'll run ~25 replies/day total. Their own blog calls 200–400 safe (self-serving, but the direction is clear). You are an order of magnitude under. Rule 4 is the real protection. |
| **The 15-minute window vs. a hospital job** | you can't reply at 13:00 | The 17:00 and 21:00 sessions carry the plan. Roster accounts posting in JP evening (17:00–21:00 EEST) should be weighted up for exactly this reason. |
| **Roster decay** | a cannon account gets discovered and crowded | Sunday review; drop below score 5,000; keep 5 bench candidates. |
| **Oct 16 cliff** | structural, certain | Apply the day you cross. The 66.5k/day terminal rate sustains 5.98M rolling — build for that number, not for Oct 15. |
| ~~**Verified-follower gate (≥500)**~~ | ✅ **CLEARED** (confirmed 2026-08-04, "well over 500") | Retired. Impressions are now the *only* open gate. |

---

## 10. Checkpoints

| Date | Gate | If missed |
|---|---|---|
| **Aug 18** | Test complete, ≥1,000/placed-reply in at least one arm; new cumulative ≥150k | Fall back to opus-plan Forge-at-volume; publish the negative result |
| **Sep 1** | ≥560k new cumulative; 20 placed replies/day habitual; 7d avg ≥35k/day | Roster is wrong — rebuild it from a fresh harvest before touching anything else |
| **Sep 20** | ≥1.9M new; at least one Forge event >50k | Raise Forge to 4 questions/day and re-run the era-reframe shape on three fresh subjects |
| **Oct 1** | Projection ≥4.8M | Accept the miss publicly, re-target Dec 1 on the (by then real) 66k/day machine |

**Weekly KPI row, every Monday, screenshot it, post it:**
rolling window · new cumulative vs. table · placed replies + their total views + views/reply ·
best cannon target · Forge attempts + best hit · own-post median views (the dilution canary) ·
engagement rate · follower delta · following (must stay 880).

---

## 11. Today, in order

1. **Read the monetization page's own impressions counter** (not the analytics tabs) and write
   it down. Verified-follower gate is cleared ✓; this is the only number left.
2. **Change `targetBandMaxX`** so the roster can hold accounts 100× your size (§7). Settings edit.
3. **Fix the two Track B criteria** (§8): `<15 min` not `<60`, and **prefer <10 replies**, not
   ≥10. This costs nothing and it is the difference between 39/reply and 800/reply.
4. **Build the Arm B roster** — the lane the 8080 reply found. Retro/vintage computing, chip
   history, computer archaeology, hospital/enterprise IT, SMB accounting software. Start from
   @Tom_A_Lynch and the accounts he interacts with. Notifications on. **Also** seed the §2.4
   Japanese roster for Arm A — pre-validated by someone else's 1,000 replies already in your DB.
5. **Run one Cannon session at 17:00.** Five replies. Score >5,000, age <15 min, real observation
   about the actual content. Do not wait for the build.
6. **20:00 — Forge question #1 + the Soul post.** Suggested Forge opener, which is also the
   arc's beat 1:
   > *"I put a growth guru's 1,000 replies in a database. Replying to Sam Altman got him 62
   > views. Who's the most overrated account to reply to?"*
7. **21:15 — log it.** Placed replies, total views, per-reply average. That number is the whole
   experiment.
8. **This week:** `/plan-feature` the Cannon Queue (§7). One feature. Then stop building.

---

## Appendix A — the queries

Every number in this document, reproducible at $0 via `x_query`:

```sql
-- §2.2 the reply band ledger (the core finding)
SELECT CASE WHEN orig_views IS NULL THEN 'unknown'
            WHEN orig_views<1000   THEN 'a <1k'
            WHEN orig_views<10000  THEN 'b 1k-10k'
            WHEN orig_views<50000  THEN 'c 10k-50k'
            WHEN orig_views<200000 THEN 'd 50k-200k'
            ELSE 'e 200k+' END parent_band,
       COUNT(*) n, ROUND(AVG(views)) avg_reply_views, SUM(views) total_views
FROM harvest_rows WHERE handle='thespacerr' AND mode='replies'
GROUP BY parent_band ORDER BY parent_band;

-- §2.3 the latency law
SELECT CASE WHEN (tweet_time-orig_time)/60000 < 15   THEN 'a <15min'
            WHEN (tweet_time-orig_time)/60000 < 60   THEN 'b 15-60min'
            WHEN (tweet_time-orig_time)/60000 < 360  THEN 'c 1-6h'
            WHEN (tweet_time-orig_time)/60000 < 1440 THEN 'd 6-24h'
            ELSE 'e >24h' END latency,
       COUNT(*) n, ROUND(AVG(orig_views)) avg_parent, ROUND(AVG(views)) avg_reply, SUM(views) total
FROM harvest_rows WHERE handle='thespacerr' AND mode='replies'
  AND tweet_time IS NOT NULL AND orig_time IS NOT NULL
GROUP BY latency ORDER BY latency;

-- §2.4 the crowding law + the cannon score
SELECT orig_handle, COUNT(*) n_replies,
       ROUND(AVG(orig_views)) avg_parent_views,
       ROUND(AVG(orig_comments),1) avg_parent_replies,
       ROUND(AVG(orig_views)/NULLIF(AVG(orig_comments),0)) views_per_existing_reply,
       ROUND(AVG(views)) my_yield,
       ROUND(100.0*AVG(1.0*views/NULLIF(orig_views,0)),2) capture_pct
FROM harvest_rows WHERE handle='thespacerr' AND mode='replies'
  AND orig_handle IS NOT NULL AND orig_handle<>'thespacerr' AND orig_views>=20000
GROUP BY orig_handle HAVING n_replies>=2 ORDER BY my_yield DESC;

-- §2.10 the control group
SELECT handle, mode, COUNT(*) n, ROUND(AVG(views)) avg_views, SUM(views) total
FROM harvest_rows GROUP BY handle, mode HAVING n>=20 ORDER BY total DESC;

-- §1 your own baseline (run this weekly — it is the experiment's readout)
WITH latest AS (SELECT tweet_id, public_metrics,
    ROW_NUMBER() OVER (PARTITION BY tweet_id ORDER BY snapshot_at DESC) rn
  FROM metrics_snapshots),
j AS (SELECT p.is_reply, date(p.posted_at/1000,'unixepoch') d,
        json_extract(l.public_metrics,'$.impression_count') i
      FROM posts_published p JOIN latest l ON l.tweet_id=p.tweet_id AND l.rn=1
      WHERE p.posted_at > (strftime('%s','now')-14*86400)*1000)
SELECT d, SUM(CASE WHEN is_reply=0 THEN 1 ELSE 0 END) posts,
       SUM(CASE WHEN is_reply=1 THEN 1 ELSE 0 END) replies,
       SUM(i) total_imps,
       SUM(CASE WHEN is_reply=1 THEN i ELSE 0 END) reply_imps
FROM j GROUP BY d ORDER BY d DESC;
```

## Appendix B — reconciliation with the two prior plans

| Claim | Prior plan | Verdict now |
|---|---|---|
| Short questions <80 chars are the top post format | opus §1.1, fable F1 | ✅ **Confirmed a third time.** Kept as Engine 2. |
| "Your replies are worthless, cut them" | opus §4.1, fable F3 | ❌ **Overturned.** Replies are the highest-yield surface; the targeting was the defect. |
| Rank the reply queue by author heat / follower band | fable §4A ("authors 10k–500k") | ❌ **Overturned.** Author size is nearly uncorrelated; `views/(replies+1)` is the variable. |
| Rank the reply queue by conversation *size* | opus §8.2 (`surge` band, "reply velocity × reply count") | ❌ **Inverted.** Big conversations are crowded; capture falls from 3.30% to 0.23%. Rank by *uncrowdedness*. |
| Reply early, within the first hour | both | ✅ **Confirmed and tightened to 15 minutes.** 6–24h replies return 12 views. |
| Six questions a day | opus §5 | ⚠️ **Reduced to two.** Six was never executed; two plus the Cannon closes the model. |
| Build the Gauge first | both, #1 | ⏸ **Deferred.** The $0 harvest measures the only number the test needs. |
| Launch stratus as the narrative engine | fable §5 | ⏸ **Deferred past Oct 15.** The reverse-engineering *analysis* is the launch content, and it costs zero build hours. |
| Premium+ for the sprint | both | ✅ Still yes. ~$40/mo against a reply-heavy system. |
| The Oct 16 cliff | both | ✅ **Unchanged and central.** New: this plan's terminal rate (66.5k/day) actually survives it. |
| Freeze following at ~880 | opus §4.2 | ✅ Held for a week. Keep holding. |

---

*Three accounts, same effort, 154× spread. It was never how hard you type. It was which post you
typed under, and how many minutes had passed.*
