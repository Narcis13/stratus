# x-growth-plan-opus.md

**5,000,000 impressions / rolling 90 days, by mid-October 2026.**

> Written 2026-07-29 by Claude (Opus 5), from your own stratus database — 40 account
> snapshots, 1,209 tracked posts, 1,237 metric snapshots, 2,358 harvested competitor
> posts, the measured Playbook, and the shipped codebase.
>
> This is not a generic growth guide. Every number below came out of your DB. Where I
> am guessing, I say so. Where your data contradicts the Grok plan
> (`x-growth-prospects-grok.md`), I say that too — and I show the query.

---

## 0. The verdict, in one page

**Achievable. Not on your current system. The gap is 7×, and the fix is a format change, not an effort change.**

Three facts decide everything:

1. **You have already done it once.** On 2026-07-17 a single 78-character question post
   did **1,443,048 impressions**, 2,866 replies, 1,013 profile clicks. That one day banked
   1.59M — 32% of the entire 5M target — in about 90 seconds of typing.

2. **Your workhorse activity is your worst-performing activity.** Over the last 21 days you
   published **858 replies. 764 of them (89%) got under 50 impressions.** The reply machine
   costs you 1.5–2h/day and returns roughly **2,000 impressions/day**. That is 3.6% of the
   daily rate you need, for ~60% of your daily time budget.

3. **Your follower growth is not real.** Outside the four-day afterglow of the viral post,
   your daily follower delta tracks your daily *following* delta almost 1:1 (Jul 10: +52/+47,
   Jul 11: +33/+32, Jul 14: +31/+35, Jul 23: +19/+26, Jul 25: +14/+13). You are buying
   followers with follow-backs at ~1:1, your ratio is now 874/1171 = 0.75, and your genuine
   content-driven growth is **+3 to +5/day**. The only days that broke the pattern
   (Jul 19: +80 followers on +23 follows; Jul 20: +79 on +27) were the viral post's echo.

The strategy that follows is built on the one thing your data says works, at volume, with
instrumentation you do not currently have. Stratus's role is not to post for you and not to
be a product you launch — for the next 78 days **stratus is (a) the instrument that tells you
whether you are winning, and (b) the source of content nobody else in your niche can write.**

---

## 1. What your data actually says

### 1.1 The format finding — the single most important number in this document

Grouping your own original posts by shape:

| Shape | n | avg impressions | max | avg replies |
|---|---|---|---|---|
| **Question, <100 chars** | **6** | **243,857** | **1,443,048** | **516** |
| Statement, ≥280 chars | 3 | 1,816 | 2,878 | 28.7 |
| Question, 100–280 chars | 22 | 882 | 10,240 | 9.5 |
| Statement, 100–280 chars | **102** | **508** | 7,585 | 4.9 |
| Statement, <100 chars | 12 | 440 | 1,569 | 7.4 |

Strip the 1.44M outlier and the short-question bucket still averages **4,019 impressions**
against **508** for the bucket where you put 102 of your 145 posts. That is an **8× gap on the
median case and a fat tail on top of it.**

Six posts is thin evidence. So I checked it against an independent sample — your own
`harvest_rows` table, 2,358 competitor posts scraped at $0:

| Peer post shape (n=1,283 across 8 build-in-public accounts) | n | avg views | avg comments |
|---|---|---|---|
| **Question, <80 chars** | **263** | **3,972** | **55.7** |
| Question, 80–160 chars | 281 | 2,608 | 38.5 |
| Statement, 160+ chars | 176 | 2,577 | 34.2 |
| Question, 160+ chars | 75 | 2,286 | 31.4 |
| Statement, <80 chars | 458 | 1,916 | 26.5 |
| Statement, 80–160 chars | 428 | 1,266 | 21.3 |

**Your short questions average 4,019. Their short questions average 3,972 across n=263.**
Two independent samples, one of them large, landing on the same number. This is the most
robustly supported finding in your entire dataset, and it is the plan.

### 1.2 The peer proof — someone in your exact niche already ran this playbook

`@danielsmidstrup` is in `harvest_rows` with 303 posts, **avg 7,073 views**, 83 avg comments.
His own post, harvested in your DB, states his method and his result:

> *"How I got my first X payout: $828.77 in 81 days. 0 → 1k followers in 33 days.
> A few posts a day + tons (50-100) of replies ~2 hrs/day. Step 2 - lock in - 8 posts + 400 replies…"* — 25,512 views

His top posts, from your table:

| Views | Post | Chars |
|---|---|---|
| 135,339 | "Founders, which is the best place to buy a domain? - GoDaddy - Hostinger - Cloudflare - Namecheap - Others" | 106 |
| 128,065 | "Tell me one thing you can do that CLAUDE cannot do yet" | 54 |
| 82,852 | "Why doesn't Claude have an image or video generation model yet?" | 63 |
| 62,607 | "I am a founder scare me with 1 word" | 35 |
| 53,201 | "Founders who cracked distribution: how? Just the thing that worked." | 67 |
| 51,945 | "sell me your startup in two words max." | 38 |
| 41,382 | "At this point if AI writes 90% of code, who even survives in tech??" | 67 |
| 40,059 | "Be honest devs, Is coding still worth learning in the AI era?" | 61 |

Note what is *not* there: no threads, no essays, no screenshots of MRR, no "lessons from
building". At ~7k avg × ~10 posts/day he is generating **~70k/day** — above the 55.6k/day the
5M gate requires. He got monetized in 81 days doing exactly this.

Note also #40,059 — *"Be honest devs, Is coding still worth learning in the AI era?"* — and
your own 1.44M post: *"'Learn to code' was the advice of the 2010s. What's the equivalent
advice for the 2030s?"* Same question. He got 40k. You got 1.44M, because yours reframed it
into a *better question*. Hold that thought; §6 turns it into a rule.

### 1.3 Where the Grok plan is wrong for your account

