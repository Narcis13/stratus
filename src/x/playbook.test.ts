// Fixture-driven tests for the C4 Playbook aggregations — every stat's
// min-sample gate and the guidance helpers' refusal to speak under it.

import { describe, expect, test } from 'bun:test';
import {
  type AngleRow,
  type MeasuredOutcome,
  type ScoredReply,
  authorSizeBucket,
  buildAngleEffectiveness,
  buildBandCalibration,
  buildBatchVsSingle,
  buildPillarRegisterScorecard,
  buildRelationshipLift,
  buildStructureEffectiveness,
  classifyReplyOrigin,
  median,
  normalizeReplyText,
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
  const draftIds = new Set(['901']);
  const radar = new Map([['777', ['Ship it.\n\nThen fix it.']]]);

  test('draft link wins even when a radar match also exists', () => {
    expect(
      classifyReplyOrigin(
        { tweetId: '901', inReplyToTweetId: '777', text: 'Ship it. Then fix it.' },
        draftIds,
        radar,
      ),
    ).toBe('single');
  });

  test('radar needs target AND collapsed-whitespace text equality', () => {
    expect(
      classifyReplyOrigin(
        { tweetId: '902', inReplyToTweetId: '777', text: 'Ship it.  Then fix it.' },
        draftIds,
        radar,
      ),
    ).toBe('radar');
    expect(
      classifyReplyOrigin(
        { tweetId: '903', inReplyToTweetId: '777', text: 'Something I typed myself' },
        draftIds,
        radar,
      ),
    ).toBeNull();
    expect(
      classifyReplyOrigin(
        { tweetId: '904', inReplyToTweetId: '778', text: 'Ship it. Then fix it.' },
        draftIds,
        radar,
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
      ],
      2,
    );
    expect(r.single).toMatchObject({ n: 2, medianViews: 150, sufficient: true });
    expect(r.radar).toMatchObject({ n: 1, sufficient: false });
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
