# Reply Master — Implementation Plan

> Manual-assist reply drafting on x.com tweet-detail pages, powered by Grok, surfaced in the side panel, every draft tracked in the DB. **Plan, not yet built.** Reviewed and approved → fold into `PLAN.md` as Phase 6.

## What we're building

When I'm reading a tweet on `https://x.com/<user>/status/<id>`, I want one click to:

1. Scrape the **context** around that tweet (author, text, metrics, top replies).
2. Call **our Grok endpoint** (`POST /grok/ask`) with that context.
3. Get back **just the reply text** — no auto-posting.
4. **Copy** the text to the clipboard automatically.
5. **Show** the text in an editable textbox inside a new **"Reply Master"** side-panel tab so I can tweak before pasting.
6. Persist the draft (source tweet + context snapshot + Grok metadata + status) in the DB so I have a history of every Grok-assisted reply.

I paste the result into X's reply box myself. X never sees the extension; nothing programmatic touches the reply composer.

This intentionally diverges from the reference project at `/Users/narcisbrindusescu/newme/clipx/reply-master/`, which auto-injects the reply via `execCommand('insertText')` and clicks the Tweet button. We don't do that — see the Feb 2026 programmatic-reply restriction note in `CLAUDE.md`. Manual paste keeps us policy-clean.

## What we keep from reply-master

Read the reference repo for shape and quirks, then translate:

| reply-master file | What it teaches us | What we steal |
|---|---|---|
| `extension/src/scrape.ts` | DOM selectors for tweet author/handle/text/metrics + top comments via `article[data-testid="tweet"]` | Port the `scrapePostContext()` shape; reuse `[data-testid="User-Name"]`, `[data-testid="tweetText"]`, `[role="group"]` aria-label metric parser |
| `extension/src/content.ts` | Floating 🪄 button positioning + MutationObserver-driven re-anchor on X's SPA churn | Pattern only — our button will be inline next to the existing "Save to stratus" button, not floating |
| `extension/src/utils/locationchange.ts` | `pushState`/`replaceState` patch so SPA nav fires a `locationchange` event | We don't need it (our existing content script already lives with the MutationObserver pattern) |
| `extension/src/utils/waitFor.ts` | MutationObserver-backed selector wait with timeout | Worth keeping handy; not needed for v1 |
| `extension/src/background.ts` | `chrome.runtime.onMessage` proxy → local API | Already covered by stratus's typed `bgClient` / background worker |
| `extension/src/inject.ts` (Draft.js insertion + Tweet button click) | ❌ ignored — we don't post programmatically |
| `server/src/routes/reply.ts` | Single-purpose route taking `PostContext`, returning `{ reply }` | Same contract, but our handler calls `askGrok` and persists the draft |

## Architecture at a glance

```
                                                  Grok                  Postgres
                                                   ▲                       ▲
                                                   │ askGrok()             │ INSERT
                                                   │                       │
   x.com tweet page  ◀──── content script ───►  stratus API (Hono, bearer-guarded)
   ┌────────────────┐     POST /x/replies/        ┌──────────────────────────┐
   │ 🪄 Reply       │     generate                │ /x/replies/generate      │
   │ Master button  │  ────────────────────────►  │   → askGrok              │
   └─────┬──────────┘                             │   → INSERT reply_drafts  │
         │ clipboard write (immediate)            │   → return row           │
         │ + chrome.storage.local                 └──────────────────────────┘
         │   ('replyMaster:lastDraft' = row)
         ▼
   Side panel — Reply Master tab
   ┌────────────────────────────────────┐
   │ Context summary (collapsible)      │   GET /x/replies     PATCH /x/replies/:id
   │ Reply textarea (editable)          │  ─────────────►   ◄─────────────────
   │ [Copy] [Mark posted] [Discard]     │
   │ History list (last N drafts)       │
   └────────────────────────────────────┘
```

Single round-trip per generation. The content script triggers, the side panel observes (no live coupling needed because the side panel may not be open when the button fires — it reads from storage).

## Data model

