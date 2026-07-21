# S6 — Augmented X UI

> **Surface:** Circles context rendered on x.com itself — small native-looking chips on the timeline and a full "stratus context" panel on each tweet page.
> **Status:** shipped 2026-07-21. **Cost:** **$0** — no X API reads, no Grok, no writes, no schema change, no new MCP tool. **Plan:** `plans/2026-07-16-augmented-x-ui.md` (AX.1–AX.7); `SURFACES-PLAN.md` §5c.

> **Naming note.** The build plan called this "Surfaces S5" — stale: **S5 is Studio 2.0**. It shipped as **S6**. The extension code prefixes its storage keys `augment:*` (the plan's working title was "Augmented X UI").

---

## What it is

While you scroll and read on x.com, stratus decorates the page with what it already knows about the people behind the handles — no side panel round-trip required to decide whether (and how) to reply:

- **On the timeline:** the old green stats pill is **gone** (the hot/warm/skip left border stays). In its place, tweets from people stratus knows carry small chips right of the name/handle line.
- **On a tweet page** (`/status/…`): below the tweet sits a collapsible **stratus context panel** — who this person is to you, whether you already replied to this very tweet, open loops you owe them, your last measured replies with outcomes, and your notes.
- **Everywhere:** clicking a chip or the panel header opens that person's **dossier** in the side panel.

Everything is read-only except that one navigation click. The panel never edits notes, answers mentions, or drafts replies — the side panel owns those flows.

---

## Why $0

Every read is SQL over data stratus **already billed for**:

- `GET /x/people/glance` — a new, tiny endpoint (all non-retired people + open-loop counts + the target roster).
- `GET /x/people/:handle` — the existing C1 dossier (person + events + replies-with-outcomes + mentions + notes + follower series).

Both are fetched through the extension's single background `ApiRequest` transport with **content-script-side caches** (glance 10 min, dossier 5 min). No X API call, no Grok call, no new table, no new write. The only session write (the dossier-open handoff key) goes through the background, which stays the single `chrome.storage.session` writer.

---

## The timeline chips (legend)

Rendered by the pure, bun-tested `extension/src/shared/glance.ts` (`buildPersonChips`), decorating the `[data-testid="User-Name"]` row. Up to four chips, in this order:

| Chip | Shows when | Meaning |
|---|---|---|
| **stage** (e.g. `mutual`, `ally`) | the person is stage **`engaged` or higher** | a real relationship — `noticed`/`stranger` are suppressed as noise |
| **`◎`** | the person is in the **2–10x target roster** | a size-appropriate account worth replying to (a target can even be a stranger) |
| **`↩ n`** | they have **`n` unanswered mentions** in your inbox | you owe them a reply (amber) |
| **`Nd`** | a target/ally you haven't replied to in **≥7 days** (`NEGLECT_DAYS`) | a neglected relationship (strict `<`, mirrors the C5 followups cutoff; exactly 7d is *not* neglected) |

An unknown author shows **nothing**. Chips are theme-neutral (rgba, work in light + dark).

### `GET /x/people/glance`

```
GET /x/people/glance  →  200 {
  count,
  map: { [lowercased handle]: {
    stage,            // Stage
    isTarget,         // in the 2–10x roster (loadTargetHandles())
    openLoops,        // # of mentions rows status='unanswered' by this author
    lastOutboundAt,   // ISO | null
    lastInboundAt,    // ISO | null
    followersCount    // number | null
  } }
}
```

Registered in `routes/people.ts` **before `GET /people/:handle`** (static path must win — the same §7.20 trap `rankmap` dodges). Membership is deliberately different from `rankmap` (which stays untouched and feeds the radar tier stamp): glance is all non-retired people plus target-roster backfill (a target with no `people` row appears as `stage:'stranger'`).

---

## The context panel (tweet page)

Rendered by the pure, bun-tested `extension/src/shared/tweetContext.ts` (`buildTweetContextModel(dossier, tweetId, nowMs)`) from the C1 dossier JSON. Sections (each hidden when empty):

- **Header** — stage chip, "in your circles · Nd" (since first seen), followers + momentum/day (from the follower series, ≥2 points), tags.
- **Already replied** — a banner when a posted reply of yours has `sourceTweetId === this tweet`.
- **Open loops** — unanswered mentions from this person, oldest first.
- **Recent replies** — your last ≤3 *measured* replies to them, newest first, with views + profile clicks + angle.
- **Best angle** — the angle that works for this person, gated at **≥3 measured** replies (mirrors `MIN_MEASURED_FOR_ANGLE_PREFERENCE`).
- **Notes** — your `people.notes`, verbatim.

**DOM behavior** (`content.ts` `syncContextPanel`): on a `/status/` page it finds the focused article, fetches `GET /people/:handle` (module cache, 5 min TTL, three cached terminal states `ready|missing|unavailable` so a status page never fetch-loops), and inserts `div.stratus-context-panel` as the article's **next sibling**. A `data-renderKey` guard avoids needless rebuilds and tears down on SPA navigation. 404 (unknown person) → a single muted "no file" line; token not configured → nothing.

### Collapse state

The panel is collapsible (`▾`/`▸`). The collapsed flag persists in **`chrome.storage.local['augment:contextCollapsed']`** (read once at start via `initContextCollapsed`). The collapse toggle is a *sibling* of the header title, not a child — so clicking to collapse never also opens the dossier.

---

## Dossier click-through

Clicking a chip, or the panel header title, opens the person in the side panel:

```
content.ts  sendOpenPerson(handle)                    (preventDefault + stopPropagation — X never navigates)
   └─ message  stratus/open-person { handle }
        ▼
background.ts  (single session writer)
   • chrome.sidePanel.open({ tabId: sender.tab?.id }).catch()   // best-effort — gesture credit survives one hop on Chrome ≥116
   • writes session key  stratus:openPerson = { handle, at }     // via enqueueOpenPerson chain
        ▼
App.tsx  useEffect (mount + chrome.storage.onChanged session area)
   • setPersonHandle(handle) + setTab('people')
   • fires  stratus/open-person-clear  → background removes the key   (so a stale handle can't replay)
```

If Chrome refuses to open the panel from the message hop, the click degrades gracefully: the handoff key is written, and the panel routes to the dossier the next time it opens.

---

## The legacy button kill rule

On tweet pages, stratus injects a defensive CSS rule `#reply-master-btn { display: none !important; }`. This hides a **floating purple sparkle circle** left over from a *retired standalone* "Reply Master" extension (`~/newme/clipx/reply-master/extension`), which some setups still have loaded unpacked. The kill rule only hides its button — **the real fix is uninstalling that extension in `chrome://extensions`** (which also stops its other scripts). stratus's own `🪄 Reply Master` pill in the action row is unaffected.

---

## What did *not* change

- **The band border/dim and the radar stream** — `applyBand` keeps `readTweetSignals` + `data-stratus-band` + `recordRadarSighting` byte-identical. Only the green *badge* was removed.
- **`rankmap` / `stampTiers` / radar ranking / the band classifier thresholds** — untouched.
- **The MCP surface** — still 19 tools; no server data change, no migration.

---

## Verification

- `bun scripts/smoke-glance.ts` — mounts the people router over the real DB, asserts a seeded person + mention appears in `/glance` with the right shape and disappears after cleanup ($0).
- Pure suites: `glance.test.ts`, `tweetContext.test.ts` (15 cases), `messages.test.ts` (open-person guards), and the `routes/people.test.ts` glance describe.
- **Live tail (not scriptable here):** the content-script DOM is browser-unverified by convention. The remaining real-world check is an unpacked-extension walk — the `[data-testid="User-Name"]` insertion point and action-row anchors are X DOM and can drift. Watch that a `mutual`-stage target with an unanswered mention shows stage + `◎` + `↩`, that the status-page panel renders, and that clicking a chip opens the dossier.
