// AX.4 — the tweet-page context view-model over a hand-built dossier fixture
// (JSON literal, not happy-dom): the dossier is consumed as HTTP JSON, so every
// timestamp is an ISO string.

import { describe, expect, test } from 'bun:test';
import {
  type Dossier,
  MIN_MEASURED_FOR_ANGLE_PREFERENCE,
  buildTweetContextModel,
} from './tweetContext.ts';

const NOW = Date.parse('2026-07-20T12:00:00Z');
const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(NOW - n * DAY_MS).toISOString();
const minAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

const TWEET = '9001';

function dossier(over: Partial<Dossier> = {}): Dossier {
  return {
    person: {
      handle: 'ada',
      displayName: 'Ada L',
      stage: 'mutual',
      followersCount: 4200,
      notes: null,
      tags: [],
      firstSeenAt: null,
      lastInboundAt: null,
      lastOutboundAt: null,
    },
    events: [],
    replies: { outcomes: [] },
    angles: [],
    mentions: [],
    followerSeries: [],
    ...over,
  };
}

describe('buildTweetContextModel — rich fixture', () => {
  const d = dossier({
    person: {
      handle: 'ada',
      displayName: 'Ada L',
      stage: 'mutual',
      followersCount: 4200,
      notes: '  builds compilers; loves a good contrarian take  ',
      tags: ['compilers', 'ai'],
      firstSeenAt: daysAgo(30),
      lastInboundAt: daysAgo(2),
      lastOutboundAt: daysAgo(1),
    },
    events: [
      { type: 'their_mention', at: daysAgo(5) },
      { type: 'their_reply_to_me', at: daysAgo(2) },
      { type: 'my_reply', at: daysAgo(1) },
      { type: 'my_reply', at: daysAgo(10) },
      { type: 'saved_tweet', at: daysAgo(40) }, // neither inbound nor outbound
      { type: 'hover_sighting', at: daysAgo(3) },
    ],
    replies: {
      outcomes: [
        // answers THIS tweet — drives alreadyReplied
        {
          sourceTweetId: TWEET,
          replyText: 'that framing is exactly backwards, here is why',
          postedTweetId: '5555',
          postedAt: minAgo(90),
          draftCreatedAt: minAgo(100),
          angle: 'contrarian',
          outcome: { views: 1800, profileVisits: 22 },
        },
        {
          sourceTweetId: '7000',
          replyText: 'extending your point about incremental compilation',
          postedTweetId: '4444',
          postedAt: daysAgo(3),
          draftCreatedAt: daysAgo(3),
          angle: 'extends',
          outcome: { views: 900, profileVisits: 8 },
        },
        {
          sourceTweetId: '7001',
          replyText: 'unmeasured reply, no snapshot yet',
          postedTweetId: '3333',
          postedAt: daysAgo(1),
          draftCreatedAt: daysAgo(1),
          angle: 'debate',
          outcome: null, // excluded from outcomes list
        },
      ],
    },
    angles: [
      { angle: 'contrarian', measured: 4, medianViews: 1500, medianProfileVisits: 20 },
      { angle: 'extends', measured: 2, medianViews: 2000, medianProfileVisits: 5 },
      { angle: null, measured: 1, medianViews: 100, medianProfileVisits: 0 },
    ],
    mentions: [
      {
        tweetId: 'm1',
        text: 'what do you think of this?',
        postedAt: daysAgo(4),
        status: 'unanswered',
      },
      { tweetId: 'm2', text: 'thanks, that helped', postedAt: daysAgo(1), status: 'answered' },
      { tweetId: 'm3', text: 'older open loop', postedAt: daysAgo(9), status: 'unanswered' },
    ],
    followerSeries: [
      { followersCount: 4000, capturedAt: daysAgo(20) },
      { followersCount: 4200, capturedAt: daysAgo(0) },
    ],
  });
  const m = buildTweetContextModel(d, TWEET, NOW);

  test('header', () => {
    expect(m.header).toEqual({
      handle: 'ada',
      displayName: 'Ada L',
      stage: 'mutual',
      sinceDays: 30,
      followersCount: 4200,
      momentumPerDay: 10, // (4200-4000)/20 days = 10/day
      tags: ['compilers', 'ai'],
    });
  });

  test('relationship counts from events, last dates from watermarks', () => {
    expect(m.relationship).toEqual({
      inbound: 2,
      outbound: 2,
      lastInboundAt: daysAgo(2),
      lastOutboundAt: daysAgo(1),
    });
  });

  test('alreadyReplied matches this tweet', () => {
    expect(m.alreadyReplied).toEqual({ postedTweetId: '5555', ageMin: 90 });
  });

  test('open loops: unanswered only, oldest debt first', () => {
    expect(m.openLoops).toEqual([
      { tweetId: 'm3', text: 'older open loop', ageDays: 9 },
      { tweetId: 'm1', text: 'what do you think of this?', ageDays: 4 },
    ]);
  });

  test('outcomes: measured only, newest first, ≤3', () => {
    expect(m.outcomes).toEqual([
      {
        text: 'that framing is exactly backwards, here is why',
        views: 1800,
        profileVisits: 22,
        angle: 'contrarian',
        postedAt: minAgo(90),
      },
      {
        text: 'extending your point about incremental compilation',
        views: 900,
        profileVisits: 8,
        angle: 'extends',
        postedAt: daysAgo(3),
      },
    ]);
  });

  test('angle preference: best median profile visits over the gate', () => {
    // contrarian (20) beats extends (5) on profile visits despite lower views.
    expect(m.anglePreference).toEqual({ angle: 'contrarian', measured: 4 });
  });

  test('notes trimmed', () => {
    expect(m.notes).toBe('builds compilers; loves a good contrarian take');
  });
});

