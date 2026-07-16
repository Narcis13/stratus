# Notifications surface — augment x.com/notifications + engagement harvest (C10)

- **Status:** planned 2026-07-16 · not started
- **Goal fit:** Goal 4 (Circles — the people layer: likes/reposts/follows are the only relationship signals the system currently never sees, and they're free in this tab's DOM). Secondary: goal 2's mention workflow (the "which post is this reply on?" pain).
- **Cost impact:** $0 recurring. Per-click only: the injected "sync replies" chip calls the existing `POST /x/mentions/refresh` (~$0.001–0.05/pull, existing 6/day server cap). No new X reads, no Grok.
- **Invariants touched:** §7.7 (deterministic event ids `type:notif:<…>` + INSERT OR IGNORE), §7.9 (fill-only upserts — a notification glimpse never clobbers enriched data), §7.13 (sync SQLite txn rules), §7.24–27 (background = single session-state writer; one ApiRequest transport; content script stays IIFE; shared logic in shared modules), §7.4-adjacent (the only spend is behind a human click and an existing cap), and the **mentions-checkpoint trap** (§4 `mentions` table note: max stored tweet_id IS the since_id checkpoint — DOM-scraped ids must NEVER be inserted into `mentions`; C7 `launch.ts` is the precedent for how to route around it).
- **Codemap sections relevant:** §3.3 (people/store.ts, people/sightings.ts, people/stage.ts, mentions.ts), §3.4 (routes/people.ts, routes/mentions.ts, routes/followups.ts), §5 (content.ts, background.ts, shared/messages.ts, shared/radar.ts, shared/sightings.ts), §7, §9. Codemap is fresh at `2a7693e` (staleness check ran clean 2026-07-16).

## Why / what changes for the user

On x.com/notifications today, a reply notification shows the reply text but not which of my posts it's on — the user has to click through to remember. After this ships: every reply/mention notification that stratus knows (via the mentions table) gets an injected "↳ on your post: «…»" line plus a "✓ answered" chip when the inbox already settled it; every handle in the tab that is an ally/mutual/target gets the same tier chip the Radar uses, so the eye goes to the people who matter. Silently, the tab also becomes a $0 harvest surface: likes, reposts and follows scraped from notification cells become `people` rows (source `notification`) and timeline events (`their_like`/`their_repost`/`their_follow`) — the dossier finally shows "this person has quietly liked 9 of my posts", and Top Fans displays an engagement count next to the inbound count. A one-click "sync replies" chip at the top of the page runs the existing capped mentions refresh so the parent-context lines cover the freshest replies.

## Design

**Data:** no new tables, no migration. Three new `person_events.type` values (`their_like`, `their_repost`, `their_follow`) — the `type` column is free text (schema.ts L437 comment only), so this is a stage.ts constant + comment change. `people.source` gains the value `'notification'` (free text, comment update).

