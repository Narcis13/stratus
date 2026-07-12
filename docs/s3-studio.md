# S3 — The Studio (deterministic visuals)

> **Surface:** every post that deserves a visual gets one in under 30 seconds — a consistent brand, pixel-crisp text — composed in the extension, exported as PNG, **pasted manually**.
> **Status:** shipped 2026-07-11. **Cost:** $0. **Plan:** `SURFACES-PLAN.md` §4.

---

## What it is

A new **Studio tab** in the extension that turns a draft, a tweet, or the week's numbers into a branded image. Four templates (quote card, stat card, banner, profile-pic frame), a live preview that *is* the artifact, and a one-click **Copy PNG** that pastes straight into X's composer.

The composition engine is **deterministic**: the same inputs + the same bundled fonts produce the same pixels on every machine. That is what lets the live preview be the final artifact and what makes months of cards read as one brand.

S4 (AI backgrounds) slots into the frame S3 builds — see **[S4](./s4-ai-image-layer.md)**.

---

## The one hard constraint

`/2/media/upload` still requires OAuth 1.0a (a long-standing `CLAUDE.md` gotcha). **stratus cannot attach images to API-published posts.** The Studio is therefore an *asset pipeline ending in a human paste*:

```
compose → PNG → clipboard → open the X composer → paste → post
```

Banner and profile pic are manual uploads on X anyway. No OAuth 1.0a work exists in this plan, and the publisher is left untouched.

---

## Architecture

```
extension/src/studio/
  compose.ts    ← the engine: a declarative Layer model → canvas → PNG Blob.
                  The hard 20% (wrap / shrink-to-fit / ellipsis) is PURE over an
                  injected MeasureFn, so the whole layout matrix is bun-tested
                  with a fake metrics object — no canvas, no DOM.
  templates.ts  ← four pure spec(data, kit) → RenderSpec functions.
  brandKit.ts   ← the 2 colors + font + handle + watermark, in chrome.storage.
  fonts.ts      ← bundles Inter 400/700/800 as 'StudioInter' via FontFace.

extension/src/sidepanel/Studio.tsx   ← the tab: picker → live preview → export.
extension/public/fonts/*.woff2       ← the bundled typefaces.
```

Everything is **$0** and entirely client-side (S3 makes no server calls at all except reading `/x/brief` + `/x/digest` facts for the stat card).

---

## The composition engine — `compose.ts`

A tiny declarative layer model rendered to a canvas and exported as PNG.

### Layer kinds

| Kind | Purpose |
|---|---|
| `fill` | Solid color, or a vertical gradient when `color2` is present. |
| `image` | Cover-fit bitmap; `circle: true` clips to the box's inscribed circle. **S4's AI backgrounds land here.** |
| `text` | Wrapped, shrink-to-fit, optionally ellipsized text in a box. |
| `sparkline` | A normalized point series (the follower curve on stat cards). |
| `badge` | A left-to-right row of pill badges; overflowing pills are dropped. |
| `rule` | A filled bar with fully rounded ends — accents/separators. |
| `ring` | A stroked circle (`width == 2r` fills a disc). |
| `watermark` | A small bottom-right anchored mark. |