Grok's advice is competent generic X advice. Against your data, three pieces of it are
actively expensive:

| Grok says | Your data says |
|---|---|
| "Replies are the highest-leverage impression source for accounts under 5–10k. 20–40+ quality replies/day." | 89% of your 858 replies got **<50 impressions**. 774 replies over 14 days produced 163,648 impressions total — and **69% of that came from 4 replies** that happened to sit inside one mega-thread. Median reply ≈ 20–30 impressions. |
| "Avoid engagement bait — the algorithm detects and deboosts it." | Your single best post is a pure conversation-bait question. Your peers' entire top-10 is conversation-bait questions. The Playbook's `hot_take` format (the "sharp take" Grok recommends) has median **47 views** across n=7 — your worst format. |
| "Prioritize formats: native video > threads > image+text > text." | You have 3 posts with media (median 201 views) vs 67 text-only (median **421**). Peer data: photo posts do outperform, video does not. You cannot make video at scale after a hospital shift; ignore this line entirely. |
| "Premium+ for the reply boost" | Directionally reasonable, but the Buffer numbers Grok cites are confounded (people paying $40/mo also post more and better). See §9 for the honest version — it is still probably worth it, for a different reason. |

Grok's one genuinely load-bearing correct claim: **early engagement velocity and conversation
depth dominate distribution.** That is exactly *why* short questions win. Grok identified the
mechanism and then recommended against the format that exploits it.

### 1.4 What the Playbook already measured (and you are not using)

From `x_playbook` (`minN=5`), your measured format table:

| Format | posted | median views |
|---|---|---|
| milestone | 4 | **866** |
| data_comparison | 2 | 573 |
| audience_cta | 21 | **422** |
| story | 17 | 402 |
| confession | 1 | 299 |
| question | 5 | 238 |
| list | 21 | 166 |
| **substance** | **62** | **149** |
| hot_take | 7 | **47** |

**You put 62 posts — 42% of everything you publish — into `substance`, your second-worst
format.** The GT wave already shipped the four reply-bait skeletons into `post prompt.md`
(would-you-rather, poll-list, confessional question, audience CTA). You have used
`poll_list` once, `binary_choice` once, `confession` once. **The highest-leverage change
available to you costs zero lines of code: use the formats you already built.**

### 1.5 The borrowed-distribution finding

Your top replies, by impressions:

| Impressions | Reply text | Length |
|---|---|---|
| 27,725 | "@StouderRory so back to age stone" | 32 chars |
| 23,202 | "@shahriarr_here My new number 1 thing/skill to learn in immediate future" | 71 |
| 21,699 | "@ben3bil Brr, utopia by Davos glibalists." | 41 |
| 12,094 | "@obinique Really? Interesting, what are top 3 things that make them a target?" | 77 |
| 11,488 | "@testudoapp yes, judgement and taste are not an AI thing" | 56 |

These are throwaway replies. Two contain typos. One is three words. They did 27k, 23k, 21k
impressions **because they sat inside a 2,866-reply conversation.** Total from working your
own viral post's comment section on Jul 17–18: **~150,000 impressions.**

This is the second engine. A reply's impressions have nothing to do with its quality and
almost everything to do with **the size of the conversation it sits in.** Your `hot` band in
the Radar ranks by *author* heat. The data says rank by *conversation size right now*.

### 1.6 The funnel that isn't running

`timelineFunnel`: **687 posts seen, 2 replied to.** Rate: 0.3%. `batchVsSingle`: 1,061 replies
`unattributed` — i.e. published outside the tracked drafting path. The Radar/reply machinery
you spent Waves 2 and 7 building is essentially not in the loop. Whatever you decide about
tooling, **the current tooling is not what is producing your 60 replies/day** — you are doing
them by hand, at ~25 impressions each.

### 1.7 The instrument you do not have

`SELECT poll_count, retired, COUNT(*) FROM posts_published GROUP BY 1,2` →
**1,173 rows at `poll_count=1, retired=1`.** Every post is snapshotted exactly once, at an
average age of 240–3,835 minutes, then retired forever.

Consequences:

- Your recorded impressions are a **young, one-shot reading** — systematically 20–40% below
  lifetime, and the bias is *worse for replies* (snapshotted at ~6h) than originals.
- **You cannot see your rolling 90-day total.** The number that decides whether you get
  monetized does not exist anywhere in your system.
- You cannot see the **expiry curve** — how much falls out of the window each day.

This is the #1 thing to build. Details in §8.

---

## 2. The arithmetic — including the cliff nobody has told you about

### 2.1 Where you stand

Measured impressions, 2026-07-17 → 2026-07-28 (i.e. already inside a mid-October window):

```
Jul 17   1,588,200   ← the viral day (post + its comment section)
Jul 18      29,760
Jul 19       3,815
Jul 20      27,486   ← the format's second-best day (19,038 from one question post)
Jul 21       6,747
Jul 22       2,841
Jul 23       2,737
Jul 24       2,772
Jul 25       2,514
Jul 26       2,564
Jul 27       3,879
Jul 28       1,433
─────────────────
           1,674,748  measured
           ~2,100,000  estimated true (correcting for the once-only young snapshot)
```

Baseline run-rate excluding the two spike days: **~3,200 impressions/day measured**,
maybe 4,500 true.

### 2.2 The two targets

**Target A — cross the line by Oct 15 (opportunistic).**
Gap: 5,000,000 − 1,675,000 = **3,325,000 over 78 days = 42,600/day.**

**Target B — hold the line without the viral post (durable).**
5,000,000 / 90 = **55,556/day sustained.**

Both are ~7–13× your current baseline. Target A is 13× on the measured baseline; the format
change in §1.1 is an 8× multiplier by itself, before volume, before the tail, before growth.
**That is why this is achievable and why nothing else you could change would make it so.**

### 2.3 ⚠ The October 16 cliff

**July 17 + 90 days = October 15.**