**Pure logic:**
- `extension/src/shared/notifications.ts` (new): `parseNotificationCell(article) → {kind: 'like'|'repost'|'follow'|'other', handles: string[], targetText: string|null}` for `article[data-testid="notification"]` cells. Icon-first kind detection (the cell's leading svg glyph), locale keyword fallback (en + ro). Handles from `[data-testid^="UserAvatar-Container-"]` suffixes. Fixture-tested with happy-dom (the `earlyReplies.ts` pattern).
- `src/x/people/engagements.ts` (new, mirrors `sightings.ts`): `MAX_ENGAGEMENTS_PER_BATCH = 50`, `dedupeEngagements`, `engagementEventId`, `resolveTargetTweetId` (collapsed-whitespace prefix match of the scraped snippet against recent own `posts_published`), `recordEngagements` (upsert fill-only → INSERT OR IGNORE events → `recomputePerson` for watermarks; stage cannot move because the new types are in no stage set).

**Deterministic id scheme** (all INSERT OR IGNORE):
- `their_like:notif:<handle>:<tweetId>` / `their_repost:notif:<handle>:<tweetId>` when the target post resolves;
- day-bucket fallback `their_like:notif:<handle>:<YYYY-MM-DD>` when it doesn't (hover_sighting pattern — bounded re-log, never a flood);
- `their_follow:notif:<handle>` (a follow logs once, ever).

**Routes:** one new endpoint, `POST /x/people/engagements` in `src/x/routes/people.ts` (POST — no collision with `GET /people/:handle`; validation mirrors the sightings route). Body `{engagements: [{kind, handle, targetText?, seenAt}]}`, ≤50/batch, kinds whitelisted to like|repost|follow, response `{received, processed, skipped, events}`. Plus: `GET /x/people/fans` (routes/followups.ts) gains a per-fan `engagementCount` (the three new types in the same window) — **display-only, `rankFans` unchanged**.

**Extension:**
- `background.ts`: new `stratus/notif-context` message (content → background). Response `{ok, mentions: Record<tweetId, {parentText, status}>, rankMap}`. Mentions map built from `GET /x/mentions?limit=200` behind a 5-min TTL cache (the `RANKMAP_TTL_MS` pattern, in-flight-guarded); rankMap is the existing S0.3 cache. `force: true` (sent after a sync click) invalidates the mentions cache. Background stays the only Authorization owner.
- `content.ts`: new notifications section, active only when `location.pathname.startsWith('/notifications')`, hooked into the existing `scan()` loop. Three behaviors: (a) tweet-article notifications → `findPermalink` → context map → inject parent line + answered chip; (b) tier chips from `personTierFor` (`shared/radar.ts`) next to User-Name; (c) aggregated cells → `parseNotificationCell` → batched `POST /x/people/engagements` on the sightings transport pattern (2s flush, sent-key throttle). Capture is gated by the existing `passiveCapture` setting — no new toggle. Plus the injected "sync replies" chip (one per page) calling `POST /x/mentions/refresh` on click.

**Measurement:** dossier timelines show the new events; Top Fans rows show `engagementCount`; `scripts/smoke-notifications.ts` asserts ingest idempotency and target resolution end-to-end at $0. (No playbook cell — engagement counts are not outcome stats; nothing here needs an n≥20 gate.)

## Decisions taken

1. **Stage effect of engagement events: timeline-only** (user-confirmed). `their_like`/`their_repost`/`their_follow` join `PERSON_EVENT_TYPES` but NOT `NOTICED_TYPES`/`INBOUND_TYPES`/`OUTBOUND_TYPES` — same contract as `harvest_seen`. Stages keep meaning "we actually talked". Do not re-litigate; do not add them to fans *ranking* either.
2. **Roster growth: all engagers become people rows** (user-confirmed). Fill-only stubs, `source: 'notification'`, via the standard `logPersonEvents` stub-creation path. Dozens of rows/day at single-user scale is the point ("the roster grows itself").
3. **Never touch the `mentions` table from this surface.** Parent-context is read-only over what the API pull already stored; DOM-scraped reply ids would corrupt the since_id checkpoint. Freshness gap is closed by the human-click sync chip, not by auto-pulls.
4. **No auto-refresh of mentions on page visit.** A page visit is not consent to spend. The chip is a deliberate click, same shape as C7's launch-room assist button.
5. **Reuse the `passiveCapture` toggle** for engagement capture instead of a new setting — it is the same class of ambient DOM capture as hover sightings, and Settings copy already explains it.
6. **Icon-first, keyword-fallback kind detection.** Locale-proof where possible (svg glyph), degrading to en+ro keywords; unknown cells parse as `'other'` and are dropped client-side, never sent.
7. **This is a CIRCLES-flavored phase (C10)** — status entry goes in `CIRCLES-PLAN.md`, not SURFACES-PLAN.

## Done when

1. In a real browser on x.com/notifications: a reply notification whose tweet id exists in `mentions` renders the injected "on your post: «…»" line, and one already answered shows the ✓ chip.
2. Scrolling the notifications page produces `people` rows with `source='notification'` and `their_like`/`their_repost`/`their_follow` events; revisiting the page does NOT duplicate them (deterministic ids verified by `scripts/smoke-notifications.ts` double-posting the same batch).
3. `computeStage` provably never moves on engagement events (test matrix case: a person with 50 likes and a follow is still `stranger`).
4. Top Fans rows display an engagement count; the ranking order is byte-identical to before when engagement counts are stripped.
5. Clicking the injected sync chip triggers exactly one `POST /x/mentions/refresh` and the parent-context lines refresh after it.
6. `bun test` + `bun run typecheck` + `bun run lint` green; `smoke-notifications.ts` passes at $0.

---

## Task 1: Notification cell parser (extension shared, pure) [parallel-ok]
**Depends on:** none
**Session budget:** ~250 lines, 2 files

**Read first:** codemap header + §5; `extension/src/shared/earlyReplies.ts` (whole — the fixture-tested DOM parser exemplar) + `extension/src/shared/earlyReplies.test.ts`; `extension/src/content.ts:79-100` (RESERVED_HANDLES) and `:1172-1196` (handle/anchor parsing idiom).

**Edit:**
- `extension/src/shared/notifications.ts` (new) — the parser.
- `extension/src/shared/notifications.test.ts` (new) — happy-dom fixture suite.

**How:** Export `type EngagementKind = 'like' | 'repost' | 'follow' | 'other'` and `interface ParsedNotification { kind: EngagementKind; handles: string[]; targetText: string | null }`. `parseNotificationCell(article: Element): ParsedNotification | null` operates on `article[data-testid="notification"]` cells. Kind detection order: (1) the cell's first `svg path` `d` attribute matched against exported prefix constants for X's heart / retweet-arrows / person glyphs (capture the real `d` strings into the fixtures while building them); (2) fallback: header text keywords — en `liked|reposted|followed`, ro `apreciat|redistribuit|urmăre` — matched case-insensitively; (3) otherwise `'other'`. Handles: every `[data-testid^="UserAvatar-Container-"]` suffix, lowercased, validated against `/^[A-Za-z0-9_]{1,15}$/`, deduped (aggregated cells show ≤~8 avatars; that's all the DOM offers — accept it). `targetText`: the longest `[dir="auto"]` text block in the cell that does not contain the header verb, trimmed, trailing `…`/`...` stripped, else null (follow cells have none). Keep the module dependency-free (it gets inlined into the content-script IIFE — §7.26). Do NOT import from content.ts; duplicate the small handle regex locally like `sightings.ts` does.

**Tests:** fixture HTML (built with happy-dom like `earlyReplies.test.ts`): single-liker cell, aggregated "A and B liked" cell, repost cell, follow cell (no targetText), unknown-kind cell → `'other'`, Romanian-locale header fallback, skeleton cell (no avatars) → `handles: []`, ellipsis-stripped targetText.

**Done when:**
- [ ] All four kinds + fallback + `'other'` parse correctly from fixtures
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(extension): notification cell parser (shared, fixture-tested)`

**Cost note:** $0 — pure DOM parsing.

---

## Task 2: Engagement event types + ingest module (server, pure+DB) [parallel-ok]
**Depends on:** none
**Session budget:** ~300 lines, 4 files

**Read first:** codemap header + §3.3 + §7.7/7.9; `src/x/people/sightings.ts` (whole — THE exemplar); `src/x/people/stage.ts` (whole); `src/x/people/store.ts:35-215` (`normalizePersonHandle`, `upsertPerson`, `logPersonEvents`, `recomputePerson`); `src/x/people/sightings.test.ts` for the test shape.

**Edit:**
- `src/x/people/stage.ts` — add `'their_like' | 'their_repost' | 'their_follow'` to `PERSON_EVENT_TYPES` + the comment block. **Do NOT add them to `NOTICED_TYPES`/`INBOUND_TYPES`/`OUTBOUND_TYPES`** (decision 1).
- `src/x/db/schema.ts` — comment-only updates: `person_events.type` list (L435-436), `people.source` list (L411).
- `src/x/people/engagements.ts` (new) — the ingest module.
- `src/x/people/stage.test.ts` + `src/x/people/engagements.test.ts` (new) — tests.

**How:** Mirror `sightings.ts` structure exactly. Exports: `MAX_ENGAGEMENTS_PER_BATCH = 50`; `interface EngagementInput { kind: 'like'|'repost'|'follow'; handle: string; targetText: string | null; seenAt: Date }`; `dedupeEngagements` (key = `kind:handle:targetText` — freshest `seenAt` wins); `engagementEventId(kind, handle, targetTweetId, seenAt)` implementing the id scheme from the Design section (follow ignores date and target entirely); `resolveTargetTweetId(targetText)` — SELECT `tweetId, text` from `postsPublished` newest-first, limit ~300, and return the first row whose collapsed-whitespace text **starts with** the collapsed snippet (snippets are truncated; ≥20 chars required to avoid false prefix hits, else return null); `recordEngagements(inputs): Promise<{received, processed, skipped, events}>` — normalize handles (`normalizePersonHandle`), dedupe, then per row: `upsertPerson(handle, {source: 'notification'})` (fill-only default), insert the event via `db.insert(personEvents).values({...}).onConflictDoNothing().returning()` (count actual inserts like sightings does), map type `like→their_like` etc., `summary` like `liked: "«snippet»"` via `snippet()` from store.ts or `followed you`, `refTable: null, refId: null` (the id already encodes the ref — deterministic ids don't need one, see `hoverSightingEventId`), then `recomputePerson(handle, seenAt)` (moves lastSeenAt; stage provably can't move). Cache the `resolveTargetTweetId` post list once per batch, not per row.

**Tests:** stage matrix addition — events `[their_like ×50, their_follow]` → `computeStage` returns `'stranger'`; an existing `mutual` person receiving likes stays `mutual` (ratchet + no demote). engagements suite over the in-memory DB (seed `posts_published` rows, clean up — §9 shared-DB discipline): dedupe freshest-wins; resolved-target id shape; unresolved → day-bucket id; follow id has no date; double `recordEngagements` of the same batch inserts 0 new events second time; fill-only upsert (pre-enriched person keeps displayName); short snippet (<20 chars) does not resolve.

**Done when:**
- [ ] Idempotency: same batch twice → second run `events: 0`
- [ ] Stage matrix proves timeline-only
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(people): engagement events (their_like/their_repost/their_follow) + ingest module`

**Cost note:** $0 — SQL over already-owned data.

---

## Task 3: POST /x/people/engagements route
**Depends on:** Task 2
**Session budget:** ~150 lines, 2 files

**Read first:** codemap header + §3.4 + §7.20; `src/x/routes/people.ts:395-450` (the sightings POST — validation exemplar); `src/x/people/sightings.test.ts` route-validation cases (in `src/x/people/sightings.test.ts` or `src/x/routes/people.test.ts` — find where sightings route tests live and colocate).

**Edit:**
- `src/x/routes/people.ts` — add `POST /people/engagements` next to the sightings route.
- `src/x/routes/people.test.ts` — route suite additions.

**How:** Copy the sightings route shape: JSON body guard, `engagements` array required non-empty, `> MAX_ENGAGEMENTS_PER_BATCH` → 400 `too_many_engagements`, per-item validation (kind ∈ like|repost|follow → else 400 `invalid_engagement` with index; handle string; `targetText` string|null|undefined; `seenAt` ISO parseable → invalid → 400). Call `recordEngagements`, return its counts as JSON 200. POST method means no `:handle` route collision (§7.20 trap does not bite, but note it in a comment). No mount-order change needed — `peopleRouter` is already mounted.

**Tests:** over the in-memory DB via `app.request`: happy path returns counts and creates the person (then clean up rows); 400s for empty array, oversize batch, bad kind, bad seenAt; 401 without bearer (app-level, likely already covered — add only if the sightings suite does).

**Done when:**
- [ ] Route round-trips a valid batch; all validation guards fire pre-DB
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(routes): POST /x/people/engagements ingest endpoint`

**Cost note:** $0.

---

## Task 4: Background notif-context message + cache [parallel-ok]
**Depends on:** none (uses existing routes only)
**Session budget:** ~120 lines, 2 files

**Read first:** codemap header + §5; `extension/src/background.ts:200-260` (rankmap TTL cache — the exemplar) and its message-dispatch switch; `extension/src/shared/messages.ts` (whole); `src/x/routes/mentions.ts:84-110` (the GET /mentions response shape — `parentText` join).

**Edit:**
- `extension/src/shared/messages.ts` — add `NotifContextGet { type: 'stratus/notif-context'; force?: boolean }` + guard `isNotifContextGet`.
- `extension/src/background.ts` — handle it.

**How:** New module-level cache mirroring the rankmap block: `notifContext: Record<string, {parentText: string | null, status: string}>`, `notifContextAt = 0`, `NOTIF_CONTEXT_TTL_MS = 5 * 60_000`, in-flight guard. Refresh = background-issued fetch of `/x/mentions` with `query: {limit: '200'}` through the same internal request helper the rankmap refresh uses (background is the Authorization owner — never expose the token). Map rows by `tweetId`. On `stratus/notif-context`: if `force` → drop cache; refresh if stale; also `await refreshRankMap()` (existing function); respond `{ok: true, mentions: notifContext, rankMap}`. On any fetch failure respond `{ok: true, mentions: {}, rankMap}` — augmentation silently degrades, never errors the page. Register the handler in the same onMessage dispatcher as the radar/launch messages (sendResponse pattern used there).

**Tests:** none required beyond typecheck (background has no test harness; the cache logic is 20 lines mirroring an existing verified pattern). Keep any pure helper (row→map) in messages-adjacent shared code ONLY if it grows — otherwise inline.

**Done when:**
- [ ] Message returns mentions map + rankMap; `force` bypasses TTL
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(extension): background notif-context cache (mentions map + rankmap)`

**Cost note:** $0 — reads already-billed rows via the existing bearer transport.

---

## Task 5: Content script — augment + capture + sync chip
**Depends on:** Tasks 1, 3, 4
**Session budget:** ~300 lines, 1 file (content.ts) + styles within it

**Read first:** codemap header + §5 + §7.24–27; `extension/src/content.ts:1062-1250` (radar + sightings flush patterns — THE transport exemplars), `:1326-1360` (scan loop + start), `:230-240` (`findPermalink`), `:111-230` (style injection), `:1139-1160` (passiveCapture setting); `extension/src/shared/radar.ts:105-130` (`personTierFor`); Task 1's parser; Task 4's message.

**Edit:**
- `extension/src/content.ts` — new "notifications surface" section + two `scan()` hook calls + CSS additions in `injectStyles`.

**How:** Gate everything on `location.pathname.startsWith('/notifications')` (cheap check at the top of each hook; the SPA navigates without reloads so check per scan, not once).
(a) **Parent context**: for each `article[data-testid="tweet"]` on the page, `findPermalink` → tweetId → look up the context map (fetched via `stratus/notif-context` on a 60s throttle, stored in a module var). If `parentText` present and no `.stratus-notif-ctx` child yet, append a small muted line `↳ on your post: “<parentText sliced ~90 chars>”` under the tweet text block; add a `✓ answered` suffix span when `status === 'answered'`. Dedupe per article via a WeakSet AND `dataset` stamp (X rebuilds rows — the WeakSet alone is not enough; check for the class before injecting, the badge-injection idiom at `renderBandBadge`).
(b) **Tier chips**: for both tweet-articles and notification cells, resolve each handle against `rankMap` with `personTierFor`; when ally/mutual/target, inject a chip span after the User-Name / first avatar (reuse the chip look via new CSS classes `stratus-notif-tier`, colors matching the panel's `.stage-ally`/`.stage-mutual`/target amber). Same dedupe discipline.
(c) **Engagement capture**: for each unprocessed `article[data-testid="notification"]` (WeakSet), if `passiveCaptureEnabled` → `parseNotificationCell`; drop `kind==='other'` or empty handles; queue `{kind, handle, targetText, seenAt: new Date().toISOString()}` per handle into a pending map keyed `kind:handle:targetText`, with a sent-keys `Set` throttle (clear at >3000 — the radarSentAt idiom); flush every 2s via `ApiRequest POST /x/people/engagements` (≤50/batch, overflow re-arms the timer — copy `flushSightings` verbatim in shape). Server idempotency makes re-sends harmless; the throttle only saves chatter.
(d) **Sync chip**: once per notifications pageview, inject a small `stratus: sync replies` button near the primary column top. On click: `ApiRequest POST /x/mentions/refresh` (empty body); on success re-request `stratus/notif-context` with `force: true` and re-scan; on 429 show `limit reached` in the chip for 2.5s (`STATUS_PERSIST_MS` idiom). No auto-fire, ever (decision 4).
Hook (a)–(d) into `scan()` next to `capturePassiveHoverCards()`. Everything stays IIFE-safe: only imports from `./shared/*` and existing local helpers.

**Tests:** the parser is already covered (Task 1); transport/flush logic mirrors tested patterns. Manual verification in a real browser is the acceptance gate here (Done-when 1/2/5 of the plan header). Run `cd extension && bun run build` and load unpacked.

**Done when:**
- [ ] Real-browser check: parent line + answered chip render on known reply notifications; tier chip on a known ally/target; engagement rows land in the DB while scrolling; sync chip fires one refresh and updates lines
- [ ] Toggling `passiveCapture` off stops capture (augmentation may stay — it is read-only)
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green (both root and `extension/`)
- [ ] Committed: `feat(extension): notifications tab — parent-post context, tier chips, engagement capture, sync chip`

**Cost note:** $0 ambient. Sync chip: one capped mentions pull per human click (server 6/day cap already enforced — do not add client bypasses).

---

## Task 6: Fans engagement count (display-only) + dossier labels
**Depends on:** Task 2 (event types exist)
**Session budget:** ~120 lines, 4 files

**Read first:** codemap header + §3.4; `src/x/routes/followups.ts:330-395` (fans route + the `their_mention`/`their_reply_to_me` aggregate); `src/x/people/followups.ts:417-440` (`rankFans` — DO NOT change it); the Fans component (hosted in `Today.tsx` — find `Fans` in `extension/src/sidepanel/`); `extension/src/sidepanel/People.tsx` timeline rendering (check whether event types map to labels or render raw).

**Edit:**
- `src/x/routes/followups.ts` — second aggregate over `personEvents` for the three engagement types in the same window; merge `engagementCount` into each fan row.
- `src/x/routes/followups.test.ts` — coverage.
- Fans component — render `· N engagements` when > 0.
- `People.tsx` — if the dossier timeline uses a type→label map, add the three labels (`liked a post`, `reposted`, `followed you`); if it renders raw types, leave it.

**How:** Keep ranking input identical — compute `engagementCount` in a separate query keyed by handle and attach after `rankFans` runs (decision 1: engagement never affects order). Window = the same `days` param. Zero-count fans omit the field or carry 0; UI hides 0.

**Tests:** route suite: seed a fan with 2 mentions + 3 likes in-window + 1 like out-of-window → `inboundCount: 2`, `engagementCount: 3`; assert ranking equals the pre-change order for a two-fan fixture where engagement counts would invert it if (wrongly) ranked. Clean up seeds.

**Done when:**
- [ ] `engagementCount` correct and window-scoped; ranking provably unchanged
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(fans): display-only engagement counts from notification events`

**Cost note:** $0.

---

## Task 7 (final): docs-sync + smoke
**Depends on:** all prior.

- [ ] `scripts/smoke-notifications.ts` — rerunnable, $0, no `--live` needed: in-process Hono app + real DB; POST a synthetic engagement batch (throwaway handle) → assert person `source='notification'` + 3 event kinds + correct id shapes; POST the identical batch again → assert `events: 0` (idempotency); seed one `posts_published` row and assert snippet-prefix target resolution lands the tweetId in the event id; assert the person's stage is still `stranger`; GET `/x/people/fans` shows the engagement count; clean up every row it created.
- [ ] CLAUDE.md: phase entry **"Circles C10 — Notifications surface (2026-07-XX, $0)"** — what shipped, the mentions-checkpoint guardrail, the timeline-only stage decision, the sync-chip cost shape, "done when" tail (first real-browser session harvesting engagements).
- [ ] `CIRCLES-PLAN.md`: C10 status entry.
- [ ] `docs/notifications-surface.md` (new): the on-page surface (what gets injected where, what gets captured, the passiveCapture gate, the sync chip caps); plus one line in `docs/today-tab.md` for the Fans engagement count.
- [ ] `.claude/skills/plan-feature/references/codemap.md`: §3.3 (engagements.ts, stage types), §3.4 (people/engagements route, fans field), §5 (content.ts notifications section, background notif-context, shared/notifications.ts, messages), §7 (note: mentions-checkpoint trap now has TWO precedents — launch.ts and notifications), §9 (smoke list) + header re-stamp.

## Out of scope (do NOT build)

- **Inserting anything into the `mentions` table from DOM scrape** — corrupts the since_id checkpoint (§4). Parent context is read-only; the freshness gap is the sync chip's job.
- **Auto-refreshing mentions on page visit or on a timer** — spend needs a human click.
- **Counting engagement events as inbound** for stage, fans *ranking*, or C5 followup classification (decision 1). No `engaged_fan` followup kind.
- **Scraping the Verified/Mentions sub-tabs differently** — the same parsers run wherever the DOM matches; no per-sub-tab logic.
- **Notification-driven Grok drafting** — Reply Master already works from the tweet page; no new spend paths.
- **A new settings toggle** — `passiveCapture` governs this capture.
- **Following/follower sync via API** — explicitly out of scope in PLAN.md; the follow signal here is DOM-only.

## Risks / watch items

- **DOM brittleness**: `article[data-testid="notification"]`, avatar-container testids, and svg glyph paths are X-owned and can shift. The parser fails closed (`'other'` → dropped); fixtures make regressions visible but only after a breakage. Watch the first week's `people` rows for gibberish handles.
- **Aggregated cells under-report**: "A, B and 12 others liked" exposes only the rendered avatars (~≤8). Accepted — this is a signal harvest, not an audit.
- **Target resolution is prefix-heuristic**: short/emoji-heavy posts may not resolve → day-bucket ids re-log the same like across days (bounded: 1 event/handle/day/kind). Acceptable noise; revisit only if dossiers look spammy.
- **Locale fallback keywords** are en+ro only; icon-first should carry other locales, unverified.
- **Mentions coverage gap**: parent context exists only for API-pulled replies. New replies show nothing until the daily pass or a sync click — by design, but the user should expect blanks on fresh notifications.
- **"Done when" tails needing live verification**: the first real scroll session harvesting engagements, and the sync-chip → context-refresh loop on the live page.
