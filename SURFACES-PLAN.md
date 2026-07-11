# SURFACES-PLAN.md — Close the loops, open the surfaces

> Successor plan to `CIRCLES-PLAN.md` (C0–C9 all shipped 2026-07-05). Drafted 2026-07-10;
> adopted in order since: S0.2–S0.9 shipped 2026-07-10/11, S1 + S2 shipped 2026-07-11,
> **S3 shipped 2026-07-11** (see `CLAUDE.md` phase status). Same contract as the previous
> plans: phases adopted in order, each ends usable, `CLAUDE.md` phase-status updated in
> the same commit a phase lands.

## 0. Why this plan

CIRCLES finished the *relationship machine*: every reply, mention, hover and idea now
lands in a people-centric CRM with a measured feedback loop. Two things are still true:

1. **Several loops are measured but not closed.** The system computes best posting
   times nobody consumes, counts profile clicks without ever asking "did they follow?",
   ranks the Radar blind to who the author *is to me*, and stamps reply latency into
   every draft without ever grading it. Phase S0 is a batch of small, mostly-$0 patches
   that turn dormant measurements into daily decisions. It ships first because it also
   creates the **baselines** phases S3/S4 will be judged against.

2. **The data has exactly one consumer: the side panel.** Three new surfaces open it up:
   a raw **data explorer** (S1), an **MCP server** so Claude Code can reason over the
   production DB (S2), and a **visual studio** for AI + deterministic canvas imagery
   (S3/S4). S1 deliberately builds the read-only data core that S2 reuses; S3 builds the
   deterministic composition frame that S4's AI layers slot into.

Scope check against the four goals: S0/S1/S2 serve goals 2 and 4 (metrics over time,
people context); S3/S4 serve goal 1 (better posts) and the profile-conversion half of
goal 4. Nothing here adds recurring X API spend beyond one field on an already-billed
read.

**The one hard constraint shaping S3/S4:** `/2/media/upload` still requires OAuth 1.0a
(CLAUDE.md gotcha, unchanged) — stratus **cannot attach images to API-published posts**.
The studio is therefore an *asset pipeline ending in a human paste*: compose → PNG →
clipboard → manual attach in the X composer. Banner and profile pic are manual uploads
anyway. No OAuth 1.0a work in this plan.

---

## 1. Phase S0 — Close the measurement loops ($0 recurring)

Nine independent patches, each its own commit, in this order (cheapest-first, baseline
patches early). All pure-SQL/pure-TS over data already collected unless noted.

### S0.1 Profile conversion rate — "is my profile leaking?"

The doctrine's whole currency is the earned profile visit, but nothing asks whether
visits convert. Both series already exist: `account_snapshots` (daily follower count)
and `metrics_snapshots.user_profile_clicks` (per own tweet, stamped once at the daily
pass). New pure helper in `src/x/quests.ts`-style module (`src/x/conversion.ts`):
trailing-7d and trailing-28d **conversion = follower delta ÷ Σ profile clicks on tweets
posted in that window** (guard: null when clicks < 20 — same min-sample discipline as
everything else). Surface: one line in `GET /x/brief` (Today tab, next to the follower
sparkline: "312 profile visits → +9 followers · 2.9%") and in the Sunday digest FACTS
block. When S3/S4 ship a new banner/pfp, this is the number that says whether it worked.

### S0.2 `has_media` baseline — measure image lift *before* shipping images

`posts_published` doesn't record whether a tweet carried media, so when the studio
lands there will be no text-only baseline to compare against. Add `attachments`
(media_keys presence) to the tweet fields requested by the dailyMetrics **discovery**
pull (same owned read, still $0.001 — verify the field rides free before landing);
stamp new nullable `posts_published.has_media` integer-boolean at discovery. Backfill
impossible (fields not stored) — rows before the patch stay null and every aggregation
treats null as "unknown", never "no". Consumer: one gated Playbook cell, media vs
text-only median views/profile clicks (n≥20 per side).

### S0.3 Roster-aware Radar ranking — who the author is beats how loud the post is

