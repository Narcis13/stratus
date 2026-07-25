// Fixture-driven tests for the C4 Playbook aggregations — every stat's
// min-sample gate and the guidance helpers' refusal to speak under it.

import { describe, expect, test } from 'bun:test';
import {
  type AngleRow,
  type IdeaRow,
  type LatencyRow,
  type MeasuredOutcome,
  type ModelRow,
  type ScoredReply,
  type TimelineBand,
  type TimelineSeenRow,
  authorSizeBucket,
  buildAngleEffectiveness,
  buildBandCalibration,
  buildBatchVsSingle,
  buildIdeaEffectiveness,
  buildLatencyEffectiveness,
  buildMeEffectiveness,
  buildMediaEffectiveness,
  buildModelEffectiveness,
  buildPillarRegisterScorecard,
  buildRelationshipLift,
  buildRosterCoverage,
  buildStructureEffectiveness,
  buildTimelineFunnel,
  classifyReplyOrigin,
  classifyRosterBand,
  deriveTimelineBand,
  latencyBucket,
  median,
  normalizeReplyText,
  resolveAgeMin,
  scoreReplyOutcome,
  topAngles,
  topStructures,
} from './playbook.ts';

const out = (views: number | null, profileVisits: number | null = null): MeasuredOutcome => ({
  views,
  profileVisits,
});

describe('median', () => {
  test('odd, even, empty, nulls filtered', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([null, 5, undefined])).toBe(5);
  });
});

describe('authorSizeBucket', () => {
  test('boundaries', () => {
    expect(authorSizeBucket(null)).toBe('unknown');
    expect(authorSizeBucket(999)).toBe('<1k');
    expect(authorSizeBucket(1000)).toBe('1k-10k');
    expect(authorSizeBucket(9999)).toBe('1k-10k');
    expect(authorSizeBucket(10_000)).toBe('10k-100k');
    expect(authorSizeBucket(100_000)).toBe('100k+');
  });
});

describe('buildAngleEffectiveness', () => {
  const rows: AngleRow[] = [
    { angle: 'contrarian', authorFollowers: 50_000, outcome: out(100, 5) },
    { angle: 'contrarian', authorFollowers: 20_000, outcome: out(300, 7) },
    { angle: 'contrarian', authorFollowers: 500, outcome: null }, // posted, unmeasured
    { angle: 'extends', authorFollowers: 500, outcome: out(40, 1) },
    { angle: null, authorFollowers: null, outcome: out(10, 0) },
  ];

  test('cells carry posted vs measured n and medians', () => {
    const r = buildAngleEffectiveness(rows, 2);
    const contrarian = r.overall.find((c) => c.angle === 'contrarian');
    expect(contrarian).toMatchObject({
      posted: 3,
      n: 2,
      medianViews: 200,
      medianProfileVisits: 6,
      sufficient: true,
    });
    const extendsCell = r.overall.find((c) => c.angle === 'extends');
    expect(extendsCell?.sufficient).toBe(false);
    expect(r.totalMeasured).toBe(4);
  });

  test('author-size buckets split the same rows', () => {
    const r = buildAngleEffectiveness(rows, 1);
    const buckets = r.byAuthorSize.map((b) => b.bucket);
    expect(buckets).toContain('10k-100k');
    expect(buckets).toContain('<1k');
    expect(buckets).toContain('unknown');
    const big = r.byAuthorSize.find((b) => b.bucket === '10k-100k');
    expect(big?.cells).toHaveLength(1);
    expect(big?.cells[0]?.n).toBe(2);
  });

  test('default gate is 20', () => {
    const r = buildAngleEffectiveness(rows);
    expect(r.overall.every((c) => c.sufficient === false)).toBe(true);
  });
});

describe('buildPillarRegisterScorecard', () => {
  test('groups by pillar × register, null keys stay distinct', () => {
    const r = buildPillarRegisterScorecard(
      [
        { pillar: 'ai-craft', register: 'spicy', outcome: out(500) },
        { pillar: 'ai-craft', register: 'spicy', outcome: out(700) },
        { pillar: 'ai-craft', register: null, outcome: out(50) },
        { pillar: null, register: null, outcome: null },
      ],
      2,
    );
    expect(r.cells).toHaveLength(3);
    const spicy = r.cells.find((c) => c.pillar === 'ai-craft' && c.register === 'spicy');
    expect(spicy).toMatchObject({ n: 2, medianViews: 600, sufficient: true });
    expect(r.totalMeasured).toBe(3);
  });
});

