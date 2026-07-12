# S4 — AI image layer

> **Surface:** non-text imagery (backgrounds, concept art) generated on demand and composited **under** S3's deterministic brand text.
> **Status:** shipped 2026-07-11. **Cost:** $0 recurring; ~$0.02 per image click, hard-watchdogged. **Plan:** `SURFACES-PLAN.md` §5.

---

## What it is

S4 adds AI-generated imagery to the Studio (**[S3](./s3-studio.md)**). A prompt (pre-seeded from a content pillar + a fixed brand style suffix) becomes a background image, generated through xAI's Grok Imagine, and composited **underneath** the deterministic, canvas-rendered brand text.

The ordering is load-bearing: **image models garble words**, so brand text is *always* canvas-rendered on top; the generated image only ever provides the backdrop. Generated backgrounds and composed cards are saved to a SQLite-backed asset library and re-openable as a base layer.

> **Model note.** The plan was written against `grok-2-image` (~$0.07/image). xAI **retired that family** on 2026-07-12 (the endpoint began 404ing `The model grok-2-image does not exist`). S4 was migrated to **Grok Imagine** — `grok-imagine-image` at **$0.02/image** (default), with `grok-imagine-image-quality` at $0.05/image available via `opts.model`. Same endpoint and request shape. Everything below reflects the shipped Grok Imagine implementation; where the plan says "$0.07", real cost is ~$0.02.

---

## Architecture

```
Studio "Generate background"  (prompt = pillar subject + kit.imageStyleSuffix)
        │  POST /x/images/generate { prompt, n≤2 }
        ▼
┌──────────────────────────────────────────────────────────────┐
│ src/x/routes/images.ts                                        │
│   • 503 if no XAI_API_KEY                                      │
│   • validate prompt / n                                       │
│   • HARD budget gate BEFORE spending (XAI_IMAGE_DAILY_BUDGET)  │
│   • return data:<mime>;base64,…  (never a raw xAI URL)         │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│ src/grok/images.ts :: generateImages                          │
│   POST https://api.x.ai/v1/images/generations                 │
│   response_format: b64_json  ← the taint-trap fix             │
│   cost from usage.cost_in_usd_ticks (fallback: pricing map)   │
│   logs a cost_events row under platform 'xai'                 │
└───────────────────────────────────────────────────────────────┘

Studio composites the base64 → ImageBitmap as an `image` layer UNDER the text
(templates.ts baseLayers), then Save-to-library → media_assets BLOB.
```

The route is **always mounted**; the `XAI_API_KEY` is checked at runtime (503 without it), so the Studio degrades gracefully.

---

## Generation — `POST /x/images/generate`

**Request:** `{ prompt: string, n?: 1|2 }` (`n` is clamped, not rejected — a slider that overshoots just gets 2).

**Response:**

```json
{
  "images": [ { "dataUrl": "data:image/jpeg;base64,…", "mediaType": "image/jpeg", "revisedPrompt": "…" } ],
  "model": "grok-imagine-image",
  "count": 1,
  "costUsd": 0.02,
  "requestId": "…"
}
```

**Error ladder:**

| Condition | Status | Body |
|---|---|---|
| No `XAI_API_KEY` on the server | 503 | `{ error: 'grok_not_configured' }` |
| Body not an object | 400 | `invalid_body` |
| Empty prompt | 400 | `invalid_prompt` |
| Prompt > 4000 chars | 400 | `prompt_too_long` |
| `n` non-integer | 400 | `invalid_n` |
| **Today's image spend ≥ budget** | **429** | `{ error: 'image_budget_exceeded', spentUsd, budgetUsd }` |
| xAI upstream error | 429 or 502 | `grok_upstream_error` |
| xAI returned zero images | 502 | `no_images` |

### The taint trap (why base64, never a URL)

An xAI image URL is cross-origin. Drawn directly onto a canvas, it **taints** the canvas and `toBlob` throws — the export path would silently break. So the module requests `response_format: b64_json`; xAI hands back base64 directly and **no raw URL ever reaches the extension**. If a model ignores the flag and returns a URL anyway, `generateImages` downloads it *server-side* and encodes it. The Studio only ever builds an `ImageBitmap` from a same-origin `data:` URL.

### The money guard (a paint session can't melt the wallet)

Image spend is isolated under a **new platform `'xai'`** in `cost_events` (the token-priced Grok *text* spend stays under `'grok'`). Before the paid call, the route sums today's `'xai'` spend (`imageSpendTodayUsd`, from UTC midnight) and refuses with **429** once it's at or over the cap.

- Env `XAI_IMAGE_DAILY_BUDGET_USD`, **default $0.50**.
- This is a **hard stop** — unlike the soft X-API watchdog that only logs, this one refuses the call.

Cost is priced from the response's reported `usage.cost_in_usd_ticks` (1 USD = 1e10 ticks) when present — exact and never stale — falling back to the `src/grok/pricing.ts` per-image table only when the response omits usage (in which case an unmapped model also triggers a `console.warn`).

### `src/grok/images.ts` — the one place all xAI image calls go

Mirrors `askGrok`'s discipline: bearer auth, retry on 429/5xx (default 3 attempts, `retry-after` honored), and a **fire-and-forget** cost log (a failed insert never breaks the caller). It sniffs the returned image type from magic bytes (xAI returns JPEG; PNG/WebP handled defensively). `GrokImageError` carries `{ status, code, message, requestId }`.

---

## Asset library — `media_assets` (BLOBs)

Composed PNGs and generated backgrounds are stored as **SQLite BLOBs** — right at single-user scale (KB–MB images), no external object store, riding the existing DB backup story. Table `media_assets` (migration `0012_grey_sharon_carter.sql`): `id` (uuid), `kind`, `prompt` (the xAI prompt for a generated background; null for a hand-composed card), `png` (blob), `media_type`, `width`, `height`, `byte_length`, `used_on_tweet_id`, `created_at`.

