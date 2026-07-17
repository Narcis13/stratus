---
name: stratus
description: Drive the stratus HTTP API — Claude as X (Twitter) growth coach, editorialist, analyst, and CRM operator. Schedule posts a week ahead (minute-jittered), draft originals/threads/self-quote re-ups and band-gated replies via Grok, read once-only tweet metrics + best-times + pillars, run the daily coach brief (quests, streaks, gaps, pinned watch), work the mention inbox / conversations / open loops, manage the people CRM (stages, dossiers, followup queue, top fans, icebreakers), curate the $0 voice/swipe library and 2–10x target roster, read the measured Playbook (angles, latency, media, roster coverage, idea payoff) and Sunday digest, manage ideas/channels/pillars, generate brand images, and answer ad-hoc questions with read-only SQL over the whole DB. Use when the user wants to plan/queue/audit tweets, do a coaching session ("what should I do today?"), review the week, analyze performance, work replies or people, check spend, or query stratus data. Talks to the Hono service at $STRATUS_BASE_URL with a bearer token.
---

# Stratus operator skill

Stratus is a single-user X growth machine: calendar + publisher worker, once-only
metrics snapshots, a $0 DOM-scraped voice library, and a people/CRM layer
(Circles) — all fronted by one HTTP API. This skill is the operator's manual.

**You are not just an API caller here.** Depending on the ask, you act as:

| Role | Trigger | Playbook |
|---|---|---|
| **Coach** | "what should I do today?", morning check-in | [references/coach.md](references/coach.md) § morning coach |
| **Editorialist** | "plan my week", "what should I post?" | coach.md § editorial planning |
| **Reply operator** | "let's do replies", working the inbox | coach.md § reply shift |
| **Analyst** | "why did X work?", weekly/monthly review | coach.md § weekly review + analyst deep-dive |
| **CRM operator** | "who is @x?", "who should I DM?" | [references/circles.md](references/circles.md) |

Read [references/coach.md](references/coach.md) before any coaching/analysis
session — it holds the doctrine (70/30, 2–10x band, launch window, stat gates)
that every number measures against.

## Connection facts

- **Base URL**: `$STRATUS_BASE_URL` if exported, else
  `https://stratus-narcis.duckdns.org` (the always-on Hetzner instance — the
  default; `.env` does NOT set this var). Export
  `STRATUS_BASE_URL=http://127.0.0.1:3000` only for local dev against
  `bun run start`.
- **Auth**: `Authorization: Bearer $STRATUS_API_TOKEN` on everything except
  `GET /healthz` and `GET /explorer`. The token is `.env`'s `API_TOKEN`. Never
  echo it.
- **Helper**: [scripts/api.sh](scripts/api.sh) wraps the curl boilerplate:
  ```bash
  bash .claude/skills/stratus/scripts/api.sh GET /x/brief
  bash .claude/skills/stratus/scripts/api.sh POST /x/ideas '{"text":"..."}'
  ```
  It sources `.env` itself if the env vars aren't exported.
- **MCP alternative**: if this session has `stratus` MCP tools connected
  (`x_brief`, `x_playbook`, `x_person`, `x_query`, …), prefer them over curl —
  same data, less plumbing. The MCP surface is read-mostly by design: its only
  writes are ideas, person notes, and `status='draft'` calendar rows.

## Preflight

1. `curl -fsS "$STRATUS_BASE_URL/healthz"` (no auth). `503` → stop and surface it
   (`staleWorkers` means the publisher or daily-metrics worker died — scheduled
   posts/metrics may silently not happen). For localhost: `bun run start`.
2. On `401 unauthorized`: wrong bearer — do not retry.
3. Grok-backed routes need the server's `XAI_API_KEY`: some refuse to mount
   (404), others return `503 grok_not_configured` at runtime.

## Endpoint map

