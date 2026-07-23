// GR.7 — the accountability core. Pure fixtures, no DB, no clock: every case
// passes its own `now`.

import { describe, expect, test } from 'bun:test';
import {
  AHEAD_RATIO,
  DEBT_LONG_DAYS,
  SCORECARD_COMPONENTS,
  SCORECARD_MIN_DAYS,
  SCORECARD_WEIGHTS,
  type ScorecardInputs,
  type StreakDayRow,
  commitmentDebt,
  computeScorecard,
  goalPacing,
  nextGoalStatus,
  shiftDayKey,
} from './goals.ts';

const NOW = new Date('2026-07-24T12:00:00Z');
const DAY = 86_400_000;

function inDays(n: number): Date {
  return new Date(NOW.getTime() + n * DAY);
}

describe('goalPacing', () => {
  test('required rate spreads the remainder over the days left', () => {
    const p = goalPacing({ target: 1000, deadline: inDays(10) }, 900, 12, NOW);
    expect(p.daysLeft).toBe(10);
    expect(p.requiredPerDay).toBe(10);
    expect(p.actualPerDay).toBe(12);
    expect(p.pctComplete).toBe(90);
    expect(p.verdict).toBe('ahead'); // 12 / 10 = 1.2 ≥ AHEAD_RATIO
    expect(AHEAD_RATIO).toBe(1.1);
  });

  test('on_pace and behind sit either side of the 0.8 ratio', () => {
    const goal = { target: 1000, deadline: inDays(10) };
    expect(goalPacing(goal, 900, 8, NOW).verdict).toBe('on_pace'); // exactly 0.8
    expect(goalPacing(goal, 900, 7.9, NOW).verdict).toBe('behind');
    expect(goalPacing(goal, 900, 10, NOW).verdict).toBe('on_pace'); // 1.0 < 1.1
  });

  test('past the target is achieved regardless of the deadline', () => {
    const p = goalPacing({ target: 500, deadline: inDays(-5) }, 500, 0, NOW);
    expect(p.verdict).toBe('achieved');
    expect(p.requiredPerDay).toBe(0);
    expect(p.pctComplete).toBe(100);
    expect(p.projectedAt).toBeNull();
  });

  test('past the deadline without the target is overdue, with no required rate', () => {
    const p = goalPacing({ target: 500, deadline: inDays(-1) }, 400, 2, NOW);
    expect(p.verdict).toBe('overdue');
    expect(p.daysLeft).toBe(-1);
    expect(p.requiredPerDay).toBeNull();
  });

  test('an unknown current value degrades to nulls, never a fake zero', () => {
    const p = goalPacing({ target: 1000, deadline: inDays(10) }, null, 3, NOW);
    expect(p.current).toBeNull();
    expect(p.pctComplete).toBeNull();
    expect(p.requiredPerDay).toBeNull();
    expect(p.verdict).toBe('unknown');
    expect(p.daysLeft).toBe(10); // the calendar is still knowable
  });

  test('no deadline and no measured rate are both unknown, not behind', () => {
    expect(goalPacing({ target: 1000, deadline: null }, 100, 5, NOW).verdict).toBe('unknown');
    expect(goalPacing({ target: 1000, deadline: inDays(10) }, 100, null, NOW).verdict).toBe(
      'unknown',
    );
  });

  test('projectedAt extrapolates the measured rate', () => {
    const p = goalPacing({ target: 100, deadline: inDays(30) }, 50, 5, NOW);
    expect(p.projectedAt?.getTime()).toBe(NOW.getTime() + 10 * DAY);
    // A flat or negative rate never reaches the target, so there is no date.
    expect(goalPacing({ target: 100, deadline: inDays(30) }, 50, 0, NOW).projectedAt).toBeNull();
    expect(goalPacing({ target: 100, deadline: inDays(30) }, 50, -2, NOW).projectedAt).toBeNull();
  });
});

describe('nextGoalStatus', () => {
  const pacing = (current: number | null, deadline: Date | null) =>
    goalPacing({ target: 100, deadline }, current, 1, NOW);

  test('active flips to achieved once the metric passes target', () => {
    const deadline = inDays(5);
    expect(nextGoalStatus({ status: 'active', deadline }, pacing(100, deadline), NOW)).toBe(
      'achieved',
    );
  });

  test('active flips to missed once the deadline is behind us', () => {
    const deadline = inDays(-1);
    expect(nextGoalStatus({ status: 'active', deadline }, pacing(40, deadline), NOW)).toBe(
      'missed',
    );
  });

  test('an unknown current value still misses at the deadline (a date is a fact)', () => {
    const deadline = inDays(-1);
    expect(nextGoalStatus({ status: 'active', deadline }, pacing(null, deadline), NOW)).toBe(
      'missed',
    );
  });

  test('nothing moves while the goal is live, and terminal statuses never move', () => {
    const deadline = inDays(5);
    expect(nextGoalStatus({ status: 'active', deadline }, pacing(40, deadline), NOW)).toBeNull();
    const past = inDays(-5);
    for (const status of ['achieved', 'missed', 'dropped']) {
      expect(nextGoalStatus({ status, deadline: past }, pacing(1, past), NOW)).toBeNull();
    }
  });
});

