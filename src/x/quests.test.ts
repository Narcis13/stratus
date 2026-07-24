import { describe, expect, test } from 'bun:test';
import {
  LAUNCH_ATTEND_WINDOW_MS,
  computeQuests,
  computeStreak,
  launchesAttended,
  localDayKey,
  neglectedTargetsAtDayStart,
} from './quests.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

const BASE = {
  repliesPostedToday: 0,
  repliesTarget: 10,
  originalsPostedToday: 0,
  neglectedTargetsAtDayStart: 0,
  neglectedTargetsTouched: 0,
  loopsClosedToday: 0,
  openLoopsNow: 0,
  launchesToday: 0,
  launchesAttended: 0,
};

function byKey(quests: ReturnType<typeof computeQuests>) {
  return new Map(quests.map((q) => [q.key, q]));
}

describe('computeQuests', () => {
  test('replies quest tracks the target', () => {
    const q = byKey(computeQuests({ ...BASE, repliesPostedToday: 9 }));
    expect(q.get('replies')?.done).toBe(false);
    expect(q.get('replies')?.n).toBe(9);
    const done = byKey(computeQuests({ ...BASE, repliesPostedToday: 10 }));
    expect(done.get('replies')?.done).toBe(true);
  });

  test('original quest needs one non-reply post', () => {
    expect(byKey(computeQuests(BASE)).get('original')?.done).toBe(false);
    expect(byKey(computeQuests({ ...BASE, originalsPostedToday: 1 })).get('original')?.done).toBe(
      true,
    );
  });

  // GR.8: an `originals` commitment raises that quest's bar. Additive — an
  // input without the field behaves exactly as it did before the commitment
  // system existed, which is what keeps every streak already on the books.
  test('original quest defaults to one post and labels it in the singular', () => {
    const q = byKey(computeQuests(BASE)).get('original');
    expect(q?.target).toBe(1);
    expect(q?.label).toBe('1 original post');
  });

  test('an originals commitment raises the bar and pluralizes the label', () => {
    const q = byKey(computeQuests({ ...BASE, originalsTarget: 3, originalsPostedToday: 2 }));
    expect(q.get('original')?.target).toBe(3);
    expect(q.get('original')?.label).toBe('3 original posts');
    expect(q.get('original')?.done).toBe(false);
    const met = byKey(computeQuests({ ...BASE, originalsTarget: 3, originalsPostedToday: 3 }));
    expect(met.get('original')?.done).toBe(true);
  });

  test('targets quest scales down to what was actually neglected', () => {
    // 5 neglected → target 2.
    const q1 = byKey(
      computeQuests({ ...BASE, neglectedTargetsAtDayStart: 5, neglectedTargetsTouched: 1 }),
    );
    expect(q1.get('targets')?.target).toBe(2);
    expect(q1.get('targets')?.done).toBe(false);
    // 1 neglected → touching that 1 completes it.
    const q2 = byKey(
      computeQuests({ ...BASE, neglectedTargetsAtDayStart: 1, neglectedTargetsTouched: 1 }),
    );
    expect(q2.get('targets')?.done).toBe(true);
    // Nobody neglected → vacuously done, with a gentle note.
    const q3 = byKey(computeQuests(BASE));
    expect(q3.get('targets')?.done).toBe(true);
    expect(q3.get('targets')?.note).toContain('neglected');
  });

  test('loop quest: closing one OR an already-clear inbox both count', () => {
    const closed = byKey(computeQuests({ ...BASE, loopsClosedToday: 1, openLoopsNow: 4 }));
    expect(closed.get('loop')?.done).toBe(true);
    expect(closed.get('loop')?.note).toBeNull();
    const clear = byKey(computeQuests(BASE));
    expect(clear.get('loop')?.done).toBe(true);
    expect(clear.get('loop')?.note).toContain('clear');
    const owed = byKey(computeQuests({ ...BASE, openLoopsNow: 2 }));
    expect(owed.get('loop')?.done).toBe(false);
  });

  test('launch quest only applies on launch days', () => {
    const none = byKey(computeQuests(BASE));
    expect(none.get('launch')?.done).toBe(true);
    expect(none.get('launch')?.note).toContain('no launch');
    const missed = byKey(computeQuests({ ...BASE, launchesToday: 1 }));
    expect(missed.get('launch')?.done).toBe(false);
    const hit = byKey(computeQuests({ ...BASE, launchesToday: 2, launchesAttended: 1 }));
    expect(hit.get('launch')?.done).toBe(true);
  });

  // UI.2: the configurable quest targets. opts default to the shipped constants, so
  // every test above (which passes no opts) is unchanged.
  test('opts.originalsTarget sets the default when no commitment is present', () => {
    const q = byKey(
      computeQuests(
        { ...BASE, originalsPostedToday: 1 },
        { originalsTarget: 2, neglectedTargetsCount: 2 },
      ),
    );
    expect(q.get('original')?.target).toBe(2);
    expect(q.get('original')?.label).toBe('2 original posts');
    expect(q.get('original')?.done).toBe(false);
    // An explicit input (the GR.8 commitment path) still overrides the opts default.
    const overridden = byKey(
      computeQuests(
        { ...BASE, originalsTarget: 1 },
        { originalsTarget: 5, neglectedTargetsCount: 2 },
      ),
    );
    expect(overridden.get('original')?.target).toBe(1);
  });

  test('originalsTarget 0 makes the quest optional — vacuously done with a note', () => {
    const q = byKey(computeQuests(BASE, { originalsTarget: 0, neglectedTargetsCount: 2 }));
    const original = q.get('original');
    expect(original?.target).toBe(0);
    expect(original?.done).toBe(true);
    expect(original?.note).toContain('no originals target');
    expect(original?.label).toBe('originals optional');
  });

  test('opts.neglectedTargetsCount caps the targets quest', () => {
    // 5 neglected, configured count 3 → target 3.
    const q = byKey(
      computeQuests(
        { ...BASE, neglectedTargetsAtDayStart: 5, neglectedTargetsTouched: 2 },
        { originalsTarget: 1, neglectedTargetsCount: 3 },
      ),
    );
    expect(q.get('targets')?.target).toBe(3);
    // count 0 → vacuously done no matter how many are neglected.
    const off = byKey(
      computeQuests(
        { ...BASE, neglectedTargetsAtDayStart: 5 },
        { originalsTarget: 1, neglectedTargetsCount: 0 },
      ),
    );
    expect(off.get('targets')?.target).toBe(0);
    expect(off.get('targets')?.done).toBe(true);
  });
});

