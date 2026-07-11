# Playbook Tab

The **Playbook** tab is your personal "what's actually working" report. It takes everything stratus has measured about your posts and replies — how many views each one earned, how many people clicked through to your profile, which angle you used, how fast you replied, and so on — and turns it into plain answers to questions like *"do my contrarian replies do better than my agree-and-extend ones?"* or *"does replying fast actually pay off?"*. Its defining habit: it refuses to give you a confident number until enough data backs it up. Below that threshold it says **"insufficient data (n=…)"** instead of quoting a figure built on two or three tweets. So when the Playbook tells you something, you can trust it.

---

## What it's for and where it fits

stratus is a side panel that helps you grow on X. Other tabs help you *do things*: schedule posts, draft replies, work your mentions, keep a swipe file. The Playbook tab is the one that looks *backward* and asks **which of those things are paying off** — measured in real numbers from your own account, not guesses or generic advice.

Everything it shows is built from data the rest of stratus already collects for free. Once a day the service reads the metrics on your recent tweets (views, likes, replies, profile clicks) and stores a single snapshot per tweet. The Playbook is just those snapshots, sliced and diced into tables. Loading the tab costs nothing.

There's a second, quieter job. A couple of the strongest findings are fed automatically into the AI when it drafts your replies and posts — so the Playbook doesn't only *report* what works, it gently steers your drafts toward it. That's covered in **"How the Playbook feeds back into drafting"** below.

You'll usually open this tab to:

- Sanity-check a habit ("is replying to *hot* tweets actually worth it, or should I focus on *warm* ones?").
- Decide where to aim your effort (which angle, which content pillar, which size of account).
- Pull your best-performing post templates out of your own winners so you can reuse them.

---

## The single most important thing: the n≥20 gate

Almost every number in this tab is protected by a **gate**. A cell only shows you a real figure once **at least 20 measured items** stand behind it. Until then it reads:

> insufficient data (n=7)

where `n` is how many measured tweets that cell currently has.

**Why the gate exists.** Small samples lie. If you'd replied to only three tweets with a "contrarian" angle and one happened to go viral, the raw average would scream "contrarian is amazing!" — and you'd be chasing a coincidence. Twenty is the point where a median stops swinging wildly on a single lucky or unlucky tweet. The gate is stratus choosing *"I don't know yet"* over a confident lie. This is deliberate and it is everywhere — treat a gated cell as an honest "not enough evidence", not as a bug.

**How gated cells look.** A blocked cell simply says `insufficient data (n=…)`. In a few tables the whole row is also dimmed (a lighter, "thin" style) when it's a bucket that's expected to stay sparse — for example the `unknown`/pre-baseline rows.

**The gate on comparisons (lift).** Several sections compare two groups and give you a "lift" — a multiplier like `2.1x views`. A lift only appears when **both** sides of the comparison have independently cleared the gate. If your "with media" posts pass n≥20 but your "text-only" ones don't (or vice-versa), the lift line stays silent. One side clearing the gate is never enough to declare a winner.

### The gate size (minN) and the "gate" label

At the top of the tab, next to the **Refresh** button, you'll see the current gate spelled out, e.g.:

> gate: n≥20 per cell

That **20** is the default and the number this tab uses. It's the same threshold used to decide whether the AI-draft guidance lines (below) are allowed to speak.