`rankSightings` (extension/src/shared/radar.ts:88) sorts band → vpm → recency, blind to
the people layer. A warm post from a `mutual` or an in-band 2–10x target compounds an
existing relationship; a hot post from a rando is a lottery ticket. Patch: the
background fetches a lightweight handle → `{stage, isTarget}` map (new cheap endpoint
`GET /x/people/rankmap` returning only handles at stage ≥ engaged plus the current
targets roster; cached 10 min) on the radar rehydrate cadence and stamps
`RadarSighting.personTier: 'ally'|'mutual'|'target'|null` at merge time. `rankSightings`
gains a leading tier comparison (ally/mutual → target → null), band/vpm/recency
unchanged within a tier; rows render a stage chip that click-through to the dossier.
Pure logic stays in `radar.ts` with tests.

### S0.4 Best-times → Composer — the loop that was computed and never consumed

`GET /x/metrics/best-times` has zero consumers. (a) Composer's schedule picker shows the
top-3 cells for the selected weekday ("Wed 17:xx — 2.1k avg views/day, n=6") with a
one-click "next best open slot" that respects the cadence ladders **and applies the
mandatory minute jitter — never top-of-hour**. (b) `GET /x/brief`'s cadence-gap
detection annotates each gap with its best-times score so the strategist fills the
highest-value hole first. Cells below n=3 render as "no data", never as advice.

### S0.5 Reply-latency × outcome — grade the doctrine's "reply early" claim

`signals.ageMin` (tweet age at capture) is stamped into every draft's
`contextSnapshot`, and the doctrine bets everything on early replies — unmeasured. New
Playbook aggregation: posted+measured replies bucketed by age-at-draft (<15m, 15–60m,
1–6h, >6h, unknown) × median views/profile clicks, n≥20 gate. If early really wins,
this justifies the Radar/Launch-Room machinery with a number; if it doesn't, it
recalibrates where effort goes. Pure function in `src/x/playbook.ts` + one Playbook-tab
table.

### S0.6 Re-up candidates in Do-next — winners shouldn't need remembering

§8.5's self-quote re-up is pull-only (a button on leaders). New followup kind
`reup_candidate` in `src/x/people/followups.ts`'s classifier family (it's not a person
item — add it in `GET /x/people/followups`' assembly, lowest priority above `momentum`):
own non-reply posts 14–60d old whose measured views cleared `WINNER_REREAD_MIN_VIEWS`,
with no existing draft/scheduled row carrying that `quote_tweet_id`. Cap 1 per queue
read (the single best), snoozeable via the existing `followup_snoozes` (`reup:<tweetId>`
key). Click-through drafts via the existing `/x/posts/reup`.

### S0.7 Roster coverage line — are replies going where they can convert?

The 70/30 ratio is tracked; *where* the 70 goes is not. One gated Playbook/brief line:
of the trailing 7d's posted replies, % whose source author is in the 2–10x target band
(followers from `people`, `voice_authors` fallback — same resolution as the angle
crosstab) vs above-band vs below-band vs unknown. Doctrine target: majority in-band.
Pure SQL, renders in the Playbook tab and one summary line in the Sunday digest facts.

### S0.8 Idea → outcome — does the Idea Inbox actually pay?

C6 stores consume-provenance (`ideas.consumed_by_table/-id`) and nothing reads it back.
One gated Playbook cell: median measured views/profile clicks for idea-seeded posts and
replies vs unseeded, n≥20 per side. Join: `ideas` → `scheduled_posts`/`reply_drafts` →
`posts_published` → latest snapshot (the §6.2 join, reused).

### S0.9 Pinned-post watch — the profile's landing page goes stale silently

Profile visits land on the pinned tweet, and nothing tracks what's pinned. The daily
`getMe()` already runs — add `pinned_tweet_id` to its `user.fields` (same $0.001 read)
and store it on `account_snapshots`. Brief warns when (a) the pin is unchanged >21d, or
(b) a post from the last 30d has ≥3× the pinned tweet's measured views ("your best work
isn't pinned"). Pinning stays manual in the X app; this is a nudge, not an action.

**Cost:** $0 recurring (S0.2/S0.9 ride already-billed reads; verify field cost before
landing each). **Done when:** the Today tab shows conversion + pin-watch lines, the
Radar visibly re-orders around known people, the Composer suggests a jittered best-time
slot, and the Playbook renders four new gated tables (latency, media, roster coverage,
idea lift) — silent below their n-gates.

**Tests:** pure suites per helper (conversion window math, tier ranking matrix, latency
bucketing, reup-candidate selection incl. already-reupped exclusion); route assertions
over the in-memory DB; `scripts/smoke-s0.ts` rerunnable ($0).

