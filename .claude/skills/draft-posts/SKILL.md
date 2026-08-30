---
name: draft-posts
description: >
  Draft a full week of X posts for the stratus account as an evidence-grounded
  proposal document in evals/. Use when the user says "/draft-posts", "draft next
  week's posts", "make the week of posts", "posts for next week", "new week doc",
  or asks for a week of scheduled tweets. Buckets the latest DOM harvest by
  skeleton to pick the rotation, pegs subjects to what actually broke in the
  niche this week, checks every line against what already fired, and validates
  the batch programmatically. Writes a document — it never queues a post.
---

# draft-posts — a measured week, not a vibe

You are producing **one document**: `evals/week_x_posts_<YYYY-MM-DD>.md`, dated
the Monday the week opens. It proposes every generated slot for seven days, with
a seed reply and a rationale for each, and it shows its work — which measured
skeleton each post is built on, which dated event it pegs to, and what it is
being tested against next Monday.

The consumer is the operator on a Sunday evening deciding whether to queue 28
tweets. The quality bar: **every claim in the document is traceable to a row in
the database, a dated source on the web, or a stated assumption.** No number you
cannot point at. No skeleton you have not counted.

## Cost

**$0.** Every read is local SQL over already-captured DOM harvest data, or free
web search. No X API call exists on any path this skill uses (invariant #8 — the
billed read routes were deleted and assert 404). Drafting is billed to this Claude
Code session, so it never appears in `x_cost` — don't tell the operator "this was
free" as if the session were free to them.

If they later queue the batch: **28 × $0.015 = $0.42**, and only if no post
contains a URL. See the hard gate below.

## The one gate that costs real money

**Invariant #1: a post whose text matches `/(^|\s)https?:\/\//i` bills at $0.20
instead of $0.015 — 13×.** `scripts/validate.py` fails the batch on any URL. Never
weaken it to let a post through; move the link to a manual first reply, which is
what the operator does anyway.

## Never queue without being asked

This skill writes a file. It does **not** call `x_schedule_post`, hit
`POST /x/posts/schedule`, or write `scheduled_posts`. Publishing is outward-facing
and irreversible; the operator decides. End the run by offering: *"Say the word and
I'll submit the batch at the times in §11."* If they ask you to queue in the same
breath as drafting, draft first, show the §11 table, then queue.

## Files you own

| Path | What |
|---|---|
| `evals/week_x_posts_<Mon>.md` | The output. One per week, never overwritten. |
| `references/mechanics.md` | **The evidence base.** Measured skeletons, streams, rules R1–R10, seed craft, failure modes. Read fully every run. You append to it when a run measures something new. |
| `references/queries.md` | Exact SQL for every read this skill makes. |
| `references/document.md` | The canonical §0–§11 output structure. |
| `scripts/validate.py` | The gate. Char counts, URLs, slot arithmetic, novelty collisions, self-audit of the finished doc. |

---

## Step 0 — Load the craft, then the last document

1. **Read `references/mechanics.md` fully.** It carries every skeleton ever
   measured, with n and reply:like. You are not re-deriving this each week — you
   are extending it.
2. **Read the most recent `evals/week_x_posts_*.md`** (`ls -t evals/week_x_posts_*.md | head -1`).
   You need three things from it: the rotation that shipped, the retirement list
   in its §7, and its §10 — **the hypotheses last week said it would test are
   this week's §0 obligations.**

Do not read the repo for orientation. Nothing about `src/` matters here.

## Step 1 — Can last week be scored?

This is the first question every run asks, and for two weeks running the answer
was no.

```sql
SELECT MAX(datetime(snapshot_at/1000,'unixepoch')) FROM metrics_snapshots;
SELECT id, handle, mode, scope, row_count, datetime(created_at/1000,'unixepoch')
  FROM harvest_runs ORDER BY created_at DESC LIMIT 12;
```

