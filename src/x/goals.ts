// Guardrails §C — the accountability core: goal pacing, commitment debt, the
// weekly scorecard. Pure (no DB, no clock reads — callers pass `now`), the same
// discipline as quests.ts / connections.ts / monitor.ts; every loader lives in
// routes/goals.ts.
//
// D4 — ONE goals system. The rows are `me_goals` (ME.1); this module is the
// pacing layer over them, which is why `PacingGoal` is a structural subset of a
// me_goals row rather than a new shape. ME.1's `goalProgress` still owns the
// "how far along am I" question for the injected me-block; this owns "am I on
// track to make the date", which is a different question and a different reader.

const DAY_MS = 86_400_000;

// ------------------------------------------------------------------- pacing

export const GOAL_VERDICTS = [
  'achieved',
  'ahead',
  'on_pace',
  'behind',
  'overdue',
  'unknown',
] as const;
export type GoalVerdict = (typeof GOAL_VERDICTS)[number];

// Opening guesses (the C1-threshold spirit — revisit once real goals have run
// their course): a 10% cushion over the required rate reads as ahead, and
// anything above 80% of it still counts as on pace. A goal is a direction, not
// a contract, and stratus never blocks an action for being behind (decision 3).
export const AHEAD_RATIO = 1.1;
export const ON_PACE_RATIO = 0.8;

export interface PacingGoal {
  target: number;
  deadline: Date | null;
  status?: string;
}

export interface GoalPacing {
  /** null = unknown, never a fake 0 (§7.11). */
  current: number | null;
  /** 0–100, clamped. null when the current value is unknown. */
  pctComplete: number | null;
  /** Whole days to the deadline (ceil); ≤0 = past it; null = no deadline. */
  daysLeft: number | null;
  /** What the remaining days each have to carry. null past the deadline (there
   *  are no days left to spread the remainder over) or with no deadline. */
  requiredPerDay: number | null;
  /** The measured rate the caller supplied (trailing 7d, or since-baseline for
   *  the manual kinds). null when nothing has been measured yet. */
  actualPerDay: number | null;
  verdict: GoalVerdict;
  /** Where the current rate lands the target. null when it never would. */
  projectedAt: Date | null;
}

/** Required-vs-actual for one goal. `current` and `actualPerDay` are supplied
 *  by the caller because how a metric is counted is a data question (which
 *  table, which window) and this module is pure. */
export function goalPacing(
  goal: PacingGoal,
  current: number | null,
  actualPerDay: number | null,
  now: Date,
): GoalPacing {
  const daysLeft = goal.deadline
    ? Math.ceil((goal.deadline.getTime() - now.getTime()) / DAY_MS)
    : null;

  if (current === null) {
    return {
      current: null,
      pctComplete: null,
      daysLeft,
      requiredPerDay: null,
      actualPerDay,
      verdict: 'unknown',
      projectedAt: null,
    };
  }

  const pctComplete =
    goal.target > 0 ? Math.min(100, Math.max(0, Math.round((current / goal.target) * 100))) : 0;
  const achieved = current >= goal.target;
  const remaining = Math.max(0, goal.target - current);
  const requiredPerDay = achieved
    ? 0
    : daysLeft !== null && daysLeft > 0
      ? remaining / daysLeft
      : null;
  const projectedAt =
    !achieved && actualPerDay !== null && actualPerDay > 0
      ? new Date(now.getTime() + (remaining / actualPerDay) * DAY_MS)
      : null;

  // A goal with no deadline has no pace to hold and a goal with no measured
  // rate has nothing to compare — both are 'unknown' rather than a guess.
  const verdict: GoalVerdict = achieved
    ? 'achieved'
    : daysLeft !== null && daysLeft <= 0
      ? 'overdue'
      : requiredPerDay === null || actualPerDay === null
        ? 'unknown'
        : actualPerDay >= requiredPerDay * AHEAD_RATIO
          ? 'ahead'
          : actualPerDay >= requiredPerDay * ON_PACE_RATIO
            ? 'on_pace'
            : 'behind';

  return { current, pctComplete, daysLeft, requiredPerDay, actualPerDay, verdict, projectedAt };
}

