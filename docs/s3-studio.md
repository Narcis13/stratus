# The Studio (deterministic visuals) — S3 · S4 · S5

> **Surface:** every post that deserves a visual gets one in under 30 seconds — a consistent brand, pixel-crisp text — composed in the extension, exported as PNG, **pasted manually**.
> **Status:** S3 shipped 2026-07-11 · S4 (AI backgrounds) 2026-07-11 · **S5 (mascot, gallery, patterns, presets) 2026-07-18**. **Cost:** $0 recurring (AI backgrounds ~$0.02/click, hard $0.50/day budget). **Plans:** `SURFACES-PLAN.md` §4–5.
>
> This is the single authoritative Studio doc. **[S4 — AI image layer](./s4-ai-image-layer.md)** covers the AI-background pipeline in depth.

---

## What it is

A **Studio tab** in the extension that turns a draft, a tweet, or the week's numbers into a branded image. A gallery of **ten templates**, a live preview that *is* the artifact, and a one-click **Copy PNG** that pastes straight into X's composer.

The composition engine is **deterministic**: the same inputs + the same bundled fonts produce the same pixels on every machine. That is what lets the live preview be the final artifact and what makes months of cards read as one brand.

S5 turns the four static S3 templates into a memorable branded *system*:

- a deterministic **cloud mascot** ("stratus" is a cloud) whose pose is tied to real data — happy on quote cards, **celebrating** when followers grew, **thinking** on thread covers;
- **six new templates** (milestone, streak, code/terminal, thread cover, numbered list, chart card), all generated from data the system already has;
- deterministic **background patterns** (`dots · grid · diagonal · plus · blobs`) as $0 alternatives to AI backgrounds;
- named **theme presets** — switch a whole brand kit in one click.

The preview-IS-the-artifact discipline, Copy-PNG-paste flow, and OAuth wall are exactly as in S3.

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
  compose.ts     ← the engine: a declarative Layer model → canvas → PNG Blob.
                   The hard 20% (wrap / shrink-to-fit / ellipsis) is PURE over an
                   injected MeasureFn, so the whole layout matrix is bun-tested
                   with a fake metrics object — no canvas, no DOM.
                   S5 added the `path` / `panel` / `pattern` layer kinds + the
                   seeded `mulberry32` PRNG (Math.random is banned in the Studio).
  mascot.ts      ← pure mascotLayers({pose,x,y,scale,kit}) → Layer[] (S5.3).
  templates.ts   ← ten pure spec(data, kit) → RenderSpec functions + parseListItems.
  milestones.ts  ← the follower-milestone ladder + latestCrossed (S5.5).
  codeTokens.ts  ← a deterministic, measure-free tokenizer for the code card (S5.6).
  chartData.ts   ← growthSeries + heatmapCells normalization for the chart card (S5.8).
  brandKit.ts    ← multi-preset brand kits (colors/font/handle/watermark/mascot).
  fonts.ts       ← bundles Inter 400/700/800 ('StudioInter') + JetBrains Mono
                   400/700 ('StudioMono') via FontFace.

extension/src/sidepanel/studio/
  registry.ts    ← TemplateId union, TEMPLATES metadata, TemplateState, buildSpec
                   dispatch. Adding a template = one row + one field section.
  fields.tsx     ← per-template field sections + the AI-background / library rail.
  KitEditor.tsx  ← the kit editor + preset switcher (save-as / rename / delete).
