---
name: masterplan
description: >
  Execute the stratus masterplan (plans/MASTERPLAN.md) one task per invocation.
  Use when the user says "/masterplan", "/masterplan <task-id>" (e.g. "/masterplan RU.3"),
  "/masterplan status", "next masterplan task", or "continue the masterplan".
  Reads STATE.md + the codemap instead of re-scanning the repo, implements exactly
  one task from its source plan, then updates state + codemap in the same commit.
---

# masterplan — one task per session, state-driven, codemap-first

You are executing ONE task from the unified masterplan. The consumer of your state
updates is a *future session with zero memory of this one* — everything the next task
needs to know that isn't in the code must land in STATE.md before you finish.

Files you own:
- **Plan (static):** `plans/MASTERPLAN.md` — order, reasoning levels, waves, adaptations D1–D10. Never edit except to fix a discovered planning error (record why in STATE.md).
- **State (dynamic):** `.claude/skills/masterplan/STATE.md` — status ledger, deviations register, gotchas log, hot-file locks. Kept small on purpose (see Step 6's archive rule).
- **Archive (frozen):** `.claude/skills/masterplan/STATE-ARCHIVE.md` — closed-wave deviations + gotchas, verbatim. Never read whole (it is bigger than one `Read`); grep it by task id or filename when a task touches something a closed lane built.
- **Codemap:** `.claude/skills/plan-feature/references/codemap.md` — the repo index every task reads INSTEAD of scanning the repo. You update it after every task.

## Modes

- `/masterplan` or `/masterplan next` — pick the next eligible task and implement it.
- `/masterplan <ID>` (e.g. `RU.3`) — implement that task (verify its deps are done first; if not, say so and stop).
- `/masterplan status` — report progress (done/remaining per wave, active locks, open deviations). No implementation.
- `/masterplan sync` — reconcile STATE.md against `git log` (a task committed but not ticked, or vice versa). No implementation.

## Step 0 — Load state (cheap, always)

1. Read `.claude/skills/masterplan/STATE.md` fully (it is kept small on purpose — one `Read`). Closed-wave history is NOT in it; reach for `STATE-ARCHIVE.md` with a targeted grep only when the task touches a file a closed lane built.
2. Read the codemap **header + §-sections listed by the target task's source plan** ("Codemap sections relevant" in the plan header, plus the task block's "Read first"). Do NOT read the whole codemap unless orientation genuinely requires it, and do NOT re-scan the repo — no tree walks, no broad greps for orientation. Targeted reads of the files the task block names are the norm.
3. Staleness guard: run `git log -1 --format='%h %s'` and compare the **subject line** against STATE.md's `last-commit` — shas are no longer recorded (D97: an amended commit orphans its sha and three sessions burned Step 0 reconciling one; the subject survives amends). If the subject doesn't name the last ticked task, someone worked outside the skill — run the `sync` reconciliation before proceeding.

## Step 1 — Select the task

- Explicit ID → use it. Otherwise: the first ledger entry with status `[ ]` whose
  dependencies (MASTERPLAN "Depends" column) are all `[x]`, preferring the current
  wave and an unlocked lane.
- Check the **hot-file locks** table: if the task touches a locked file, pick the next
  eligible task in another lane, or tell the user the lane is blocked.
- Check the **deviations register**: any D-entry naming this task is a binding
  constraint (e.g. D1 for AI.2, D4 for GR.7, D5 for A3.9/A3.12, D2 for UI.2).

## Step 2 — Load the task spec (only what's needed)

1. Grep the source plan file for `## Task <n>` to find the block's line range; Read
   that block plus the plan's header sections (Design / Decisions / Invariants). The
   task block is the spec: Read-first list, Edit list, How, Tests, Done-when, commit message.
2. Read the "Read first" files/ranges the block names — as they exist NOW, not as the
   plan quotes them. Earlier masterplan tasks may have changed them; the STATE.md
   gotchas log records the known differences.

## Step 3 — Reasoning gate

The MASTERPLAN table rates each task `high`, `xhigh`, or `max`. Honor it:

- **high** — implement directly from the task block + exemplars.
- **xhigh** — before editing, write a short delta-check: list what the plan assumes vs
  what the current code shows (the plans predate all implementation), and resolve every
  mismatch explicitly. Think through the named invariants before the first edit.
- **max** — full re-derivation: treat the task block as intent, not instruction. Re-plan
  the edits against current code, enumerate the invariants touched (codemap §7–8) with
  how each is preserved, and only then implement. If the user did not invoke this
  session with extended thinking, recommend re-running as `ultrathink /masterplan <ID>`
  before proceeding — these five tasks (N.3, N.4, AI.3, AI.5, A3.5) corrupt shared
  substrate if rushed.

## Step 4 — Implement

- One task = one session. Never start a second task, even if small.
- Follow the task block's Edit/How/Tests. Where the block conflicts with current code
  or a D-entry, the current code + D-entry win — and the divergence gets a deviations
  entry in Step 6.
- Migration tasks: ignore hardcoded migration numbers in plan text; `bun run db:generate`
  against the current journal and inspect the SQL (seed-INSERT drop trap, codemap §4).
- Standing bar before commit: `bun test` + `bun run typecheck` + `bun run lint` green;
  extension-touching tasks also `cd extension && bun run build`. Run the task's smoke
  script when the block says so. Report failures faithfully — never tick a task whose
  gates are red.

## Step 5 — Update the codemap (every task, not just docs-sync tasks)

Update every codemap section the change invalidated (new files → §3.x/§5 rows; new
tables → §4; new routes → §3.4; new patterns/traps → §7; new smoke → §9), append a
line to §11's update log, and re-stamp the header with today's date + the new commit
sha (stamp after committing, or amend — keep them consistent). Keep entries as terse
as the existing rows. A bloated codemap defeats its purpose; a stale one poisons the
next session.

## Step 6 — Update STATE.md

- Ledger: flip the task to `[x]` with the commit sha (short) and date.
- **Deviations register:** append `D<next>` for any divergence from the plan text —
  what changed and why, and which future tasks it affects.
- **Gotchas log:** append anything the next implementer must know that isn't obvious
  from the code (a renamed constant a later task's plan still references, a test suite
  that now seeds differently, a DOM selector verified live, an opening-guess constant
  worth revisiting).
- Hot-file locks: release the files this task held; leave a lock only if the very next
  task in the same lane continues immediately.
- Update `last-commit` (subject line, no sha — D97) and `next-up` hints.
- **Archive rule (a sub-plan's docs-sync task owns this):** when a lane closes, move its
  D-entries and gotchas verbatim into `STATE-ARCHIVE.md` and leave only what still binds
  an open task. STATE.md must stay loadable in one `Read`; when it stops being, the next
  task pays for it before doing anything else.

## Step 7 — Commit

One commit containing the implementation + codemap + STATE.md, using the task block's
commit message (append the masterplan ID), e.g.:
`feat(replies): batch drafting returns three angle variants per tweet (RU.3)`.
Then report: what shipped, gates status, deviations recorded, and what `next` would pick.

## Hard rules

- Never implement more than one task per invocation.
- Never mark a task done with red gates or unrun mandatory tests.
- Never edit `plans/2026-*.md` source plans — divergences live in STATE.md.
- Never skip the codemap update "to save time" — it IS the time-saving mechanism.
- Respect the repo's non-negotiables (CLAUDE.md invariants, codemap §7–8) over any
  plan text that contradicts them.
