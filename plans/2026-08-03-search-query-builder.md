# Search — query builder + saved searches

- **Status:** planned 2026-08-03 · not started
- **Goal fit:** Goals 3 + 4. Finding other people's tweets by keyword/engagement is the intake funnel for the voice library (goal 3) and for the reply-target roster / Radar queue (goal 4). It builds no new content surface — it points the existing $0 capture buttons at a better set of tweets.
- **Cost impact:** **$0.** No X API call, no LLM call, anywhere in this plan. The whole feature compiles a string and opens a tab; capture is the already-shipped `POST /x/voice/scrape` and Radar-add paths, which are $0 DOM scrape.
- **Invariants touched:** §7.5 (`max_results` clamp) — *avoided entirely*, no paginate wrapper is added; §7.13 (sync SQLite, never bind a JS `Date` in raw `sql`); §7.26 (content script is an IIFE — **not touched by this plan**, see Out of scope); §7.27 (shim for a shared server module — the query compiler is the 8th shim); §7.20 (static path before `:param`); §7.29 (docs sync in same commit); §7.33 (validate a borrowed claim against reality before shipping — here, the web-dialect operator set, see Task 1 + Risks).
- **Codemap sections relevant:** §3.1 (`src/shared/`), §3.4 (routes), §4 (tables + migration discipline), §5 (extension), §7.13/7.20/7.26/7.27/7.29/7.33, §9 (tests/smoke), §10 (recipes: new table, new API surface, new extension surface).

## Why / what changes for the user

Today, finding tweets worth stashing or replying to means typing raw operator syntax into x.com's search box from memory, and re-typing it every time. After this plan there is a **Search** tab in the side panel: a structured form (keywords all/any/phrase/exclude, from/to, minimum likes/reposts/replies, media/link/reply filters, language, date window) that compiles to a correct x.com search string, shows it live with a character count, and opens it in a tab with one click. Useful queries are saved by name and re-run from a list, with a "last run" stamp. The results page is the ordinary x.com search page, so every existing on-page affordance — ⊕ Add to Radar, Save author to stratus, band colouring — already works on the results with no new scrape code.

## Design

Four layers, thin at every one.

**1. Pure logic — `src/shared/searchQuery.ts` (new).** The whole feature's intelligence. Exports a `SearchQuery` interface (the structured params), `parseSearchQuery(unknown): SearchQuery | null` (normalizing validator, the storage boundary), `compileSearchQuery(q): CompileResult`, and `searchUrl(q, opts): string | null`. `CompileResult` is `{ query: string; length: number; overLimit: boolean; problems: Problem[] }` where `Problem` is `{ level: 'error' | 'warn'; field: string; message: string }` — errors mean "do not run", warnings mean "this will run but may not do what you think". No throwing; a bad field degrades to a problem, matching §7.35's "decide per field which half it is in".

The correctness rules the compiler owns (these are the feature — everything else is plumbing):

- **`OR` must be uppercase.** Lowercase `or` is a keyword to X's parser, silently matching the literal word. `any: ['a','b']` compiles to `(a OR b)`.
- **AND binds tighter than OR**, so every OR group is **always parenthesized**, even a group of one. `all:['bun'], any:['sqlite','drizzle']` → `bun (sqlite OR drizzle)` — never `bun sqlite OR drizzle`, which parses as `bun AND (sqlite OR drizzle)` only by luck of X's precedence and breaks the moment a third clause appears.
- **Phrases** are `"..."`. A term containing a `"` is an error (X has no escape character) — not a silent strip.
- **A term that already looks like an operator is not a keyword.** A raw `#tag` stays `#tag` (entity operator), `@user` stays `@user`, `$TICK` stays `$TICK`; but a term containing a `:` that isn't one of ours is a **warn** ("this will be read as an operator"), because the user pasting `min_faves:50` into the keyword box is the likeliest failure mode of the whole form.
- **Handles** are validated with `/^[A-Za-z0-9_]{1,15}$/` after stripping one leading `@` (the `USERNAME_RE` already used in `routes/voice.ts` and `routes/replyLists.ts`).
- **Engagement floors** are non-negative integers; `0` means absent (a `min_faves:0` clause is inert noise that eats the char budget).
- **Dates** are `YYYY-MM-DD` and compile to `since:`/`until:`; `until` before `since` is an error.
- **`lang:`** is validated against a small explicit allowlist constant, not a regex — an invalid code silently returns zero results, which reads exactly like "no matches".
- **Empty query is an error.** A form with only `-filter:replies` in it is a request for the entire firehose minus replies.
- **512-char cap** (`MAX_QUERY_LENGTH`), matching the self-serve recent-search limit — the tighter of the two known bounds, used as the web budget too since x.com's own limit is undocumented. Over-limit is an error.
- **Deterministic clause order** — keywords, entities, from/to, engagement, filters, lang, dates — so the same params always produce a byte-identical string (makes it testable and makes the saved-search diff meaningful).

