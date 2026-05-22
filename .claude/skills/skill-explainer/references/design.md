# Design system — Skill Explainer

The aesthetic is fixed. Every explainer reads as a member of the same family.

This file is the philosophy. `assets/skeleton.html` is the executable embodiment of every token and component described here.

---

## Identity

**Aerospace mission-control × editorial tech journal.**

The bones are mission-control — hairline grids, corner brackets, monospace labels, numbered sections, live-instrument moments. The soul is editorial — large italic display serif, generous negative space, prose that takes its time.

The reader should feel they've been handed an operator's manual someone took seriously.

---

## Color tokens

Named groups, fixed values. All variables on `:root`.

### Voids — backgrounds, blue undertone

```
--void:            #05080F   page background
--deep:            #0A1020   section / panel base
--panel:           #0F1830   raised panel
--raised:          #131D38   inline pill / code background
--edge:            #1F2A48   strong panel border
--hairline:        rgba(140, 175, 230, 0.10)
--hairline-strong: rgba(140, 175, 230, 0.22)
```

### Mists — text

```
--mist-100: #DCE5F2   primary text
--mist-200: #A1B2D0   secondary text
--mist-300: #6E81A4   labels, captions
--mist-400: #44557A   ultra-quiet labels
--mist-500: #2A3552   inactive
```

### Blues — accents

```
--cobalt: #4A8FE7   primary structural accent
--cyan:   #6EE0FF   highlight accent (the LIVE feel)
--azure:  #2D5BD5   deep accent
--frost:  #B8E5FF   italic display accent
```

### Signals — reserved for meaning

```
--mint:  #7DD3A0   success / posted
--ember: #FFB55A   warning / pending-with-issue
--coral: #FF7A7A   danger / failed
--gold:  #E8C572   rare hero accent
```

### Discipline

Signal colors carry meaning, full stop. Don't decorate with coral — it screams hazard. Cyan is reserved for "live" / "now". Ember and coral always sit on tinted backgrounds (`rgba(255, 181, 90, 0.06)`, `rgba(255, 122, 122, 0.06)`).

---

## Typography

Three fonts. No substitutes.

| Role    | Family            | Notes                                                              |
|---------|-------------------|--------------------------------------------------------------------|
| Display | **Fraunces**      | Variable serif with personality. Italic axis carries editorial accents. |
| Body    | **Geist**         | Modern grotesque. Default weight 380 (between 300 and 400). 500 for emphasis. |
| Mono    | **JetBrains Mono**| Data, paths, code, timestamps.                                     |

Google Fonts import (use exactly this line):

```html
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Geist:wght@100..900&family=JetBrains+Mono:wght@400..700&display=swap" rel="stylesheet">
```

CSS variables: `--serif`, `--sans`, `--mono`.

### Type scale

| Element       | Family   | Size                           | Notes |
|---------------|----------|--------------------------------|-------|
| `h1` (hero)   | Fraunces | `clamp(72px, 11vw, 168px)`     | weight 300, line-height 0.88, letter-spacing -0.05em. Only in hero. |
| `h2` (section)| Fraunces | `clamp(36px, 5vw, 64px)`       | weight 400, line-height 1.02, letter-spacing -0.03em. |
| `h3`          | Fraunces | 22px (28px in featured cards)  | weight 400, line-height 1.2–1.25. |
| `p.lede`      | Fraunces *italic* | `clamp(18px, 1.6vw, 22px)` | line-height 1.5, max-width 56ch. |
| Body          | Geist    | 15px                           | weight 380, line-height 1.55. |
| Eyebrow       | JetBrains Mono | 11px                     | letter-spacing 0.22em, uppercase, mist-300. |
| Code inline   | JetBrains Mono | 12–13px                  | bg `--raised`, color `--cyan`, border `--hairline`. |

### The editorial signature

Every `h2` should contain an `<em>` that styles italic + `--frost`. This is the one editorial moment per section.

```html
<h2>The work, <em>in shape.</em></h2>
<h2>These were learned <em>the expensive way.</em></h2>
<h2>Speak to the operator, <em>not the wire.</em></h2>
```

