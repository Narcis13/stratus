import { describe, expect, test } from 'bun:test';
import type { ActiveTimesGrid } from '../shared/activeTimes.ts';
import type { BestTimeCell, ScheduledPost } from '../shared/types.ts';
import { buildWeekBoard, occupiedSlotDates, slotDateFor } from './calendarLogic.ts';
import { addDays, startOfLocalDay } from './datetime.ts';

// A minimal ScheduledPost — override only what a case cares about.
function post(o: Partial<ScheduledPost> & { id: string }): ScheduledPost {
  return {
    text: 'a post',
    mediaIds: null,
    scheduledFor: null,
    status: 'pending',
    postedTweetId: null,
    errorClass: null,
    errorDetail: null,
    source: 'test',
    threadId: null,
    threadPosition: null,
    pillar: null,
    quoteTweetId: null,
    mediaNote: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...o,
  };
}

// Local wall-clock ISO — the board buckets by local day/hour, so a fixture time
// must be built in the machine's local zone (mirrors how the API's Date reads
// back through `new Date(iso)`).
function localIso(base: Date, dayOffset: number, hour: number, minute: number): string {
  const d = startOfLocalDay(addDays(base, dayOffset));
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function cell(weekday: number, hour: number, posts: number, rate: number | null): BestTimeCell {
  return {
    weekday,
    hour,
    posts,
    avgViews: rate,
    avgViewsPerDay: rate,
    avgLikes: null,
    avgProfileVisits: null,
  };
}

// 7×24 grid, given (jsWeekday, hour) cells set to 1. Columns run Mon..Sun;
// audienceScoreFor maps jsWeekday via (wd+6)%7.
function grid(hot: Array<[number, number]>): ActiveTimesGrid {
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const [wd, hr] of hot) {
    (cells[(wd + 6) % 7] as number[])[hr] = 1;
  }
  return { cols: 7, rows: 24, grid: cells, tzOffsetMin: 0, metric: 'likes' };
}

// A fixed "now": 2026-07-20, 07:00 local. Early enough that today's 9/13/18
// anchors are all still future.
const NOW = new Date(2026, 6, 20, 7, 0, 0);

describe('buildWeekBoard — placement', () => {
  test('posts land on their local day column; 7 columns, today first', () => {
    const posts = [
      post({ id: 'a', status: 'pending', scheduledFor: localIso(NOW, 0, 13, 5) }),
      post({ id: 'b', status: 'pending', scheduledFor: localIso(NOW, 2, 9, 40) }),
    ];
    const board = buildWeekBoard(NOW, posts, [], [], null);
    expect(board.columns).toHaveLength(7);
    expect(board.columns[0]?.isToday).toBe(true);
    expect(board.columns[0]?.rows.map((r) => r.id)).toEqual(['a']);
    expect(board.columns[2]?.rows.map((r) => r.id)).toEqual(['b']);
    expect(board.columns[1]?.rows).toEqual([]);
  });

  test('rows within a day sort earliest first', () => {
    const posts = [
      post({ id: 'late', scheduledFor: localIso(NOW, 1, 18, 10) }),
      post({ id: 'early', scheduledFor: localIso(NOW, 1, 9, 10) }),
    ];
    const board = buildWeekBoard(NOW, posts, [], [], null);
    expect(board.columns[1]?.rows.map((r) => r.id)).toEqual(['early', 'late']);
  });
});

describe('buildWeekBoard — ghost slots', () => {
  test('ghosts are unclaimed anchors only; occupying statuses claim, others do not', () => {
    // Tomorrow: a pending post at 13:xx claims anchor 13; a cancelled post at
    // 09:xx must NOT claim anchor 9 (so 9 stays open).
    const posts = [
      post({ id: 'p', status: 'pending', scheduledFor: localIso(NOW, 1, 13, 20) }),
      post({ id: 'c', status: 'cancelled', scheduledFor: localIso(NOW, 1, 9, 20) }),
    ];
    const board = buildWeekBoard(NOW, posts, [], [], null);
    expect(board.columns[1]?.ghosts.map((g) => g.hour)).toEqual([9, 18]);
  });

  test('today drops anchors whose hour has already passed', () => {
    // now = 07:00, so 9/13/18 are future → all three ghosts on today.
    const early = buildWeekBoard(new Date(2026, 6, 20, 7, 0), [], [], [], null);
    expect(early.columns[0]?.ghosts.map((g) => g.hour)).toEqual([9, 13, 18]);
    // now = 14:00 → 9 and 13 are past, only 18 remains today.
    const late = buildWeekBoard(new Date(2026, 6, 20, 14, 0), [], [], [], null);
    expect(late.columns[0]?.ghosts.map((g) => g.hour)).toEqual([18]);
  });

  test('ghosts follow the mirrored cadence config (UI.6)', () => {
    // The board and the Composer must open the same hours: a configured ladder
    // moves the ghosts, not just the "Best time" button.
    const cfg = {
      anchors3: [7, 12, 20],
      anchors4: [6, 10, 15, 22],
      ladderSwitchAt: 2,
      bestTimeMinN: 3,
    };
    const board = buildWeekBoard(NOW, [], [], [], null, cfg);
    expect(board.columns[1]?.ghosts.map((g) => g.hour)).toEqual([7, 12, 20]);
    // Two claimed slots hit the configured switch → the 4/day ladder.
    const posts = [
      post({ id: 'a', status: 'pending', scheduledFor: localIso(NOW, 1, 6, 20) }),
      post({ id: 'b', status: 'pending', scheduledFor: localIso(NOW, 1, 10, 20) }),
    ];
    expect(
      buildWeekBoard(NOW, posts, [], [], null, cfg).columns[1]?.ghosts.map((g) => g.hour),
    ).toEqual([15, 22]);
  });
});