Routes — `src/x/routes/assets.ts`, always mounted, all $0:

| Route | Does |
|---|---|
| `POST /x/assets` | Save a base64 PNG. `≤2MB` (else **413** `asset_too_large`); `invalid_png` on bad base64; `kind` ∈ `{quote, stat, banner, pfp, background, other}` (else `other`). Returns **metadata** (201). |
| `GET /x/assets` | List **metadata only** — never the blob (a 100-card history rail must not ship 100MB). Newest first, cap 200. |
| `GET /x/assets/:id/png` | Stream the raw bytes (`Content-Type` + a long immutable cache header). |
| `DELETE /x/assets/:id` | Delete; 404 if absent. |

### The binary transport

The extension re-opens an asset through a new **binary transport**: `ApiRequest.binary` makes the background service worker fetch the blob and return `{ base64, mediaType }` (the JSON message channel can't carry a `Blob`). This keeps the one-transport / one-Authorization-owner discipline intact — the panel never fetches directly.

---

## Studio wiring

- **`templates.ts` `baseLayers()`** puts an AI background as an `image` cover layer + a scrim (a semi-transparent wash of the brand `bg`) **under** the quote-card / banner text. Backwards-compatible: no background ⇒ the plain gradient.
- **`brandKit.ts` `imageStyleSuffix`** — the fixed style suffix appended to every AI prompt (default: *"flat vector illustration, soft muted palette, subtle grain, generous negative space, no text, no letters, no words, no logos, no watermark"*). **The "no text" clause is load-bearing** — the model must not try to render words; brand text is canvas-rendered on top. Consistency across months of posts *is* the brand.
- **The Studio tab** gains a **"Generate background"** section on the quote-card and banner templates: a prompt pre-seeded from a **pillar dropdown + the kit suffix** (*seeding, not writing*), a Generate button labeled `~$0.02`, **Save to library**, and a **history rail** that re-opens any asset as the base layer (via the binary transport). Budget-exceeded and missing-key errors surface with plain-language messages.

**Prompt seeding, not prompt writing** — the goal is a consistent brand backdrop, not per-image creativity. The pillar's label is the subject; the kit suffix fixes the style.

---

## Measurement — did the images earn their lift?

S4 wires its own judge into the **Sunday digest facts**:

- **`imageSpendUsd`** — the week's `'xai'` spend.
- **`mediaVsText`** — `buildMediaEffectiveness` over own originals, split into media / text-only / unknown, emitting a views/profile-clicks lift **only when both sides clear n≥20** (the S0.2 `has_media` baseline is the actual judge of whether generated images earn their lift).

Because S0.2 added the text-only `has_media` baseline *before* S4 shipped, there is a real comparison to make once enough media posts accumulate.

---

## Cost & security invariants

| Guarantee | How |
|---|---|
| A paint session can't melt the wallet | Hard per-UTC-day budget checked **before** every paid call (429 once crossed) |
| A cross-origin URL never taints the export canvas | `response_format: b64_json`; a stray URL is downloaded server-side |
| Image spend is isolated | Logged under platform `'xai'`, separate from token-priced `'grok'` text spend |
| The DB can't be bloated by a bad paste | `POST /x/assets` caps at 2MB (413) |
| The history rail stays light | `GET /x/assets` returns metadata only; bytes stream on demand |
| Never auto-posts | The generated card still ends at a manual paste (OAuth 1.0a wall, unchanged) |
| Graceful without a key | Route always mounted; 503 `grok_not_configured` when `XAI_API_KEY` is unset |

---

## Environment

| Var | Default | Purpose |
|---|---|---|
| `XAI_API_KEY` | — | Required for generation; absent → 503. |
| `XAI_IMAGE_DAILY_BUDGET_USD` | `0.50` | Hard per-UTC-day image spend cap. |

---

## Tests

- **`src/grok/pricing.test.ts`** — the per-image rate.
- **`src/x/routes/images.test.ts`** — 503 (no key) / 400 (bad input) / **429 budget refusal**, all pre-network.
- **`src/x/routes/assets.test.ts`** — base64 round-trip byte-exact, list excludes blobs, the 2MB cap, delete.
- **`extension/src/studio/templates.test.ts`** — background image + scrim ordered UNDER the text.
- **`scripts/smoke-studio.ts`** — rerunnable. **$0 default** (asset round-trip + budget refusal); `--live` performs one real ~$0.02 generation asserting base64 comes back and the spend lands under `'xai'` in `/cost/today`.

**Verified $0 end-to-end:** the migration lands `media_assets` on the real `stratus.db` at boot, `/cost/today` buckets the image bill under `'xai'`, and the digest facts carry both `imageSpendUsd` and `mediaVsText`.

---

## Remaining "done when" tail

The first real generated-background + canvas-headline card pasted into a live tweet — with the ~$0.02 visible in `/cost/today` under `xai` and the asset re-opening from the library — is the next visual post. The OAuth 1.0a wall keeps posting a manual paste, unchanged.

---

## Explicitly not doing (this plan)

- OAuth 1.0a media upload — no API-attached images, no auto-posted visuals.
- Scheduled / unattended image generation; video (Grok Imagine video) — manual, click-priced stills only.

---

## Related

- **[S3 — The Studio](./s3-studio.md)** — the deterministic composition frame S4 slots into.
- **[Playbook tab](./playbook-tab.md)** — the `has_media` media-vs-text cell (S0.2), the lift judge.
- **[Today tab](./today-tab.md)** — the Sunday digest that reports `imageSpendUsd` + `mediaVsText`.
