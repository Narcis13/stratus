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

## 5. Phase S4 — AI image layer (xAI grok-2-image) — SHIPPED 2026-07-11

> **Status: done.** `POST /x/images/generate` (grok-2-image → base64, never a raw URL;
> 503 without the key; hard `XAI_IMAGE_DAILY_BUDGET_USD` 429 refusal; spend logged under
> platform `xai`), the `media_assets` BLOB library (`POST/GET/GET :id/png/DELETE`, list
> excludes blobs, 2MB cap), the Studio's AI-background compositing (image + scrim UNDER
> the text) + brand-kit style suffix + Save-to-library + history rail (re-open via the new
> binary transport), and the digest facts' `imageSpendUsd` + `mediaVsText` (gated n≥20).
> Tests + `scripts/smoke-studio.ts` ($0 default, `--live` = one $0.07 gen). See CLAUDE.md
> §"Surfaces S4" for the wiring. Remaining "done when" tail: the first real generated-
> background post pasted into a live tweet.

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

## 5b. Phase S5 — Studio 2.0: mascot, template gallery, patterns & presets — SHIPPED 2026-07-18

> **Status: done.** Full build plan in **`plans/2026-07-16-studio-2.md`** (tasks ST.1–ST.9);
> see CLAUDE.md §"Surfaces S5" and **[docs/s3-studio.md](./docs/s3-studio.md)** (the single
> authoritative Studio doc) for the shipped shape.

**Job:** turn the four static S3 templates into a memorable branded *system*, all $0
recurring, no new X reads/writes, no new Grok text calls — everything new is client-side
canvas.

- **Cloud mascot** (`extension/src/studio/mascot.ts`) — a deterministic vector cloud
  (chosen over an AI mascot: $0, pixel-identical, snapshot-testable), poses `happy /
  celebrating / thinking / sleeping` tied to real data, all colors `shade(kit.accent,…)`
  so it re-skins with the brand. `BrandKit.mascot` gates it; an AI background suppresses it.
- **Six new templates** (milestone, streak, code/terminal, thread cover, numbered list,
  chart card) — a gallery of ten, each a pure `spec(data,kit) → RenderSpec`. The code card
  uses a measure-free fixed-advance layout (`MONO_ADVANCE = 0.6`, bundled JetBrains Mono);
  milestone/chart pull already-billed `/x/metrics/account` + `/x/metrics/best-times`.
- **Deterministic background patterns** (`dots · grid · diagonal · plus · blobs`) as $0
  alternatives to AI backgrounds, via a new `pattern` layer kind + a seeded `mulberry32`
  PRNG (`Math.random` banned in the Studio — determinism is the preview-IS-artifact contract).
- **Named theme presets** — `studio:brandKits` bundle (Midnight / Paper / Neon starters),
  legacy single-kit migrated on load; save-as / rename / delete; export/import accepts
  both shapes.
- **Registry refactor first** — `Studio.tsx` split into a shell + `registry.ts` (metadata
  + `buildSpec` dispatch) + `fields.tsx` + `KitEditor.tsx`, so the eleventh template costs
  a fraction of the fifth. No server data changes, no migrations; the only server touch was
  widening the `ASSET_KINDS` whitelist (additive, unknown kinds degrade to `'other'`).

**Cost:** $0 recurring (the S4 AI-background click is unchanged). **Done when:** the gallery
renders all ten templates with the bundled fonts, the mascot poses track real data, presets
re-skin instantly, patterns are deterministic, and Copy PNG pastes into X. **Browser-verified
2026-07-18** over a render harness (all ten templates × three presets, fonts, mascot poses,
determinism, Copy-PNG); the first real mascot-card pasted into a live tweet is the remaining
real-world tail.

**Tests:** `mascot.test.ts`, `milestones.test.ts`, `codeTokens.test.ts`, `chartData.test.ts`,
expanded `compose.test.ts` / `templates.test.ts` / `brandKit.test.ts`; `scripts/smoke-studio.ts`
extended so every S5 asset kind survives the whitelist ($0 default).

---

## 5c. Phase S6 — Augmented X UI: people chips + full-context panel on x.com — SHIPPED 2026-07-21

> **Status: done.** Full build plan in **`plans/2026-07-16-augmented-x-ui.md`** (tasks
> AX.1–AX.7); see CLAUDE.md §"Surfaces S6" and **[docs/s6-augmented-ui.md](./docs/s6-augmented-ui.md)**
> for the shipped shape. (The plan text said "Surfaces S5" — stale: S5 is Studio 2.0, so
> this shipped as **S6**.)

**Job:** render Circles context where the decision actually happens — on x.com itself —
at **$0** (all new reads are SQL over already-billed stratus data, fetched through the
existing background `ApiRequest` transport with client-side caches; no X API, no Grok).

- **Green stats pill gone everywhere** — the left border still marks hot/warm/skip and
  the radar stream is byte-untouched; the badge's signals survive in chip tooltips and
  the radar "why" line.
- **`GET /x/people/glance`** (in `routes/people.ts`, registered **before `:handle`** §7.20)
  — the timeline-decoration map: all non-retired `people` + unanswered-mention open-loop
  counts + `loadTargetHandles()` backfill → `{count, map: {lowercased handle → {stage,
  isTarget, openLoops, lastOutboundAt, lastInboundAt, followersCount}}}`. Rankmap stays
  untouched (different membership/contract, feeds the radar tier stamp).
- **Person chips on the timeline** (`extension/src/shared/glance.ts` `buildPersonChips`,
  bun-tested, inlined into the content IIFE) — right of the name/handle line: a stage chip
  (only `engaged`+, `noticed`/`stranger` would be noise), `◎` for the 2–10x target roster,
  amber `↩ n` when that person has unanswered mentions, `Nd` neglect mark (`NEGLECT_DAYS=7`).