`searchUrl` returns `https://x.com/search?q=<encodeURIComponent(query)>&f=live` (`f=top` when `sort: 'top'`), and returns `null` when the compile has any error — the type system carries the refuse-before-run gate.

**2. Data — `savedSearches` table + migration `0026`.** Sketch:

```
saved_searches
  id          text PK (uuid)
  name        text notNull
  query       text notNull        -- JSON of SearchQuery, stored NORMALIZED through parseSearchQuery
  sort        text notNull default 'live'   -- 'live' | 'top'
  pinned      integer bool default false notNull
  last_run_at integer timestamp_ms          -- nullable; null = never run
  created_at  integer timestamp_ms notNull default (unixepoch() * 1000)
  updated_at  integer timestamp_ms notNull default (unixepoch() * 1000)
```

No seed INSERT (sidesteps the drizzle-kit dropped-seed trap; an empty list is a valid, byte-identical starting state). `query` is stored normalized through `parseSearchQuery` so the read path never re-validates — the exact discipline `reply_lists.humanizer` uses with `parseHumanizerConfig`.

**3. Routes — `src/x/routes/searches.ts` (new), always mounted, every route $0.**

| Method | Path | Body | Responses |
|---|---|---|---|
| `GET` | `/x/searches` | — | `200 [{ ...saved, compiled: { query, length, overLimit, problems }, url }]`, pinned first then `updated_at` desc |
| `POST` | `/x/searches` | `{ name, query, sort?, pinned? }` | `201 {saved}` · `400 invalid_body` / `invalid_name` / `invalid_query` (with `problems`) |
| `GET` | `/x/searches/:id` | — | `200 {saved, compiled, url}` · `404 not_found` |
| `PATCH` | `/x/searches/:id` | partial `{ name?, query?, sort?, pinned? }` | `200 {saved}` · `400` · `404` |
| `DELETE` | `/x/searches/:id` | — | `204` · `404 not_found` |
| `POST` | `/x/searches/compile` | `{ query, sort? }` | `200 { query, length, overLimit, problems, url }` — stateless preview, no row |
| `POST` | `/x/searches/:id/run` | — | `200 {url, lastRunAt}` · `404` · `409 uncompilable` — stamps `last_run_at`, returns the URL |

`/searches/compile` is a **static path and must mount before `/searches/:id`** (§7.20). It exists so a CLI/MCP caller can validate a query without the extension's copy of the compiler; the panel uses the shim directly and does not call it on every keystroke.

**4. Extension — new top-level `Search` tab.** `extension/src/searchQuery.ts` is a re-export shim over `src/shared/searchQuery.ts` (identical 4-line shape to `extension/src/replyBand.ts` / `humanize.ts`), so the form recompiles locally on every keystroke with **zero** network traffic and the preview line can never disagree with what the server would store. `sidepanel/Search.tsx` renders the form with `ui/Section` + `ui/SettingRow` primitives and `--strat-*` tokens (§7 UI primitives / chip taxonomy), plus the saved-search list. `api.ts` gains a `searches` namespace. `App.tsx` gains the tab in the **Library** group (next to Voice/Replies/Harvest — it is an intake surface for the library, not part of the daily Operate loop). Running a search is `chrome.tabs.create({ url, active: true })` — the same call `harvestClient.ts:90` already makes, needing no new manifest permission.

