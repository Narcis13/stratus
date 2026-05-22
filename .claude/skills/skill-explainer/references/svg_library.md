# SVG library

Reusable illustration patterns for the explainer. None imported as files — copy the patterns and adapt the labels and structure.

---

## Hero schematic — concentric rings (default)

The default hero figure. The skill as a central node surrounded by its temporal/scope strata, with outbound connections to its dependencies.

**Structure:**
- ViewBox `0 0 480 520`.
- 6 dotted concentric `<circle>` rings (radii 80, 110, 140, 170, 200, 225) for time/scope strata.
- Outer ring (`r=225`) with 4 tick marks at cardinal points + tiny mono labels (timing anchors, phase markers, …).
- Radial-gradient `coreGlow` on the center.
- Octagonal "core" — two rotated polygons + a filled cyan inner circle + a single white-on-cyan letter.
- A heartbeat / EKG path below the core, labeled with the skill's cadence.
- 4–6 small outbound node boxes at the edges connected by hairlines — each labels a dependency / collaborator (API, DB, host, extension, …).
- Scattered constellation dots in the background for texture.

**Adapt by changing:** the letter in the core (initial of the skill); the labels on outbound nodes; the count of outer-ring ticks to match the skill's natural rhythm; the EKG label.

Skeleton (gradients omitted for brevity):

```svg
<svg viewBox="0 0 480 520" xmlns="http://www.w3.org/2000/svg">
  <defs><!-- coreGlow radialGradient + ring linearGradient --></defs>

  <!-- 6 dotted strata -->
  <g stroke="#A1B2D0" stroke-opacity="0.15" fill="none" stroke-dasharray="2 4">
    <circle cx="240" cy="260" r="80"/>
    <circle cx="240" cy="260" r="110"/>
    <circle cx="240" cy="260" r="140"/>
    <circle cx="240" cy="260" r="170"/>
    <circle cx="240" cy="260" r="200"/>
    <circle cx="240" cy="260" r="225"/>
  </g>

  <!-- Outer ring + 4 cardinal ticks -->
  <circle cx="240" cy="260" r="225" stroke="url(#ring)" stroke-width="1" fill="none"/>
  <g stroke="#6EE0FF" stroke-width="1.4">
    <line x1="240" y1="35"  x2="240" y2="55"/>
    <line x1="465" y1="260" x2="445" y2="260"/>
    <line x1="240" y1="485" x2="240" y2="465"/>
    <line x1="15"  y1="260" x2="35"  y2="260"/>
  </g>

  <!-- Core glow + octagon + cyan center + letter -->
  <circle cx="240" cy="260" r="140" fill="url(#coreGlow)"/>
  <g transform="translate(240 260)" fill="none" stroke="#6EE0FF">
    <polygon points="-32,-32 32,-32 32,32 -32,32" stroke-opacity="0.5" transform="rotate(45)"/>
    <polygon points="-22,-22 22,-22 22,22 -22,22" stroke-opacity="0.8" transform="rotate(45)"/>
    <circle r="9" fill="#6EE0FF"/>
  </g>
  <text x="240" y="263" text-anchor="middle"
        font-family="JetBrains Mono" font-size="8" fill="#05080F"
        font-weight="700" letter-spacing="1.5">S</text>

  <!-- Heartbeat -->
  <g transform="translate(176 320)">
    <path d="M0 8 L14 8 L18 0 L22 16 L26 8 L34 8 L38 4 L42 12 L46 8 L128 8"
          stroke="#7DD3A0" stroke-width="1.4" fill="none"
          stroke-linecap="round" opacity="0.85"/>
    <text x="64" y="28" text-anchor="middle"
          font-family="JetBrains Mono" font-size="8"
          fill="#7DD3A0" letter-spacing="2">CADENCE LABEL</text>
  </g>

  <!-- Outbound nodes (4–6 around the edges) — repeat the pattern per dep -->
  <g font-family="JetBrains Mono" font-size="9" letter-spacing="2" fill="#A1B2D0">
    <line x1="305" y1="180" x2="395" y2="100" stroke="#4A8FE7" stroke-opacity="0.5"/>
    <rect x="375" y="78" width="86" height="28" fill="#0F1830" stroke="#4A8FE7" stroke-opacity="0.55"/>
    <text x="418" y="96" text-anchor="middle" fill="#DCE5F2">DEPENDENCY</text>
    <!-- … other 3–5 nodes at edges … -->
  </g>

  <!-- Constellation dots for texture -->
  <g fill="#6EE0FF">
    <circle cx="280" cy="55" r="2"/>
    <!-- ~12 dots, varying opacity 0.7–1, varying r 1.6–2.2 -->
  </g>
</svg>
```

---

## Domain-specific hero alternatives

When the concentric-ring schematic doesn't fit the skill's domain:

