// C7 Launch Room pure core: alarm scheduling, alarm-name round-trips, room
// liveness, early-reply merge.

import { describe, expect, test } from 'bun:test';
import {
  type EarlyReply,
  LAUNCH_ALARM_PREFIX,
  LAUNCH_GRACE_MS,
  LAUNCH_ROOM_MS,
  computeLaunchAlarms,
  launchIsLive,
  mergeEarlyReplies,
  notificationText,
  parseLaunchAlarm,
  retryAlarmName,
  threadLinkInFirstReply,
} from './launch.ts';

const NOW = Date.parse('2026-07-04T12:00:00Z');
const MIN = 60_000;

function post(id: string, status: string, scheduledOffsetMs: number | null) {
  return {
    id,
    status,
    scheduledFor:
      scheduledOffsetMs === null ? null : new Date(NOW + scheduledOffsetMs).toISOString(),
  };
}

describe('computeLaunchAlarms', () => {
  test('one alarm per pending post at scheduledFor + grace, sorted by when', () => {
    const alarms = computeLaunchAlarms(
      [post('b', 'pending', 120 * MIN), post('a', 'pending', 10 * MIN)],
      NOW,
    );
    expect(alarms.map((a) => a.name)).toEqual([
      `${LAUNCH_ALARM_PREFIX}a`,
      `${LAUNCH_ALARM_PREFIX}b`,
    ]);
    expect(alarms[0]?.when).toBe(NOW + 10 * MIN + LAUNCH_GRACE_MS);
  });

  test('non-pending and unscheduled posts are skipped', () => {
    const alarms = computeLaunchAlarms(
      [
        post('draft', 'draft', 10 * MIN),
        post('posted', 'posted', 10 * MIN),
        post('segment', 'segment', 10 * MIN),
        post('unsched', 'pending', null),
      ],
      NOW,
    );
    expect(alarms).toEqual([]);
  });

  test('a recently-missed fire clamps to just ahead of now (mid-window room still opens)', () => {
    const alarms = computeLaunchAlarms([post('late', 'pending', -10 * MIN)], NOW);
    expect(alarms.length).toBe(1);
    expect(alarms[0]?.when).toBe(NOW + 1000);
  });

  test('a fire whose whole room window has passed is dropped', () => {
    const gone = -(LAUNCH_ROOM_MS + LAUNCH_GRACE_MS + MIN);
    expect(computeLaunchAlarms([post('gone', 'pending', gone)], NOW)).toEqual([]);
  });

  test('invalid scheduledFor is skipped', () => {
    expect(
      computeLaunchAlarms([{ id: 'x', status: 'pending', scheduledFor: 'not-a-date' }], NOW),
    ).toEqual([]);
  });
});

describe('alarm names', () => {
  test('fire alarm round-trips with attempt 0', () => {
    expect(parseLaunchAlarm(`${LAUNCH_ALARM_PREFIX}abc-123`)).toEqual({
      postId: 'abc-123',
      attempt: 0,
    });
  });

  test('retry alarm round-trips postId + attempt (uuid with dashes intact)', () => {
    const id = 'f1e2d3c4-aaaa-bbbb-cccc-000011112222';
    expect(parseLaunchAlarm(retryAlarmName(id, 3))).toEqual({ postId: id, attempt: 3 });
  });

  test('foreign alarms (incl. the sync alarm) are ignored', () => {
    expect(parseLaunchAlarm('stratus-launch-sync')).toBeNull();
    expect(parseLaunchAlarm('some-other-alarm')).toBeNull();
  });
});

describe('launchIsLive', () => {
  test('true inside the 30-minute window, false after', () => {
    const firedAt = new Date(NOW).toISOString();
    expect(launchIsLive(firedAt, NOW + 1)).toBe(true);
    expect(launchIsLive(firedAt, NOW + LAUNCH_ROOM_MS - 1)).toBe(true);
    expect(launchIsLive(firedAt, NOW + LAUNCH_ROOM_MS)).toBe(false);
  });

  test('garbage firedAt is not live', () => {
    expect(launchIsLive('nope', NOW)).toBe(false);
  });
});

describe('mergeEarlyReplies', () => {
  const r = (tweetId: string, text = 'hi'): EarlyReply => ({
    tweetId,
    handle: `h${tweetId}`,
    author: null,
    text,
    postedAt: null,
  });

  test('dedupes by tweetId, first sighting wins, arrival order kept', () => {
    const { merged, added } = mergeEarlyReplies([r('1', 'first')], [r('1', 'again'), r('2')]);
    expect(merged.map((x) => x.tweetId)).toEqual(['1', '2']);
    expect(merged[0]?.text).toBe('first');
    expect(added.map((x) => x.tweetId)).toEqual(['2']);
  });

  test('cap drops the newest overflow and reports only what entered', () => {
    const existing = [r('1'), r('2')];
    const { merged, added } = mergeEarlyReplies(existing, [r('3'), r('4')], 3);
    expect(merged.map((x) => x.tweetId)).toEqual(['1', '2', '3']);
    expect(added.map((x) => x.tweetId)).toEqual(['3']);
  });
});

describe('threadLinkInFirstReply', () => {
  test('true only when a tail segment carries a URL', () => {
    expect(threadLinkInFirstReply(undefined)).toBe(false);
    expect(
      threadLinkInFirstReply([
        { threadPosition: 1, text: 'head https://example.com' },
        { threadPosition: 2, text: 'tail, no link' },
      ]),
    ).toBe(false);
    expect(
      threadLinkInFirstReply([
        { threadPosition: 1, text: 'head' },
        { threadPosition: 2, text: 'link here https://example.com' },
      ]),
    ).toBe(true);
  });
});

describe('notificationText', () => {
  test('clips long text and wraps in guillemets', () => {
    const msg = notificationText('a'.repeat(200));
    expect(msg.endsWith('» just went live — open the Launch Room')).toBe(true);
    expect(msg.includes('…')).toBe(true);
  });
});