Without this break, the headlines feel templated. With it, the page feels written.

---

## Layout

- **Max content width:** `1400px`, centered.
- **Gutter:** `clamp(20px, 4vw, 56px)`.
- **Section padding:** `110px var(--gutter)` top/bottom.
- Sections separated by `1px dashed var(--hairline)`.
- Sticky `.topbar` at the top, sticky `.rail` on the left (hidden under 1180px).
- Breathing room: never let two content blocks touch without 24px+ between them.

---

## Atmospheric backdrop

Three fixed layers (z-index 0, behind main content). Skeleton renders all three.

1. **`.bg-grid`** — 96px square hairlines, masked by a radial gradient so they fade at the viewport edges.
2. **`.bg-glow`** — three soft radial gradients in cobalt/cyan tones at corners.
3. **`.bg-noise`** — SVG turbulence at 0.045 opacity, mix-blend overlay.

These provide depth without competing with content. Do not add additional decorative background elements per section.

---

## Component library

Each component has a fixed class name. Reuse; do not reinvent.

### `.bracket` — corner brackets

Every meaningful panel (`.terminal`, `.telemetry-frame`, `.hazard-card`, `.price-table`, `.budget-card`, …) carries 4 corner brackets. Pseudo-elements supply top-left and top-right; two empty spans inside the panel supply the bottom-left and bottom-right:

```html
<div class="terminal bracket">
  <span class="br-bl"></span><span class="br-br"></span>
  …
</div>
```

Why: it's the mission-control signature. Every framed surface reads as instrumented.

### `.topbar`

Sticky, blurred, three columns: monogram + spacer + meta strip. The meta strip carries a **live UTC clock** (mandatory — the skeleton wires it) and a **connection pulse** (`<span class="conn"><span class="pulse"></span>CONNECTED · …</span>`). The connection label may be customized per skill domain.

### `.rail`

Sticky left rail (hidden under 1180px). Numbered links (`00`, `01`, …) with a dot indicator. Active section gets cyan color and glowing dot. The skeleton wires the IntersectionObserver. Edit the `<aside class="rail">` link list to match your section IDs.

### `.eyebrow`

Section header micro-label.

```html
<div class="eyebrow">
  <span class="num">02</span>
  <span class="ln"></span>
  <span>Section caption</span>
</div>
```

Coral variant for the hazard section — apply `style="color:var(--coral)"` to the wrapper and tint the `.num` border/background.

### `.hero`

Two-column grid: text-left + figure-right.

- **Left:** eyebrow + giant `h1` (skill name lowercased, ending in a cyan period: `<h1>name<em class="dot">.</em></h1>`) + lede paragraph + meta strip (4 short mono labels).
- **Right:** `<figure class="hero-figure bracket">` with a custom SVG and a `.stamp` label in the corner.

### `.kpis`

Four-cell strip below the hero. Each `.kpi`: tiny label + giant Fraunces value (with one `em` accent in cyan) + one-line note. Always 4 desktop, 2 mobile. If the skill has fewer than 4 honest KPIs, drop the strip entirely rather than pad.

### `.terminal`

Faux-terminal code block.

- `.head` carries `<span class="lights"><i></i><i></i><i></i></span>` (three coloured dots), a filepath, a language tag.
- `<pre>` holds JetBrains Mono content with syntax classes:

| Class    | Meaning             | Color    |
|----------|---------------------|----------|
| `.prompt`| `$` prompt          | cyan     |
| `.cm`    | comment, italic     | mist-400 |
| `.k`     | keyword             | cobalt   |
| `.s`     | string              | mint     |
| `.n`     | number              | ember    |
| `.var`   | variable / boolean  | frost    |

### `.endpoint-table` · `.endpoint-row` · `.verb`

For skills with a callable surface (HTTP, CLI, function-call). Each row is a four-column grid: verb pill + path + purpose + cost-pip.

Verb colors (memorize):

| Class           | Color  | Use for                      |
|-----------------|--------|------------------------------|
| `.verb.get`     | cyan   | read                         |
| `.verb.post`    | mint   | create                       |
| `.verb.patch`   | ember  | modify                       |
| `.verb.delete`  | coral  | destroy                      |
| `.verb.run`     | cobalt | execute / generic action     |