describe('computeStreak', () => {
  test('empty history → zero', () => {
    expect(computeStreak([], '2026-07-05')).toEqual({ current: 0, todayComplete: false });
  });

  test('today complete extends the run', () => {
    const rows = [
      { day: '2026-07-05', allDone: true },
      { day: '2026-07-04', allDone: true },
      { day: '2026-07-03', allDone: true },
    ];
    expect(computeStreak(rows, '2026-07-05')).toEqual({ current: 3, todayComplete: true });
  });

  test('an in-progress today does not break yesterday-anchored streaks', () => {
    const rows = [
      { day: '2026-07-05', allDone: false },
      { day: '2026-07-04', allDone: true },
      { day: '2026-07-03', allDone: true },
    ];
    expect(computeStreak(rows, '2026-07-05')).toEqual({ current: 2, todayComplete: false });
  });

  test('a missing day breaks the run', () => {
    const rows = [
      { day: '2026-07-05', allDone: true },
      // 07-04 never opened the panel
      { day: '2026-07-03', allDone: true },
    ];
    expect(computeStreak(rows, '2026-07-05')).toEqual({ current: 1, todayComplete: true });
  });

  test('month boundary walks correctly', () => {
    const rows = [
      { day: '2026-07-01', allDone: true },
      { day: '2026-06-30', allDone: true },
    ];
    expect(computeStreak(rows, '2026-07-01').current).toBe(2);
  });
});

describe('localDayKey', () => {
  test('offset shifts the day', () => {
    const now = new Date('2026-07-05T22:30:00Z');
    expect(localDayKey(now, 0)).toBe('2026-07-05');
    // UTC+3 (offset -180): local time is 01:30 on the 6th.
    expect(localDayKey(now, -180)).toBe('2026-07-06');
    // UTC-5 (offset 300): still the 5th.
    expect(localDayKey(now, 300)).toBe('2026-07-05');
  });
});

describe('neglectedTargetsAtDayStart', () => {
  const todayStart = new Date('2026-07-05T00:00:00Z');
  test('never-replied and stale targets are neglected; fresh ones are not', () => {
    const prior = new Map<string, Date>([
      ['fresh', new Date(todayStart.getTime() - 2 * DAY_MS)],
      ['stale', new Date(todayStart.getTime() - 9 * DAY_MS)],
    ]);
    const out = neglectedTargetsAtDayStart(['fresh', 'stale', 'never'], prior, todayStart);
    expect(out).toEqual(new Set(['stale', 'never']));
  });

  test('a custom neglected window moves the cutoff (UI.2)', () => {
    const prior = new Map<string, Date>([['h', new Date(todayStart.getTime() - 4 * DAY_MS)]]);
    // Default 7-day window: a reply 4 days ago is still fresh.
    expect(neglectedTargetsAtDayStart(['h'], prior, todayStart)).toEqual(new Set());
    // 3-day window: the same reply is now stale → neglected.
    expect(neglectedTargetsAtDayStart(['h'], prior, todayStart, 3)).toEqual(new Set(['h']));
  });
});

describe('launchesAttended', () => {
  const launch = new Date('2026-07-05T09:00:00Z');
  test('a paste inside the 30-min window counts, outside does not', () => {
    const inside = new Date(launch.getTime() + 10 * 60_000);
    const outside = new Date(launch.getTime() + LAUNCH_ATTEND_WINDOW_MS + 60_000);
    expect(launchesAttended([launch], [inside])).toBe(1);
    expect(launchesAttended([launch], [outside])).toBe(0);
    expect(launchesAttended([launch], [])).toBe(0);
  });

  test('a custom window widens attendance (UI.2)', () => {
    const at40 = new Date(launch.getTime() + 40 * 60_000);
    // Default 30-min window: a paste 40 min late misses.
    expect(launchesAttended([launch], [at40])).toBe(0);
    // A 60-min window now counts it.
    expect(launchesAttended([launch], [at40], 60 * 60_000)).toBe(1);
  });
});