describe('buildStructureEffectiveness', () => {
  test('normalizes keys and splits hooks vs devices', () => {
    const r = buildStructureEffectiveness(
      [
        { hookType: 'Stat hook', device: 'before/after', outcome: out(100) },
        { hookType: 'stat hook', device: 'Repetition', outcome: out(300) },
        { hookType: 'story hook', device: 'repetition', outcome: null },
      ],
      2,
    );
    const stat = r.hooks.find((c) => c.key === 'stat hook');
    expect(stat).toMatchObject({ posted: 2, n: 2, medianViews: 200, sufficient: true });
    const rep = r.devices.find((c) => c.key === 'repetition');
    expect(rep).toMatchObject({ posted: 2, n: 1, sufficient: false });
    expect(r.totalMeasured).toBe(2);
  });
});

describe('classifyReplyOrigin', () => {
  // postedTweetId → reply_drafts.source (RU.9). null = reply_master / legacy.
  const draftSource = new Map<string, string | null>([
    ['901', null],
    ['905', 'radar'],
  ]);
  const radar = new Map([['777', ['Ship it.\n\nThen fix it.']]]);
  // reply_list_uses.renderedText, normalized (RL.7). 'Ship it. Then fix it.'
  // is deliberately BOTH a radar draft and a canned use here.
  const canned = new Set(['thanks for the early read, Ana!', 'Ship it. Then fix it.']);

  test('draft link wins even when a radar match also exists', () => {
    expect(
      classifyReplyOrigin(
        { tweetId: '901', inReplyToTweetId: '777', text: 'Ship it. Then fix it.' },
        draftSource,
        radar,
        canned,
      ),
    ).toBe('single');
  });

  test('source=radar on a linked draft beats a text mismatch', () => {
    expect(
      classifyReplyOrigin(
        { tweetId: '905', inReplyToTweetId: null, text: 'nothing like any radar draft' },
        draftSource,
        radar,
        canned,
      ),
    ).toBe('radar');
  });

  test('radar needs target AND collapsed-whitespace text equality (legacy, null source)', () => {
    expect(
      classifyReplyOrigin(
        { tweetId: '902', inReplyToTweetId: '777', text: 'Ship it.  Then fix it.' },
        draftSource,
        radar,
        canned,
      ),
    ).toBe('radar');
    expect(
      classifyReplyOrigin(
        { tweetId: '903', inReplyToTweetId: '777', text: 'Something I typed myself' },
        draftSource,
        radar,
        canned,
      ),
    ).toBeNull();
    expect(
      classifyReplyOrigin(
        { tweetId: '904', inReplyToTweetId: '778', text: 'Ship it. Then fix it.' },
        draftSource,
        radar,
        canned,
      ),
    ).toBe('canned'); // right text, wrong radar target — falls through to the use log
  });

  test('a rendered-text match with no draft link classifies canned', () => {
    expect(
      classifyReplyOrigin(
        {
          tweetId: '906',
          inReplyToTweetId: '888',
          text: 'thanks for the early read,  Ana!\n',
        },
        draftSource,
        radar,
        canned,
      ),
    ).toBe('canned');
  });

  test('canned is checked last: a posted draft that also matches a use counts single', () => {
    expect(
      classifyReplyOrigin(
        { tweetId: '901', inReplyToTweetId: null, text: 'thanks for the early read, Ana!' },
        draftSource,
        radar,
        canned,
      ),
    ).toBe('single');
  });

  test('no match anywhere stays unattributed', () => {
    expect(
      classifyReplyOrigin(
        { tweetId: '907', inReplyToTweetId: '888', text: 'wrote this one myself' },
        draftSource,
        radar,
        canned,
      ),
    ).toBeNull();
  });

  test('normalizeReplyText collapses all whitespace runs', () => {
    expect(normalizeReplyText('a\n\n b\tc ')).toBe('a b c');
  });
});

