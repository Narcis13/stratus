# Thread harvest — capture a whole conversation, then chat with it

- **Status:** planned 2026-08-14 · not started
- **Goal fit:** Goal 3 (voice library — stash other people's tweets via $0 DOM scrape). A full thread with per-reply metrics is the highest-signal corpus this account can collect for "what actually earns replies in my niche", and it lands through the same $0 DOM path the voice library already uses. Secondary: goal 2 when the thread is my own (root + every reply, with metrics, free).
- **Cost impact:** **$0.** Nothing on any path in this feature can reach `xFetch` or `askLLM` — capture is DOM scrape, ingest is SQL, both reads are SQL, both MCP tools are in-process `app.request` over those reads. No recurring line, no per-click line.
- **Invariants touched:** #4 (one place to call X — this feature adds no X call at all, and the header of every new route says so), #8 (the only billed X call is `createPost` — untouched; this is the $0 harvest half the invariant points at as the *better* source). §7.11 (`null` = unknown — `root_tweet_id` is null on every non-thread run), §7.12 (no derived-state table — `isAuthor`, completeness and capture history are all read-time), §7.16 (server-stamped fields — the client sends a root and a list; the *pairing* and the ordering are the server's), §7.20 (static path before `:param` — this is the harvest router's **first** `:param` route, so the codemap's "keep it that way" note becomes a live trap), §7.24 / §7.26 / §7.27 (extension: background is the only transport, content script is an IIFE, shared pure logic gets its own bun-tested module), §7.28 (nothing posts).
- **Codemap sections relevant:** §3.3 (`routes/harvest.ts` row), §4 (`harvestRuns`/`harvestRows`), §5 (`content.ts`, `harvester.ts`, `shared/`, `Harvest.tsx`, storage keys), §6 (MCP, 23 tools), §7.11/7.12/7.16/7.20/7.24/7.26/7.27, §7 "Ambient ingest = free-text discriminator", §9 (harvest route suite, smoke scripts), §10 (recipes).

**Codemap staleness note for the docs-sync task:** §3.1's `src/db/migrations/` row and §4's line still say *"the next migration owns `0027`"*. That is superseded by the RC.10 delta lower in §4 and by `meta/_journal.json`, whose head is idx 27 = `0027_bizarre_the_captain`. **The next migration owns `0028`.** Fix both headline sentences in the same commit.

## Why / what changes for the user

You open a thread on x.com in a tab. A new 🧵 button sits in the on-page action cluster of the thread's root tweet (beside save / ⊕ / Reply Master / Canned). One click scrolls the conversation, clicks through "Show more replies", and saves the root plus every top-level reply — text, author, timestamp, replies/reposts/likes/bookmarks/views, media flags — into the database as one capture. The side panel does not need to be open; the button counts up in place and settles on "Saved 143". Afterwards `x_thread` over MCP hands Claude the whole transcript with metrics, so you can ask "which reply in this thread out-earned the root, and why" against real numbers. Capturing the same thread again on a later day adds a second capture instead of overwriting the first — the same longitudinal contract `harvest_rows` has always had.

## Design

### Data — one nullable column, no new table

Thread rows reuse `harvest_runs` + `harvest_rows` behind a free-text `mode = 'thread'`, which is the **ambient-ingest pattern** HV.1 established (§7, "free-text discriminator + server-owned parent row"). This is safe **by verification, not by hope**: every existing `harvest_rows` consumer names its modes explicitly —

| Consumer | Filter |
|---|---|
| `routes/playbook.ts::loadTimelineFunnel` | `mode = PASSIVE_HARVEST_MODE` (`'timeline'`) |
| `routes/playbook.ts::loadOwnReplies` | `mode = OWN_REPLY_HARVEST_MODE` (`'replies'`) + `handle = self` |
| `routes/cannon.ts` (both loaders) | `inArray(mode, POST_MODES)` where `POST_MODES = ['posts','timeline']` |
| `routes/harvest.ts::GET /harvest/affinity` | `mode = 'timeline'` |
| `scripts/backfill-people.ts` | `mode = 'replies'` |

`'thread'` is invisible to all five. That isolation is asserted by the smoke script, not assumed.

One migration (**`0028`**):

```sql
ALTER TABLE `harvest_runs` ADD `root_tweet_id` text;
CREATE INDEX `harvest_runs_root_idx` ON `harvest_runs` (`root_tweet_id`,`created_at`);
```

Nullable, null on every existing row and on every posts/replies/timeline/following run. It is the thread's identity — the alternative (overloading `scope` with the id) would have to punch a hole in the `SCOPES` whitelist and would make "list captures of this thread" a string-shaped query.

Row semantics under `mode='thread'`:

- **Root row** — `tweetId` = root id, `handle` = root author, `groupPosition = 0`, `orig*` all null.
- **Reply rows** — `groupPosition` = 1-based render order (1 = first reply under the root), and `orig*` = **the root** (`origTweetId`/`origHandle`/`origText`/`origTime`/`origComments`/`origLikes`/`origViews`), so a single row read is self-describing. Same shape replies-mode already uses; only the meaning of "the tweet replied to" widens from immediate parent to thread root, which is the only parent the DOM states reliably.
- **`matchedDraftId` stays null.** Thread mode does **not** run the `reply_drafts` reconcile. OH.2 measured 0 of the first 98 harvested replies matching a draft row, and widening a reconcile into a new mode buys a rounding error for real blast radius.
- **No person events.** HV.1 decision 6, restated: reading a thread is exposure, not interaction.
- **No retention prune.** The lazy prune is scoped `mode='timeline'`; a hand-clicked capture is the user's and is kept.

**Completeness is answered at read time, for free.** The transcript returns X's own `comments` count on the root beside the `replyCount` actually stored. Those two numbers side by side are a better completeness signal than a client-asserted `complete` boolean would be (X's counter includes nested and deleted replies, so equality was never the target) and they cost no column.

