// Me / My Profile (M1): the DYNAMIC personal-context layer. Pure — no DB, no
// clock reads (callers pass `now`); the DB loader lives in routes/me.ts.
//
// The rendered block is injected at the VARIABLE TAIL of the draft prompts
// (same pattern as §8.6 pillars / C3 relationship): post prompt.md /
// reply prompt.md and their TS templates stay byte-identical and their sync
// tests untouched. The drafting instruction lives INSIDE the rendered block,
// never in the static cacheable prefix (§7.18 — the block is the only extra
// biography Grok may use). An empty profile renders '' → no injection → prompts
// byte-identical to before this feature.

export const ME_KINDS = ['fact', 'event', 'emotion', 'note'] as const;
export type MeKind = (typeof ME_KINDS)[number];

export const GOAL_KINDS = ['followers', 'mrr', 'custom', 'posted_replies', 'originals'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

/** Goals whose current value is COUNTED from stratus data since the goal's own
 *  baseline, never typed in (GR.7). They are deliberately kept OUT of the
 *  injected me-block: a reply quota is process, not biography, and the drafting
 *  prompt is the wrong place to put a number I'm chasing. Their surfaces are
 *  `GET /x/goals`, the brief and the weekly digest. */
export const FLOW_GOAL_KINDS = ['posted_replies', 'originals'] as const;

export function isFlowGoalKind(kind: string): boolean {
  return (FLOW_GOAL_KINDS as readonly string[]).includes(kind);
}

/** Counted current value per goal id — flow goals only. This cannot be one
 *  shared number like `latestFollowers` because each flow goal counts from its
 *  own `baselineAt`. Absent id / absent entry = unknown (§7.11). */
export type FlowCurrents = ReadonlyMap<string, number | null>;

// Freshness windows are opening guesses (like the C1 stage thresholds) —
// revisit after ~30 days of real use. Emotions decay fast, events slower;
// facts/notes are evergreen. `pinned` overrides windows AND caps.
export const EMOTION_WINDOW_DAYS = 7;
export const EVENT_WINDOW_DAYS = 30;

// Per-kind selection caps (before the render hard-cap trims further).
export const MAX_FACTS = 5;
export const MAX_EVENTS = 5;
export const MAX_EMOTIONS = 4;
export const MAX_NOTES = 3;

// Render hard-caps — the block never overflows these regardless of input.
export const MAX_POST_LINES = 14;
export const MAX_POST_CHARS = 1200;
export const MAX_BRIEF_LINES = 3;
export const MAX_BRIEF_CHARS = 300;

export const ME_INSTRUCTION =
  'Use this for specificity and emotional grounding — let my real feelings and goals color the draft when they fit; never recite this list, never invent beyond it.';

export const ME_BRIEF_INSTRUCTION =
  "reach for this only when it genuinely fits the reply; most replies won't need it";

const DAY_MS = 86_400_000;

export interface MeEntry {
  id?: string;
  kind: MeKind | string;
  text: string;
  /** null = undated → createdAt drives the freshness window. */
  happenedAt: Date | null;
  pinned: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

export interface MeGoal {
  id?: string;
  label: string;
  kind: GoalKind | string;
  target: number;
  unit: string | null;
  /** Manual value for mrr/custom; followers reads account_snapshots instead. */
  currentValue: number | null;
  deadline: Date | null;
  status?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MeSelection {
  facts: MeEntry[];
  events: MeEntry[];
  emotions: MeEntry[];
  notes: MeEntry[];
}

export interface GoalProgress {
  current: number;
  /** 0–100, clamped. */
  pct: number;
  /** From deadline; negative = overdue; null when no deadline. */
  daysLeft: number | null;
}

/** A goal paired with its computed progress — what the renderers consume. The
 *  route builds these via `resolveGoals` so the followers lookup happens once. */
export interface RenderGoal {
  label: string;
  unit: string | null;
  target: number;
  progress: GoalProgress | null;
}

function entryDate(e: MeEntry): Date {
  return e.happenedAt ?? e.createdAt;
}

function windowForKind(kind: string): number | null {
  if (kind === 'emotion') return EMOTION_WINDOW_DAYS;
  if (kind === 'event') return EVENT_WINDOW_DAYS;
  return null; // fact / note evergreen
}

/** True when an entry is fresh enough to inject. Pinned always passes; evergreen
 *  kinds (fact/note) always pass; otherwise within its kind's window off
 *  `happenedAt ?? createdAt`. Exported so the route's `inWindow` flag never
 *  forks this logic (the UI must read it, not recompute it). */
export function isEntryInWindow(e: MeEntry, now: Date): boolean {
  if (e.pinned) return true;
  const days = windowForKind(e.kind);
  if (days === null) return true;
  const age = now.getTime() - entryDate(e).getTime();
  return age <= days * DAY_MS; // 7d/30d boundaries are inclusive
}

function pickKind(active: MeEntry[], kind: MeKind, now: Date, cap: number): MeEntry[] {
  const inWindow = active
    .filter((e) => e.kind === kind && isEntryInWindow(e, now))
    .sort((a, b) => entryDate(b).getTime() - entryDate(a).getTime());
  // Pinned overrides the cap — keep them all, fill the rest to `cap`.
  const pinned = inWindow.filter((e) => e.pinned);
  const rest = inWindow.filter((e) => !e.pinned);
  return [...pinned, ...rest.slice(0, Math.max(0, cap - pinned.length))];
}

/** Active-only, windowed, per-kind capped selection for prompt injection. */
export function selectEntriesForPrompt(entries: MeEntry[], now: Date): MeSelection {
  const active = entries.filter((e) => e.active);
  return {
    facts: pickKind(active, 'fact', now, MAX_FACTS),
    events: pickKind(active, 'event', now, MAX_EVENTS),
    emotions: pickKind(active, 'emotion', now, MAX_EMOTIONS),
    notes: pickKind(active, 'note', now, MAX_NOTES),
  };
}

/** Progress for one goal. followers reads the latest account_snapshots value
 *  (null until the first daily pass → null progress); the GR.7 flow kinds read
 *  their counted value from `flowCurrents` (keyed by goal id); mrr/custom use
 *  the manual currentValue. Caller filters to active goals (achieved/missed/
 *  dropped excluded). */
export function goalProgress(
  goal: MeGoal,
  latestFollowers: number | null,
  now: Date,
  flowCurrents?: FlowCurrents,
): GoalProgress | null {
  const current =
    goal.kind === 'followers'
      ? latestFollowers
      : isFlowGoalKind(goal.kind)
        ? goal.id === undefined
          ? null
          : (flowCurrents?.get(goal.id) ?? null)
        : goal.currentValue;
  if (current === null || current === undefined) return null;
  const pct =
    goal.target > 0 ? Math.min(100, Math.max(0, Math.round((current / goal.target) * 100))) : 0;
  const daysLeft = goal.deadline
    ? Math.ceil((goal.deadline.getTime() - now.getTime()) / DAY_MS)
    : null;
  return { current, pct, daysLeft };
}

/** Attach progress to each goal (followers via the shared snapshot value). */
export function resolveGoals(
  goals: MeGoal[],
  latestFollowers: number | null,
  now: Date,
  flowCurrents?: FlowCurrents,
): RenderGoal[] {
  return goals.map((g) => ({
    label: g.label,
    unit: g.unit,
    target: g.target,
    progress: goalProgress(g, latestFollowers, now, flowCurrents),
  }));
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(1);
}

function goalLine(g: RenderGoal): string {
  const u = g.unit ? ` ${g.unit}` : '';
  if (!g.progress) return `Goal: ${g.label} — target ${fmtNum(g.target)}${u} (no data yet)`;
  const parts = [`at ${fmtNum(g.progress.current)}${u} (${g.progress.pct}%)`];
  if (g.progress.daysLeft !== null) {
    parts.push(
      g.progress.daysLeft >= 0
        ? `${g.progress.daysLeft}d left`
        : `${-g.progress.daysLeft}d overdue`,
    );
  }
  return `Goal: ${g.label} — ${parts.join(', ')}`;
}

// Belt-and-suspenders clamp — entry text is validated ≤1000 at write time.
function oneLine(text: string, max = 140): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

function dayLabel(at: Date, now: Date): string {
  const days = Math.floor((now.getTime() - at.getTime()) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

// Greedily keep lines while under both the line and char budget — never over.
function capBullets(bullets: string[], maxLines: number, maxChars: number): string[] {
  const out: string[] = [];
  let chars = 0;
  for (const b of bullets) {
    if (out.length >= maxLines) break;
    const add = b.length + 1; // + newline
    if (chars + add > maxChars) break;
    out.push(b);
    chars += add;
  }
  return out;
}

/** Full block for the post drafter. '' when there is nothing to inject
 *  (callers skip injection on ''). Hard-capped to MAX_POST_LINES/CHARS. */
export function renderMeContext(selection: MeSelection, goals: RenderGoal[], now: Date): string {
  const bullets: string[] = [];
  for (const g of goals) bullets.push(`- ${goalLine(g)}`);
  for (const e of selection.events)
    bullets.push(`- ${dayLabel(entryDate(e), now)}: ${oneLine(e.text)}`);
  for (const e of selection.emotions)
    bullets.push(`- ${dayLabel(entryDate(e), now)}: ${oneLine(e.text)}`);
  for (const e of selection.facts) bullets.push(`- ${oneLine(e.text)}`);
  for (const e of selection.notes) bullets.push(`- ${oneLine(e.text)}`);
  if (bullets.length === 0) return '';
  const header = [
    '## Me — my current context (for grounding, not content)',
    '',
    ME_INSTRUCTION,
    '',
  ];
  const headerChars = header.join('\n').length + 1;
  const body = capBullets(bullets, MAX_POST_LINES - header.length, MAX_POST_CHARS - headerChars);
  return [...header, ...body].join('\n');
}

/** Compact reply-side brief, ≤MAX_BRIEF_LINES lines / ~MAX_BRIEF_CHARS chars:
 *  1 goal line + up to 2 fresh event/emotion lines, the instruction folded into
 *  the head. '' when there is nothing to say. */
export function renderMeBrief(selection: MeSelection, goals: RenderGoal[], now: Date): string {
  const topGoal = goals.find((g) => g.progress) ?? goals[0];
  const fresh = [...selection.events, ...selection.emotions]
    .sort((a, b) => entryDate(b).getTime() - entryDate(a).getTime())
    .slice(0, 2);
  if (!topGoal && fresh.length === 0) return '';
  const lines: string[] = [];
  let head = `ME (${ME_BRIEF_INSTRUCTION})`;
  if (topGoal) head += `: ${goalLine(topGoal)}`;
  lines.push(head);
  if (fresh.length > 0) {
    lines.push(
      fresh.map((e) => `${dayLabel(entryDate(e), now)}: ${oneLine(e.text, 90)}`).join('; '),
    );
  }
  const capped = lines.slice(0, MAX_BRIEF_LINES).map((l) => oneLine(l, MAX_BRIEF_CHARS));
  return capped.join('\n');
}