Your 1.59M day is sitting on the *exact last day* it counts for a mid-October window. On
**October 16 it drops out and your window loses 1.59M overnight.**

This has three hard implications:

1. **"Mid-October" means Oct 15, not Oct 20.** Every day you slip past the 15th costs you
   more than a day's production — on the 16th it costs you a third of the target.
2. **Apply the instant you cross.** Do not wait to look comfortable. Check the monetization
   page daily from ~Oct 1.
3. **Do not build the plan on the spike.** Build for Target B (55.6k/day sustained). Treat
   the July spike as insurance that may let you qualify three weeks early. If you build for
   Target A and land exactly on 5M on Oct 14, you fall off the line on the 16th and the whole
   sprint has to be run again.

**Planning number: 55,000 impressions/day, reached by ~Sept 10 and held.**

### 2.4 Does the model close?

| Engine | Volume/day | Impressions each | Daily |
|---|---|---|---|
| Short-question posts | 6 | 4,000 | 24,000 |
| Own-comment-section replies (on your own live posts) | 12 | 400 | 4,800 |
| Big-thread replies (top 5 conversations of the day) | 8 | 800 | 6,400 |
| Ordinary replies (relationship maintenance) | 15 | 30 | 450 |
| Story / milestone / data posts | 2 | 700 | 1,400 |
| **Sub-total, no tail** | | | **~37,000** |
| Tail events (1 in ~20 questions clears 50k) | ~0.3/day | ~60,000 | ~18,000 |
| **Modelled total** | | | **~55,000** |

The model closes — **on the tail.** 6 questions/day × 78 days = **468 shots.** At your
observed 1-in-6 hit rate that is absurdly optimistic; at your peers' rate (best of 263 = 135k)
expect roughly **20–30 posts clearing 20k and 2–5 clearing 100k** over the sprint. That is the
difference between 3M and 6M, and it is why **volume of shots is the strategy**. You cannot
pick the winner. You can only take 468 swings instead of 40.

Also compounding in your favour and not in the table: follower growth (real growth, not
follow-backs) raises the floor on every post, and each tail event delivers a step-change in
audience the way Jul 17 delivered +262 in four days.

---

## 3. The three engines

Everything in this plan is one of three engines. If an activity isn't one of them, it doesn't
happen between now and October 15.

### Engine 1 — THE FORGE (produces ~24k/day)
Short, genuinely-good questions to the whole niche. 6/day, every day, no exceptions. This is
the swing count. Section 6 is its doctrine.

### Engine 2 — BORROWED DISTRIBUTION (produces ~11k/day)
Two behaviours that both exploit §1.5:
- **Own-thread work.** Every question post you fire, you sit in its replies for 45 minutes and
  answer everyone. Your reply inside your own popping post rides the parent's reach — that's
  where 150k of the Jul 17–18 haul came from.
- **Big-thread infiltration.** Not 60 replies to random people. **8–10 replies inside the
  five largest live conversations in your niche that day.** One reply in a 500-reply thread
  beats forty replies under 200-view posts. This is a targeting change, not an effort change.

### Engine 3 — THE GLASS ENGINE (produces the tail, and the launch)
The content only you can write, because only you measure. This document is a specimen: *"I
analyzed 1,209 of my own posts. 89% of my replies got under 50 impressions. The format
everyone tells you to avoid is the only one that works. Here's the data."* Every one of those
is a tail candidate, and each one is also a stratus advertisement that never mentions stratus.

**This is where the product launch lives.** §9.

---

## 4. What to stop doing (this is the hard part)

You have ~2–4h/day. The plan does not fit unless things are cut. Cut these:

1. **The 60-reply/day machine, as currently practiced.** Cut to ~25/day, all of them targeted
   (Engine 2). You will lose ~600 impressions/day and gain 90 minutes. Reinvest the 90 minutes
   in Engine 1 and get back 24,000.
2. **Follow-for-follow.** Stop entirely. Your ratio is 0.75 and heading the wrong way; you are
   paying for followers that unfollow, and X caps following at 5,000 anyway. Every day you add
   +11 follows for +10 followers you are making the profile look worse for zero real gain.
   Genuine growth (+3–5/day now) will be replaced by tail-event growth (+60–80/day) once the
   Forge is running.
3. **`substance` posts as the default.** 62 of 148, median 149 views. Keep 1–2/day for the
   soul of the account (§6 explains why they still matter). Not 42% of output.
4. **Threads.** Nothing in your data or your peers' data supports them at your size. They cost
   45 minutes and return less than a 60-character question. Revisit after 5M.
5. **Building stratus features that do not appear in §8.** The masterplan is closed at 141/141.
   That is a *good* place to stop. Between now and Oct 15 you are an operator, not a builder —
   with four exceptions, listed in §8.

---

## 5. The daily operating system

Fitted to your actual life: hospital 08:00–15:00 EEST (UTC+3), family, 2–4h available.

Your `x_best_times` says: **Mon 20:00 local = 5,342 avg views (n=5)**, the strongest consistent
cell; hour 20 is the best hour across most days; the 1.44M post went out **Friday 14:16 local**
(= 07:16 ET, the US morning ramp). Your audience is US + India. Two firing windows fit both
your job and your audience:

**Window A — 15:30–17:30 EEST** (= 08:30–10:30 ET, US morning). The viral window.
**Window B — 20:00–22:30 EEST** (= 13:00–15:30 ET, US lunch). Your measured best.