describe('buildBatchVsSingle', () => {
  test('splits by origin with independent gates', () => {
    const r = buildBatchVsSingle(
      [
        { origin: 'single', outcome: out(100, 2) },
        { origin: 'single', outcome: out(200, 4) },
        { origin: 'radar', outcome: out(50, 1) },
        { origin: 'canned', outcome: out(30, 0) },
        { origin: 'canned', outcome: out(70, 2) },
      ],
      2,
    );
    expect(r.single).toMatchObject({ n: 2, medianViews: 150, sufficient: true });
    expect(r.radar).toMatchObject({ n: 1, sufficient: false });
    expect(r.canned).toMatchObject({ n: 2, medianViews: 50, sufficient: true });
  });

  test('an empty canned bucket is a zero cell, not a missing key', () => {
    const r = buildBatchVsSingle([{ origin: 'single', outcome: out(100, 2) }], 2);
    expect(r.canned).toMatchObject({ n: 0, medianViews: null, sufficient: false });
  });
});

describe('scoreReplyOutcome', () => {
  test('unmeasured rows score null', () => {
    expect(
      scoreReplyOutcome({
        signals: { band: 'hot', views: 1000, replies: 5, ageMin: 10, vpm: 100, bait: false },
        sourceMetrics: null,
        sourceText: 'x',
        sourcePostedAt: null,
        draftCreatedAt: new Date(),
        outcome: null,
      }),
    ).toBeNull();
  });

  test('stamped signals pass through', () => {
    const s = scoreReplyOutcome({
      signals: { band: 'warm', views: 1000, replies: 5, ageMin: 10, vpm: 100, bait: true },
      sourceMetrics: null,
      sourceText: 'x',
      sourcePostedAt: null,
      draftCreatedAt: new Date(),
      outcome: { views: 80, likes: 2, profileVisits: 1 },
    });
    expect(s).toMatchObject({ band: 'warm', bait: true, views: 80, likes: 2, profileClicks: 1 });
  });

  test('derives band + bait when signals are absent', () => {
    const posted = new Date('2026-07-01T10:00:00Z');
    const created = new Date('2026-07-01T10:10:00Z');
    const s = scoreReplyOutcome({
      signals: null,
      sourceMetrics: { views: 5000, replies: 10 },
      sourceText: 'Agree or disagree?',
      sourcePostedAt: posted,
      draftCreatedAt: created,
      outcome: { views: 40, likes: 0, profileVisits: null },
    });
    // 5000 views, 10 replies, 10 min old → hot per the BAND model.
    expect(s).toMatchObject({ band: 'hot', bait: true, views: 40, likes: 0, profileClicks: null });
  });

  test('derived path without source metrics scores null', () => {
    expect(
      scoreReplyOutcome({
        signals: null,
        sourceMetrics: null,
        sourceText: 'x',
        sourcePostedAt: new Date(),
        draftCreatedAt: new Date(),
        outcome: { views: 40, likes: 0, profileVisits: null },
      }),
    ).toBeNull();
  });
});

describe('buildBandCalibration', () => {
  const scored: ScoredReply[] = [
    { band: 'hot', bait: false, views: 400, likes: 2, profileClicks: 3 },
    { band: 'hot', bait: false, views: 300, likes: 1, profileClicks: null },
    { band: 'warm', bait: true, views: 100, likes: 0, profileClicks: 0 },
    { band: null, bait: false, views: 10, likes: 0, profileClicks: 0 },
  ];

  test('hit bar is the account p75; bands carry rates', () => {
    const r = buildBandCalibration(scored, 2);
    expect(r.totalMeasured).toBe(4);
    expect(r.hitThresholdViews).toBe(400);
    const hot = r.bands.find((b) => b.band === 'hot');
    expect(hot).toMatchObject({
      n: 2,
      medianViews: 350,
      hitRate: 0.5,
      likeRate: 1,
      meanProfileClicks: 3,
      sufficient: true,
    });
    expect(r.actionable.n).toBe(3);
    expect(r.passed.n).toBe(1);
    expect(r.bait.bait.n).toBe(1);
    expect(r.bait.nonBait.n).toBe(3);
  });
});

describe('buildRelationshipLift', () => {
  test('lift only when both sides pass the gate', () => {
    const rows = [
      { hasRelationship: true, outcome: out(200, 4) },
      { hasRelationship: true, outcome: out(400, 6) },
      { hasRelationship: false, outcome: out(100, 2) },
      { hasRelationship: false, outcome: out(100, 2) },
    ];
    const gated = buildRelationshipLift(rows, 3);
    expect(gated.viewsLift).toBeNull();
    expect(gated.withRelationship.n).toBe(2);

    const open = buildRelationshipLift(rows, 2);
    expect(open.viewsLift).toBe(3);
    expect(open.profileVisitsLift).toBe(2.5);
  });
});

