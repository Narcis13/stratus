// M1 pure profile module: freshness windows, pinned/cap overrides, goal
// progress, and the two renderers. No DB — the loader is covered in ME.2.

import { describe, expect, test } from 'bun:test';
import {
  EMOTION_WINDOW_DAYS,
  EVENT_WINDOW_DAYS,
  MAX_BRIEF_LINES,
  MAX_POST_CHARS,
  MAX_POST_LINES,
  type MeEntry,
  type MeGoal,
  goalProgress,
  isEntryInWindow,
  renderMeBrief,
  renderMeContext,
  resolveGoals,
  selectEntriesForPrompt,
} from './profile.ts';

const NOW = new Date('2026-07-04T12:00:00Z');
const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

function entry(overrides: Partial<MeEntry> = {}): MeEntry {
  return {
    kind: 'note',
    text: 'some text',
    happenedAt: null,
    pinned: false,
    active: true,
    createdAt: daysAgo(0),
    ...overrides,
  };
}

function goal(overrides: Partial<MeGoal> = {}): MeGoal {
  return {
    label: 'test goal',
    kind: 'custom',
    target: 100,
    unit: null,
    currentValue: null,
    deadline: null,
    ...overrides,
  };
}

describe('freshness windows', () => {
  test('emotion 6d in, 8d out (7d boundary inclusive)', () => {
    expect(isEntryInWindow(entry({ kind: 'emotion', happenedAt: daysAgo(6) }), NOW)).toBe(true);
    expect(
      isEntryInWindow(entry({ kind: 'emotion', happenedAt: daysAgo(EMOTION_WINDOW_DAYS) }), NOW),
    ).toBe(true);
    expect(isEntryInWindow(entry({ kind: 'emotion', happenedAt: daysAgo(8) }), NOW)).toBe(false);
  });

  test('event 29d in, 31d out (30d boundary inclusive)', () => {
    expect(isEntryInWindow(entry({ kind: 'event', happenedAt: daysAgo(29) }), NOW)).toBe(true);
    expect(
      isEntryInWindow(entry({ kind: 'event', happenedAt: daysAgo(EVENT_WINDOW_DAYS) }), NOW),
    ).toBe(true);
    expect(isEntryInWindow(entry({ kind: 'event', happenedAt: daysAgo(31) }), NOW)).toBe(false);
  });

  test('happenedAt null falls back to createdAt for the window', () => {
    expect(
      isEntryInWindow(entry({ kind: 'emotion', happenedAt: null, createdAt: daysAgo(3) }), NOW),
    ).toBe(true);
    expect(
      isEntryInWindow(entry({ kind: 'emotion', happenedAt: null, createdAt: daysAgo(10) }), NOW),
    ).toBe(false);
  });

  test('facts and notes are evergreen', () => {
    expect(isEntryInWindow(entry({ kind: 'fact', happenedAt: daysAgo(999) }), NOW)).toBe(true);
    expect(isEntryInWindow(entry({ kind: 'note', happenedAt: daysAgo(999) }), NOW)).toBe(true);
  });
});

describe('selectEntriesForPrompt', () => {
  test('inactive entries excluded', () => {
    const sel = selectEntriesForPrompt(
      [
        entry({ kind: 'fact', text: 'live', active: true }),
        entry({ kind: 'fact', text: 'dead', active: false }),
      ],
      NOW,
    );
    expect(sel.facts.map((e) => e.text)).toEqual(['live']);
  });

  test('pinned overrides window', () => {
    const sel = selectEntriesForPrompt(
      [entry({ kind: 'emotion', text: 'old but pinned', happenedAt: daysAgo(90), pinned: true })],
      NOW,
    );
    expect(sel.emotions.map((e) => e.text)).toEqual(['old but pinned']);
  });

  test('pinned overrides cap — all pinned kept past MAX_FACTS', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      entry({ kind: 'fact', text: `pinned ${i}`, pinned: true }),
    );
    const sel = selectEntriesForPrompt(many, NOW);
    expect(sel.facts.length).toBe(9);
  });

  test('non-pinned facts capped at MAX_FACTS', () => {
    const many = Array.from({ length: 12 }, (_, i) => entry({ kind: 'fact', text: `f${i}` }));
    const sel = selectEntriesForPrompt(many, NOW);
    expect(sel.facts.length).toBe(5);
  });
});