extension/src/sidepanel/Studio.tsx   ← the shell: picker → live preview → export.
extension/public/fonts/*.woff2       ← the bundled typefaces (Inter + JetBrains Mono).
```

Everything is **$0** and client-side except the AI background (S4). The only server reads are `/x/brief` + digest `factsOnly` (stat card), `/x/metrics/account` (milestone + chart growth), and `/x/metrics/best-times` (chart heatmap) — all already-billed data.

---

## The composition engine — `compose.ts`

A tiny declarative layer model rendered to a canvas and exported as PNG.

### Layer kinds

| Kind | Purpose |
|---|---|
| `fill` | Solid color, or a vertical gradient when `color2` is present. |
| `image` | Cover-fit bitmap; `circle: true` clips to the box's inscribed circle. **S4's AI backgrounds land here.** |
| `text` | Wrapped, shrink-to-fit, optionally ellipsized text in a box. |
| `sparkline` | A normalized point series (follower curves on stat / chart cards). |
| `badge` | A left-to-right row of pill badges; overflowing pills are dropped. |
| `rule` | A filled bar with fully rounded ends — accents/separators. |
| `ring` | A stroked circle (`width == 2r` fills a disc — pfp monogram, list number discs). |
| `watermark` | A small bottom-right anchored mark. |
| `path` **(S5)** | SVG path data in a 100×100 viewbox, scaled into a `Box` via `Path2D`. The **mascot's** building block; strokes divide `lineWidth` by the mean box scale so line weight reads right at any size. |
| `panel` **(S5)** | Rounded rect with optional stroke/shadow — the code-card terminal window, list rows. |
| `pattern` **(S5)** | Deterministic backgrounds: `dots · grid · diagonal · plus · blobs`. Coordinates from a pure exported generator; `blobs` uses the seeded `mulberry32(seed)` PRNG so the same spec + seed = the same pixels. |

`render(spec, canvas?) → Promise<Blob>` walks the layers. It defaults to an `OffscreenCanvas` (S4's worker path), but the Studio tab passes a **detached document canvas** so loaded `FontFace`s are guaranteed visible to `measureText`/`fillText`.

### Color math — all ink from two colors

Every ink color is derived from the kit's two colors, so the palette constraint holds:

- `hexToRgb(hex)` — `#rgb` / `#rrggbb` → components (null otherwise).
- `contrastOn(bg)` — the ink that reads on a background, via a perceptual luma cut.
- `shade(hex, amount)` — lighten (`>0`) / darken (`<0`) toward white/black. **The mascot is entirely `shade(kit.accent, …)` — no hardcoded hex, so it re-skins with the brand.**
- `withAlpha(hex, alpha)` — an `rgba(...)` string (muted text, scrims, badge fills, confetti).

### Text layout — the hard 20%, pure and tested

The layout is a pure function over an injected `MeasureFn` (`(text, sizePx) => width`), so the whole matrix unit-tests in bun with a fake metrics object.

- `wrapLine` — greedy word wrap; a word wider than the box (URLs, long handles) is **hard-broken by characters**.
- `wrapAll` — explicit newlines are paragraph breaks and **blank lines survive** (tweet rhythm).
- `layoutText` — wrap → **shrink in 2px steps** down to `minSizePx` → **ellipsize** at the floor if nothing fit. Never returns zero lines.
- `sparklineCoords(points, box)` normalizes a series into box coordinates (empty below 2 points).

---

## The mascot — `mascot.ts` (S5.3)

`mascotLayers({ pose, x, y, scale, kit }) → Layer[]` — a pure vector cloud, **chosen over an AI mascot on purpose**: $0, pixel-identical forever, snapshot-testable. Every feature (body, eyes, mouth, arms, confetti, thought-trail) is a `path` layer sharing one `box` in a 100×100 viewbox, so the whole mascot is one coordinate system with no per-feature canvas math. Colors are all `shade(kit.accent, …)`, so the mascot re-skins for free when a preset changes the accent.

| Pose | Where | Trigger |
|---|---|---|
| `happy` | quote card (bottom-left) | default |
| `celebrating` | stat card (by the sparkline), streak card, milestone | week's follower delta > 0 / an active streak |
| `thinking` | thread cover (bottom-right) | thread covers |
| `sleeping` | — | a plain-text "zzz" (repo no-emoji rule) |

`BrandKit.mascot` (boolean, default true) gates it; templates guard with `if (kit.mascot && !data.background …)` so an AI background suppresses the mascot rather than fighting it. Byte-identity regression tests lock `mascot:false` === the pre-S5 render.

---

## The templates — `templates.ts`

Each template is a pure `spec(data, kit) → RenderSpec` — no canvas, no fetch, no clock — so layer lists snapshot-test and the same inputs always produce the same card. `fmtCount` uses a fixed `en-US` locale so counts never drift between machines.

| Template | Size | Bg-capable | Contents |
|---|---|:---:|---|
| **Quote card** | 1200×675 | ✓ | Accent rule + shrink-to-fit quote + handle + happy mascot + watermark. Seeded from the Composer's "Make visual" and the re-up flow. |
| **Stat card** | 1200×675 | — | "THIS WEEK" + follower count + week-delta badge + live sparkline + top post + posts/replies + streak + celebrating-on-growth mascot. From `/x/brief` + digest `factsOnly`. |
| **Banner** | 1500×500 | ✓ | Headline + pillar-keyword badge strip (from active pillars) + follower milestone. |
| **Profile-pic frame** | 400×400 | — | Photo circle-cropped in an accent ring; monogram fallback (`lineHeight: 1`). |
| **Milestone** *(S5.5)* | 1200×675 | — | The latest crossed follower milestone (auto from `/x/metrics/account`) + confetti + celebrating mascot. Null → a graceful "no milestone yet" placeholder, mascot suppressed. |
| **Streak** *(S5.5)* | 1200×675 | — | Current quest streak (from `/x/brief` quests) + "day streak" + confetti + celebrating mascot. |
| **Code card** *(S5.6)* | 1200×675 | — | A terminal window (traffic-light dots, filename) + syntax-tokenized snippet in **JetBrains Mono**. Measure-free fixed-advance layout (see below). |
| **Thread cover** *(S5.7)* | 1200×675 | ✓ | Head-tweet hook + `a thread · 1/N` badges + thinking mascot. |
| **List card** *(S5.7)* | 1200×675 | ✓ | Title + up to 6 numbered accent discs (`parseListItems` strips list markers). |
| **Chart card** *(S5.8)* | 1200×675 | — | `growth` mode: real 30-day follower curve + delta badge. `heatmap` mode: best-times 7×24 grid (below-gate cells muted). Both from already-billed data. |

`baseLayers(kit, w, h, bg, scrimAlpha, pattern?)` is the S4/S5 seam: with an AI background it lays an `image` cover + a scrim **under** the text; with a pattern it lays the pattern; otherwise the plain gradient. Only the four bg-capable templates call it — patterns and AI backgrounds reach exactly those.

### Code card — measure-free by design

`MONO_ADVANCE = 0.6` is **exact, not a guess**: JetBrains Mono is 600 advance units on a 1000 em, so a token at column `c` sits at `codeLeft + c·fontSizePx·0.6` with **zero `measureText`**. That is *why* the mono font is bundled — the advance ratio must be identical across machines. `codeTokens.ts` is a deterministic tokenizer (keywords/strings/comments/numbers); the card caps at 18 lines / 62 cols with a `⌄ trimmed` footer (a symbol, not an emoji).

### Chart card — the two live-data fills

- **Growth**: `growthSeries(rows)` maps `/x/metrics/account` snapshots to raw follower points; the `sparkline` layer does its own min→max fit.
- **Heatmap**: `heatmapCells(cells, minN=3)` builds the full 7×24 grid from `/x/metrics/best-times`; a cell below the S0.4 gate (`posts < 3` or no value) is `sufficient:false`/`intensity:null` and renders a muted wash. Intensity is a **min→max** normalization over the sufficient set (least-active → 0.15 floor, most-active → 0.9; a flat set → uniform 0.5).

---

## The brand kit & presets — `brandKit.ts`

The whole visual identity, in `chrome.storage.local`. S5 grew it from a single kit to a **named-preset bundle** (key `studio:brandKits`); a legacy single-kit `studio:brandKit` value is migrated into `kits.default` on first load, and the active kit is still mirrored to the legacy key for rollback safety.

```ts
interface BrandKit {
  bg: string;               // card background; ink is derived from it
  accent: string;           // the one accent color
  fontFamily: string;       // STUDIO_FONT_STACK by default
  handle: string;           // bare, no @
  watermark: boolean;
  watermarkText: string;
  mascot: boolean;          // S5 — show the cloud mascot (default true)
  imageStyleSuffix: string; // S4 — the fixed AI-prompt style suffix
}
interface BrandKits { active: string; kits: Record<string, BrandKit>; }
```

Starter presets: **Midnight** (dark, blue accent), **Paper** (light, blue), **Neon** (near-black, mint). `activeKit(bundle)` returns the current kit by reference. The pure preset mutations (`patchActiveKit`/`setActivePreset`/`savePresetAs`/`renamePreset`/`deletePreset`) never touch `chrome.*` — the shell wraps them in `applyBundle(fn)` which persists. `parseBrandKitsFile` accepts **both** the multi-preset bundle and a legacy single-kit JSON, each field falling back leniently, so an import from any older build still lands.

### Deterministic typography — `fonts.ts`

The bundled **Inter 400/700/800** (`'StudioInter'`) and **JetBrains Mono 400/700** (`'StudioMono'`, OFL-1.1) WOFF2s load via `FontFace` and are added to `document.fonts`. This is what makes a card render pixel-identical everywhere. Load failure is **non-fatal** — the system font tail takes over (the card just isn't byte-stable). Loading is memoized.

---

## The Studio tab — `Studio.tsx` + registry

Flow: **template gallery → debounced live preview → Copy PNG / Download / Save to library / Mark "visual made".**

Because the engine is deterministic, the preview *is* the artifact. Adding a template is a `registry.ts` row + a `fields.tsx` section + a `buildSpec` case — **never** a new branch in the render loop (`buildSpec` is exhaustive over the `TemplateId` union).

- **Copy PNG** — `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])`. Pastes straight into X's composer.
- **Download** — saves `stratus-<template>-<w>×<h>.png`.
- **Background control** — for bg-capable templates, an inline segmented control `gradient · dots · grid · diagonal · plus · blobs · ai`. `bgMode` is the single source of truth; `patternKind` derives from it.
- **Kit editor + presets** — colors, handle, watermark, mascot toggle, the S4 style suffix; preset switcher (save-as / rename / delete) + Export/Import/Reset JSON.
- **Live-data cards** — stat (`/x/brief` + digest `factsOnly`, so no Grok narration), milestone (`/x/metrics/account`, override beats auto), chart (account series + best-times, lazily loaded).

### Seeding — how a draft becomes a card

The tab is seeded via `App.openStudio(seed)` with `StudioSeed { text, postId?, template? }`:

- The **Composer's "Make visual"** hands over the draft text (and the calendar row id when editing); thread mode seeds the **thread cover** (`template: 'thread'`).
- A **profile-click leader's re-up** hands over the winning tweet (quote card).

---

## The `media_note` marker (S3.4)

The visual is meant to attach to a specific scheduled post, but the publisher can't attach it (OAuth 1.0a). So the Studio stamps a **reminder** instead of silently failing.

- Nullable column **`scheduled_posts.media_note`** (migration `0011_wonderful_purifiers.sql`), validated on `POST`/`PATCH` (≤280 chars; `null`/empty clears).
- The **"Mark visual made"** button (shown when the tab was seeded with a `postId`) sets `mediaNote` via `api.update`.
- **Calendar** rows and **Today's** plan render an amber **"visual"** chip. The Composer edit view shows the marker with one-click clear.

**v1 keeps the publisher blind to it** — a nudge, not an action (a `needs_media` publisher-skip is a separate open question).

---

## Cost & security invariants

| Guarantee | How |
|---|---|
| $0 recurring | Composition is client-side canvas; server reads are already-billed brief/digest/metrics data |
| Never triggers Grok narration | Stat/milestone cards read the digest with `factsOnly: true` |
| Never auto-posts an image | Export ends at the clipboard — a human pastes (OAuth 1.0a wall) |
| Deterministic brand | Two-color palette + bundled fonts + seeded PRNG (no `Math.random`); the preview equals the export |
| AI stays backgrounds-only | The mascot is a vector, not a model; the image pipeline never generates text/mascots |

---

## Tests

- **`compose.test.ts`** — wrap/shrink/ellipsis matrix, color math, sparkline + the pattern-coordinate generator.
- **`mascot.test.ts`** — pose layer lists, `mascot:false` byte-identity regression.
- **`templates.test.ts`** — all ten templates' layer lists (snapshots), background+scrim ordering, `parseListItems`, code-card column math, celebration null-placeholders.
- **`milestones.test.ts` / `codeTokens.test.ts` / `chartData.test.ts`** — the pure data helpers (ladder/`latestCrossed`, tokenizer, growth/heatmap normalization + the min-N gate).
- **`brandKit.test.ts`** — lenient multi-preset + legacy-single parse round-trip.
- **`src/x/routes/calendar.test.ts`** — `media_note` lifecycle + guards.
- **`scripts/smoke-studio.ts`** — $0 asset-library round-trip incl. every S5 kind (`milestone/streak/code/thread/list/chart`) surviving the whitelist; `--live` fires one real AI generation.

**Verified in a real browser (S5, 2026-07-18):** a bundled harness rendered every one of the ten templates through the real `compose`/`templates`/`registry` modules across all three starter presets. Confirmed: the bundled Inter + JetBrains Mono fonts load; mascot poses are correct (quote=happy, stat/streak=celebrating on positive delta, thread=thinking) and kit-colored; milestone/streak confetti renders; the chart card draws a real growth curve and a heatmap with below-gate cells muted; switching presets re-skins **every** template instantly (Midnight → Paper light theme incl. the light code terminal → Neon); every template's spec renders **byte-identical across two renders** (all ten + the seeded `blobs` pattern), holding the determinism contract; and **Copy PNG** wrote a 174KB `image/png` `ClipboardItem` to the clipboard from a real click. *(The full unpacked-extension in-panel walk — native "Load unpacked" + a live-token server — is not scriptable here; the harness renders the identical module output the shell renders, the S3 verification discipline. Live-data fills used representative sample data of the exact `/x/brief`·`/x/metrics/*` shapes.)*

---

## Related

- **[S4 — AI image layer](./s4-ai-image-layer.md)** — AI backgrounds composited *under* the deterministic text via `baseLayers()`.
- **[Composer tab](./composer-tab.md)** — the "Make visual" hand-off (incl. thread mode) and the `media_note` chip.
- **[Today tab](./today-tab.md)** — the stat/milestone/chart data sources and the re-up hand-off.