New table in `src/x/db/schema.ts`. Lives in the X slice because it references a real X tweet and may end up linked to a published reply (per-platform isolation rule in `CLAUDE.md`).

```ts
export const replyDrafts = pgTable(
  'reply_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Source tweet — the one we're replying to
    sourceTweetId: text('source_tweet_id').notNull(),
    sourceAuthorUsername: text('source_author_username').notNull(),
    sourceAuthorDisplayName: text('source_author_display_name'),
    sourceText: text('source_text').notNull(),
    sourceUrl: text('source_url').notNull(),
    sourcePostedAt: timestamp('source_posted_at', { withTimezone: true }),

    // Scraped context — top comments + metrics blob (PostContext shape)
    contextSnapshot: jsonb('context_snapshot').notNull(),

    // What Grok produced (may be edited by user before/after copy)
    replyText: text('reply_text').notNull(),
    replyTextEdited: text('reply_text_edited'), // null until user edits

    // Grok metadata
    model: text('model').notNull(),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    costUsd: text('cost_usd'), // numeric stored as text for parity with cost_events
    grokRequestId: text('grok_request_id'),

    // Optional override the user supplied to steer this generation
    systemPromptOverride: text('system_prompt_override'),

    // User-controlled state
    status: text('status').notNull().default('generated'),
    // 'generated' | 'copied' | 'posted' | 'discarded'
    postedTweetId: text('posted_tweet_id'), // populated when user marks posted

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('reply_drafts_source_created_idx').on(t.sourceTweetId, t.createdAt.desc()),
    index('reply_drafts_status_created_idx').on(t.status, t.createdAt.desc()),
  ],
);
```

Why a separate `replyTextEdited` instead of clobbering `replyText`: I want to keep the raw Grok output for later analysis (style drift, A/B prompts). The UI shows `replyTextEdited ?? replyText`.

Why no FK to `voice_tweets`: the source tweet might not be one we've stashed. Looser coupling.