describe('buildMeEffectiveness', () => {
  const rows = [
    { hasMe: true, outcome: out(200, 4) },
    { hasMe: true, outcome: out(400, 6) },
    { hasMe: false, outcome: out(100, 2) },
    { hasMe: false, outcome: out(100, 2) },
    { hasMe: false, outcome: null }, // posted, unmeasured
  ];

  test('splits on me present/absent; lift gated on both sides', () => {
    const gated = buildMeEffectiveness(rows, 3);
    expect(gated.withMe.n).toBe(2);
    expect(gated.withoutMe.n).toBe(2);
    expect(gated.viewsLift).toBeNull(); // 2 < 3 per side

    const open = buildMeEffectiveness(rows, 2);
    expect(open.viewsLift).toBe(3); // 300 / 100
    expect(open.profileVisitsLift).toBe(2.5); // 5 / 2
  });

  test('partition invariant: every measured row lands in exactly one cell', () => {
    const r = buildMeEffectiveness(rows, 2);
    expect(r.withMe.n + r.withoutMe.n).toBe(r.totalMeasured);
    expect(r.totalMeasured).toBe(4); // the null row is unmeasured
  });
});

describe('buildMediaEffectiveness', () => {
  const rows = [
    { hasMedia: true, outcome: out(500, 10) },
    { hasMedia: true, outcome: out(300, 6) },
    { hasMedia: false, outcome: out(200, 4) },
    { hasMedia: false, outcome: out(100, 2) },
    { hasMedia: false, outcome: null }, // posted, unmeasured
    { hasMedia: null, outcome: out(999, 99) }, // pre-column, unknown
  ];

  test('buckets media / text-only / unknown separately', () => {
    const r = buildMediaEffectiveness(rows, 2);
    expect(r.media.n).toBe(2);
    expect(r.media.medianViews).toBe(400);
    // text-only counts the unmeasured row in `posted` but not in `n`.
    expect(r.textOnly.posted).toBe(3);
    expect(r.textOnly.n).toBe(2);
    expect(r.textOnly.medianViews).toBe(150);
    // null is its own bucket — never folded into text-only.
    expect(r.unknown.n).toBe(1);
    expect(r.unknown.medianViews).toBe(999);
    expect(r.totalMeasured).toBe(5);
  });

  test('lift only when BOTH media and text-only clear the gate', () => {
    const gated = buildMediaEffectiveness(rows, 3);
    expect(gated.viewsLift).toBeNull();
    expect(gated.media.sufficient).toBe(false);

    const open = buildMediaEffectiveness(rows, 2);
    expect(open.viewsLift).toBe(round(400 / 150));
    expect(open.profileVisitsLift).toBe(round(8 / 3));
  });
});

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

