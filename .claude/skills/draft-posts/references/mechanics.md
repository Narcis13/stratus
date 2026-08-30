# Mechanics — the measured evidence base

Everything here was counted, not felt. Each row names its account, its n and its
capture date. **Append to §1 whenever a run measures something new; never delete a
row** — a skeleton that stopped working is as useful as one that started.

The account: **@13_narcissus**, 1,306 followers at the last `account_snapshots`
row (2026-08-12). Its own originals ran **reply:like under 0.2** before the
challenge-board era — that is the number every borrowed benchmark is trying to beat.

---

## 0. The objective, and why reply:like is the column that matters

The goal is **verified home-timeline impressions**, not raw views. As of
**2026-09-07** that stops being a preference and becomes the literal payout
formula: X retires Creator Revenue Sharing and replaces it with Original Content
Rewards, which pays on *qualified impressions* — unique impressions from Premium
subscribers, on the Home Timeline, ≥50% of the post visible. Eligibility: 500
verified followers plus **500,000 verified home-timeline impressions over 90 days.**

Consequences that bind every draft:

- **A reply from a verified account beats fifty likes from anywhere.** Rank
  skeletons by reply:like, not by views.
- **A comment section is a venue.** Replies bring the replier's own audience onto
  the post; likes bring nothing. This is why every rule below optimises for the
  reader typing rather than tapping.
- **Views are lottery-distributed.** One post can carry a whole bucket's average.
  Medians and reply:like are the honest statistics; averages need the outlier
  stripped and both numbers reported.
- **Post-Sept-7, weeks either side of that date measure different games.** Keep
  the eras separate when comparing, or you'll read a rule change as a content
  finding.

---

## 1. Measured skeletons

### @danielsmidstrup — n=482 corpus, 200 rows captured 2026-08-24 16:35Z

| skeleton | n | avg views | avg comments | avg likes | reply:like | max views |
|---|---|---|---|---|---|---|
| **CHALLENGE BOARD** ("Name a…", "Tell me one…") | **13** | **27,748** | **290.2** | 157.3 | **1.84** | 128,065 |
| link farm ("drop your project URL") | 8 | 7,850 | 179.5 | 101.0 | 1.78 | 16,088 |
| short question (<110 chars) | 213 | 6,196 | 78.3 | 74.6 | 1.05 | 135,339 |
| long question (≥110 chars) | 59 | 3,178 | 50.1 | 67.4 | 0.74 | 8,503 |
| statement | 208 | 4,429 | 54.9 | 92.1 | 0.60 | 108,021 |

Receipts: *"Tell me one thing you can do that CLAUDE cannot do yet"* 128,065 views ·
*"I am a founder scare me with 1 word"* **827 comments** · *"sell me your startup in
two words max"* 670 · *"What's coming after artificial intelligence?"* reply:like **2.61**.
His single highest-view post is a **bake-off**: *"Founders, which is the best place
to buy a domain? - GoDaddy - Hostinger - Cloudflare - Namecheap - Others"* —
**135,339 views**. Named brands recruit their own fanbases; "Others" is the escape
hatch that stops the list being complete.

**He reran the 128K post verbatim 19 days later** → 15,941 views with a *better*
ratio. Reruns work. Rewriting the rerun is what kills it.

### @i_mika_el — n=210, captured 2026-08-27 21:30Z

| skeleton | n | avg views | avg comments | avg likes | reply:like |
|---|---|---|---|---|---|
| **DILEMMA / would-you-rather** | **17** | 2,878 | **58.2** | 50.7 | **1.15** |
| faction split ("half of X… other half…") | 9 | 2,198 | 42.4 | 49.4 | 0.86 |
| bake-off list | 15 | 2,102 | 37.8 | 34.8 | 1.09 |
| every other question *(baseline)* | 99 | 1,636 | 31.9 | 35.9 | 0.89 |
| statement | 62 | 3,335 | 23.9 | 39.0 | 0.61 |

