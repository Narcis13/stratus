# Radar live queue — `/radar-analyst` reads the panel's queue, and a requested count is a contract

- **Status:** planned 2026-08-18 · not started
- **Goal fit:** Goal 4 (Circles — the people layer): the Radar reply lane is how relationship-aware replies get written, and a drafting session that works from a different set of tweets than the operator is looking at wastes the pass.
- **Cost impact:** **$0.** No X call, no `askLLM` call, no image call on any path this plan touches. One extra $0 local `PATCH` per dismiss click (best-effort, fire-and-forget), and one extra boolean filter on an existing $0 read. The drafting itself is billed to the operator's Claude Code session, exactly as it is today.
- **Invariants touched:**
  - §8 invariant #8 — the only billed X call is `createPost`; `src/x/routes/radar.ts` is `$0` by construction and its header says so. Nothing here may import `xFetch` or `askLLM`.
  - §7.8 best-effort side writes — the dismissal mirror never fails the buffer write the user is waiting on.
  - §7.10 status ratchets — a dismissal is one-way; only a `manual` ⊕ re-pin clears it (the server mirror of `purgeDismissed`).
  - §7.11 null = unknown/never — `dismissed_at IS NULL` means "never dismissed", and it is the column's whole vocabulary.
  - §7.13 sync SQLite — the PATCH is one statement; no `await` inside a txn, no JS `Date` bound in a raw `sql` template.
  - §7.16 server-stamped fields — `dismissed_at` is stamped from the server clock, never taken from the wire.
  - §7.19 gates — `summary` stays counts, never rates.
  - §7.20 static path before `:param` — the new `PATCH /radar/sightings` joins the static block above `GET /radar/sightings/:tweetId`.
  - §7.24 background = single writer — the panel keeps talking through `stratus/radar-dismiss`; the mirror hangs off the existing handler.
  - §7.27 shims / never fork logic server↔page — the queue TTL becomes one exported constant instead of two copies.
- **Codemap sections relevant:** §3.3 (`radar/corpus.ts`, `src/shared/radarSweep.ts`), §3.4 (`routes/radar.ts`), §4 (RA.1 database delta — migration head `0029_blushing_expediter`, **this plan owns `0030`**), §5 (`background.ts`, `sidepanel/Radar.tsx`, `extension/src/shared/radar.ts`), §6 (MCP `x_radar`), §7.8/7.10/7.11/7.13/7.16/7.19/7.20/7.24/7.27, §9 (`scripts/smoke-radar-access.ts`).

## Why / what changes for the user

Today the panel shows **Queue (35)** and `/radar-analyst` sees **55** — measured on 2026-08-18, one `/home` session, 97 sightings scanned in 24 h. The ~20 extra rows are tweets the operator dismissed with **✕** or **Clear** and never drafted: the dismissal lives only in `chrome.storage.local`, and the one thing the dismiss handler tells the server (`markDraftsOnServer(ids, 'expired')`) PATCHes `radar_drafts`, a table that has no row for a tweet that was never drafted. So a drafting session re-surfaces tweets the operator has already thrown away, and the operator has to trust a count they cannot check.

After this plan, `x_radar` (and `GET /x/radar/sightings`) can be asked for **the queue** — the same predicate the panel renders: last seen inside the queue TTL, not dismissed, not worked. When the panel says 35, the skill sees 35.

Second, the skill's number becomes a contract. `SKILL.md` §2 currently drops aged-out, `bait: true` and unanswerable rows *before* ranking, so "draft the best 25" routinely returns 14 with a cut line. It will instead fill 25 in rank order — bait and age become rank penalties — and hard-drop only what cannot be answered without inventing something, reporting any shortfall in one line.

## Design

**Data.** One nullable column, one migration (`0030`, this plan owns it).

```sql
ALTER TABLE radar_sightings ADD dismissed_at integer;
```

No index: the queue read is already bounded by `radar_sightings_last_seen_idx` plus `SIGHTING_SCAN_CAP = 5000`, and this is a single-user DB. Nullable is the whole point (§7.11) — an existing row is "never dismissed", which is the truthful backfill and the reason no backfill is needed.

