import { describe, expect, test } from 'bun:test';
import {
  COOLDOWN_EXEMPT_FORMATS,
  COOLDOWN_THRESHOLD,
  COOLDOWN_WINDOW_DAYS,
  type CooldownCell,
  WARMING_THRESHOLD,
  buildCooldowns,
} from './postCooldown.ts';
import { POST_FORMATS, classifyFormat } from './postFormat.ts';

const NOW = new Date('2026-07-27T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** `daysAgo` before NOW. */
function ago(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

// Each of these classifies as the named format — asserted below rather than
// assumed, so a classifier change reddens the premise instead of silently
// re-labelling the arithmetic being tested.
const HOT_TAKES = [
  'Unpopular opinion:\n\nMost roadmaps are procrastination with a Gantt chart.',
  'Hot take: the framework never was the bottleneck.',
  'Unpopular opinion:\n\nShipping ugly beats polishing forever.',
  'Hot take: your landing page is not why nobody signed up.',
  'Unpopular opinion:\n\nMeetings are the most expensive thing you own.',
];
const QUESTIONS = [
  'What broke for you this week that you never expected?',
  'Which part of shipping do you actually dread?',
  'How long did your last rewrite really take?',
  'When did you last delete more code than you wrote?',
];

function cell(cells: CooldownCell[], format: string): CooldownCell | undefined {
  return cells.find((c) => c.format === format);
}

function posts(texts: string[], startDaysAgo = 1): { text: string; postedAt: Date }[] {
  return texts.map((text, i) => ({ text, postedAt: ago(startDaysAgo + i) }));
}

describe('fixture premises', () => {
  test('the hot-take fixtures classify as hot_take', () => {
    for (const t of HOT_TAKES) expect(classifyFormat(t)).toBe('hot_take');
  });
  test('the question fixtures classify as question', () => {
    for (const t of QUESTIONS) expect(classifyFormat(t)).toBe('question');
  });
});

describe('buildCooldowns — thresholds', () => {
  test('an empty corpus yields no cells', () => {
    expect(buildCooldowns([], NOW)).toEqual([]);
  });

  test('1 post is clear, 2 warming, 4 cooldown', () => {
    const one = cell(buildCooldowns(posts(HOT_TAKES.slice(0, 1)), NOW), 'hot_take');
    expect(one).toMatchObject({ count: 1, status: 'clear', exempt: false });

    const two = cell(buildCooldowns(posts(HOT_TAKES.slice(0, 2)), NOW), 'hot_take');
    expect(two).toMatchObject({ count: 2, status: 'warming' });

    const three = cell(buildCooldowns(posts(HOT_TAKES.slice(0, 3)), NOW), 'hot_take');
    expect(three).toMatchObject({ count: 3, status: 'warming' });

    const four = cell(buildCooldowns(posts(HOT_TAKES.slice(0, 4)), NOW), 'hot_take');
    expect(four).toMatchObject({ count: 4, status: 'cooldown' });

    const five = cell(buildCooldowns(posts(HOT_TAKES), NOW), 'hot_take');
    expect(five).toMatchObject({ count: 5, status: 'cooldown' });
  });

  test('the thresholds the cells are cut on are the exported constants', () => {
    expect(WARMING_THRESHOLD).toBe(2);
    expect(COOLDOWN_THRESHOLD).toBe(4);
    expect(COOLDOWN_WINDOW_DAYS).toBe(7);
  });

  // The x-builder design clustered the window by token-set Jaccard so that four
  // DIFFERENT questions would not read as repetition. That guard measured
  // nothing on our corpus (module header), so this is the honest statement of
  // what ships: the cooldown counts SHAPES, and four dissimilar questions do
  // trip it. Idea-repetition stays with monitor.ts's near-duplicate alert.
  test('four dissimilar questions still count as four questions', () => {
    const cells = buildCooldowns(posts(QUESTIONS), NOW);
    expect(cell(cells, 'question')).toMatchObject({ count: 4, status: 'cooldown' });
  });
});

describe('buildCooldowns — the window', () => {
  test('a post older than the window is not counted', () => {
    const rows = [
      ...posts(HOT_TAKES.slice(0, 3)),
      { text: HOT_TAKES[3] as string, postedAt: ago(8) },
    ];
    expect(cell(buildCooldowns(rows, NOW), 'hot_take')).toMatchObject({
      count: 3,
      status: 'warming',
    });
  });

  test('the window edge is inclusive at exactly windowDays', () => {
    const rows = [{ text: HOT_TAKES[0] as string, postedAt: ago(COOLDOWN_WINDOW_DAYS) }];
    expect(cell(buildCooldowns(rows, NOW), 'hot_take')).toMatchObject({ count: 1 });
  });

  test('a future-dated row is ignored', () => {
    const rows = [
      ...posts(HOT_TAKES.slice(0, 2)),
      { text: HOT_TAKES[2] as string, postedAt: new Date(NOW.getTime() + DAY_MS) },
    ];
    expect(cell(buildCooldowns(rows, NOW), 'hot_take')).toMatchObject({ count: 2 });
  });

  test('windowDays widens the window', () => {
    const rows = posts(HOT_TAKES.slice(0, 4), 5); // 5,6,7,8 days ago
    expect(cell(buildCooldowns(rows, NOW), 'hot_take')).toMatchObject({ count: 3 });
    expect(cell(buildCooldowns(rows, NOW, 30), 'hot_take')).toMatchObject({
      count: 4,
      status: 'cooldown',
    });
  });
});

describe('buildCooldowns — fallback formats never warn (D146b)', () => {
  const substance = [
    'The gap between almost done and done is where side projects go to die.\n\nIt is 10% of the code and 90% of the resistance.',
    'Motivation is not the fuel.\n\nIt is the exhaust.\n\nStart moving and it shows up.',
    'Your best work is the boring work you did anyway.\n\nNobody claps for the fifth commit.',
    'A successful product is a failed one you shipped again.\n\nMost people quit one version early.',
    'Scope is a decision, not a discovery.\n\nWrite down what you are NOT building.',
  ];

  test('substance is counted but pinned clear and flagged exempt', () => {
    for (const t of substance) expect(classifyFormat(t)).toBe('substance');
    const found = cell(buildCooldowns(posts(substance), NOW), 'substance');
    expect(found).toMatchObject({ count: 5, status: 'clear', exempt: true });
  });

  test('every exempt format is a non-detection, and no other format is exempt', () => {
    expect([...COOLDOWN_EXEMPT_FORMATS]).toEqual(['substance', 'one_liner', 'other']);
    const rows = [
      ...posts(HOT_TAKES.slice(0, 4)),
      ...posts(substance, 1),
      { text: 'Ship it.', postedAt: ago(1) },
      { text: 'RT @someone: not my structure at all', postedAt: ago(2) },
    ];
    for (const c of buildCooldowns(rows, NOW)) {
      expect(c.exempt).toBe(COOLDOWN_EXEMPT_FORMATS.includes(c.format));
      if (c.exempt) expect(c.status).toBe('clear');
    }
  });
});

describe('buildCooldowns — cell shape', () => {
  test('lastPostedAt and exampleText describe the most recent post of the format', () => {
    const rows = [
      { text: HOT_TAKES[0] as string, postedAt: ago(6) },
      { text: HOT_TAKES[1] as string, postedAt: ago(2) },
      { text: HOT_TAKES[2] as string, postedAt: ago(4) },
    ];
    const found = cell(buildCooldowns(rows, NOW), 'hot_take');
    expect(found?.lastPostedAt).toBe(ago(2).toISOString());
    expect(found?.exampleText).toBe(HOT_TAKES[1]);
  });

  test('cells come back in POST_FORMATS cascade order, one per present format', () => {
    const rows = [
      ...posts(QUESTIONS.slice(0, 2)),
      ...posts(HOT_TAKES.slice(0, 2), 3),
      { text: 'Just hit 1,000 followers.\n\nOn to the next one.', postedAt: ago(1) },
    ];
    const cells = buildCooldowns(rows, NOW);
    const order = cells.map((c) => POST_FORMATS.indexOf(c.format));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(cells.map((c) => c.format)).size).toBe(cells.length);
    expect(cells.map((c) => c.format)).toContain('hot_take');
    expect(cells.map((c) => c.format)).toContain('question');
  });
});