- **Network graph hero** — for orchestrators / agent systems. A small force-directed layout with the skill name in the core node.
- **Pipeline hero** — for ETL / data skills. Left-to-right stages with arrows.
- **Glyph hero** — for style/voice skills. A large italic Fraunces glyph (the skill's first letter, 240px+) with halo strokes.
- **Tree hero** — for hierarchical skills (file processors, AST workers).

In every case, anchor with a `.stamp` mono label in the corner: `FIG · <b>SCHEMATIC</b> · 00.A`.

---

## Hazard illustrations — the vocabulary

For each hazard rule, pick one of these archetypes. Don't invent new ones — these are the agreed vocabulary.

### 1. Before / after with multiplier

Two stacked or side-by-side cards (mint border for safe, coral border for dangerous), arrow between, circular `×N` multiplier badge below. Used for surcharges, gotchas with magnitude.

### 2. Allowed / blocked diptych

Two equal panels side-by-side. Left: mint border + loop arrow + italic Fraunces "allowed". Right: coral border + a large X. Mono caption beneath. Used for policy rules, allowed-paths.

### 3. Quartered globe / timezones

A circle with crossing diagonals, timezone labels at the cardinals, cyan center dot. Caption: canonical timestamp format. Used for time / locale hazards.

### 4. Comparison bars

Three horizontal bars of increasing length (mint → ember → coral), labeled with the comparison axis and dollar/risk values. Used for relative-cost hazards.

### 5. Locked artifact

A small card with content lines + an ember/coral lock badge overlaid in the corner. Coral caption (`STATUS → 409`, `RESOURCE LOCKED`, …). Used for immutability / lock hazards.

### 6. Severed link

A small two-node graph with a coral X on the connecting line. Mono caption naming the broken contract. Used for policy/version breaks.

### 7. Flow with side-channel leak

Three nodes in a row connected by arrows, plus a fourth node hanging below labeled `DROPPED` / `LOST` in coral. Used for silent-failure hazards.

---

## Cadence calendar

For the OPS section, to visualize scheduling/cadence patterns.

**Structure:**
- ViewBox `0 0 460 140`.
- N day labels (or period labels) across the top.
- M anchor rows with dashed horizontal guides.
- Small rounded cyan rectangles at each (day, anchor) intersection — jitter the positions slightly to convey the "minute jitter" feel.
- Legend underneath: `<i style="background:#6EE0FF"></i>scheduled · N posts · M/day`.

Concrete example in the stratus EXPLAINER's OP·A workflow.

---

## Cost spectrum bars

These live inside `.price-table` as CSS `.bar > i` divs, not SVG. Strictly proportional. Let the dramatic spike fill 100%; let lesser bars near-disappear. The visual asymmetry communicates the magnitude relationship.

---

## Atomic primitives

Reusable SVG fragments. Lift these directly.

```svg
<!-- Tick mark -->
<line x1="240" y1="35" x2="240" y2="55" stroke="#6EE0FF" stroke-width="1.4"/>

<!-- Hairline arrow -->
<g>
  <line x1="0" y1="5" x2="20" y2="5" stroke="#6E81A4" stroke-width="1"/>
  <polygon points="20,0 26,5 20,10" fill="#6E81A4"/>
</g>

<!-- Mono caption -->
<text font-family="JetBrains Mono" font-size="8" fill="#6E81A4" letter-spacing="2">CAPTION</text>

<!-- Coral X -->
<g>
  <line x1="-10" y1="-7" x2="10" y2="7"  stroke="#FF7A7A" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="10"  y1="-7" x2="-10" y2="7" stroke="#FF7A7A" stroke-width="1.5" stroke-linecap="round"/>
</g>

<!-- Loop arrow (curved + arrowhead) -->
<path d="M28 36 Q46 28 64 36 Q70 40 64 44 L60 41 M64 44 L67 39"
      stroke="#7DD3A0" fill="none" stroke-width="1.2" stroke-linecap="round"/>

<!-- Lock badge -->
<g transform="translate(170 60)">
  <rect x="-12" y="0" width="24" height="20" rx="3" fill="#FFB55A" opacity="0.92"/>
  <path d="M-7 0 v-6 a7 7 0 0 1 14 0 v6" fill="none" stroke="#FFB55A" stroke-width="2"/>
  <circle r="1.5" cy="10" fill="#0A1020"/>
</g>

<!-- Multiplier badge -->
<g>
  <circle r="22" fill="#0A1020" stroke="#FF7A7A" stroke-width="1.4"/>
  <text x="0" y="5" text-anchor="middle"
        font-family="Fraunces" font-size="22" font-style="italic"
        fill="#FF7A7A">×13</text>
</g>
```

---

## Composition rules

- **Strokes default to 1px** (cobalt or hairline). Heavier lines look toy-like.
- **Fills are flat.** No gradients unless representing a quantitative spectrum (the hero coreGlow is the only allowed exception).
- **Text inside SVG:** JetBrains Mono at 7–10px for captions; Fraunces italic at 11–22px for editorial moments.
- **Always include a mono caption beneath the figure** — it grounds it as a "figure", not decoration.
- **One moment of color.** Most of the artwork in mist/cobalt, with one mint/ember/coral element bearing the meaning. Two colors of accent in one figure = unreadable.
- **Hairlines, not chunky lines.** The aesthetic is precision instrument, not infographic.

---

## Don't

- No gradient meshes, drop shadows, or SVG filters (Canvas may use `shadowBlur` for live moments; SVG should not).
- No icon-set imports (Heroicons, Lucide, Phosphor — none).
- No emoji glyphs as illustration substitutes.
- No more than two text colors in one figure.
- No 3D / isometric illustration. Flat 2D, instrument-panel discipline.
- No human figures, no faces, no anthropomorphic mascots.