---

## 2. Phase S1 — Data core + Explorer (raw, sortable, searchable)

**Job:** see exactly what's in the production SQLite, in a browser, with zero ceremony.
And — deliberately — build the **read-only data core S2's MCP server reuses**, so the
introspection/query logic exists exactly once.

### 2.1 The data core (`src/x/data/inspect.ts`)

- A second `bun:sqlite` connection to the same file opened **`{ readonly: true }`** —
  structural guarantee that no explorer/MCP path can ever write, deadlock a worker
  transaction, or advance anything billing-adjacent.
- `listTables()`: whitelist derived from the Drizzle schema exports (not `PRAGMA
  table_list`, so migration scaffolding never leaks), each with row count and columns
  via `PRAGMA table_info`. **`tokens` is excluded entirely** — not masked, absent.
- `readTable(name, {limit≤200, offset, sort, dir, q})`: identifiers validated against
  the introspected column set (never interpolated from user input), `q` becomes `LIKE
  … ESCAPE '\'` across text columns, values always bound.
- `runSelect(sql)`: single-statement guard, must parse to `SELECT`/`WITH` (reject on
  first token + reject `;` followed by anything), executed on the readonly connection
  with a row cap (500) and a `tokens` mention rejected by name. This is the power tool
  both surfaces share.

### 2.2 Routes (`src/x/routes/data.ts`, bearer-guarded like everything else)

`GET /x/data/tables` · `GET /x/data/:table` (query params per readTable) ·
`POST /x/data/query {sql}`. All read-only by construction (2.1).

### 2.3 The explorer UI — one static file, no build step

`public/explorer.html` served at `GET /explorer` (no auth on the shell — it contains no
data; every fetch needs the bearer). Vanilla JS + hand-rolled table, dark theme:

- Left rail: tables with live row counts. Main: paginated grid, click-to-sort headers,
  debounced search box, column show/hide.
- Row detail drawer: JSON columns pretty-printed, `*_at`/`*Ms` epoch-ms columns
  rendered as local datetimes (raw value on hover).
- SQL tab: textarea → `POST /x/data/query`, results in the same grid. CSV export of
  the current view (formula-escaped cells — same discipline as the harvester).
- Token entered once, kept in `localStorage`, 401 → re-prompt.

The side panel is the wrong home for this (320px wide); a full browser tab against the
same Hono server is the right one, and a single self-contained HTML file keeps it out
of the extension build entirely.

**Cost:** $0. **Done when:** open `https://<host>/explorer`, paste the bearer once, and
every table is browsable/sortable/searchable, an ad-hoc `SELECT` round-trips, and
`tokens` is nowhere — confirmed by a test asserting it's absent from `listTables()` and
rejected by `runSelect`.

**Tests:** inspect.ts suite (whitelist, identifier validation, LIKE escaping, SELECT
guard incl. `PRAGMA`/`ATTACH`/multi-statement/`tokens` rejections, readonly write
attempt throws); route wiring over the in-memory DB. `scripts/smoke-explorer.ts` ($0).

---

## 3. Phase S2 — MCP server: Claude Code talks to the machine

**Job:** `claude mcp add --transport http stratus https://<host>/mcp --header
"Authorization: Bearer $STRATUS_TOKEN"` and Claude Code can interrogate the whole X
operation — metrics, people, playbook, spend — from any session, no SSH, no CSV.

### 3.1 Shape

- `@modelcontextprotocol/sdk` + `StreamableHTTPServerTransport` (**stateless**: new
  `McpServer` + transport per request, `sessionIdGenerator: undefined`), bridged into
  Hono with `fetch-to-node`'s `toReqRes`/`toFetchResponse` — the proven
  hono-stateless pattern. Stateless is correct here: every tool is a cheap local read;
  no sessions to hold.
- Mounted at `POST /mcp` in `app.ts` behind the existing bearer middleware; `GET/DELETE
  /mcp` → 405 JSON-RPC error. Tool registration lives in `src/x/mcp.ts` (`registerXTools
  (server)`) so the per-platform isolation holds — a future `src/linkedin/mcp.ts` adds
  its own tools to the same mount.

### 3.2 Tools

