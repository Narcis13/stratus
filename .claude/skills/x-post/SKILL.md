---
name: x-post
description: >
  Research what is hot in my niche right now on x.com (For You, Explore, keyword
  searches via Chrome), pick the idea and the viral format that is about to
  burst, remix it into one original post in my voice, publish it from
  x.com/home, and immediately seed it with a first reply that opens a second
  angle. Optimises for impressions. Use when the user says "/x-post",
  "/x-post <keywords>", "post something", "find me a banger", "what should I
  post right now", or wants one original written and published now. Browser
  only; never touches the X API or the stratus queue.
---

# x-post — one original, researched, posted, seeded

Post one original on x.com using Claude in Chrome. Parse `$ARGUMENTS`:

- **keywords** (optional): everything that is not a flag, e.g. `claude code`,
  `agents layoffs`, `learn to code`. Seeds the Explore searches in Step 2 on top
  of the standing niche queries. Missing → the standing queries alone.
- **`dry`** anywhere in the args: do everything up to the draft, print the
  candidates, post nothing. Use it to rehearse.
- **`quick`** anywhere in the args: after seeding, do one pass at 10 minutes
  instead of the default 20–30 minute sit (Step 7).

Examples: `/x-post` → full run. `/x-post cursor agents` → research tilted to
those words. `/x-post dry` → research + drafts, no publish.

Invoking this skill also means the operator has checked that **nothing is
scheduled to fire in the next 45 minutes**. The skill does not verify the
queue; the operator owns that.

Running this skill IS the authorization to publish **one** original plus **one**
seed reply. Do not ask before posting. Do the work, report at the end.

**Hard cap: one original per run.** X's Original Content Rewards disqualifies
"content generated using automated tools to create engagement"; volume is the
behavioural signature they police, and the ranker's author-diversity decay
punishes the second post from the same account inside a short window anyway.
Spread runs across the day. Never run this twice inside 90 minutes.

## Who is posting

@13_narcissus. 51, thirty years of code, IT admin in a Romanian public
hospital 08:00–15:00, ships after 15:00; trained economist; wife runs an
accounting practice with ~20 SMB clients; building toward 5K MRR to leave the
job. Building in public, into programming, AI and marketing. ~1,300 followers.

That biography is a **warrant, never a subject**. The one measured 1.45M-view
post on this account had no age, no product, no hospital in it; that is what
let it leave a 1.6K-follower graph. Use at most ONE personal detail per post,
only when it is the reason the claim is credible, and never a bio-dump. The
audience is builders, indie hackers, AI people, solo founders and the
late-career engineers watching the ladder shake. Nothing else gets posted.

## Cost and what this skill never does

**$0 to stratus, and no stratus read at all.** Everything is a Chrome read of
x.com: the profile for novelty, For You and search for the wave. Publishing
goes through the browser, not `createPost`, so no $0.015 line lands in
`cost_events`; the extension's DOM harvest picks the post up later like any
hand post. No X API call, no Grok call, no MCP call. The reasoning is billed to
this Claude Code session.

Never: schedule through the queue, edit `scheduled_posts`, paste a link in the
post (invariant #1, $0.20), use a hashtag, add media, post more than once,
reply to anyone else's post as part of this run, or like your own post.

## Files you own

| Path | What |
|---|---|
| `references/research.md` | How to find what is hot: the For You read, the search recipe, the "about to burst" test, scoring a wave. |
| `references/formats.md` | The format library: measured skeletons with n and reply:like, the account's own winning skeleton, the remix rules, the hook mechanics behind impressions. |
| `references/voice.md` | Voice for originals and seeds: human, punctuation-light, blank lines, holes for the replies. The 2026 LLM tells. |
| `scripts/check.py` | The gate. Length, URL, hashtag, emoji, punctuation density, tell-words, blank-line structure, seed presence. Run it before posting, always. |

Read all three references at the start of every run. They are short.

---

## Step 0 — Setup and the novelty read

0. Keep the Mac awake for the run. This machine idle-sleeps after 1 minute
   and blanks the display after 10; Step 7 waits up to 5 minutes between
   passes, which is exactly where a run dies. Start a detached, time-bounded
   assertion (60 min covers research plus the full sit):
   ```bash
   nohup caffeinate -dis -t 3600 >/dev/null 2>&1 &
   ```
   Claude Code's own `caffeinate -i -t 300` is not enough: it lapses during
   Monitor waits and never holds the display, and Chrome throttles a tab on
   a dark screen.
1. Load the Chrome tools in one `ToolSearch` call if not loaded:
   `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp,mcp__claude-in-chrome__find,mcp__claude-in-chrome__get_page_text`
2. `tabs_context_mcp` with `createIfEmpty: true`, then open a **new tab** on
   `https://x.com/13_narcissus`. Make sure the **Posts** tab is selected (not
   Replies, not Highlights). This is the only source of truth for what the
   account has fired: the operator posts a lot by hand, so the stratus tables
   are incomplete and are not consulted.
3. **Novelty.** Scroll the Posts tab until you have read every original from
   the **last 14 days**, or about 40 posts, whichever is more. Skip the pinned
   post's position but read its text. Use `get_page_text` per screen; expand
   "Show more" on anything truncated. Record for each: age, first line, the
   skeleton it uses, and its numbers if visible.
   - Every subject, device and latch you read there is **retired** for this
     run. A skeleton that fired yesterday in a different costume is a
     collision too.
   - Note the **skeletons of the last two originals**; Step 3 must not reuse
     either.
   - Note the **most recent post's age**. If it is under 45 minutes, stop and
     report: the operator said nothing fires in that horizon, so a post that
     fresh means a hand post just went out and this run would be the second
     one in the window. Do not post.
   - Note anything of the operator's that is **currently moving** (replies
     climbing in the last hour). If one is, the report says so and Step 7 gives
     it a pass too; the operator would rather sit on the mover than start a
     new one, but the new one still goes out.
