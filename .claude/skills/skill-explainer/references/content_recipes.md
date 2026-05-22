# Content recipes

How to map any source skill to the explainer's eight-section system.

---

## The eight sections

The canonical structure. Each section is optional except 00; pick only the ones the source supports. Don't pad with empty sections.

| #  | ID            | Include when…                                                          |
|----|---------------|------------------------------------------------------------------------|
| 00 | INTRO (hero)  | Always.                                                                |
| 01 | BRIEF         | The skill needs setup, auth, env vars, or has preflight steps.         |
| 02 | SURFACE       | The skill exposes endpoints, CLI commands, or a callable API.          |
| 03 | TELEMETRY     | The skill has temporal/process behavior worth animating.               |
| 04 | HAZARD        | The skill has explicit safety rules, gotchas, or "do not" content.     |
| 05 | OPS           | The skill has named workflows or numbered procedures.                  |
| 06 | LEDGER        | The skill has pricing, costs, quotas, or budget guidance.              |
| 07 | CONDUCT       | The skill has output-style or response-etiquette rules.                |

**Minimum useful explainer:** 00 (hero) + one structural section (SURFACE or OPS) + at least one signature visual (custom hero SVG, or a Canvas in 03, or a strong hazard illustration).

---

## Section recipes

### 00 · INTRO (always)

**Pull from the source:**
- Skill name and description from the SKILL.md frontmatter.
- The opening paragraph(s) — purpose, what it is, who it's for.
- One-sentence taglines.

**Render as:**
- `.eyebrow` with skill identity (`Skill dossier · …`).
- `h1` in italic Fraunces — the skill's name, lowercased, trailing cyan period: `<h1>name<em class="dot">.</em></h1>`.
- `p.lede` — distilled mission statement in italic Fraunces.
- `.meta` strip — 4 short mono labels (audience / scope / cadence / interface — whatever fits).
- `.hero-figure` — custom SVG. Default: concentric-ring schematic. Domain-specific alternatives in `svg_library.md`.
- `.kpis` strip below the hero with 4 KPIs. Drop the strip if the skill doesn't have 4 honest numbers.

### 01 · BRIEF

**Pull from:** connection facts, auth setup, env vars, preflight checks, "before any call" sections.

**Render as:** two-column `.brief-grid`.
- **Left:** definition list (`dl.facts`) — named facts (Base URL, Auth header, Content type, …).
- **Right:** a `.terminal` showing the preflight commands + a 2–4 step `.preflight` checklist underneath.

### 02 · SURFACE

**Pull from:** endpoint maps, CLI command tables, function signatures, public API tables.

**Render as:**
- `h2` + lede.
- Multiple `.endpoint-group` blocks grouped by domain (e.g., `Calendar`, `Metrics`, `Voice`, …). Each group has a small mono `h4` with a trailing hairline.
- Each row: verb pill + path/command + purpose + cost-pip.

**For non-HTTP skills:**
- CLI commands → `<span class="verb run">RUN</span>` (cobalt) with the command in the path slot.
- Function calls → verb is `CALL`, path is the signature.

### 03 · TELEMETRY

**Pull from:** anything temporal or process-like — workers, ticks, schedules, retry loops, state machines, queue behavior.

**Render as:** the full `.telemetry-frame` with a Canvas inside. See `canvas_patterns.md` for the four patterns.

**Skip this section** if the skill has no temporal element worth animating. A poorly-motivated Canvas reads as decorative.

### 04 · HAZARD

**Pull from:** safety rules, "non-negotiable" sections, gotchas, hard-won lessons, "do not" guidance.

**Render as:** `.hazard-grid` of 3–5 cards. First card optionally gets `.featured` (spans two rows/columns) for the most important rule.

Each card: coral micro-label (`HAZARD · 0N · Topic`), italic-fragment `h3`, custom SVG illustration, 1–2 paragraph explanation, dashed REF footer.

See `svg_library.md` for the seven hazard illustration archetypes.

### 05 · OPS

**Pull from:** workflows, procedures, recipes, "how to do X" sections.

**Render as:** stacked `.workflow` blocks separated by dashed hairlines. Each:
- **Head column:** tag micro-label + `h3` with italic fragment + paragraph + bulleted constraints (cobalt dash markers).
- **Right column:** `.terminal` with the actual commands.

If a workflow has no commands, fill the right column with a small structural SVG or a numbered list rendered in `.terminal`-style.

### 06 · LEDGER

**Pull from:** pricing tables, cost cheat sheets, quotas, budget guidance, "cadence-derived" costs.

**Render as:**
- `.price-table` sorted cheapest → most expensive. Bars proportional (let the dramatic spike take 100%, let the cheap entries near-disappear — the asymmetry is the point).
- `.budget-card` sidecar with derived budgets ("X per Y") in italic Fraunces names and cyan figures.

Color price values by tier (see design.md):
- `.cheap` (mint) for sub-cent.
- `.mid` (cyan) for $0.001–0.009.
- `.high` (ember) for $0.01–0.05.
- `.spike` (coral) for outliers; tint the row `rgba(255,122,122,0.04)`.

### 07 · CONDUCT

**Pull from:** output etiquette, tone rules, response-formatting guidance, "how to talk to the user" sections.

**Render as:** `.conduct-grid` of 2–4 small `.conduct-card`s, each one short rule with a cyan letter index (A, B, C, D).

---

## When the source skill doesn't fit the default

### Pure-knowledge skill (no API, no commands)

INTRO + a rebranded SURFACE as "CONCEPTS" / "VOCABULARY" / "TAXONOMY" + a workflows section for typical questions the skill answers. HAZARD if the topic has common misconceptions.

### Tool-wrapper skill (one main command)

INTRO + BRIEF + a single OPS workflow + HAZARD if any. Skip SURFACE — there's nothing to enumerate.

### Style / voice / persona skill

INTRO (with a personality-led hero figure, not the default ring schematic) + CONDUCT as the dominant section with 4+ cards + an OPS section showing examples.

### Orchestrator / multi-agent skill

INTRO with a network-diagram hero figure + SURFACE listing agents + TELEMETRY using the network-pulse Canvas pattern + OPS for typical orchestrations.

### Pipeline / ETL skill

INTRO + SURFACE listing stages + TELEMETRY with the data-stream Canvas pattern + LEDGER if there's cost.

---

## Faithfulness — the line that doesn't move

- **Quote the source verbatim** where exact language matters: rule names, command syntax, exact dollar amounts, error codes, field names.
- **Don't invent.** No endpoints the source doesn't list. No costs the source doesn't quote. No constraints the source doesn't state.
- **Don't smooth ambiguity.** If the source says "around 113 polls," don't claim "exactly 113". If it says "roughly $0.09," don't write `$0.09` as a hard figure.
- **Reference referenced files honestly.** If `references/voice.md` is mentioned but you didn't read it, write "Detailed flows in `references/voice.md`" — do not summarize content you haven't seen.
- **Hard-won lessons stay first-person where the source uses them.** Don't rewrite "we got burned" as "users sometimes encounter".

If the source has a clear gap that the explainer would naturally fill in, render a small italic note in `mist-300`: `<em>source unclear — confirm before relying on this</em>`. Honesty about gaps beats decoration over them.
