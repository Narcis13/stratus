---
name: skill-explainer
description: Render any Claude Code skill as a richly-designed, dark-themed single-file HTML explainer with custom SVG illustrations, a signature Canvas animation, and a consistent aerospace-mission-control aesthetic. Use whenever the user asks to "make an explainer for [skill]", "document a skill visually", "render this skill as HTML", "visualize this skill", "create an EXPLAINER.html", "showcase a skill", or to illustrate/explain the surface area of an existing skill at a given path.
---

# Skill explainer

Generate a single-file HTML explainer for a Claude Code skill — designed for a discerning, design-literate reader. The output is rich (custom SVGs and one signature Canvas animation), cohesive (one fixed design system, every time), and self-contained (no build step, fonts from Google).

## When to invoke this

Trigger when the user references an existing skill (by path or by name) and asks for any of:
- An explainer / documentation page / visual reference
- An `EXPLAINER.html`, `README.html`, or "render this skill"
- A visualization, illustration, or showcase
- Something to share with a designer or non-developer reader

Do **not** invoke for: editing an existing explainer (use `Edit` directly), documenting non-skill code, or generating ordinary `README.md` files.

## Output convention

Default output path: `<skill-dir>/EXPLAINER.html` — sibling of the source `SKILL.md`. Honor any explicit path the user gives.

## Process

1. **Read the source in full.**
   - Read `<skill-dir>/SKILL.md` end-to-end.
   - Read every file in `<skill-dir>/references/` and `<skill-dir>/scripts/`. They often hold the content that makes the explainer worth reading (endpoint shapes, examples, edge cases, hard-won gotchas).
   - If the source skill names other docs (`PLAN.md`, `CLAUDE.md`, …), skim them for context — but treat `SKILL.md` as canonical.

2. **Choose the section set.**
   - Open `references/content_recipes.md`. The system supports eight numbered sections (00–07); use only those that fit the source.
   - Minimum useful set: HERO + one structural section + one signature visual moment. Don't pad with empty sections.
   - Rename sections only if the source vocabulary truly demands it (e.g., a CLI skill: SURFACE → "COMMANDS"). Default to the canonical names.

3. **Pick the signature Canvas animation.**
   - Open `references/canvas_patterns.md`. Choose one pattern that maps to the skill's domain (timeline / state-machine / network / data-stream).
   - If the skill has no temporal or process element worth animating, **omit Canvas entirely** and lean harder on SVG. A poorly-motivated animation hurts more than no animation.

4. **Author the HTML.**
   - Start from `assets/skeleton.html`. It carries the complete design-system CSS, the top bar, the side rail, the footer, the reveal-on-scroll wiring, the live UTC clock, and the rail-active-state observer — all pre-wired.
   - Follow `references/design.md` exactly. Palette, type stack, and component shapes are not negotiable.
   - Lift SVG patterns from `references/svg_library.md` and adapt them. Do not import external icon sets.
   - Every section gets the right eyebrow, corner brackets on panels, and at least one moment of visual care.

5. **Write the file** to the output path using `Write`.

6. **Report back** in one or two sentences: file path, opening instruction, and what's notable — which Canvas pattern you chose (or that you omitted it), which sections you used, any design judgments worth surfacing.

## Hard rules

- **No emojis. Anywhere. Ever.** Not in markup, not in copy, not in code comments.
- **No stock icon libraries.** All graphics are custom SVG or Canvas.
- **One file.** Only Google Fonts as an external dependency. No CDN JS, no images, no fetched assets.
- **Faithful to the source.** Do not invent endpoints, costs, rules, or workflows. If the source is ambiguous, leave a small italic note that says "source unclear" rather than paper over with plausible-looking detail.
- **Never echo secret values.** Token-shaped strings (anything matching `Bearer`, `sk-`, `ghp_`, `api_`, recognizable UUIDs) become placeholders: `$SKILL_TOKEN`, `<bearer>`, `<id>`.
- **Honor `prefers-reduced-motion`.** The skeleton handles this. Do not undo it.
- **One design system.** No alternative palettes. If the user requests a light theme or different colors, refuse and explain that this skill produces the canonical dark mission-control aesthetic; offer to hand-roll a one-off outside the skill if they want something else.

## References (load on demand)

- `references/design.md` — palette, type, components, atmosphere, motion. The immutable system.
- `references/content_recipes.md` — the 8-section system and how to map a source skill to it.
- `references/canvas_patterns.md` — four Canvas animation recipes with skeleton code.
- `references/svg_library.md` — the SVG illustration vocabulary.
- `assets/skeleton.html` — copy-paste starter; the executable embodiment of the design system.
