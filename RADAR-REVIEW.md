# Radar — how it works & refactor notes

> Scratch review doc (2026-06-17). The Radar is the Today-tab "worked queue" of
> hot/warm tweets you scrolled past on X. Pure presentation — **$0**, no X API,
> no crawling. This captures the end-to-end flow and refactor candidates.

## Data flow

```
content.ts (producer)  →  background.ts (single writer)  →  chrome.storage.session  →  Radar.tsx (reader)
   on every x.com tab        promise-chained writes          ring buffer + dismissed       Today tab section
```

Four layers, one shared pure core (`shared/radar.ts`, unit-tested).

## 1. Producer — `extension/src/content.ts` (runs in every x.com tab)

The badge logic already classifies every visible tweet. `applyBand()`
(`content.ts:894`) computes `sig = readTweetSignals(article)` and
`band = classifyBand(sig)` from the shared `replyBand.ts`. The only Radar hook
is line 900:

```ts
if (sig && (band === 'hot' || band === 'warm')) recordRadarSighting(article, band, sig);
```

`recordRadarSighting` (`content.ts:918`) builds a `RadarSighting` (tweetId, url,
handle, author, 200-char text snippet, band, rounded signals,
`firstSeenAt`/`lastSeenAt`) and stashes it in a `pendingRadar` Map. Two throttles
keep it cheap:

- **Per-tweet resend throttle** (`RADAR_RESEND_MS = 60s`, `content.ts:922`) —
  `applyBand` re-fires on every DOM mutation burst, but a given tweet is only
  re-reported once a minute *unless its band changed*.
- **Batched flush** (`RADAR_FLUSH_MS = 2s`, `flushRadar` `content.ts:945`) — one
  `chrome.runtime.sendMessage({type:'stratus/radar-report', sightings})` per 2s
  window, deduped by tweetId.
- `radarSentAt` Map tracks last-sent time/band; hard-reset if it exceeds 3000
  entries (marathon-scroll guard).

### Band classification formulas — `src/shared/replyBand.ts`

`classifyBand(sig)` is the canonical scorer, shared by the on-page badge and the
server-side band gate so they can never disagree. Only `hot`/`warm` reach the
Radar.

**Inputs (`TweetSignals`):**

| Signal | Meaning |
|---|---|
| `views` | view count |
| `replies` | reply count |
| `ageMin` | minutes since posted |
| `vpm` | `views / max(ageMin, 1)` — views per minute |
| `bait` | question/poll/take-bait format (text regex + DOM poll check) |

**Thresholds (`BAND` constants):**

```
bigViews     = 300   floor to be "worth a reply"
baitViews    = 180   lower floor when the post is reply-bait
earlyReplies = 40    still near the top of the thread
midReplies   = 120   past this you're buried
freshMin     = 15    the "early reply" window (minutes)
risingVPM    = 20    views/min that projects into the band while fresh
baitVPM      = 12    relaxed rising bar for bait
watchVPM     = 8     promising-but-unproven velocity
```

**Derived booleans:**

```
fresh       = ageMin <= 15
viewFloor   = bait ? 180 : 300
vpmFloor    = bait ? 12  : 20
bigEnough   = views >= viewFloor  OR  (fresh AND vpm >= vpmFloor)
earlyEnough = replies <= 40
```

**Classification (top-down, first match wins):**

```
1.  replies > 120                                  → skip   (deep thread, buried)
2.  ageMin > 20 AND views < 300
        AND vpm < 15 AND not bait                  → null   (too small, won't grow)
3.  bigEnough AND earlyEnough (replies <= 40)      → hot
4.  bigEnough AND replies <= 120                   → warm   (good size, mid-pack)
5.  fresh AND vpm >= 8 AND replies <= 25           → warm   (early, promising)
6.  otherwise                                      → null
```

In plain terms:

- **`skip`** — thread too deep (>120 replies); a reply gets buried regardless of size.
- **`hot`** ("reply now") — big enough *and* still early (≤40 replies). "Big
  enough" = cleared the view floor (300, or 180 for bait), *or* still fresh
  (≤15 min) and climbing fast (≥20 vpm, ≥12 for bait).
- **`warm`** ("watch") — two paths: big enough but mid-pack (41–120 replies), or
  fresh with promising velocity (≥8 vpm) and shallow (≤25 replies).
- **`null`** — everything else, plus the early-out for stale-and-small tweets.

The **bait discount** is the key lever: questions/polls get a lower view floor
(180 vs 300) and lower velocity bar (12 vs 20 vpm), because bait formats pull
the threads where an early sharp reply gets seen.

> **Calibration caveat.** Thresholds were tuned against a single account's
> 345-reply set (@santoshstack, ~6 days; `evals/analyze-santoshstack.ts`). The
> module header notes freshness was a *weak* predictor, so the velocity paths
> (rule 3-via-vpm and rule 5) are the least-trustworthy part of the model.
> Recalibrate `BAND` only at ≥100 of your own measured outcomes (CLAUDE.md §6.2
> crosstab).

## 2. Single writer — `extension/src/background.ts`

chrome.storage has **no transactions**, and reports stream in from *every* open
x.com tab plus dismissals from the panel. So all writes funnel through one
promise chain (`radarChain` / `enqueueRadar`, `background.ts:95`) to serialize
read-modify-write. Two message handlers:

- `radar-report` (`background.ts:141`) → `addSightings` → `mergeSightings`
- `radar-dismiss` (`background.ts:148`) → `dismissSightings` → filters buffer + `appendDismissed`

## 3. Pure core — `extension/src/shared/radar.ts` (unit-tested)