4. Then navigate to `https://x.com/home` and reload once so the feed is fresh.

## Step 1 — Read For You: what is moving right now

The For You tab is the ranker telling you what it is currently willing to
amplify in your graph. Read it as data, not as entertainment. Full recipe in
`references/research.md` §1.

- Scroll three to four screens. For every card that is on-niche note: author
  handle and rough size, age, views, replies, likes, and the **one-line gist**.
  Use `get_page_text` when the numbers are small in a screenshot.
- Flag **movers**: under 6 hours old, replies-to-likes at or above 0.5, or views
  visibly out of proportion to the author's size. A mover is the ranker
  already rewarding a shape; you want the shape, not the post.
- Flag **waves**: the same subject on two or more unrelated accounts inside the
  same scroll. A wave inside its first 24 hours is the window; after that the
  timeline has seen the trick.
- Skip ads, promoted, news wires, politics, giveaways, link farms, "introduce
  yourself" chains. They are not formats you can borrow.

Write the candidates down as you go (a scratchpad file is fine): 5–8 rows of
`gist · author size · age · views · replies · likes · why it moves`.

## Step 2 — Explore: search the niche on purpose

For You shows you your own bubble. Search shows you the rest of the niche.
Full recipe and the query bank in `references/research.md` §2.

Run 4–6 searches in the x.com search box, **Latest** tab first then **Top**,
each with an engagement floor so the noise is gone:

```
(claude code OR cursor OR codex OR "coding agent") min_faves:150 -filter:replies lang:en since:<yesterday>
("vibe coding" OR "vibe coder") min_replies:40 -filter:replies lang:en since:<two days ago>
("learn to code" OR "junior dev" OR "junior developer") min_faves:200 -filter:replies lang:en since:<two days ago>
(founder OR "indie hacker" OR solopreneur) min_replies:50 -filter:replies lang:en since:<yesterday>
```

plus one per user keyword. `min_replies` finds fights; `min_faves` finds
reach. Then glance at **Explore → Trending** for anything tech or AI that has
crossed into the general timeline.

Add the best 3–5 rows to the candidate list. You now have 8–12 candidates.

## Step 3 — Pick the winning idea

Score each candidate with the "about to burst" test in
`references/research.md` §3. In short, the winner is the one where:

1. **The wave is young.** The subject is being posted about right now by more
   than one account and it is not yet a week old.
2. **The room is wide.** A builder, a laid-off senior and a non-tech Premium
   user could all answer it. Impressions come from out-of-network; anything
   that needs the reader to know a product name stays in-network.
3. **The two-second reply exists.** Before writing anything, say out loud what
   a stranger types under it in two seconds. If you cannot, the idea is dead.
4. **You have a twist.** An angle the source post did not take: the
   economist's view, the institution's view, the thirty-years view, the
   "who actually paid" view, the next consequence. Without a twist it is a
   copy, and copies do not travel.
5. **It is not in the retirement list** from Step 0, the profile read.

Then choose the **format** from `references/formats.md`. The rule of thumb:
a phrase everybody repeats → referendum or successor question; a live fad →
receipts; two tribes → faction split or dilemma; a thing people can list →
challenge board; a fake title → gate. Never the same format as the account's
last two originals (Step 0 tells you what they were).

## Step 4 — Draft three, keep one

Write **three candidates in three different formats** on the winning idea.
Voice rules are in `references/voice.md`; the short version:

- **Length 40–140 characters, 200 hard ceiling.** The 1.45M post was 92. The
  measured top of the distribution lives at 30–110.
- **Almost no punctuation.** No periods at line ends, no commas where a line
  break can do the work, no colons, no semicolons, no em dashes. A real
  question ends with `?` and nothing else.
- **Blank line between phrases.** One thought per line, the way people type on
  X. Three lines is usually the whole post.
- **Lowercase is fine. Contractions always. Dropped apostrophes fine.**
- **Leave a hole.** An absolute claim with an obvious exception, a missing third
  option, an unnamed answer, a number that is slightly wrong on purpose. The
  hole is what the replies fill. A post with no hole gets likes and dies.
- **Take a side.** Punchy, contrarian, intriguing. It is fine if half the room
  disagrees; the disagreeing half is the one that types.