describe('buildIdeaEffectiveness', () => {
  const rows: IdeaRow[] = [
    // seeded posts
    { kind: 'post', seeded: true, outcome: out(600, 12) },
    { kind: 'post', seeded: true, outcome: out(400, 8) },
    // unseeded posts
    { kind: 'post', seeded: false, outcome: out(200, 4) },
    { kind: 'post', seeded: false, outcome: out(100, 2) },
    { kind: 'post', seeded: false, outcome: null }, // posted, unmeasured
    // seeded replies
    { kind: 'reply', seeded: true, outcome: out(3000, 30) },
    // unseeded replies
    { kind: 'reply', seeded: false, outcome: out(1000, 10) },
    { kind: 'reply', seeded: false, outcome: out(2000, 20) },
  ];

  test('pooled headline and per-surface split', () => {
    const r = buildIdeaEffectiveness(rows, 2);
    // pooled: seeded = 600,400,3000 → median 600; unseeded = 200,100,1000,2000
    expect(r.seeded).toMatchObject({ n: 3, medianViews: 600 });
    expect(r.unseeded).toMatchObject({ n: 4, medianViews: median([200, 100, 1000, 2000]) });
    // posts split (unmeasured counted in posted, not n)
    expect(r.posts.seeded).toMatchObject({ n: 2, medianViews: 500 });
    expect(r.posts.unseeded).toMatchObject({ posted: 3, n: 2, medianViews: 150 });
    expect(r.replies.seeded).toMatchObject({ n: 1, medianViews: 3000 });
    expect(r.replies.unseeded).toMatchObject({ n: 2, medianViews: 1500 });
    expect(r.totalSeeded).toBe(3);
    expect(r.totalMeasured).toBe(7);
  });

  test('lift only when BOTH sides clear the gate', () => {
    // posts: 2 seeded, 2 unseeded — clears gate=2, gated at 3.
    const gated = buildIdeaEffectiveness(rows, 3);
    expect(gated.posts.viewsLift).toBeNull();
    expect(gated.posts.seeded.sufficient).toBe(false);

    const open = buildIdeaEffectiveness(rows, 2);
    expect(open.posts.viewsLift).toBe(round(500 / 150));
    expect(open.posts.profileVisitsLift).toBe(round(10 / 3));
    // replies seeded n=1 never clears gate=2 → its own lift stays null.
    expect(open.replies.viewsLift).toBeNull();
  });

  test('default gate is 20 — silent on a thin sample', () => {
    const r = buildIdeaEffectiveness(rows);
    expect(r.viewsLift).toBeNull();
    expect(r.posts.viewsLift).toBeNull();
    expect(r.replies.viewsLift).toBeNull();
  });
});

describe('latencyBucket', () => {
  test('boundaries and unknown', () => {
    expect(latencyBucket(null)).toBe('unknown');
    expect(latencyBucket(-1)).toBe('unknown');
    expect(latencyBucket(Number.NaN)).toBe('unknown');
    expect(latencyBucket(0)).toBe('<15m');
    expect(latencyBucket(14.9)).toBe('<15m');
    expect(latencyBucket(15)).toBe('15-60m');
    expect(latencyBucket(59)).toBe('15-60m');
    expect(latencyBucket(60)).toBe('1-6h');
    expect(latencyBucket(359)).toBe('1-6h');
    expect(latencyBucket(360)).toBe('>6h');
    expect(latencyBucket(5000)).toBe('>6h');
  });
});

describe('resolveAgeMin', () => {
  test('prefers the capture-stamped signal', () => {
    expect(
      resolveAgeMin({
        signals: { ageMin: 7 },
        sourcePostedAt: new Date('2026-07-01T10:00:00Z'),
        draftCreatedAt: new Date('2026-07-01T15:00:00Z'),
      }),
    ).toBe(7);
  });

  test('derives from post→draft gap when no signal', () => {
    expect(
      resolveAgeMin({
        signals: null,
        sourcePostedAt: new Date('2026-07-01T10:00:00Z'),
        draftCreatedAt: new Date('2026-07-01T10:30:00Z'),
      }),
    ).toBe(30);
  });

  test('null when no signal and no source time', () => {
    expect(
      resolveAgeMin({ signals: null, sourcePostedAt: null, draftCreatedAt: new Date() }),
    ).toBeNull();
  });

  test('clamps a negative gap to 0', () => {
    expect(
      resolveAgeMin({
        signals: null,
        sourcePostedAt: new Date('2026-07-01T10:30:00Z'),
        draftCreatedAt: new Date('2026-07-01T10:00:00Z'),
      }),
    ).toBe(0);
  });
});