describe('buildWeekBoard — tier shading (hint propagation)', () => {
  test('measured own cell wins; audience is the fallback tag; else null', () => {
    const tomorrow = addDays(startOfLocalDay(NOW), 1);
    const wd = tomorrow.getDay();
    const cells = [cell(wd, 9, 4, 1200)]; // gated measured cell at hour 9
    const audience = grid([[wd, 13]]); // audience hot at hour 13
    const board = buildWeekBoard(NOW, [], [], cells, audience);
    const ghosts = board.columns[1]?.ghosts ?? [];
    const byHour = new Map(ghosts.map((g) => [g.hour, g]));
    expect(byHour.get(9)?.hint).toBe('measured');
    expect(byHour.get(9)?.ownScore).toBe(1200);
    expect(byHour.get(13)?.hint).toBe('audience');
    expect(byHour.get(13)?.ownScore).toBeNull();
    expect(byHour.get(18)?.hint).toBeNull();
  });
});

describe('buildWeekBoard — overdue flag', () => {
  test('a past manual slot is overdue; a past pending slot is not', () => {
    const posts = [
      post({ id: 'm', status: 'manual', scheduledFor: localIso(NOW, 0, 6, 0) }), // before 07:00
      post({ id: 'p', status: 'pending', scheduledFor: localIso(NOW, 0, 6, 30) }),
    ];
    const board = buildWeekBoard(NOW, posts, [], [], null);
    const rows = new Map((board.columns[0]?.rows ?? []).map((r) => [r.id, r]));
    expect(rows.get('m')?.overdue).toBe(true);
    expect(rows.get('p')?.overdue).toBe(false);
  });
});

describe('buildWeekBoard — chips + snippet', () => {
  test('chip flags derive from the row and the snippet clips at 60', () => {
    const long = 'x'.repeat(80);
    const posts = [
      post({
        id: 'r',
        scheduledFor: localIso(NOW, 1, 9, 0),
        threadId: 't1',
        quoteTweetId: 'q1',
        mediaNote: 'a chart',
        pillar: 'ai-craft',
        text: long,
      }),
    ];
    const row = buildWeekBoard(NOW, posts, [], [], null).columns[1]?.rows[0];
    expect(row?.isThread).toBe(true);
    expect(row?.isReup).toBe(true);
    expect(row?.hasVisual).toBe(true);
    expect(row?.pillar).toBe('ai-craft');
    expect(row?.snippet.length).toBeLessThanOrEqual(61); // 60 chars + ellipsis
    expect(row?.snippet.endsWith('…')).toBe(true);
  });
});

describe('buildWeekBoard — drafts tray', () => {
  test('newest first; hasVisual marks a media-note draft', () => {
    const drafts = [
      post({ id: 'old', status: 'draft', createdAt: '2026-07-01T00:00:00.000Z' }),
      post({ id: 'new', status: 'draft', createdAt: '2026-07-05T00:00:00.000Z', mediaNote: 'pic' }),
    ];
    const { tray } = buildWeekBoard(NOW, [], drafts, [], null);
    expect(tray.map((d) => d.id)).toEqual(['new', 'old']);
    expect(tray[0]?.hasVisual).toBe(true);
    expect(tray[1]?.hasVisual).toBe(false);
  });
});

describe('occupiedSlotDates', () => {
  test('keeps slot-holding statuses, drops draft/failed/cancelled and untimed', () => {
    const posts = [
      post({ id: 'a', status: 'pending', scheduledFor: localIso(NOW, 0, 9, 0) }),
      post({ id: 'b', status: 'posted', scheduledFor: localIso(NOW, 0, 13, 0) }),
      post({ id: 'c', status: 'manual', scheduledFor: localIso(NOW, 0, 18, 0) }),
      post({ id: 'd', status: 'publishing', scheduledFor: localIso(NOW, 1, 8, 0) }),
      post({ id: 'e', status: 'cancelled', scheduledFor: localIso(NOW, 0, 20, 0) }),
      post({ id: 'f', status: 'failed', scheduledFor: localIso(NOW, 0, 21, 0) }),
      post({ id: 'g', status: 'pending', scheduledFor: null }),
    ];
    expect(occupiedSlotDates(posts)).toHaveLength(4);
  });
});

describe('slotDateFor — scheduling target math', () => {
  test('jittered minute in [4,56] at the chosen hour, never top-of-hour', () => {
    const day = startOfLocalDay(addDays(NOW, 2));
    const lo = slotDateFor(day, 13, () => 0);
    const hi = slotDateFor(day, 13, () => 0.999999);
    expect(lo.getHours()).toBe(13);
    expect(hi.getHours()).toBe(13);
    expect(lo.getMinutes()).toBe(4);
    expect(hi.getMinutes()).toBe(56);
    expect(lo.getSeconds()).toBe(0);
    // Same local day as the target column.
    expect(lo.getDate()).toBe(day.getDate());
  });
});