describe('commitmentDebt', () => {
  const TODAY = '2026-07-24';
  const day = (n: number): string => shiftDayKey(TODAY, -n);

  function diary(spec: Array<[number, boolean]>, key = 'replies'): StreakDayRow[] {
    return spec.map(([back, done]) => ({ day: day(back), completed: { [key]: done } }));
  }

  test('counts missed days inside the 7-day window, ending yesterday', () => {
    // 1–7 days back: hit on 1,2,3; missed on 4; 5–7 have no row at all.
    const d = commitmentDebt(
      diary([
        [1, true],
        [2, true],
        [3, true],
        [4, false],
      ]),
      'replies',
      day(30),
      TODAY,
    );
    expect(d.trackedLast7).toBe(7);
    expect(d.missedLast7).toBe(4); // day 4 + the three absent days
  });

  test('today is never a miss — the day is still in progress', () => {
    const d = commitmentDebt(
      [{ day: TODAY, completed: { replies: false } }],
      'replies',
      TODAY,
      TODAY,
    );
    expect(d.trackedLast7).toBe(0);
    expect(d.missedLast7).toBe(0);
  });

  test('days before activeSince count as nothing at all', () => {
    const d = commitmentDebt([], 'replies', day(2), TODAY);
    expect(d.trackedLast7).toBe(2); // only days 1 and 2
    expect(d.missedLast7).toBe(2);
    expect(d.missedLast30).toBe(2);
  });

  test('the originals commitment reads the singular `original` quest key', () => {
    const rows = diary(
      [
        [1, true],
        [2, true],
      ],
      'original',
    );
    expect(commitmentDebt(rows, 'originals', day(2), TODAY).missedLast7).toBe(0);
    // Reading the plural key would count both days as missed.
    expect(commitmentDebt(rows, 'replies', day(2), TODAY).missedLast7).toBe(2);
  });

  test('tier boundaries: 0 clean, 1–2 tier 1, 3–4 tier 2, 5+ tier 3', () => {
    const tierFor = (missed: number): number => {
      const hits: Array<[number, boolean]> = [];
      for (let i = 1; i <= 7; i++) hits.push([i, i > missed]);
      return commitmentDebt(diary(hits), 'replies', shiftDayKey(TODAY, -30), TODAY).tier;
    };
    expect(tierFor(0)).toBe(0);
    expect(tierFor(1)).toBe(1);
    expect(tierFor(2)).toBe(1);
    expect(tierFor(3)).toBe(2);
    expect(tierFor(4)).toBe(2);
    expect(tierFor(5)).toBe(3);
    expect(tierFor(7)).toBe(3);
  });

  test('the 30-day window is a superset of the 7-day one', () => {
    const d = commitmentDebt([], 'replies', shiftDayKey(TODAY, -365), TODAY);
    expect(d.missedLast7).toBe(7);
    expect(d.missedLast30).toBe(DEBT_LONG_DAYS);
  });
});

describe('computeScorecard', () => {
  const BASE: ScorecardInputs = {
    daysTracked: 7,
    daysAllDone: 7,
    daysWithOriginal: 7,
    daysInWeek: 7,
    repliesPosted: 70,
    repliesTargetWeek: 70,
    replyPct: 70,
    targetReplyPct: 70,
    goalVerdicts: ['ahead'],
  };

  test('the weights sum to 100 and cover every component', () => {
    const total = SCORECARD_COMPONENTS.reduce((s, k) => s + SCORECARD_WEIGHTS[k], 0);
    expect(total).toBe(100);
    expect(Object.keys(SCORECARD_WEIGHTS).sort()).toEqual([...SCORECARD_COMPONENTS].sort());
  });

  test('a perfect week scores 100', () => {
    const s = computeScorecard(BASE);
    expect(s.sufficient).toBe(true);
    expect(s.score).toBe(100);
    expect(s.components.questAdherence).toBe(100);
    expect(s.components.ratioAdherence).toBe(100);
  });

  test('the gate is at 4 tracked days — components still compute, the grade does not', () => {
    const three = computeScorecard({ ...BASE, daysTracked: 3, daysAllDone: 3 });
    expect(SCORECARD_MIN_DAYS).toBe(4);
    expect(three.sufficient).toBe(false);
    expect(three.score).toBeNull();
    expect(three.components.questAdherence).toBe(100);

    const four = computeScorecard({ ...BASE, daysTracked: 4, daysAllDone: 4 });
    expect(four.sufficient).toBe(true);
    expect(four.score).not.toBeNull();
  });

  test('a component with no data drops out and the rest reweight', () => {
    // No goals and nothing posted: goalPacing + ratioAdherence both drop, and
    // the remaining three carry the whole grade instead of being scored zero.
    const s = computeScorecard({ ...BASE, goalVerdicts: [], replyPct: null });
    expect(s.components.goalPacing).toBeNull();
    expect(s.components.ratioAdherence).toBeNull();
    expect(s.score).toBe(100);
  });

  test('unknown goal verdicts are excluded, not graded as failures', () => {
    expect(
      computeScorecard({ ...BASE, goalVerdicts: ['unknown'] }).components.goalPacing,
    ).toBeNull();
    expect(
      computeScorecard({ ...BASE, goalVerdicts: ['unknown', 'behind'] }).components.goalPacing,
    ).toBe(40);
  });

  test('ratio drift costs 2 points per percentage point, floored at 0', () => {
    expect(computeScorecard({ ...BASE, replyPct: 60 }).components.ratioAdherence).toBe(80);
    expect(computeScorecard({ ...BASE, replyPct: 0 }).components.ratioAdherence).toBe(0);
  });

  test('a half-done week lands between', () => {
    const s = computeScorecard({
      ...BASE,
      daysAllDone: 3,
      daysWithOriginal: 3,
      repliesPosted: 35,
      goalVerdicts: ['behind'],
    });
    expect(s.components.questAdherence).toBe(43);
    expect(s.components.replyQuota).toBe(50);
    expect(s.score).toBeGreaterThan(0);
    expect(s.score).toBeLessThan(100);
  });
});
