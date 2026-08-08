# x-monetization-pivot-claude.md — What stratus becomes under Original Content Rewards

> Written 2026-08-08 by Claude (Opus 5), from the live stratus DB, the eligibility
> screenshot read the same morning, and X's published Original Content Rewards rules.
> **This is not a growth plan.** It is an audit of the *tool*: which parts of stratus
> just became load-bearing, which just became dead weight, and what has to be built
> because the number X now counts is a number stratus cannot currently see.
> **Supersedes the build section (§7) of `x-growth-plan-v3.md`.** The measurement work
> in that document (the crowding law, the latency law, the roster method) is still
> correct — it is now pointed at a currency that no longer pays.

---

## 0. The verdict, up front

Three sentences.

1. **Replies are now worth exactly zero toward the gate**, and ~95% of your daily
   output is replies. The Cannon was built to buy a currency that has been withdrawn.
2. **~90% of your current 259.1K is one post from July 17**, and that post ages out of
   the window on **October 15** — the same cliff as before, except now it takes almost
   your entire balance with it instead of a third of it.
3. **stratus has no instrument for the only number that matters.** There is no X API
   field for "verified Home Timeline impressions." The counter exists in exactly one
   place — the monetization page's DOM — and the extension already has a shipped,
   tested pattern for scraping exactly that kind of thing ($0, passive, opportunistic).
   That is the first build.

The good news, which is real: **the gate got 10× smaller in absolute terms.** One
Jul-17-class post is now worth **~40–47% of the entire requirement**. Under the old
5M rule it was worth 29%. The tail event went from "helpful" to "nearly sufficient."
stratus's job changes from *placing replies* to *manufacturing and detecting tail-class
originals* — and almost every dormant asset in this repo (voice templates, articles,
studio, launch room, the reach band) was already built for that job and starved of use.

---

## 1. What actually changed

Effective **2026-08-07**, X replaced Creator Revenue Sharing with the **Original
Content Rewards Program**. Revenue sharing ends after **Sept 7**; existing members
reapply from **Sept 8**; everyone else can apply now.

### 1.1 The gate, as it reads on your own screen

| Requirement | Status |
|---|---|
| Premium / Premium+ / Premium Business | ✓ |
| 18+ | ✓ |
| **500 Verified followers** | ✓ |
| **500,000 Verified Home Timeline impressions, last 90 days** | ✗ — **259.1K** |
| — | *"Does not include replies"* |

Four words on that card do more damage than the whole of `x-growth-plan-v3.md`:
**"Does not include replies."**

### 1.2 The four filters stacked on the word "impressions"

The old gate counted *impressions*. The new one counts impressions that survive four
independent filters, and each one throws away most of what you produce:

| Filter | What it removes |
|---|---|
| **Original posts only** | every reply, at any placement, at any yield |
| **Home Timeline only** | profile visits, search, notifications, permalink/detail views, quote-context views |
| **Verified viewers only** | every impression served to a non-Premium account |
| **Original content only** | reposts, "minimal edits" (a word changed, a filter, a speed change, a text overlay), content copied from other platforms, secondary posts without substantive analysis, Community-Noted posts, and **"content generated using automated tools to create engagement"** |

Two consequences that matter for how this repo is built:

- **Attribution now flows upstream.** X says it "allocates impressions from reposted
  content to the original creator when the source is accurately identified." Quoting
  or reposting someone else without substantive commentary now *donates* your reach to
  them. Conversely, when others repost you, that reach comes back to you.
- **The originality rule is enforced, not aspirational.** X has already cut payouts to
  aggregator accounts this cycle. See §6 — this is the one place where stratus, as an
  LLM drafting tool, carries genuine policy risk.

The payout *rate* is unpublished. Don't model revenue; model the gate.