/** The lazy read-time flip (radar-expiry pattern; ratchet §7.10): an active goal
 *  becomes `achieved` the moment its metric passes target and `missed` once its
 *  deadline is behind us. Terminal statuses never move — only a human PATCH
 *  brings a goal back. A goal whose current value is unknown still flips to
 *  `missed` at the deadline: the date passing is a fact about the calendar, not
 *  a claim about the data, and it is one PATCH to undo. */
export function nextGoalStatus(
  goal: { status?: string; deadline: Date | null },
  pacing: GoalPacing,
  now: Date,
): 'achieved' | 'missed' | null {
  if ((goal.status ?? 'active') !== 'active') return null;
  if (pacing.verdict === 'achieved') return 'achieved';
  if (goal.deadline && goal.deadline.getTime() <= now.getTime()) return 'missed';
  return null;
}

// -------------------------------------------------------------- commitments

export const COMMITMENT_KEYS = ['replies', 'originals'] as const;
export type CommitmentKey = (typeof COMMITMENT_KEYS)[number];

export function isCommitmentKey(v: string): v is CommitmentKey {
  return (COMMITMENT_KEYS as readonly string[]).includes(v);
}

export const MIN_DAILY_TARGET = 1;
export const MAX_DAILY_TARGET = 100;

/** The C9 streak diary records the originals quest under the SINGULAR key
 *  `original` (quests.ts QUEST_KEYS) while a commitment is named for the plural
 *  daily target. One mapping, written down once — a silent mismatch here would
 *  read as "missed every day" forever. */
export const COMMITMENT_QUEST_KEY: Record<CommitmentKey, string> = {
  replies: 'replies',
  originals: 'original',
};

export const DEBT_SHORT_DAYS = 7;
export const DEBT_LONG_DAYS = 30;
/** `missedLast7` at or above these lands tier 1 / 2 / 3. Opening guesses; the
 *  tiers only drive copy, never a block. */
export const DEBT_TIER_CUTOFFS = [1, 3, 5] as const;

export interface StreakDayRow {
  day: string;
  completed: Record<string, boolean>;
}

export interface CommitmentDebt {
  missedLast7: number;
  missedLast30: number;
  /** Days inside the 7-day window the commitment was actually active — the
   *  honest denominator for "N of the last M days". */
  trackedLast7: number;
  tier: 0 | 1 | 2 | 3;
}

/** YYYY-MM-DD ± n days. Day keys are local-day strings (quests.ts
 *  `localDayKey`), so the arithmetic is done at UTC midnight of the key. */