```
07:30  (5 min, phone)   Fire question #1. Cheap, pre-written the night before.
                        Nothing else. Do not open replies. Go to work.

15:15  (10 min)         Triage. Open Today. Check the impressions gauge (§8.1).
                        Did anything from this morning pop? If yes → §Own-thread protocol.

15:30  (25 min)         FORGE BLOCK. Fire questions #2 and #3, 12+ min apart.
                        Then 8 targeted replies in the day's biggest live conversations
                        (Radar surge queue, §8.2). Nowhere else.

16:00  (30 min)         OWN-THREAD BLOCK. Answer every reply on today's posts.
                        Every single one, personally, fast. This is Engine 2 and it is
                        the block people skip. It was worth 150k on Jul 17.

16:30  — off. Life. Dinner. Family.

20:00  (30 min)         FORGE BLOCK 2. Fire questions #4, #5, #6.
                        One story/milestone/data post (the soul post).
                        8 more targeted replies.

20:30  (30 min)         OWN-THREAD BLOCK 2. Answer everything again, including this
                        morning's post if it is still moving.

21:00  (15 min)         TOMORROW. Write tomorrow's 6 questions into the calendar.
                        This is the block that makes 07:30 take 5 minutes.

21:15  (5 min)          LOG. One line in the gauge: today's total, best post, what to
                        repeat. Close the laptop.
```

**Total: ~2h30 on a weekday, split into blocks that fit around a job.** Weekend: same, plus
one 2h build/content session (§8, §9).

**Non-negotiables:**
- 6 questions/day. If you post 4, you have cut your tail probability by a third.
- The own-thread block is not optional. It is the second-highest-yield 30 minutes of your day.
- 21:00 pre-writing is what makes the whole thing survivable. Skip it once and the next day
  costs you 40 minutes you don't have.
- One rest day per week where you fire 3 questions and skip everything else. A plan you
  abandon in week 4 scores zero.

---

## 6. The Forge doctrine — how to write 6 questions a day without becoming a bot

This is the section where the plan collides with your niche identity, and it has to be
resolved rather than shrugged at.

### 6.1 The tension, stated honestly

Your `x_niche` says: *"Content should encode judgment, not just transmit information… the
anti-hustle-hustle: quiet, tool-first independence… substance over spectacle."* Grok says
avoid engagement bait. And I am telling you the highest-yield format on X is a 60-character
question.

`prove me you're not an ai` did 25,968 views. It is also content-free, and posting it would
make you a slightly worse version of someone else's account.

### 6.2 The resolution

**The format is not the problem. Low-effort questions are.** Compare:

- @danielsmidstrup: *"Be honest devs, Is coding still worth learning in the AI era?"* → 40,059
- You: *"'Learn to code' was the advice of the 2010s. What's the equivalent advice for the 2030s?"* → **1,443,048**

Same topic, same format, **36× the result** — because yours *encodes a judgment*. It
presupposes that decades have defining advice, that the 2010s one is now dead, and that
something has replaced it. It is a thesis wearing a question mark. That is exactly what your
niche doctrine asks for, and it happens to be the highest-performing post in your history.

**The rule, and it is the only content rule in this document:**

> **Post only questions you would spend an hour answering.**

If you would not write a 400-word reply to it yourself, it is bait and it does not go out.
This rule costs you nothing in reach (your best post passes it; `prove me you're not an ai`
fails it) and it keeps the account yours.

### 6.3 The eight skeletons that pass the rule

Each of these is measured — from your Playbook, from `harvest_rows`, or from your own 1.44M
post. Rotate; never fire two of the same shape in one day.

1. **The era reframe** — *"X was the advice of [decade]. What's the equivalent for [decade]?"*
   ← this is the 1.44M shape. Highest ceiling you have measured. Use ~once/week, fresh subject
   each time. (You re-ran it 3 days later as *"A junior dev asks: should I still learn to code
   in 2026? One sentence. Go."* → 19,038 and 213 replies. Reruns work; they just don't repeat
   the jackpot.)
2. **The forced-brevity challenge** — *"Explain [hard thing] in one sentence."* / *"sell me
   your startup in two words."* Low answer-cost, high answer-volume. 51,945 in peer data.
3. **The binary with real stakes** — *"[A] or [B]? You lose the other one forever."*
4. **The named-options poll-list** — *"Best [tool] for [job]? — A — B — C — D"* Peer's #1 at
   135,339. Naming brands recruits brand fans into your replies.
5. **The confessional** — *"Be honest: [uncomfortable thing]?"* People answer to confess, not
   to inform.
6. **The practitioner ask** — *"[People who did X]: how? Just the thing that worked."*
   53,201 in peer data. Also genuinely useful to you.
7. **The obituary** — *"What's the thing everyone still does that will look insane in 3 years?"*
8. **The asymmetry** — *"What can you do that [Claude / GPT / an agent] still can't?"*
   128,065 in peer data. Evergreen, re-runnable quarterly with a new model name.

### 6.4 The unfair-angle multiplier

Your niche file names four things nobody else on X has: **51 years old**, **30 years of code
(386 → Turbo Pascal → FoxPro → Delphi → Claude Code)**, **a Romanian public hospital**, and
**your wife's ~20 SMB accounting clients**. Your best non-viral posts are exactly the ones
that used them:

- *"My wife does the books for ~20 small businesses. What it taught me about SaaS…"* → **6,898**
- *"At 51 I measure progress differently: Not followers. Users…"* → **7,585**

Both are ~14× your `substance` median. **Wire the unfair angle into the questions themselves:**

- *"I wrote FoxPro in 1995 and Claude Code in 2026. Which skill from then still pays today?"*
- *"I work IT in a public hospital. What's the most absurd piece of software you've seen in production?"*
- *"My wife does books for 20 small businesses. None of them have heard of any tool on this timeline. What's the most over-built product you've ever seen?"*

These pass the hour rule, they are unrepeatable by anyone else, and they carry your
biography as a payload rather than as a preamble.

### 6.5 The soul posts

One per day, from Window B: the milestone (median **866**, your best format), the data
comparison (573), the story (402). These are why anyone follows you after the question brings
them. **The questions get impressions; the soul posts get followers.** You need both — but
6:1 in favour of questions, not the 1:6 you run today.

### 6.6 Mechanics that are free