describe('buildTweetContextModel — edge cases', () => {
  test('thin person: only a people row, empty everything, no crash', () => {
    const m = buildTweetContextModel(dossier(), TWEET, NOW);
    expect(m.header.momentumPerDay).toBeNull();
    expect(m.header.sinceDays).toBeNull();
    expect(m.header.tags).toEqual([]);
    expect(m.relationship).toEqual({
      inbound: 0,
      outbound: 0,
      lastInboundAt: null,
      lastOutboundAt: null,
    });
    expect(m.alreadyReplied).toBeNull();
    expect(m.openLoops).toEqual([]);
    expect(m.outcomes).toEqual([]);
    expect(m.anglePreference).toBeNull();
    expect(m.notes).toBeNull();
  });

  test('angle gate: 2 measured → null, 3 → set', () => {
    const under = buildTweetContextModel(
      dossier({
        angles: [{ angle: 'extends', measured: 2, medianViews: 500, medianProfileVisits: 4 }],
      }),
      TWEET,
      NOW,
    );
    expect(under.anglePreference).toBeNull();

    const at = buildTweetContextModel(
      dossier({
        angles: [{ angle: 'extends', measured: 3, medianViews: 500, medianProfileVisits: 4 }],
      }),
      TWEET,
      NOW,
    );
    expect(at.anglePreference).toEqual({ angle: 'extends', measured: 3 });
    // Sanity: the gate constant is the shared 3.
    expect(MIN_MEASURED_FOR_ANGLE_PREFERENCE).toBe(3);
  });

  test('angle gate counts total measured across cells (3 split as 2+1)', () => {
    const m = buildTweetContextModel(
      dossier({
        angles: [
          { angle: 'extends', measured: 2, medianViews: 500, medianProfileVisits: 4 },
          { angle: 'contrarian', measured: 1, medianViews: 900, medianProfileVisits: 9 },
        ],
      }),
      TWEET,
      NOW,
    );
    // total = 3 → gate passes; contrarian wins on profile visits.
    expect(m.anglePreference).toEqual({ angle: 'contrarian', measured: 1 });
  });

  test('alreadyReplied miss when no outcome matches the tweet', () => {
    const m = buildTweetContextModel(
      dossier({
        replies: {
          outcomes: [
            {
              sourceTweetId: '404',
              replyText: 'unrelated',
              postedTweetId: '1',
              postedAt: daysAgo(1),
              draftCreatedAt: daysAgo(1),
              outcome: { views: 10, profileVisits: 0 },
            },
          ],
        },
      }),
      TWEET,
      NOW,
    );
    expect(m.alreadyReplied).toBeNull();
  });

  test('alreadyReplied works when postedTweetId is unlinked (age from draft time)', () => {
    const m = buildTweetContextModel(
      dossier({
        replies: {
          outcomes: [
            {
              sourceTweetId: TWEET,
              replyText: 'replied but never linked',
              postedTweetId: null,
              postedAt: null,
              draftCreatedAt: minAgo(200),
              outcome: { views: 5, profileVisits: 1 },
            },
          ],
        },
      }),
      TWEET,
      NOW,
    );
    expect(m.alreadyReplied).toEqual({ postedTweetId: null, ageMin: 200 });
  });

  test('momentum: single point → null', () => {
    const m = buildTweetContextModel(
      dossier({ followerSeries: [{ followersCount: 100, capturedAt: daysAgo(3) }] }),
      TWEET,
      NOW,
    );
    expect(m.header.momentumPerDay).toBeNull();
  });

  test('momentum: same-day span clamped to ≥1 day', () => {
    const m = buildTweetContextModel(
      dossier({
        followerSeries: [
          { followersCount: 100, capturedAt: minAgo(30) },
          { followersCount: 150, capturedAt: new Date(NOW).toISOString() },
        ],
      }),
      TWEET,
      NOW,
    );
    // 50 growth over <1 day → clamped denominator of 1 day → 50/day.
    expect(m.header.momentumPerDay).toBe(50);
  });

  test('outcomes cap at 3 newest', () => {
    const outcomes = [5, 4, 3, 2, 1].map((n) => ({
      sourceTweetId: `s${n}`,
      replyText: `reply ${n}`,
      postedTweetId: `p${n}`,
      postedAt: daysAgo(n),
      draftCreatedAt: daysAgo(n),
      outcome: { views: n * 10, profileVisits: n },
    }));
    const m = buildTweetContextModel(dossier({ replies: { outcomes } }), TWEET, NOW);
    expect(m.outcomes.map((o) => o.text)).toEqual(['reply 1', 'reply 2', 'reply 3']);
  });
});