**Measurement:** none, deliberately. There is no statistic here worth gating — the honest measure of this feature is whether voice-library rows and Radar pins start arriving from search-result pages, and that is already visible in the existing surfaces. Adding a "searches run" counter would be a number nobody acts on.

## Decisions taken

1. **Web dialect only ($0). The X API v2 path is not built.** Verified against `docs.x.com/x-api/posts/search/integrate/operators`: v2 has **no** `min_faves` / `min_retweets` / `min_replies` operator, at any access tier. On the API, "minimum engagement" could only be a client-side post-filter over `public_metrics` — and since X bills every result it *returns* ($0.005/other-user result, invariant §7.5), a `min_faves:50` search would pay for ~100 tweets to keep ~6. The web dialect supports the engagement operators natively at $0. `searchRecent` in `endpoints.ts` therefore stays with no production caller. *(User choice.)*
2. **Results are worked on x.com, not scraped into the panel.** The content script's `scan()` already decorates every `article[data-testid="tweet"]` on any page, including `/search`, with ⊕ Add to Radar and Save author. Building a search-results harvester would duplicate `harvestClient.ts`'s port/scroll machinery for a page the existing buttons already cover. *(User choice.)* This is what keeps the plan at 5 sessions and `content.ts` untouched.
3. **New top-level Search tab**, in the Library group. *(User choice.)*
4. **The compiler lives in `src/shared/`, not in the extension.** Server-side validation on POST and client-side live preview must agree byte-for-byte or the saved string differs from the previewed one; §7.27 forbids forking that logic. Shim, not a copy.
5. **Saved queries store the structured params, not the compiled string.** A compiled string can't be loaded back into the form, and a compiler fix (an operator X renames) then can't reach rows already saved. The string is derived on every read.
6. **`parseSearchQuery` normalizes at the storage boundary** (the `reply_lists.humanizer` pattern) — trim, drop empties, dedupe case-insensitively, coerce `0`/negative floors to absent, sort nothing (clause order is the compiler's job). A row read back therefore never needs re-validation.
7. **Problems are a list, not an exception.** The form must show *all* faults at once; a throw-on-first-error compiler makes fixing a four-field mistake a four-round-trip exercise.
8. **No settings-registry knob.** Nothing here is a tunable threshold — the 512 cap is X's, not ours, and a knob that lets the user raise it only buys a silent 400.

## Done when

1. A user fills the Search form with keywords + a minimum-likes floor, sees the compiled query and its character count update live, clicks Run, and lands on an x.com search page whose results match those constraints.
2. Every result on that page carries the existing ⊕ Add to Radar and Save author buttons, and clicking them stores rows exactly as they do on a profile timeline (no new capture code was written or needed).
3. A query saved by name survives a browser restart and a server restart, re-loads into the form with every field intact, and re-runs to the same URL.
4. Malformed input (unbalanced quote, bad handle, `until` before `since`, over-512, empty query) is refused with a specific per-field message and the Run button is disabled — no request is made and no row is written.
5. `bun scripts/smoke-search.ts` passes with **no `--live` flag existing**, because nothing under `/x/searches` can reach `xFetch` or `askLLM` (the D171c question, answered "no paid claim" — same shape as `smoke-humanizer.ts`).
6. A browser pass confirms x.com still honours `min_faves:` / `min_retweets:` / `min_replies:` / `since:` / `until:` / `filter:` in the search box (Task 1's verification step — see Risks).

---

## Task 1: Pure query compiler in `src/shared/searchQuery.ts`  [parallel-ok]
**Depends on:** none
**Session budget:** ~330 lines + ~260 test lines; 2 files (both new)

**Read first:**
- codemap header + §3.1 (`src/shared/`), §7.27 (shims), §7.33 (validate a borrowed claim), §7.35 (strict half vs degrading half)
- `src/shared/replyBand.ts` — the house shape for a pure shared module (exported constants, no imports beyond types, every branch a named predicate)
- `src/x/replyLists/engine.ts::parseHumanizerConfig` — the normalizing-validator shape this module's `parseSearchQuery` copies (field-by-field fallback, `null` only for a non-object)
- This plan's **Design §1** — the correctness rules are the specification; implement them literally

**Edit:**
- `src/shared/searchQuery.ts` (new) — `SearchQuery`, `Problem`, `CompileResult`, `MAX_QUERY_LENGTH = 512`, `SEARCH_LANGS`, `parseSearchQuery`, `compileSearchQuery`, `searchUrl`
- `src/shared/searchQuery.test.ts` (new)

**How:**
`SearchQuery` fields: `all?: string[]`, `any?: string[]`, `phrases?: string[]`, `none?: string[]`, `from?: string`, `to?: string`, `minFaves?: number`, `minRetweets?: number`, `minReplies?: number`, `hasMedia?: boolean`, `hasLinks?: boolean`, `noReplies?: boolean`, `noRetweets?: boolean`, `lang?: string`, `since?: string`, `until?: string`, `sort?: 'live' | 'top'`.

Compile in fixed clause order: `all` terms (bare, space-joined) → `(a OR b)` for `any` → quoted phrases → `-term` for each `none` → `from:`/`to:` → `min_faves:`/`min_retweets:`/`min_replies:` → `filter:media` / `filter:links` / `-filter:replies` / `-filter:nativeretweets` → `lang:` → `since:`/`until:`. Join with single spaces. **Always parenthesize the `any` group**, including when it has one member — a later clause must never be able to re-associate it.

Reuse `USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/` (copy the constant; `routes/voice.ts:48` and `routes/replyLists.ts` each hold their own — this is the third and the shared module is the right home, but **do not refactor those two in this task**, it would put a route file in a pure-module diff).

`parseSearchQuery` must be total: a non-object (or `null`) returns `null`; anything else degrades field by field. Trim every string, drop empties, dedupe arrays case-insensitively preserving first-seen order, coerce non-finite/negative/zero engagement floors to `undefined`, coerce an unknown `sort` to `'live'`, cap each array at 20 terms and each term at 120 chars (over-cap terms are dropped, and the cap constants are exported so the route and the form can say so).

`compileSearchQuery` never throws and never returns a partial string on error — it returns the best-effort compiled string *plus* the problems, so the form can show both. `searchUrl` returns `null` iff `problems` contains any `level: 'error'`.

**Do NOT** add a `dialect` parameter, an `api` compile path, or an `xFetch` import. Decision 1 closed that; a stub for it is dead code that will read as a promise.

**Verification step (§7.33, do this before writing the compiler):** open x.com and run `min_faves:50 bun` and `bun since:2026-07-01 -filter:replies` in the search box by hand. Confirm both return plausibly filtered results. If any operator has been retired, record it in the module's header comment as unsupported and drop it from `SearchQuery` — shipping an operator X ignores produces a query that silently returns the unfiltered firehose, which looks identical to a working feature.

**Tests:** `src/shared/searchQuery.test.ts` —
- exact compiled string for a full-house query (the golden case, asserted byte-for-byte)
- `any` of one member still parenthesized; `any` + `all` ordering
- uppercase `OR` (assert the string contains `' OR '` and not `' or '`)
- phrase with an inner `"` → error, not a strip
- `@handle` stripped to `handle`; a 16-char handle → error; a handle with a `.` → error
- `minFaves: 0` and `minFaves: -3` both omit the clause entirely
- `until` before `since` → error; malformed date → error
- unknown `lang` → error
- empty query (and query of only negations/filters) → error
- 512 overflow → `overLimit: true` + error, and `searchUrl` returns `null`
- keyword containing `:` → `warn`, and the query still compiles
- `parseSearchQuery(null)`/`(42)`/`('x')` → `null`; `parseSearchQuery({all: ['  a  ', '', 'A']})` → `{all: ['a']}` (trim + dedupe case-insensitively)
- round-trip: `parseSearchQuery(JSON.parse(JSON.stringify(parseSearchQuery(x))))` is idempotent

**Done when:**
- [ ] Golden compiled string asserted byte-for-byte; every rule in Design §1 has a test
- [ ] The x.com manual operator check is done and its result recorded in the module header comment
- [ ] `compileSearchQuery` has no throw path (assert via a fuzz-ish table of junk inputs)
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(search): pure x.com search-query compiler + validator`

**Cost note:** $0 — pure module, no imports outside `src/shared/`.

---

## Task 2: `saved_searches` table + migration `0026`  [parallel-ok]
**Depends on:** none (schema alone is coherent — Task 3 is its only consumer and lands right after)
**Session budget:** ~40 lines; 2 files + 1 generated migration

**Read first:**
- codemap header + §4 (tables, migration discipline + the dropped-seed trap)
- `src/x/db/schema.ts` around `promptOverrides` / `commitments` (L746–L790) — the timestamp-default idiom to copy verbatim
- codemap §11's `0025` entry (RC.2) — the exact inspection ritual a migration commit owes

**Edit:**
- `src/x/db/schema.ts` — append `savedSearches` per the Design §2 sketch, with a header comment explaining that `query` holds `SearchQuery` JSON stored normalized through `parseSearchQuery`, and that there is no seed by design
- `src/db/migrations/0026_*.sql` + `_journal.json` (generated)

**How:**
Run `bun run db:generate`, then **inspect the emitted SQL** — it must be exactly one `CREATE TABLE`, no seed INSERT touched, no other table altered. `git diff src/db/migrations/` should show the new `.sql`, the snapshot JSON, and a `_journal.json` append, and nothing else. Boot a fresh `:memory:` DB and confirm the table exists with the expected columns and that the three `content_pillars` seed rows still land (the standing §4 check — note the seeds are `INSERT OR IGNORE`, so grep for that form, not `INSERT INTO`).

Timestamps use `integer(..., { mode: 'timestamp_ms' }).default(sql\`(unixepoch() * 1000)\`).notNull()`. Add an index on `(pinned, updated_at)` only if the list query in Task 3 needs it — with a single-user table of tens of rows it does not; **prefer no index** and say so in the comment.

**Do NOT** write any route or consumer in this task, and do not run it in parallel with another migration-generating session (journal conflicts — CLAUDE.md stack rule).

**Tests:** none new — schema-only. The fresh-boot column check is a manual step in this task's done-when, matching how `0025` was verified.

**Done when:**
- [ ] `bun run db:generate` emitted exactly one `CREATE TABLE`, inspected, no seed dropped
- [ ] Fresh `:memory:` boot creates the table and the `content_pillars` seeds still land
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(search): saved_searches table + migration 0026`

**Cost note:** $0 — DDL only.

---

## Task 3: `POST/GET/PATCH/DELETE /x/searches` + compile/run routes
**Depends on:** Task 1, Task 2
**Session budget:** ~300 lines + ~250 test lines; 3 files (2 new)

**Read first:**
- codemap header + §3.4 (routes), §7.20 (static path before `:param`), §7.13 (sync SQLite, no JS `Date` in raw `sql`)
- `src/x/routes/replyLists.ts:1–120` — the CRUD exemplar: the route-list header comment, the validation-constant block, the `readJson` + per-field 400 ladder, the normalized-storage discipline (`humanizer` ↔ `parseHumanizerConfig`)
- `src/shared/searchQuery.ts` (Task 1) — the full exported surface
- `src/x/index.ts:14–60` (imports) and `:77–150` (mount block)

**Edit:**
- `src/x/routes/searches.ts` (new) — `searchesRouter`, the 7 routes in Design §3
- `src/x/routes/searches.test.ts` (new)
- `src/x/index.ts` — import + `app.route('/x', searchesRouter)`; mount it in the always-mounted block near `replyListsRouter` (line ~119). **Not** LLM-gated (§7.22) — there is no LLM call here at all.

**How:**
Every write path runs the body's `query` through `parseSearchQuery` and stores `JSON.stringify` of the *normalized* result — never the raw body. A `null` from `parseSearchQuery` is `400 invalid_query`. Then run `compileSearchQuery` on the normalized value: if it yields any `level: 'error'` problem, **still 400** with `{ error: 'invalid_query', problems }` — an uncompilable saved search is a row whose Run button can never work, and storing it just moves the failure to read time. Warnings do not block.

`GET` paths hydrate each row: `JSON.parse` the `query` (wrapped — a hand-edited row via `/explorer` must not 500 the list; a parse failure degrades that row to `compiled: null, url: null` rather than dropping it, so the user can see and delete it). Order `pinned desc, updated_at desc`.

`/searches/compile` must be registered **before** `/searches/:id` (§7.20 — the same trap followups/fans hit against `/people/:handle`). Same for `/searches/:id/run` vs `/searches/:id`: Hono matches in registration order, so register the more specific first.

`/searches/:id/run` stamps `last_run_at` and returns the URL. Use `new Date()` through Drizzle's `timestamp_ms` column (never a raw `sql` template with a bound `Date` — §7.13). If the stored query no longer compiles, return `409 uncompilable` with the problems and **do not** stamp `last_run_at` — a run that couldn't happen is not a run.

Validation constants: `MAX_NAME_LEN = 120`, `UUID_RE` (copy from `replyLists.ts`). `PATCH` is partial — an absent key means "unchanged", an explicit `null` on `name` is a 400 (it's `notNull`).

**Do NOT** add an MCP tool for this (see Out of scope — it would bump `src/mcp.test.ts`'s exact asserted count and `docs/s2-mcp-server.md`'s three counts, for a surface an agent has no reason to drive). **Do NOT** import `xFetch`, `askLLM`, or anything from `src/x/endpoints.ts`.

**Tests:** `src/x/routes/searches.test.ts`, over in-memory SQLite, imitating `replyLists.test.ts`'s harness —
- POST → GET round-trip; stored `query` is the normalized form, not the raw body (assert a raw `{all:['  a  ','A']}` reads back as `{all:['a']}`)
- POST with a query that compiles with errors (e.g. `until` < `since`) → `400 invalid_query` with `problems` populated, and **no row written**
- POST with a warn-only query → `201`
- POST invalid name (empty, >120) → `400 invalid_name`
- GET list ordering: pinned first, then `updated_at` desc
- GET list with a row whose `query` column is hand-corrupted JSON → `200`, that row present with `compiled: null`, others intact
- `GET /searches/compile` path does not shadow — assert `POST /x/searches/compile` returns a compile result and *not* a 404-from-`:id`
- `POST /:id/run` stamps `last_run_at` and returns the URL; a second run updates the stamp
- `POST /:id/run` on an uncompilable row → `409`, `last_run_at` unchanged
- PATCH partial (name only) leaves `query` untouched; PATCH `query` re-normalizes
- DELETE → 204 then 404; all five paths 404 on an unknown uuid, 400 on a malformed one

**Done when:**
- [ ] All 7 routes behave per the Design §3 table, including both 404 and 409 arms
- [ ] `/searches/compile` and `/searches/:id/run` are registered before `/searches/:id`, with a test that would fail if reordered
- [ ] Route grep confirms no `xFetch` / `askLLM` / `endpoints.ts` import in `searches.ts`
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(search): /x/searches CRUD + compile/run routes`

**Cost note:** $0 — pure SQL + the pure compiler. No paid call is reachable from this router.

---

## Task 4: Search tab — form, live preview, saved list
**Depends on:** Task 1, Task 3
**Session budget:** ~340 lines; 5 files (2 new)

**Read first:**
- codemap header + §5 (extension), §7.24–27 (background is the single session writer; one transport via `ApiRequest`; content script is an IIFE; shims), the UI-primitives and chip-taxonomy bullets in §7
- `extension/src/replyBand.ts` and `extension/src/humanize.ts` — the 4-line shim shape to copy exactly (comment explaining *why* the canonical module is shared, then `export * from '../../src/shared/…'`)
- `extension/src/sidepanel/ReplyLists.tsx` — the house shape for a list+editor tab built on `ui/Section` + `ui/SettingRow`
- `extension/src/sidepanel/App.tsx:20–78` — the `Tab` union and `TAB_GROUPS`
- `extension/src/sidepanel/api.ts:1255–1300` (the `replyLists` namespace) — the namespace shape to copy
- `extension/src/sidepanel/harvestClient.ts:84–95` — the `chrome.tabs.create` call to imitate

**Edit:**
- `extension/src/searchQuery.ts` (new) — the re-export shim
- `extension/src/sidepanel/Search.tsx` (new) — the whole surface
- `extension/src/sidepanel/api.ts` — a `searches` namespace (`list`, `create`, `get`, `patch`, `remove`, `run`); no `compile` method, the panel compiles locally
- `extension/src/sidepanel/App.tsx` — `'search'` in the `Tab` union, `{ id: 'search', label: 'Search' }` in the **Library** group, and the render branch
- `extension/src/shared/types.ts` — `SavedSearch` / `SavedSearchCreateBody` wire types (re-export `SearchQuery` from the shim, do not redeclare it — the HM.3/D180a lesson: a redeclared mirror drifts)

**How:**
The form calls `compileSearchQuery` from the shim on every render — it is pure and microseconds, so there is no debounce and no `useMemo` ceremony needed beyond the obvious one. Render the compiled string in a monospace preview block with `length/512` and, when over, the count in the danger tone. Render `problems` inline next to their `field` (that's what the `field` key is for), errors in danger tone, warnings in the warn tone, using existing `--strat-*` tokens and the `.chip-{warn,strong}` tones — **no new color literal outside `:root`** (§7 design tokens).

Run button: disabled iff any error problem. On click, `searchUrl(q)` locally for the URL, `api.searches.run(id)` for the `last_run_at` stamp when running a *saved* search (fire-and-forget — a failed stamp must not block the tab from opening), then `chrome.tabs.create({ url, active: true })`. An unsaved ad-hoc query skips the stamp call entirely.

Saved list: name, a one-line compiled-query preview (truncated), "last run" relative time or "never", and Run / Load / Delete. Loading a saved search replaces the form state. "Save as…" on a dirty form POSTs; editing a loaded one PATCHes.

`useState` for form state, no reducer, no form library. Persist the *unsaved draft* form state to `chrome.storage.local` under `search:draft` so a panel close doesn't lose a half-built query — read `storage.ts` for the existing key conventions before inventing one.

**Do NOT** touch `extension/src/content.ts` — decision 2 means the results page needs no new on-page code, and the IIFE constraint (§7.26) makes a casual import there expensive. **Do NOT** add a `SubTabs` split; this tab is one view.

**Tests:** panel components carry no unit tests by convention (§5 / the HM.4 precedent — suite count unchanged). The shim and the compiler are covered by Task 1. Verify with `cd extension && bun run build` plus a grep over `dist/sidepanel.js` for the operator strings (`min_faves`, `-filter:replies`, `x.com/search`) proving the shared module inlined into the build.

**Done when:**
- [ ] The Search tab renders in the Library group; the form compiles live and the preview updates on every keystroke with no network request (verify in devtools Network)
- [ ] Run opens x.com in a new tab with the correct encoded query; the existing ⊕ Add to Radar and Save author buttons appear on the results
- [ ] Save / Load / Delete round-trips against the server; "last run" stamps
- [ ] Every error problem disables Run and is shown next to its field
- [ ] `cd extension && bun run build` green + the `dist/sidepanel.js` grep passes
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(search): Search tab — query builder + saved searches`

**Cost note:** $0 — one $0 GET on mount, $0 writes per save, and a `tabs.create`. No paid call is reachable from this tab.

---

## Task 5 (final): docs-sync + smoke
**Depends on:** all prior.
**Session budget:** ~1 new file + 5 doc files

- [ ] `scripts/smoke-search.ts` — rerunnable, **$0, and ships NO `--live` flag**: nothing under `/x/searches` reaches `xFetch` or `askLLM`, so there is no paid claim a keyless run fails to make (the D171c question, same answer as `smoke-humanizer.ts` and the opposite of `smoke-radar-curate.ts` — state that reasoning in the script header). Cover: create a `__smoke_search__`-prefixed saved search → GET it back and assert the compiled string byte-for-byte → assert the `url` is the expected encoded form → run it and assert `last_run_at` moved → PATCH the query and assert recompilation → POST an uncompilable query and assert `400` + `problems` → delete and assert `404`. **Read back after every write** (the RC.5 lesson) — a green call is not proof a column exists. Restore/cleanup fires the instant the DB half ends, including on failure.
- [ ] `docs/PHASE-HISTORY.md`: the phase entry (what shipped, date, $0, the "v2 has no engagement operators" finding as the load-bearing gotcha).
- [ ] `CLAUDE.md`: **only** if a guardrail changed — it does not here. Leave it alone and say so in the commit body.
- [ ] `PLAN.md`: phase blockquote (this serves goals 3–4's intake, so PLAN.md is the right doc, not CIRCLES/SURFACES).
- [ ] `docs/search-tab.md` (new) — the form fields, what each compiles to, the problem-severity model, the saved-search lifecycle, and an explicit note that the API dialect does not exist and why.
- [ ] `docs/voice-tab.md` + `docs/radar-tab.md`: one cross-reference line each — search results are a capture surface for both.
- [ ] `.claude/skills/plan-feature/references/codemap.md`: §3.1 (`src/shared/searchQuery.ts`), §3.4 (the router), §4 (table count, migrations through `0026`), §5 (the new tab + the new shim), §9 (smoke script count), §11 (update-log entry), header re-stamped to the new commit. **Re-count each of these from the repo at commit time — do not carry forward the numbers this plan was written against** (the D164a trap: a plan quotes the day it was written).

## Out of scope (do NOT build)

- **Any X API v2 search path.** No `searchRecent` caller, no `dialect: 'api'`, no post-filter over `public_metrics`, no "estimated spend" UI. Decision 1.
- **A search-results scraper.** No new content-script code, no `SEARCH_PORT`, no bulk ingest into `voice_tweets`. Decision 2 — the existing per-tweet buttons cover it.
- **An MCP tool.** It would bump `src/mcp.test.ts`'s exact asserted count (23) and three counts in `docs/s2-mcp-server.md`, for a surface an agent has no reason to drive.
- **A settings-registry knob.** Decision 8.
- **Scheduled/recurring searches, a saved-search worker, result-diffing, or "notify me when this query has new hits."** All of them turn a $0 open-a-tab feature into a polling surface, and X's web search cannot be polled without a browser.
- **Refactoring `USERNAME_RE` out of `routes/voice.ts` / `routes/replyLists.ts`** into the shared module. Correct eventually, wrong inside these diffs.
- **`point_radius:` / `bounding_box:` / `place:` / `context:` / `entity:` / `list:` operators.** Real operators, no demand; each is a field, a validator, a test, and a docs line.

## Risks / watch items

1. **The web dialect's operator set is not documented by X** (`help.x.com` 403s to fetch, and `docs.x.com` covers the *API* only, where these operators do not exist). `min_faves:` / `min_retweets:` / `min_replies:` / `since:` / `until:` / `filter:` are long-standing advanced-search operators, but they are undocumented surface that X could retire without notice. **This is why Task 1 carries a manual browser check before the compiler is written** (§7.33: a borrowed claim is validated against reality first). The failure mode is the dangerous kind — a retired operator does not error, it is ignored, so the query silently returns the *unfiltered* firehose and a broken feature looks exactly like a working one. Mitigation beyond Task 1: the module header records the verification date, and `docs/search-tab.md` tells the user that zero-looking-like-everything is the symptom to report.
2. **`MAX_QUERY_LENGTH = 512` is borrowed from the API's self-serve recent-search limit**, not measured against x.com's web search, whose real cap is unknown and probably higher. It is deliberately the tighter bound — over-restricting produces a visible, fixable error, while over-permitting produces a truncated query that silently matches the wrong thing. Recalibrate only if a real query is ever refused at the cap, and only by measurement.
3. **The `f=live` vs `f=top` URL parameter is undocumented** in the same way. `f=live` (Latest) is the useful default for discovery; if X renames it the results just come back algorithmically sorted rather than chronologically — a degradation, not a break.
4. **Task 2 must not run in a parallel session with any other migration-generating work** (journal conflicts). It is `[parallel-ok]` with Task 1 only because Task 1 touches no migration.
5. **Rollback story:** every layer is independently removable. Task 4 alone → drop the tab from `TAB_GROUPS` (the union member and file can stay, unreferenced). Task 3 alone → comment out the one `app.route('/x', searchesRouter)` line. Task 2's table is additive and unread by anything else. Task 1 is a pure module with no importers until Task 3. Shipping Tasks 1–2 and stopping leaves the repo green with dead-but-harmless code; shipping 1–3 and stopping leaves a working $0 API with no UI.
