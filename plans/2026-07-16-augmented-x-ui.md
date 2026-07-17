# Augmented X UI v2 — people chips on the timeline, full-context panel on the tweet page

- **Status:** planned 2026-07-16 · not started
- **Goal fit:** Goal 4 (Circles — know the people behind the handles, and the context they give every post and reply), rendered where the decision actually happens: on x.com itself. Also serves goal 3's reply doctrine (the band border stays; the context panel makes each reply relationship-aware for the human, the way C3 made it for Grok).
- **Cost impact:** **$0.** All new reads are SQL over already-billed stratus data (`GET /x/people/glance` new, `GET /x/people/:handle` existing), fetched through the existing background `ApiRequest` transport with client-side caches. No X API reads, no Grok calls, no new writes.
- **Invariants touched:**
  - §7.20 static path before `:param` — the new `/people/glance` must register before `GET /people/:handle` (same trap rankmap already dodges).
  - §7.24–27 extension discipline — one transport (`ApiRequest`), content script stays an IIFE (shared modules inlined, no heavy deps), background stays the single `chrome.storage.session` writer (Task 6's open-person key is background-written).
  - §7.12 no derived-state tables — glance is a read-time regroup, nothing stored.
  - §7.31 no emojis in new UI text — chips use text glyphs/SVG-free unicode (`◎`, `↩`), not emoji.
  - §8 — nothing here may touch the X API or auto-post; all interaction stays manual.
- **Codemap sections relevant:** §3.4 (routes/people.ts), §5 (content.ts, background.ts, shared/, messages), §7.20/24–27, §9 (route suites over in-memory DB), §10 recipes.

## Why / what changes for the user

Scrolling the timeline, the green stats pill is gone (the left border color still marks hot/warm/skip). Instead, tweets from people stratus knows carry small native-looking chips right of the name/handle line: a stage chip for real relationships (engaged and up), a `◎` marker for the 2–10x target roster, an amber `↩` when that person has an unanswered mention waiting in my inbox, and a `7d+` neglect mark on targets/allies I haven't replied to in a week. Opening a tweet in its own tab, the leftover purple sparkle circle (injected by the legacy standalone "Reply Master" extension) is gone, and below the tweet's action row sits a collapsible "stratus context" panel styled like part of X: who this person is to me (stage, exchanges, followers + momentum, tags), whether I already replied to this very tweet, open loops I owe them, my last measured replies to them with outcomes and the angle that works, and my notes verbatim. Clicking a chip or the panel header opens their dossier in the side panel.

## Design

**Data / server.** One new $0 endpoint in `src/x/routes/people.ts`, registered directly after `/people/rankmap` (before `:handle`):

```
GET /x/people/glance
→ 200 { count, map: { [lowercased handle]: {
    stage: Stage,
    isTarget: boolean,
    openLoops: number,            // count of mentions rows status='unanswered' by this author
    lastOutboundAt: string|null,  // people.last_outbound_at ISO
    lastInboundAt: string|null,
    followersCount: number|null
  } } }
```

Sources: all non-retired `people` rows; `mentions` grouped by `lower(author_username)` where `status='unanswered'`; `loadTargetHandles()` (exported from `routes/voice.ts`, same set rankmap uses). A target with no people row still appears (stage `'stranger'`, like rankmap does). Rankmap itself stays untouched — it feeds radar tier stamping and is deliberately minimal.

The tweet page needs no new endpoint: `GET /x/people/:handle` (the C1 dossier) already returns person + events + replies-with-outcomes + angle crosstab + mentions + savedTweets + followerSeries. 404 = unknown person.

**Pure logic (bun-tested, inlined into the content IIFE).**
- `extension/src/shared/glance.ts` — `GlanceEntry`/`GlanceMap` types mirroring the endpoint, `buildPersonChips(entry, nowMs)` → ordered `PersonChip[]` view-models (`{kind: 'stage'|'target'|'owed'|'neglected', label, tooltip, tone}`), plus `NEGLECT_DAYS = 7` (same reading as the Targets amber and C5 `neglected_target`).
- `extension/src/shared/tweetContext.ts` — `buildTweetContextModel(dossier, tweetId, nowMs)` → the panel's view-model: header (stage, since, followers, momentum/day from `followerSeries` when ≥2 points, tags), relationship line (inbound/outbound counts from `events`, last dates), `alreadyReplied` (a posted outcome whose `sourceTweetId === tweetId`), open loops (dossier `mentions` with `status='unanswered'`, age-stamped), last 3 measured reply outcomes (text snippet, views, profileVisits, angle), angle preference (best angle from the dossier `angles` crosstab, **gated at ≥3 measured** — mirror `MIN_MEASURED_FOR_ANGLE_PREFERENCE` from `src/x/people/relationship.ts`), notes verbatim.

**Extension / DOM.** All in `extension/src/content.ts`, following its existing patterns (MutationObserver scan loop, re-compute per scan for recycled nodes, rgba theme-neutral colors in `injectStyles`):
- Delete `renderBandBadge` + `BAND_BADGE_CLASS` styles; `applyBand` keeps `readTweetSignals`, the `data-stratus-band` border/dim, and `recordRadarSighting` — radar streaming and the server band gate are untouched.
- Person chips: per article, find the `[data-testid="User-Name"]` row, upsert a `span.stratus-person-chips` (update-in-place keyed by a data attribute, like the badge did — X recycles nodes). Glance map fetched via `ApiRequest` with a module-level cache (channels-cache pattern, TTL 10 min). Handle matched lowercased.
- Tweet page: on `/status/` pages, for the focused article, add the defensive `#reply-master-btn { display: none !important; }` kill rule (the legacy extension's floating button — see Decision 1; the real removal is uninstalling that extension) and inject `div.stratus-context-panel` after the focused article's action-row region, rendered from the tweetContext view-model. One dossier fetch per handle (5-min module cache); 404 renders a single muted "no file" line. Collapsible; collapsed flag in `chrome.storage.local['augment:contextCollapsed']`.
- Click-through: new `stratus/open-person {handle}` message → background calls `chrome.sidePanel.open({tabId})` (the click is a user gesture; gesture credit survives one message hop in Chrome ≥116, best-effort catch) and writes session key `stratus:openPerson` (background = single writer); `App.tsx` reads it on mount + `storage.onChanged`, routes via the existing `openPerson(handle)`, then asks the background to clear it.

**Measurement.** None statistical — it's a $0 presentation feature. Verification is the smoke script (glance route) + route tests + a live browser check (the "done when" tail).

## Decisions taken

1. **The "old circle button" is the legacy standalone "Reply Master" extension** (`~/newme/clipx/reply-master/extension`), still loaded unpacked in Chrome — verified live: a foreign `<button id="reply-master-btn" aria-label="Reply Master">` (36×36) appended to `<body>`, outside X's react root; its source sets `const BTN_ID = 'reply-master-btn'`. Nothing in the current stratus extension creates it. Fix is twofold: (a) **the user removes/disables the "Reply Master" extension in `chrome://extensions`** (the real fix — it also stops that extension's other scripts), and (b) stratus's `injectStyles` gains a defensive kill rule `#reply-master-btn { display: none !important; }` so the button can never resurface if the old extension gets re-enabled. The current stratus `🪄 Reply Master` pill in the action row stays.
2. **Green stats pill removed everywhere, not just the timeline** — the same badge renders on status pages; the border + context panel replace it. The signals it displayed survive in tooltips (chips) and the radar "why" line.
3. **Stage chip only for `engaged`+.** C6 passive hover capture makes half the timeline `noticed`; chips for `noticed`/`stranger` would be noise. `◎` target, `↩` owed, and `7d+` neglected render regardless of stage (a target can be a stranger).
4. **New `/people/glance` endpoint instead of widening rankmap.** Rankmap is a tuned contract consumed by `stampTiers`; glance has different membership (all non-retired people) and payload (open loops, recency). Both are trivial SQL; keeping them separate avoids re-testing the radar path.
5. **Content-script-side caches (channels pattern), not background caches.** Glance/dossier are read-only GETs; the background-single-writer rule applies to session-storage writes, not HTTP reads. Only Task 6's open-person session key goes through the background.
6. **Chips/panel are read-only in v1** except the dossier click-through. No notes editing, no mention-answering from the page — the side panel already owns those flows.
7. **No AskUserQuestion needed** — the user explicitly delegated chip content ("propose ... as you consider util") and the placement follows from "fits naturally in the UI".

## Done when

- [ ] Scrolling x.com: no green stats pill anywhere; hot/warm left borders still appear; the Radar queue in the panel still fills (streaming unaffected).
- [ ] A tweet by a `mutual`-stage person in the 2–10x roster with an unanswered mention shows (in the browser): stage chip + `◎` + `↩`, each with a correct tooltip; an unknown author shows nothing.
- [ ] On a status page of a known person: the legacy purple sparkle circle is gone (old "Reply Master" extension removed + kill rule in place), and the context panel renders stage, exchange counts, open loops, ≥1 measured past reply with views/profile clicks, and notes — visually consistent with X in both light and dark themes.
- [ ] "Already replied to this tweet" banner appears on a tweet that has a posted `reply_drafts` row with that `sourceTweetId`.
- [ ] Clicking a chip or the panel header opens the side panel on that person's dossier.
- [ ] `bun scripts/smoke-glance.ts` passes against the real DB ($0) and `bun test`/`typecheck`/`lint` are green.

---

## Task 1: `GET /x/people/glance` — the timeline decoration map
**Depends on:** none
**Session budget:** ~220 diff lines, 3 files

**Read first:** codemap header + §3.4, §7.20; `src/x/routes/people.ts:160-197` (the rankmap route — the exemplar to imitate, including its mount-position comment), `src/x/routes/voice.ts` (just `loadTargetHandles`'s export), `src/x/db/schema.ts` `people` + `mentions` table blocks, `src/x/routes/people.test.ts` (existing rankmap tests — seeding style over the shared in-memory DB).

**Edit:**
- `src/x/routes/people.ts` — add `GET /people/glance` immediately after the rankmap route (still before `GET /people/:handle`; copy rankmap's NOTE comment style).
- `src/x/routes/people.test.ts` — new describe block.
- `scripts/smoke-glance.ts` — new rerunnable $0 smoke.

**How:** Three queries, then assemble the map keyed by lowercased handle: (a) `db.select(...)` over `people` where `retired = false` → stage, lastOutboundAt, lastInboundAt, followersCount; (b) `select lower(author_username), count(*) from mentions where status='unanswered' group by 1` (use `sql` template — remember §7.13: no `Date` binds, but none needed here); (c) `await loadTargetHandles()` → `Set`. Backfill target handles missing a people row as `{stage:'stranger', isTarget:true, openLoops:0, ...nulls}` exactly like rankmap does. Dates serialize as ISO (drizzle `timestamp_ms` columns are `Date`s — call `.toISOString()` or let `c.json` do it; match what rankmap/dossier already emit). No query params in v1. Response shape from the Design section verbatim.

**Tests:** in `people.test.ts` over the in-memory DB (clean up rows you seed — shared DB, §9): map contains a seeded non-retired person with correct stage/lastOutboundAt; retired person absent; unanswered mention increments `openLoops` while an `answered` one doesn't; a voice-target with no people row appears as stranger+isTarget (reuse the rankmap tests' account-snapshot/voice-author seeding trick); static path wins over `:handle` (GET `/x/people/glance` never 404s as a dossier — mirror the rankmap mount-order assertion).

**Smoke:** `scripts/smoke-glance.ts` — in-process Hono app (imitate `scripts/smoke-targets.ts`): seed throwaway person + unanswered mention, assert the map entry, delete the rows, rerunnable.

**Done when:**
- [ ] `curl /x/people/glance` on a dev DB returns the documented shape
- [ ] Route tests incl. mount-order and openLoops cases pass
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(people): GET /x/people/glance decoration map`

**Cost note:** $0 — pure SQL over existing tables.

---

## Task 2: `shared/glance.ts` — chip view-model core
**Depends on:** Task 1 (the response contract; parallel-ok once the shape above is fixed)
**Session budget:** ~200 diff lines, 2 files

**Read first:** codemap §5, §7.26–27; `extension/src/shared/radar.ts:24-131` (`RankMapEntry`/`personTierFor`/`stampTiers` — the style to match for a rankmap-like client type + pure derivations), `extension/src/shared/sightings.ts` (pure-module + test conventions), `src/x/people/followups.ts` (only the neglected-target 7d reading, to keep semantics aligned).

**Edit:**
- `extension/src/shared/glance.ts` — new module.
- `extension/src/shared/glance.test.ts` — new suite.

**How:** Export `GlanceEntry`/`GlanceMap` (typed after Task 1's JSON), `NEGLECT_DAYS = 7`, `GLANCE_TTL_MS = 10 * 60_000`, and `buildPersonChips(entry: GlanceEntry, nowMs: number): PersonChip[]` where `PersonChip = {kind: 'stage'|'target'|'owed'|'neglected'; label: string; tooltip: string; tone: 'ally'|'mutual'|'responded'|'engaged'|'target'|'warn'}`. Rules: stage chip only when `stageRank ≥ engaged` (hardcode the ordered stage list — do NOT import server `stage.ts` into the IIFE; a 6-element const is fine), label = the stage word; `target` chip label `◎`, tooltip "2–10x target roster"; `owed` chip label `↩ n` (n = openLoops) only when `openLoops > 0`, tooltip "n unanswered mention(s) from them"; `neglected` chip label like `9d` only when (isTarget or stage ally/mutual) and `lastOutboundAt` older than `NEGLECT_DAYS` (or null with ≥1 inbound), tooltip "no reply from you in 9d". Order: stage, target, owed, neglected. No emojis; keep the module dependency-free so Vite inlines it into `content.js`.

**Tests:** engaged+ gate (noticed → no stage chip, engaged → chip); owed only when openLoops>0 with count in label; neglect boundary (exactly 7d vs 8d; null lastOutboundAt + isTarget → neglected; non-target stranger never neglected); chip order; tooltip text stability.

**Done when:**
- [ ] All chip rules covered by tests
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(extension): glance chip view-model core`

**Cost note:** $0.

---

## Task 3: Timeline revamp — kill the stats pill, inject person chips
**Depends on:** Tasks 1, 2
**Session budget:** ~300 diff lines (mostly content.ts), 2 files

**Read first:** codemap §5, §7.24–27; `extension/src/content.ts` in full — specifically `injectStyles` (111–232), `renderBandBadge`/`applyBand` (1031–1060), the channels cache (443–474, the fetch/TTL exemplar), `scan` (1328–1338); `extension/src/shared/glance.ts` (Task 2).

**Edit:**
- `extension/src/content.ts` — remove badge, add chips + glance cache + styles.
- `docs/` — none yet (Task 7).

**How:**
1. Delete `renderBandBadge`, `BAND_BADGE_CLASS` const + its style rules, and the `badge` branch in `applyBand`. **Keep** `readTweetSignals`, `article.dataset.stratusBand` (border/dim styles stay), and `recordRadarSighting` — the radar stream and Reply Master signals path must be byte-identical after this task. `formatCount`/`BAND_LABEL` imports become unused → drop from the import list.
2. Glance cache: module-level `{map, at}` + in-flight guard, `GET /x/people/glance` through `ApiRequest` (copy `getActiveChannels`'s shape), TTL `GLANCE_TTL_MS`. Treat `unconfigured` silently (badge-less operation on a fresh install).
3. `applyPersonChips(article)`: called from `scan` next to `applyBand`. Resolve handle via `findPermalink(article)` (lowercased); look up the map; find the header row = `article.querySelector('[data-testid="User-Name"]')?.parentElement` (verify live; must be the flex row that also holds the timestamp). Upsert one `span.stratus-person-chips` per article (query-existing-else-create, same recycled-node discipline as the old badge; stamp `data-handle` and skip re-render when handle and chip signature unchanged). Render `buildPersonChips(...)` as `<button>` elements (they'll get click handlers in Task 6; until then `title` tooltip only, no-op click).
4. Styles in `injectStyles`: `.stratus-person-chips` inline-flex gap 4px, `margin-left: 4px`, `flex-shrink: 0`; chips 10–11px pill, `1px` rgba borders, tones: ally `rgb(0,186,124)`, mutual `rgb(29,155,240)`, responded/warn `rgb(214,150,0)`, engaged `rgb(113,118,123)`, target `rgb(29,155,240)`, all on transparent/rgba(…,0.10) backgrounds so light/dim/dark themes all work (existing pill rules are the exemplar). Must not wrap the header line: `overflow: hidden` on the span, cap at 4 chips.

**Tests:** none new in content.ts (untested by convention); Task 2's suite covers logic. Manual browser check is the gate.

**Done when:**
- [ ] Live x.com: pill gone, borders/dim intact, Radar queue in the panel still fills while scrolling
- [ ] A known engaged+ person shows correct chips on their timeline tweets; unknown handles show nothing; chips don't duplicate after heavy scrolling (node recycling)
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green (unused-import lint will catch leftovers)
- [ ] Committed: `feat(extension): timeline person chips replace band stats pill`

**Cost note:** $0 — one glance GET per 10 min per tab.

---

## Task 4: `shared/tweetContext.ts` — context-panel view-model  [parallel-ok]
**Depends on:** none (dossier route exists; can run alongside Tasks 1–3)
**Session budget:** ~350 diff lines, 3 files (module + test + fixture)

**Read first:** codemap §3.4 (people.ts dossier), §7.19; `src/x/routes/people.ts:201-336` (the exact dossier JSON — field names come from here), `src/x/people/relationship.ts` (only `MIN_MEASURED_FOR_ANGLE_PREFERENCE` + how `pickAnglePreference` ranks: median profile visits, views tie-break), `src/x/people/angles.ts` (crosstab cell shape), `extension/src/shared/earlyReplies.test.ts` (fixture-testing style).

**Edit:**
- `extension/src/shared/tweetContext.ts` — new module: dossier response types (only the fields consumed) + `buildTweetContextModel(dossier, tweetId, nowMs)`.
- `extension/src/shared/tweetContext.test.ts` — suite over a hand-built dossier fixture object (JSON literal in the test, not happy-dom).

**How:** The model: `{ header: {handle, displayName, stage, sinceDays, followersCount, momentumPerDay|null, tags[]}, relationship: {inbound, outbound, lastInboundAt|null, lastOutboundAt|null} , alreadyReplied: {postedTweetId, ageMin}|null, openLoops: {tweetId, text, ageDays}[], outcomes: {text, views|null, profileVisits|null, angle|null, postedAt}[] (≤3, newest first, measured only), anglePreference: {angle, measured}|null, notes: string|null }`. Derivations: inbound/outbound counts from `events` by type (`their_mention`/`their_reply_to_me` vs `my_reply` — same sets as the people list route); momentum = followers/day between first and last `followerSeries` points, span clamped ≥1 day (mirror `authorMomentum`'s clamp), null with <2 points; `alreadyReplied` from `replies.outcomes` matching `sourceTweetId === tweetId`; angle preference from the dossier `angles` crosstab — pick the angle with the highest median profileVisits (views tie-break) **only if its measured n ≥ 3**, else null; open loops from dossier `mentions` filtered `status === 'unanswered'`. Everything null-safe — a hover-only person has no voiceAuthor, no snapshots, no replies. Keep the module dependency-free (IIFE inlining).

**Tests:** rich-fixture happy path (every section populated, exact numbers); thin person (only a people row → header + empty sections, no crash); angle gate (2 measured → null, 3 → set); alreadyReplied hit and miss; momentum single-point → null; unanswered-vs-answered mention filtering.

**Done when:**
- [ ] Fixture suite covers the cases above
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(extension): tweet-page context view-model`

**Cost note:** $0.

---

## Task 5: Status-page context panel + kill the legacy floating button
**Depends on:** Tasks 3, 4 (both edit content.ts; 3 lands first)
**Session budget:** ~380 diff lines, 1 file (content.ts) + doc note

**Read first:** codemap §5, §7.24–27; `extension/src/content.ts` post-Task-3 — `focusedTweetIdFromUrl`, `attachReplyMasterButton` (the focused-article detection exemplar), `injectStyles`, `scan`; `extension/src/shared/tweetContext.ts` (Task 4); image 2 in the feature request (target look).

**Edit:**
- `extension/src/content.ts` — legacy-button kill rule, dossier fetch/cache, panel render.

**How:**
1. **Legacy button kill:** add `#reply-master-btn { display: none !important; }` to `injectStyles` with a why-comment: the button belongs to the retired standalone "Reply Master" extension (`~/newme/clipx/reply-master`) — the real fix is uninstalling it in `chrome://extensions` (remind the user at ship time); this rule only guarantees it stays gone if that extension is ever re-enabled.
2. **Dossier cache:** module-level `Map<handle, {dossier|null, at}>` (null = 404/unknown), TTL 5 min, fetched via `ApiRequest` `GET /x/people/{handle}`; `unconfigured` → render nothing.
3. **Panel:** in `scan`, when `focusedTweetIdFromUrl()` matches an article's permalink (the same condition `attachReplyMasterButton` uses), upsert `div.stratus-context-panel` after the article's action-row group (insert into the article's parent flow so X's virtualisation doesn't clone it; keyed `data-tweet-id`, re-render only on handle/tweet change). Render from `buildTweetContextModel`: header row (stage chip reusing Task 3 chip styles + "in your circles · Nd" + followers/momentum + tag chips), then compact rows per section, each hidden when empty; notes in a muted block; unknown person → one muted line `No stratus file on @handle`. Collapse toggle in the header; state in `chrome.storage.local['augment:contextCollapsed']` (read once at start, write on toggle).
4. **Styles:** native-feel — `border-top: 1px solid rgba(113,118,123,0.25)`, system font stack already used by the buttons, 13px primary / 11px secondary text in `rgb(113,118,123)` tones, values in the default text color via `color: inherit` on a container that sits inside X's text-colored region; paddings 12px 16px matching X's cell rhythm. Verify against light + dim + dark.

**Tests:** logic is all in Task 4's suite; this task is DOM plumbing. Manual browser gate below.

**Done when:**
- [ ] On a known person's tweet page: panel renders all populated sections, collapses/expands, survives SPA navigation between status pages (stale panel from the previous tweet never lingers — re-key check)
- [ ] The purple `#reply-master-btn` circle no longer renders (kill rule verified with the legacy extension enabled, then the extension removed); the current stratus Reply Master pill unaffected
- [ ] Unknown author → single muted line; no dossier fetch loop (404 cached)
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(extension): stratus context panel on tweet pages; kill legacy reply-master button`

**Cost note:** $0 — one dossier GET per author per 5 min.

---

## Task 6: Chip/panel click-through to the dossier
**Depends on:** Tasks 3, 5
**Session budget:** ~180 diff lines, 4 files

**Read first:** codemap §5 (§7.24 single-writer); `extension/src/shared/messages.ts` (message type + guard conventions), `extension/src/background.ts:513-523` (the notification-click `sidePanel.open` exemplar + gesture caveat) and 525–613 (onMessage dispatch), `extension/src/sidepanel/App.tsx:47-75` (`openPerson`).

**Edit:**
- `extension/src/shared/messages.ts` — `OpenPerson {type:'stratus/open-person', handle}` + `OpenPersonClear` + guards.
- `extension/src/background.ts` — handle both: on open-person, `chrome.sidePanel.open({tabId: sender.tab?.id})` inside a `.catch` (gesture may not carry — best-effort, same comment style as the notification handler), then write `chrome.storage.session['stratus:openPerson'] = {handle, at}` through a small enqueue (background stays the single session writer); on clear, remove the key.
- `extension/src/sidepanel/App.tsx` — on mount + `chrome.storage.onChanged` (session area): read `stratus:openPerson`, call `openPerson(handle)`, send the clear message.
- `extension/src/content.ts` — chip buttons (Task 3) and the panel header (Task 5) send `OpenPerson` on click (preventDefault/stopPropagation so X doesn't navigate).

**How:** Follow the radar message pattern exactly (typed interface, `isX` guard, `return true` for async sendResponse). The session key is a handoff cell, not state — App clears it immediately after routing so a later panel open doesn't replay it.

**Tests:** guards in a small `messages`-adjacent test only if one exists for other guards (there isn't — skip; guards are trivially typed). Manual gate: click chip with panel closed → panel opens on dossier; with panel already open → tab switches to the person.

**Done when:**
- [ ] Both click paths land on the right dossier; replayed opens don't occur
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(extension): open dossier from timeline chips and context panel`

**Cost note:** $0.

---

## Task 7 (final): docs-sync + smoke
**Depends on:** all prior.

- [ ] `scripts/smoke-glance.ts` exists from Task 1 — re-run it against the real DB as part of this task's verification.
- [ ] CLAUDE.md: one phase-style entry — **"Surfaces S5 — Augmented X UI (…, $0)"**: stats pill removed (border kept, radar unaffected), glance endpoint + chips, context panel + Grok-button hide, dossier click-through; note the live-selector risks.
- [ ] SURFACES-PLAN.md: S5 section appended with status.
- [ ] `docs/` — new `docs/s5-augmented-ui.md` (what renders where, the chip legend, the collapse key, the hidden-button selector); no tab doc changes except a one-line App.tsx handoff note in the People tab doc if it exists.
- [ ] `.claude/skills/plan-feature/references/codemap.md`: §3.4 (glance route), §5 (content.ts surfaces, new shared modules, new messages, new storage keys `stratus:openPerson`/`augment:contextCollapsed`), §11 update log + header re-stamp.

## Out of scope (do NOT build)

- Editing notes, answering mentions, or drafting replies from the context panel — the side panel owns those flows; the panel is read-only + one navigation affordance.
- Any change to `rankmap`, `stampTiers`, radar ranking, or the band classifier/border thresholds.
- Chips on quote-tweet previews or hover cards; decorating the notifications page beyond what the document-wide scan already does naturally.
- A "start their file" button on unknown authors (exists in the People tab).
- Server-side rendering of chip decisions (keep the view-model client-side; the server ships facts).
- Persisting glance/dossier caches across page loads.

## Risks / watch items

- **X DOM drift (one live verification required at implementation):** the User-Name header row insertion point — must be the flex row holding name/handle/timestamp, confirmed on timeline, status page, and replies.
- **Legacy "Reply Master" extension** — the floating button's source is confirmed (`~/newme/clipx/reply-master/extension`, loaded unpacked). Uninstalling it is a user action outside this repo; until then only the kill rule hides its button, and its other behaviors (its own API calls/shortcuts) remain active. Remind the user at Task 5 ship time.
- **Gesture propagation for `sidePanel.open` from a content-script message** — works on current Chrome (≥116) but is best-effort by API contract; if Chrome refuses, the click degrades to writing the handoff key (panel routes next time it opens). Acceptable.
- **Glance map growth** — C6 hover capture grows `people` unboundedly; the map is all non-retired rows. At a few thousand entries it's still a ~200KB JSON every 10 min per tab — fine for one user, but add a `stage`/`hasSignal` filter server-side if it ever gets heavy.
- **Dossier payload on every status view** — up to 500 events + 200 replies per fetch; cached 5 min. Watch, don't pre-optimize.
- **Codemap** was verified fresh at `2a7693e` (no commits since stamp).
