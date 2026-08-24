# Outliers — X advanced-search query builder + saved searches

- **Status:** planned 2026-08-03 · **revised 2026-08-24** · not started
- **Goal fit:** Goals 3 + 4. Finding other people's *outlier* tweets by keyword/engagement is the intake funnel for the voice library (goal 3) and for the reply-target roster / Radar queue (goal 4). It builds no new content surface — it points the existing $0 capture buttons at a better set of tweets.
- **Cost impact:** **$0.** No X API call, no LLM call, anywhere in this plan. The whole feature compiles a string, puts it on the clipboard, and optionally opens a tab; capture is the already-shipped `POST /x/voice/scrape` and Radar-add paths, which are $0 DOM scrape.
- **Invariants touched:** **#8** (the only billed X call is `createPost` — this feature is the *reason* a search surface can exist at all; see Decision 1); §7.5 (`max_results` clamp) — *avoided entirely*, no paginate wrapper is added; §7.11 (null = unknown, never "no"); §7.13 (sync SQLite, never bind a JS `Date` in raw `sql`); §7.20 (static path before `:param`); §7.23a (advisory, never refusal — the warn half of `problems`); §7.26 (content script is an IIFE — **not touched until Task 7**, and then by one field); §7.27 (shim for a shared server module — the query compiler is the **12th** out-of-tree include); §7.28 (posting/acting is always a manual paste — the clipboard hand-off is a new instance of the same discipline); §7.29 (docs sync in same commit); §7.33 (validate a borrowed claim against reality before shipping — here, the web-dialect operator set); §7.35 (per-field: strict half vs degrading half).
- **Codemap sections relevant:** §3.1 (`src/shared/`), §3.4 (routes), §4 (tables + migration discipline), §5 (extension), §7.11/7.13/7.20/7.23a/7.26/7.27/7.28/7.29/7.33/7.35, §9 (tests/smoke), §10 (recipes: new table, new API surface, new extension surface).
- **Codemap staleness:** stamped at `241d8d2`+OFF-PILLAR. `b92d783` (calendar tray draft-delete — `Calendar.tsx`, `App.tsx`, `api.ts`) is **unstamped**; it does not touch this feature's areas, but Task 8 owes it a §5 line while it is re-stamping anyway.

## Revision 2026-08-24 — what changed and why

The 2026-08-03 plan was never started. Six inputs arrived since, and each moves the plan rather than replacing it:

1. **The operator set is now user-verified for August 2026** (the cheatsheet in the revision request). This substantially discharges Risk 1 and Task 1's blind browser check, and it **widens** the compiler: `to:`, `@mentions`, `#hashtag`, `filter:images`, `filter:videos`, `filter:native_video`, `filter:replies` (the positive arm) and `lang:ro` were all absent from the 08-03 field list.
2. **The hand-off is clipboard-first.** The 08-03 plan only opened a tab. The primary button is now **Copy** — the user pastes into X's search field by hand — with **Open in X** as the secondary. (User choice.)
3. **Engagement floors ship as flat, hand-tuned defaults.** The user chose this over a measured basis (P90 of the timeline corpus / author median × k) and over a follower-ratio estimate. This **overturns 08-03 decision 8** ("no settings-registry knob"): flat defaults you hand-tune have to persist somewhere, and the registry is where this repo persists tunables. New group `outliers`, 6 knobs, plus a `FAVES_LADDER` in the pure module for the cheatsheet's "start at 300–500 and increase gradually".
4. **The surface is named for the job.** The tab is **Outliers**, not "Search" — the user's framing, and the useful one. Internals keep the mechanical names (`src/shared/searchQuery.ts`, `saved_searches`, `routes/searches.ts`): the *mechanism* is a search compiler, the *surface* is an outlier hunt. Do not "fix" the split (Decision 9).
5. **A measurement exists after all**, overturning 08-03's "measurement: none, deliberately". That reasoning was right about a *run counter* (activity nobody acts on) and wrong about *outcome*: stamping `voice_tweets.source = 'outlier_search'` costs one field and answers the only question worth asking — did the swipe file actually fill up from this. No new column, no migration (Task 7).
6. **Every count the 08-03 draft quoted has rotted** — exactly the D164a trap it warned about. Migration head is now `0030_famous_wrecker`, so **this plan owns `0031`**, not `0026`; tables 43 → 44; `src/mcp.test.ts` asserts **28** tools, not 23; the shim count is **11 → 12**, not "8th"; registry 63 → 69 knobs and 15 → 16 groups; smoke scripts 40 → 41; panel tabs 14 → 15. **Re-count all of these from the repo at commit time anyway.**

## Why / what changes for the user

Today, finding outlier tweets worth stashing or replying to means typing raw operator syntax into x.com's search box from memory, and re-typing it every time. After this plan there is an **Outliers** tab in the side panel: a structured form (keyword groups all/any/phrase/exclude, from/to/@/#, minimum likes/reposts/replies, media/link/reply filters, language, date window) that compiles to a correct x.com advanced-search string, shows it live with a character count, and **puts it on the clipboard with one click** so it can be pasted straight into X's search field — with an Open in X button for when a tab move is wanted instead. Useful hunts are saved by name and re-loaded from a list. The results page is the ordinary x.com search page, so every existing on-page affordance — Save to stratus, ⊕ Add to Radar, Save author — already works on the results with no new scrape code.

## Design

Five layers, thin at every one.

**1. Pure logic — `src/shared/searchQuery.ts` (new).** The whole feature's intelligence. Exports a `SearchQuery` interface (the structured params), `parseSearchQuery(unknown): SearchQuery | null` (normalizing validator, the storage boundary), `compileSearchQuery(q): CompileResult`, `searchUrl(q, opts): string | null`, and the ladder helpers. `CompileResult` is `{ query: string; length: number; overLimit: boolean; problems: Problem[] }` where `Problem` is `{ level: 'error' | 'warn'; field: string; message: string }` — errors mean "do not run", warnings mean "this will run but may not do what you think" (§7.23a: the warn half never refuses). No throwing; a bad field degrades to a problem, matching §7.35's "decide per field which half it is in".

`SearchQuery` fields (the **revised**, cheatsheet-complete set):

```
all?: string[]         any?: string[]        phrases?: string[]     none?: string[]
from?: string          to?: string           mentions?: string[]    hashtags?: string[]
minFaves?: number      minRetweets?: number  minReplies?: number
replies?: 'any' | 'exclude' | 'only'         media?: 'any' | 'media' | 'images' | 'videos' | 'native_video'
hasLinks?: boolean     noRetweets?: boolean  lang?: string
since?: string         until?: string        sort?: 'live' | 'top'
```

The correctness rules the compiler owns (these are the feature — everything else is plumbing):