**Ingest.** `mergeSightingRow` (`src/x/radar/corpus.ts`) gains one rule, the server mirror of the panel's `purgeDismissed`: an incoming row with `band === 'manual'` clears `dismissed_at`. Everything else leaves it alone — a re-sighting must *not* resurrect a dismissed tweet, because the panel's tombstone does not either. This is the exact asymmetry `mergeSightings` already documents ("ONE exception, and it is the human").

**Write route.** `PATCH /x/radar/sightings`, modelled line-for-line on the existing `PATCH /x/radar/drafts` (`src/x/routes/radar.ts:296`):

```
PATCH /x/radar/sightings
body: { tweetIds: string[1..200], dismissed: true }
200  { updated: number }
400  invalid_body | invalid_tweet_ids | too_many_tweet_ids | invalid_dismissed
```

`dismissed` accepts **only `true`** — a dismissal is a ratchet (§7.10), and an un-dismiss would fight the panel's 24 h tombstone rather than mirror it. `MAX_PATCH_IDS` (200) is reused as-is: since RQ.1 one click can dismiss a 500-row sweep, so the caller chunks and the route refuses an over-long list rather than truncating it.

**Read.** `GET /x/radar/sightings` gains `?queue=true`:

- window forced to `RADAR_QUEUE_TTL_MS` (24 h) regardless of `days`;
- `dismissed_at IS NULL`;
- `worked === false`.

`queue=true` + `worked=true` is a **400 `invalid_queue_combo`** rather than a silent override (the D190 rule: a filter that quietly means something else is a wrong answer). `admitted` stays orthogonal and combinable — "queue rows today's filters would still admit" is a real question. Every `SightingView` also gains `dismissed: boolean` so an unfiltered read can still explain itself, and `summarizeSightings` gains a `dismissed` count (a count, never a rate — §7.19).

**The TTL constant is moved, not copied.** `RADAR_TTL_MS` lives in `extension/src/shared/radar.ts` today and the server has no access to it. It becomes `RADAR_QUEUE_TTL_MS` in `src/shared/radarSweep.ts` — already zero-dep, already shimmed into the content IIFE, and already the module that distinguishes "how fresh a tweet must be to be captured" (`maxAgeMin`) from "how long a captured row stays workable". `extension/src/shared/radar.ts` re-exports it under the old name so no call site moves. RA.1 already moved `bandStickiness` across this line; this is the same trip (§7.27).

**Extension.** `background.ts`'s `isRadarDismiss` handler gains a sibling to `markDraftsOnServer`: `markSightingsDismissedOnServer(tweetIds)` — same fire-and-forget shape, same 200-id chunking, same warn-and-drop. Every dismissal path already funnels through `stratus/radar-dismiss` (the ✕, **Clear**, `consumeQueue`'s leftovers after a drafting pass, and the curate pass's drops), so one call site covers all four.

**MCP.** `x_radar` gains `queue?: boolean` → `queue=true`, described as "the live panel queue".

**Skill.** `.claude/skills/radar-analyst/SKILL.md` §1 defaults to `queue: true`; §2's stage ladder is rewritten so N is a contract.

**Measurement.** None — this is a correctness fix, not a lever. The observable is `smoke-radar-access.ts`: dismiss two of three ingested rows, assert `queue=true` returns exactly the third.

## Decisions taken

1. **Mirror dismissals (event), not a queue snapshot (state).** User-chosen. A snapshot PUT of the panel's id list is exact by construction, but it needs a trigger and a stale snapshot reads as authoritative when the panel is closed; the event mirror matches the `markDraftsOnServer` idiom already in the file and degrades to "one row drifts", which is the failure this repo already accepts for every best-effort side write (§7.8). Do not re-litigate by adding a snapshot endpoint later without deciding this again out loud.
2. **`queue=true` is a preset, and a contradicting `worked=true` is a 400.** Silently overriding a filter the caller passed is the failure D190 already refused for `admitted`/`worked`.
3. **A re-sighting does not clear a dismissal; a `manual` ⊕ pin does.** This is the panel's rule (`mergeSightings` admits a tombstoned tweet only when `band === 'manual'`, and the caller drops the tombstone with `purgeDismissed`). Any other choice makes the server and the panel disagree about a queue the whole plan exists to make agree.
4. **The queue TTL moves into `src/shared/radarSweep.ts` rather than being restated.** The §7.33 "restated, never imported" habit is for numbers whose two copies are *meant* to be tunable apart (BAND vs sweep floors). This one is the opposite: the whole feature is the two sides agreeing.
5. **"Draft 25" is a target, not a quota (`Hit N, report the tail`).** User-chosen. Bait and aged-out become rank penalties; the only hard drop is a row that cannot be answered without inventing something — the never-fabricate rule does not bend, because forcing a draft past it puts a made-up claim under the operator's name. A shortfall is reported in one line, not silently absorbed.
6. **No new panel UI.** The count the operator already sees (`Queue (35)`) is the contract; a second badge showing "server sees N" would just expose the mirror's drift as a thing to worry about.
7. **The sighting GETs still write nothing.** `queue=true` adds a filter, not a lazy expiry. The property that an agent can page the corpus without advancing anyone's draft status is preserved, and the route comment saying so stays true.