### Ingest route — one atomic call

```
POST /x/harvest/thread
{ root: HarvestIngestRow, replies: HarvestIngestRow[] }
→ 201 { runId, rootTweetId, inserted, replies, skippedDuplicate }
```

One call, not the `runs` + `rows` two-step: a root and its replies are meaningless apart, and the client has all of them in hand when the scroll ends. Errors, all pre-DB (§7.4 ordering held even though nothing here is billed): `invalid_body`, `invalid_root` + the `parseIngestRow` code, indexed `{ error: 'invalid_row_*', index }` for replies (the `POST /harvest/rows` shape), `too_many_rows` + `max`.

The server owns three things the client does not get to assert (§7.16): `groupPosition` (root 0, replies 1..N in array order — order is the one structural fact and the array already carries it), each reply's `orig` (stamped from the parsed root, any client `orig` ignored), and the run row `{ handle: root.handle, mode: 'thread', scope: 'all', rootTweetId, rowCount }`. **`MODES` in `POST /harvest/runs` stays `['posts','replies']`** — a thread run is server-created only, exactly like a passive run (HV.1 decision 7), so no client can forge one through the generic route.

Re-capture creates a **new run and new rows**, deliberately un-deduped: that is `harvest_rows`' longitudinal contract, and unlike the ambient tap a thread capture is one deliberate human click, so no recapture gate applies.

### Read routes

```
GET /x/harvest/threads?limit=            → { threads: ThreadSummary[] }
GET /x/harvest/threads/:rootTweetId[?runId=] → ThreadDetail
```

`ThreadSummary = { rootTweetId, rootHandle, rootText, rootViews, rootComments, replyCount, capturedAt, runId, captures }` — one entry per root (its **latest** capture), newest first, `captures` = how many times that thread has been captured.