**The dilemma nearly doubles his own baseline question on comments (58.2 vs 31.9),
on n=17.** Receipts: *"would you rather sell your product for $2M tomorrow or turn
it down and bet on it becoming $50M"* — 125 comments on 82 likes · *"would you
rather 10x your users or 10x your revenue — same product. and no, they're not the
same thing"* — 82 comments · *"half of devs: remote forever, the office is a scam /
other half: i miss the office and i'm tired of pretending i don't / which one are
you?"* — 78 comments.

Note his statement bucket's 95,119-view max is a **video** (a Pac-Man clone with a
score to beat). Media-driven, not a text mechanism. Excluded — this account posts
no media.

### @shirshakchavan — n=200, captured 2026-08-26 16:48Z

The largest single post in the whole corpus, and the outlier-discipline case study:

> *"You got 3 offers: Anthropic $1.4M/year — New York / Open AI $1.2M/year — San
> Francisco / Remote Company $950K/year — Work from anywhere / Which one would you
> choose?"*
> **500,203 views · 520 comments · 1,852 likes · 272 bookmarks · 159 chars ·
> reply:like 0.28**

**Strip it and his other 22 long-questions average 266 views.** One lottery
ticket. It is in this file because the *shape* cross-validated on @i_mika_el, not
because of its own number — and its low reply:like is the evidence for R10.

Other rows: *"Name a better browser than Arc I'll wait."* 22,160 views / 219
comments · challenge bucket n=7, avg 3,833, r:l 1.02 · milestone bucket n=25, avg
1,509 (excluded, see §5).

### @sl1ma4 — captured 2026-08-18

The **verdict** skeleton (confession → binary on a contested identity): 53,226
views on the best row. Small sample; the stream is rationed accordingly.

---

## 2. The streams

Five in rotation. Counts are set each week by measured reply:like, not habit.

### X · DILEMMA — forced choice, both options cost something
Evidence: n=17, r:l 1.15, 58.2 comments · the 500K outlier.
Two or three concrete options, a binding constraint, no correct answer. The reply
is an identity claim made in public in front of people who chose differently.

Why it works: a question has a right answer somewhere and a dilemma doesn't, so
nobody stays quiet. It recruits *value tribes*, and unlike brand fanbases, value
tribes argue with each other rather than just voting.

Required: **a latch that kills the escape route** — "No third option.", "Pick.",
"binding for two years". Without it half the replies are "it depends" and the
thread dies.

### D · CHALLENGE BOARD — imperative + one-noun answer + latch
Evidence: n=13, avg 27,748 views, r:l 1.84.
"Name one…", "Tell me one…". Never a question mark. The answer is one noun,
because a noun cannot be wrong. The reader adds to a public list that has no
finished state.

The latch is one word or one short line doing all the work: *yet · still · Not
better, just does it · Not one you use — one you'd miss.* It turns every reply
into a claim a stranger can dispute, which is where the second wave of comments
comes from.

Structurally the shortest stream: **keep every one under 110 characters.**

### N · NEWS PEG — anchored to a dated event
Fact, implication, cheap ask. The ask should resolve to a date, a number, a
percentage or "never" — the cheapest reply types there are.

Shelf life is the trade: N posts expire, everything else keeps. Peg to events
**three days old or less** where possible, and flag in §9 which ones to pull first
if the story moves.

### A · VERDICT — confession → binary on a contested identity
Evidence: 53,226 on @sl1ma4. The heavy end. **Ration to ~5 in 28**, each in a
day's best slot.

The confession must be *expensive* — something that costs the operator standing
to admit. A 25-year-old admitting they don't read diffs is a shrug; a 51-year-old
with thirty years admitting it is a defection, and defections get answered.