**Schema tier** (the S1 core, verbatim): `x_list_tables`, `x_describe_table`,
`x_query` (SELECT-only, row-capped, tokens-blind). This alone makes Claude Code fully
capable; everything else is convenience.

**Curated tier** — zero duplicated logic: each tool calls the existing route
**in-process** via Hono's own `app.request('/x/…', {headers: bearer})`, so the routes
stay the single source of truth and every future route improvement is inherited free:
`x_brief`, `x_playbook(minN?)`, `x_person(handle)` (the dossier), `x_followups`,
`x_conversations`, `x_metrics_account(days?)`, `x_best_times`, `x_cost(days?)`,
`x_search_voice(q)`, `x_digest(week?)`.

**Write tier — deliberately tiny, never X-billed:** `x_add_idea(text, tags?)`,
`x_add_person_note(handle, text)`, and `x_draft_post(text, pillar?, scheduledFor?)`
which creates a calendar row at **`status='draft'` only** — MCP can propose, only the
human promotes to `pending`, so no MCP call can ever reach `createPost` or any billed X
endpoint. No Grok tools (the MCP client *is* the intelligence). Tool descriptions state
costs ("free, local read") so agent callers don't hesitate.

**Cost:** $0 — structurally: reads hit the readonly connection or in-process routes,
writes stop at draft. **Done when:** from a fresh Claude Code session on another
machine, `x_query` answers "which angle earned the most profile clicks this month?"
and `x_draft_post` lands a draft visible in the Composer.

**Tests:** JSON-RPC round-trip over `app.request` (initialize → tools/list →
tools/call for one tool per tier); write-tier guard (draft status forced, `pending`
in input rejected); 401 without bearer. `scripts/smoke-mcp.ts` ($0).

---

## 4. Phase S3 — The Studio: deterministic visuals, client-side canvas ($0) — SHIPPED 2026-07-11

**Job:** every post that deserves a visual gets one in <30s, in a consistent brand, with
pixel-crisp text — composed in the extension, exported as PNG, **pasted manually** (the
OAuth 1.0a wall, §0). AI enters in S4; S3 is the deterministic frame it will slot into.

### 4.1 Composition engine (`extension/src/studio/compose.ts`, pure, tested)

A tiny declarative layer model rendered to `OffscreenCanvas`:

```ts
type Layer =
  | { kind: 'fill'; color: string }                     // solid / vertical gradient
  | { kind: 'image'; src: ImageBitmap; fit: 'cover' }   // S4's AI backgrounds land here
  | { kind: 'text'; text: string; font: FontSpec; box: Box; align; wrap: true }
  | { kind: 'sparkline'; points: number[]; box: Box }   // follower curve on stat cards
  | { kind: 'badge' | 'rule' | 'watermark'; … }
render(spec: {w, h, layers: Layer[]}): Promise<Blob>    // → PNG
```

Text measurement/wrapping/shrink-to-fit is the hard 20% — it's a pure function over
`measureText`, unit-testable with a fake metrics object. Brand kit (2 colors, font
stack, handle, watermark toggle) lives in `chrome.storage.local` with export/import
JSON; a bundled WOFF2 loaded via `FontFace` keeps typography deterministic across
machines.

### 4.2 Templates (each = a pure `spec(data) → Layer[]` function)

- **Quote card** (1200×675): own draft/tweet text or a voice tweet's *skeleton* remix —
  big wrapped text, handle, watermark. Seeded from Composer ("Make visual") and from
  the re-up flow (quote-tweet + card is the strongest re-up format).
- **Stat card** (1200×675): the week's digest facts — follower sparkline
  (account_snapshots via the existing API client), top post, streak. Build-in-public
  ammo, generated from real data, zero typing.
- **Banner** (1500×500): headline, pillar keywords strip, live follower milestone.
  Regenerate monthly; S0.1's conversion rate is the before/after judge.
- **Profile pic frame** (400×400): upload a photo → ring/accent in brand colors.

### 4.3 Studio tab + export