describe('buildLatencyEffectiveness', () => {
  const rows: LatencyRow[] = [
    { ageMin: 5, outcome: out(500, 10) }, // <15m
    { ageMin: 10, outcome: out(300, 6) }, // <15m
    { ageMin: 30, outcome: out(150, 3) }, // 15-60m (middle — out of headline)
    { ageMin: 120, outcome: out(200, 4) }, // 1-6h → late
    { ageMin: 600, outcome: out(100, 2) }, // >6h → late
    { ageMin: 120, outcome: null }, // late, posted but unmeasured
    { ageMin: null, outcome: out(999, 99) }, // unknown
  ];

  test('cells split by bucket in chronological order', () => {
    const r = buildLatencyEffectiveness(rows, 2);
    expect(r.cells.map((c) => c.bucket)).toEqual(['<15m', '15-60m', '1-6h', '>6h', 'unknown']);
    const early = r.cells.find((c) => c.bucket === '<15m');
    expect(early).toMatchObject({ posted: 2, n: 2, medianViews: 400, sufficient: true });
    // 1-6h counts the unmeasured row in posted but not n.
    const oneToSix = r.cells.find((c) => c.bucket === '1-6h');
    expect(oneToSix).toMatchObject({ posted: 2, n: 1 });
    // unknown is its own bucket, never folded into a real one.
    const unknown = r.cells.find((c) => c.bucket === 'unknown');
    expect(unknown).toMatchObject({ n: 1, medianViews: 999 });
    expect(r.totalMeasured).toBe(6);
  });

  test('early = <15m, late = 1h+ pooled (15-60m excluded from headline)', () => {
    const r = buildLatencyEffectiveness(rows, 2);
    expect(r.early).toMatchObject({ n: 2, medianViews: 400 });
    // late pools 1-6h (200) + >6h (100), one unmeasured dropped from n.
    expect(r.late).toMatchObject({ posted: 3, n: 2, medianViews: 150 });
  });

  test('lift only when BOTH early and late clear the gate', () => {
    const gated = buildLatencyEffectiveness(rows, 3);
    expect(gated.viewsLift).toBeNull();
    expect(gated.early.sufficient).toBe(false);

    const open = buildLatencyEffectiveness(rows, 2);
    expect(open.viewsLift).toBe(round(400 / 150));
    expect(open.profileVisitsLift).toBe(round(8 / 3));
  });

  test('default gate is 20 — silent on a thin sample', () => {
    const r = buildLatencyEffectiveness(rows);
    expect(r.viewsLift).toBeNull();
    expect(r.cells.every((c) => c.sufficient === false)).toBe(true);
  });
});

describe('buildModelEffectiveness', () => {
  const rows: ModelRow[] = [
    { model: 'grok-4.3', outcome: out(500, 10) },
    { model: 'grok-4.3', outcome: out(300, 6) },
    { model: 'grok-4.3', outcome: null }, // posted but unmeasured
    { model: 'anthropic/claude-sonnet-4.5', outcome: out(200, 4) },
  ];

  test('buckets by raw model string, provider slash kept as-is', () => {
    const r = buildModelEffectiveness(rows, 2);
    expect(r.cells.map((c) => c.model)).toContain('anthropic/claude-sonnet-4.5');
    const grok = r.cells.find((c) => c.model === 'grok-4.3');
    // posted counts the unmeasured row; n does not.
    expect(grok).toMatchObject({ posted: 3, n: 2, medianViews: 400, sufficient: true });
  });

  test('most-sampled bucket first', () => {
    const r = buildModelEffectiveness(rows, 2);
    expect(r.cells[0]?.model).toBe('grok-4.3');
  });

  test('partition invariant: Σ bucket n = totalMeasured, Σ posted = rows', () => {
    const r = buildModelEffectiveness(rows, 2);
    expect(r.cells.reduce((s, c) => s + c.n, 0)).toBe(r.totalMeasured);
    expect(r.totalMeasured).toBe(3);
    expect(r.cells.reduce((s, c) => s + c.posted, 0)).toBe(rows.length);
  });

  test('gate: each bucket independently below minN is insufficient', () => {
    const gated = buildModelEffectiveness(rows, 3);
    expect(gated.cells.find((c) => c.model === 'grok-4.3')?.sufficient).toBe(false);
    const open = buildModelEffectiveness(rows, 2);
    expect(open.cells.find((c) => c.model === 'grok-4.3')?.sufficient).toBe(true);
  });

  test('default gate is 20 — silent on a thin sample', () => {
    const r = buildModelEffectiveness(rows);
    expect(r.cells.every((c) => c.sufficient === false)).toBe(true);
  });
});