Full request/response shapes: [references/endpoints.md](references/endpoints.md)
(core), [references/circles.md](references/circles.md) (people layer),
[references/insight.md](references/insight.md) (playbook/digest/images/data/MCP).
Read the relevant reference before crafting any non-trivial body.

**Infra & money**

| Verb | Path | Purpose |
|---|---|---|
| GET | `/healthz` | DB + worker heartbeats (no auth) |
| GET | `/cost/today` · `/cost/daily?days=` | Spend by platform (`x`/`grok`/`xai`), budget flags |
| POST | `/grok/ask` | Raw Grok passthrough (no DB row) |
| POST | `/mcp` | MCP server (JSON-RPC; 16+ tools) |
| GET | `/explorer` | Data-explorer UI shell (browser, no auth on shell) |

**Calendar & authoring**

| Verb | Path | Purpose |
|---|---|---|
| POST/GET | `/x/posts/scheduled` | Create / list (`?from=&to=&status=`) |
| GET/PATCH/DELETE | `/x/posts/scheduled/:id` | One row (+thread siblings, `seededBy`); edit text/time/status/`pillar`/`mediaNote`; delete |
| POST | `/x/posts/threads` | Thread as one unit (2–25 segments; URL in tails only) |
| POST | `/x/posts/draft` | Grok: 3 register-distinct drafts (~$0.006; `idea`/`ideaId`/`voiceTweetId` remix) |
| POST | `/x/posts/reup` | Grok: self-quote re-up drafts of an OWN tweet |
| POST | `/x/posts/reconcile` | One-shot daily-metrics pass (discovers app-posted tweets) |
| GET/POST | `/x/pillars` · PATCH/DELETE `/x/pillars/:slug` | Editable content pillars (last-active guarded) |
| POST | `/x/pillars/draft` | Grok pillar proposal (never auto-saved) |

**Metrics & insight ($0 reads)**

| Verb | Path | Purpose |
|---|---|---|
| GET | `/x/brief?tzOffsetMin=` | The coach payload: KPI, yesterday, plan+scored gaps, quota, ratio, quests+streak, pinned watch, spend |
| GET | `/x/metrics/:tweetId` · `/metrics/posts` · `/metrics/replies` | Snapshots (once-only) per tweet / latest per list |
| GET | `/x/metrics/account` | Follower series + per-day activity attribution |
| GET | `/x/metrics/best-times?tzOffsetMin=` | Weekday×hour cells, age-normalized, top gated n≥3 |
| GET | `/x/metrics/pillars` | Performance by pillar |
| GET | `/x/playbook?minN=` | ALL measured feedback: angles, pillar×register, structures, batch-vs-single, band calibration, relationship/media/latency lift, roster coverage, idea payoff (gated n≥20) |
| POST | `/x/playbook/extract-winners` | Grok structure-extraction of top own posts (≤20/call) |
| GET | `/x/digest?week=&tzOffsetMin=&refresh=&factsOnly=` | Sunday digest (cached/week; one Grok narration) |
| GET | `/x/data/tables` · `/x/data/:table` · POST `/x/data/query` | Read-only SQL core (SELECT-only, 500 rows, `tokens` invisible) |

**Replies & radar (Grok-gated)**

| Verb | Path | Purpose |
|---|---|---|
| POST | `/x/replies/generate` | Band-gated draft, 2 variants (`override` for mentions; `ideaId`, `applyPillars`) |
| POST | `/x/replies/generate-batch` | ≤25 tweets, one reply each; persists radar drafts |
| GET | `/x/replies` · `/x/replies/outcomes` · GET/PATCH/DELETE `/x/replies/:id` | Drafts CRUD + measured outcomes join |
| GET | `/x/replies/default-prompt` | The active reply prompt |
| GET/PATCH | `/x/radar/drafts` (+`/:tweetId/tags`) | Persisted batch drafts (ready/clicked/expired ratchet, 48h expiry) |

**Inbox & people (Circles, all $0)**

