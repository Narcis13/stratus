# Notifications surface (C10)

> **Surface:** x.com/notifications, augmented — reply notifications say *which of your posts they're on*, the people who matter get a chip, and likes/reposts/follows quietly become CRM data.
> **Status:** shipped 2026-07-23. **Cost:** **$0** recurring — no X API read, no AI call, no new table. The only spend is one already-capped mentions pull per **deliberate click** on the sync chip. **Plan:** `plans/2026-07-16-notifications.md` (NT.1–NT.7); `CIRCLES-PLAN.md` Phase C10.

---

## What it is

The notifications tab is the **only place on X where likes, reposts and follows are visible at all**. Everywhere else, stratus can see replies and mentions but is blind to the quieter half of how people signal interest. This surface reads that tab — and fixes its most annoying gap while it's there.

Four things happen, all only on `x.com/notifications` (and its sub-tabs — the same code runs wherever the DOM matches):

1. **"↳ on your post: …"** under every reply notification stratus already knows about — no more clicking through to remember which of your posts the reply is on. Plus a **✓ answered** chip when your inbox already settled it.
2. **Tier chips** (`ally @x`, `mutual @y`, `target @z`) on the aggregated "A, B and 6 others liked…" cells, so your eye goes to the people worth answering.
3. **A silent harvest**: likes, reposts and follows become `people` rows and timeline events. The dossier finally shows *"this person has quietly liked 9 of your posts"*.
4. **A "stratus: sync replies" chip** at the top of the page — one click pulls your newest mentions so the "on your post" lines cover fresh replies.

Everything except that one chip click is read-only and free.

---

## 1. The parent-post line

Under a reply notification, stratus injects a small muted line:

```
↳ on your post: “The unsexy problem nobody writes about is…”   ✓ answered
```

- The text comes from your **mention inbox** — the rows the daily 03:00 UTC pass (or a sync click) already pulled and paid for. Nothing new is fetched while you scroll.
- **✓ answered** appears when that mention's status is `answered`, so you don't reply twice. A settled mention shows the chip **even when the parent text is unknown** — a standalone @-mention you've already handled is exactly the case worth marking.
- **Fresh replies show nothing.** Parent context exists only for replies the API pull has seen. That's the gap the sync chip closes; it is by design, not a bug.

## 2. Tier chips

On aggregated cells (which have no name row and up to ~8 avatars), stratus adds up to **3 compact chips** for the handles that matter — `ally`, `mutual`, or `target` (an account in your 2–10x roster). Clicking one opens that person's **dossier** in the side panel.

Regular tweet-shaped notifications deliberately **keep the richer chips from the [Augmented X UI](./s6-augmented-ui.md)** (stage + `◎` target + `↩` owed + `Nd` neglected) instead of these — one vocabulary per line, and the richer one wins.

## 3. The engagement harvest

While you scroll, each notification cell is parsed (icon first, so it works in any language; English + Romanian keywords as a fallback) and turned into:

- a **`people` row** — created if new, with `source: 'notification'`. This is **fill-only**: a notification glimpse never overwrites a name, bio or follower count you already collected elsewhere.
- a **timeline event** on that person: ♥ *liked: "…"*, ⟳ *reposted: "…"*, ✚ *followed you*.

**Gated by the `passiveCapture` setting** (Settings → the same toggle that governs hover capture — no new switch). Turn it off and capture stops; the read-only augmentations above stay.

### Nothing gets double-counted

Every event carries a **deterministic id**, so re-scrolling the same page (or reloading it a week later) writes nothing new:

| Situation | Event id | Effect |
|---|---|---|
| The liked/reposted post is identified | `their_like:notif:<handle>:<tweetId>` | one event per person **per post**, forever |
| The post can't be identified | `their_like:notif:<handle>:<YYYY-MM-DD>` | at most one event **per person per day per kind** |
| A follow | `their_follow:notif:<handle>` | logged **once, ever** |