`render(spec, canvas?) → Promise<Blob>` walks the layers. It defaults to an `OffscreenCanvas` (S4's worker path), but the Studio tab passes a **detached document canvas** so loaded `FontFace`s are guaranteed visible to `measureText`/`fillText`.

### Color math — all ink from two colors

Every ink color is derived from the kit's two colors, so the palette constraint holds:

- `hexToRgb(hex)` — `#rgb` / `#rrggbb` → components (null otherwise).
- `contrastOn(bg)` — the ink that reads on a background, via a perceptual luma cut (`luma > 0.6` → dark ink `#0f1419`, else light `#f7f9f9`).
- `shade(hex, amount)` — lighten (`>0`) / darken (`<0`) toward white/black.
- `withAlpha(hex, alpha)` — an `rgba(...)` string (used for muted text, scrims, badge fills).

### Text layout — the hard 20%, pure and tested

The layout is a pure function over an injected `MeasureFn` (`(text, sizePx) => width`), so the whole matrix unit-tests in bun with a fake metrics object.

- `wrapLine` — greedy word wrap; a word wider than the box (URLs, long handles) is **hard-broken by characters** so nothing ever overflows horizontally.
- `wrapAll` — explicit newlines are paragraph breaks and **blank lines survive** (tweets use them as rhythm; a quote card must reproduce that rhythm).
- `layoutText` — wrap → **shrink in 2px steps** (`SHRINK_STEP`) from `fontSizePx` down to `minSizePx` until the block fits the box → **ellipsize the last line at the floor** if nothing fit. It never returns zero lines.
- `DEFAULT_LINE_HEIGHT = 1.3`.

`sparklineCoords(points, box)` normalizes a series into box coordinates (empty below 2 points).

---

## The templates — `templates.ts`

Each template is a pure `spec(data, kit) → RenderSpec` — no canvas, no fetch, no clock — so the layer lists snapshot-test and the same inputs always produce the same card. `fmtCount` uses a fixed `en-US` locale so counts never drift between machines.

| Template | Size | Contents |
|---|---|---|
| **Quote card** | 1200×675 | Accent rule + shrink-to-fit quote (floor 32px) + handle + watermark. Seeded from the Composer's "Make visual" and the re-up flow. |
| **Stat card** | 1200×675 | "THIS WEEK" + follower count (112px) + week delta badge + live follower sparkline + top post + posts/replies + streak. Built from `/x/brief` + digest `factsOnly` — zero typing. |
| **Banner** | 1500×500 | Headline + pillar-keyword badge strip (prefilled from active pillars) + follower milestone. Regenerate monthly. |
| **Profile-pic frame** | 400×400 | Uploaded photo circle-cropped in an accent ring; monogram fallback (single letter, `lineHeight: 1` so a 150px glyph doesn't overflow into "N…"). |

`baseLayers()` is the S4 seam: with an AI background it lays an `image` cover layer + a scrim (`withAlpha(kit.bg, scrimAlpha)`) **under** the text; without one, the plain gradient fill — so every template stays backwards-compatible.

---

## The brand kit — `brandKit.ts`

The whole visual identity, in `chrome.storage.local` (key `studio:brandKit`), export/import as JSON so the brand can move between machines or be versioned in a gist.

```ts
interface BrandKit {
  bg: string;              // card background; ink is derived from it
  accent: string;          // the one accent color
  fontFamily: string;      // STUDIO_FONT_STACK by default
  handle: string;          // bare, no @
  watermark: boolean;
  watermarkText: string;
  imageStyleSuffix: string; // S4 — the fixed AI-prompt style suffix
}
```

Defaults: `bg #0f1419`, `accent #1d9bf0`, watermark `"stratus"`. `parseBrandKit` is **lenient** — unknown fields ignored, missing/invalid fields fall back field-by-field, so an import from an older build still lands (null only on non-object JSON). Parsing/serializing is pure and bun-tested; only `loadBrandKit`/`saveBrandKit` touch `chrome.*`.

### Deterministic typography — `fonts.ts`

The bundled **Inter 400/700/800 WOFF2s** (in `extension/public/fonts/`) load as `'StudioInter'` via `FontFace` and are added to `document.fonts`. This is what makes a card render pixel-identical everywhere. Load failure is **non-fatal** — the font stack's system tail (`-apple-system, 'Segoe UI', Roboto, sans-serif`) takes over and the Studio keeps working (the card just isn't byte-stable). Loading is memoized.

---

## The Studio tab — `Studio.tsx`

Flow: **template picker → debounced live preview (150ms) → Copy PNG / Download / Save to library / Mark "visual made".**

Because the engine is deterministic, the preview *is* the artifact — every field edit re-renders the exact pixels that will be exported (drawn to a document canvas so the loaded fonts are visible).

- **Copy PNG** — `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])`. Pastes straight into X's composer — the killer path. Under 30 seconds, every time.
- **Download** — saves `stratus-<template>-<w>×<h>.png`.
- **Brand kit editor** — background/accent color pickers, handle, watermark toggle + text, the S4 style suffix, and Export/Import/Reset JSON. Edits save to `chrome.storage.local` immediately.
- **Stat card data** loads `/x/brief` (sparkline, live followers, streak) + `/x/digest` with `factsOnly: true` **in parallel** — the `factsOnly` flag guarantees this read never triggers the Grok-billed digest narration.
- **Banner** prefills the keyword strip from the active content pillars and the milestone from `/x/brief`.

### Seeding — how a draft becomes a card

The tab is seeded via `App.openStudio(seed)` with a `StudioSeed { text, postId? }`:

- The **Composer's "Make visual"** button hands over the draft text (and the calendar row id when editing).
- A **profile-click leader's re-up** hands over the winning tweet (quote-tweet + card is the strongest re-up format).

On seed, the tab switches to the quote card, prefills the text, and remembers the `postId` for the `media_note` stamp.

---

## The `media_note` marker (S3.4)

The visual is designed to be attached to a specific scheduled post — but the publisher can't attach it (the OAuth 1.0a wall). So the Studio stamps a **reminder** instead of silently failing.

- New nullable column **`scheduled_posts.media_note`** (migration `0011_wonderful_purifiers.sql`). Validated on `POST`/`PATCH` (≤280 chars; `null`/empty clears).
- The Studio's **"Mark visual made"** button (shown only when the tab was seeded with a `postId`) sets `mediaNote` to e.g. `"Quote card made in Studio"` via `api.update`.
- `GET /x/brief` carries `media_note` on today's scheduled slots.
- **Calendar** rows and **Today's** plan render an amber **"visual"** chip — "post manually with its visual" — rather than the row being skipped. The Composer edit view shows the marker with one-click clear.

**v1 keeps the publisher blind to it** on purpose — it's a nudge, not an action. Whether `media_note` should grow into a real `needs_media` publisher-skip + a C7-style "post this manually now" alarm is an open question in the plan (decide after living with the amber chip for ~2 weeks).

---

## Cost & security invariants

| Guarantee | How |
|---|---|
| $0 | All composition is client-side canvas work; the only server reads are `/x/brief` + digest `factsOnly` |
| Never triggers Grok narration | Stat card reads the digest with `factsOnly: true` |
| Never auto-posts an image | Export ends at the clipboard — a human pastes (OAuth 1.0a wall) |
| Deterministic brand | Two-color palette + bundled fonts; the preview equals the export |

---

## Tests

- **`extension/src/studio/compose.test.ts`** — the wrap / shrink / ellipsis matrix over a fake `measureText`, color math, sparkline normalization.
- **`extension/src/studio/templates.test.ts`** — the four templates' layer lists (snapshots, not pixels), including the S4 background+scrim ordering.
- **`extension/src/studio/brandKit.test.ts`** — lenient parse round-trip (bad fields fall back field-by-field).
- **`src/x/routes/calendar.test.ts`** — `media_note` lifecycle + validation guards.

**Verified in a real browser** over a bundled harness: all four templates render pixel-correct with the bundled fonts on both the document-canvas and OffscreenCanvas paths.

---

## Related

- **[S4 — AI image layer](./s4-ai-image-layer.md)** — AI backgrounds composited *under* the deterministic text via `baseLayers()`.
- **[Composer tab](./composer-tab.md)** — the "Make visual" hand-off and the `media_note` chip.
- **[Today tab](./today-tab.md)** — the stat card's data source and the re-up hand-off.
