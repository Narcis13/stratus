---
name: radar-analyst
description: >
  Read the stratus Radar sighting corpus — every tweet my armed sweep admitted,
  on any x.com page — rank what is still worth answering, and compose reply
  variants straight into the Radar queue. Use when the user says "analyse my
  radar", "what's worth replying to", "draft replies for the radar", "work the
  radar queue", or runs /radar-analyst. Reads through x_radar / x_radar_tweet;
  the only write is x_radar_draft_reply, which creates a local draft row —
  nothing here publishes, schedules or spends.
---

# Radar analyst

The Radar is the operator's armed sweep on x.com: it watches whatever page they
are scrolling and queues the tweets that clear their numeric filters. Every
sighting is mirrored to stratus, so this session can read the whole corpus —
including sweeps on `/search`, a list or a profile, which the passive `/home`
harvest structurally cannot see — rank it, and write replies back into the queue.

**The human still pastes every reply on X.** That is invariant #2 (programmatic
replies to other people are policy-blocked), not a limitation of this skill.

## Cost

**$0 to stratus.** No X API call, no Grok call, no image call exists on any path
this skill uses; a composed draft *replaces* the Radar's Grok batch spend
(~$0.002–0.01 per click) instead of adding to it. The reasoning is billed to this
Claude Code session, so it never shows up in `x_cost` or `/cost/daily` — don't go
looking for it there, and don't report "this cost nothing" as if the session were
free to the operator.

## Tools — and only these

| Tool | Use |
|---|---|
| `x_radar` | The corpus. Filters: `days` (default 7, max 60), `band`, `handle`, `admitted`, `worked`, `order` (`vpm`/`views`/`lastSeen`), `limit` (default 50, max 200). |
| `x_radar_tweet` | One tweet's whole history: the sighting, every `radar_drafts` row, every reply draft with its posted state. |
| `x_radar_draft_reply` | Write 1–3 angle variants into the queue as a `ready` draft. The only write. |
| `x_niche` | Persona, beliefs, reply persona, doctrine knobs — the voice to write in. |
| `x_me` | Dated events, current emotions, notes — what is true for the operator today. |
| `x_playbook` | Measured angle/relationship/latency lift. Cells below the gate read "insufficient data". |
| `x_person` | The dossier for one handle, before drafting to someone who matters. |
| `x_settings` | The live knobs, when the sweep config needs explaining. |
| `x_query` | Anything the tools above don't answer — recipes in [references/queries.md](references/queries.md). |

If this session has no `stratus` MCP tools connected, the same three routes are
reachable over HTTP with the stratus skill's helper:

```bash
bash .claude/skills/stratus/scripts/api.sh GET  "/x/radar/sightings?days=3&worked=false"
bash .claude/skills/stratus/scripts/api.sh GET  "/x/radar/sightings/<tweetId>"
bash .claude/skills/stratus/scripts/api.sh POST "/x/radar/drafts/compose" '{"tweetId":"…","variants":[{"text":"…","angle":"extends"}]}'
```

## 1. Read ladder

1. **`x_radar` first** — one call is the whole corpus. Start with
   `worked: false` and the operator's window (`days: 1` for "today", 3 for a
   working session, 7+ for a review). The response carries `summary` over the
   **entire filtered population**, while `sightings[]` is only the `limit` slice:
   `count < summary.total` means the *list* was cut, not the answer. If
   `truncated` is true the SQL scan itself hit its cap — narrow `days` or `handle`
   rather than quoting totals.
2. **`x_radar_tweet` before drafting for any tweet** — it is the only way to know
   whether a reply already went out. Never write a second reply to a tweet that
   already has a posted one.
3. **`x_niche` + `x_me`** once per session, before writing anything. The niche is
   the voice; Me is what is actually going on this week.
4. **`x_playbook`** when choosing angles or justifying a pick — and quote a cell
   only when it is above its sample gate. "Insufficient data" is the answer, not
   a number to round up.
5. **`x_person`** for any handle with a `stage` or `isTarget` flag worth acting on.
6. **`x_query`** last, for the long tail (see references/queries.md).

## 2. Selection rule

Rank the candidates in this order:

1. **`admitted && !worked`** — the reply that could still have been written.
   `summary.unworkedAdmitted` counts them; that number is the finding.
2. **`vpm`** (views per minute at the last sighting) — velocity beats raw views.
3. **Relationship** — a `stage` or `isTarget` row outranks a louder stranger.
   That is the ordering the panel already uses, and the Playbook's relationship
   lift is why.

Then **check the age before drafting**. `postedAt` older than the echoed
`sweep.maxAgeMin` by hours means the reply lands under a dead post: say so and
skip it rather than drafting. A composed draft resurrects the card in the panel
even for a tweet that aged out of the browser's 24 h queue, so this check is the
only thing standing between the operator and a reply to yesterday.

Work **5–10 tweets per pass**, not the whole queue.

## 3. Drafting rules

- **2–3 variants per tweet, each a genuinely different angle.** The vocabulary is
  `extends` · `contrarian` · `debate` · `observation` · `question` (`network` also
  exists, but it answers a different objective — addressing the author rather than
  the reply stack — so use it only when the operator asks for a relationship move,
  never as a third reach variant).