## Done when

1. `PATCH /x/radar/sightings {tweetIds, dismissed:true}` stamps `dismissed_at`, is idempotent, and refuses `dismissed:false` with 400.
2. `GET /x/radar/sightings?queue=true` returns exactly: last seen inside 24 h, `dismissed_at IS NULL`, `worked:false` — asserted end-to-end by `scripts/smoke-radar-access.ts` ($0, no `--live`).
3. Clicking **✕** or **Clear** in the panel, or letting a drafting pass consume the queue, removes those tweets from the next `x_radar` `queue:true` read.
4. `x_radar({queue:true})` and the panel's `Queue (N)` badge agree on a live browser check — **owed to `.claude/skills/masterplan/VERIFY-DEBT.md`, like RA.8's `0w`**: a page tab cannot read another extension's `chrome.storage.local`, so this needs the human at the browser.
5. Asking `/radar-analyst` for N drafts over a queue of ≥N rows produces N `radar_drafts` rows, or fewer with an explicit one-line reason naming the fabrication test.
6. `bun test` + `bun run typecheck` + `bun run lint` green; `cd extension && bun run build` green for the two extension-touching tasks.

---

## Task 1: `dismissed_at` column, migration, ingest rule, and the PATCH route
**Depends on:** none
**Session budget:** ~250 lines across 5 files (2 source, 1 migration, 2 test)