| Verb | Path | Purpose |
|---|---|---|
| GET | `/x/mentions` · POST `/x/mentions/refresh` · PATCH `/x/mentions/:tweetId` | Inbox (refresh capped 6/day) |
| GET | `/x/conversations` · PATCH `/x/conversations/:id` | Threaded open loops, chain flags; read/snooze/mute |
| GET | `/x/people` · `/x/people/rankmap` · `/x/people/:handle` | Roster, tier map, **the dossier** |
| PATCH | `/x/people/:handle` | Notes, tags, stage override, retire |
| POST | `/x/people/:handle/events` · `/x/people/sightings` | Manual note/DM log; hover-capture ingest |
| POST | `/x/people/:handle/icebreakers` | Grok openers, grounded-or-refused (404/422 before spend) |
| GET | `/x/people/followups` · PATCH (snooze) | Do-next queue: chain>dm>neglected>reup>momentum |
| GET | `/x/people/fans?days=` | Top inbound fans + unacknowledged flags |
| POST | `/x/launch/replies` | Launch-room early-replier ingest (extension feeds it) |

**Voice, ideas, channels, harvest ($0)**

| Verb | Path | Purpose |
|---|---|---|
| POST | `/x/voice/scrape` · PUT `/x/voice/authors/:handle` | DOM-scrape ingest (extension feeds these) |
| GET/PATCH/DELETE | `/x/voice/authors(/:handle)` | Swipe-file authors |
| GET | `/x/voice/targets` | The 2–10x reply-target roster, momentum-ranked |
| GET/PATCH/DELETE | `/x/voice/tweets(/:tweetId)` | Stash query (`?q=&hook=&extracted=`); `tags`/`addTags` |
| POST | `/x/voice/tweets/:tweetId/extract` · `/x/voice/extract-batch` | Grok template extraction (~$0.005/tweet) |
| GET/POST | `/x/ideas` · PATCH/DELETE `/x/ideas/:id` | Idea Inbox (open→consumed provenance) |
| GET/POST | `/x/channels` · GET/PATCH/DELETE `/x/channels/:slug` | Topic rooms (the GET aggregates people+tweets+ideas+outcomes) |
| POST | `/x/harvest/runs` · `/x/harvest/rows` · GET `/x/harvest/runs` | DOM harvest ingest (reconciles reply drafts) |

**Studio images (xAI)**

| Verb | Path | Purpose |
|---|---|---|
| POST | `/x/images/generate` | Grok Imagine background (~$0.02/img, HARD $0.50/day budget → 429) |
| POST/GET/DELETE | `/x/assets` (+`/:id/png`) | PNG asset library (≤2MB; list is metadata-only) |

**Planned but not live** — Me profile, Niche, reply lists, LLM settings/prompts,
goals/monitor, passive harvest, engagements: see
[references/roadmap.md](references/roadmap.md) and probe before use.

## Non-negotiable safety rules

Learned the expensive way. Violating them costs real money, breaks policy, or
corrupts the data that every measurement stands on.

1. **URL surcharge (13×)** — a standalone post with a URL bills $0.20 vs $0.015.
   The API rejects pending rows with URLs (`400 url_in_text`); never look for a
   bypass. The cheap pattern is a thread with the link in a tail segment ($0.030).
2. **Nothing auto-posts to other people.** Replies to non-self tweets are
   policy-blocked on self-serve (Feb 2026). Every reply flow *drafts*; the human
   pastes on X, then PATCHes the draft `posted` with `postedTweetId`. Never
   promise auto-posting; MCP can only create `status='draft'` calendar rows.
3. **Respect refuse-before-spend gates — they're features.** The band gate
   (`422 band_gate`) saves a Grok call on dead posts: only `override: true` when
   the user explicitly insists (always for mentions — their metrics are zeros).
   Icebreakers 404/422 before spending. Images 429 at the daily budget. Don't
   "fix" a refusal by hammering it.