- **The first variant is the primary** — it is what the card shows by default.
- **≤500 chars.** Longer is refused (`reply_too_long`).
- **Never fabricate.** The stored `text` is truncated at 500 characters and is all
  the context there is. No invented claims about the author, their numbers, their
  job or their history; no invented lived anecdote. If a tweet cannot be answered
  without inventing something, that is a reason to drop it from the pass.
- **Match the tweet's language.** A Romanian tweet gets a Romanian reply.
- **No "As an AI", no "great post", no hashtags, no emoji** unless the operator's
  own voice uses them (`x_niche`).
- One `x_radar_draft_reply` call per tweet. Composing again for the same tweet
  **expires** the previous draft — that is how you revise, and the newest `ready`
  row is what the human sees.
- A `404 sighting_not_found` means the tweet is not in the corpus at all: the
  sweep never captured it, so there is nothing to draft against. Don't retry.

## 4. Hand-off — how the reply actually reaches X

Say this at the end of every drafting pass, in these terms:

> Composed N drafts. Open the stratus panel → **Radar** tab → **Fetch drafts**.
> The rows come back reply-ready with angle tabs; click the reply body to copy it
> and open the tweet, then paste.

Mechanics worth knowing so the report is accurate:

- **Fetch drafts** is a header button on the Radar tab. Its note reads
  `N new drafts`, `up to date`, or `Fetch failed — the queue is unchanged`.
- `up to date` after a compose usually means the tweet is **no longer in the
  browser queue** — a drafting pass or a **Clear** dismissed it, and a dismissal
  lasts 24 h. The draft is not lost; it is reachable through the Radar's own
  drafts read, but it will not re-enter the queue. Tell the operator to compose
  against a queue they have not just cleared.
- Clicking the reply body copies that variant, opens the tweet, and moves the row
  to **Clicked**, leaving a `reply_drafts` row with `source='radar'` and
  `model='claude-code-mcp'`. That model string is the cohort key for "did my
  drafting beat Grok's" — see references/queries.md.
- After the paste, the operator should flip that draft to `posted` with the real
  `postedTweetId` (the stratus skill's reply flow), or the outcome never joins.

## 5. Honesty rules

- **Never invent a metric the tools didn't return.** No follower counts, no
  engagement rates, no author size — none of it is in this corpus.
- **`admitted` is recomputed against *today's* sweep config**, which the response
  echoes under `sweep`. When explaining why an older row reads `admitted: false`,
  name the gate it fails (`minViews`, `maxAgeMin`, `verifiedOnly`…) and say that
  the filters may have changed since — the row is not necessarily junk.
- **`admitted: null` means unjudgeable** (no known post time), not "rejected".
- **Say when the corpus is thin.** An empty queue usually means no sweep was armed,
  which is a fact about the week, not a bug. `summary.bySourcePath` says where the
  sweeping actually happened; `unknown` is a row captured before the path was
  recorded.
- **Report gates out loud** when quoting the Playbook, and never compare angle
  cells across **2026-08-08** — `observation` and `question` did not exist before
  it, so a pre-boundary `extends` cell is a different population.

## The ceiling — what this skill must never do

- Never publish, and never offer to. No route here reaches `createPost`.
- Never create a `pending` calendar row or schedule anything.
- Never spend: no Grok drafting, no curation call, no image generation. If the
  operator wants Grok's batch instead, that is the Radar tab's own buttons.
- Never write `people`, `person_events` or `mentions` rows off a sighting —
  exposure is not interaction.

## What a sighting row means

| Field | Reading |
|---|---|
| `band` | **Why** the row is here, never a judgement: `sweep` = the numeric filters admitted it; `manual` = pinned by hand with ⊕; `cannon` = camped-roster capture (metric gates bypassed); `roster` = a fresh post by someone in the circle (metric gates bypassed). |
| `admitted` | Would today's filters admit this capture, judged at the age it had when last seen. `null` = no known post time. |
| `worked` | A `radar_drafts` row of any status exists **or** a reply was posted. |
| `vpm` / `ageMinAtLastSeen` | Views per minute, and the age, **at the last sighting** — not now. |
| `sourcePath` | The x.com pathname it was captured on. The one thing the passive `/home` corpus cannot answer. |
| `stage` / `isTarget` | Joined from the people layer at read time. A retired person reads `stage: null`. |
| `seenCount` | How many times the algorithm put this in front of the operator. |
| `bait` / `verified` | Capture-time flags. `verified: null` = the badge was unreadable, and the sweep's `verifiedOnly` gate **refuses** on unknown. |

## Traps that look like bugs

- **A composed draft makes its own sighting read `worked: true` immediately.**
  Correct — the composing *is* the work — but it means `worked: false` cannot
  re-find what you drafted five minutes ago. Use `x_radar_tweet` for that.
- **`admitted` flips when the operator retunes their sweep.** By design; the
  alternative would freeze a rule they change weekly.
- **The sighting reads write nothing** — no TTL flip, no queue advance. A draft
  that is stale by the panel's 48 h expiry can still read `ready` here until a
  panel read flips it.
- **The passive `/home` harvest has a 2026-07-27 → 2026-08-17 hole** (the capture
  toggle was off). It is collecting again, but any "what the algorithm feeds me"
  reading built on `harvest_rows` over that span is a 4-day window plus a resumed
  one, not a continuous month. Say so rather than averaging across it.