`ThreadDetail = { rootTweetId, runId, capturedAt, captures: [{runId, capturedAt, rowCount}], root: ThreadPost, replies: ThreadPost[] }` with `ThreadPost = { tweetId, handle, text, comments, reposts, likes, bookmarks, views, tweetTime, position, isAuthor, hasPhoto, hasVideo, isQuote }`. `isAuthor` (= the root author's own self-thread continuation) is derived at read time from the handle, never stored (§7.12). `?runId=` picks a specific capture; absent = latest. `400 invalid_root_tweet_id` on a non-numeric id, `404 thread_not_found`, `404 capture_not_found`.

**§7.20 trap:** `/harvest/threads` must be registered immediately **before** `/harvest/threads/:rootTweetId`, in that order, in the same file. This is the harvest router's first `:param` route.

### MCP — 23 → 25 curated tools

`x_threads` (list, optional `limit`) and `x_thread` (`rootTweetId`, optional `runId`), both `route('/x/harvest/threads…')`, both $0. Bumps `src/mcp.test.ts`'s exact `expect(names.size).toBe(23)` and `docs/s2-mcp-server.md`'s three counts in the same commit (§10).

### Extension

1. **`extension/src/shared/thread.ts` (NEW, pure, bun-tested)** — the wire types + `threadRootIdFromUrl`, `extractedToIngestRow`, `dedupeThreadReplies`, `MAX_THREAD_REPLIES`. IIFE-safe by contract: its only imports are `type HarvestIngestRow` from `./harvest.ts` and `type Extracted` from `../harvester.ts`, both erased under `verbatimModuleSyntax` (§7.26).
2. **`extension/src/harvester.ts`** — a new exported `captureThread(onProgress)`: takes the module `running` flag (so passive capture suspends via `isHarvestActive()` and a hand-run harvest refuses with `already_running`), scrolls the conversation reusing `PRESETS`/`humanScroll`/`gauss`/`revealOriginals`/`extractArticle`, clicks "Show more replies" structurally, ships one `POST /x/harvest/thread` through `apiSend`.
3. **`extension/src/content.ts`** — `attachThreadCaptureButton(article, focusedId)` on the focused article of a `/status/` page: `makeActButton` + `svgIcon(ICON_THREAD)` into `actionCluster`, `ACT_ORDER.thread = 5`, own WeakSet, label counts up during the run and settles per the RS.5 pattern.
4. **Panel** — `api.harvest.threads`/`.thread`, the three types in `shared/types.ts`, and a read-only `<Section title="Captured threads">` in `Harvest.tsx`.

### Measurement

**No new Playbook cell, deliberately.** This feature builds a corpus; it does not claim an effect, so there is nothing to gate at n≥20 and inventing a cell would be a number without a question. The observable checks are the smoke script's round trip, the Harvest tab's capture list, and the transcript's `comments`-vs-`replyCount` completeness pair.

## Decisions taken

1. **Trigger = on-page button on the root tweet** (user's answer). Not a Harvest-tab mode: the panel would have to be open, and the stated flow is "open a thread in a new tab and it saves". The Harvest tab keeps its port-driven engine untouched.
2. **Depth = scroll + top-level "Show more replies"** (user's answer). Nested "Show replies" expanders and the "probable spam" section are out: the DOM cannot state a reply's immediate parent reliably anyway, so paying a lot of clicking for a relationship we would still have to guess is a bad trade.
3. **Read side = MCP tools + a list section in the Harvest tab** (user's answer). A full in-panel transcript reader is out — the stated use is chatting via MCP.
4. **Reuse `harvest_rows` behind `mode='thread'`, do not fork a table.** Verified against all five existing consumers (table above); the isolation is asserted in the smoke script.
5. **One nullable `harvest_runs.root_tweet_id` rather than overloading `scope`.** `scope` is gated by a whitelist that `POST /harvest/runs` enforces; punching an id-shaped hole in it to save a two-line migration would make the forged-run guard weaker for nothing.
6. **One atomic `POST /harvest/thread`, capped, rather than chunked runs+rows.** Root and replies are one unit; the cap makes the payload bounded.
7. **No reply-draft reconcile and no person events in thread mode.** Rationale in Design; both are one-line temptations that widen blast radius for measured-near-zero return.
8. **Completeness reported, not stored** (`comments` vs `replyCount`), so a partial capture can never read as complete and no column carries a claim that would go stale.
9. **Re-capture appends.** Same longitudinal contract as every other `harvest_rows` writer; `?runId=` is how you read an older capture.

## Done when

1. On `x.com/<handle>/status/<id>`, one click on the 🧵 button captures the root plus every top-level reply with full metrics and settles on "Saved N" — **with the side panel closed**.
2. `GET /x/harvest/threads` lists that capture and `GET /x/harvest/threads/<rootTweetId>` returns the root + replies in render order, each with its metrics, `position`, and `isAuthor`.
3. From Claude Code over MCP, `x_thread` returns that same transcript (tool count 25, `src/mcp.test.ts` green).
4. Capturing the same thread a second time yields `captures: 2`, the list still shows one entry (the latest), and `?runId=<first>` still returns the first capture's metrics.
5. `bun scripts/smoke-thread-harvest.ts` is green, $0, no `--live` flag, and asserts thread rows are invisible to the cannon roster and to `GET /x/harvest/affinity`.
6. Feature-wide spend: **$0** — no path reaches `xFetch` or `askLLM`.

---

## Task 1: schema + the thread ingest route
**Depends on:** none
**Session budget:** ~300 lines, 5 files (2 of them drizzle-generated)

**Read first:**
- `.claude/skills/plan-feature/references/codemap.md` header + §4 (`harvestRuns`/`harvestRows` row) + §7 "Ambient ingest" bullet
- `src/x/routes/harvest.ts` **in full** — you are extending it; `POST /harvest/passive` (L249–354) is the exemplar for a server-created run, `parseIngestRow` (L545–646) is the validator you reuse verbatim, `POST /harvest/rows` (L101–247) is the batch/error shape to imitate
- `src/x/db/schema.ts` L649–716 (`harvestRuns` + `harvestRows`)
- `src/x/routes/harvest.test.ts` L1–60 (bare-Hono over the shared in-memory DB)
- CLAUDE.md "Stack" bullet on `db:generate` (drizzle-kit drops seed INSERTs)

**Edit:**
- `src/x/db/schema.ts` — `harvestRuns` gains `rootTweetId: text('root_tweet_id')` (nullable) + `index('harvest_runs_root_idx').on(t.rootTweetId, t.createdAt)`; `harvestRuns` currently has no index array, so add the `(t) => [...]` argument.
- `src/db/migrations/0028_*.sql` + `meta/` — generated, then **inspected**.
- `src/x/routes/harvest.ts` — new `POST /harvest/thread` + its constants; extend the file header's route list.
- `src/x/routes/harvest.test.ts` — new `describe('thread ingest')`.

**How:**
- Constants beside the passive block, each with a one-line *why*: `THREAD_MODE = 'thread'`, `THREAD_SCOPE = 'all'` (a thread has no date axis; staying inside `SCOPES` means nothing else changes), `MAX_THREAD_ROWS = 500` (root + ≤499 replies — same ceiling as `MAX_ROWS_PER_BATCH`; an opening guess).
- **Do not touch `MODES`.** A thread run is server-created only, the HV.1 decision-7 rule; `POST /harvest/runs` must keep rejecting `'thread'`, and a test asserts it.
- Validation order, all before any write: body object → `root` present → `parseIngestRow(root)` (on error return `{ error: 'invalid_root', reason: <code> }`, 400) → `replies` is an array (empty **allowed** — a thread with no replies yet is a legitimate capture) → `1 + replies.length > MAX_THREAD_ROWS` → 400 `too_many_rows` → per-reply `parseIngestRow` returning `{ error, index }` on the first failure.
- Dedupe after parsing, before the write: first-wins by `tweetId`, and drop any reply whose `tweetId === root.tweetId`; count both into `skippedDuplicate` (the passive route's `skippedRecent` honesty).
- One sync `db.transaction` (§7.13 — no `await` inside): insert the run with `rowCount` already final, then one multi-row `harvestRows` insert. Root row gets `groupPosition: 0` and null `orig*`; reply `k` gets `groupPosition: k+1` and `orig*` from the **parsed root** (`origTweetId`/`origHandle`/`origText`/`origTime` = root's `tweetTime`, `origComments`/`origLikes`/`origViews` = root's counts). Ignore any client-supplied `orig` and any client `groupPosition` on either side.
- `capturedAt` = one `new Date()` taken once for the whole call, matching the passive route.
- No `safeLogPersonEvents` call, no reply-draft reconcile — add a comment saying both are deliberate, with the OH.2 zero-match number.

**Tests** (`src/x/routes/harvest.test.ts`, new describe):
- Happy path: root + 3 replies → 201, `inserted: 4`; then assert straight over the DB that `harvest_runs.rootTweetId` is set, `mode='thread'`, `rowCount=4`, the root row has `groupPosition=0` and null `origTweetId`, and reply rows carry `groupPosition` 1/2/3 with `origTweetId` = the root.
- Client-supplied `groupPosition` and `orig` on a reply are **overwritten**, not honoured.
- Duplicate reply id, and a reply whose id equals the root's → both counted in `skippedDuplicate`, neither inserted.
- Empty `replies: []` → 201, `inserted: 1`.
- 500 replies → 400 `too_many_rows` with `max`; 400 `invalid_root` on a bad root; indexed `invalid_row_tweet_id` at reply index 2.
- `POST /harvest/runs` with `mode:'thread'` still 400s `invalid_mode`.
- Existing passive/affinity tests must stay green untouched — that is the isolation proof at unit level.

**Done when:**
- [ ] A `POST /x/harvest/thread` writes exactly one run and `1 + n` rows, all `mode='thread'`
- [ ] Generated SQL inspected: it is the `ALTER TABLE` + `CREATE INDEX` above and nothing else (no dropped seed INSERT)
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(harvest): TH.1 thread ingest — root_tweet_id + POST /harvest/thread`

**Cost note:** $0. Nothing in this file may import `xFetch` or `askLLM`; say so in the route's comment block, as `routes/cannon.ts` does.

---

## Task 2: the read layer + two MCP tools
**Depends on:** Task 1
**Session budget:** ~350 lines, 5 files

**Read first:**
- `src/x/routes/harvest.ts` — Task 1's route, plus `GET /harvest/affinity` (L374–470) for the house idiom: group in SQL, join in TS off the ≤limit set, `intParam` for query params
- `src/x/mcp.ts` L47–82 (`callRoute`/`route`/`qp`) and L176–196 (`x_playbook`, a curated tool with one optional int param)
- `src/mcp.test.ts` around L112 (the exact tool-count assertion)
- Codemap §7.20 (static path before `:param`)

**Edit:**
- `src/x/routes/harvest.ts` — `GET /harvest/threads` then `GET /harvest/threads/:rootTweetId`, in that order, adjacent; exported `ThreadSummary`/`ThreadPost`/`ThreadDetail` interfaces; extend the header route list.
- `src/x/routes/harvest.test.ts` — new `describe('thread reads')`.
- `src/x/mcp.ts` — `x_threads` + `x_thread` beside `x_search_voice`.
- `src/mcp.test.ts` — `23` → `25`.

**How:**
- **Registration order is the trap.** `/harvest/threads` before `/harvest/threads/:rootTweetId`, with a comment naming §7.20 and the fact that this is the router's first param route.
- List: select thread runs (`mode='thread'`) newest-first with a bounded `.limit(MAX_THREAD_RUN_SCAN = 500)` — comment why the scan is bounded rather than unbounded — then in TS group by `rootTweetId` keeping the newest run and counting captures, take `limit` (via `intParam`, default 20 / max 100, the `GET /harvest/runs` rule), then ONE `inArray` select of the `groupPosition = 0` rows for the surviving runIds. Early-return `{ threads: [] }` when the scan is empty (never build an `in ()`).
- Detail: validate `:rootTweetId` against the file's `TWEET_ID_RE` → 400 `invalid_root_tweet_id`. Load every thread run for that root, newest first → empty ⇒ 404 `thread_not_found`. `?runId=` must be a UUID (`UUID_RE`) and must be in that set ⇒ else 404 `capture_not_found`; absent ⇒ newest. One select of that run's rows ordered by `groupPosition` asc. Split root (`groupPosition = 0`) from replies; a run with no `groupPosition = 0` row is impossible by Task 1's transaction, but return 404 `thread_not_found` rather than throwing if it ever happens.
- `isAuthor` = `row.handle === root.handle` (both already lowercased at ingest). `capturedAt` = the **run's** `createdAt`, one timestamp for the capture. `captures` lists every run for the root, newest first, with its `rowCount`.
- MCP descriptions carry the two things a model needs to use them well: that the corpus is DOM-scraped and free, and that `replyCount` vs the root's `comments` is the completeness signal. `x_thread`'s `rootTweetId` is a `z.string()` (ids exceed `Number.MAX_SAFE_INTEGER`) — never a number.

**Tests:**
- Two captures of one root + one capture of a second root → list returns 2 entries, the first with `captures: 2` and the **latest** `capturedAt`/`rootViews`.
- Detail default = latest; `?runId=<first>` returns the first capture's metrics (the longitudinal read).
- `replies` ordered by `position`, `isAuthor` true only on the root author's own reply.
- 400 `invalid_root_tweet_id` (`abc`), 404 `thread_not_found` (unknown id), 404 `capture_not_found` (valid UUID that belongs to another thread).
- `limit` clamped, non-integer → 400.
- Empty DB → `{ threads: [] }`, no throw.

**Done when:**
- [ ] Both routes answer correctly and the static route is registered first
- [ ] MCP exposes 25 tools; `x_thread` round-trips a transcript in `src/mcp.test.ts`
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(harvest): TH.2 thread read layer + x_threads/x_thread MCP tools`

**Cost note:** $0. Both reads are local SQL; both tools are in-process `app.request`.

---

## Task 3: the extension's pure thread core  [parallel-ok with Task 2]
**Depends on:** Task 1 (the wire shape)
**Session budget:** ~230 lines, 2 files (1 new + 1 new test)

**Read first:**
- `extension/src/shared/harvest.ts` L50–100 (`HarvestIngestRow`, `HarvestIngestOrig`) and L274–300 (`pathnameOf`, `profileHandleFromUrl` — the reserved-handle discipline)
- `extension/src/harvester.ts` L119–208 (`MetricSet`, `Extracted`, `extractArticle`) and L591–608 (`postsIngestRows` — the existing `Extracted`→wire mapping, which you are **not** refactoring)
- `extension/src/shared/harvest.test.ts` L1–40 (the suite's shape)
- Codemap §5 opening paragraph (IIFE + shim rules) and §7.26

**Edit:**
- `extension/src/shared/thread.ts` (NEW)
- `extension/src/shared/thread.test.ts` (NEW)

**How:**
- Header comment states the IIFE contract explicitly: this module is inlined into `content.js`, so its **only** imports are `type HarvestIngestRow` from `./harvest.ts` and `type Extracted` from `../harvester.ts`, both erased under `verbatimModuleSyntax`. No value import, ever.
- `threadRootIdFromUrl(url): string | null` — reuse the `pathnameOf` shape from `shared/harvest.ts` (duplicate the three-line helper rather than exporting a new value from that module if it keeps this file import-free; say which you chose and why in a comment). Matches `/<handle>/status/<digits>` with the same `[A-Za-z0-9_]{1,15}` handle rule; trailing segments (`/photo/1`, `/analytics`) still resolve to the id; anything else → null.
- `extractedToIngestRow(e: Extracted): HarvestIngestRow | null` — null when `e.id` or `e.handle` is missing (an ad, a promoted cell, or an unparseable article filters itself, the `recordPassiveHarvest` rule). Otherwise the `postsIngestRows` field mapping: `time: e.time || null`, `textLen: e.text.length`, the three media flags, `lineBreaks`. **Do not refactor `postsIngestRows` to call this** — the shipped harvest path stays byte-untouched.
- `dedupeThreadReplies(rows, rootTweetId)` — first-wins by `tweetId`, drops any row equal to the root; returns the kept array. The server dedupes too; this one keeps the on-page counter honest.
- `MAX_THREAD_REPLIES = 400` with the number's provenance in a comment: an opening guess that keeps the payload one call under the server's 500-row ceiling; recalibrate only after real captures, never by vibes.

**Tests** (`extension/src/shared/thread.test.ts`):
- `threadRootIdFromUrl`: bare status URL, with `/photo/1`, with a query string, a bare pathname, a profile URL → null, `/i/status/123` → null (reserved), a 20-digit id, an empty string.
- `extractedToIngestRow`: full round-trip; `id: null` → null; `handle: null` → null; empty `text` survives (image-only tweets are legal, matching the server's `parseIngestRow`); `time: ''` → `null`; `textLen` counted off the collapsed text.
- `dedupeThreadReplies`: duplicate ids collapse first-wins, the root id is dropped wherever it appears, order otherwise preserved, empty input.

**Done when:**
- [ ] The module has zero value imports (grep the file: only `import type`)
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green, `cd extension && bun run build` green
- [ ] Committed: `feat(extension): TH.3 pure thread-capture core`

**Cost note:** $0.

---

## Task 4: the capture engine
**Depends on:** Task 3
**Session budget:** ~280 lines, 1–2 files

**Read first:**
- `extension/src/harvester.ts` **in full** — you are adding a sibling to `runHarvest`: `PRESETS`/`Pacing` (L52–116), `extractArticle` (L177–208), `revealOriginals` (L210–227), `groupsOfArticles` (L229–244), `runHarvest`'s scroll loop (L779–911, the stable-height/`atBottom` idiom you are imitating), `apiSend` (L639–645), the `running` flag + `isHarvestActive` (L914–920)
- `extension/src/shared/thread.ts` (Task 3)
- `extension/src/shared/translation.ts` — how a **localized** X control is identified structurally rather than by its text; this is the model for the "Show more replies" finder
- Codemap §5 `src/harvester.ts` row (TR.1 un-translation, the per-sweep rule)

**Edit:**
- `extension/src/harvester.ts` — exported `captureThread`, its constants, and the pagination helper.
- `extension/src/shared/thread.ts` — only if the result type belongs there (it does: `ThreadCaptureResult`).

**How:**
- Signature: `export async function captureThread(onProgress: (replies: number) => void): Promise<ThreadCaptureResult>` where the result is `{ ok: true; rootTweetId: string; inserted: number; replies: number; truncated: boolean } | { ok: false; code: string }`.
- **Take the `running` flag** at entry (`if (running) return { ok:false, code:'already_running' }`, then `running = true`, released in a `finally`). This is what makes passive capture (`isHarvestActive()`) suspend during the sweep — the same contract a hand-run harvest has.
- Resolve the root from `threadRootIdFromUrl(location.href)`; null → `{ ok:false, code:'not_a_thread' }`.
- Store: `Map<tweetId, { row: HarvestIngestRow; order: number }>` with `order` assigned at **first sighting** from a monotonic counter (the `harvestFollowing` list-position rule — X virtualizes, so first-seen order under a top-down scroll *is* render order, and a recycled article must not renumber). Re-sighting **overwrites the row** (fresher metrics, and TR.1's un-translation may have landed) but never the order.
- Sweep = `revealOriginals()` (per sweep, not once — TR.1's reason applies verbatim) → every `article[data-testid="tweet"]` → `extractArticle` → `extractedToIngestRow` → skip null → store. The root is the entry whose id matches the URL's; everything else is a reply.
- Scroll loop: imitate `runHarvest`'s shape — `humanScroll`/`readingPause` off `PRESETS.human`, `atBottom` + stable `scrollHeight` × `cfg.stableNeeded` to finish, a local `THREAD_STEP_CAP = 400`, and stop early at `MAX_THREAD_REPLIES`. Call `onProgress(store.size - 1)` whenever the count changes.
- **"Show more replies" is the risky part and must be found structurally.** Its text is localized, so match on shape: inside `[data-testid="cellInnerDiv"]` blocks that contain **no** `article`, find a clickable (`button`, `[role="button"]`) positioned below the last captured article, click **one per sweep**, cap at `MAX_SHOW_MORE_CLICKS = 20`, and treat "article count did not grow across 3 sweeps" as exhausted. Explicitly skip the "probable spam" / "offensive content" section (decision 2). Put the selector reasoning in a comment — this is the line most likely to drift (codemap §5 last gotcha).
- Ship: `dedupeThreadReplies` → sort by `order` → `apiSend('POST', '/x/harvest/thread', { root, replies })`. `unconfigured` → `{ ok:false, code:'unconfigured' }` silently, everything else warn-and-return the code (the `flushPassiveHarvest` rule: a lost capture is a retry, not a thrown page).
- `truncated` = the `MAX_THREAD_REPLIES` or `MAX_SHOW_MORE_CLICKS` ceiling was hit.
- **Nothing here writes the session buffer** (§7.24) and nothing calls the panel — the capture runs entirely inside the content script over `ApiRequest`.

**Tests:** none new in bun (`harvester.ts` is browser-verified by convention, codemap §5 last gotcha — the pure half is Task 3's and is already covered). Say this out loud in the commit body rather than adding a happy-dom fixture for a scroll loop.

**Done when:**
- [ ] `captureThread` is exported and typechecks; `isHarvestActive()` reads true for its duration and the flag is released on every exit path including the error ones
- [ ] The two DOM live-verifications in Risks 1–2 are done **here**, before Task 5 wires a button to it: a short thread with no pagination and a 200+-reply thread, checking that the root row's `views`/`bookmarks` land non-zero. No console hook ships to do it — drive it from a temporary local edit, or defer the check to Task 5's button and say so in the commit body
- [ ] `bun run typecheck` + `bun run lint` + `cd extension && bun run build` green; `bun test` unchanged
- [ ] Committed: `feat(extension): TH.4 thread capture scroll engine`

**Cost note:** $0 — DOM reads and one POST to a local route.

---

## Task 5: the on-page 🧵 button
**Depends on:** Task 4
**Session budget:** ~150 lines, 1 file

**Read first:**
- `extension/src/content.ts` L165–180 (`ACT_ORDER` + the class constants), L310–402 (`svgIcon`, `actionCluster`, `makeActButton`, `setActLabel`), L2217–2258 (`attachCannedButton` — the focused-article guard + WeakSet you are copying), L3086–3160 (`attachRadarAddButton` + `onRadarAddClick` — the optimistic state flip and the RS.5 settle)
- The `scan()` body where `attachCannedButton(article, focusedId)` is called
- `extension/src/harvester.ts::captureThread` (Task 4) — its signature and the full `ThreadCaptureResult` union, since every failure `code` needs a label here
- Codemap §5 `src/content.ts` row (UI.18 action cluster: `setActLabel` never `textContent`; icons via `createElementNS` because x.com enforces Trusted Types)

**Edit:**
- `extension/src/content.ts` only.

**How:**
- `ACT_ORDER` gains `thread: 5`. Add `ICON_THREAD` beside `ICON_LIST` as 24×24 path strings (three stacked rounded rects or a connected-dots motif — keep it in the existing one-stroke style; no `innerHTML`, `svgIcon` builds it with `createElementNS`).
- `attachThreadCaptureButton(article, focusedTweetId)`: identical guard order to `attachCannedButton` — find `[data-testid="reply"]` → `closest('div[role="group"]')` → own `threadCaptureHandled` WeakSet → `findPermalink(article)` must exist **and equal `focusedTweetId`** (the button belongs to the thread's root only, never to a reply's action row) → `makeActButton({ icons:[svgIcon(ICON_THREAD)], tone:'muted', order: ACT_ORDER.thread, title, label, extraClass })` → `actionCluster(actionRow).appendChild(btn)`.
- Click handler: `preventDefault()` + `stopPropagation()` (X must not navigate), guard against a double-click while running via the button's own `data-state`, then `captureThread((n) => setActLabel(btn, \`Capturing… ${n}\`))`. On success `data-state='added'` + `Saved N` (+ ` (partial)` when `truncated`), settling back per the RS.5 timeout pattern; on failure `data-state='error'` + a short human label per code (`already_running` → "Harvest running", `not_a_thread` → "Not a thread", `unconfigured` → silent revert to idle, anything else → "Failed").
- Call it from `scan()` immediately after `attachCannedButton(article, focusedId)`, inside the same focused-article branch.
- **Do not** add a CSS color literal — `data-state` styling reuses the existing `.stratus-act` tones from `OVERLAY_TOKENS` (UI.16: every rule in the sheet is `var()`-only).

**Tests:** none (content.ts is browser-verified by convention). The done-when carries the browser check instead.

**Done when:**
- [ ] On a real thread page the 🧵 button renders **only** on the root tweet's action row, last in the cluster, and never on a reply's
- [ ] One click captures and settles on "Saved N"; the row count matches what `GET /x/harvest/threads` reports, **with the side panel closed**
- [ ] A second click while running does nothing; on a non-thread page the button is absent
- [ ] `bun run typecheck` + `bun run lint` + `cd extension && bun run build` green; `bun test` unchanged
- [ ] Committed: `feat(extension): TH.5 on-page thread capture button`

**Cost note:** $0.

---

## Task 6: Captured-threads list in the Harvest tab  [parallel-ok with Tasks 4–5]
**Depends on:** Task 2
**Session budget:** ~180 lines, 3 files

**Read first:**
- `extension/src/sidepanel/api.ts` L945–971 (the `harvest` client block you are extending)
- `extension/src/shared/types.ts` L736–750 (`HarvestRun`, `TimelineAffinityResponse` — the wire-mirror convention)
- `extension/src/sidepanel/Harvest.tsx` L186–230 (the `passiveRows` fetch effect — the "decoration on someone else's feature stays silent rather than claiming zero" rule) and L430–539 (the tail sections)
- `src/x/routes/harvest.ts` Task 2's exported interfaces (mirror them field for field)
- Codemap §7 "UI primitives (UI.10)" and "Chip taxonomy (UI.14)"

**Edit:**
- `extension/src/shared/types.ts` — `ThreadSummary`, `ThreadPost`, `ThreadDetail`.
- `extension/src/sidepanel/api.ts` — `api.harvest.threads(s, {limit})`, `api.harvest.thread(s, rootTweetId, {runId})`.
- `extension/src/sidepanel/Harvest.tsx` — a `<Section title="Captured threads">`.

**How:**
- Types mirror the route's exports field for field; do not import from `src/` (the panel renders from the GET, never the server's types — the `SettingsResponse` precedent).
- The section renders after the run controls and before the passive status line: one row per thread — root handle, a one-line clamped snippet of `rootText`, `replyCount` replies, relative `capturedAt` via the file's existing `fmtDate`, and a `captures: N` chip only when `N > 1`. Root text links to `https://x.com/<rootHandle>/status/<rootTweetId>` (target `_blank`).
- Fetch with the `passiveRows` effect's exact discipline: an `alive` flag, `.catch(() => setThreads(null))`, **null means "not loaded or failed" and renders nothing** — never a fabricated zero. An empty array renders an `EmptyState` telling the user where the button is ("open a thread on x.com and hit the 🧵 in the action row").
- `api.harvest.thread` is added now even though this tab does not render a transcript — it is the one place a future reader would otherwise re-spell the path, and it is three lines. Do **not** build the transcript view (decision 3).

**Tests:** no new bun suite (this is a render-only section over a typed GET; `Harvest.tsx` has no existing suite). Keep the pure work in Task 3's module, as here.

**Done when:**
- [ ] The section lists captures after a real capture and shows the EmptyState on a fresh DB
- [ ] A failed/unconfigured read renders nothing, never "0 threads"
- [ ] `bun run typecheck` + `bun run lint` + `cd extension && bun run build` green
- [ ] Committed: `feat(extension): TH.6 captured-threads list in the Harvest tab`

**Cost note:** $0.

---

## Task 7 (final): docs-sync + smoke
**Depends on:** all prior.

- [ ] **`scripts/smoke-thread-harvest.ts`** — mounts `harvest` (and `cannon` for the isolation assertion) in-process over the REAL DB, **$0 and NO `--live` flag** — the absence is the finding, as in `smoke-own-harvest.ts`: nothing on any path in this feature can reach `xFetch` or `askLLM`, so a flag would be theatre. Ledger, all tweet ids behind one prefix so cleanup is a `LIKE` delete of rows **and** runs:
  1. `POST /x/harvest/thread` root + 3 replies (one of them by the root author) → `201 {inserted: 4}`
  2. `GET /x/harvest/threads` → one entry, `replyCount: 3`, `captures: 1`
  3. re-POST the same root with bumped metrics → new `runId`; list still ONE entry, now `captures: 2`, showing the **new** `rootViews`
  4. `GET /x/harvest/threads/:root` → root + replies ordered by `position`, `isAuthor` true only on the self-reply, `orig` echoing the root
  5. `?runId=<first>` → the FIRST capture's metrics (the longitudinal proof)
  6. duplicate reply id + a reply equal to the root → `skippedDuplicate: 2`
  7. 501 rows → 400 `too_many_rows`; unknown root → 404 `thread_not_found`
  8. **isolation:** `GET /x/harvest/affinity` and the cannon candidates/rescore reads do **not** see any thread handle — the free-text discriminator's whole safety argument, asserted rather than assumed
  9. cleanup, then a re-run of the script is green from a clean slate
- [ ] `docs/PHASE-HISTORY.md` — the TH phase entry (what shipped, date, **$0**, the five verified consumer filters, the two DOM live-verifications, the opening-guess thresholds).
- [ ] `PLAN.md` — TH marked shipped under goal 3.
- [ ] `docs/harvest-tab.md` — the Captured-threads section.
- [ ] `docs/s6-augmented-ui.md` — the 🧵 on-page button (fifth control in the UI.18 cluster, `ACT_ORDER.thread = 5`).
- [ ] `docs/s2-mcp-server.md` — **all three** counts (total / curated tier / write tier) bumped 23 → 25 plus the two new tool entries.
- [ ] `CLAUDE.md` — **only if a guardrail moved.** It should not: this feature adds no X call and no new invariant. Leave it untouched and say so in the commit body.
- [ ] `.claude/skills/plan-feature/references/codemap.md` — §3.3 `harvest.ts` row (three new routes + the `:param` trap now being live), §4 `harvestRuns`/`harvestRows` row (the new column, `mode='thread'`, and the **updated consumer list** — every reader must filter on `mode`), §5 (`content.ts` button, `harvester.ts::captureThread`, the new `shared/thread.ts`, `Harvest.tsx` section, `api.ts`), §6 (23 → 25 tools), §9 (the new smoke script, suite counts), **and the two stale "next migration owns `0027`" sentences in §3.1/§4 → `0029`** after this plan's `0028` lands. Re-stamp the header to the new commit.

## Out of scope (do NOT build)

- **Nested reply expansion** ("Show replies" chains, quote-tweet trees, the probable-spam section) — decision 2.
- **A parent-of-each-reply column.** The DOM does not state it reliably; `groupPosition` (render order) + `orig` (the root) is what is actually knowable.
- **A transcript reader in the side panel** — decision 3. The MCP tools are the reading surface.
- **Any LLM call**: no thread summarization, no "what worked here" narration, no voice extraction on capture. The corpus is the deliverable; analysis happens in the chat.
- **Person events / stage movement from thread participants.** Reading a thread is exposure, not interaction (HV.1 decision 6).
- **Reply-draft reconcile in thread mode** — decision 7.
- **Feeding thread rows into the cannon roster or the timeline funnel.** `POST_MODES` and the `mode='timeline'` filters stay exactly as they are; if that ever changes it is a separate, argued decision.
- **A settings-registry group for the thread caps.** They are code constants until there is a measured reason to expose them (§7.19 — thresholds ship as opening guesses and recalibrate at a stated sample size, not by vibes).
- **Auto-capture on opening a thread.** The click is the consent; a page that starts scrolling itself is a bug report.

## Risks / watch items

1. **"Show more replies" is localized and structurally identified** (Task 4). This is the single most likely thing to break or to silently under-collect. It must be verified in a real browser on (a) a short thread with no pagination, (b) a thread with 200+ replies. If the structural finder proves flaky, the honest fallback is to ship without pagination — scroll-only — and say so, rather than to click blindly.
2. **The focal tweet's metrics.** `extractArticle` reads `div[role="group"][aria-label]`. On a `/status/` page the *focused* tweet renders its counts differently from a timeline card, and the aria-label may omit views. **Verify the root row's `views`/`bookmarks` land non-zero on a real capture**; if they do not, the root needs a focal-stats-bar fallback reader, which is a Task 4 addendum, not a redesign — everything downstream already treats a missing count as 0.
3. **Opening guesses, all of them**: `MAX_THREAD_REPLIES = 400`, `MAX_THREAD_ROWS = 500`, `MAX_SHOW_MORE_CLICKS = 20`, `THREAD_STEP_CAP = 400`, `MAX_THREAD_RUN_SCAN = 500`. Recalibrate after ~20 real captures against how many were truncated — never by vibes.
4. **Virtualization on very long threads.** X unmounts articles that scroll far out of view. First-seen-order + keyed store handles re-sighting, but a reply that never rendered is never captured; `comments` vs `replyCount` in the transcript is what makes that visible instead of silent.
5. **`harvest_rows` growth.** A few thousand rows per big thread, kept forever (no prune — decision in Design). At single-user volume this is nothing, but if capture becomes a daily habit, a retention policy for `mode='thread'` is the first thing to revisit.
6. **Rollback story.** The column is nullable and unread by anything else; deleting the three route blocks, the two MCP tools and the one `attachThreadCaptureButton(...)` call in `scan()` returns the system to exactly today's behavior, with the captured rows sitting inert behind a `mode` no consumer selects.
