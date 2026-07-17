---
name: plan-feature
description: >
  Produce a Claude-Code-optimized implementation plan for a stratus feature.
  Use when the user asks to plan, design, spec, or break down a feature/change
  for this repo ("/plan-feature <idea>", "plan X", "how would we build X").
  Reads the pre-computed code map instead of re-scanning the repo, and emits a
  plan file where one task = one coding session. Planning only — never
  implements the feature in the same invocation.
---

# plan-feature — engineered plans for stratus

You are producing a **plan document**, not code. The plan's consumer is a
*future Claude Code session with zero memory of this conversation*: every task
must carry its own context. The plan's quality bar: an implementer who reads
ONLY the task block (plus the files it lists) can finish it in one session and
leave the repo green.

## Step 0 — Load the map (never re-scan the repo)

1. Read `references/codemap.md` (in this skill's folder) **fully**. It is the
   authoritative index of files, routes, tables, extension surfaces, patterns,
   and invariants. Do NOT run repo-wide exploration (no tree walks, no broad
   greps, no Explore agents for orientation) — that is exactly what the map
   exists to avoid.
2. Staleness check (cheap): `git log --oneline <stamp-sha>..HEAD -- src extension`
   using the commit stamped in the map header. If commits since the stamp touch
   the areas your plan will touch, verify just those sections (targeted reads),
   and note "codemap stale in §N" so the docs-sync task refreshes it.

## Step 1 — Interrogate the feature before designing it

Answer these in writing (they open the plan file):

- **Goal fit**: which of the four goals does this serve? If none — stop and
  tell the user it's outside the hard scope ceiling; do not plan it.
- **Cost**: every new X read/write priced (map §8), every Grok/image call
  estimated, recurring vs one-time vs per-click. A feature with recurring X
  spend needs an explicit budget line. Prefer $0 designs (DOM scrape,
  read-time SQL over already-billed data) — that is this repo's strongest
  habit.
- **Policy walls**: Feb 2026 reply/quote restrictions, OAuth 1.0a media wall,
  URL surcharge, 30-day private-metrics window. If the feature collides,
  design around the wall (manual paste, draft-only) like every prior phase did.
- **Invariants touched** (map §7–8): list by number; each one becomes a
  constraint line in the relevant task.
- **Genuine decisions**: if a fork materially changes the plan (schema shape,
  UX placement, spend level), ask the user with AskUserQuestion BEFORE writing
  the plan. Do not ask about things the codebase already answers.

## Step 2 — Targeted reading only

From the map, list the files the feature will touch or imitate, then Read just
those (and only the relevant ranges). Purpose: anchor tasks to **real symbols
and line-level reality** — exact function names, existing helpers to reuse,
the exemplar file for each named pattern. A plan that says "add a route like
`src/x/routes/radar.ts` does, reusing `safeLogPersonEvents`" is good; one that
says "add an endpoint" is not. If reading reveals the map is wrong, fix the
map in the docs-sync task.

## Step 3 — Design order

Design in this order (skip layers the feature doesn't have):

1. **Data**: tables/columns + migration. Nullable-with-null=unknown when
   backfill is impossible. Name the migration step and the seed-INSERT check.
2. **Pure logic**: the testable core as a pure module (this repo always splits
   pure logic from routes — playbook.ts, stage.ts, followups.ts pattern).
3. **Routes/workers**: mount point + order traps (map §7.20–23), gating
   (always-mounted + runtime 503 vs Grok-gated mount), refuse-before-spend.
4. **Extension**: which tab/component, background vs content vs panel, message
   types, storage keys, IIFE constraint.
5. **Measurement**: how will we know it worked? A playbook cell, digest fact,
   or smoke assertion — gated n≥20 if statistical.
6. **Tests + smoke**: pure suite, route suite over in-memory DB, smoke script
   ($0 default, `--live` for one paid check).

## Step 4 — Task decomposition (one task = one coding session)

Rules:

- **Sized for one session**: one concern, roughly ≤6 files touched, ≤~400
  lines of diff. If a task needs more, split it.
- **Lands green**: after each task, `bun test` + `bun run typecheck` +
  `bun run lint` pass and the commit is shippable. No task may leave a
  half-mounted route or a schema the code doesn't read yet — order tasks so
  every intermediate state is coherent (schema+consumers can be one task;
  schema alone is fine only if nothing breaks).
- **Vertical when possible**: prefer "thin end-to-end slice" over "all schema,
  then all routes, then all UI" — matches how every phase C0–C9/S0–S4 shipped.
- **Dependency-ordered and explicit**: each task names which tasks it depends
  on; independent tasks are marked parallelizable.
- **Self-contained context**: each task block must include everything listed
  in the template (files to read first, exact paths to edit, patterns by map
  §-number, done-when checklist, cost note). Assume the implementer has NOT
  read the other tasks.
- **The last task is always docs-sync**: CLAUDE.md phase entry, the relevant
  plan doc (PLAN/CIRCLES/SURFACES), `docs/<tab>.md` if a tab changed, and
  `references/codemap.md` (+ re-stamp). Plus the smoke script if not earlier.

## Step 5 — Write the plan file

Write to `plans/YYYY-MM-DD-<slug>.md` (create `plans/` if missing) following
`references/plan-template.md` exactly. Keep prose tight; the template's
structure does the work.

## Step 6 — Self-verify (goal-backward), then report

Before presenting, check:

- [ ] If every task's done-when passes, does the feature's own "done when"
      hold? (Walk it backwards.)
- [ ] Does any task silently violate an invariant listed in Step 1?
- [ ] Can task N be executed by someone who read only task N + its
      files-to-read list?
- [ ] Is every X/Grok call in the plan priced, and every stat gated?
- [ ] Is there a rollback story (feature flags off / route unmounted / column
      nullable) if a mid-plan task ships and the rest never does?

Then give the user a short summary: the design in 3–6 sentences, the task
list with session count, total cost impact, and open risks. Do NOT start
implementing — planning and implementation are separate sessions by design.