- **`mergeSightings`** (`radar.ts:40`) — keyed by tweetId; fresher
  signals/band/lastSeenAt win, `firstSeenAt` survives from the earlier entry,
  **dismissed ids never re-enter** (critical — the content script keeps
  re-sighting a still-rendered tweet). Caps at `RADAR_CAP = 100`, evicting
  least-recently-seen.
- **`appendDismissed`** (`radar.ts:60`) — dedup set, cap `RADAR_DISMISSED_CAP = 500`.
- **`rankSightings`** (`radar.ts:69`) — band (hot > warm) → vpm → recency.

Two storage keys in `chrome.storage.session` (cleared on browser close =
intended queue lifetime): `radar:sightings`, `radar:dismissed`.

## 4. Reader — `extension/src/sidepanel/Radar.tsx` (mounted at `Today.tsx:54`)

`useRadarSightings` reads the buffer once and subscribes to
`chrome.storage.onChanged` (session area). Renders ranked rows: band chip,
author, dismiss ✕, clickable snippet → opens tweet, and a "why" line
(`whyLine`, `Radar.tsx:115`) like `1.5k views · 8 replies · 22m · 70/min · bait`.
`displayAgeMin` (`Radar.tsx:125`) keeps the age **ticking** after capture
(`signals.ageMin + (now − lastSeenAt)`). Dismiss/Clear route back through the
background (the single writer), not direct storage writes.

---

## Refactor candidates (by value)

The design is clean — pure core isolated and tested, single-writer invariant
sound, throttle/batch logic reasonable. Candidates:

1. **Reader doesn't re-rank on age drift.** `displayAgeMin` recomputes from
   `Date.now()` per render, but the component only re-renders on a storage
   change — a sighting's displayed age (and `vpm`-based rank) goes stale until
   the next report/dismiss. A periodic re-render tick (or `setInterval` forcing
   state) would keep the "why" line and ordering honest while the panel is open.

2. **No staleness/expiry.** A tweet sighted once lives in the buffer until
   evicted by the 100-cap or browser close. A 2-hour-old "hot" sighting is no
   longer actionable. A TTL prune (drop entries older than N hours on read or
   merge) would make the queue self-cleaning rather than relying only on the cap.

3. **`isRadarSightings` runs in three places** (reader, background read, message
   guard) but validates loosely (doesn't check `firstSeenAt`/`lastSeenAt`/`text`
   shape). Minor — could tighten or share one validator.

4. **Duplicated dismiss-message plumbing** — `Radar.tsx` builds the
   `RadarDismiss` message inline; if Radar grows more actions, a tiny
   `bgClient`-style helper (already have `shared/bgClient.ts`) would centralize
   the `sendMessage` + error handling.

5. **Author/snippet extraction in `recordRadarSighting`** duplicates DOM-query
   patterns that likely exist elsewhere in `content.ts` (badge rendering,
   capture path). Worth checking if `findPermalink`/author lookup can share one
   helper. *(Unverified — confirm against the capture path before acting.)*

---

## Recalibrating the BAND model

The thresholds in `src/shared/replyBand.ts` are tuned by hand from outcome data,
not auto-optimized. Two data sources, complementary:

### Gold standard — your own measured outcomes (`evals/analyze-own-replies.ts`)

```bash
bun run evals/analyze-own-replies.ts   # needs STRATUS_BASE_URL + API_TOKEN in .env
```

- Each posted reply is a labeled row: band stamped at capture time
  (`reply_drafts.contextSnapshot.signals`) + measured outcome from the 03:00 UTC
  snapshot pass, joined via `GET /x/replies/outcomes`.
- **Prerequisite:** `postedTweetId` must be set on the draft (PATCH after
  pasting) or the row is `unlinked` and doesn't count. The §6.3 harvest reconcile
  backfills some.
- The script **refuses to recommend changes below 100 measured rows** — prints
  the crosstab but says don't touch thresholds.
- Carries `profileVisits` (the follow-precursor the foreign sets never had).

### Cross-validation — harvest another creator's replies (`evals/analyze-santoshstack.ts`)

```bash
bun run evals/analyze-santoshstack.ts <path-to-harvested.csv> [@creatorhandle]
```

- Extension Harvest tab, **replies mode**, on a target creator's profile →
  downloads a CSV with the exact 11-column shape this script reads. Arg 1 is the
  CSV path, arg 2 the creator's handle (excluded as self-replies; defaults to
  the most frequent handle). No args = the bundled `santoshstack_replies.csv`.
- **This is a second opinion, not a replacement.** Two structural limits:
  1. *Not your audience* — a different follower size/niche has different view
     floors, so it tests whether the model's **shape** generalizes (does `hot`
     still beat `null`?), not your exact numbers.
  2. *Scraped-after-the-fact metrics inflate older posts* — "original post views"
     are read now, not at reply time, so `ageMin`/`vpm` skew for older replies.
- Use it to sanity-check that the bands hold up on a second account and flag any
  floor that's obviously mis-set — then adjust **conservatively**.

### What recalibration actually is

Read the crosstab sections (`BAND → outcome`, `ACTIONABLE vs PASSED`,
`TOP MISSES` = floors too strict, `TOP FALSE ALARMS` = floors too loose, and the
view/age/reply-count/bait buckets = where the outcome cliffs are), then edit the
`BAND` constants in `src/shared/replyBand.ts` to snap to those cliffs — exactly
how `bigViews` came 800→300. One edit re-tunes the badge, the Radar, **and** the
server-side band gate at once (§7.3 shared module). Then `bun test` + re-run the
eval to confirm the crosstab tightened.