- **Full-context panel on the tweet page** (`extension/src/shared/tweetContext.ts`
  `buildTweetContextModel`, bun-tested) — on `/status/` pages, a collapsible "stratus
  context" panel below the tweet: who this person is to me (stage, since, followers +
  momentum, tags), an "already replied to this tweet" banner, open loops I owe them, my
  last measured replies with outcomes + the angle that works (gated ≥3 measured), and my
  notes verbatim. Collapse flag in `chrome.storage.local['augment:contextCollapsed']`.
- **Dossier click-through** — clicking a chip or the panel header fires
  `stratus/open-person {handle}`; the background opens the side panel (best-effort gesture
  hop) and writes the `stratus:openPerson` session handoff key (single writer); `App.tsx`
  reads it → People dossier → clears it.
- **Legacy button kill rule** — a defensive `#reply-master-btn { display: none !important }`
  hides the retired standalone "Reply Master" extension's purple sparkle; the real fix is
  the user uninstalling that extension in `chrome://extensions`.

**Cost:** $0 (no X API, no Grok, no writes, no schema change, no new MCP tool — 19 tools
unchanged). No `rankmap`/`stampTiers`/band-threshold changes; chips/panel are read-only
except the one navigation affordance. **Done when:** no stats pill anywhere; a
mutual-stage target with an unanswered mention shows stage + `◎` + `↩`; the status-page
panel renders stage/exchanges/open loops/≥1 measured reply/notes; clicking a chip opens
the dossier; `scripts/smoke-glance.ts` passes ($0). **Live-selector tail:** the
`[data-testid="User-Name"]` insertion point and action-row anchors are X DOM and can
drift — the browser walk over an unpacked extension is the remaining real-world check.

**Tests:** `glance.test.ts`, `tweetContext.test.ts`, `messages.test.ts` (new guards) +
the `routes/people.test.ts` glance describe; `scripts/smoke-glance.ts` ($0, real DB).

---

## 5d. Phase S7 — Reply lists: premade, templated, humanized canned replies — SHIPPED 2026-07-23

> **Status: done.** Full build plan in **`plans/2026-07-16-reply-lists.md`** (tasks
> RL.1–RL.8); see CLAUDE.md §"Surfaces S7", **[docs/replies-tab.md](./docs/replies-tab.md)**
> (Lists subtab) and **[docs/today-tab.md](./docs/today-tab.md)** (the pickers). (The plan
> text said "(S5)" — stale: S5 is Studio 2.0 and S6 the Augmented X UI, so this shipped
> as **S7**.)

**Job:** fast, human-sounding acknowledgment replies for the exact moments the machinery
already surfaces — Launch Room early commenters and Conversations open loops — at **$0
per use** (deterministic, no AI at use time). Posting stays a manual paste.

- **Three tables** (migration `0018`, DDL-only): `reply_lists` (per-list `humanizer`
  JSON, null = engine defaults) → `reply_list_items` (cascade; `last_used_at`/`use_count`
  = the anti-repeat state) → `reply_list_uses` (**FK-free on purpose** — audit log +
  measurement hook, outlives a deleted list).
- **Pure engine** `src/x/replyLists/engine.ts` (injected `rng`, bun-tested): missing-var
  degradation with adjacent-punctuation cleanup; the anti-repeat pick (exclude the
  `min(n-1, floor(n/2))` most recent, then **uniform random** among the rest); the
  humanizer (prefix .25 / suffix .20 / lowercase .15 / drop-period .10 / **typo .05**,
  ≤280 enforced each step, **never inside a name/handle/URL**).
- **Routes** `src/x/routes/replyLists.ts` (always mounted, all $0 but `/generate`): list +
  item CRUD, `/items` append|replace in one sync txn, and `POST /:id/use` — pick, compose,
  stamp (`preview:true` writes nothing; `409 no_enabled_items`). **Shuffle state lives
  server-side**, so it survives browser restarts and the panel never picks locally.
- **AI generator** `POST /:id/generate` — one `askLLM` structured-outputs call filling a
  list from a category prompt (~$0.003–$0.01), **proposal-only**: nothing persists until
  the human clicks Append/Overwrite through the plain `/items` CRUD. Prompt is the
  editable registry key `reply-list`; no key → 503, unknown list → 404 before any spend.
- **Extension** — a `Reply Master | Lists` subtab (`ReplyLists.tsx`: items, humanizer,
  Test render, generate) plus the shared **`canned ▾` QuickReplyPicker** on every Launch
  Room early-replier row and Conversations open loop: one click = one real `/use`, copied
  in the same handler, text kept visible if the clipboard refuses.
- **Measurement** — the Playbook's batch-vs-single gained a **`canned`** cell, attributed
  by matching a published reply against `reply_list_uses.renderedText` (stored typos and
  all). Text-match only ⇒ an edited-after-paste reply falls back to `unattributed` —
  **undercount, never overcount**.

**Cost:** $0 recurring, $0 X API; the only spend is the optional generate click. **Done
when:** 10 consecutive uses show no immediate repeats with vars filled; one click in the
Launch Room puts a humanized reply on the clipboard; generate previews then persists only
on an explicit click; the Playbook shows a `canned` bucket;
`scripts/smoke-reply-lists.ts` passes $0 and cleans up. **Live tails:** the first real
paste (watch X's paste normalization vs the doubled-space typo variant) and the first
`canned` count the morning after.

**Tests:** `replyLists/{engine,generate}.test.ts`, `routes/replyLists.test.ts`, the
`canned` describes in `{playbook,routes/playbook}.test.ts`; `scripts/smoke-reply-lists.ts`
($0, real DB, `--live` = one generate call).

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