> The extension always loads the Playbook at the standard n≥20 gate — there is no button in this tab to loosen it. (The underlying API can be asked for a different threshold for one-off exploration, but the tab itself doesn't expose that control, and the auto-applied AI guidance always uses the strict default regardless.)

### The Refresh button

**Refresh** re-pulls the whole page. Because the page is rebuilt from the daily metrics snapshots, refreshing mid-day rarely changes anything until the next daily pass has run and measured more tweets. Use it after you've extracted winner templates (below) or if you left the tab open a long time.

---

## How to read a cell

Most result cells share one format. When a cell has cleared the gate it reads like:

> med 1.2k views · 34 clicks (n=26)

- **med … views** — the *median* number of views for tweets in this cell. Median (the middle value) is used instead of the average on purpose, so one freak viral tweet can't distort the picture.
- **… clicks** — the median number of **profile clicks** those tweets earned (people who tapped through to your profile). This is often the number that matters most for growth, because a profile visit is the step right before a new follow. If it's unavailable the cell just omits it.
- **(n=…)** — how many measured tweets are in this cell.

Numbers are abbreviated: `1.2k` = 1,200, `1.3M` = 1.3 million. A dash (`—`) means "no value".

---

## Section by section

The tab is a stack of sections, each answering one question. Many will be empty or gated when you're new — that's expected, and each section says so in its own words. Here's every one, top to bottom.

### What the prompts inject right now (guidance-now)

**Question it answers:** *Of everything measured, what has stratus learned strongly enough to actually whisper into my AI drafts right now?*

Two lines: **replies** and **posts**. Each shows either a measured guidance sentence (e.g. *"measured: my 'contrarian' replies earn 1.8x the median profile clicks of my other angles (n=24) — prefer that angle when it fits the post."*) or a muted note that it's **silent** because no cell has cleared the gate yet.

This is the most action-oriented part of the page: whatever appears here is *already being used* by the drafters (see the feedback section below). When it's silent, your drafts run on their normal prompt with no measured steer — which is the correct behavior on thin data, not a failure.

### Reply angles

**Question it answers:** *Which reply "angle" earns me the most reach and profile clicks?*

Every AI-drafted reply is tagged with an **angle** — the stance it takes:

- **extends** — builds on and agrees with the original tweet.
- **contrarian** — pushes back or offers the opposite take.
- **debate** — engages the argument directly, invites back-and-forth.

The top table (`Reply angles (N measured)`) has one row per angle with how many you **posted** and the result cell. Read down the **result** column to see which angle actually performs best for you.

Below it are collapsible drill-downs by **the other person's follower count** — `authors <1k`, `1k-10k`, `10k-100k`, `100k+`, and `unknown`. Click one to expand it. This answers a sharper question: *the angle that works on small accounts may not be the one that works on big accounts.* A contrarian reply might earn clicks under a 50k-follower post but fall flat under a 500-follower one. Each bucket is gated separately, so most will read "insufficient data" for a long while — you simply reply to fewer big accounts than small ones.

### Band calibration

**Question it answers:** *When stratus labels a tweet "hot" vs "warm", does hot really deliver better replies — or am I wasting effort chasing the hot ones?*

As you browse, stratus grades tweets into **bands** — roughly, **hot** (surging engagement worth jumping on), **warm** (decent), and **skip** (not worth a reply). This table checks whether that grading holds up against your *actual* reply outcomes. Columns:

- **band** — hot / warm / skip / null (null = replies where no band was recorded).
- **n** — measured replies in that band.
- **med views** — median views of your replies under those tweets.
- **hit-rate** — the share of those replies that cleared a "hit" bar. The bar is **your own p75 views** (the view count only your top 25% of tweets normally beat) — shown under the table as `hit = ≥… views (my p75)`. So hit-rate answers "how often did replying here produce one of my better-than-usual tweets?".
- **≥1 like** — the share that earned at least one like.
- **clicks** — mean profile clicks.

Under the table, two more readouts:

- **actionable vs passed** — pooled outcomes for tweets the band system said were worth acting on versus ones it said to pass, with medians. This is the bottom-line test of whether the grading earns its keep.
- **bait** — a split of your replies by whether the original tweet looked like **engagement bait** (a post fishing for replies), so you can see whether bait tweets convert differently.

> A note under this section reminds you: the band thresholds themselves are only ever changed **by hand, and only once ≥100 replies are measured**. This table is the *evidence* you'd use to make that call — it never moves the thresholds on its own.

### Batch vs single drafts

**Question it answers:** *Do the replies I draft one-at-a-time (Reply Master) do better or worse than the ones I mass-draft from the Radar queue?*

Two rows:

- **Reply Master (single)** — replies you drafted individually, with full context.
- **Radar (batch)** — replies drafted in bulk across the Radar queue.

Compare the two result cells. A line underneath tells you how many published replies are **unattributed** — hand-written or made before this tooling existed, so they can't be credited to either method. That number is context, not a verdict.

### Relationship lift

**Question it answers:** *When my reply draft is warmed up with what stratus knows about the person (our past exchanges), does it convert better than a cold draft?*

stratus can inject a short "relationship" briefing into a reply draft when you already have history with someone. This section measures whether that helps:

- **with relationship block** — replies drafted with that briefing.
- **cold** — replies drafted without it.

If both sides clear the gate, a **lift** line appears (e.g. `lift: 1.4x views · 1.6x profile clicks`). Until then it's simply two cells to compare by eye.

### Media vs text-only

**Question it answers:** *Do my posts with an image out-perform my plain-text posts?*

This one is a **baseline for a feature that's coming** — an image studio. Rows:

- **with media** — your original posts that carried an image or video.
- **text-only** — your plain-text originals.
- **unknown (pre-baseline)** — older posts from before stratus started recording whether a post had media. This row only appears if you have such posts, and it's kept separate on purpose — never folded into "text-only" — because "we don't know" is not the same as "no".

If both **media** and **text-only** clear the gate, an **image lift** line appears. Until then a note explains it's holding its tongue — it's establishing the text-only benchmark that future image posts will be judged against.

> On a normal account this stays gated for a long time, because stratus can't attach media through the X API yet — so nearly everything reads as text-only for now.

### Idea Inbox payoff

**Question it answers:** *Do the drafts I built from a captured idea beat the ones I wrote off-the-cuff?*

stratus has an Idea Inbox where you stash thoughts to write about later. When a draft grows out of one of those saved ideas it's **seeded**; when you just typed something fresh it's **unseeded**. This table compares them:

- The first row, **all (pooled)**, is the headline: seeded vs unseeded across everything.
- Two thinner rows split it into **posts** and **replies**, because those two have very different view ranges and the pooled number leans toward whichever you do more of.

If both seeded and unseeded clear the gate, an **idea lift** line appears with a verdict — *"the Idea Inbox pays"* when seeded drafts win, or *"seeded drafts underperform"* when they don't. Honest either way: this section can tell you the Idea Inbox *isn't* helping, and that's a legitimate, useful answer.

### Reply latency

**Question it answers:** *Does replying fast actually pay off — or is the whole "jump on it early" push a waste?*

Every posted reply is bucketed by **how old the tweet was when you drafted your reply**:

- **<15m** — you got there in the first quarter hour.
- **15-60m**
- **1-6h**
- **>6h**
- **unknown** — the timing couldn't be recovered (kept separate, never merged into a real bucket).

The table shows each bucket's **posted** count and result. Below it, once both the fast cohort (**<15m**) and the slow cohort (**1h+**) clear the gate, an **early-reply lift** line grades the bet directly (e.g. `early-reply lift: 3.2x views (<15m vs 1h+)`).

This is a deliberately consequential number: it's the one that either **justifies** all the machinery stratus builds to help you reply fast (the Radar queue, the Launch Room), or tells you that speed isn't buying you much and your effort belongs elsewhere.

### Roster coverage — last 7 days

**Question it answers:** *Over the last week, are my replies actually landing on the right-sized accounts — the "2–10x my size" sweet spot the strategy calls for?*

The doctrine behind stratus says the bulk of your replies should target accounts **2 to 10 times your own follower count** — big enough to matter, small enough to notice you back. This section checks the last 7 days of posted replies against that band:

- **in-band (2–10x)** — the target sweet spot.
- **above band (>10x)** — accounts much bigger than you (they may never notice).
- **below band (<2x)** — accounts your size or smaller.
- **unknown size** — replies where the author's follower count couldn't be resolved. This is your **roster gap**: it's shown, but it's never held against you.

Each row shows the **replies** count and its **share** of the week. Below the table you get one of a few verdicts:

- If stratus doesn't yet know your own follower count (it needs one daily account snapshot to set your band), it says it's waiting — until then every author reads as "unknown size".
- If it knows your band but too few *known-size* replies have accrued to judge, the verdict stays silent (it tells you how many known-size replies it has so far).
- Otherwise: **on doctrine** (a majority of your known-size replies are in-band) or **off doctrine** (with a nudge to aim the 70% at 2–10x accounts). Crucially, the verdict is computed over **known-size replies only** — a big unknown bucket won't secretly sink your score.

### Pillar × register

**Question it answers:** *Which combination of topic (pillar) and tone (register) actually performs when I post originals?*

Your original posts carry two labels when drafted by stratus:

- **pillar** — the content theme (your editable content pillars, e.g. "ai-craft", "builder-51").
- **register** — the tone the draft was written in (plain / spicy / reflective).

Each row is one pillar-and-register combination with its result. Read it to find your money combinations — maybe your "spicy" takes on one pillar out-earn your "reflective" ones on another. Hand-written posts (ones that never went through the drafter) have no register, so this table fills in slowly and starts thin on purpose. If you've published no drafter posts yet it simply says so.

### My winning structures

**Question it answers:** *What hook shapes and rhetorical devices show up in my best-performing posts — so I can reuse them?*

This section is about **the mechanics of your own winners** — not what you said, but how it was *shaped*. It works from templates distilled out of your top posts:

- **hooks** — the opening move (the shape of your first line).
- **devices** — the rhetorical device carrying the post.

Each is a small table of the shape's key, how many posts **posted** with it, and the result.

**The "Extract winner templates" button.** This section starts empty until you run the extraction. Clicking **Extract winner templates** sends up to your **20 top posts** (by measured views) to Grok (the AI), which reads each one and distills its structure — hook type, skeleton, line-break pattern, device — into reusable templates. This is the **only thing in the whole tab that costs money**: roughly **$0.005 per post, one-time**. The button's label spells it out: `≤20 top posts, ~$0.005 each, one-time`. After it runs you'll see a status line like:

> Extracted 18/20 (2 failed, $0.0900, 5 more candidates)

meaning 18 of 20 were distilled, 2 failed, it cost 9 cents, and 5 more of your posts are eligible for a future run. It **skips posts already extracted**, so you can safely click it again later to pick up only new winners — you won't pay twice for the same post. If the server has no AI key configured you'll get a clear message saying so (nothing is charged). Once templates exist, the two tables populate and the guidance-now "posts" line can start speaking.

---

## How the Playbook feeds back into drafting

The Playbook isn't only a report you read — its two strongest findings are wired straight into the AI drafters. These are the exact sentences shown in **"What the prompts inject right now"** at the top:

- **The reply guidance line** (your best-performing reply *angle*) is quietly added to the prompt every time stratus drafts a reply for you — nudging it toward the angle your own numbers favor.
- **The post guidance line** (your best-measured *hook and device*, from your extracted winner templates) is added when stratus drafts an original post.

Both are held to the same **n≥20 gate**. If a finding hasn't cleared the gate, the line stays **silent** and your drafts run without it — stratus will never steer a prompt on a hunch. You don't have to do anything to turn this on; it applies automatically the moment a cell earns the right to speak. This is why extracting your winner templates (above) is worth doing: it's what lets the *posts* guidance line come alive.

---

## Common workflows

**"Is it worth replying to hot tweets?"**
Scroll to **Band calibration**. Compare the **hot** and **warm** rows' med views and clicks, and read the **actionable vs passed** line underneath. If hot doesn't clearly beat warm once both clear the gate, you're spending effort on the label, not the outcome. (Remember: the band thresholds only move by hand at ≥100 measured — this is the evidence, not the switch.)

**"Which reply angle works for big accounts vs small ones?"**
Go to **Reply angles**. Read the overall table first, then expand the author-size drill-downs (`authors 10k-100k`, `authors <1k`, …). Look for an angle that wins in the size bucket you actually reply to most. Expect several buckets to say "insufficient data" — that just means you haven't replied to enough accounts of that size yet.

**"Pull out my winning post templates."**
Open **My winning structures** and click **Extract winner templates**. Wait for the status line (a few seconds). Your hook and device tables fill in, and — once a shape clears the gate — the *posts* guidance line at the top starts steering your original drafts. Re-run it every so often to fold in new winners; it only charges for posts it hasn't seen.

**"Am I aiming my replies at the right people?"**
Check **Roster coverage — last 7 days**. If it reads **off doctrine**, redirect this week's replies toward accounts 2–10x your size. If it's waiting on your account snapshot, give it a day for the daily pass to run.

**"Is replying fast actually paying off?"**
Read **Reply latency**. If the **early-reply lift** line shows a strong multiplier, the speed machinery is earning its place. If it's silent, keep replying and check back — you need both the fast and slow cohorts past n≥20 before it can grade the bet.

---

## States you'll see

- **Loading.** A muted `Loading…` (and `…` on the Refresh button) while the page fetches. It's one quick, free request.
- **Brand new / mostly empty.** Right after you start using stratus, almost every section will say `insufficient data (n=…)`, `No measured replies yet`, `No published drafter posts yet`, or similar, and the guidance lines will be **silent**. This is normal — the page has nothing to lie about yet. It fills in as the daily metrics pass measures more of your tweets over the coming weeks.
- **Gated cells.** Individual cells reading `insufficient data (n=7)` inside otherwise-populated tables. That cell needs more measured tweets; the rest of the table is fine.
- **Lift lines silent.** Comparison sections (media, latency, relationship, idea) will show their two cells but no multiplier until *both* sides clear the gate.
- **Error.** If the fetch fails you'll see a red error line; hit **Refresh** to retry.
- **AI not configured.** If you press **Extract winner templates** and the server has no AI key, you get a plain message and no charge.

---

## Tips and good to know

- **This page rewards patience.** It's a long-game instrument. Most sections need weeks of posting and replying before their cells cross n≥20 and start giving confident answers. An empty Playbook isn't broken — it's honest.
- **Loading is free; only extraction costs.** Viewing and refreshing the tab costs nothing. The single paid action is **Extract winner templates** at ~$0.005 per post, one-time per post, capped at 20 per click.
- **Extraction is safe to repeat.** It skips posts already distilled, so clicking it again months later only picks up new winners — you never pay twice for the same post.
- **The guidance applies itself.** You don't flip a switch. The moment a finding clears the gate it starts steering your AI drafts; until then your drafts run clean. What you see in "What the prompts inject right now" is exactly what's live.
- **Medians, not averages.** Every result cell uses medians so one viral outlier can't fake a trend — which is also why the numbers feel conservative. That's the point.
- **"Insufficient data" is a feature.** Whenever you're tempted to be annoyed that a cell won't give you a number, remember the alternative is a confident number that's wrong. The gate is the tab keeping its promise not to mislead you.