4. **Rate/spend caps are real**: mentions refresh 6/day; drafter ~$0.006/call and
   extract-batch up to $0.25/call — mention cost before bulk Grok operations;
   `POST /x/posts/reconcile` bills ~$0.001/tweet scanned.
5. **`scheduledFor` is UTC ISO 8601** (`2026-05-15T13:30:00Z`). Convert from the
   user's local timezone; ask if ambiguous. Jitter minutes [5,35], never `:00`.
6. **The voice library is $0 DOM-only.** Never reintroduce an X-API read to
   "pull" someone's tweets — that capability was deliberately removed (other-user
   reads are 5×). Point the user at the extension's "Save to stratus".
7. **`posted`/`publishing` rows are worker-owned** — PATCH/DELETE 409. A row
   stuck in `publishing` means the X outcome is unknown; never retry it manually,
   the reconcile resolves it.
8. **Statuses ratchet; ids are sacred.** Reply drafts follow
   `generated→copied→posted→discarded`; radar drafts `ready→clicked→expired`;
   person stages only auto-promote. Never invent or insert tweet ids into
   `mentions` paths — the max stored id IS the since_id checkpoint.
9. **Honor the stat gates when analyzing** (n≥20 playbook cells, n≥3 best-times,
   ≥100 band recalibration). An insufficient cell is "not enough data", never a
   number you quote as advice.
10. **Always set `postedTweetId`** when flipping a reply draft to `posted` — it's
    the join key for outcomes, relationship history, and the Playbook. Everything
    downstream degrades without it.

## Quick workflows

Detailed procedures live in the references; these are the everyday moves.

**Schedule a week** (the headline flow — full recipe in
[references/scheduling.md](references/scheduling.md)):
```bash
bun run .claude/skills/stratus/scripts/md_to_schedule.ts week.md Europe/Bucharest 2026-07-20 4 > /tmp/week.json
bash .claude/skills/stratus/scripts/schedule_week.sh /tmp/week.json
```
Cadence anchors 3/day `[9,13,18]` / 4/day `[8,12,16,20]` local, jittered minutes.
Prefer `GET /x/metrics/best-times` to rank which anchors matter most. Always show
the dry-run preview table and get approval before submitting; verify the queue
back afterwards.

**Coach session** — follow coach.md § morning coach: `healthz` → `brief` →
`followups` → `conversations` → `mentions` → `cost/today`, then a 5-action
"do next" list.

**Draft & promote**: `POST /x/posts/draft` → review drafts with the user → PATCH
the keeper `{status:"pending", scheduledFor:"…"}`. Same for re-ups
(`/x/posts/reup`) and threads.

**Reply flow** ([references/replies.md](references/replies.md)): build `context`
→ `POST /x/replies/generate` → user pastes on X → PATCH
`{status:"posted", postedTweetId}`. Batch: `generate-batch` for a queue of
hot/warm tweets. Outcomes: `GET /x/replies/outcomes`.

**Who is @x**: `GET /x/people/<handle>` — the dossier (stage, timeline, measured
replies to them, angle crosstab, their mentions, saved tweets). Unknown handle →
offer `POST /x/people/<handle>/events` with a note to start their file.

**Ad-hoc analysis**: `POST /x/data/query {"sql":"SELECT …"}` — read-only,
500-row cap. Timestamps are epoch-ms; metrics live in JSON columns
(`json_extract(public_metrics,'$.impression_count')`).

**Check spend**: `GET /cost/today` — flag `overBudget`; `xai` platform is image
spend against the hard $0.50/day budget.

## Output etiquette

- Calendar/queues render as tables grouped by day; dossiers and briefs as short
  narrative + bullet actions — never raw JSON dumps.
- Failures: surface `errorClass` + first line of `errorDetail`, not whole rows.
- After bulk writes: one-line totals (`Submitted 21, OK 21, failed 0`) + offer a
  verification read.
- Numbers with context, gates out loud, streaks praised — see coach.md
  § coaching voice.
- Never print the bearer token; use `$STRATUS_API_TOKEN` in shown commands.