export function shiftDayKey(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Missed days for one commitment. The window ENDS YESTERDAY — today is still
 *  in progress and can never be a miss — and a day before `activeSinceDayKey`
 *  counts as nothing at all. A day with no streaks row IS a miss: the diary is
 *  written by the brief on read, so no row means neither the panel nor the work
 *  happened. */
export function commitmentDebt(
  rows: StreakDayRow[],
  key: CommitmentKey,
  activeSinceDayKey: string,
  todayKey: string,
): CommitmentDebt {
  const questKey = COMMITMENT_QUEST_KEY[key];
  const byDay = new Map(rows.map((r) => [r.day, r.completed]));

  const scan = (days: number): { missed: number; tracked: number } => {
    let missed = 0;
    let tracked = 0;
    for (let i = 1; i <= days; i++) {
      const day = shiftDayKey(todayKey, -i);
      if (day < activeSinceDayKey) continue;
      tracked++;
      if (byDay.get(day)?.[questKey] !== true) missed++;
    }
    return { missed, tracked };
  };

  const short = scan(DEBT_SHORT_DAYS);
  const long = scan(DEBT_LONG_DAYS);
  const tier = DEBT_TIER_CUTOFFS.filter((c) => short.missed >= c).length as 0 | 1 | 2 | 3;
  return {
    missedLast7: short.missed,
    missedLast30: long.missed,
    trackedLast7: short.tracked,
    tier,
  };
}

// ---------------------------------------------------------------- scorecard

export const SCORECARD_COMPONENTS = [
  'questAdherence',
  'cadenceConsistency',
  'replyQuota',
  'goalPacing',
  'ratioAdherence',
] as const;
export type ScorecardComponent = (typeof SCORECARD_COMPONENTS)[number];

export const SCORECARD_WEIGHTS: Record<ScorecardComponent, number> = {
  questAdherence: 30,
  cadenceConsistency: 20,
  replyQuota: 25,
  goalPacing: 15,
  ratioAdherence: 10,
};

/** Never grade a week off two days of data (§7.19 spirit — a gate, not a stat). */
export const SCORECARD_MIN_DAYS = 4;

/** Each percentage point of drift from the doctrine reply share costs 2 points. */
export const RATIO_PENALTY_PER_PCT = 2;

/** What each verdict is worth to the goal component. `unknown` scores nothing
 *  and drops out — a goal we can't measure must not be graded as a failure. */
export const VERDICT_SCORE: Record<GoalVerdict, number | null> = {
  achieved: 100,
  ahead: 100,
  on_pace: 80,
  behind: 40,
  overdue: 0,
  unknown: null,
};

export interface ScorecardInputs {
  /** Streak rows inside the week — days the panel was actually opened. */
  daysTracked: number;
  daysAllDone: number;
  /** Days of the week with at least one original published. */
  daysWithOriginal: number;
  /** Days the week covers (7, or fewer for the current partial week). */
  daysInWeek: number;
  repliesPosted: number;
  /** Daily target × daysInWeek. 0 disables the component. */
  repliesTargetWeek: number;
  /** Actual share of the week's tweets that were replies (0–100); null when
   *  nothing was posted. */
  replyPct: number | null;
  /** Doctrine's target share (default 70). */
  targetReplyPct: number;
  /** Verdicts of the active goals; empty drops the component. */
  goalVerdicts: GoalVerdict[];
}

export interface Scorecard {
  /** 0–100. null under the tracked-days gate — never a confident grade over
   *  two days of data. */
  score: number | null;
  components: Record<ScorecardComponent, number | null>;
  sufficient: boolean;
  daysTracked: number;
}

function pct(n: number, d: number): number {
  return Math.min(100, Math.max(0, Math.round((n / d) * 100)));
}

/** Weighted blend of five 0–100 components. A component with no data drops out
 *  and the rest reweight — never fault a quiet component (the quests
 *  vacuous-done spirit). */
export function computeScorecard(i: ScorecardInputs): Scorecard {
  const goalScores = i.goalVerdicts
    .map((v) => VERDICT_SCORE[v])
    .filter((s): s is number => s !== null);

  const components: Record<ScorecardComponent, number | null> = {
    questAdherence: i.daysTracked > 0 ? pct(i.daysAllDone, i.daysTracked) : null,
    cadenceConsistency: i.daysInWeek > 0 ? pct(i.daysWithOriginal, i.daysInWeek) : null,
    replyQuota: i.repliesTargetWeek > 0 ? pct(i.repliesPosted, i.repliesTargetWeek) : null,
    goalPacing:
      goalScores.length > 0
        ? Math.round(goalScores.reduce((s, v) => s + v, 0) / goalScores.length)
        : null,
    ratioAdherence:
      i.replyPct === null
        ? null
        : Math.max(0, 100 - Math.abs(i.replyPct - i.targetReplyPct) * RATIO_PENALTY_PER_PCT),
  };

  const sufficient = i.daysTracked >= SCORECARD_MIN_DAYS;
  let weighted = 0;
  let weight = 0;
  for (const key of SCORECARD_COMPONENTS) {
    const value = components[key];
    if (value === null) continue;
    weighted += value * SCORECARD_WEIGHTS[key];
    weight += SCORECARD_WEIGHTS[key];
  }

  return {
    score: sufficient && weight > 0 ? Math.round(weighted / weight) : null,
    components,
    sufficient,
    daysTracked: i.daysTracked,
  };
}