- **<80 characters.** Measured, twice, independently.
- **Never a link in the main post.** Also your $0.20 URL surcharge (CLAUDE.md invariant #1).
- **No hashtags.**
- **Answer your own post first**, within 60 seconds, with a real answer. Seeds the thread and
  is the first brick of the own-thread block.
- **12+ minutes between posts.** Your `x_monitor` flags bursts; so does X.
- **Photo when it's honest** (a real screenshot, a real number). Peer data favours photos;
  your n=3 is too thin to trust, and a photo must never be decoration.

---

## 7. Prerequisites — check these this week, before anything else

Do not take these from me or from Grok. **Open x.com/settings/monetization yourself and read
the live requirements**, because they change and both of us are working from stale knowledge.

- [ ] **X Premium active?** Your DB doesn't know. It is a hard gate for Creator revenue
      sharing and it is also the single largest reach multiplier available. If you are not on
      it, nothing else in this plan matters. Do this today.
- [ ] **Read your real 90-day impressions number** in X's native analytics. That is ground
      truth; your DB undercounts (§1.7). Write it down. It is your true starting line and my
      1.67M is a floor, not a measurement.
- [ ] **Verified-follower requirement** — there is a threshold (on the order of 500 verified
      followers) separate from impressions. Check where you stand. This one is *not* solved by
      the Forge, and if you are short it needs its own tactic (§11).
- [ ] **Account age / compliance / region** — Romania is eligible, but confirm payout setup
      (Stripe) works before October, not after.
- [ ] **Set the pinned post** to your best question thread or a "here's the experiment I'm
      running publicly" post. 1,013 people clicked your profile from one post; that traffic
      currently lands on nothing in particular.

---

## 8. Stratus as fuel — what to build (and what not to)

**Budget: four builds. Roughly 12–15 `/masterplan`-sized sessions, one weekend each.**
Everything else waits until after October 15. The masterplan closing at 141/141 is not a
problem to solve; it is permission to stop building and start operating.

I have ranked these by *impressions per build-hour*. Build them in this order.

### 8.1 — **The Gauge** (the impressions ledger + 90-day window) — BUILD FIRST

**Why it's #1:** you are 78 days from a numeric deadline and you cannot see the number. Every
other decision in this plan — pace, whether to double down on a format, when to apply —
depends on a figure that does not exist in your system.

**What it is:**
- **Multi-pass metrics.** Replace once-only with three passes: **T+1h, T+24h, T+7d**. Cost:
  3 × $0.001 × ~10 originals/day = **$0.03/day**; add a single T+24h pass for replies at
  ~25/day = **$0.025/day**. Whole campaign ≈ **$5**. You currently spend $0.10–0.40/day, so
  this roughly doubles a trivially small bill. Worth it.
- **⚠ The trap:** CLAUDE.md invariant #7 — *a billed read must be unrepeatable; retire before
  you snapshot.* The current design retires globally after one pass. A multi-pass design must
  **claim per-pass** (`next_poll_at` + a per-pass claim in a committed txn before the billed
  call), not relax the retire rule. Getting this backwards is the $3.71 bug. Write the plan
  with `/plan-feature` and make this the first line of the task block.
- **The 5M gauge card on Today:** rolling 90-day total · days to Oct 15 · required daily rate
  from here · projected crossing date · **the expiry curve** (what drops out of the window in
  the next 7/14/30 days — this is the only surface anywhere that would have told you about the
  Oct 16 cliff).
- **MCP tool `x_impressions_window`** so you can ask me "am I on pace?" in one call.
  (Remember: +1 MCP tool = bump `src/mcp.test.ts`'s exact 23 and `docs/s2-mcp-server.md`'s
  three counts in the same commit.)

**Impressions it produces directly:** zero. **Impressions it protects:** all of them.
It is also the single best piece of content in the plan — the screenshot of a live gauge
counting toward 5M is the build-in-public artifact of the whole quarter (§9).

### 8.2 — **Surge Radar** (fix the reply funnel to target conversations, not authors)

**Why:** 687 seen / 2 replied, and your 27k replies came from thread *size*, not author size.

**What changes:** a new band, `surge` — a post <90 minutes old whose reply count is climbing
fast, from any author above ~5k followers. Rank the Radar queue by **expected borrowed
impressions** (reply velocity × current reply count), not by author heat. `content.ts` already
sees the timeline; `extension/src/shared/radar.ts` already does merge/rank; the RC curation
score already exists to be re-weighted. This is a scoring change plus one band value — the GT
plan already added `'roster'` to the same union, so there is a worked precedent.

**Yield:** turns 25 targeted replies/day from ~30 impressions each into ~800. ≈ **+6,000/day.**

### 8.3 — **Own-Thread Harvester**

**Why:** ~150,000 impressions on Jul 17–18 came from working your own comment section, by hand,
once. It has never been systematized.

**What it is:** when one of your own posts crosses N replies, its comment section becomes a
work queue in the panel — every unanswered replier listed, sorted by their follower count, with
a one-click relationship-aware draft (the machinery all exists: `/x/replies/generate`,
band-gating with `override`, the dossier). Plus a push notification the moment a post starts
moving, because the window is hours, not days.

**Yield:** ≈ **+4,800/day**, and it converts a tail event from a one-day spike into a two-day
one.

### 8.4 — **The Forge** (question generator + scorer)

**Why:** 6 questions/day × 78 days = 468 questions. You will not hand-write 468 good ones after
a hospital shift. This is the block that decides whether the plan survives week 3.

**What it is:**
- A batch surface: pick a skeleton (§6.3) + a pillar + optionally your unfair angle → 20
  candidates → you pick 6 → straight into the calendar with jitter.
- **A scorer trained on data you already own.** `harvest_rows` has 2,358 competitor posts with
  view counts. Fit the measured correlates — length <80, ends in `?`, names a concrete
  entity/brand, answerable in under 5 words, no jargon, no link — and score candidates against
  it. This is the honest version of the "reach band" the static coach already ships; it just
  needs the question-specific features and the harvest corpus as its training set.
- Enforce the hour rule as a hard gate in the UI: a checkbox you must tick, labelled *"I would
  spend an hour answering this."* Silly, and it will save the account's voice.
- The four GT skeletons are already in `post prompt.md`. This surfaces them instead of hoping
  the drafter picks them.

**Yield:** it doesn't add impressions per post; **it is what makes 6/day sustainable**, which
is the entire tail strategy.

### 8.5 — Explicitly NOT before October 15

- ❌ **Electron surface.** Weeks of work, and it *removes* your moat. Stratus's wedge is that
  it lives inside x.com — ambient intelligence at the point of decision. An Electron window is
  a worse dashboard competing with every other dashboard. The problem Electron is trying to
  solve is install friction; §9.3 solves that differently and more cheaply.
- ❌ **Multi-tenant / hosted SaaS.** Months. Zero impressions before October.
- ❌ **Any new masterplan wave.** Four builds. That's the budget.
- ⏸ **Atlas, Shipping League, ship duels** (`crazy_ideas.md` ideas 1–2). Genuinely good; they
  need an audience to be worth building. Park until you're past 3,000 followers — which the
  Forge should deliver by late September, at which point the Atlas becomes the *next* quarter's
  engine.

---

## 9. The launch — how releasing stratus becomes fuel

You're right that this can be a cornerstone. But it needs one correction first, because the
plan changes completely depending on which claim you're making.

### 9.1 The correction

**For the next 78 days, launching stratus does not bring you users. It brings you material.**

Be clear-eyed about the install funnel: Bun + a Hetzner box + systemd + X OAuth (with the
console.x.com Production-environment bug) + an xAI or OpenRouter key + an unpacked Chrome
extension. That is a 45-minute setup for a competent developer with a working X developer
account. In the build-in-public niche, realistically **1–2% of people who star the repo will
run it, and roughly 0% of the non-developers will.** Open-sourcing will produce a stars spike,
a HN/Reddit thread, and a lot of "this is insane, nice work" — and almost no installs.

**That is fine, and it is still worth doing** — as long as you're buying the right thing. You
are buying:

- **A credibility artifact.** *"41 tables, 1,935 tests, 141 planned tasks, penny-accurate cost
  accounting, built by a 51-year-old hospital IT admin in six weeks with Claude Code"* is one
  of the strongest posts available to anyone in this niche in 2026. Nobody can argue with a repo.
- **A permanent content well.** Every subsystem is a post: the $0.20 URL surcharge guard, the
  $3.71 double-read bug, the token-rotation mutex, the once-only snapshot, the 141-task
  masterplan. These are *war stories with receipts* — the highest-trust content there is.
- **A reason for large accounts to quote you.** Open source is quotable in a way a product is not.

What you are **not** buying: users, MRR, or a growth loop from the tool itself. Don't design
for those before October.

### 9.2 The verdicts you asked for

| Option | Verdict | Why |
|---|---|---|
| **Open source the repo** | **Yes — Sept, as an artifact** | Highest content yield per hour of any launch move. Public repo, honest README, "self-host at your own risk, this is my single-user system" framing. Don't promise support. |
| **BYOK free tier** | **Yes, but it's not the barrier** | Keys aren't what stops people; the stack is. BYOK is the right *license* posture (no one should send you their X tokens) — just don't expect it to move installs. |
| **Electron** | **No** | See §8.5. Kills the moat, costs weeks, solves the wrong problem. |
| **Hosted SaaS** | **Not before 5M** | If the launch produces real demand, that's Q4's problem — and a great one to have. |
| **Extension-only "lite" mode** | **Yes — but announce now, ship after Oct 15** | This is the *actual* low-barrier product (§9.3). It's also a real build, and it is not allowed to eat Forge time. |

### 9.3 The friction ladder — the low entry barrier you're looking for

Four rungs, each with genuinely lower friction than the one below. **Only rungs 0 and 1 ship
before October 15.**

**Rung 0 — The Glass Page. Zero install. Ship by ~Aug 20.**
One public read-only URL on your domain: the live 5M gauge, the format table from §1.1, the
running experiment queue, and the monthly bill. *"My entire growth stack costs $4.72/month"*
is a viral-shaped sentence in the era of API-pricing rage, and unlike everyone else's version
of that sentence, yours has a ledger behind it. Nearly all of this is rendering over already-
shipped code (`/cost/daily`, playbook, the new gauge). **This is the "what app is that?"
magnet, and it is the demo.**

**Rung 1 — One free thing that needs no account. Ship by ~Sept 5.**
A single page where anyone pastes a draft tweet and gets back the Forge scorer's verdict
against your measured corpus: predicted band, what's wrong with it, the nearest high-performing
shape from the 2,358-post harvest. No signup, no keys, no install. Every use is a screenshot,
every screenshot cites your data. This is the rung that actually spreads, and it's a weekend
of work on top of 8.4.

**Rung 2 — The open repo. ~Sept 15.** Credibility artifact (§9.1).

**Rung 3 — Extension-lite, no server, no keys. After Oct 15.**
The genuinely low-barrier product: install the extension, get person chips, the ambient
dossier, harvest, and radar banding running purely on the DOM + `chrome.storage`, with no
server, no OAuth, no API cost. Your pure cores already live in `extension/src/shared/` and are
fixture-tested — the work is a local storage layer standing in for the server. *"X, but I
remember everyone"* is stratus's most demo-able moment and it needs **zero** of the stack. This
is the real product. It is also a real project, and shipping it before October would cost you
the 5M.

### 9.4 The launch arc — six weeks of content, not one launch day

A launch is one post. An arc is thirty. Run the arc.

| Week | Beat | The post |
|---|---|---|
| Aug 10 | **The public bet** | *"I'm going to hit 5M impressions in 90 days to get monetized. I built the tool that measures it. Everything public — the number, the code, the bill. Here's the gauge."* + Rung 0 screenshot. Pin it. |
| Aug 17 | **The uncomfortable data** | *"I analyzed 1,209 of my own posts. 89% of my replies got under 50 impressions. The thing everyone told me to do is the thing that doesn't work."* ← this is the highest-tail-probability post in the plan. |
| Aug 24 | **The war story** | The $3.71 bug: *"I read one tweet 3,712 times because I wrote the transaction in the wrong order. Here's the invariant I now put in every project."* |
| Aug 31 | **The age angle** | *"I'm 51. I wrote FoxPro in 1995. I shipped 41 database tables in 6 weeks with Claude Code. Here's what 30 years of coding is actually worth in the AI era."* |
| Sep 7 | **The free thing** | Rung 1 ships. *"Paste a tweet, get it scored against 2,358 real posts. Free, no signup."* |
| Sep 15 | **Open source** | The repo. *"Here's the whole thing. 41 tables, 1,935 tests, the cost ledger, the mistakes."* |
| Sep 22 | **The mid-sprint number** | Whatever the gauge says. Honest either way — *"I'm at 3.1M and I'm behind"* outperforms *"crushing it"* in this niche, every time. |
| Oct ~15 | **The payoff** | Either *"I hit 5M. Here's every number, every format, every mistake"* — or the honest miss, which is nearly as good a post and far better for trust. |

**Two rules for the arc:**
1. **Every beat is a question post, not an announcement.** *"I analyzed 1,209 of my own posts —
   what's the piece of X advice you've found is completely wrong?"* Announcements get 500
   impressions. Questions with the announcement embedded get 40,000.
2. **Never link in the main post.** Link in the first reply. (Also invariant #1: $0.20 vs $0.015.)

### 9.5 Why this compounds into the product

The meta-loop from `crazy_ideas.md`, sharpened: **stratus makes the account grow → the growth
is public proof → the proof is the marketing.** And if you get monetized in October using your
own tool, you own the one claim nobody in this space can fake: *"I built it, I ran it on
myself, here's the payout screenshot and here's the repo."* @danielsmidstrup's payout post did
62,143 views with 1,234 likes — the highest-engagement post in your entire harvest corpus.
**That post is your October 15 target, and hitting 5M is how you earn the right to write it.**

---

## 10. The eleven-week calendar

| Week | Dates | Focus | Daily impressions target | Cumulative (window) |
|---|---|---|---|---|
| **0** | Jul 29 – Aug 2 | Prerequisites (§7). Premium. Read real analytics. **Start 6 questions/day on day one — do not wait for tooling.** Build the Gauge. | 10,000 | ~1.75M |
| **1** | Aug 3 – 9 | Forge by hand. Own-thread block becomes habit. Gauge live. | 18,000 | ~1.88M |
| **2** | Aug 10 – 16 | **Launch arc beat 1 (public bet).** Build Surge Radar. Cut replies to 25 targeted. | 25,000 | ~2.05M |
| **3** | Aug 17 – 23 | **Beat 2 (the data post) — first real tail attempt.** Build Own-Thread Harvester. | 32,000 | ~2.28M |
| **4** | Aug 24 – 30 | **Beat 3 (war story).** Build the Forge generator. Rung 0 (Glass Page) live. | 40,000 | ~2.56M |
| **5** | Aug 31 – Sep 6 | **Beat 4 (age angle).** All four builds done. **Builder mode ends here.** | 48,000 | ~2.90M |
| **6** | Sep 7 – 13 | **Rung 1 ships (free scorer).** Pure operating. | 55,000 | ~3.28M |
| **7** | Sep 14 – 20 | **Open source (Rung 2).** Biggest spike attempt of the sprint. | 55,000 + spike | ~3.70M |
| **8** | Sep 21 – 27 | **Beat 7 (mid-sprint number).** Assess honestly. Escalate if behind (§11). | 60,000 | ~4.12M |
| **9** | Sep 28 – Oct 4 | Full aggression. Every skeleton, max volume. Check monetization page daily. | 65,000 | ~4.57M |
| **10** | Oct 5 – 11 | Closing sprint. Re-run your two best question shapes on fresh subjects. | 65,000 | ~5.02M ✅ |
| **11** | Oct 12 – 15 | **Apply the moment you cross.** Then keep the rate up — §2.3, the cliff is Oct 16. | 65,000 | — |

Cumulative assumes no tail events beyond the modelled average. **One 200k post moves every
row after it by a week.** That is the whole reason for 468 swings.

---

## 11. Risks, and what to do about each

| Risk | Signal | Response |
|---|---|---|
| **No tail event lands by Sep 21** | Gauge shows <3.5M with 24 days left | Raise questions from 6 to 9/day. Re-run the *exact* era-reframe shape (your 1.44M) on three fresh subjects in one week. It has a proven 1-in-6 rate in your own data; that is the highest-variance lever you own and week 8 is when to pull it. |
| **The Oct 16 cliff** | Structural, certain | Apply the instant you cross. Build for 55.6k/day sustained, not for the Oct 15 number (§2.3). |
| **Verified-follower threshold unmet** | Check in week 0 | The Forge does not solve this. Fix: the soul posts + own-thread work convert Premium users specifically; also, being *featured* by verified accounts (the Atlas/style-breakdown play) recruits them. If you're materially short in week 4, this becomes its own workstream. |
| **Voice erosion — the account stops being yours** | You feel embarrassed posting; the "hour rule" checkbox gets ticked reflexively | Hard stop: 1 soul post/day, minimum, forever. If you can't write the soul post you're too tired to be posting at all. Re-read §6.2. |
| **Burnout in week 4** | Missed pre-writing block two days running | The pre-write block at 21:00 is the load-bearing habit; protect it above everything except the 6 posts. Take the weekly rest day *before* you need it. |
| **Build eats operating time** | It's week 6 and the Forge isn't done | **Ship the plan without it.** Hand-write the questions. Four builds is a budget, not a promise — the Gauge is the only one that's genuinely non-negotiable. |
| **X policy / algorithm shift** | Sudden reach collapse across all formats | Your `x_monitor` and the gauge will show it within 48h. Diversify shape mix, drop volume 30%, wait a week. Do not panic-post. |
| **Reply-farm perception** | People calling you out | The hour rule is the defence, and it's real. Also: reply to every single person who answers. An account that answers 200 replies personally is not a bait account, whatever its post shapes. |

---

## 12. What to do tomorrow morning

Not next week. Tomorrow, 2026-07-30.

1. **07:00** — Open x.com/settings/monetization. Confirm Premium. Write down your real 90-day
   impressions number from native analytics. (10 min. This is the only true baseline.)
2. **07:30** — Post question #1. Suggested opener, since it's also launch-arc beat 0 and it
   passes the hour rule:
   > *"I'm 51 and I've been writing code since the 386. What's the one skill from before AI that's worth more now than it was then?"*
3. **07:35** — Answer your own post with your real answer. Two sentences. Go to work.
4. **15:30** — Questions #2 and #3. Then **answer every single reply on #1.** Every one.
5. **20:00** — Questions #4, #5, #6. One soul post.
6. **21:00** — Write tomorrow's six into the calendar. Then run `/plan-feature` for **the Gauge**
   (§8.1) — and make invariant #7 (retire-before-you-snapshot, per pass) the first line of the
   task block.

You do not need a single new feature to start. You need to change what you type into the box,
six times a day, starting tomorrow.

---

## Appendix A — the queries behind every claim

Reproducible against your live DB via `x_query` (all $0, all local):

```sql
-- §1.1 the format finding
WITH latest AS (SELECT tweet_id, public_metrics,
  ROW_NUMBER() OVER (PARTITION BY tweet_id ORDER BY snapshot_at DESC) rn
  FROM metrics_snapshots)
SELECT CASE WHEN p.text LIKE '%?%' THEN 'question' ELSE 'statement' END q,
       CASE WHEN length(p.text)<100 THEN 'short'
            WHEN length(p.text)<280 THEN 'mid' ELSE 'long' END len,
       COUNT(*) n,
       ROUND(AVG(json_extract(l.public_metrics,'$.impression_count'))) avg_imps,
       MAX(json_extract(l.public_metrics,'$.impression_count')) max_imps,
       ROUND(AVG(json_extract(l.public_metrics,'$.reply_count')),1) avg_replies
FROM posts_published p JOIN latest l ON l.tweet_id=p.tweet_id AND l.rn=1
WHERE p.is_reply=0 GROUP BY q,len ORDER BY avg_imps DESC;

-- §1.1 the peer confirmation (n=1,283)
SELECT CASE WHEN text LIKE '%?%' THEN 'question' ELSE 'statement' END q,
       CASE WHEN text_len<80 THEN 'short<80'
            WHEN text_len<160 THEN 'mid80-160' ELSE 'long160+' END len,
       COUNT(*) n, ROUND(AVG(views)) avg_views, ROUND(AVG(comments),1) avg_comments
FROM harvest_rows WHERE views>0 AND handle IN
  ('danielsmidstrup','bratdotai','thespacerr','kevinszabo14',
   'jonbuildshq','i_mika_el','thegbreaker','anupamrjp')
GROUP BY q,len ORDER BY avg_views DESC;

-- §1 the reply distribution (89% under 50)
WITH latest AS (SELECT tweet_id, public_metrics,
  ROW_NUMBER() OVER (PARTITION BY tweet_id ORDER BY snapshot_at DESC) rn
  FROM metrics_snapshots),
j AS (SELECT p.is_reply, json_extract(l.public_metrics,'$.impression_count') i
  FROM posts_published p JOIN latest l ON l.tweet_id=p.tweet_id AND l.rn=1
  WHERE p.posted_at > (strftime('%s','now')-21*86400)*1000)
SELECT is_reply, COUNT(*) n,
       SUM(CASE WHEN i<50 THEN 1 ELSE 0 END) under50,
       SUM(CASE WHEN i>=1000 THEN 1 ELSE 0 END) over1k
FROM j GROUP BY is_reply;

-- §1.3 the follow-back finding
SELECT date(snapshot_at/1000,'unixepoch') d, followers_count f, following_count fg,
       followers_count - LAG(followers_count) OVER (ORDER BY snapshot_at) dF,
       following_count - LAG(following_count) OVER (ORDER BY snapshot_at) dFg
FROM account_snapshots ORDER BY d;

-- §1.7 the once-only snapshot
SELECT poll_count, retired, COUNT(*) n FROM posts_published GROUP BY 1,2;
```

Plus `x_playbook(minN=5)` for §1.4 and `x_best_times(tzOffsetMin=-180)` for §5.

## Appendix B — the numbers, for the weekly review

Re-read these every Sunday and update. If a number moves the wrong way for two weeks, the
strategy is wrong, not your effort.

| Metric | Jul 29 baseline | Week 4 target | Week 8 target | Oct 15 |
|---|---|---|---|---|
| Rolling 90d impressions (X native) | ~1.7–2.1M | 2.6M | 4.1M | **5.0M** |
| Daily impressions (7d avg) | ~3,200 | 40,000 | 60,000 | 65,000 |
| Question posts/day | 0.2 | 6 | 6–9 | 9 |
| Replies/day | 60 | 25 targeted | 25 targeted | 25 |
| Median impressions/original | ~185 | 1,500 | 3,000 | 4,000 |
| Posts >20k impressions (cumulative) | 1 | 3 | 12 | 25 |
| Followers | 1,171 | 1,800 | 3,000 | 4,000 |
| Following (must not grow) | 874 | ≤880 | ≤880 | ≤880 |
| Monthly API+LLM spend | ~$5 | ~$12 | ~$12 | ~$12 |

---

*Written from your data, not from best practices. The single number to remember: 89% of your
replies get under 50 impressions, and six short questions averaged 243,857. Change what goes
in the box.*