For non-HTTP skills, repurpose: `RUN` for CLI commands, `CALL` for function calls, `GET` for read-only queries.

Path segments: `.seg-id` (ember) for `:params`, `.qs` (mist-400) for `?query=…`.

Cost-pip on the right: `.zero` (mist-400, "free"), default (mist-300), `.warn` (ember).

### `.telemetry-frame`

The Canvas wrapper. Header bar (live cyan dot + label + controls: PAUSE/PLAY + 1×/2×/4×). Canvas. Four-cell stats grid below. Caption underneath in `.telemetry-caption`. The animation pattern lives inside; see `canvas_patterns.md`.

### `.hazard-grid` · `.hazard-card`

A grid of 3–5 cards. The most important rule gets `.featured` (spans an extra row/column). Each card:

- Coral micro-label `HAZARD · 0N · Topic` with a `.tri` (small coral triangle).
- Italic-fragment `h3` stating the rule.
- One custom SVG illustration (`<div class="ill">`).
- 1–2 paragraph explanation.
- Dashed REF footer.

### `.workflow`

Two-column block: head + terminal. Repeat per workflow, separated by dashed hairlines.

- **Head:** tag micro-label + `h3` with italic fragment + paragraph + bulleted constraints (12px cobalt dash markers).
- **Right column:** a `.terminal` showing the actual commands.

If the source workflow has no commands, fill the right column with a small structural SVG or a numbered list styled like a `.terminal`.

### `.price-table` · `.price-row`

Three columns: surface | price | bar. Sort cheapest to most expensive. Bars are proportional — let the dramatic spike fill 100%, even if it makes lesser bars nearly invisible. The asymmetry is the point.

Price tier classes:
- `.price.cheap` (mint) for sub-cent.
- `.price.mid` (cyan) for $0.001–0.009.
- `.price.high` (ember) for $0.01–0.05.
- `.price.spike` (coral) for outliers — also tint the row background with `rgba(255,122,122,0.04)`.

### `.budget-card`

Sidecar to the price table. Each row: italic Fraunces name (with small caption underneath) + bold cyan figure (with small right-aligned caption).

### `.conduct-grid` · `.conduct-card`

Two-column grid of small typographic cards. Each: small cyan letter index (A, B, C, D), italic-Fraunces h4, one-line body.

### `footer`

Two-column: italic Fraunces tagline left (one sentence, source-of-truth flavored), right-aligned mono caption pointing back to canonical doc.

---

## Motion principles

- **Reveals.** Sections fade-up on scroll, 800ms ease-out, via IntersectionObserver + `.reveal` + `.reveal-delay-{1..4}`. Staggered by 100ms per delay class.
- **Pulses.** Live elements (connection dot, telemetry-frame label dot) breathe at 1.6–2.2s intervals.
- **Canvas.** Always at 60fps via RAF. Speed controls (1×, 2×, 4×) scale sim-time, never render rate.
- **Reduced motion.** `@media (prefers-reduced-motion: reduce)` disables reveals and pulses. The skeleton handles this.

---

## Tone (for the prose itself)

- Editorial, not chirpy.
- Specific verbs ("flips", "scans", "lands on jittered minutes"), never marketing verbs ("seamlessly", "leverage", "robust", "powerful", "intuitive").
- Italic Fraunces fragments inside larger sans copy are the editorial signature — used sparingly, deliberately. Once per heading is right; twice is too much.
- Reference numbers (`HAZARD · 01`, `OP · A`, `FIG · 00.A`) ground the document like a flight manual.
- Prefer the second person ("you", "the operator") to "users".

---

## What this is not

- Not flashy. No glassmorphism, no neon-on-black tropes, no glitch animations, no chromatic aberration.
- Not generic. No Tailwind defaults. No emoji. No stock icons. No Inter, no Roboto, no Space Grotesk.
- Not corporate. No three-feature-cards-with-checkmarks. No "Get started" CTA. No gradient pill buttons.
- Not playful. The aesthetic admits one wink (the italic editorial fragment); everything else is composed.
