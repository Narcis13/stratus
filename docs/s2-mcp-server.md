# S2 — MCP server

> **Surface:** Claude Code (or any MCP client) can interrogate the whole X operation from any session — metrics, people, playbook, spend — with no SSH and no CSV.
> **Status:** shipped 2026-07-11. **Cost:** $0 by construction. **Plan:** `SURFACES-PLAN.md` §3.

---

## What it is

An [MCP](https://modelcontextprotocol.io) server mounted at **`POST /mcp`**, behind the same bearer token as the rest of stratus. Add it to any Claude Code session:

```bash
claude mcp add --transport http stratus https://<host>/mcp \
  --header "Authorization: Bearer $STRATUS_TOKEN"
```

From then on, an agent has **16 tools** across three tiers that let it read the production database, call any curated stratus route in-process, and make three tiny non-billed writes (add an idea, add a person note, draft a post). No session state, no SSH, no exported CSV.

The MCP client *is* the intelligence — there are deliberately **no Grok tools**. And the write ceiling is a `draft` calendar row, so **no MCP call can ever reach `createPost` or any billed X endpoint.**

---

## Why it exists

CIRCLES gave stratus a rich, measured CRM. But the only consumer was the side panel. S1 opened the raw data to a browser; S2 opens it to *reasoning*: "which reply angle earned the most profile clicks this month?" is now a question you ask a Claude Code session, which writes the SQL, runs it through `x_query`, and interprets the result — against the live production DB, from any machine.

---

## Architecture

```
   claude mcp add … https://<host>/mcp
            │
            ▼  POST /mcp   (Authorization: Bearer …)
   ┌────────────────────────────────────────────────────────┐
   │ app.ts:  app.use('/mcp', bearerAuth())                  │  ← unauth never
   │          mountMcp(app)                                  │    reaches a tool
   └───────────────────────┬────────────────────────────────┘
                           │
   ┌───────────────────────▼────────────────────────────────┐
   │ src/mcp.ts — the PLATFORM-AGNOSTIC bridge               │
   │  • fresh McpServer per request (stateless)              │
   │  • WebStandardStreamableHTTPServerTransport             │
   │    ({ enableJsonResponse: true })                       │
   │  • registerXTools(server, app, authHeader)              │
   │  • GET/DELETE /mcp → 405 JSON-RPC error                 │
   └───────────────────────┬────────────────────────────────┘
                           │
   ┌───────────────────────▼────────────────────────────────┐
   │ src/x/mcp.ts — registerXTools (X platform slice)        │
   │                                                         │
   │  Schema  ── S1 core (inspect.ts) directly               │
   │  Curated ── app.request('/x/…', { bearer }) in-process  │
   │  Write   ── app.request POST, draft-only                │
   └─────────────────────────────────────────────────────────┘
```

**Per-platform isolation holds.** The transport bridge (`src/mcp.ts`) knows nothing about X. Tool registration lives in `src/x/mcp.ts`. A future `src/linkedin/mcp.ts` would export `registerLinkedinTools` and get added to the *same* mount — the bridge never changes.

---

## The transport bridge — `src/mcp.ts`

- **Stateless.** A new `McpServer` + transport is built **per request**, with no `sessionIdGenerator` (its absence *is* stateless mode at runtime). Correct here because every tool is a cheap local read or a $0 draft write — there is no session to hold.
- **Web-standard transport.** Uses the SDK's `WebStandardStreamableHTTPServerTransport`, which speaks web `Request → Response` directly — a clean fit for Hono on Bun, with **no Node req/res shim**. (The plan sketched the older `fetch-to-node` bridge; this SDK version ships a first-class web transport that avoids the Node-stream-adapter pitfalls entirely.)
- **`enableJsonResponse: true`** — a single JSON reply instead of an SSE stream, because the tools return immediately and nothing streams. The body is fully materialized, then the per-request server/transport are released.
- **Method guard.** `GET /mcp` and `DELETE /mcp` return a JSON-RPC "Method not allowed" at HTTP **405** (there's no SSE stream to open and no session to terminate in stateless mode).
- **Auth forwarding.** The caller already passed `bearerAuth()` in `app.ts`; `mountMcp` forwards that exact `Authorization` header into `registerXTools`, so the in-process route calls the curated tools make authenticate too.

`SERVER_INFO = { name: 'stratus', version: '0.1.1' }`. Dependencies: `@modelcontextprotocol/sdk` + `zod` (the SDK version's zod-v4-compatible tool schemas).

---

## The tools — `src/x/mcp.ts`

**16 tools, three tiers, all $0.**

### Schema tier (3) — the S1 core, verbatim

These call the read-only `inspect.ts` core directly (`tokens`-blind, 500-row capped). An `InspectError` is mapped to an MCP error result so the model sees the code (e.g. `tokens_forbidden`) instead of a thrown 500.

| Tool | Input | Does |
|---|---|---|
| `x_list_tables` | — | Every table with row count + columns. Start here. |
| `x_describe_table` | `table` | One table's columns (name/type/nullability/pk) + row count. |
| `x_query` | `sql` | A single `SELECT` / `WITH…SELECT`, ≤500 rows. The most powerful tool. |

### Curated tier (10) — zero duplicated logic

Each tool calls an existing stratus route **in-process** via Hono's `app.request(path, { headers: { authorization } })`, forwarding the MCP caller's bearer. The routes stay the single source of truth, and every future route improvement is inherited for free.

| Tool | Route called | Notes |
|---|---|---|
| `x_brief` | `/x/brief?tzOffsetMin=` | The growth-coach daily brief. |
| `x_playbook` | `/x/playbook?minN=` | Gated effectiveness tables; cells below the sample gate read "insufficient data". |
| `x_person` | `/x/people/:handle` | The full dossier (strips a leading `@`). |
| `x_followups` | `/x/people/followups` | The "do next" queue. |
| `x_conversations` | `/x/conversations` | The mention inbox as threads (open loops on top). |
| `x_metrics_account` | `/x/metrics/account?days=` | Follower/following/tweet/listed series with deltas. |
| `x_best_times` | `/x/metrics/best-times?minN=&tzOffsetMin=` | Weekday × hour cells, gated. |
| `x_cost` | `/cost/daily?days=` | Daily spend per platform. **Reports** past cost — spends nothing. |
| `x_search_voice` | `/x/voice/tweets?q=` | Substring search of the $0 swipe file. |
| `x_digest` | `/x/digest?week=&tzOffsetMin=&factsOnly=true` | Weekly digest **facts** — forces `factsOnly=true` so the read never triggers the Grok-billed narration. |

Tool descriptions state costs ("Free, local read") so agent callers don't hesitate.

### Write tier (3) — tiny, never X-billed

The write ceiling is a **draft**. MCP can propose; only the human promotes.

| Tool | Input | Route | Guard |
|---|---|---|---|
| `x_add_idea` | `text`, `tags?` | `POST /x/ideas` | Idea Inbox only. |
| `x_add_person_note` | `handle`, `text` | `POST /x/people/:handle/events` `{ type:'note', summary:text }` | Creates the person if unknown. |
| `x_draft_post` | `text`, `pillar?`, `scheduledFor?` | `POST /x/posts/scheduled` | **`status` is hard-coded to `'draft'`** in the handler. |

**The draft-forced guard is the whole safety story of the write tier.** The `x_draft_post` schema exposes no `status` field, so a caller can never request `pending`. The handler literally writes `{ text, status: 'draft', … }`. A draft never reaches the publisher or `createPost` — it sits in the Composer until a human promotes it. `scheduledFor` rides along only as a *suggested* slot; the row stays a draft. An invalid `pillar` slug is rejected by the route.

> **Route change enabling this:** `POST /x/posts/scheduled` gained an optional, validated `pillar` (a DB read only when supplied, validated against active slugs like the drafter). This also benefits the Composer.

---

## Security & cost invariants

| Guarantee | How |
|---|---|
| No unauthenticated access | `app.use('/mcp', bearerAuth())` before `mountMcp` |
| No write reaches a billed X endpoint | Write tier tops out at a `draft` calendar row; `status` hard-coded, not caller-settable |
| No Grok spend | No Grok tools; `x_digest` forces `factsOnly=true` |
| No secret leak | Schema tier is the S1 `tokens`-blind core |
| $0 | Reads hit the readonly connection or in-process routes; writes stop at draft |
| No cross-platform leakage | Bridge is platform-agnostic; X tools live under `src/x/` |

---

## Usage

**Add the server (once):**

```bash
claude mcp add --transport http stratus https://<host>/mcp \
  --header "Authorization: Bearer $STRATUS_TOKEN"
```

**Then, from any Claude Code session, ask questions like:**

- "Which reply angle earned the most profile clicks this month?" → the agent uses `x_query`.
- "Give me the dossier for @somehandle." → `x_person`.
- "What should I do next?" → `x_followups`.
- "Draft a post about shipping the studio and pin it to the ai-craft pillar." → `x_draft_post` (lands a **draft** in the Composer).

---

## Tests

- **`src/mcp.test.ts`** — a JSON-RPC round-trip over `app.request`: `initialize` → `tools/list` → `tools/call` for one tool per tier, plus the **draft-forced guard** (a smuggled `pending` is stripped) and a **401 without the bearer**. Adds a `describeTable` check to `inspect.ts` coverage.
- **`scripts/smoke-mcp.ts`** — rerunnable $0 check on an ephemeral `:memory:` DB: full round-trip including the `tokens` guard and the draft-forced guard.

**Verified end-to-end** with the real `@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport` over an actual HTTP port: connect → 16 tools listed → `x_query` round-trips → `x_draft_post` lands a `draft` row in `scheduled_posts` visible to the Composer.

---

## Open questions (from the plan)

- **`x_query` row cap of 500** — an opening guess shared with S1; revisit with use.

---

## Related

- **[S1 — Data core + Explorer](./s1-data-explorer.md)** — the read-only core the schema tier reuses.
- **[Playbook](./playbook-tab.md)**, **[Today](./today-tab.md)**, **[People](./people-tab.md)** — the routes behind the curated tier.
