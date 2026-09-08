# Research — finding what is hot before it is obvious

The point of the research is not "what is trending". It is "what shape is the
ranker rewarding in my niche right now, and which wave is young enough that a
remix still reads as original". Everything here is a $0 DOM read in Chrome.

## Why this works, mechanically

The For You ranker (open-sourced January 2026, `xai-org/x-algorithm`) scores a
post as a weighted sum of predicted actions: replies, likes, reposts, quotes,
profile clicks, dwell, follows, minus not-interested/mute/block/report. Three
adjustments then shape reach: repeated posts from one author decay, out-of-
network candidates are discounted, and posts under an impression threshold get
a lift. Posts older than 48 hours are dropped before ranking.

What that means for a 1.3K account trying to buy impressions with text:

- **Replies and dwell are the currency.** A post that is read twice (because
  it has a hole) and answered (because it has a two-second reply) beats a post
  that is liked and scrolled.
- **The new-author boost is real and short.** The first minutes decide whether
  the post leaves the graph. Seed at once, sit on it.
- **Out-of-network is discounted, so the post must be worth the discount.**
  Nothing that needs your bio to make sense. A phrase everyone knows plus a
  question everyone can answer in five words is the shape that has crossed
  graphs on this account before.
- **Since 2026-09-07 the payout is qualified impressions**: unique Premium
  users seeing ≥50% of the post on the Home Timeline. Replies do not count as
  impressions; replies *cause* impressions. Verified repliers bring verified
  audiences. That is why reply:like is the number to read on every candidate.

## 1. The For You read

Reload `https://x.com/home`, confirm the **For You** tab is highlighted, and
scroll three to four screens. Do not read Following for this; it is
chronological and shows what your follows posted, not what the ranker chose.

For every on-niche card, capture one row:

```
gist (≤12 words) · @handle · size (small <5K / mid 5–50K / big >50K) · age · views · replies · likes
```

`get_page_text` is faster than a screenshot for the numbers; the view count is
the bar-chart icon, replies the speech bubble.

**A mover** is any of:
- under 6 hours old with replies ≥ 0.5 × likes (a fight or a game)
- views ≥ 20× what the author's size would predict (a small account escaping)
- 40+ replies under 2 hours old (a game that caught)

**A wave** is the same subject on two or more unrelated accounts in one
scroll. Waves are what you want to ride; a lone mover is what you want to
borrow the shape from.

**Ignore**: ads, promoted, news wires, war/politics, giveaways, "drop your
project", "introduce yourself", polls, anything with a video doing the work
(the number belongs to the video, not the text).

## 2. The search recipe

The x.com search box takes operators; the filters below were all confirmed
working in the logged-in web search in mid-2026. **Latest** tab first (the
earliest signal above the noise floor), then **Top** (what already won).

Standing queries, run with `since:` set to yesterday or the day before:

```
(claude code OR cursor OR codex OR "coding agent" OR "ai agent") min_faves:150 -filter:replies lang:en since:YYYY-MM-DD
("vibe coding" OR "vibe coder" OR vibecoded) min_replies:40 -filter:replies lang:en since:YYYY-MM-DD
("learn to code" OR "junior dev" OR "junior developer" OR "senior engineer") min_faves:200 -filter:replies lang:en since:YYYY-MM-DD
(founder OR "indie hacker" OR solopreneur OR "build in public") min_replies:50 -filter:replies lang:en since:YYYY-MM-DD
("AI" AND (jobs OR layoffs OR hiring OR "replaced")) min_faves:300 -filter:replies lang:en since:YYYY-MM-DD
```

Plus one per user keyword: `<keyword> min_faves:100 -filter:replies lang:en since:<yesterday>`.

Reading the results:
- `min_replies` surfaces fights and games; those are where the *formats* are.
- `min_faves` surfaces reach; those are where the *subjects* are.
- `filter:blue_verified` works in the web box if you want to see what
  Premium accounts specifically are pushing; the payout audience is Premium.
- Ten results per query is enough. You are sampling, not archiving.

Then **Explore → Trending**: only note items that are tech or AI and have
crossed into the general timeline. A general-timeline trend with a niche angle
is the widest room you will find all day.

## 3. The "about to burst" test

Score each candidate 0–2 on each line. The winner is the highest total that
is not on the retirement list; ties go to the wider room.

| Test | 0 | 1 | 2 |
|---|---|---|---|
| **Wave age** | subject is a week old or older, or it is a lone post | one mover, subject under 3 days | two or more accounts on it inside 24 hours |
| **Room width** | needs a product name or insider context | builders only | a builder, a laid-off senior and a non-tech Premium user could all answer |
| **Two-second reply** | needs a paragraph | one sentence | one to five words, or a name, or a number |
| **Twist available** | you would be restating the source | a different framing | a genuinely different axis: the economist's, the institution's, the thirty-years, the "who paid", the next consequence |
| **reply:like on the source** | under 0.3 | 0.3–0.7 | over 0.7 |

A candidate scoring under 6 is a pass. If nothing clears 6, widen: go back to
For You and scroll two more screens, or swap in a phrase-on-trial (formats.md
§1, the successor question) on whatever the strongest subject was. The
account's own best skeleton needs no wave at all; it needs a phrase everyone
already repeats.

## 4. What to do with the winner

You are taking **the subject of the wave and the shape of the mover**, and
then adding a twist neither had. You are not taking anyone's wording. If a
phrase from a source post survives into the draft, the draft is wrong.

Three questions that produce the twist fast:

1. **Who actually pays for this?** The economist's question. Turns any tool
   fight into a money question, which resolves to a number.
2. **What does this look like inside an institution that cannot demo?** The
   hospital's question. Every AI-tools post assumes a startup; most readers
   work somewhere with a change advisory board.
3. **What did the same argument look like in 2012, or 1996?** The
   thirty-years question. Pins the wave to a decade, which makes it civic
   instead of personal, and civic is what leaves the graph.

Pick one. Never stack two; one twist per post.