describe('goalProgress', () => {
  test('followers with snapshot', () => {
    const p = goalProgress(goal({ kind: 'followers', target: 5000 }), 1000, NOW);
    expect(p).toEqual({ current: 1000, pct: 20, daysLeft: null });
  });

  test('followers without snapshot → null', () => {
    expect(goalProgress(goal({ kind: 'followers', target: 5000 }), null, NOW)).toBeNull();
  });

  test('mrr uses manual currentValue, followers arg ignored', () => {
    const p = goalProgress(goal({ kind: 'mrr', target: 5000, currentValue: 800 }), 99999, NOW);
    expect(p?.current).toBe(800);
    expect(p?.pct).toBe(16);
  });

  test('mrr with no currentValue → null', () => {
    expect(
      goalProgress(goal({ kind: 'mrr', target: 5000, currentValue: null }), null, NOW),
    ).toBeNull();
  });

  test('pct clamps to 100 when over target', () => {
    expect(
      goalProgress(goal({ kind: 'custom', target: 100, currentValue: 250 }), null, NOW)?.pct,
    ).toBe(100);
  });

  test('daysLeft from deadline; negative = overdue', () => {
    expect(
      goalProgress(
        goal({ currentValue: 10, deadline: new Date(NOW.getTime() + 45 * DAY_MS) }),
        null,
        NOW,
      )?.daysLeft,
    ).toBe(45);
    expect(
      goalProgress(
        goal({ currentValue: 10, deadline: new Date(NOW.getTime() - 3 * DAY_MS) }),
        null,
        NOW,
      )?.daysLeft,
    ).toBe(-3);
  });
});

describe('renderMeContext', () => {
  test('empty everything → empty string', () => {
    expect(renderMeContext(selectEntriesForPrompt([], NOW), [], NOW)).toBe('');
  });

  test('renders goals, events, emotions', () => {
    const entries = [
      entry({ kind: 'event', text: 'shipped the studio', happenedAt: daysAgo(3) }),
      entry({ kind: 'emotion', text: 'frustrated with the ANAF portal', happenedAt: daysAgo(0) }),
    ];
    const goals = resolveGoals(
      [goal({ label: '5K MRR', kind: 'mrr', target: 5000, currentValue: 800 })],
      null,
      NOW,
    );
    const block = renderMeContext(selectEntriesForPrompt(entries, NOW), goals, NOW);
    expect(block).toContain('Goal: 5K MRR — at 800 (16%)');
    expect(block).toContain('3d ago: shipped the studio');
    expect(block).toContain('today: frustrated with the ANAF portal');
    // instruction rides inside the block
    expect(block).toContain('never recite this list, never invent beyond it');
  });

  test('caps: over-cap input never overflows line/char limits', () => {
    const entries = Array.from({ length: 60 }, (_, i) =>
      entry({ kind: 'fact', text: `fact number ${i} with some length to it here`.repeat(3) }),
    );
    const goals = resolveGoals(
      Array.from({ length: 30 }, (_, i) => goal({ label: `goal ${i}`, currentValue: 1 })),
      null,
      NOW,
    );
    const block = renderMeContext(selectEntriesForPrompt(entries, NOW), goals, NOW);
    expect(block.split('\n').length).toBeLessThanOrEqual(MAX_POST_LINES);
    expect(block.length).toBeLessThanOrEqual(MAX_POST_CHARS);
  });
});

describe('renderMeBrief', () => {
  test('empty everything → empty string', () => {
    expect(renderMeBrief(selectEntriesForPrompt([], NOW), [], NOW)).toBe('');
  });

  test('brief is ≤3 lines always', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      entry({ kind: 'event', text: `event ${i}`, happenedAt: daysAgo(i) }),
    );
    const goals = resolveGoals(
      Array.from({ length: 5 }, (_, i) => goal({ label: `g${i}`, currentValue: 1 })),
      null,
      NOW,
    );
    const brief = renderMeBrief(selectEntriesForPrompt(entries, NOW), goals, NOW);
    expect(brief.split('\n').length).toBeLessThanOrEqual(MAX_BRIEF_LINES);
    expect(brief).toContain('reach for this only when it genuinely fits');
  });

  test('brief carries a goal line + a fresh event line', () => {
    const entries = [entry({ kind: 'event', text: 'shipped the studio', happenedAt: daysAgo(2) })];
    const goals = resolveGoals(
      [goal({ label: '5K MRR', kind: 'mrr', target: 5000, currentValue: 800 })],
      null,
      NOW,
    );
    const brief = renderMeBrief(selectEntriesForPrompt(entries, NOW), goals, NOW);
    expect(brief).toContain('Goal: 5K MRR');
    expect(brief).toContain('shipped the studio');
  });
});