describe('buildTimelineFunnel (HV.5)', () => {
  const NOW = 1_800_000_000_000;
  const seenRow = (id: string, o: Partial<TimelineSeenRow> = {}): TimelineSeenRow => ({
    tweetId: id,
    views: 5000,
    comments: 3,
    text: 'a plain statement about shipping',
    tweetTimeMs: NOW - 30 * 60_000,
    capturedAtMs: NOW,
    ...o,
  });
  const bandOf = (o: Partial<TimelineSeenRow>): TimelineBand => deriveTimelineBand(seenRow('t', o));

  test('a row without a tweet time is unknown, never the null band', () => {
    expect(bandOf({ tweetTimeMs: null })).toBe('unknown');
    // Same metrics WITH a time classify as a real band — unknown is only ever
    // about the missing timestamp.
    expect(bandOf({})).toBe('hot');
  });

  test('bait text flips a would-be-null row into a band', () => {
    const small = { views: 200, comments: 2, capturedAtMs: NOW, tweetTimeMs: NOW - 60 * 60_000 };
    expect(bandOf({ ...small, text: 'shipped the thing today.' })).toBeNull();
    expect(bandOf({ ...small, text: 'shipped the thing today. am i wrong?' })).toBe('hot');
  });

  test('first sighting bands the tweet; re-sightings never re-band or double-count', () => {
    const r = buildTimelineFunnel(
      [
        // Later re-scroll first in the array on purpose: order must not matter.
        seenRow('a', { views: 300_000, comments: 900, capturedAtMs: NOW + 3 * 3600_000 }),
        seenRow('a'),
      ],
      new Set(),
      1,
    );
    expect(r.totalSeen).toBe(1);
    expect(r.cells).toHaveLength(1);
    expect(r.cells[0]?.band).toBe('hot'); // not 'skip' from the 900-reply re-sighting
    expect(r.cells[0]?.seen).toBe(1);
  });

  test('replied counts distinct seen tweets; ids never seen are not credited', () => {
    const r = buildTimelineFunnel(
      [seenRow('a'), seenRow('a', { capturedAtMs: NOW + 60_000 }), seenRow('b')],
      new Set(['a', 'ghost']),
      1,
    );
    expect(r.totalSeen).toBe(2);
    expect(r.totalReplied).toBe(1);
    expect(r.cells[0]?.replied).toBe(1);
    expect(r.cells[0]?.rate).toBe(0.5);
  });

  test('gate: 19 seen is silent, 20 quotes the capture rate', () => {
    const rows = Array.from({ length: 19 }, (_, i) => seenRow(`t${i}`));
    const thin = buildTimelineFunnel(rows, new Set(['t0']), 20);
    expect(thin.cells[0]?.sufficient).toBe(false);
    expect(thin.cells[0]?.rate).toBeNull();

    const full = buildTimelineFunnel([...rows, seenRow('t19')], new Set(['t0']), 20);
    expect(full.cells[0]?.sufficient).toBe(true);
    expect(full.cells[0]?.rate).toBe(0.05);
  });

  test('cells stay in band order and the gate is per band', () => {
    const r = buildTimelineFunnel(
      [
        seenRow('a'),
        seenRow('b'),
        seenRow('c', { comments: 300 }), // deep thread → skip
        seenRow('d', { tweetTimeMs: null }),
      ],
      new Set(),
      2,
    );
    expect(r.cells.map((c) => c.band)).toEqual(['hot', 'skip', 'unknown']);
    expect(r.cells[0]?.sufficient).toBe(true);
    expect(r.cells[1]?.sufficient).toBe(false);
  });
});

describe('classifyRosterBand', () => {
  const band = { min: 20_000, max: 100_000 }; // my size = 10k → 2–10x

  test('bands against my 2–10x window; nulls and no-band → unknown', () => {
    expect(classifyRosterBand(50_000, band)).toBe('in_band');
    expect(classifyRosterBand(20_000, band)).toBe('in_band'); // inclusive floor
    expect(classifyRosterBand(100_000, band)).toBe('in_band'); // inclusive ceiling
    expect(classifyRosterBand(19_999, band)).toBe('below_band');
    expect(classifyRosterBand(100_001, band)).toBe('above_band');
    expect(classifyRosterBand(null, band)).toBe('unknown');
    expect(classifyRosterBand(Number.NaN, band)).toBe('unknown');
    // No account size → we can't band anyone.
    expect(classifyRosterBand(50_000, null)).toBe('unknown');
  });
});