**Sources:** [X Help — Original Content Rewards](https://help.x.com/en/using-x/original-content-rewards) · [Engadget](https://www.engadget.com/2232981/x-replacing-revenue-sharing-with-original-content-rewards-program/) · [Social Media Today](https://www.socialmediatoday.com/news/x-boosts-incentives-for-original-content-creators/817271/) · [IntraMind](https://blog.intramind-srl.com/en/home/post/x-payouts-original-creators-win-reposts-lose)

---

## 2. Where you actually stand — measured, not assumed

All of this is from `posts_published` × `metrics_snapshots`, latest snapshot per tweet,
90-day window, run today. Reproducible queries in Appendix A.

### 2.1 The split that ends the reply era

| | posts | impressions | per unit | **counts toward gate** |
|---|---|---|---|---|
| **Originals**, 90d | 193 | **1,567,048** | 8,119 | ✓ (after 3 more filters) |
| **Replies**, 90d | 1,544 | 184,327 | 119 | ✗ **zero** |

1,544 replies. 184,327 impressions. **All of it now worth nothing toward eligibility.**

And it is worse than that ratio suggests, because output is *dominated* by replies.
From `account_snapshots`, `tweet_count` deltas over the last four days:
**+97, +111, +125, +142 tweets/day.** Originals in the same window: **3, 3, 6, 3.**

> **~2.5% of your published output is eligible content.**

### 2.2 The 92% problem

| Date | Post | Impressions | Share of 90d originals |
|---|---|---|---|
| **2026-07-17** | *"'Learn to code' was the advice of the 2010s. What's the equivalent…"* | **1,443,048** | **92.1%** |
| 2026-07-20 | *"A junior dev asks you: 'Should I still learn to code in 2026?'"* | 19,038 | 1.2% |
| 2026-07-17 | *"Hello from the build-in-public trenches 👋 51yo veteran dev…"* | 10,240 | 0.7% |
| 2026-07-17 | *"At 51 I measure progress differently…"* | 7,585 | 0.5% |
| 2026-07-06 | *"My wife does the books for ~20 small businesses…"* | 6,898 | 0.4% |
| — | **everything else (188 posts)** | **~80,000** | 5.1% |

Non-spike originals average **646 views**. Over the last 14 days they average **390**.

### 2.3 The conversion ratio — and what it implies about the counter

The counter reads 259,100. Total original impressions in the same 90-day window read
1,567,048 (proxy; native runs ~21% higher, so ~1.9M).

```
verified-HT share of original impressions ≈ 259,100 / 1,900,000 ≈ 13.6%
```

Now bound the spike's contribution. Non-spike originals total ~150K native. Even at a
physically impossible 100% conversion they could account for at most 150K of the
counter. At a realistic 15–25% they account for **22K–37K**.

> **Under every plausible assumption, 86–91% of your 259.1K comes from one post.**
> Strip it out and the account earns roughly **230–410 verified Home Timeline
> impressions per day.**

### 2.4 The cliff is now existential, not annoying

Jul 17 + 90 = **Oct 15**. On **Oct 16** the counter drops by ~230K.

- Under the old 5M rule the spike was 29% of the requirement. Losing it hurt.
- Under the new 500K rule the spike is **~46% of the requirement, and ~90% of your
  balance.** Losing it is the difference between "nearly there" and "starting over."

**You must cross 500K before Oct 15, or the spike's departure resets you to ~25K.**

### 2.5 What the gate costs, three honest ways

Needed by Oct 15: **+240,900 verified HT impressions in 68 days = 3,543/day**, which
at ~14% conversion means **~25,300 raw original impressions per day**.
Current: ~1,726/day proxy (~2,090 native). **A 12–15× gap.**

To *hold* 500K rolling afterward: **5,556/day verified HT ≈ 40,000 raw/day.**

| Path | What it requires | Verdict |
|---|---|---|
| **Volume** | 100 posts/day at today's 390-view average | Not a path. |
| **Floor lift** | 5–6 posts/day averaging 4,000–8,000 views | A 10–20× per-post lift. Not "more posts" — a different *class* of post. |
| **Tail** | **2–3 Jul-17-class posts per rolling 90 days** | You have produced exactly one in ~5 months (~1 per 750 originals). |
| **Realistic hybrid** | Raise the floor 3–5× *and* raise the swing rate | The only credible shape. |

**This is the sentence that should drive every build decision below:**

> The gate is now small enough that **one tail-class original is ~46% of it**, and the
> entire reply machine is 0% of it. stratus must stop being a reply-placement engine
> and become a **tail-event factory with a working odometer.**

### 2.6 The one thing replies are still good for — and the roster is wrong for it

Followers: **1,184 (Aug 4) → 1,251 (Aug 8) = +16.8/day**, against +13/*week* before the
Cannon started. The reply engine is a genuine follower pump — roughly **9× faster** than
anything else you have run.

That still matters, because Home Timeline distribution starts with your follower graph.
But look at who the Cannon is actually camping (`cannon_targets`, all 9 rows):

```
9to5mac · pokerstars · fabrizioromano · trollfootball · themadridzone
drunkgreaiish · ariawestcott · marioaguilarmg · aiwithayesha
```

Football, poker, Apple rumours. **Zero topical overlap with "51-year-old builder."**
Under the old rule this was fine — you were renting raw impressions. Under the new one
it is actively counterproductive:

- Followers acquired there will not be shown your builder originals (low affinity), and
  when they are, they won't engage — which depresses the early-engagement signal that
  decides Home Timeline fan-out for *everyone else*.
- Their Premium density is unknown and probably low; a non-Premium follower contributes
  literally nothing to the counter.
- Every one of them dilutes the graph the algorithm reads to decide who sees you.

**Your own instinct in framing this task is correct and the data supports it:** replies
stay, at lower intensity, retargeted to **adjacent niches whose followers are plausibly
Premium and plausibly interested in what you post.** That is a roster change and a
scoring change, not a teardown.

Also worth noting, since v3 froze it deliberately: **following crept 880 → 938 (+58).**

---

## 3. How to read the audit below

Three questions per subsystem:

- **Does it produce eligible impressions?** (originals, home timeline, verified viewers)
- **Does it measure something that still exists?**
- **Is it dormant capacity, or is it dead weight?**

---

## 4. The stratus audit

### 4A. What just became dead weight — de-scope, don't delete

| Subsystem | Files | What changed | Action |
|---|---|---|---|
| **Cannon queue** | `src/shared/cannon.ts`, `src/x/cannon/{roster,membership}.ts`, `src/x/routes/cannon.ts`, `extension/src/cannon.ts`, `cannon_targets` | Scores `parent_views/(replies+1)` — a formula for maximising **reply** impressions, which are now uncounted | **Keep the machine, change the objective function.** Re-score for *follower conversion in adjacent niches*, not raw parent reach. Rebuild the roster (§7). |
| **Multilingual replies** | `src/shared/language.ts`, `src/x/replies/language.ts`, `src/x/replies/mode.ts`, `extension/src/{language,replyMode}.ts` | Japanese-market replies were the purest form of "rent impressions from an audience that will never read you." Now they buy nothing *and* dilute the graph | **Park it.** Don't delete — the register/budget/gloss machinery is good and will matter if you ever go multilingual on *originals*. Set reply mode to English-only in practice. |
| **Reply-craft overhaul (RC lane)** | `reply prompt.md` + literals, `src/x/replies/*`, `src/shared/replyMode.ts` | Shipped yesterday. Its stated purpose — better replies → more reply impressions — is void | **Not wasted, repurposed.** Reply quality now serves *follower conversion* and *relationship*. Re-key its Playbook cells from `views` to `profile clicks → follows`. |
| **`x.cannon.placedTarget: 18`** | settings registry | A daily target for a zero-value action | Cut hard (§7). |
| **Radar `hot` band, `x.band.*` (12 knobs)** | `src/shared/replyBand.ts`, `src/x/settings/bandThresholds.ts` | All twelve knobs optimise "will my reply be seen" | Leave the code; stop tuning it. It is no longer where the leverage is. |
| **`me_goals` row: "5M impressions (rolling 90d)"** | `me_goals` table | Target 5,000,000, current 2,100,000, deadline Oct 15 | **Factually obsolete today.** Replace with 500,000 / verified HT (§7). This row feeds `src/x/goals.ts` pacing, the ME block injected into prompts, and the brief — it is currently teaching every LLM call a false objective. |
| **`x.workers.discoveryExcludeReplies: true`** | worker settings | — | **Now *more* correct, not less.** Replies no longer need paid metrics at all. Leave on. |

**One thing to be careful about:** do not rip the reply engine out. It is your only
working follower pump (+16.8/day), and follower graph quality is an *input* to Home
Timeline distribution. The change is **intensity and targeting**, not existence.

---

### 4B. What just became load-bearing — enrich and polish

These are the surfaces that touch originals. Every one of them is now on the critical path.

#### 1. The reach band — `src/x/coach/reach.ts`

Architecturally the most valuable file in the repo right now, and it is **firing blanks**.
Its own header records the state: 138 originals → *zero* formats above the n≥20 gate.

```
substance      46    0.87×     ← "no format detected", exempt by design
audience_cta   17    1.59×     ← 3 posts from arming
hot_take        5    3.18×     ← 60% escape rate ≥3×, n=5
list           16    1.08×
story          16    1.34×
```

`hot_take` at 3.18× median with a 60% escape rate is, at n=5, the single most
interesting unarmed number in the database. Under the old gate this was a nice-to-have.
Under the new one, "which shape of original post escapes" **is the entire strategy**.

**Enrich:** re-key the band's outcome variable from raw views to *estimated verified HT
impressions* once §4D.1 ships. Consider dropping `minCellN` to 10 for originals only —
at 5–6 originals/day the n≥20 gate takes weeks per cell, and you have 68 days.

#### 2. Post formats + the Playbook — `src/shared/postFormat.ts`, `src/x/playbook.ts`

Twelve formats classified (`would_you_rather`, `poll_list`, `binary_choice`, `hot_take`,
`confession`, `milestone`, `audience_cta`, `question`, `data_comparison`, `story`,
`list`, `one_liner`). Your one tail event is a `question`/era-reframe hybrid. The
Playbook's format × outcome cells are now the primary readout of the whole system.

**Polish:** add an explicit **escape-rate** cell (P(views ≥ 10× trailing median)) per
format. Median is the wrong statistic for a strategy that needs tails. You do not want
the format with the best median; you want the one with the fattest right tail.

#### 3. The drafter and the post prompt — `src/x/routes/drafter.ts`, `src/x/posts/prompt.ts`, `post prompt.md`, `Composer.tsx`

Every eligible impression you will ever earn comes through here. It carries `{{PERSONA}}`,
`{{BELIEFS}}`, `{{PILLARS}}`, `{{FEW_SHOT}}` — and the few-shot slot is where the
tail-event skeletons belong once §4C.1 fills the template tables.

#### 4. The judge — `src/shared/judge.ts`, `src/x/judge/prompt.ts`

Thirteen dimensions, and the rubric is already close to right: `impressions` (reach
hook), `audienceMatch`, `strangerAnswerability`, `statusDependency`. **Two are missing
and both are now mandatory** — see §4D.5 and §6.

#### 5. Launch Room — `src/x/routes/launch.ts`, `extension/src/sidepanel/LaunchRoom.tsx`, C7

The first 30 minutes after a post fires, streaming early repliers from the DOM at $0.
**This is the most under-rated surface in the repo under the new rules.** Home Timeline
fan-out is decided by early engagement velocity; the Launch Room is the only tool you
have that operates inside that window. Under the old rules it was CRM material. Now it
is a distribution lever.

**Enrich:** make the Launch Room a *measurement* surface too — capture the original's
view count at T+5/15/30/60 min from the DOM. That series is your early-warning signal
for "this one is escaping," which is exactly when a human should drop everything and sit
in the replies.

#### 6. Best times / audience activity — `src/shared/activeTimes.ts`, `routes/analytics.ts`, `audience_activity`

One captured grid. Timing matters more for originals (Home Timeline is recency-weighted)
than it ever did for replies. **`x.gates.bestTimeMinN: 3` is now the right kind of low.**

#### 7. Own-thread replies, mentions, conversations

Replies don't earn impressions — but replies *under your own original* keep it alive and
extend its Home Timeline life. The mention inbox, `conversations.ts`, and the follow-up
queue now serve the originals engine rather than competing with it. Reframe them in the
brief as "feed the post," not "work the inbox."

---

### 4C. Dormant capacity — built, tested, and empty

This is where the leverage is, because the build cost is near zero.

#### 1. The voice/swipe library and template extraction — **empty**

```
voice_tweets        1 row      voice_authors     2 rows
post_templates      0 rows     articles          0 rows
harvest_rows (posts mode)  1,546 rows across 14 handles   ← the raw material IS there
```

`src/x/voice/extractPrompt.ts` extracts `hookType / skeleton / lineBreakPattern /
length / device` from any tweet, and it is wired into both `routes/voiceExtract.ts` and
the C4 own-winner path in `routes/playbook.ts`. **One prompt, one schema, two callers,
zero rows.**

Meanwhile you have 1,546 harvested posts sitting free in the DB and one 1.44M-view post
of your own that nobody has ever run the extractor over.

> **Highest ratio of value to effort in this entire document:** run the template
> extractor over (a) your own Jul 17 post, (b) every harvested post above some view
> threshold, and feed the resulting skeletons into `{{FEW_SHOT}}`. This is $0 except for
> a handful of LLM calls, uses only shipped code, and directly attacks the "raise the
> per-post ceiling" problem.

#### 2. X Articles — **zero rows, fully built**

`articles` table, `public/writer.html`, `src/x/articles/prompt.ts` with four assist
modes, `/x/articles` CRUD, autosave, Copy-for-X. Never used once.

X's own list of rewarded original content names **"original writing, threads, reporting,
analysis"** first. Long-form is the least-crowded, highest-originality-signal surface on
the platform, and you have a Premium subscription that unlocks it and a writer that
nobody has typed into. Worth one deliberate experiment.

#### 3. Studio / images — 2 assets, 7 media posts in 90d

`src/x/routes/images.ts`, `extension/src/studio/*` (brand kit, chart data, templates,
milestones, mascot). X explicitly rewards "photography, videos, illustrations, design
works." Your 7 media posts average **476 views vs 891 for text-only** — that's a
shipping-quality result at n=7, not a ceiling. Media is the single biggest untested lever
on Home Timeline dwell.

⚠️ **Constraint, from CLAUDE.md:** media upload still requires OAuth 1.0a, so images are
pasted manually. That friction is why only 7 shipped. It is worth measuring whether that
friction is the actual blocker before building anything new here.

#### 4. Threads — `thread prompt.md`, `src/x/posts/threadPrompt.ts`, `scheduled_posts.thread_id`

Built, and X names threads as rewarded content. **Open question worth measuring
(§8):** a thread's 2nd..Nth tweets are self-replies. Does "does not include replies"
zero them? If yes, threads are "one eligible post plus free retention." If no, threads
are the cheapest multiplier available. **Do not guess this — measure it.**

---

### 4D. What must be built — the blind spots

Ranked by "how badly is the tool lying to you without it."

#### 1. ⭐ THE GAUGE — scrape the monetization counter ($0, ~1 session)

**There is no X API field for verified Home Timeline impressions.** Not in
`public_metrics`, not in `non_public_metrics`, not in `organic_metrics`. Confirmed by
grep: the strings `monetization`, `rolling 90`, and `5M` appear **nowhere** in `src/` or
`extension/src/`. The gate lives only as one stale `me_goals` row.

The counter exists in exactly one place: **the DOM of the monetization page.**

**And you already have the pattern, shipped and tested.** `syncActiveTimesCapture()` in
`extension/src/content.ts` (~line 3195) does precisely this for the X Analytics heat
grid: path-prefix gate → passive DOM read on visit → parse via a shared pure module →
POST to an append-only route → client-side resend throttle in `chrome.storage.local` →
retry on the next mutation scan. `POST /x/analytics/active-times` (`routes/analytics.ts`)
is the server half. The content script already runs on all of `x.com/*`.

**Build it as an exact clone of that pattern:**

| Piece | Model it on |
|---|---|
| `extension/src/shared/monetization.ts` (pure parser + bounds) | `shared/activeTimes.ts` |
| `syncMonetizationCapture()` in `content.ts` | `syncActiveTimesCapture()` |
| `POST/GET /x/monetization/eligibility` | `routes/analytics.ts` |
| `monetization_snapshots` table (`captured_at, verified_ht_impressions, threshold, verified_followers, window_days`) | `audience_activity` |

Then: gate progress in Today, in `x_brief`, in the digest, and as the `me_goals`
`current_value`. **Everything downstream of this is guesswork until it exists.**

#### 2. ⭐ THE CONVERSION RATIO — turn the counter into a per-post score ($0, ~1 session)

The gauge gives one number for the whole account. What you need is a way to score *one
post*. The bridge is the ratio derived in §2.3:

```
verifiedShare = Δ(counter over window) / Σ(original impressions in that window)
```

Track it as a rolling series. It answers questions nothing else can:

- Is my verified share **rising or falling** as the Cannon adds football followers?
  (This is the single cleanest audience-dilution canary available to you.)
- Does format X convert to verified HT better than format Y at equal raw views?
- What raw-impression target does today's post need to hit to be worth 5,556?

**Do not skip this.** Without it, the gauge tells you where you are but never what to do.

#### 3. ⭐ THE EXPIRY LEDGER — the Oct 15 cliff, on screen ($0, half a session)

Pure SQL over `posts_published` × `metrics_snapshots`. For each of the next 90 days:
what rolls out of the window that day, and what the counter becomes. The Jul 17 post
should render as a single red bar on **Oct 15** carrying ~230K.

This makes the deadline structural instead of remembered. It also correctly reframes the
question from "how do I reach 500K" to **"how do I reach 500K on a balance that is about
to lose 90% of itself."**

#### 4. VERIFIED / PREMIUM AUDIENCE TRACKING (~1–2 sessions, cost-sensitive)

`src/x/fields.ts` already requests `verified`, `verified_type`, `subscription_type` in
`USER_FIELDS`, and `getMe` requests them too. **Nothing stores them.** The `people` table
(2,746 rows) has no verified column at all.

Under a rule where only Premium viewers count, "what fraction of my graph is Premium" is
a first-class metric and you cannot currently answer it.

⚠️ **Invariant #5 and #7 apply hard here.** A third-party user lookup is **$0.010** — the
most expensive read in the price sheet. 2,746 people = $27.46 for one full pass.
**Do not batch-enrich the CRM.** Options, cheapest first:
- Free: mentions already arrive with `MENTION_EXPANSIONS = ['author_id']` → `includes.users`,
  which can carry `verified_type` at no extra cost. Store what already arrives.
- Free: the DOM. The verified badge is rendered on every profile and every reply the
  extension already walks. `passiveHarvest` and the Launch Room see them for $0.
- Paid, last resort: lookups only for people who have actually engaged, retired-before-read
  per invariant #7.

#### 5. THE ORIGINALITY GATE (~1 session — see §6)

Two new judge dimensions, and one hard rule.

#### 6. REPOST / QUOTE ATTRIBUTION AWARENESS (~1 session)

X now reallocates repost impressions to the original creator. Two consequences stratus
should encode:
- **Outbound:** quoting someone without substantive commentary donates your reach.
  `verifiedSelfQuote` (self-quote re-ups) is fine and stays; quoting *others* now costs
  you. The re-up surface in `followups.ts` should say so.
- **Inbound:** when others repost you, that reach comes back. Repost count on your own
  originals just became a monetization metric, not a vanity one. Surface it.

---

## 5. Build order

Ranked by (value under the new rules) ÷ (sessions). Everything before the line is
$0 and uses shipped patterns.

| # | Task | Sessions | Cost | Why now |
|---|---|---|---|---|
| **0** | **Settings + goal + roster surgery** (§7) | **0** | $0 | No code. Stops the tool teaching itself a dead objective. **Do today.** |
| **1** | The Gauge — monetization DOM capture | 1 | $0 | You cannot steer what you cannot see. Exact clone of a shipped pattern. |
| **2** | The Expiry Ledger | 0.5 | $0 | Makes Oct 15 structural. Pure SQL. |
| **3** | The Conversion Ratio series | 1 | $0 | Turns the gauge into a per-post decision. |
| **4** | **Mine the template extractor over the Jul 17 post + the 1,546 harvested posts** | 1 | ~$0.05 | Highest value/effort in the document. Zero new code. |
| **5** | Escape-rate cells in the Playbook + reach band re-key | 1 | $0 | Median is the wrong statistic for a tail strategy. |
| **6** | Judge: originality + repost-risk dimensions | 1 | ~$0.01/call | Policy risk (§6). |
| **7** | Launch Room T+5/15/30/60 view capture | 1 | $0 | The only tool inside the window that decides fan-out. |
| — | *— line: everything above is $0 and reuses shipped patterns —* | | | |
| 8 | Verified/Premium audience tracking (free paths only) | 1–2 | $0 | Audience-quality canary. |
| 9 | Cannon re-scoring for adjacent-niche follower conversion | 1–2 | $0 | Keeps the pump, fixes the aim. |
| 10 | Repost/quote attribution surfacing | 1 | $0 | Small, correct. |
| 11 | Articles / media experiments | — | — | Content work, not build work. Measure before building. |

**Guardrail, unchanged from v3 and more true now:** every build hour between here and
Oct 15 is an hour not spent writing an original. Items 0–3 are worth it because they are
the odometer. Everything past 7 should wait until the first three have told you something.

---

## 6. The uncomfortable part: stratus under an originality rule

X's disqualification list includes **"content generated using automated tools to create
engagement."** stratus is an LLM drafting tool. This deserves a straight answer rather
than a shrug.

**Where you are clearly fine:**
- Every post is drafted from *your* persona, *your* beliefs, *your* pillars, and your own
  `me_entries` — and you edit and publish each one by hand. That is assistive drafting,
  the same category as a grammar checker. Nothing auto-posts to a target.
- Nothing in the repo reposts, aggregates, or reuploads anyone else's content. The voice
  library is a private style corpus that never publishes.
- Replies end in a manual paste by policy (invariant #2), not by choice.

**Where the risk is real and worth naming:**
- **Volume.** ~120 tweets/day of LLM-assisted output is the behavioural signature the
  rule is aimed at, whatever the intent behind each one. The single biggest risk-reduction
  move available is the one the new rules already demand: cut reply volume hard.
- **The deterministic humanizer.** `src/shared/humanize.ts` appends generic closers at
  p=0.20. The codemap already flags it as a tripwire and it is disabled in live project
  state — **keep it off.** Under a rule that polices synthetic engagement, a randomised
  filler-suffix generator is the worst-looking artifact in the repo.
- **The `@grok`-summon and one-word-chant moves** catalogued in v3 §2.7 were already
  ruled out at zero. That ruling now has policy teeth behind it, not just taste.

**What to build (§4D.5):** two judge dimensions —

| Dimension | Asks |
|---|---|
| `originality` | Is there a first-hand claim, number, or lived detail here that could only come from this author? |
| `derivativeRisk` | Would a reasonable reader call this a restatement of someone else's post? (high = bad, joins `JUDGE_HIGHER_IS_WORSE`) |

And one doctrine rule, added to the niche and to `post prompt.md`: **every original must
contain at least one thing only you could have written** — the hospital, the FoxPro→Claude
Code arc, the 20 SMB clients, a number from your own DB. This is not merely compliance.
It is also the highest-converting content you have ever posted, which is not a coincidence:
the 1.44M post won on a first-person era-reframe, and X is now paying for exactly that.

---

## 7. Zero-code changes — do these today

No build required. Every one of them stops the tool from optimising a dead objective.

**1. Replace the goal row.** `me_goals` currently reads `target: 5,000,000`,
`current_value: 2,100,000`, unit `impressions`. This row feeds `src/x/goals.ts` pacing,
the ME block injected into prompts, and the brief — **it is actively teaching every LLM
call the wrong target.** Replace with:

```
label   500K Verified Home Timeline impressions (rolling 90d) — Original Content Rewards
target  500000     unit  verified_ht_impressions
current 259100     baseline 259100 @ 2026-08-08
deadline 2026-10-15   ← the Jul 17 expiry, not an arbitrary date
```

**2. Cut the Cannon target.** `x.cannon.placedTarget: 18 → 4`. It is display-only, but it
is the number staring at you every morning, and it currently asks for 18 units of a
zero-value action.

**3. Raise the originals target.** `x.quests.originalsTarget: 1 → 4`. You already ship
3–6/day; the quest asking for 1 is the only quest that now maps to eligible output, and
it is set to a number you clear before breakfast.

**4. Rebuild the roster.** Deactivate all 9 `cannon_targets` rows. Football, poker and
Apple rumours cannot produce a Premium builder audience. Reseed from the lane v3 §8
already found by accident: **retro/vintage computing, chip and hardware history, computer
archaeology, hospital and enterprise IT, SMB accounting software** — the 8080-die-photo
reply that returned 1,160 views on day one. Those accounts are adjacent, their audiences
read English, and your 30 years make you one of very few people who can say something
specific. The `topic` column on `cannon_targets` exists and is `null` on all 9 rows — use it.

**5. Re-freeze following.** 880 → 938. v3 froze it deliberately; the freeze broke.

**6. Read the counter every day and write it down** until the Gauge ships. It is the only
ground truth, and unlike the old analytics tabs there is no ambiguity about which number
to read.

---

## 8. What we do not know — measure, don't guess

| Question | Why it matters | How to answer it, $0 |
|---|---|---|
| **Do thread self-replies count?** | Decides whether threads are a multiplier or one post with a tail | Post one thread; watch the counter delta against the head post's own impressions |
| **What is the true verified-HT conversion ratio, per format?** | Every per-post target depends on it | §4D.2, once the Gauge has ~2 weeks of series |
| **Does the ratio fall as reply-sourced followers accumulate?** | The dilution canary; decides whether the Cannon survives at all | Same series, plotted against follower growth |
| **What does the counter actually do on Oct 16?** | Validates the whole §2.3 estimate | The Expiry Ledger predicts it; the Gauge confirms it |
| **Is media friction (no API upload) the reason only 7 media posts shipped?** | Decides whether Studio is worth any build hours | Ship 10 media posts by hand and compare |
| **Does the monetization page expose more than the counter?** | Free instrumentation | Open it and read the DOM before writing the parser |

Recalibrate at stated sample sizes, never by vibes — same rule as always.

---

## 9. What this means for `x-growth-plan-v3.md`

| v3 claim | Verdict now |
|---|---|
| Replies are the highest-yield surface on X | ❌ **Void.** They yield zero eligible impressions. |
| `cannon_score = parent_views/(replies+1)` | ⚠️ **Correct formula, dead currency.** Keep the machinery; change what it maximises. |
| The 15-minute latency law | ✅ **Still true, now applies to your own posts.** The window that matters is the first 15 minutes of *your* original, in the Launch Room. |
| The crowding law | ✅ **Still true**, and now an argument for the low-crowd *adjacent* lane rather than the Japanese one. |
| Barbell: arbitrage buys the gate, content buys the payout | ❌ **Collapsed into one bar.** Content buys both. There is no arbitrage side any more. |
| Short questions <80 chars are the top post format | ✅ **Confirmed a fourth time** — your one tail event is exactly this shape. Now the *only* thing that matters. |
| Arm B: English specialist low-crowd (retro computing, chip history, hospital IT) | ✅ **Promote to the whole strategy**, and move it from replies to **originals**. That lane is where you are genuinely rare, and rarity is now what X pays for. |
| Build one feature: the Cannon Queue | ❌ **Superseded.** Build the Gauge, the Ledger, and the Ratio. |
| The Gauge, deferred as #1-that-hurts-to-defer | ✅ **Un-defer it.** It was right in both prior plans and it is right now — and the metric it should read is not the one any of them named. |
| Oct 15 cliff | ✅ **Unchanged and worse.** It now carries ~90% of your balance instead of ~30%. |

---

## Appendix A — the queries

Every number above, reproducible at $0 via `x_query`.

```sql
-- §2.1 originals vs replies, 90d — the split that ends the reply era
WITH latest AS (SELECT tweet_id, public_metrics,
    ROW_NUMBER() OVER (PARTITION BY tweet_id ORDER BY snapshot_at DESC) rn
  FROM metrics_snapshots)
SELECT p.is_reply, COUNT(*) n,
       SUM(json_extract(l.public_metrics,'$.impression_count')) imps,
       ROUND(AVG(json_extract(l.public_metrics,'$.impression_count'))) avg_imps
FROM posts_published p JOIN latest l ON l.tweet_id=p.tweet_id AND l.rn=1
WHERE p.posted_at > (strftime('%s','now')-90*86400)*1000
GROUP BY p.is_reply;

-- §2.2 the 92% problem — top originals in the window
WITH latest AS (SELECT tweet_id, public_metrics,
    ROW_NUMBER() OVER (PARTITION BY tweet_id ORDER BY snapshot_at DESC) rn
  FROM metrics_snapshots)
SELECT date(p.posted_at/1000,'unixepoch') d, p.tweet_id,
       json_extract(l.public_metrics,'$.impression_count') imps,
       substr(p.text,1,70) t
FROM posts_published p JOIN latest l ON l.tweet_id=p.tweet_id AND l.rn=1
WHERE p.is_reply=0 AND p.posted_at > (strftime('%s','now')-90*86400)*1000
ORDER BY imps DESC LIMIT 15;

-- §2.4 the expiry ledger — what rolls out of the 90d window, by day
WITH latest AS (SELECT tweet_id, public_metrics,
    ROW_NUMBER() OVER (PARTITION BY tweet_id ORDER BY snapshot_at DESC) rn
  FROM metrics_snapshots)
SELECT date(p.posted_at/1000 + 90*86400,'unixepoch') expires_on,
       COUNT(*) posts,
       SUM(json_extract(l.public_metrics,'$.impression_count')) imps_leaving
FROM posts_published p JOIN latest l ON l.tweet_id=p.tweet_id AND l.rn=1
WHERE p.is_reply=0 AND p.posted_at > (strftime('%s','now')-90*86400)*1000
GROUP BY expires_on HAVING imps_leaving > 1000 ORDER BY expires_on;

-- §2.1/§2.5 the daily originals run-rate (the number the gate is measured against)
WITH latest AS (SELECT tweet_id, public_metrics,
    ROW_NUMBER() OVER (PARTITION BY tweet_id ORDER BY snapshot_at DESC) rn
  FROM metrics_snapshots)
SELECT date(p.posted_at/1000,'unixepoch') d, COUNT(*) posts,
       SUM(json_extract(l.public_metrics,'$.impression_count')) imps
FROM posts_published p JOIN latest l ON l.tweet_id=p.tweet_id AND l.rn=1
WHERE p.is_reply=0 AND p.posted_at > (strftime('%s','now')-21*86400)*1000
GROUP BY d ORDER BY d DESC;

-- §2.1 real output volume (posts_published undercounts replies since XR.1's
-- exclude=replies; tweet_count deltas are the honest number)
SELECT date(snapshot_at/1000,'unixepoch') d, followers_count, following_count,
       tweet_count,
       tweet_count - LAG(tweet_count) OVER (ORDER BY snapshot_at) tweets_that_day
FROM account_snapshots ORDER BY snapshot_at DESC LIMIT 14;

-- §2.6 the roster that has to go
SELECT handle, topic, language, score, sample_n, active FROM cannon_targets;

-- §4C.1 the dormant assets, counted
SELECT 'voice_tweets' t, COUNT(*) n FROM voice_tweets
UNION ALL SELECT 'post_templates', COUNT(*) FROM post_templates
UNION ALL SELECT 'articles', COUNT(*) FROM articles
UNION ALL SELECT 'harvest_rows(posts)', COUNT(*) FROM harvest_rows WHERE mode='posts';
```

---

*The old gate could be bought with 1,544 replies. The new one cannot be bought at all —
it can only be earned, one original at a time, from the ~2.5% of your output that
actually counts. stratus already contains almost everything needed for that job. What it
does not contain is an odometer, and that is what to build first.*