Always end by putting yourself in the dock ("…or is that just what slow people
call being slow?"). Without that clause a verdict reads as preaching and gets likes
instead of replies.

### F · FACTION SPLIT — both tribes stated fairly, then "which are you"
Evidence: n=9, 42.4 comments.
State both positions **sympathetically** before asking. Nobody defends a strawman,
so nobody gets defensive — they self-identify, then argue with the people who
self-identified the other way. The lowest-hostility way to start a fight on this
platform.

Sharpen the closing latch past "which one are you": *"Which one is your September?"*
(dates it, blocks the theoretical answer) · *"Which one is your card?"* (points at
a bank statement, not a belief) · *"One of you is wasting a year. Which?"* (puts a
stake on the table) · *"…and has it cost you yet?"* (bolts a war-story ask onto a
binary; war stories are long and bring their teller's audience).

### Retired / on the bench

- **K · BAKE-OFF** — named options + escape slot ("Others", "None of them").
  135,339-view receipt. Folded into X when a week has a good brand fight; its one
  irreplaceable device is fanbase recruitment.
- **W · WORD BUDGET / DARE** — "in one word", "three words", "talk me out of it".
  827 and 670 comments on n=2. Rotate back in when the D and X streams need a rest.
- **B · ESCAPE HATCH** — the institutional/day-job stream. Retired 2026-08-24, see §5.

---

## 3. The rules

**R1 · End on the open element.** The last word carries the latch: *yet, still,
Pick, Which, None of them.*

**R2 · No punchline.** A closing aphorism costs replies. If the line is good it is
a reply *you* post underneath — a second surface, not a full stop.

**R3 · Collectible over correct.** "Name one" beats "which one" beats "why".

**R4 · Every answer must be disputable by a stranger.** That is the multiplier.
"Name a thing that gives away AI-written code" produces "humans do that too" — a
fight in your replies you didn't have to start.

**R5 · Seed the format, not the answer.** "Mine: …" demonstrates shape and length.
It must never demonstrate the right answer.

**R6 · The seed reply opens a new axis, never a conclusion.** A seed that settles
the topic costs the entire mechanism. See §4.

**R7 · Ban the essay ask.** No "why", no "what's your take", unless the honest
answer fits in one clause.

**R8 · Ration the confession.** ~5 verdicts in 28, all in a day's best slot.

**R9 · A dilemma must cost something on both sides.** If one option is obviously
right it's a poll, not a fight. Test before posting: *can you write a convincing
seed arguing for the other option?* If not, the dilemma is fake.

**R10 · The number must be inside the reader's reality.** The 500K post's numbers
($1.4M) are fantasy for this audience, and its reply:like is **0.28**.
@i_mika_el's are adjacent to a real decision ($2M/$50M, 10x users vs 10x revenue)
and run **1.15** — four times better. Use $40k for a side project, $400k for a
job, six hundred hours, ten paying customers. **The reader has to be able to
picture actually being offered it.**

---

## 4. Seed craft

**The seed reply is not optional.** Reply to your own post within 60 seconds. It
does three things: the first reply under the post isn't a stranger's, the post
becomes a 2-post thread with a second surface, and it proves the operator is
present so replying is worth a stranger's time.

**Every seed opens a new axis.** Patterns that work, in rough order of power:

1. **Challenge the credibility of one group of repliers** — not their opinion.
   *"Everyone answering 'the junior' — I'd like to know if you actually did it
   this year. The number of people who say this and the number of juniors hired
   are not the same number."* This is the strongest form and it belongs on the
   dilemmas. It restarts the thread among people who have already replied.
2. **Disqualify yourself first.** *"I've been offered nothing, so my answer is
   worth exactly what you'd expect."* Stops the post reading as a lecture and
   makes the challenge in the same seed land as fair rather than smug.
3. **Reframe the question onto a different object.** D2's seed turned a stack
   question into a question about dependence on a person. The thread restarts on
   an axis nobody was arguing about.
4. **Make a falsifiable prediction.** *"I have never once watched a price go down
   after an IPO."* The most repliable thing you can put under a post.
5. **Pre-load the obvious objection.** *"Someone is about to tell me humans have
   done that for thirty years. Correct."* The argument starts in the first minute
   instead of the first hour.
6. **Refuse to name your own answer.** Half the follow-ups become guesses — a
   second wave of replies from people who already replied.

**Anti-patterns:** a seed that answers the question · a seed that is a better
aphorism than the post · a seed that agrees with the likely majority.

---

## 5. Subject discipline

**In-niche only: AI, the niche, or a live build-in-public controversy.**

This was learned the expensive way. An earlier week argued for institutional and
escape-hatch subjects (hospital, day job, the fax machine) on the theory they'd
pull higher-verification repliers. The harvest disagreed: every measured outlier
in the corpus is **AI, tooling, or founder identity** — Claude, careers-vs-AI,
domain registrars, "who survives if AI writes 90% of code", "sell me your startup
in two words". The 135K post is about *where to buy a domain name*. The theory was
borrowed from one 1.44M personal post and over-applied. **Stream B was retired
2026-08-24 and stays retired.**

**The operator's 51 / thirty years is a warrant, never a subject.** *"I'm 51 and
the whole bet I'm making is that judgment is a moat"* is a niche post. *"In my
hospital the fax machine…"* is not. The age is his unfakeable position in an
argument full of 25-year-olds; it earns its place only when it is the reason the
claim is credible. **Two or three times in 28, tagged pillar `builder-51`.**
Everything else is `ai-craft`.

**Permanently excluded shapes**, with reasons:

- **The link farm** ("drop your project URL", "introduce yourself below").
  Measured at r:l 1.78, and excluded anyway: those repliers came to drop a URL,
  and on a verified-impressions objective they dilute verified share while
  spending a slot.
- **The milestone post** ("570K impressions!", follower counts). n=25 on
  @shirshakchavan, avg 1,509. Load-bearing for an account whose pitch is "I grew
  fast, ask me how"; from a 1,306-follower account it reads as boasting or begging.
- **Borrowed catchphrases** ("I'll wait", "ok, serious question"). The mechanism
  is takeable; the signature phrase is not. Used by a 51-year-old it reads borrowed.
- **Another account's subject.** Skeletons belong to everyone; subjects don't.
  Reusing the shape is craft, reusing the topic is a lift.

---

## 6. Length

The measured top of the distribution lives at **30–110 characters**, and that band
is dominated by challenge boards, which are intrinsically short. Dilemmas and
faction splits have to state two options; news pegs have to state a fact. So the
honest measurement is **per stream**, not per set.

Reference medians (week of 2026-08-31, n=28):

| stream | n | median chars |
|---|---|---|
| D · challenge board | 6 | **83** |
| F · faction split | 4 | 170 |
| X · dilemma | 7 | 192 |
| N · news peg | 6 | 212 |
| A · verdict | 5 | 231 |

Measured dilemmas on @i_mika_el run 95–160, so 192 is **above** the evidenced
band and is a stated, tested cost — not something to paper over. When the mix
moves toward structurally longer skeletons the set average rises; say so in §1 and
show the per-stream table rather than claiming the set got tighter.

**Keep all challenge boards under 110.** They are the clean test of the
short-post hypothesis and the only stream where length is fully under your control.

---

## 7. Running it — what the operator does after the document

- **Post the seed within 60 seconds**, exactly as written for the dilemmas.
- **Answer every reply on the X, A and N posts.** The multiplier only fires when
  the comment section becomes a venue: a reply to reply #4 causes replies #5–40.
- **Spike protocol** (>5k views in the first hour, or >2k in 30 minutes): cancel
  the rest of the day's generated slots; reply substantively to every commenter
  for 48h (this alone can double the event); morning-after quote tweet with the
  best reply received, not with your own commentary; sequel question on day 3,
  same skeleton, adjacent subject; pin the winner for 72h.
- **Reruns are legitimate** — verbatim, after ~3 weeks. The rewrite is what kills
  them.
- **Expected yield:** 28 posts is one or two mid-hits and a lottery ticket. Judge
  the batch, not the row. n=13 on someone else's account is evidence; n=1 on this
  one is noise.