describe('buildRosterCoverage', () => {
  const band = { min: 20_000, max: 100_000 };

  test('counts + pct over total, verdict over known, gated on known', () => {
    // 3 in-band, 1 above, 1 below, 1 unknown → known = 5.
    const followers = [50_000, 40_000, 30_000, 200_000, 5_000, null];
    const r = buildRosterCoverage(followers, band, 3);
    expect(r.total).toBe(6);
    expect(r.counts).toEqual({ in_band: 3, above_band: 1, below_band: 1, unknown: 1 });
    expect(r.pct.in_band).toBe(50); // 3/6
    expect(r.pct.unknown).toBe(17); // 1/6 → 17
    expect(r.known).toBe(5);
    expect(r.inBandPctOfKnown).toBe(60); // 3/5
    expect(r.sufficient).toBe(true); // known 5 ≥ 3
    expect(r.majorityInBand).toBe(true); // 3/5 > 0.5
    expect(r.band).toEqual(band);
  });

  test('verdict is null under the gate (thin known sample)', () => {
    const r = buildRosterCoverage([50_000, null, null], band, 3);
    expect(r.known).toBe(1);
    expect(r.sufficient).toBe(false);
    expect(r.majorityInBand).toBeNull();
    // The raw breakdown still renders.
    expect(r.pct.in_band).toBe(33);
  });

  test('no account size → everyone unknown, no verdict', () => {
    const r = buildRosterCoverage([50_000, 40_000], null, 1);
    expect(r.counts.unknown).toBe(2);
    expect(r.known).toBe(0);
    expect(r.inBandPctOfKnown).toBeNull();
    expect(r.majorityInBand).toBeNull();
    expect(r.band).toBeNull();
  });

  test('in-band a minority of known → verdict false', () => {
    // 2 in-band, 3 above → known 5, in-band 40% < 50%.
    const r = buildRosterCoverage([50_000, 60_000, 200_000, 300_000, 400_000], band, 3);
    expect(r.inBandPctOfKnown).toBe(40);
    expect(r.majorityInBand).toBe(false);
  });

  test('empty window → zeros and null pct', () => {
    const r = buildRosterCoverage([], band, 20);
    expect(r.total).toBe(0);
    expect(r.pct.in_band).toBeNull();
    expect(r.majorityInBand).toBeNull();
  });

  test('default gate is 20', () => {
    const followers = Array.from({ length: 19 }, () => 50_000);
    expect(buildRosterCoverage(followers, band).sufficient).toBe(false);
    expect(buildRosterCoverage([...followers, 50_000], band).sufficient).toBe(true);
  });
});

describe('topAngles', () => {
  test('silent under the gate', () => {
    const r = buildAngleEffectiveness(
      [{ angle: 'contrarian', authorFollowers: null, outcome: out(100, 5) }],
      20,
    );
    expect(topAngles(r.overall, 20)).toBeNull();
  });

  test('quotes the profile-click multiplier when computable', () => {
    const rows: AngleRow[] = [];
    for (let i = 0; i < 20; i++) {
      rows.push({ angle: 'contrarian', authorFollowers: null, outcome: out(500, 4) });
    }
    for (let i = 0; i < 20; i++) {
      rows.push({ angle: 'extends', authorFollowers: null, outcome: out(200, 2) });
    }
    const r = buildAngleEffectiveness(rows, 20);
    const line = topAngles(r.overall, 20);
    expect(line).toContain("'contrarian'");
    expect(line).toContain('2x');
    expect(line).toContain('n=20');
    expect(line?.startsWith('measured:')).toBe(true);
  });

  test('ignores the null-angle cell even when it is the biggest', () => {
    const rows: AngleRow[] = [];
    for (let i = 0; i < 30; i++) {
      rows.push({ angle: null, authorFollowers: null, outcome: out(9000, 90) });
    }
    for (let i = 0; i < 20; i++) {
      rows.push({ angle: 'debate', authorFollowers: null, outcome: out(100, 1) });
    }
    const line = topAngles(buildAngleEffectiveness(rows, 20).overall, 20);
    expect(line).toContain("'debate'");
  });
});

describe('topStructures', () => {
  test('silent under the gate, speaks when a hook cell passes', () => {
    const rows = [
      { hookType: 'stat hook', device: 'before/after', outcome: out(1200) },
      { hookType: 'stat hook', device: 'direct address', outcome: out(800) },
      { hookType: 'story hook', device: 'before/after', outcome: out(100) },
    ];
    const s = buildStructureEffectiveness(rows, 2);
    expect(topStructures(s, 20)).toBeNull();
    const line = topStructures(s, 2);
    expect(line).toContain("'stat hook'");
    expect(line).toContain('1.0k views');
    expect(line).toContain("'before/after'");
  });
});