Why `costUsd` is stored as text: matches `cost_events.costUsd` (Drizzle's `numeric` mapping). The actual cost row still lands in `cost_events` via `askGrok`'s fire-and-forget log — this column is a denormalized convenience for the UI list.

## API surface

New file: `src/x/routes/replies.ts`. Mounted under `/x` by `src/x/index.ts::mountX`. Bearer-guarded by `app.ts`.

```
POST   /x/replies/generate     body: { context, systemPromptOverride?, model?, reasoningEffort? }
                               → 201 { ...draft row }
GET    /x/replies              ?status=&sourceAuthor=&limit=&since=
                               → [draft rows newest-first]
GET    /x/replies/:id          → draft row
PATCH  /x/replies/:id          body: { replyTextEdited?, status?, postedTweetId? }
                               → updated row
DELETE /x/replies/:id          → 204 (hard delete — these are cheap drafts)
```

### `POST /x/replies/generate` in detail

Request body:

```ts
interface GenerateReq {
  context: PostContext;          // shape mirrors reply-master/src/types.ts
  systemPromptOverride?: string; // optional — see "Prompt template" below
  model?: string;                // defaults to grok-4.3
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
}

interface PostContext {
  url: string;
  tweetId: string;               // added to reply-master's shape — we need it for the FK-ish columns
  author: string;                // display name
  handle: string;                // '@username' or 'username'
  text: string;
  postedAt: string;              // ISO
  metrics: { views: number; replies: number; reposts: number; likes: number };
  topComments: { author: string; handle: string; text: string }[];
}
```

Handler outline:

```ts
const ctx = validate(body.context);            // strict; reject missing tweetId/handle/text
const messages = buildGrokInput(ctx, body.systemPromptOverride);
const result = await askGrok({
  model: body.model,
  messages,
  reasoningEffort: body.reasoningEffort ?? 'low',
  maxOutputTokens: 280,                        // tweet length cap + a little slack
  temperature: 0.7,
});

const [row] = await db
  .insert(replyDrafts)
  .values({
    sourceTweetId: ctx.tweetId,
    sourceAuthorUsername: stripAt(ctx.handle),
    sourceAuthorDisplayName: ctx.author,
    sourceText: ctx.text,
    sourceUrl: ctx.url,
    sourcePostedAt: ctx.postedAt ? new Date(ctx.postedAt) : null,
    contextSnapshot: ctx,
    replyText: result.text.trim(),
    model: result.model,
    promptTokens: result.usage.inputTokens,
    completionTokens: result.usage.outputTokens,
    costUsd: result.costUsd.toFixed(5),
    grokRequestId: result.requestId,
    systemPromptOverride: body.systemPromptOverride ?? null,
    status: 'generated',
  })
  .returning();

return c.json(row, 201);
```

No double-cost-logging: `askGrok` already writes a `cost_events` row with `platform='grok'`. The denormalized `costUsd` on `reply_drafts` is for the UI list only.

### `PATCH /x/replies/:id`

Allowed transitions:

- `generated` → `copied` (auto-bumped by side panel "Copy" button)
- `generated` | `copied` → `posted` (with optional `postedTweetId` if user pastes the URL)
- any → `discarded`

The handler validates the transition and updates `replyTextEdited` if provided. No status-machine framework — a small switch suffices given the scope.

## Prompt template (Grok input)

Default system prompt — drop straight into `src/x/replies/prompt.ts` so it's editable without redeploying:

```
You are drafting a single reply tweet on X. Hard constraints:
- ≤ 270 characters (leave room for typos and "Reply" prefix).
- One self-contained idea. No threads, no numbered lists.
- Don't address the author by name unless it adds value.
- No hashtags unless the original used them. No emoji unless the original used them.
- Don't summarize the parent tweet back at the author.
- Match the original's tone (terse if terse, playful if playful).
- Output the reply text only — no preamble, no quotation marks.
```

User-turn content is a structured rendering of `PostContext`:

```
ORIGINAL TWEET
@{handle} ({author}, {relativeTime}):
{text}

ENGAGEMENT
likes={likes} reposts={reposts} replies={replies} views={views}

TOP REPLIES (oldest first, up to 10)
1. @{handle1}: {text1}
2. @{handle2}: {text2}
...
```

`systemPromptOverride` from the side panel **replaces** the default system prompt — power-user knob; v1 leaves the UI field empty and uses the default.

## Backend wiring

- `src/x/db/schema.ts` — add `replyDrafts` table.
- `drizzle-kit` — generate + apply migration (`bun run db:generate`, `bun run db:migrate` — check actual scripts).
- `src/x/routes/replies.ts` — new file, exports `createRepliesRouter()` (no deps yet; passes through to `askGrok`).
- `src/x/index.ts::mountX` — `app.route('/x', createRepliesRouter())`.
- `src/x/replies/prompt.ts` — system prompt + `buildGrokInput(ctx, override)`.
- No new env vars. The route refuses to mount if `XAI_API_KEY` is missing — same pattern as `mountGrok`.

## Extension wiring

### Content script (`extension/src/content.ts` — extend, don't fork)

Already injects the "Save to stratus" button on every tweet's action row. Add a **second button** next to it: **"Reply Master"** (a small 🪄 affixed via the same `actionRow.appendChild` pattern).

Button gating:

- Only render on tweet-detail pages: `focusedTweetIdFromUrl()` returns non-null **and** the article is the focused tweet (first article matches focused id).
- Hide on the author's own tweets — no point Grok-replying to ourselves (compare against `selfXUserId` from settings, fetched once at start).

Click handler:

1. Scrape the full `PostContext` (port from `reply-master/src/scrape.ts`).
2. Send `POST /x/replies/generate` via the existing background `ApiRequest` channel.
3. On success:
   - `navigator.clipboard.writeText(row.replyText)` — runs in content script with user activation, so it works.
   - `chrome.storage.local.set({ 'replyMaster:lastDraft': row })` to hand the row to the side panel.
   - Optimistically swap button label: `Reply Master` → `Copied ✓` (2.5s reset, same `setState` pattern the save button uses).
   - Best-effort `chrome.runtime.sendMessage({ type: 'stratus/reply-master:open' })` for the side panel to switch to the Reply Master tab if it's open.
4. On failure: button shows `Failed: <code>` for 2.5s.

We do **not** call `chrome.sidePanel.open()` — `openPanelOnActionClick` is already on, the user can open it themselves; auto-opening from a page click would feel intrusive and the side panel may already be open.

### Background (`extension/src/background.ts`)

No code changes required. The new endpoint goes through the existing typed `ApiRequest` plumbing. The only addition is forwarding a non-`stratus/api` message type (`stratus/reply-master:open`) — handle it by re-broadcasting via `chrome.runtime.sendMessage` so the side panel can react:

```ts
chrome.runtime.onMessage.addListener((msg, _sender) => {
  if (msg?.type === 'stratus/reply-master:open') {
    chrome.runtime.sendMessage({ type: 'stratus/reply-master:focus' }).catch(() => {});
    return false; // no reply
  }
  // ...existing isApiRequest handler...
});
```

### Side panel — new tab `Reply Master`

Files:

- `extension/src/sidepanel/ReplyMaster.tsx` — main panel.
- `extension/src/sidepanel/replyMasterStorage.ts` — typed wrapper around `chrome.storage.local.get/set/onChanged` for the `replyMaster:lastDraft` key.
- `extension/src/sidepanel/App.tsx` — add `'reply'` to the `Tab` union and `TABS` array; mount `<ReplyMasterPanel />`.
- `extension/src/sidepanel/api.ts` — add `api.replies.list/get/patch/remove/generate` typed wrappers (mirror the `voice` namespace style).
- `extension/src/shared/types.ts` — add `ReplyDraft`, `PostContext`, `ReplyStatus` types.
- `extension/src/sidepanel/styles.css` — Reply Master classes (`.reply-context`, `.reply-textarea`, `.reply-history`, etc.).

Panel UX (top-to-bottom):

1. **Capture banner** — if `replyMaster:lastDraft` is set, show "Drafted from @username · 12s ago" with a "Clear" link. Otherwise show muted text: *"Open a tweet on x.com and click 🪄 Reply Master to start a draft."*
2. **Context summary** — collapsible `<details>` showing original text, metrics, top-reply count.
3. **Reply textarea** — `<textarea>` bound to `replyTextEdited ?? replyText`. Character counter (red over 280). Edits PATCH the row on blur (debounced).
4. **Toolbar buttons**:
   - **Copy** — `navigator.clipboard.writeText(current)`, PATCH status → `copied`.
   - **Regenerate** — re-POST `/x/replies/generate` with the same context (creates a *new* row, leaves the old one intact; UI swaps to the new one).
   - **Mark posted** — opens an input for an optional posted-tweet URL, PATCH status → `posted` + `postedTweetId`.
   - **Discard** — DELETE, then clear `replyMaster:lastDraft`.
5. **System-prompt override** — collapsed `<details>` with a textarea. Empty = use default. Saved in storage so it persists across sessions.
6. **History** — list of the last 50 rows (`GET /x/replies?limit=50`), grouped by source tweet. Each row: status badge, source `@handle`, reply snippet, cost. Click → loads it into the editor (read-only unless status is `generated`).

State management: panel re-renders on `chrome.storage.onChanged` for `replyMaster:lastDraft`, plus a manual Refresh button for the history list.

### Manifest changes (`extension/public/manifest.json`)

`navigator.clipboard.writeText` from a content-script context after a user gesture **does not** require the `clipboardWrite` permission in MV3 (the spec carves out a user-gesture-only path). I'll add it anyway for explicitness so the side-panel "Copy" button is bulletproof too:

```json
"permissions": ["sidePanel", "storage", "clipboardWrite"]
```

No other manifest changes needed — we're already host-permitted on `x.com` / `twitter.com` and the local API.

## Cost ceiling

`grok-4.3` at $1.25 input / $2.50 output per 1M tokens. A typical reply call (system prompt ~120 tok + context ~500 tok + 10 short comments ~400 tok + 280 tok output) lands around **$0.0019** per generation. 100 drafts/month ≈ $0.19. Cheap enough that we don't gate it. The `cost_events` row from `askGrok` keeps `/cost/today` accurate.

## Build order (suggested)

Each step ends with something runnable. Don't merge them into one diff.

1. **Schema + migration** — add `reply_drafts`, generate migration, apply locally. Verify with `\d reply_drafts`.
2. **Backend route, no extension** — `src/x/routes/replies.ts` + `prompt.ts`, mount in `mountX`. Smoke with `curl`:
   ```bash
   curl -X POST localhost:3000/x/replies/generate \
     -H "Authorization: Bearer $STRATUS_BEARER" \
     -H "Content-Type: application/json" \
     -d '{"context":{"tweetId":"...","url":"...","author":"X","handle":"x","text":"hello","postedAt":"2026-05-11T00:00:00Z","metrics":{"views":0,"replies":0,"reposts":0,"likes":0},"topComments":[]}}'
   ```
   Verify: 201 response, row in DB, `cost_events` row with `platform='grok'`.
3. **GET/PATCH/DELETE** — finish CRUD, hit each with curl.
4. **Side panel tab — read-only** — add the tab, types, `api.replies.list`, history list. No content-script changes yet; populate by posting drafts via curl.
5. **Content-script button** — inject 🪄 next to "Save to stratus", POST `/x/replies/generate`, clipboard-write, push to `chrome.storage.local`.
6. **Side panel — live draft** — observe `chrome.storage.onChanged`, render the editor, wire Copy/Regenerate/Mark posted/Discard.
7. **System-prompt override** — add the textarea, persist in storage, pass to `/generate`.
8. **End-to-end smoke** —
   - Open `https://x.com/<someone>/status/<id>`
   - Click 🪄 Reply Master
   - Confirm clipboard contains reply text (paste somewhere)
   - Open side panel → Reply Master tab
   - Confirm draft visible + history shows it
   - Edit text → PATCH writes `replyTextEdited`
   - Paste into X reply box, post manually
   - Click "Mark posted" with the posted URL → row flips to `posted` with `postedTweetId`

## Open questions (resolve before/during build)

1. **Self-tweet detection** — do we hide the button on our own tweets? Probably yes; pull `SELF_X_USER_ID` into the side panel settings on first load and check `handle` against it. Punt to v1.1 if it's friction.
2. **Quoted tweets** — if the original tweet is a quote-tweet, do we include the quoted post in `topComments` or as a separate field? v1: skip; v1.1 add `quoted: {author, handle, text}` to `PostContext`.
3. **Thread context** — on a deep thread, the parent tweet is shown above the focused one. Reuse the existing `harvestReplies` logic from `content.ts` to scoop parents too, label them in `topComments` as `parent: true`? Worth doing in v1 since it's basically free DOM work.
4. **Rate limit** — should we cap to N generations per source tweet per day to stop Regenerate-spam burning cost? My instinct is no — single-user, cost is trivial. Reconsider if I notice myself spamming.
5. **`grok-4.3-fast` vs `grok-4.3`** — Grok pricing page lists a faster/cheaper variant. Worth dropping behind the model dropdown once the default is stable.

## Out of scope for this phase

- Programmatic posting (Feb 2026 policy — see `CLAUDE.md` §"Programmatic-reply restriction").
- Auto-detecting which posted tweet on X corresponds to a `copied` draft (no good signal without the OAuth me-mentions endpoint, which costs more than it saves here).
- Multi-platform reply drafting (LinkedIn etc.) — table lives in `src/x/`, so when LinkedIn lands it'll get its own `linkedin_reply_drafts`. Don't generalize prematurely.
- Streaming the Grok response — `askGrok` is one-shot; for ~280-token outputs streaming is overkill.
- Tone presets ("snarky / supportive / curious"). Easy to add later as canned `systemPromptOverride` values; v1 keeps the surface minimal.

---

*Reviewed? Approved? → Fold the relevant bullets into `PLAN.md` as Phase 6 and start step 1.*