New extension tab. Template picker → live preview (re-render on every field edit —
deterministic means preview *is* the artifact) → **Copy PNG** (`ClipboardItem`
image/png — pastes straight into X's composer, the killer path) + Download. A "visual
made" marker (nullable `scheduled_posts.media_note` text) reminds at publish time that
this slot's post was designed to carry an image the API can't attach — the row renders
an amber "post manually with its visual" chip in Calendar/Today rather than being
skipped (v1 keeps the publisher untouched; a `needs_media` publisher-skip + C7-style
alarm is an open question below).

**Cost:** $0. **Done when:** a draft becomes a branded quote card pasted into a real
tweet in under 30s, and a stat card renders Sunday's digest with the live sparkline.

**Tests:** wrap/shrink/ellipsis matrix over a fake `measureText`; template specs
snapshot-tested (layer lists, not pixels); brand-kit round-trip.

---

## 5. Phase S4 — AI image layer (xAI grok-2-image)

**Job:** non-text imagery — backgrounds, concept art for posts — generated on demand,
composited **under** S3's deterministic text (models garble text; brand text is always
canvas-rendered on top).

- **Server route** `POST /x/images/generate {prompt, n≤2}` → xAI images endpoint,
  `model: grok-2-image` (~**$0.07/image** — add to the xAI pricing map so it lands in
  `cost_events` under platform `xai` and the budget watchdog sees it; new env
  `XAI_IMAGE_DAILY_BUDGET_USD` default 0.50, refuse with 429 once crossed — a paint
  session can't melt the wallet). Runtime XAI-key check → 503, same as pillar drafting.
- **The taint trap:** the response's image URL is cross-origin — drawn directly it
  taints the canvas and `toBlob` throws. The route therefore **downloads server-side
  and returns base64**; the studio builds an `ImageBitmap` from the data URL. Never
  hand the extension a raw xAI URL.
- **Asset library:** new `media_assets` table (uuid PK, kind, prompt, png BLOB,
  width/height, created_at, used_on_tweet_id nullable) — SQLite blobs are right at
  single-user scale and ride the existing backup story. `POST /x/assets` saves a
  composed PNG (≤2MB), `GET /x/assets` lists (metadata only), `GET /x/assets/:id/png`
  streams, `DELETE` deletes. Studio gains a history rail; re-open any asset as a base
  layer.
- **Prompt seeding, not prompt writing:** "Generate background" pre-fills from the
  draft's pillar + a fixed style suffix stored in the brand kit ("flat vector, muted
  #… palette, no text, no letters") — consistency across months of posts is the brand;
  the "no text" clause is load-bearing.
- **Measurement:** S0.2's `has_media` cell is the judge. The digest facts gain image
  spend + media-vs-text medians once both sides clear n≥20.

**Cost:** $0 recurring; ~$0.07–0.14 per generation click, watchdogged. **Done when:** a
generated background + canvas headline ships as a real manually-attached post, the
$0.07 appears in `/cost/today` under `xai`, and the asset reopens from the library.

**Tests:** pricing-map entry, budget-refusal path, base64 round-trip, asset routes
(size cap, list excludes blobs); `scripts/smoke-studio.ts` ($0 default, `--live` = one
$0.07 generation).

---

## 6. Explicitly NOT doing (this plan)

- **OAuth 1.0a media upload** — no API-attached images, no auto-posted visuals. The
  human pastes. Revisit only if X ships OAuth 2.0 media upload.
- Write-capable SQL from the explorer or MCP — the readonly connection is structural,
  not policy.
- MCP tools that trigger billed X reads or Grok calls; MCP writes beyond
  idea/note/draft.
- Public/multi-user anything: explorer and MCP sit behind the same single bearer.
- Scheduled/unattended image generation; video (Grok Imagine) — manual, click-priced
  stills only.
- Charting/BI in the explorer — it's a raw-data microscope; the Playbook is the
  analysis surface.

## 7. Open questions

1. Should S3's `media_note` grow into a real `needs_media` publisher-skip + C7-style
   "post this manually now" alarm? Decide after living with the amber chip for ~2 weeks.
2. `x_query` row cap 500 and image budget $0.50/day are opening guesses — revisit with
   use, same spirit as the stage thresholds.
3. Does the `attachments` field on the discovery read truly ride free (S0.2)? Verify
   against one live pull before landing the migration; if it bills, drop to
   harvest-side detection.
4. Explorer auth UX: is paste-the-bearer once acceptable, or is it worth a signed
   short-lived URL from the extension Settings tab? Ship paste-first, decide later.

---

*Adopt phases in order; each ends usable. S0's patches are independently committable —
land them as nine small commits, not one. Update `CLAUDE.md` phase-status and this file
in the same commit when a phase lands.*