**Read first:**
- codemap header + §4 (the RA.1 database delta — migration head `0029_blushing_expediter`, **this task owns `0030`**) and §3.4's `radar.ts` row.
- `src/x/db/schema.ts:1189-1229` (`radarSightings`).
- `src/x/routes/radar.ts:296-334` (`PATCH /radar/drafts` — the exemplar: copy its validation ladder and its error codes).
- `src/x/radar/corpus.ts` — `mergeSightingRow` and its three merge rules.
- `extension/src/shared/radar.ts:176-200` (`mergeSightings`'s `manual` exception + `purgeDismissed`) — the rule this task mirrors server-side.

**Edit:**
- `src/x/db/schema.ts` — add `dismissedAt: integer('dismissed_at', { mode: 'timestamp_ms' })` to `radarSightings`, with a comment stating null = never dismissed and that only a `manual` re-pin clears it.
- `src/db/migrations/0030_*.sql` + `_journal.json` — generated by `bun run db:generate`, **then read the emitted SQL** (drizzle-kit drops seed INSERTs — codemap §4; confirm the `content_pillars` seed in `0000` is untouched and that `git diff --stat src/db/migrations/` shows only the new file + the journal append).
- `src/x/radar/corpus.ts` — `mergeSightingRow` returns `dismissedAt: null` in the patch **only** when `incoming.band === 'manual'`; otherwise the key is absent from the patch (absent ≠ null — do not write `undefined` into the column).
- `src/x/routes/radar.ts` — `PATCH /radar/sightings`, registered in the sightings block immediately **above** `GET /radar/sightings/:tweetId` (§7.20; different methods don't actually collide in Hono, but the file's convention is what a later reader checks).
- `src/x/routes/radar.test.ts`, `src/x/radar/corpus.test.ts` — cases below.

**How:**
- Reuse `MAX_PATCH_IDS` and `TWEET_ID_RE` already in the file; do not introduce a second cap constant.
- Validation ladder, in `PATCH /radar/drafts`'s order: body is a non-array object → `dismissed !== true` is `invalid_dismissed` → `tweetIds` non-empty array → length ≤ cap → every id matches `TWEET_ID_RE`. Every check before the DB is touched (§7.4).
- The update is one statement: `set({ dismissedAt: new Date() })` where `inArray(tweetId, ids)` **and `isNull(radarSightings.dismissedAt)`** — the ratchet (§7.10) and what makes a re-dismiss return `updated: 0` instead of re-stamping. Return `.returning({ tweetId })`'s length.
- Do **not** touch `buildSightingViews` here — the read half is Task 3, and this task must land green on its own.
- Nothing in this file may import `xFetch`/`askLLM`; the header says so and this task keeps it true.

**Tests:**
- `corpus.test.ts`: a non-`manual` re-sighting leaves `dismissedAt` out of the patch entirely; a `manual` incoming row sets it to `null`; the existing merge rules (fill-only fields, `>=` metric movement, band ratchet) are unchanged.
- `radar.test.ts`: happy path stamps and returns `{updated: n}`; re-PATCHing the same ids returns `{updated: 0}`; `dismissed: false` → 400 `invalid_dismissed`; `dismissed` absent → 400 `invalid_dismissed`; empty array → 400 `invalid_tweet_ids`; 201 ids → 400 `too_many_tweet_ids`; a non-numeric id → 400 `invalid_tweet_ids`; an unknown tweetId is not an error (`updated: 0` — the panel dismisses rows the server may never have received).

**Done when:**
- [ ] A dismissed row keeps `dismissed_at` across a plain re-ingest and loses it after a `manual`-band re-ingest.
- [ ] The emitted `0030` SQL is `ALTER TABLE radar_sightings ADD dismissed_at integer;` and nothing else; a fresh `:memory:` boot reports 17 `radar_sightings` columns and 3 `content_pillars` seed rows.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(radar): mirror panel dismissals onto radar_sightings`

**Cost note:** $0 — local SQLite only.

---

## Task 2: the panel's dismissals reach the server
**Depends on:** Task 1
**Session budget:** ~90 lines across 2 files (1 source, 1 test-free — panel/background aren't unit-tested here)

**Read first:**
- codemap §5's `background.ts` row (single writer of buffer state; the `markDraftsOnServer` idiom).
- `extension/src/background.ts:617-648` (`markDraftsOnServer` + `MAX_DRAFT_PATCH_IDS` and the comment explaining why the chunk exists) and `:1099-1107` (the `isRadarDismiss` handler).
- `extension/src/sidepanel/Radar.tsx:800-805` (`consumeQueue`) — confirmation that the drafting pass and the curate pass both reach the same message, so this one call site covers all four dismissal paths.

**Edit:**
- `extension/src/background.ts` — add `markSightingsDismissedOnServer(tweetIds: string[])` directly beneath `markDraftsOnServer`, and call it in the `isRadarDismiss` handler next to the existing `markDraftsOnServer(msg.tweetIds, 'expired')`.

**How:**
- Copy `markDraftsOnServer` exactly: same `MAX_DRAFT_PATCH_IDS` chunk loop (reuse the constant — the reason for 200 is identical and a second constant would drift), same `void handleApiRequest(...).then(warn, warn)` shape, same `res.code !== 'unconfigured'` silence, same "never retried" comment.
- Body is `{ tweetIds: chunk, dismissed: true }` to `PATCH /x/radar/sightings`.
- It is called **before** `enqueueRadar(...)` like `markDraftsOnServer` is — the mirror must never precede or block the buffer write in effect, and fire-and-forget is what guarantees that (§7.8/§7.24). Do not `await` it and do not fold it into the promise chain.
- Add one comment saying what this fixes: without it a ✕ on a never-drafted tweet is invisible to the server and `/radar-analyst` re-surfaces it, because `markDraftsOnServer` only touches rows that a draft already created.

**Tests:** none — background/panel code is not unit-tested in this repo (codemap §5/§9). The verification is the smoke script in Task 5 plus the browser check in "Done when" #4.

**Done when:**
- [ ] Dismissing in the panel produces a `PATCH /x/radar/sightings` in the server log with the dismissed ids.
- [ ] `cd extension && bun run build` green
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(radar): ship panel dismissals to the sighting corpus`

**Cost note:** $0 — one local PATCH per dismiss click.

---

## Task 3: `queue=true` on the corpus read, and one queue-TTL constant
**Depends on:** Task 1 · [parallel-ok with Task 2]
**Session budget:** ~300 lines across 6 files (4 source, 2 test)

**Read first:**
- codemap §3.3 (`radar/corpus.ts` read half, `src/shared/radarSweep.ts`'s three contracts) and §3.4's `radar.ts` row (the RA.3 paragraph: `SIGHTING_SCAN_CAP`, the JS-side filters, `summary` covering the filtered population).
- `src/x/routes/radar.ts:784-875` (`GET /radar/sightings` end to end) and `:928-966` (`loadSightingContext`).
- `src/x/radar/corpus.ts` — `buildSightingViews`, `summarizeSightings`, the `SightingView`/`SightingSummary` types.
- `extension/src/shared/radar.ts:156-176` (`RADAR_DISMISSED_TTL_MS` and `RADAR_TTL_MS`, and the comment explaining why 24 h).
- `src/shared/radarSweep.ts` header (the zero-import contract — the constant being moved must not bring an import with it).

**Edit:**
- `src/shared/radarSweep.ts` — export `RADAR_QUEUE_TTL_MS = 24 * 60 * 60 * 1000`, carrying `RADAR_TTL_MS`'s comment verbatim plus one line on why it now lives here (the server's `queue=true` and the page's `pruneStale` must be the same number).
- `extension/src/shared/radar.ts` — `RADAR_TTL_MS` becomes a re-export of it (`export { RADAR_QUEUE_TTL_MS as RADAR_TTL_MS }` or a `const` bound to it), imported through the **existing shim path** this file already uses for `bandStickiness`: `from '../radarSweep.ts'` (line 12), never a reach into `src/`. **No call site moves**, and `extension/src/shared/radar.test.ts:903` must still pass untouched.
- `src/x/radar/corpus.ts` — `SightingView` gains `dismissed: boolean`; `buildSightingViews` sets it from `r.dismissedAt !== null`; `SightingSummary` gains `dismissed: number` and `summarizeSightings` counts it.
- `src/x/routes/radar.ts` — the `queue` param.
- `src/x/mcp.ts` — `x_radar` gains `queue: z.boolean().optional()` → `queue=true`, with a one-line description ("the live panel queue: seen in the last 24h, not dismissed, not worked").
- `src/x/radar/corpus.test.ts`, `src/x/routes/radar.test.ts` (+ `src/mcp.test.ts` if it enumerates the tool's input keys — check before assuming).

**How:**
- Parse `queue` with the existing `boolParam` helper, and 400 `invalid_queue` on anything but `'true'`/`'false'` — the D190 rule the two existing boolean filters already follow.
- `queue=true` + an explicit `worked=true` → **400 `invalid_queue_combo`** before any DB work. `queue=true` with `admitted` is legal and combines.
- With `queue=true`: the SQL `gte(lastSeenAt, …)` bound uses `Date.now() - RADAR_QUEUE_TTL_MS` instead of the `days` window, and `isNull(radarSightings.dismissedAt)` joins the `conds` array; the `worked === false` half stays where the other post-filters are, in JS over the built views, so `summary` keeps describing the filtered population.
- Echo `queue` in the response body next to `days`/`order` so a reader can tell which predicate produced the numbers.
- `days` is **ignored** under `queue=true` and the response's `days` field should reflect the window actually used (24 h ⇒ `days: 1`), not the parameter that was ignored. Say so in the route comment.
- Do **not** add a lazy expiry, a TTL flip, or any write to this route (decision 7 — the "both sighting GETs write nothing" property is load-bearing for an agent paging the corpus).
- Do not add an index for `dismissed_at`: `SIGHTING_SCAN_CAP` already bounds the scan and this is a single-user DB.

**Tests:**
- `corpus.test.ts`: `dismissed` is `true`/`false` off the column; `summarizeSightings` counts dismissed rows; the existing `unworkedAdmitted` arithmetic is unchanged by the new field.
- `radar.test.ts`: `queue=true` excludes a dismissed row, a worked row (both a drafted-only row and a posted-reply row), and a row last seen 25 h ago; includes a 23 h-old undismissed unworked row; `queue=true&worked=true` → 400 `invalid_queue_combo`; `queue=1` → 400 `invalid_queue`; `queue=true&admitted=false` combines; `queue=true&days=60` still uses the 24 h window and reports `days: 1`.
- `radarSweep.test.ts` / `extension/src/shared/radar.test.ts`: the constant is one value on both sides (assert `RADAR_TTL_MS === RADAR_QUEUE_TTL_MS`).

**Done when:**
- [ ] `GET /x/radar/sightings?queue=true` returns the panel's predicate and echoes `queue: true`.
- [ ] The queue TTL exists exactly once in the repo (`grep -rn "24 \* 60 \* 60 \* 1000" src extension/src` shows the dismissed-tombstone TTL and the new constant, and nothing else claiming to be the queue TTL).
- [ ] `cd extension && bun run build` green
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(radar): queue=true on the corpus read`

**Cost note:** $0 — one more filter on an existing local read.

---

## Task 4: `/radar-analyst` reads the queue and honours the count
**Depends on:** Task 3
**Session budget:** ~120 changed lines in 1 file

**Read first:**
- `.claude/skills/radar-analyst/SKILL.md` in full (292 lines) — §1 "What a pass reads", §2 "Selection", §4 "Hand-off", "Traps that look like bugs", "What a sighting row means".
- `.claude/skills/radar-analyst/references/reply-craft.md` §3 (the list of what cannot be seen from a stored 500-char text) — the fabrication test in §2 must name the same boundary, not a second one.
- The `x_radar` tool description in `src/x/mcp.ts` as shipped by Task 3, so the skill's filter table matches the tool's actual parameter list.

**Edit:** `.claude/skills/radar-analyst/SKILL.md` only.

**How:**
- §1: the default read becomes `x_radar({ queue: true })` — "the tweets in the operator's panel right now". Keep `days`/`worked` documented as the **review** read (what did I sweep this week), and say plainly which question each answers. Note that `queue: true` ignores `days`.
- §2 stage 1 shrinks to **one** hard drop: a row that cannot be answered without inventing something (empty caption over an image, mid-thread fragment, bare link drop, hook cut off by the 500-char clamp). `bait: true` and aged-past-`sweep.maxAgeMin` move to stage 2 as **rank penalties**, with one line each saying why they rank low rather than why they're gone. "Already worked" stops being a stage-1 line entirely — `queue: true` filters it.
- §2 stage 3 becomes the fill: take the ranked survivors and draft down the list until N is met. Delete the "carry roughly 1.4× into stage 3" instruction — it exists to survive a funnel that no longer drops.
- §2's aggregate cut line is rewritten for the new shape, e.g. `35 in the queue → 4 unanswerable from text → 25 drafted, 6 left (ranked below the cut)`. Keep it one line.
- Add the shortfall rule explicitly: if fewer than N survive the fabrication test, draft every survivor and say so in one line naming the test — never pad to the number, and never silently return fewer without saying it.
- Stage 4's ≤2-per-handle spread rule **stays**, and the interaction is now worth stating: it can hold the count below N on a queue dominated by one account, and that is a shortfall to report, not a rule to break.
- "Traps that look like bugs": add that a dismissal now mirrors to the server, so a tweet cleared in the panel leaves the `queue: true` read too (and `days`-based reads still show it — the corpus keeps it for 60 days). Keep the existing trap about a composed draft flipping its own row to `worked: true`.
- Do not touch the ceiling section, the honesty rules, the never-fabricate rule, or `reply-craft.md`.

**Tests:** none (a skill file). The check is that every tool parameter the file names exists in `src/x/mcp.ts` — verify by reading, not by memory (§7.29's rename rule: an RA-surface rename owes this skill in the same commit).

**Done when:**
- [ ] §1's default read is `queue: true` and the filter table matches the shipped tool schema.
- [ ] §2 has exactly one hard drop, and the shortfall sentence names the fabrication test.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green (unchanged — no source touched)
- [ ] Committed: `docs(radar): radar-analyst reads the live queue, N is a contract`

**Cost note:** $0.

---

## Task 5 (final): docs-sync + smoke
**Depends on:** all prior.

- [ ] `scripts/smoke-radar-access.ts` — extend the existing lane script rather than adding a new one (it already drives ingest → guards → `admitted` flip → compose → confirm → `worked`, $0 with no `--live`, and snapshot-restores what it touches). New segment: ingest 3 rows → `queue=true` returns 3 → `PATCH /radar/sightings` dismisses 1 → returns 2 → re-PATCH returns `updated: 0` → compose against one → returns 1 → re-ingest the dismissed row with `band:'manual'` → returns 2 again. It must keep deleting its 888-prefixed rows.
- [ ] `docs/PHASE-HISTORY.md`: the phase entry (what shipped, 2026-08-18, $0, the 35-vs-55 measurement as the motivation, and the drift caveat on a best-effort mirror).
- [ ] `CLAUDE.md`: **no change** — no guardrail moved. (State this in the commit body so the next session doesn't go looking.)
- [ ] `CIRCLES-PLAN.md`: status line for this work under the Radar lane.
- [ ] `docs/radar-tab.md`: the dismissal now mirrors server-side; the **Fetch drafts** section's "up to date after a compose" note gets its cause updated — composing against a cleared queue is still the failure, and now the server knows the queue was cleared.
- [ ] `.claude/skills/plan-feature/references/codemap.md`: §3.3 (`corpus.ts` — the new view field, summary count, and the `manual` clear rule), §3.4 (`radar.ts` — the PATCH route + `queue=true`), §4 (**migration head → `0030`, 17 columns on `radar_sightings`, next migration owns `0031`**), §5 (`background.ts` — the new mirror), §6 (`x_radar` gains `queue`), §9 (`smoke-radar-access.ts` grew a segment), plus suite/test counts recounted not carried forward; header re-stamped to the new commit.
- [ ] `.claude/skills/masterplan/VERIFY-DEBT.md`: add the browser check from "Done when" #4 alongside RA.8's `0w`.

## Rollback

Every task is independently inert. Task 1 alone adds a nullable column nothing reads and a route nothing calls. Task 2 alone sends a PATCH whose effect nothing selects on. Task 3's `queue` param is optional and absent means today's behaviour exactly. Task 4 is a skill file. Backing the whole thing out is: drop the `queue` branch from the route, delete the two extension call sites, leave the column in place (a nullable column with no reader costs nothing and re-dropping it would need a second migration).

## Out of scope (do NOT build)

- **A queue-snapshot endpoint** (`PUT /x/radar/queue` with the panel's id list). Considered and rejected — decision 1. If the mirror proves lossy in practice, that is a measurement to bring back to a new plan, not a second mechanism to bolt on.
- **Un-dismiss.** `dismissed: false` is a 400. The panel has no un-dismiss either; the ⊕ pin is the "I changed my mind" path and it already works.
- **A `dismissed_at` index**, a retention change, or a worker that prunes dismissed rows. The lazy 60-day prune on the ingest path already owns retention.
- **Showing the server's count in the panel** (decision 6).
- **Any polling of `queue=true`** from the panel or the background. The panel owns the buffer; it has no reason to ask the server what it already knows.
- **Touching `reply-craft.md`**, the reply prompts, or anything that changes how a reply *reads*. This plan changes which tweets get drafted and how many, never the drafting itself.
- **Re-adding a billed read** anywhere near this lane (invariant #8).

## Risks / watch items

- **The mirror is best-effort, so it can drift.** A dismissal made while the server is unreachable is lost and that tweet re-enters the `queue=true` read. This is the accepted trade (§7.8, decision 1) and the skill's stage-2 penalties still rank a dead post last — but if drift shows up as a pattern, the snapshot design is the thing to reconsider, with a measurement in hand.
- **`Queue (35)` and `queue=true` can still legitimately differ.** The panel evicts at `RADAR_CAP` (500) under `evictionWeight`, and the Cannon view is a filtered read of the same buffer. Neither is modelled server-side; on a normal session they don't bite, and the smoke script does not assert equality with the panel — only the browser check in "Done when" #4 can.
- **Decision 5 is a quality trade the operator will feel.** Filling N means the tail of a pass is drafted against rows the old funnel would have dropped. If pasted replies from the bottom of a pass start under-performing, the recalibration is the *rank penalty weights*, not a return to hard drops — and it needs the `model='claude-code-mcp'` cohort split (references/queries.md) at n≥20 a side before it is a measurement rather than a feeling.
- **Task 3 moves a constant across the server/extension line.** If `extension/src/shared/radar.test.ts:903` needs editing to stay green, that is a signal the re-export changed a value rather than a location — stop and re-read, don't adjust the test.