Identifying the post is a **prefix match**: X truncates the post text in the cell, so stratus collapses whitespace and matches that snippet against the beginning of your recent posts (at least 20 characters — below that a prefix isn't evidence). Emoji-heavy or very short posts may not match, and then the day-bucket id is used. Coarser, never wrong.

### What the harvest deliberately does *not* do

- **It never advances a relationship stage.** Stages describe *reciprocity* — someone can like fifty posts without a word being exchanged. Likes/reposts/follows are timeline-only, exactly like `harvest_seen`. A person with 50 likes and a follow is still a **stranger**.
- **It never reorders Top Fans.** The count shown there (`· N engagements`) is **display-only**; ranking stays purely inbound (mentions + replies to you). Someone who only ever likes never appears in Top Fans at all.
- **Aggregated cells under-report.** "A, B and 12 others liked" exposes only the avatars X rendered (~8). This is a signal harvest, not an audit.

## 4. The sync-replies chip

A small `stratus: sync replies` button sits next to X's "Notifications" heading.

- Clicking it runs the normal **mentions refresh** — the one X read this surface can trigger (roughly $0.001–0.05 per pull), then immediately refreshes the on-page context so the new parent lines appear at once instead of up to five minutes later.
- The server's **6 pulls/day cap** is the only limit, and there is **no client-side bypass and no retry loop**. When it's reached, the chip says **`limit reached`** for a couple of seconds and nothing is spent.
- States: `syncing…` → `synced` / `limit reached` / `sync failed`.
- **It never fires on its own.** Opening the page is not consent to spend.

---

## Where the data shows up

| Where | What you see |
|---|---|
| **[People](./people-tab.md)** dossier timeline | ♥ / ⟳ / ✚ rows: *liked: "…"*, *reposted: "…"*, *followed you* |
| **[Today](./today-tab.md) → Top Fans** | `· N engagements` next to the inbound count (same window; hidden at zero) |
| **People roster** | new rows appearing with `source: 'notification'` — the roster grows itself |

---

## The one rule this surface is built around

**The `mentions` table is never written from the page.** The highest stored mention id *is* the checkpoint stratus uses to ask X "what's new since?" — inserting an id scraped from the DOM would make the next pull skip everything in between. So parent context is a pure read of what the API already fetched, and the freshness gap is closed by the human-clicked sync chip only. (The Launch Room routes around the same trap the same way: person events, never mention rows.)

---

## Under the hood

- **Endpoint:** `POST /x/people/engagements` — `{engagements: [{kind: 'like'|'repost'|'follow', handle, targetText?, seenAt}]}`, ≤50 per batch, answers `{received, processed, skipped, events}`. A malformed *shape* (unknown kind, bad timestamp, oversized batch) rejects the whole batch with an indexed error; an unusable *handle* is simply skipped and reported in `skipped`.
- **Batching:** the content script flushes every 2 s, ≤50 per request, with a per-cell throttle; overflow waits for the next window. Re-sends are harmless — the deterministic ids make them no-ops.
- **Context fetch:** one background message (`stratus/notif-context`) warms both the mentions map (5-min cache) and the roster rank map (10-min cache). A failure keeps the last good data and shows nothing extra — this surface augments a page it doesn't own, so it never raises an error on it.
- **Icon detection:** the cell's leading glyph, matched by `d`-attribute prefix — like `M20.884 13.19` (the filled heart notification cells use) and `M16.697 5.5` (outline), repost `M4.5 3.88`, follow `M17.863 13.44`. All verified against live cells; X's bell glyph is deliberately unmapped so "New post notifications for … and 6 others" cells are classified `other` and dropped.
- **Chip placement rule:** injected chips go **after** the cell's header text block, never inside it. The parser reads the first directional block as the header and the longest one as the post — nesting a chip there would feed stratus's own text back into the next parse. (Live-checked: 0 of 21 cells changed classification with chips present.)

---

## Verification

- `bun run scripts/smoke-notifications.ts` — $0, rerunnable against the real DB: ingests a synthetic batch, asserts the three id shapes and prefix target resolution, re-posts the identical batch and asserts **0** new events, proves stage stays `stranger`, proves the fan count shows while a likes-only person never ranks, then removes every row it created.
- Pure suites: `extension/src/shared/notifications.test.ts` (cell fixtures, four kinds, locale fallback), `src/x/people/{stage,engagements}.test.ts` (timeline-only stage matrix, id shapes, idempotency, fill-only), `src/x/routes/followups.test.ts` (the count is display-only — the page re-ranked with counts stripped is byte-identical).
- **Live tail:** the content script's DOM code is browser-unverified by convention. The remaining real-world checks are a load-unpacked session: parent lines on known replies, a tier chip on a known ally/target, `people` rows with `source='notification'` appearing while scrolling, and exactly one refresh per sync-chip click.