- **`OR` must be uppercase.** Lowercase `or` is a keyword to X's parser, silently matching the literal word. `any: ['a','b']` compiles to `(a OR b)`.
- **AND binds tighter than OR**, so every OR group is **always parenthesized**, even a group of one. `all:['bun'], any:['sqlite','drizzle']` → `bun (sqlite OR drizzle)` — never `bun sqlite OR drizzle`, which parses as `bun AND (sqlite OR drizzle)` only by luck of X's precedence and breaks the moment a third clause appears.
- **Phrases** are `"..."`. A term containing a `"` is an error (X has no escape character) — not a silent strip.
- **A term that already looks like an operator is not a keyword.** A raw `#tag` stays `#tag` (entity operator), `@user` stays `@user`, `$TICK` stays `$TICK`; but a term containing a `:` that isn't one of ours is a **warn** ("this will be read as an operator"), because the user pasting `min_faves:50` into the keyword box is the likeliest failure mode of the whole form.
- **Handles** (`from`, `to`, `mentions[]`) are validated with `/^[A-Za-z0-9_]{1,15}$/` after stripping one leading `@`. **Hashtags** strip one leading `#` and validate `/^[A-Za-z0-9_]{1,100}$/` (a leading digit is legal on X but matches nothing useful — warn, don't error).
- **Engagement floors** are non-negative integers; `0` means absent (a `min_faves:0` clause is inert noise that eats the char budget). Note this is a deliberate §7.11 carve-out: here `0` is a real user intent ("no floor"), not unknown.
- **`replies` and `media` are enums, not booleans.** `replies:'exclude'` → `-filter:replies`, `'only'` → `filter:replies`, `'any'` → nothing. `media:'images'` → `filter:images`, and so on for `videos` / `native_video` / `media`. Two booleans could express "exclude AND only" simultaneously; an enum cannot.
- **Dates** are `YYYY-MM-DD` and compile to `since:`/`until:`; `until` before `since` is an error; a syntactically valid but impossible date (`2026-02-31`) is an error.
- **`lang:`** is validated against a small explicit allowlist constant (`SEARCH_LANGS`, must include `en` and `ro`), not a regex — an invalid code silently returns zero results, which reads exactly like "no matches".
- **Empty query is an error.** A form with only `-filter:replies` in it is a request for the entire firehose minus replies. A form with only engagement floors and no matcher is the same mistake with a bigger bill of attention — same error.
- **512-char cap** (`MAX_QUERY_LENGTH`), matching the self-serve recent-search limit — the tighter of the two known bounds, used as the web budget too since x.com's own limit is undocumented. Over-limit is an error.
- **Deterministic clause order** — keywords → entities (`from`/`to`/`@`/`#`) → negations → engagement → filters → `lang` → dates — so the same params always produce a byte-identical string (makes it testable and makes the saved-search diff meaningful).

`searchUrl` returns `https://x.com/search?q=<encodeURIComponent(query)>&f=live` (`f=top` when `sort: 'top'`), and returns `null` when the compile has any error — the type system carries the refuse-before-run gate.

**1b. The ladder (new at the 08-24 revision).** `FAVES_LADDER = [50, 100, 200, 300, 500, 800, 1200, 2000, 5000]` plus pure `nextRung(n)` / `prevRung(n)`. This is the entire "estimation" the feature ships: the cheatsheet's advice is *start at 300–500 and increase gradually*, and a ▲▼ stepper that walks round rungs is that advice made clickable. `nextRung` returns the smallest rung strictly greater than `n` (and `n` itself at the top); `prevRung` mirrors it. Same for retweets/replies — one ladder, three fields.

**Not built:** any computed threshold. No follower-ratio estimate, no percentile over `harvest_rows`, no author-median basis. See Decision 10 — the recipe is recorded there for the day it is wanted, and it is a separate plan.

**2. Data — `savedSearches` table + migration `0031`.** Sketch:

```
saved_searches
  id          text PK (uuid)
  name        text notNull
  query       text notNull        -- JSON of SearchQuery, stored NORMALIZED through parseSearchQuery
  sort        text notNull default 'live'   -- 'live' | 'top'
  pinned      integer bool default false notNull
  last_run_at integer timestamp_ms          -- nullable; null = never run (§7.11)
  created_at  integer timestamp_ms notNull default (unixepoch() * 1000)
  updated_at  integer timestamp_ms notNull default (unixepoch() * 1000)
```

No seed INSERT (sidesteps the drizzle-kit dropped-seed trap; an empty list is a valid, byte-identical starting state). `query` is stored normalized through `parseSearchQuery` so the read path never re-validates — the exact discipline `reply_lists.humanizer` uses with `parseHumanizerConfig`.

**A note on why this is a table and not an `app_settings` row.** `settings/sweepPresets.ts` (SP.1) keeps named presets in one `app_settings` blob with no schema and no migration, and that precedent was considered here. It does not transfer, for one reason: a sweep preset is **snapshotted server-side from already-validated registry values and never posted by a client**, which is what makes loading one blind safe. A saved search *is* client-supplied structure — it has to be, there is no registry key shaped like a search — so it needs the strict parse (`parseSearchQuery`) on the way in *and* the tolerant parse on the way out, plus per-row identity for PATCH/DELETE. A table is the honest shape. **Do not copy `sweepPresets.ts`'s "clients never send values" rule into this feature; it is false here.**

**3. Routes — `src/x/routes/searches.ts` (new), always mounted, every route $0.**

| Method | Path | Body | Responses |
|---|---|---|---|
| `GET` | `/x/searches` | — | `200 { searches: [...], capture: { savedFromSearch, days } }`, pinned first then `updated_at` desc |
| `POST` | `/x/searches` | `{ name, query, sort?, pinned? }` | `201 {saved}` · `400 invalid_body` / `invalid_name` / `invalid_query` (with `problems`) |
| `GET` | `/x/searches/:id` | — | `200 {saved, compiled, url}` · `404 not_found` |
| `PATCH` | `/x/searches/:id` | partial `{ name?, query?, sort?, pinned? }` | `200 {saved}` · `400` · `404` |
| `DELETE` | `/x/searches/:id` | — | `204` · `404 not_found` |
| `POST` | `/x/searches/compile` | `{ query, sort? }` | `200 { query, length, overLimit, problems, url }` — stateless preview, no row |
| `POST` | `/x/searches/:id/run` | — | `200 {url, lastRunAt}` · `404` · `409 uncompilable` — stamps `last_run_at`, returns the URL |
| `GET` | `/x/searches/defaults` | — | `200 { query: SearchQuery, ladder: number[] }` — the registry-backed starting spec |

`GET /x/searches` returns an **object, not the bare array** the 08-03 draft specified: the tab needs the capture count (Task 7) on the same mount call, and a sibling field is cheaper than a second route. `/searches/compile` and `/searches/defaults` are **static paths and must mount before `/searches/:id`** (§7.20). `compile` exists so a CLI/smoke caller can validate a query without the extension's copy of the compiler; the panel uses the shim directly and does not call it on every keystroke.

**4. Settings — new registry group `outliers` (6 knobs).** The flat, hand-tuned defaults the revision chose. All `scope: 'server'` — the panel reads them once through `GET /x/searches/defaults`, so none of them needs the mirrored blob (§7.24 stays untouched).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `x.outliers.minFaves` | number 0–100000 | `400` | Default likes floor. `0` = omit the operator. |
| `x.outliers.minRetweets` | number 0–100000 | `0` | Default reposts floor (off). |
| `x.outliers.minReplies` | number 0–100000 | `0` | Default replies floor (off). |
| `x.outliers.sinceDays` | number 1–365 | `30` | Default date window, back from today (local). |
| `x.outliers.lang` | string | `''` | Default `lang:` code; empty = omit. Must be in `SEARCH_LANGS` or the route drops it with a warn. |
| `x.outliers.sort` | enum `live`\|`top` | `top` | Default results tab. `top` because an outlier hunt wants best-performing, not newest. |

**5. Extension — new top-level `Outliers` tab.** `extension/src/searchQuery.ts` is a re-export shim over `src/shared/searchQuery.ts` (identical 4-line shape to `extension/src/replyBand.ts` / `humanize.ts`), so the form recompiles locally on every keystroke with **zero** network traffic and the preview line can never disagree with what the server would store. `sidepanel/Outliers.tsx` renders the form with `ui/Section` + `ui/SettingRow` primitives and `--strat-*` tokens, plus the saved list and a `SettingsGear` over the six `x.outliers.*` keys. `api.ts` gains a `searches` namespace. `App.tsx` gains the tab in the **Library** group, between `voice` and `replies` — it is an intake surface for the library, not part of the daily Operate loop.

**The hand-off is two buttons, in this order:**
- **Copy** (primary) — `navigator.clipboard.writeText(compiled.query)`, following `QuickReplyPicker.tsx:127–164`'s discipline exactly: the write happens inside the click handler (Chrome gates clipboard on a focused document + user gesture), and on refusal the button says so and the query stays visible and selectable in the monospace preview so the fallback is select-and-copy by hand.
- **Open in X** (secondary) — `readActiveContext()` from `harvestClient.ts:35`, then `chrome.tabs.update(tabId, {url, active:true})` when that tab is already on X, else `chrome.tabs.create({url, active:true})`. **Deliberately not `resolveTab()`** from the same file: that helper's contract is "a tab sitting on a harvest target with the content script handshaken", and a search-results page has no such handshake to wait for. Needs no new manifest permission — `harvestClient.ts:84–90` already makes both calls.

**Measurement:** `voice_tweets.source = 'outlier_search'` for tweets saved off a search-results page (Task 7), surfaced as one footer line on the tab. This overturns 08-03's "measurement: none" — see Revision item 5.

## Decisions taken

1. **Web dialect only ($0). The X API v2 path is not built.** Verified against `docs.x.com/x-api/posts/search/integrate/operators`: v2 has **no** `min_faves` / `min_retweets` / `min_replies` operator, at any access tier. On the API, "minimum engagement" could only be a client-side post-filter over `public_metrics` — and since X bills every result it *returns* ($0.005/other-user result), a `min_faves:50` search would pay for ~100 tweets to keep ~6. The web dialect supports the engagement operators natively at $0. This is also the shape **invariant #8** demands: adding a billed read back is a decision made out loud, and this plan makes the opposite one. `searchRecent` was deleted on 2026-08-12 and stays deleted. *(User choice.)*
2. **Results are worked on x.com, not scraped into the panel.** `content.ts`'s save-button attach (`content.ts:1325–1351`) anchors on `[data-testid="reply"]` + a permalink and is **path-agnostic** — verified by reading it: there is no path gate, so every result on a search page already carries **Save to stratus**. (The ⊕ Add to Radar pin is expected to be there on the same basis; confirm it in Task 8's browser pass rather than asserting it here.) Building a search-results harvester would duplicate `harvestClient.ts`'s port/scroll machinery for a page the existing buttons already cover. *(User choice.)*
3. **New top-level Outliers tab**, in the Library group. *(User choice, re-confirmed 2026-08-24.)*
4. **The compiler lives in `src/shared/`, not in the extension.** Server-side validation on POST and client-side live preview must agree byte-for-byte or the saved string differs from the previewed one; §7.27 forbids forking that logic. Shim, not a copy.
5. **Saved queries store the structured params, not the compiled string.** A compiled string can't be loaded back into the form, and a compiler fix (an operator X renames) then can't reach rows already saved. The string is derived on every read.
6. **`parseSearchQuery` normalizes at the storage boundary** (the `reply_lists.humanizer` pattern) — trim, drop empties, dedupe case-insensitively, coerce `0`/negative floors to absent, coerce an unknown `sort`/`replies`/`media` to its default, sort nothing (clause order is the compiler's job). A row read back therefore never needs re-validation.
7. **Problems are a list, not an exception.** The form must show *all* faults at once; a throw-on-first-error compiler makes fixing a four-field mistake a four-round-trip exercise.
8. **~~No settings-registry knob.~~ OVERTURNED 2026-08-24.** The six `x.outliers.*` knobs above. The 08-03 reasoning was "nothing here is a tunable threshold" — true when the plan had no defaults at all. Choosing flat hand-tuned floors makes the floors exactly a tunable threshold, and this repo puts those in the registry, where they get a gear, validation, and a reset for free. The 512 cap stays un-knobbed (it is X's number, not ours; a knob there only buys a silent 400).
9. **Mechanical names inside, job name outside.** Tab id `'outliers'`, `Outliers.tsx`, `docs/outliers-tab.md`; but `src/shared/searchQuery.ts`, `saved_searches`, `routes/searches.ts`, `api.searches`. The compiler is a general search compiler and will outlive the framing; the surface is an outlier hunt and should say so. Do not rename either half to match the other.
10. **Flat defaults, not a computed outlier threshold.** *(User choice, 2026-08-24, over two alternatives.)* The measured version — topic search: P90 of `harvest_rows.likes` over timeline captures in the last 30d; profile search: that author's median likes × 3, reusing `cannon/roster.ts::median` and gated at n≥20 with a labeled fallback — is **recorded here and deliberately not built**. If it is ever wanted it is its own plan with its own basis loader, because the honest version needs a provenance line in the UI ("P90 of 1,240 timeline tweets") and a recalibration clause, not a magic number. The follower-ratio variant was also declined: its engagement-rate constant is undefendable, and `account_snapshots` has been frozen since 2026-08-12 so "my follower count" is stale by construction.
11. **`GET /x/searches` returns an object, not an array.** Room for the capture count without a second mount-time round trip.

## Done when

1. A user fills the Outliers form with keyword groups + a minimum-likes floor, sees the compiled query and its character count update live, clicks **Copy**, pastes into x.com's search field, and gets results matching those constraints.
2. **Open in X** lands on an x.com search page for the same query without a copy step, reusing the active X tab when there is one.
3. Every result on that page carries the existing **Save to stratus** button, and clicking it stores rows exactly as it does on a profile timeline (no new capture code was written or needed).
4. A hunt saved by name survives a browser restart and a server restart, re-loads into the form with every field intact, and re-compiles to the same string.
5. Malformed input (unbalanced quote, bad handle, `until` before `since`, over-512, empty query) is refused with a specific per-field message and both Copy and Open are disabled — no request is made and no row is written.
6. The floors start at the registry defaults (400/0/0, 30 days, `top`), the ▲▼ stepper walks `FAVES_LADDER`, and changing a default in the tab's gear changes what the next fresh form opens with.
7. `bun scripts/smoke-outliers.ts` passes with **no `--live` flag existing**, because nothing under `/x/searches` can reach `xFetch` or `askLLM`.
8. A tweet saved from a search-results page reads back with `source = 'outlier_search'`, and the tab's footer counts them.

---

## Task 1: Pure query compiler in `src/shared/searchQuery.ts`  [parallel-ok]
**Depends on:** none
**Session budget:** ~380 lines + ~300 test lines; 2 files (both new)

**Read first:**
- codemap header + §3.1 (`src/shared/`), §7.23a (advisory vs refusal), §7.27 (shims), §7.33 (validate a borrowed claim), §7.35 (strict half vs degrading half)
- `src/shared/replyBand.ts` — the house shape for a pure shared module (exported constants, no imports beyond types, every branch a named predicate)
- `src/x/replyLists/engine.ts::parseHumanizerConfig` — the normalizing-validator shape this module's `parseSearchQuery` copies (field-by-field fallback, `null` only for a non-object)
- This plan's **Design §1 + §1b** — the correctness rules are the specification; implement them literally

**Edit:**
- `src/shared/searchQuery.ts` (new) — `SearchQuery`, `Problem`, `CompileResult`, `MAX_QUERY_LENGTH = 512`, `SEARCH_LANGS`, `FAVES_LADDER`, `nextRung`, `prevRung`, `parseSearchQuery`, `compileSearchQuery`, `searchUrl`
- `src/shared/searchQuery.test.ts` (new)

**How:**
Compile in the fixed clause order of Design §1: `all` terms (bare, space-joined) → `(a OR b)` for `any` → quoted phrases → `from:` / `to:` → `@mentions` → `#hashtags` → `-term` for each `none` → `min_faves:` / `min_retweets:` / `min_replies:` → reply filter → media filter → `filter:links` → `-filter:nativeretweets` → `lang:` → `since:` / `until:`. Join with single spaces. **Always parenthesize the `any` group**, including when it has one member — a later clause must never be able to re-associate it.

Reuse `USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/` (copy the constant; `routes/voice.ts:48` and `routes/replyLists.ts` each hold their own — this is the third and the shared module is the right home, but **do not refactor those two in this task**, it would put a route file in a pure-module diff).

`parseSearchQuery` must be total: a non-object (or `null`) returns `null`; anything else degrades field by field. Trim every string, drop empties, dedupe arrays case-insensitively preserving first-seen order, coerce non-finite/negative/zero engagement floors to `undefined`, coerce an unknown `sort`/`replies`/`media` to its default, cap each array at 20 terms and each term at 120 chars (over-cap terms are dropped, and the cap constants are exported so the route and the form can say so).

`compileSearchQuery` never throws and never returns a partial string on error — it returns the best-effort compiled string *plus* the problems, so the form can show both. `searchUrl` returns `null` iff `problems` contains any `level: 'error'`.

`nextRung(n)` returns the smallest `FAVES_LADDER` entry strictly greater than `n`, or the top rung when `n` is at or past it; `prevRung` mirrors it downward with a floor of `0` (meaning "off"). Pure, no clamping to the field's registry max — the form owns that.

**Do NOT** add a `dialect` parameter, an `api` compile path, or an `xFetch` import (Decision 1). **Do NOT** add any threshold estimator, follower reader, or corpus query — Decision 10, and this module has no DB access by construction anyway.

**Verification step (§7.33, do this before writing the compiler):** the operator set is user-verified for August 2026 (the cheatsheet folded into this plan at the 08-24 revision), so this is a **spot check, not a survey**: open x.com and run `min_faves:50 bun` and `("build in public" OR "indie hacker") min_faves:400 -filter:replies since:2026-07-01` in the search box by hand. Confirm both return plausibly filtered results. Record the verification date and the confirmed operator list in the module's header comment. If any operator has been retired, drop it from `SearchQuery` and say so in the header — shipping an operator X ignores produces a query that silently returns the *unfiltered* firehose, which looks identical to a working feature.

**Tests:** `src/shared/searchQuery.test.ts` —
- exact compiled string for a full-house query using every field (the golden case, asserted byte-for-byte)
- `any` of one member still parenthesized; `any` + `all` ordering
- uppercase `OR` (assert the string contains `' OR '` and not `' or '`)
- phrase with an inner `"` → error, not a strip
- `@handle` stripped to `handle` in `from`; a 16-char handle → error; a handle with a `.` → error; `#tag` stripped to `tag` in `hashtags`
- `replies:'exclude'` → `-filter:replies`; `'only'` → `filter:replies`; `'any'` → neither string present
- each `media` enum member → its own operator; `'any'` → no `filter:` media clause
- `minFaves: 0` and `minFaves: -3` both omit the clause entirely
- `until` before `since` → error; `2026-02-31` → error; `2026-7-1` → error
- unknown `lang` → error; `lang:'ro'` compiles (the cheatsheet's second language)
- empty query, and a query of only negations/filters/floors → error
- 512 overflow → `overLimit: true` + error, and `searchUrl` returns `null`
- keyword containing `:` → `warn`, and the query still compiles
- `searchUrl` encodes: assert the `q=` param round-trips through `decodeURIComponent` to the exact compiled string, and that `sort:'top'` emits `f=top`
- `nextRung`/`prevRung`: walk the whole ladder up and down; `nextRung(5000)` is `5000`; `prevRung(50)` is `0`
- `parseSearchQuery(null)`/`(42)`/`('x')` → `null`; `parseSearchQuery({all: ['  a  ', '', 'A']})` → `{all: ['a']}` (trim + dedupe case-insensitively)
- round-trip: `parseSearchQuery(JSON.parse(JSON.stringify(parseSearchQuery(x))))` is idempotent

**Done when:**
- [ ] Golden compiled string asserted byte-for-byte; every rule in Design §1 has a test
- [ ] The x.com operator spot check is done and its result + date recorded in the module header comment
- [ ] `compileSearchQuery` has no throw path (assert via a table of junk inputs)
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(outliers): pure x.com search-query compiler + validator`

**Cost note:** $0 — pure module, no imports outside `src/shared/`.

---

## Task 2: `saved_searches` table + migration `0031`  [parallel-ok]
**Depends on:** none (schema alone is coherent — Task 4 is its only consumer)
**Session budget:** ~40 lines; 2 files + 1 generated migration

**Read first:**
- codemap header + §4 (tables, migration discipline + the dropped-seed trap; **confirm the migration head is still `0030_famous_wrecker` before generating** — if another lane landed one first, this task owns the next number, not `0031`)
- `src/x/db/schema.ts` around `promptOverrides` / `commitments` (L746–L790) — the timestamp-default idiom to copy verbatim
- codemap §4's RQ.1 delta — the exact inspection ritual a migration commit owes

**Edit:**
- `src/x/db/schema.ts` — append `savedSearches` per the Design §2 sketch, with a header comment explaining that `query` holds `SearchQuery` JSON stored normalized through `parseSearchQuery`, that `last_run_at` null means never run (§7.11), and that there is no seed by design
- `src/db/migrations/0031_*.sql` + `_journal.json` (generated)

**How:**
Run `bun run db:generate`, then **inspect the emitted SQL** — it must be exactly one `CREATE TABLE`, no seed INSERT touched, no other table altered. `git diff src/db/migrations/` should show the new `.sql`, the snapshot JSON, and a `_journal.json` append, and nothing else. Boot a fresh `:memory:` DB and confirm the table exists with the expected columns and that the three `content_pillars` seed rows still land (the standing §4 check — the seeds are `INSERT OR IGNORE`, so grep for that form, not `INSERT INTO`).

Timestamps copy the `commitments` / `promptOverrides` idiom verbatim — a `timestamp_ms` integer column defaulted to the `unixepoch() * 1000` SQL expression, `notNull`. **Prefer no index** and say so in the comment: a single-user table of tens of rows sorted in memory needs none, and an unused index is a claim about scale this feature does not have.

**Do NOT** write any route or consumer in this task, and do not run it in parallel with another migration-generating session (journal conflicts — CLAUDE.md stack rule).

**Tests:** none new — schema-only. The fresh-boot column check is a manual step in this task's done-when.

**Done when:**
- [ ] `bun run db:generate` emitted exactly one `CREATE TABLE`, inspected, no seed dropped
- [ ] Fresh `:memory:` boot creates the table and the `content_pillars` seeds still land
- [ ] Table count is 44 (re-count, don't trust this plan's number)
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(outliers): saved_searches table + migration 0031`

**Cost note:** $0 — DDL only.

---

## Task 3: `outliers` settings group (6 knobs)  [parallel-ok]
**Depends on:** none
**Session budget:** ~90 lines + ~30 test lines; 2 files

**Read first:**
- codemap header + the "Settings platform (UI.1)" bullet in §7
- `src/x/settings/registry.ts` — the `RADAR` block (L452–L500) as the shape to copy: one `const OUTLIERS: SettingDef[]`, appended to the exported array, plus a `GROUP_LABELS` entry (L1008+)
- `src/x/routes/settings.test.ts` — how a group is asserted

**Edit:**
- `src/x/settings/registry.ts` — the `OUTLIERS` block per Design §4, `GROUP_LABELS.outliers = 'Outliers'`, and the group pushed in the same order it should render (after `sweep`/`cannon`, before `workers`)
- `src/x/settings/registry.test.ts` (or the existing settings test file) — the group's presence, defaults, and bounds

**How:**
All six are `scope: 'server'` — the panel reads them through `GET /x/searches/defaults` (Task 4), never through the mirrored blob, so `src/shared/serverSettings.ts` and `SERVER_DEFAULTS` are **not** touched (§7.24 stays clean). `x.outliers.sort` is an `enum` def — copy `x.sweep.media`'s shape, which is the registry's existing enum example. `x.outliers.lang` is a plain `string` with `default: ''`; the registry does not validate membership in `SEARCH_LANGS` (a registry def cannot import a shared module's constant without a cycle risk) — Task 4's route drops an out-of-allowlist value with a warn instead, and the knob's `description` says so.

Write each `description` as the *why*, not the *what*: `minFaves`'s should carry the cheatsheet's advice ("start at 300–500 and raise it until the results thin out"), because that description is the only place a user meets the tuning guidance.

**Do NOT** add a knob for `MAX_QUERY_LENGTH` (Decision 8) or any threshold estimator input (Decision 10).

**Tests:** the group appears in `settingsByGroup` with 6 defs; each default matches Design §4; `validateSettingValue` refuses `x.outliers.sort: 'newest'` and accepts `'live'`/`'top'`; a negative `minFaves` is refused.

**Done when:**
- [ ] `GET /x/settings` returns the `outliers` group with all six knobs and the group label
- [ ] Registry counts re-counted and recorded for Task 8 (expected 69 knobs / 16 groups / 33 mirrored — verify, don't trust)
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(outliers): outliers settings group — default engagement floors + window`

**Cost note:** $0 — registry defs only.

---

## Task 4: `/x/searches` routes + mount
**Depends on:** Task 1, Task 2, Task 3
**Session budget:** ~330 lines + ~280 test lines; 3 files (2 new)

**Read first:**
- codemap header + §3.4 (routes), §7.20 (static path before `:param`), §7.13 (sync SQLite, no JS `Date` in raw `sql`), §7.23a (advisory vs refusal)
- `src/x/routes/replyLists.ts:1–120` — the CRUD exemplar: the route-list header comment, the validation-constant block, the `readJson` + per-field 400 ladder, the normalized-storage discipline (`humanizer` ↔ `parseHumanizerConfig`)
- `src/x/routes/sweepPresets.ts:1–20` — its header comment is the model for stating a router's $0 guarantee; **note the contrast this plan's Design §2 calls out — its "clients never send values" rule does NOT apply here**
- `src/shared/searchQuery.ts` (Task 1) — the full exported surface
- `src/x/index.ts:14–60` (imports) and `:71–160` (mount block)

**Edit:**
- `src/x/routes/searches.ts` (new) — `searchesRouter`, the 8 routes in Design §3
- `src/x/routes/searches.test.ts` (new)
- `src/x/index.ts` — import + `app.route('/x', searchesRouter)`; mount it in the always-mounted block near `replyListsRouter` (line ~122). **Not** LLM-gated (§7.22) — there is no LLM call here at all.

**How:**
Every write path runs the body's `query` through `parseSearchQuery` and stores `JSON.stringify` of the *normalized* result — never the raw body. A `null` from `parseSearchQuery` is `400 invalid_query`. Then run `compileSearchQuery` on the normalized value: if it yields any `level: 'error'` problem, **still 400** with `{ error: 'invalid_query', problems }` — an uncompilable saved search is a row whose Copy button can never work, and storing it just moves the failure to read time. Warnings do not block (§7.23a).

`GET` paths hydrate each row: `JSON.parse` the `query` (wrapped — a hand-edited row via `/explorer` must not 500 the list; a parse failure degrades that row to `compiled: null, url: null` rather than dropping it, so the user can see and delete it). Order `pinned desc, updated_at desc`.

`/searches/compile` and `/searches/defaults` must be registered **before** `/searches/:id` (§7.20 — the same trap followups/fans hit against `/people/:handle`). Same for `/searches/:id/run` vs `/searches/:id`: Hono matches in registration order, so register the more specific first.

`/searches/defaults` builds a `SearchQuery` from the six `x.outliers.*` knobs via the bound `getSetting` (never the store directly — §7 settings platform), computes `since` as *today minus `sinceDays`* in the **server's local date**, and drops `lang` with a `warn`-level problem if the configured code is not in `SEARCH_LANGS`. It returns `{ query, ladder: FAVES_LADDER }` so the panel's stepper and the server's floors can never disagree about the rungs.

`/searches/:id/run` stamps `last_run_at` and returns the URL. Use `new Date()` through Drizzle's `timestamp_ms` column (never a raw `sql` template with a bound `Date` — §7.13). If the stored query no longer compiles, return `409 uncompilable` with the problems and **do not** stamp `last_run_at` — a run that couldn't happen is not a run.

`GET /x/searches`'s `capture` field is Task 7's; until then return `{ savedFromSearch: 0, days: 30 }` **from a real `COUNT(*)` that will simply be 0** (a `SELECT count(*) … WHERE source = 'outlier_search'`), not a hardcoded literal — so Task 7 changes the writer, not this reader, and the field is never a lie waiting to be replaced.

Validation constants: `MAX_NAME_LEN = 120`, `UUID_RE` (copy from `replyLists.ts`). `PATCH` is partial — an absent key means "unchanged", an explicit `null` on `name` is a 400 (it's `notNull`).

**Do NOT** add an MCP tool (Out of scope — it would bump `src/mcp.test.ts`'s exact asserted count of **28** and three counts in `docs/s2-mcp-server.md`, for a surface an agent has no reason to drive). **Do NOT** import `xFetch`, `askLLM`, or anything from `src/x/endpoints.ts`.

**Tests:** `src/x/routes/searches.test.ts`, over in-memory SQLite, imitating `replyLists.test.ts`'s harness —
- POST → GET round-trip; stored `query` is the normalized form, not the raw body (assert a raw `{all:['  a  ','A']}` reads back as `{all:['a']}`)
- POST with a query that compiles with errors (e.g. `until` < `since`) → `400 invalid_query` with `problems` populated, and **no row written**
- POST with a warn-only query → `201`
- POST invalid name (empty, >120) → `400 invalid_name`
- GET list shape is `{searches, capture}`, ordering pinned first then `updated_at` desc
- GET list with a row whose `query` column is hand-corrupted JSON → `200`, that row present with `compiled: null`, others intact
- `POST /x/searches/compile` returns a compile result and *not* a 404-from-`:id`; same for `GET /x/searches/defaults` — both would fail if the registration order regressed
- `/searches/defaults` reflects a PATCHed `x.outliers.minFaves`, and its `since` is `sinceDays` back from today
- `/searches/defaults` with `x.outliers.lang = 'zz'` drops the field and returns a warn-level problem
- `POST /:id/run` stamps `last_run_at` and returns the URL; a second run updates the stamp
- `POST /:id/run` on an uncompilable row → `409`, `last_run_at` unchanged
- PATCH partial (name only) leaves `query` untouched; PATCH `query` re-normalizes
- DELETE → 204 then 404; all paths 404 on an unknown uuid, 400 on a malformed one

**Done when:**
- [ ] All 8 routes behave per the Design §3 table, including both 404 and 409 arms
- [ ] Static paths are registered before `/searches/:id`, with tests that would fail if reordered
- [ ] Route grep confirms no `xFetch` / `askLLM` / `endpoints.ts` import in `searches.ts`
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(outliers): /x/searches CRUD + compile/run/defaults routes`

**Cost note:** $0 — pure SQL + the pure compiler. No paid call is reachable from this router.

---

## Task 5: Outliers tab — form, live preview, Copy + Open in X, saved list
**Depends on:** Task 1, Task 4
**Session budget:** ~360 lines; 6 files (2 new)

**Read first:**
- codemap header + §5 (extension), §7.24–27 (background is the single session writer; one transport via `ApiRequest`; content script is an IIFE; shims), §7.28 (manual paste), the UI-primitives and chip-taxonomy bullets in §7
- `extension/src/replyBand.ts` — the 4-line shim shape to copy exactly (comment explaining *why* the canonical module is shared, then the re-export)
- `extension/src/sidepanel/ReplyLists.tsx` — the house shape for a list+editor tab built on `ui/Section` + `ui/SettingRow`
- `extension/src/sidepanel/QuickReplyPicker.tsx:120–170` — the clipboard discipline to copy verbatim (write inside the click handler; on refusal, keep the text visible and say so)
- `extension/src/sidepanel/harvestClient.ts:22–95` — `readActiveContext` (reuse) and `resolveTab` (deliberately do **not** reuse)
- `extension/src/sidepanel/App.tsx:21–78` — the `Tab` union and `TAB_GROUPS`
- `extension/src/sidepanel/api.ts` — the `replyLists` namespace as the shape to copy
- `extension/tsconfig.app.json` — the `include` array the new shim must join (11 out-of-tree entries → 12)

**Edit:**
- `extension/src/searchQuery.ts` (new) — the re-export shim
- `extension/tsconfig.app.json` — add `"../src/shared/searchQuery.ts"` to `include`
- `extension/src/sidepanel/Outliers.tsx` (new) — the whole surface
- `extension/src/sidepanel/api.ts` — a `searches` namespace (`list`, `create`, `get`, `patch`, `remove`, `run`, `defaults`); **no `compile` method**, the panel compiles locally
- `extension/src/sidepanel/App.tsx` — `'outliers'` in the `Tab` union, `{ id: 'outliers', label: 'Outliers' }` in the **Library** group between `voice` and `replies`, and the render branch
- `extension/src/shared/types.ts` — `SavedSearch` / `SavedSearchCreateBody` wire types (re-export `SearchQuery` from the shim, **do not redeclare it** — the HM.3/D180a lesson: a redeclared mirror drifts)
- `extension/src/sidepanel/styles.css` — `.outlier-*` classes, tokens only

**How:**
The form calls `compileSearchQuery` from the shim on every render — it is pure and microseconds, so there is no debounce and no `useMemo` ceremony beyond the obvious one. Render the compiled string in a monospace preview block with `length/512` and, when over, the count in the danger tone. Render `problems` inline next to their `field` (that's what the `field` key is for), errors in danger tone, warnings in the warn tone, using existing `--strat-*` tokens and the `.chip-{warn,strong}` tones — **no new color literal outside `:root`**.

On mount: `api.searches.defaults()` seeds a fresh form, `api.searches.list()` fills the saved list. A form the user has touched is never re-seeded by a later defaults fetch.

**Copy** (primary) is disabled iff any error problem, and follows `QuickReplyPicker`'s clipboard discipline exactly. **Open in X** (secondary, same disable rule): `searchUrl(q)` locally, then `readActiveContext()` → `chrome.tabs.update` when that tab is on X, else `chrome.tabs.create`. For a *saved* search also fire `api.searches.run(id)` for the `last_run_at` stamp — fire-and-forget, a failed stamp must never block the clipboard or the tab (§7.8, best-effort side write). An unsaved ad-hoc query skips the stamp entirely.

Saved list: name, a one-line compiled-query preview (truncated), "last run" relative time or "never", and Copy / Load / Delete. Loading replaces the form state. "Save as…" on a dirty form POSTs; editing a loaded one PATCHes.

`useState` for form state, no reducer, no form library. Persist the *unsaved draft* form state to `chrome.storage.local` under `outliers:draft` so a panel close doesn't lose a half-built query — read `sidepanel/storage.ts` for the existing key conventions first, and note this is a panel-owned control key, not session buffer state, so §7.24's single-writer rule does not apply (the `radar:replyGoal` precedent).

**Do NOT** touch `extension/src/content.ts` in this task (Task 7 owns its one-field change). **Do NOT** add a `SubTabs` split; this tab is one view. **Do NOT** add the channel/target prefills or the ladder stepper here — Task 6 owns them, and this task is already at budget.

**Tests:** panel components carry no unit tests by convention (§5) — the suite count should not move for this task. The shim and the compiler are covered by Task 1. Verify with `cd extension && bun run build` plus a grep over `dist/sidepanel.js` for the operator strings (`min_faves`, `-filter:replies`, `x.com/search`) proving the shared module inlined into the build.

**Done when:**
- [ ] The Outliers tab renders in the Library group; the form compiles live and the preview updates on every keystroke with **no network request** (verify in devtools Network)
- [ ] Copy puts the exact previewed string on the clipboard; a refused clipboard leaves the string visible and says so
- [ ] Open in X reuses the active X tab when there is one, else opens a new one, and the results page shows the **Save to stratus** button on every result
- [ ] Save / Load / Delete round-trips against the server; "last run" stamps
- [ ] Every error problem disables both buttons and is shown next to its field
- [ ] `cd extension && bun run build` green + the `dist/sidepanel.js` grep passes
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(outliers): Outliers tab — query builder, clipboard hand-off, saved hunts`

**Cost note:** $0 — two $0 GETs on mount, $0 writes per save, a clipboard write and a `tabs.update`. No paid call is reachable from this tab.

---

## Task 6: Prefills — channel keywords, target roster, faves ladder, gear
**Depends on:** Task 5
**Session budget:** ~200 lines; 3 files

**Read first:**
- codemap header + §5, the UI-primitives bullet and §7's `SettingsGear` / `useSettingsEditor` entries
- `extension/src/sidepanel/SettingsGear.tsx` + `settingsEditor.ts` — the one settings-editing discipline; **one `useSettingsEditor` per tab**, never two
- `extension/src/sidepanel/Voice.tsx:34–60` — how a tab declares its `*_SETTING_KEYS` array for its gear
- `src/x/routes/voice.ts:311–416` (`GET /voice/targets`) and `src/x/routes/channels.ts` — **both routes already exist**; this task adds no server code
- `src/shared/channelSuggest.ts` — the channel `keywords` shape

**Edit:**
- `extension/src/sidepanel/Outliers.tsx` — the three prefills + the gear
- `extension/src/sidepanel/api.ts` — reuse the existing `channels` and `voice.targets` namespaces if present; add only what is missing
- `extension/src/sidepanel/styles.css` — chips for the prefill rows

**How:**
Three affordances, each a one-click *seed* that lands in an ordinary editable field — never a hidden filter:

1. **Channel keywords → the `any` group.** A chip row of active channels; clicking one appends its `keywords` into the `any` field (deduped against what is already there). Channels without keywords are rendered disabled with a title saying so, not hidden — a channel that can't seed is information.
2. **Target roster → `from:`.** A picker over `GET /x/voice/targets` (the 2–10× band, already ranked by `rankTargets`), showing handle + follower count. Selecting one sets `from:` and switches the form's framing to a profile hunt. The follower count is shown as **context only** — it does not compute a threshold (Decision 10).
3. **The ladder.** ▲▼ steppers on each of the three engagement fields, walking `FAVES_LADDER` via `nextRung`/`prevRung` from the shim. The rungs come from `api.searches.defaults()`'s `ladder` field so the panel and server cannot disagree.

Plus a `SettingsGear` over `OUTLIER_SETTING_KEYS` (the six `x.outliers.*` keys), fed by this tab's own single `useSettingsEditor` — the Voice/Radar pattern. `SettingsGear` renders `null` when its keys are unavailable (old server, key renamed), which is the desired degradation.

**Do NOT** make any prefill implicit: no auto-loading a channel because the keyword text matched, no auto-setting `from:` because a target was recently viewed. The human confirms every seed — the same rule `suggestChannels` has always carried.

**Tests:** panel-only, so no new unit tests (§5). If any pure helper falls out of this task (e.g. a dedupe-merge for the keyword append), put it in `extension/src/shared/` and bun-test it there rather than inlining it in the component.

**Done when:**
- [ ] Clicking a channel chip appends its keywords to the `any` field, deduped, and the preview updates
- [ ] Selecting a target sets `from:` and shows that account's follower count as plain context
- [ ] ▲▼ walk the ladder in both directions and stop at the ends
- [ ] The gear opens the six `x.outliers.*` knobs and a PATCH there changes what the next fresh form seeds with
- [ ] `cd extension && bun run build` green
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(outliers): channel/target prefills, faves ladder, settings gear`

**Cost note:** $0 — two more $0 GETs on mount.

---

## Task 7: Capture provenance — `source = 'outlier_search'`
**Depends on:** Task 4, Task 5, Task 6

> **Not parallel with Task 6** (masterplan D195, corrected 2026-08-24): this task renders the
> capture-count footer *in the tab*, so Tasks 5, 6 and 7 all write `Outliers.tsx`. Either
> serialize them, or move the footer render into Task 6 and leave this task purely
> server + content-script — decide once and record which.

**Session budget:** ~60 lines + ~40 test lines; 4 files

**Read first:**
- codemap header + §7.16 (server-stamped fields) and the RA.2 bullet in §5 (`pathFromTabUrl`, and *why* it is read in `background.ts` off `sender.tab?.url`)
- `src/x/routes/voice.ts:64–110` — the scrape route's insert, where `source: 'extension_scrape'` is currently hardcoded
- `src/x/routes/voice.ts:788–850` — `parseScrapedTweet` / `parseScrapedAuthor`, the parse shape a new field must join
- `extension/src/content.ts:1280–1310` — where the `ScrapeBody` is assembled

**Edit:**
- `extension/src/content.ts` — add `sourcePath: location.pathname` to the scrape body
- `src/x/routes/voice.ts` — parse it, and derive `source` from it on **insert only**
- `src/x/routes/voice.test.ts` — the two arms
- `src/x/routes/searches.ts` — nothing (Task 4 already returns the real `COUNT(*)`)

**How:**
The client reports the path; the **server decides the source** — `/search` prefix → `'outlier_search'`, anything else → `'extension_scrape'`. A malformed or absent `sourcePath` degrades to `'extension_scrape'` (§7.35: this field is in the degrading half — a lost provenance stamp must never cost a save).

**Why the path is read in the content script here, when RA.2 reads it in `background.ts`.** RA.2's sightings are *buffered and flushed later*, so the tab can navigate while a batch is in flight and only `sender.tab?.url` is trustworthy at send time. A scrape POSTs immediately, from the very document that owns the article — there is no in-flight navigation window, so the page's own `location.pathname` is exactly as good and does not require special-casing one path inside the generic `ApiRequest` transport (§7.25).

**`source` is set on INSERT only** — the existing `onConflictDoUpdate` set-clause must **not** be extended to touch it. First save wins: a tweet found through a hunt and later re-saved off the timeline keeps its `outlier_search` provenance, and vice versa. Say this in a comment; it is the kind of rule a later "make re-save refresh everything" edit will quietly break.

Then render the count: one footer line on the Outliers tab off `GET /x/searches`'s `capture` field — "N tweets saved from search results, last 30 days". When `N` is 0, say "none yet" rather than hiding the line: a zero here is the feature's own report card.

**Do NOT** add a column, a migration, or a new `source` value beyond these two. **Do NOT** widen `isHomeTimelinePath` to let passive harvest run on `/search` — HV.2 decision 2 makes `harvest_rows` mean "what the algorithm fed me", `loadTimelineFunnel` and `GET /harvest/affinity` both depend on that, and widening it owes a provenance field and a review of both readers. That is a different plan.

**Tests:** `src/x/routes/voice.test.ts` — a scrape with `sourcePath: '/search?q=…'` writes `source: 'outlier_search'`; one with `/home` (and one with the field absent, and one with a non-string) writes `'extension_scrape'`; a re-save of an `outlier_search` row from `/home` leaves `source` unchanged.

**Done when:**
- [ ] A tweet saved from a search-results page reads back with `source = 'outlier_search'`
- [ ] Re-saving it from the timeline does not overwrite that
- [ ] The tab's footer shows the count, and says "none yet" at zero
- [ ] `cd extension && bun run build` green
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(outliers): stamp swipe-file saves from search results`

**Cost note:** $0 — one extra string on an existing $0 POST.

---

## Task 8 (final): docs-sync + smoke
**Depends on:** all prior.
**Session budget:** ~1 new file + 7 doc files

- [ ] `scripts/smoke-outliers.ts` — rerunnable, **$0, and ships NO `--live` flag**: nothing under `/x/searches` reaches `xFetch` or `askLLM`, so there is no paid claim a keyless run fails to make (the D171c question, same answer as `smoke-humanizer.ts` and the opposite of `smoke-radar-curate.ts` — state that reasoning in the script header). Cover: `GET /searches/defaults` reflects the registry → create a `__smoke_outliers__`-prefixed saved search → GET it back and assert the compiled string **byte-for-byte** → assert the `url` decodes to that same string → run it and assert `last_run_at` moved → PATCH the query and assert recompilation → POST an uncompilable query and assert `400` + `problems` → assert a warn-only query saves → assert the `capture` field is present and numeric → delete and assert `404`. **Read back after every write** (the RC.5 lesson) — a green call is not proof a column exists. Restore/cleanup fires the instant the DB half ends, including on failure, and must also restore any `x.outliers.*` knob the script PATCHed (the `smoke-radar-access.ts` snapshot-restore pattern).
- [ ] `docs/PHASE-HISTORY.md`: the phase entry (what shipped, date, $0, and the two load-bearing gotchas — "v2 has no engagement operators, which is why this is a web-dialect feature" and "a retired operator is ignored, not rejected").
- [ ] `CLAUDE.md`: **only** if a guardrail changed — it does not here. Leave it alone and say so in the commit body.
- [ ] `PLAN.md`: phase blockquote (this serves goals 3–4's intake, so PLAN.md is the right doc, not CIRCLES/SURFACES).
- [ ] `docs/outliers-tab.md` (new) — the form fields, what each compiles to, the problem-severity model, the clipboard-vs-open hand-off, the saved-hunt lifecycle, the ladder, and an explicit note that the API dialect does not exist and why.
- [ ] `docs/voice-tab.md` + `docs/radar-tab.md`: one cross-reference line each — search results are a capture surface for both; `voice-tab.md` also documents the `outlier_search` provenance value.
- [ ] `docs/settings-tab.md`: the `outliers` group **and** its four count strings, which the RA.8 entry records as having gone stale unasserted before — re-count them, don't increment them.
- [ ] `.claude/skills/plan-feature/references/codemap.md`: §3.1 (`src/shared/searchQuery.ts`), §3.4 (the router), §4 (table count 44, migration head `0031`), §5 (the new tab, the new shim, the `include` count, **and the unstamped `b92d783` calendar-tray change**), §7 (nothing new — but check whether the clipboard hand-off deserves a line under §7.28), §9 (smoke script count 41), §11 (update-log entry), header re-stamped to the new commit. **Re-count each of these from the repo at commit time — do not carry forward the numbers this plan was written against** (the D164a trap this plan already fell into once: every count in the 08-03 draft had rotted by 08-24).
- [ ] Browser pass: confirm ⊕ Add to Radar appears on search results (Decision 2 asserts only the Save button from a code read). If it does not, record that in `docs/outliers-tab.md` rather than fixing it here.

## Out of scope (do NOT build)

- **Any X API v2 search path.** No `searchRecent` caller, no `dialect: 'api'`, no post-filter over `public_metrics`, no "estimated spend" UI. Decision 1, and invariant #8.
- **Any computed outlier threshold** — follower-ratio, timeline percentile, or author-median basis. Decision 10 records the recipe; it is a separate plan with its own basis loader, provenance line, and recalibration clause.
- **A search-results scraper.** No new content-script capture code, no `SEARCH_PORT`, no bulk ingest into `voice_tweets`. Decision 2 — the existing per-tweet buttons cover it. Task 7's one field is provenance, not capture.
- **Widening `isHomeTimelinePath`** so passive harvest runs on `/search`. See Task 7's "Do NOT".
- **An MCP tool.** It would bump `src/mcp.test.ts`'s exact asserted count (**28**) and three counts in `docs/s2-mcp-server.md`, for a surface an agent has no reason to drive. If a session ever does want paste-ready hunts, the smallest honest version is one curated tool over `GET /x/searches` — one tool, no compiler fork.
- **Scheduled/recurring searches, a saved-search worker, result-diffing, or "notify me when this query has new hits."** All of them turn a $0 open-a-tab feature into a polling surface, and X's web search cannot be polled without a browser.
- **Refactoring `USERNAME_RE` out of `routes/voice.ts` / `routes/replyLists.ts`** into the shared module. Correct eventually, wrong inside these diffs.
- **`point_radius:` / `bounding_box:` / `place:` / `context:` / `entity:` / `list:` / `url:` operators.** Real operators, no demand; each is a field, a validator, a test, and a docs line.

## Risks / watch items

1. **The web dialect's operator set is not documented by X** (`help.x.com` 403s to fetch, and `docs.x.com` covers the *API* only, where these operators do not exist). The 2026-08-24 cheatsheet is a **user-verified** snapshot of what worked that month, which is the best evidence available and better than the 08-03 draft had — but it is still undocumented surface X can retire without notice. The failure mode is the dangerous kind: a retired operator does not error, it is *ignored*, so the query silently returns the unfiltered firehose and a broken feature looks exactly like a working one. Mitigations: Task 1's spot check plus the verification date in the module header, and `docs/outliers-tab.md` telling the user that "suddenly way more, lower-engagement results" is the symptom to report.
2. **`MAX_QUERY_LENGTH = 512` is borrowed from the API's self-serve recent-search limit**, not measured against x.com's web search, whose real cap is unknown and probably higher. It is deliberately the tighter bound — over-restricting produces a visible, fixable error, while over-permitting produces a truncated query that silently matches the wrong thing. Recalibrate only if a real query is ever refused at the cap, and only by measurement.
3. **The default floors (400/0/0, 30 days) are opening guesses from the cheatsheet, not measurements** — the house rule (§7.33, "a number is a measurement or it is absent") is knowingly bent here because the user chose hand-tuning over machinery. They are registry knobs precisely so tuning costs a click, and `docs/outliers-tab.md` must label them as borrowed. If they are ever to become measured, that is Decision 10's plan, not a quiet edit to a default.
4. **The `f=live` vs `f=top` URL parameter is undocumented** in the same way. If X renames it the results just come back in the other sort order — a degradation, not a break.
5. **Task 2 must not run in a parallel session with any other migration-generating work** (journal conflicts). It is `[parallel-ok]` with Tasks 1 and 3 only because neither touches a migration. **Re-check the migration head before generating** — `0031` is this plan's claim as of 2026-08-24, not a reservation.
6. **Rollback story:** every layer is independently removable. Task 7 alone → the field is ignored and every save reads `extension_scrape`. Task 6 alone → the prefills are additive UI. Task 5 alone → drop the tab from `TAB_GROUPS` (the union member and file can stay, unreferenced). Task 4 alone → comment out the one `app.route('/x', searchesRouter)` line. Task 3's knobs are inert without Task 4. Task 2's table is additive and unread by anything else. Task 1 is a pure module with no importers until Task 4. Shipping Tasks 1–3 and stopping leaves the repo green with dead-but-harmless code; shipping 1–4 and stopping leaves a working $0 API with no UI.