- **End on the open element.** The last word is the latch: `yet`, `still`,
  `pick`, `which`, `name one`, `?`. Never a punchline, never an aphorism.
- **Nothing that begs.** No "follow", no "like if", no "RT", no "thoughts?".

Then write the **seed reply** for the one you keep: it opens a second angle,
extends the stance, or confirms it with the one detail the post left out.
Seed patterns and anti-patterns in `references/formats.md` §4. The seed
never answers the post's question outright and never out-writes the post.

Put the winner and its seed in a JSON file in the scratchpad and run the gate:

```bash
python3 .claude/skills/x-post/scripts/check.py <scratch>/post.json
```

Fix every fail, read every warning, re-run until clean. In `dry` mode print
all three candidates with the gate output and stop here.

## Step 5 — Publish from x.com/home

1. Back on `https://x.com/home`. Click the inline composer ("What's
   happening?"). If it is not there, navigate to `https://x.com/compose/post`.
2. Type the post with the `computer` tool. **Enter inserts a newline in the X
   composer; Cmd+Enter sends.** Type the blank lines as two Enters. Never
   press Cmd+Enter until you have verified.
3. Screenshot. Check the text landed intact: the blank lines are visible, no
   autocorrect changed a word, the character counter is under 280, no link
   card appeared, no "Who can reply" restriction is set (leave it on Everyone).
4. Click **Post**. Confirm the "Your post was sent" toast.
5. Open the post: click **View** on the toast, or go to
   `https://x.com/13_narcissus` and open the top post. Read the URL from the
   address bar and keep it; the report needs it.

## Step 6 — Seed within 60 seconds

On the post's own page:

1. Click into the reply field under the post (or the reply icon on the card).
2. Type the seed exactly as gated. Screenshot, verify, click **Reply**.
3. Confirm the toast, then reload the post page and check the seed is the
   first reply under the post.

The seed does three things: the first reply is not a stranger's, the post
becomes a two-surface thread, and it proves someone is home so replying is
worth a stranger's time. Do not skip it and do not delay it.

Nothing is written to stratus. The next run reads the profile, so the post is
already on record where it matters.

## Step 7 — Sit on it: 20 to 30 minutes

Early velocity decides out-of-network reach: engagement in the first 15–30
minutes is what the ranker reads, and an author reply to a reply is the
strongest conversation signal it has. Stay on the post page for the whole
window.

- **Default: sit 20–30 minutes.** Reload every ~5 minutes (use a Monitor or
  an until-loop between passes; foreground sleep is blocked). On every pass
  answer **every real reply**: a question, pushback, a claim, an answer to the
  post's ask. One line each, same voice as `references/voice.md`, a different
  angle each time so the thread does not read as a form letter. No cap on
  count; the cap is the window.
- **`quick`:** one pass at ~10 minutes, then stop.
- Skip likes-only, emoji, "great post", link drops and anything that needs
  you to invent a fact. Never reply to your own seed. Never argue twice with
  the same person; one answer, then let them have the last word.
- If Step 0 found one of the operator's earlier posts still moving, give it
  one pass in the same window.
- Stop early only if the post is dead: under ~150 views and no replies at
  25 minutes. Say so, do not explain it, do not boost it.
- Read the numbers on the last pass: views, replies, likes, and the time
  since posting.

## Step 8 — Wrap-up

Release the sleep assertion first: `pkill -f 'caffeinate -dis -t' || true`
(the pattern does not match Claude Code's own `-i -t 300` instances). Close
any tab you created. Report, in this order:

1. **The wave.** What is hot, with 2–3 receipts (author, age, views/replies,
   gist). One line on why it is about to burst rather than already burst.
2. **The pick.** The idea, the format, the twist, the two-second reply you
   expect, and which of the profile's recent posts it was checked against
   (the two skeletons ruled out, any near-collision you steered around).
3. **The three candidates**, the winner marked, the gate output line.
4. **What went up:** the post text, the seed text, the URL, the time (UTC and
   Bucharest).
5. **The sit:** how long you stayed, the numbers at the last pass, and every
   author reply you posted (who, what they said, what you answered).
6. **What to watch:** when to check again, the spike protocol trigger (>2K
   views in 30 minutes: cancel the day's next queued slot, reply to
   everyone for 48h, pin for 72h, sequel on day 3 with the same skeleton on an
   adjacent subject).

---

## Failure modes

| Symptom | The actual mistake |
|---|---|
| The post reads like a news headline | Took the wave's *subject* and no twist. Impressions need a question a stranger can answer, not a fact they can nod at |
| Replies are all "it depends" | No latch. Add the line that kills the escape route |
| Likes, no replies | No hole, or a punchline at the end. The aphorism belongs in the seed |
| The post is about you | Biography as subject. It stays a warrant; one detail, max |
| Three commas and a colon | Wrote it, did not say it. Read it out loud, then delete the punctuation |
| The seed killed the thread | It answered the question. Seeds open axes |
| Posted at 02:00 Bucharest and nobody came | Wrong window for the room; the US-evening slot is for content that fires unattended, and this skill exists to sit on a post |
| Two posts in an hour | The cap is one. The queue is already posting four a day |