- `metrics_snapshots` is frozen at **2026-08-12** and stays frozen (invariant #8).
  It will never score a recent week. Don't keep hoping.
- **The only path to own-post numbers is a `posts`-mode harvest on the operator's
  own handle** (`13_narcissus`). Check `harvest_runs` for one.

**If no own-post harvest exists:** say so plainly in §0, give the 60-second fix
(profile → Harvest tab → mode **Posts**, scope **All**, *Send to stratus* on →
Harvest; or **Start sweep** and scroll), state how many published originals are
now ungraded, and continue. Do not pad the document to hide it and do not stop —
the week still needs posts.

**If one exists: score last week before drafting anything.** This is the whole
point of the exercise and it has never yet been possible. Run the scoring queries
in [references/queries.md](references/queries.md) §4 and answer, per stream: n,
median views, median comments, reply:like. Then answer last week's §10 questions
literally, one at a time, and **let the answers set this week's rotation.**
Measured own-account evidence outranks every borrowed number in `mechanics.md` —
when they disagree, yours wins and you say so in §1.

## Step 2 — Mechanism: bucket the newest harvests by skeleton

The rotation is chosen from counted evidence, never from taste.

1. `harvest_runs` (above) tells you what was captured since the last document.
   Any run newer than the previous doc's header is new input.
2. For each new account, bucket its corpus by skeleton and compute
   **n, avg views, avg comments, avg likes, reply:like, max** — the query is in
   [references/queries.md](references/queries.md) §2. Reply:like is the column
   that matters; views are lottery-distributed and comments are the objective.

**Three disciplines that stop this step producing garbage:**

- **Outlier discipline.** When a bucket's average is carried by one post, strip
  it and recompute. Last run this caught a 500,203-view dilemma whose bucket
  averaged 22,002 — and 266 without it. Report both numbers. A skeleton whose
  case rests on one row is a lottery ticket, not a mechanism.
- **Cross-validation.** A skeleton does not become a backbone stream on one
  account. It needs **n ≥ 10 on a second account** with a reply:like above that
  account's own baseline question. That is the test the dilemma passed (n=17,
  1.15 vs 0.89 baseline) and it is why it earned 7 slots.
- **Baseline-relative reading.** Compare a skeleton to *that account's* ordinary
  question, not to another account's absolute numbers. A 2,878-view average on a
  small account can be stronger evidence than 27,748 on a large one.

Append anything new to `mechanics.md` §1 in the same run, with n and the capture
date. That table is the reason next week starts ahead of this one.

## Step 3 — Subjects: what actually broke in the niche

Posts fail on subject far more often than on shape. The subject must be **AI, the
niche, or a live build-in-public controversy** — never biography (see
`mechanics.md` §5, the correction that retired the hospital stream).

Gather, in one parallel batch:

- `WebFetch https://news.ycombinator.com/best` and `.../front` — titles, points,
  comments. This is the highest-signal single read and it is where the last run
  found the story of the week.
- 4–6 `WebSearch` calls on: the last seven days in AI tooling; anything involving
  the operator's own stack (Claude, Cursor, agents); X platform and monetisation
  changes; the AI labour market; whatever the previous doc's §3 said was still
  moving.

**What makes a usable peg:** dated, checkable in ten seconds by a reader, and
something the audience has money or identity riding on. Three days old beats
three weeks old. A story every reader can verify is repostable; a story they must
take on trust is not.

**Find the spine.** Before writing a single post, name the one through-line the
week's events share, and put the post that says it out loud in the best slot of
the week. Last run: five separate stories all turned out to be *"every layer you
build on is owned by someone with an agenda"* → the closer, `A5`.

## Step 4 — Novelty: what has already fired

```sql
SELECT substr(replace(text,char(10),' / '),1,110), datetime(posted_at/1000,'unixepoch')
  FROM posts_published WHERE is_reply=0 AND posted_at > <14 days ago>
  ORDER BY posted_at DESC LIMIT 70;
```

Read all 70. Build the retirement list for §7: every subject, device and latch
fired in the last 14 days is spent.

Two collisions are easy to miss and both were caught last run:

- **A skeleton you are about to promote may already have fired in a different
  costume.** The dilemma looked new until two personal ones turned up (a
  salary-vs-security "Pick." and a keep-exactly-one-of-three). The shape was fine;
  the fix was making every dilemma in-niche.
- **A post firing tonight is not in `posts_published` yet.** Check
  `scheduled_posts WHERE status='pending'` too, and treat those subjects as spent.

Also log any **hand-swap**: a `scheduled_posts` row whose text doesn't match the
previous document. The operator edited the plan and that is data — report it
neutrally in §0, never as a correction.

## Step 5 — The slot grid

Six slots a day. **14:00 and 21:00 Bucharest are the operator's, manual, always
left empty.** Four generated per day.

| # | Bucharest | UTC | Who | Reaches |
|---|---|---|---|---|
| 1 | 10:20 | 07:20 | me | EU mid-morning · India 12:50 |
| 2 | **14:00** | 11:00 | **operator — manual** | EU afternoon · US East 07:00 |
| 3 | 17:35 | 14:35 | me | EU evening · US East 10:35 |
| 4 | **21:00** | 18:00 | **operator — manual** | EU prime · US East 14:00 |
| 5 | 23:50 | 20:50 | me — NIGHT | US East 16:50 · US West 13:50 |
| 6 | 02:35 *(next morning)* | 23:35 | me — NIGHT | US East 19:35 — **US evening prime** |

