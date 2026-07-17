# Stratus Design System

The design language of **stratus** — an X (Twitter) growth, authoring, and coaching
AI agent delivered as a **Chrome side-panel extension**. stratus rides along *beside*
x.com: you browse and post on X as usual, and the panel helps you decide what to do
next, draft it well, schedule it, and learn what actually works — while keeping tight
control of the tiny sums X's API charges. A recurring principle runs through the
whole product: **stratus drafts, you post.**

Because the panel lives inches from the live X timeline, this system is deliberately
**X-adjacent but distinct**: a deep near-black canvas with a single confident blue
accent, Inter type, and a compact, information-dense layout that feels at home next
to X without pretending to be X.

---

## Sources

This system was reverse-engineered from the product's own code and screenshots. The
reader may not have access, but they are recorded here so a future maintainer can go
deeper:

- **GitHub — [`Narcis13/stratus`](https://github.com/Narcis13/stratus)** — the ground
  truth. The extension side panel lives in `extension/src/sidepanel/` (React + TS);
  every token, component, and screen here was lifted from its `styles.css` and the
  `.tsx` panels (`App.tsx`, `Today.tsx`, `Composer.tsx`, `Replies.tsx`, …). The
  bundled webfonts came from `extension/public/fonts/`, and the logo from
  `extension/public/icons/icon128.png`. Product framing/tone came from `docs/`.
  **Explore this repo further to build higher-fidelity stratus designs** — the
  `docs/*.md` per-tab guides and the `.tsx` panels are the richest reference.
- **Screenshots** (in `uploads/`) — a Twitter-desktop layout reference, a live X
  home column, and an X analytics view. Used only as high-level guides; all real
  values came from code.

> **Font note:** Inter is bundled verbatim from the repo (Regular 400, Bold 700,
> ExtraBold 800). No substitution was needed. Weight 600 (semibold) is used widely in
> source but has no shipped file, so the browser synthesizes it — flagged in
> `tokens/typography.css`.

---

## Content fundamentals

stratus talks like **one operator to another** — terse, concrete, and quietly
confident. It never hypes.

- **Person & address:** second person ("**what do I do next**", "the rest of the day
  is yours"). The product refers to itself in the third person, lowercase:
  "**stratus drafts, you post.**"
- **Casing:** the brand name is **always lowercase** — `stratus`, never "Stratus" —
  except the tab-rail eyebrow, which is uppercase + muted. Section headers are short
  Title Case or lowercase uppercased via CSS (`TODAY'S QUESTS`). UI labels are
  sentence case.
- **Tone:** plain, functional, reassuring about control and cost. Reassurance is a
  motif: "**Nothing posts until you schedule it.**", "most of what stratus does is
  **free ($0)**", "gentle checkmarks, never guilt."
- **Numbers are the argument.** Copy leans on concrete figures — "$0.20 (13×)",
  "3 / 5–10 today", "2.4k avg views/day (n=6)". The **n≥20 gate** ("analytics only
  show a confident number once ~20 measured items back it") captures the honest,
  data-first voice. Metrics always use tabular numerals.
- **Punctuation:** the middot `·` separates inline meta everywhere
  ("grok-4 · $0.0038 · edited"); em dashes carry asides; the `§` sign cross-refs
  internal specs in code comments (not user-facing).
- **Emoji:** **not decorative.** The UI uses a tiny set of *functional* glyphs only —
  `✓ ○` (quests), `✕ ↑ ↓` (controls), `⚠` (warnings), `♥ ↩ ↻ 👁` (metric shorthand),
  `🪄` (the one flourish, on "Reply Master"). Never emoji as ornament.
- **Vibe:** a calm cockpit for a serious solo grower. Examples that sound like
  stratus: *"the accounts that grow fastest reply more than they post."* /
  *"your pinned tweet is your homepage."* Examples that do **not**: *"Supercharge
  your X growth! 🚀"*, *"Our AI revolutionizes engagement."*

---

## Visual foundations

- **Theme:** dark-first, and effectively dark-only — a near-black **`#0e1014`**
  canvas with a faint blue cast. Depth comes from three stacked surfaces
  (`bg` → `bg-elev #161a21` → `bg-hover #1d222b`), **not** from shadows.
- **Color:** one brand blue — **`#4f8cff`** (`--strat-accent`), lightening to
  `#6ba0ff` on hover — carries links, primary buttons, focus rings, and active
  states. Everything else is a small, meaningful semantic set: `danger #e0556d`,
  `warn #ffb454`, `ok #5ad19a`, a six-step post-lifecycle status ramp, the hot/warm
  reply-band signal (green/amber), and a pillar purple `#9b86ff`. **Max one accent;**
  no gradients anywhere. Tinted fills (12–20% alpha of the hue) back badges and
  messages. X's own palette (`--x-*`) is kept for surfaces that must blend into the
  live timeline.
- **Type:** **Inter** throughout, with the native system stack as fallback. The base
  size is **13px** (not 16px) — this is a dense panel UI. The scale runs
  9 · 10 · 11 · 12 · 13 · 14 · 15 · 26px, the 26px reserved for the one hero KPI
  number. Weights 400 / 600 / 700 / 800. Uppercase eyebrows use `0.04em` tracking.
  IDs and code use an `SF Mono` stack.
- **Spacing:** a tight **2px-based** rhythm; gaps of 2–12px do nearly all layout.
  Panels pad 14px, buttons `6px 12px`, inputs `8px 10px`, chips `1px 8px`. The tab
  rail is a fixed **104px**; a Chrome side panel is ~**360px** wide.
- **Radii:** **6px is the default** (buttons, inputs, cards, chips); 8px for panels /
  modals / draft cards; 10px for badges; 3–4px for inline code/inner blocks; 999px
  for pills, segmented tabs, and the quota bar.
- **Borders:** a **1px `#262c36` hairline** is the primary structural device —
  every card, divider, and control edge. Focus swaps the border to accent blue.
- **Shadows:** essentially none. The system is flat; the only real shadow is the
  modal (`0 12px 32px rgba(0,0,0,.5)`) over a 55%-black scrim.
- **Cards:** elevated (`bg-elev`) rectangle, 1px hairline border, 6–8px radius, no
  shadow. Never a rounded card with a colored left-border accent.
- **Backgrounds:** solid flat color only — no imagery, gradients, patterns, or
  textures. Content, not decoration.
- **Motion:** minimal and instant-feeling. Hover is a background/color swap over
  ~120ms, not a slide or scale. Press nudges primary buttons ~0.5px. No bounces, no
  entrance animations. The quota bar animates its width; that's about it.
- **States:** hover lightens muted text to full and swaps the fill one surface step
  up; active/selected uses the tinted-accent fill + accent border; disabled drops to
  0.4–0.5 opacity with `not-allowed`. Destructive actions are red-outline that fills
  red on hover.
- **Transparency & blur:** used sparingly — the modal scrim, and the X-timeline
  sticky header's `backdrop-filter: blur` (a nod to X's own chrome).

---

## Iconography

stratus is **almost icon-free by design** — a rare and deliberate choice.

- **No icon font, no icon library, no SVG icon set** ships in the extension. The tab
  rail is **text labels**, not glyphs.
- The only "icons" are a handful of **Unicode text glyphs** used functionally:
  `✓ ○` (quest done/todo), `✕` (dismiss/clear), `↑ ↓` (reorder), `▾ ▸` (disclosure),
  `⚠` (warning), `♥ ↩ ↻ 👁` (metric shorthand in reply context), and the single
  brand flourish **`🪄`** on the "Reply Master" call-to-action.
- **Status is carried by color, not iconography** — the post-lifecycle badges and
  hot/warm reply bands are colored pills, no symbols.
- **The logo** (`assets/logo.png`, from the repo) is the stylized blue **S** mark on
  a dark rounded square. The wordmark is the lowercase word **stratus** set in Inter
  ExtraBold. There is no separate wide/monochrome lockup in the source.
- **Companion caveat:** the UI-kit X-timeline backdrop uses **Lucide** icons (CDN) as
  stand-ins for X's proprietary glyphs, which are not in the repo and must not be
  reconstructed. This substitution is confined to the backdrop; it is not part of the
  stratus icon language.

When designing new stratus surfaces, **prefer a text label to an icon.** If a glyph
is unavoidable, reach for a Unicode character before any icon set.

---

## What's in here

Consumers link one file: **`styles.css`** (a manifest of `@import`s reaching every
token + font).

### Foundations
- `tokens/colors.css` — surfaces, text, accent, semantic, post-status, reply-band,
  pillar, tinted fills, X-companion refs, and semantic aliases.
- `tokens/typography.css` — Inter stack, weights, the 8-step size scale, leading.
- `tokens/spacing.css` — the 2px rhythm + composite paddings + structural widths.
- `tokens/radii.css` — radii, borders, (minimal) elevation, motion.
- `fonts.css` — the three bundled Inter `@font-face`s.
- `guidelines/*.card.html` — foundation specimen cards (Colors, Type, Spacing, Brand).

### Components (`window.StratusDesignSystem_4635dc`)
Reusable primitives, lifted from the extension's `styles.css` vocabulary:
- **Core** — `Button` (default / primary / danger; md / sm), `Badge` (full status +
  semantic + pillar + media tones), `Chip` (filters, segmented tabs, stages, bands).
- **Forms** — `Field` (input / textarea / select, with counter + focus accent + hint).
- **Feedback** — `Message` (error / warn / ok callouts).
- **Layout** — `Panel` (the tab card shell), `TabRail` (the 104px vertical nav),
  `Modal` (dialog over scrim).
- **Data** — `KpiCard` (hero metric + delta + sparkline), `QuotaBar` (progress meter),
  `Sparkline` (trend line).

### UI kit
- `ui_kits/sidepanel/` — the interactive **stratus side panel** docked next to a dark
  X timeline (`index.html`), with the **Today**, **Composer**, and **Reply Master**
  screens built from the primitives above.

### Assets
- `assets/logo.png` — the blue S brandmark. `assets/fonts/` — bundled Inter woff2.

---

## Intentional additions
None. Every component maps to a class/pattern in the extension's own `styles.css`;
no primitives were invented beyond what the source defines.