**Slot quality, best first: 02:35 > 23:50 > 21:00 > 17:35 > 14:00 > 10:20.**
Flagships go at 02:35 and 23:50. The friendliest, shortest post goes at 10:20.

Rules:
- **A day's block is 10:20 → next-morning 02:35.** A full week is 7 blocks × 4 = **28**.
  Invoked mid-week, the first day gets only the slots that haven't passed — say so.
- **Jitter each slot ±5 minutes**, never the round time.
- **Check the previous week's tail.** Its last post is usually the Monday 02:3x
  slot, which belongs to *its* Sunday block. Your first fire must be strictly
  after it. `validate.py` enforces this.
- Bucharest is EEST (UTC+3) until **Oct 25 2026**, then EET (UTC+2). Cross that
  date and the UTC column shifts by an hour.
- Never two of the same stream in one day — with four streams a day and five in
  rotation, the grid enforces it for free.

## Step 6 — Write the 28

Follow `references/mechanics.md` §2 (streams), §3 (rules R1–R10) and §4 (seed
craft) for every line. The short version, which is not a substitute for reading it:

- Weight the rotation by measured reply:like, not by what was fun to write.
- **Every post ends on an open element.** No punchline — a good closing line is a
  reply you post underneath, which is a second surface.
- **Every answer must be disputable by a stranger.** That is the multiplier.
- **Every seed opens a new axis**, never a conclusion. Dilemma seeds challenge the
  *credibility* of one group of repliers, not their opinion — that is what turns
  40 comments into 200.
- **Numbers must be inside the reader's reality** (R10). $40k, not $2M.
- Ration the confession: ~5 verdicts in 28, each in a day's best slot.
- The operator's age / thirty years appears **only as the warrant of an argument**,
  never as the subject. Two or three times in 28, not more.

Write the posts into a JSON file in the scratchpad as you go — `validate.py`
consumes it and generates the §11 table, so you never hand-compute a character
count or a UTC time.

## Step 7 — Validate before writing the document

```bash
python3 .claude/skills/draft-posts/scripts/validate.py <scratch>/posts.json \
  --prev evals/<previous-doc>.md
```

Hard fails: any post or seed over 280 chars, any URL, any hashtag, duplicate
tags, times not strictly increasing, first fire colliding with the previous
week's tail. Fix and re-run until clean. It also prints per-stream length medians
and the §11 markdown table — paste that table, don't retype it.

Then write the document per [references/document.md](references/document.md), and
**self-audit it**:

```bash
python3 .claude/skills/draft-posts/scripts/validate.py --doc evals/week_x_posts_<Mon>.md
```

This re-extracts every post body out of the finished markdown and checks it
against its own annotation and its §11 row. Last run it caught a post whose text
had been improved in the doc but whose character count still read the old value.
A document that disagrees with itself is worse than no document.

## Step 8 — Report

Hand the operator, in the terminal:

- The **one mechanism finding** that shaped the set, with its n and reply:like.
- The **spine** — the through-line and which post says it.
- **2–4 flags**, stated plainly: anything that got worse, anything unscored,
  anything you were unsure about. Last run flagged that the set ran longer than
  the previous one and explained why rather than hiding it. Honest accounting is
  the reason this document gets trusted.
- The validation line: rows, strictly increasing, no URLs, budget.
- The offer to queue.

Send the file with `SendUserFile`.

---

## Failure modes — what a bad run looks like

| Symptom | The actual mistake |
|---|---|
| Rotation built on a skeleton with one huge post behind it | Skipped outlier discipline (Step 2) |
| A post reads like a competitor's | Reused their *subject*, not just the shape. Subjects are theirs; skeletons are everyone's |
| Replies fill with link-droppers | Used the link-farm or "introduce yourself" shape. It pays in comments and costs verified share |
| Posts drift over 200 chars | Dilemmas and news pegs are structurally long; if the mix moves that way, say so in §1 rather than pretending the set got tighter |
| A seed kills its own thread | It answered the question. Seeds open axes (R6) |
| The document reads like astrology | §0 didn't admit what couldn't be measured |
| The operator finds a repeat | Step 4 read fewer than 70 rows, or skipped `status='pending'` |

## Modes

- `/draft-posts` — the full run above, for the next Monday.
- `/draft-posts <YYYY-MM-DD>` — a week opening on that Monday.
- `/draft-posts score` — Step 1 only: score the last set against its §10 and
  report. No drafting. Use when the own-post harvest has just landed.
- `/draft-posts queue` — after a document exists and the operator has read it:
  submit that document's §11 batch. Confirm the count and the budget first.
