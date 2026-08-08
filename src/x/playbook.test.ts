// Fixture-driven tests for the C4 Playbook aggregations — every stat's
// min-sample gate and the guidance helpers' refusal to speak under it.

import { describe, expect, test } from 'bun:test';
import {
  type AngleRow,
  type IdeaRow,
  type JudgeRow,
  type LatencyRow,
  type MeasuredOutcome,
  type ModelRow,
  type OriginalPostRow,
  type OwnReplyRosterEntry,
  type OwnReplyRow,
  type ScoredReply,
  type TimelineBand,
  type TimelineSeenRow,
  authorSizeBucket,
  buildAngleEffectiveness,
  buildBandCalibration,
  buildBatchVsSingle,
  buildCoachScoreEffectiveness,
  buildFormatEffectiveness,
  buildIdeaEffectiveness,
  buildJudgeEffectiveness,
  buildLatencyEffectiveness,
  buildMeEffectiveness,
  buildMediaEffectiveness,
  buildModelEffectiveness,
  buildOwnReplyPerformance,
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
  ownReplyArm,
  ownReplyBand,
  ownReplyCrowdBucket,
  ownReplyLatencyBucket,
  ownReplyMode,
  ownReplyOpening,
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

// SC.5 — the two own-original cells. Texts are chosen so the classifier and the
// coach engine both land somewhere known (verified against the modules, not
// guessed); reword one and the expectations move with it.
const FIXTURE = {
  q1: 'What is the one tool you would not give up?', // question · 93 top · 0 fixes
  q2: 'Which editor do you actually open every day?', // question · 93 top · 0 fixes
  q3: 'Which habit changed your writing the most?', // question · 93 top · 0 fixes
  wyr: 'Would you rather ship fast and break things, or ship slow and sleep well?', // would_you_rather · top
  tiny: 'ship it', // other · 25 rework · 1 fix (too short)
  story:
    'Two years ago I spent 4h/day fixing drafts by hand.\n\nThen I built a checklist.\n\nNow it takes 20 minutes.', // story · 95 top · 0 fixes
  milestone: 'Just crossed 1,000 followers.\n\nTook 14 months and 900 posts.', // milestone · 90 top
  hedge:
    'I think maybe this is sort of possibly the kind of thing that could perhaps matter, in a way, somewhat.', // one_liner · 83 ship · 0 fixes
  long: Array.from({ length: 16 }, (_, i) => `line ${i + 1} of the thing`).join('\n'), // substance · 83 ship · 1 fix (show-more)
};

describe('buildFormatEffectiveness (SC.5)', () => {
  const rows: OriginalPostRow[] = [
    { text: FIXTURE.q1, outcome: out(500, 10) },
    { text: FIXTURE.q2, outcome: out(300, 6) },
    { text: FIXTURE.q3, outcome: null }, // posted, unmeasured
    { text: FIXTURE.wyr, outcome: out(200, 4) },
    { text: FIXTURE.tiny, outcome: out(999, 99) },
  ];

  test('buckets by classified format; posted counts unmeasured rows, n does not', () => {
    const r = buildFormatEffectiveness(rows, 2);
    const q = r.cells.find((c) => c.format === 'question');
    expect(q).toMatchObject({ posted: 3, n: 2, medianViews: 400, sufficient: true });
    expect(q?.medianProfileVisits).toBe(8);
    expect(r.cells.find((c) => c.format === 'would_you_rather')).toMatchObject({ n: 1, posted: 1 });
    expect(r.totalPosted).toBe(5);
    expect(r.totalMeasured).toBe(4);
  });

  test('cells follow POST_FORMATS cascade order and skip formats nobody posted', () => {
    const r = buildFormatEffectiveness(rows, 2);
    expect(r.cells.map((c) => c.format)).toEqual(['would_you_rather', 'question', 'other']);
  });

  test('partition invariant: every original lands in exactly one format cell', () => {
    const r = buildFormatEffectiveness(rows, 2);
    expect(r.cells.reduce((s, c) => s + c.posted, 0)).toBe(rows.length);
    expect(r.cells.reduce((s, c) => s + c.n, 0)).toBe(r.totalMeasured);
  });

  test('gate: each cell independently below minN is insufficient', () => {
    const r = buildFormatEffectiveness(rows, 3);
    expect(r.cells.every((c) => c.sufficient)).toBe(false);
    expect(r.cells.find((c) => c.format === 'question')?.sufficient).toBe(false);
  });

  test('empty corpus is an empty table, not a fabricated row', () => {
    const r = buildFormatEffectiveness([], 2);
    expect(r.cells).toEqual([]);
    expect(r.totalPosted).toBe(0);
  });
});

describe('buildCoachScoreEffectiveness (SC.5)', () => {
  const rows: OriginalPostRow[] = [
    { text: FIXTURE.q1, outcome: out(1000, 20) }, // top, clean
    { text: FIXTURE.story, outcome: out(600, 12) }, // top, clean
    { text: FIXTURE.milestone, outcome: null }, // top, clean, unmeasured
    { text: FIXTURE.hedge, outcome: out(100, 2) }, // ship, clean
    { text: FIXTURE.long, outcome: out(200, 4) }, // ship, FLAGGED (show-more)
    { text: FIXTURE.tiny, outcome: out(50, 1) }, // rework, FLAGGED (too short)
  ];

  test('all four bands always render, worst→best, empty bands included', () => {
    const r = buildCoachScoreEffectiveness(rows, 2);
    expect(r.cells.map((c) => c.band)).toEqual(['rework', 'almost', 'ship', 'top']);
    expect(r.cells.find((c) => c.band === 'almost')).toMatchObject({ posted: 0, n: 0 });
    expect(r.cells.find((c) => c.band === 'top')).toMatchObject({
      posted: 3,
      n: 2,
      medianViews: 800,
    });
  });

  test('the fix-count split is the SAME corpus keyed differently (D152b)', () => {
    const r = buildCoachScoreEffectiveness(rows, 2);
    // A `top`-band post can still carry a fix row — that is exactly why the
    // band alone can't answer "did the advice help".
    expect(r.clean).toMatchObject({ posted: 4, n: 3, medianViews: 600 });
    expect(r.flagged).toMatchObject({ posted: 2, n: 2, medianViews: 125 });
    expect(r.clean.posted + r.flagged.posted).toBe(rows.length);
    expect(r.clean.n + r.flagged.n).toBe(r.totalMeasured);
  });

  test('spread names the two gated bands it actually compared', () => {
    const r = buildCoachScoreEffectiveness(rows, 2);
    expect(r.spreadBands).toEqual({ high: 'top', low: 'ship' });
    expect(r.spread).toBe(round(800 / 150));
    expect(r.profileVisitsSpread).toBe(round(16 / 3));
    expect(r.fixSpread).toBe(round(600 / 125));
    expect(r.fixProfileVisitsSpread).toBe(round(12 / 2.5));
  });

  test('no spread unless TWO distinct bands clear the gate', () => {
    const r = buildCoachScoreEffectiveness(rows, 3);
    expect(r.spread).toBeNull();
    expect(r.spreadBands).toBeNull();
    // clean clears n≥3 but flagged doesn't — both-sides discipline holds.
    expect(r.clean.sufficient).toBe(true);
    expect(r.flagged.sufficient).toBe(false);
    expect(r.fixSpread).toBeNull();
  });

  test('a single gated band is not a spread against itself', () => {
    const r = buildCoachScoreEffectiveness(
      [
        { text: FIXTURE.q1, outcome: out(1000, 20) },
        { text: FIXTURE.story, outcome: out(600, 12) },
      ],
      2,
    );
    expect(r.cells.filter((c) => c.sufficient).map((c) => c.band)).toEqual(['top']);
    expect(r.spread).toBeNull();
  });

  test('partition invariant: every original lands in exactly one band', () => {
    const r = buildCoachScoreEffectiveness(rows, 2);
    expect(r.cells.reduce((s, c) => s + c.posted, 0)).toBe(rows.length);
    expect(r.cells.reduce((s, c) => s + c.n, 0)).toBe(r.totalMeasured);
    expect(r.totalPosted).toBe(6);
    expect(r.totalMeasured).toBe(5);
  });

  test('the lexicon flows into the grading — the cell measures the band the Composer showed', () => {
    // 83 `ship` on the empty default; the specific term flips `concrete_detail`
    // and lands it at 85 `top` — the exact score the Composer graded with.
    const text =
      'Cut the macros first.\n\nMaybe it works, maybe not. It might be enough — it might not.';
    const lexicon = { specificTerms: ['macros'], tribeTerms: [] };
    const row = [{ text, outcome: out(100, 2) }];
    const withoutLex = buildCoachScoreEffectiveness(row, 1);
    const withLex = buildCoachScoreEffectiveness(row, 1, lexicon);
    expect(withoutLex.cells.find((c) => c.band === 'ship')?.posted).toBe(1);
    expect(withLex.cells.find((c) => c.band === 'top')?.posted).toBe(1);
  });
});

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

describe('buildJudgeEffectiveness (JD.7)', () => {
  const rows: JudgeRow[] = [
    { verdictBand: 'post_now', outcome: out(1000, 20) },
    { verdictBand: 'post_now', outcome: out(600, 12) },
    { verdictBand: 'post_now', outcome: null }, // judged, never measured
    { verdictBand: 'slight_rework', outcome: out(300, 6) },
    { verdictBand: 'major_rework', outcome: out(200, 4) },
    { verdictBand: 'major_rework', outcome: out(100, 2) },
    { verdictBand: null, outcome: out(50, 1) }, // never judged
    { verdictBand: null, outcome: out(70, 3) }, // judged then edited — same bucket
  ];

  test('all four bands always render, worst→best, empty bands included', () => {
    const r = buildJudgeEffectiveness(rows, 2);
    expect(r.cells.map((c) => c.band)).toEqual([
      'do_not_post',
      'major_rework',
      'slight_rework',
      'post_now',
    ]);
    expect(r.cells.find((c) => c.band === 'do_not_post')).toMatchObject({ posted: 0, n: 0 });
    expect(r.cells.find((c) => c.band === 'post_now')).toMatchObject({
      posted: 3,
      n: 2,
      medianViews: 800,
    });
  });

  test('unjudged is its own bucket and never folds into a band (§7.11)', () => {
    const r = buildJudgeEffectiveness(rows, 2);
    expect(r.unjudged).toMatchObject({ posted: 2, n: 2, medianViews: 60 });
    // The bands partition the JUDGED rows only — unjudged is the sibling.
    expect(r.cells.reduce((s, c) => s + c.posted, 0)).toBe(6);
    expect(r.cells.reduce((s, c) => s + c.posted, 0) + r.unjudged.posted).toBe(rows.length);
    expect(r.cells.reduce((s, c) => s + c.n, 0) + r.unjudged.n).toBe(r.totalMeasured);
    expect(r.totalPosted).toBe(8);
    expect(r.totalMeasured).toBe(7);
  });

  test('approved/rejected is the SAME judged rows keyed by deriveApproved', () => {
    const r = buildJudgeEffectiveness(rows, 2);
    // post_now + slight_rework = approved; major_rework + do_not_post = not.
    expect(r.approved).toMatchObject({ posted: 4, n: 3, medianViews: 600 });
    expect(r.rejected).toMatchObject({ posted: 2, n: 2, medianViews: 150 });
    expect(r.approved.posted + r.rejected.posted).toBe(6);
    expect(r.approved.n + r.rejected.n).toBe(r.totalMeasured - r.unjudged.n);
    expect(r.approvedSpread).toBe(round(600 / 150));
    expect(r.approvedProfileVisitsSpread).toBe(round(12 / 3));
  });

  test('spread names the two gated bands it actually compared', () => {
    const r = buildJudgeEffectiveness(rows, 2);
    expect(r.spreadBands).toEqual({ high: 'post_now', low: 'major_rework' });
    expect(r.spread).toBe(round(800 / 150));
    expect(r.profileVisitsSpread).toBe(round(16 / 3));
  });

  test('no spread unless TWO distinct bands clear the gate', () => {
    const r = buildJudgeEffectiveness(rows, 3);
    expect(r.spread).toBeNull();
    expect(r.profileVisitsSpread).toBeNull();
    expect(r.spreadBands).toBeNull();
    // approved clears n≥3 but rejected doesn't — both-sides discipline holds.
    expect(r.approved.sufficient).toBe(true);
    expect(r.rejected.sufficient).toBe(false);
    expect(r.approvedSpread).toBeNull();
  });

  test('a single gated band is not a spread against itself', () => {
    const r = buildJudgeEffectiveness(
      [
        { verdictBand: 'post_now', outcome: out(1000, 20) },
        { verdictBand: 'post_now', outcome: out(600, 12) },
      ],
      2,
    );
    expect(r.cells.filter((c) => c.sufficient).map((c) => c.band)).toEqual(['post_now']);
    expect(r.spread).toBeNull();
    expect(r.approvedSpread).toBeNull();
  });

  test('an all-unjudged corpus says nothing rather than zero', () => {
    const r = buildJudgeEffectiveness(
      [
        { verdictBand: null, outcome: out(100, 2) },
        { verdictBand: null, outcome: null },
      ],
      1,
    );
    expect(r.cells.every((c) => c.posted === 0 && !c.sufficient)).toBe(true);
    expect(r.unjudged).toMatchObject({ posted: 2, n: 1 });
    expect(r.spread).toBeNull();
    expect(r.approvedSpread).toBeNull();
    expect(r.totalMeasured).toBe(1);
  });
});

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

describe('own reply performance (growth plan §2.2-§2.4)', () => {
  const NOW = 1_800_000_000_000;
  let seq = 0;
  const reply = (o: Partial<OwnReplyRow> = {}): OwnReplyRow => ({
    tweetId: `r${seq++}`,
    text: 'a reply of mine',
    views: 100,
    likes: 1,
    comments: 0,
    tweetTimeMs: NOW,
    parentHandle: 'someone',
    parentText: 'a plain english post about shipping software',
    parentViews: 5_000,
    parentComments: 5,
    parentTimeMs: NOW - 5 * 60_000,
    ...o,
  });
  const noRoster = new Map<string, OwnReplyRosterEntry>();
  /** A camped handle as the loader hands it over: language for the arm axis,
   *  topic for RC.9's mode pin. */
  const camped = (language: string | null, topic: string | null = null): OwnReplyRosterEntry => ({
    language,
    topic,
  });

  test('parent-view band edges, both sides', () => {
    expect(ownReplyBand(999)).toBe('<1k');
    expect(ownReplyBand(1_000)).toBe('1k-10k');
    expect(ownReplyBand(9_999)).toBe('1k-10k');
    expect(ownReplyBand(10_000)).toBe('10k-50k');
    expect(ownReplyBand(49_999)).toBe('10k-50k');
    expect(ownReplyBand(50_000)).toBe('50k-200k');
    expect(ownReplyBand(199_999)).toBe('50k-200k');
    expect(ownReplyBand(200_000)).toBe('200k+');
    expect(ownReplyBand(0)).toBe('<1k');
    expect(ownReplyBand(null)).toBe('unknown');
  });

  test('latency edges, both sides, and either missing timestamp is unknown', () => {
    const at = (min: number) => ownReplyLatencyBucket(NOW + min * 60_000, NOW);
    expect(at(14)).toBe('<15m');
    expect(at(15)).toBe('15-60m');
    expect(at(59)).toBe('15-60m');
    expect(at(60)).toBe('1-6h');
    expect(at(359)).toBe('1-6h');
    expect(at(360)).toBe('6-24h');
    expect(at(1_439)).toBe('6-24h');
    expect(at(1_440)).toBe('>24h');
    // Relative-time scrape noise, not a reply sent into the past.
    expect(at(-3)).toBe('<15m');
    expect(ownReplyLatencyBucket(null, NOW)).toBe('unknown');
    expect(ownReplyLatencyBucket(NOW, null)).toBe('unknown');
  });

  test('crowding edges, both sides', () => {
    expect(ownReplyCrowdBucket(9)).toBe('<10');
    expect(ownReplyCrowdBucket(10)).toBe('10-50');
    expect(ownReplyCrowdBucket(49)).toBe('10-50');
    expect(ownReplyCrowdBucket(50)).toBe('50-200');
    expect(ownReplyCrowdBucket(199)).toBe('50-200');
    expect(ownReplyCrowdBucket(200)).toBe('200+');
    expect(ownReplyCrowdBucket(0)).toBe('<10');
    expect(ownReplyCrowdBucket(null)).toBe('unknown');
  });

  test('arms: roster language splits A from the English lanes, script splits the rest', () => {
    // Keys normalized, as the builder hands them over.
    const roster = new Map<string, string | null>([
      ['hiiragi2280', 'ja'],
      ['aktweets', null], // cannon_targets stores null for English
    ]);
    expect(ownReplyArm('hiiragi2280', 'こんにちは、いい記事ですね', roster)).toBe('roster-ja');
    // Roster membership wins over the parent's script — the arm is the lane I
    // chose to camp, not the language of one post.
    expect(ownReplyArm('@Hiiragi2280', 'an english aside', roster)).toBe('roster-ja');
    expect(ownReplyArm('aktweets', 'an english post', roster)).toBe('roster-en');
    expect(ownReplyArm('someone_else', '半導体の歴史について', roster)).toBe('off-roster-nonlatin');
    expect(ownReplyArm('someone_else', 'restoring that rubylith mask', roster)).toBe(
      'off-roster-en',
    );
    // No handle = the scrape missed the parent, which is not "off roster".
    expect(ownReplyArm(null, 'restoring that rubylith mask', roster)).toBe('unknown');
    expect(ownReplyArm('  ', 'text', roster)).toBe('unknown');
    expect(ownReplyArm('someone_else', '   ', roster)).toBe('unknown');
    expect(ownReplyArm('someone_else', null, roster)).toBe('unknown');
  });

  test('the builder normalizes raw roster keys once, so @Handle rows still match', () => {
    const r = buildOwnReplyPerformance(
      [reply({ parentHandle: 'Hiiragi2280' }), reply({ parentHandle: '@nobody_camped' })],
      new Map([['@Hiiragi2280 ', camped('Japanese')]]),
      1,
    );
    expect(r.arms.map((c) => c.arm)).toEqual(['roster-ja', 'off-roster-en']);
  });

  test('a null parent lands in unknown on every axis, never in a neighbour', () => {
    const rows = [
      reply({ parentViews: null, parentComments: null, parentTimeMs: null, parentHandle: null }),
    ];
    const r = buildOwnReplyPerformance(rows, noRoster, 1);
    expect(r.bands.map((c) => c.band)).toEqual(['unknown']);
    expect(r.latency.map((c) => c.bucket)).toEqual(['unknown']);
    expect(r.crowding.map((c) => c.bucket)).toEqual(['unknown']);
    expect(r.arms.map((c) => c.arm)).toEqual(['unknown']);
    // An unknown-band cell knows its own yield but has no parent views to average.
    expect(r.bands[0]?.avgYield).toBe(100);
    expect(r.bands[0]?.avgParentViews).toBeNull();
  });

  test('mode: the roster pin outranks detection, and neither answering is unknown', () => {
    const pins = new Map<string, string | null>([['fabrizioromano', 'football']]);
    // The pin wins even though the text detects as `expertise` — a camped handle
    // is the same room for weeks, and an alias resolves to its row.
    expect(ownReplyMode('@FabrizioRomano', 'shipping software and startup code', pins)?.id).toBe(
      'banter',
    );
    expect(ownReplyMode('someone', 'my grandmother passed away this morning', pins)?.id).toBe(
      'wholesome',
    );
    // A pin the table does not recognize falls THROUGH to detection (§7.11),
    // rather than silently drafting in a near neighbour.
    expect(
      ownReplyMode('nonsense', 'arsenal were offside all game lol', new Map([['nonsense', 'zzz']]))
        ?.id,
    ).toBe('banter');
    // Nothing to go on: no pin, and nothing the detector could score.
    expect(ownReplyMode('someone', 'ok', pins)).toBeNull();
    expect(ownReplyMode(null, '   ', pins)).toBeNull();
  });

  test('opening classes, and a non-Latin opener is unknown rather than a class', () => {
    expect(ownReplyOpening('IMO buying flowers once still beats forgetting')).toBe('stance-marker');
    expect(ownReplyOpening("I've tracked this for years")).toBe('i-my');
    expect(ownReplyOpening('While the numbers say otherwise')).toBe('subordinate');
    expect(ownReplyOpening('As someone who has coded 30 years')).toBe('subordinate');
    expect(ownReplyOpening('The reality of shipping daily')).toBe('determiner');
    expect(ownReplyOpening('Postgres does this in 4 lines')).toBe('content-word');
    // Leading punctuation is not the opening word.
    expect(ownReplyOpening('"lol same energy')).toBe('stance-marker');
    // English scanning mechanics cannot read a Japanese opener — unknown, never
    // a guessed class.
    expect(ownReplyOpening('猫のしっぽが好き')).toBe('unknown');
    expect(ownReplyOpening('   ')).toBe('unknown');
  });

  test('contamination counts lane nouns only where the persona is background', () => {
    const wholesome = 'my grandmother passed away this morning';
    const rows = [
      // Two off-lane replies that bridged back to the lane, and one that did not.
      reply({ parentText: wholesome, text: 'still building something out of that', views: 27 }),
      reply({ parentText: wholesome, text: 'AIやマーケティングの継続にも必要', views: 27 }),
      reply({ parentText: wholesome, text: 'the photo on the left', views: 1_000 }),
      // An in-lane parent: `personaUse: 'full'`, so lane nouns are the material
      // and this row is not in the denominator at all.
      reply({ parentText: 'my saas mrr just crossed 4k', text: 'ship it and see', views: 10 }),
    ];
    const r = buildOwnReplyPerformance(rows, noRoster, 1);
    expect(r.modes.map((c) => c.mode)).toEqual(['expertise', 'wholesome']);
    expect(r.contamination).toMatchObject({
      n: 3,
      contaminated: 2,
      pct: 66.67,
      avgYieldContaminated: 27,
      avgYieldClean: 1_000,
      sufficient: true,
    });
  });

  test('contamination: an unresolvable room is out of the denominator, not clean', () => {
    const rows = [
      reply({ parentText: 'ok', parentHandle: 'someone', text: 'building things again' }),
    ];
    const r = buildOwnReplyPerformance(rows, noRoster, 1);
    expect(r.modes.map((c) => c.mode)).toEqual(['unknown']);
    expect(r.contamination).toMatchObject({ n: 0, contaminated: 0, pct: null, sufficient: false });
  });

  test('capture is a mean of per-reply ratios, so one huge parent cannot decide it', () => {
    const rows = [
      reply({ views: 10, parentViews: 100 }), // 1,000 bp
      reply({ views: 100, parentViews: 100_000 }), // 10 bp
    ];
    const r = buildOwnReplyPerformance(rows, noRoster, 1);
    // Ratio of the sums would be 110/100,100 = 11 bp — the confound this column
    // exists to remove.
    expect(r.captureBp).toBe(505);
    // A parent whose views never scraped contributes nothing rather than a zero.
    const unknownParent = buildOwnReplyPerformance([reply({ parentViews: null })], noRoster, 1);
    expect(unknownParent.captureBp).toBeNull();
    expect(unknownParent.bands[0]?.captureBp).toBeNull();
  });

  test('opening × mode: only non-empty pairs, in canonical order, each gated', () => {
    const rows = [
      reply({ parentText: 'my grandmother passed away', text: 'the photo on the left' }),
      reply({ parentText: 'arsenal were offside all game lol', text: 'lol same' }),
    ];
    const r = buildOwnReplyPerformance(rows, noRoster, 2);
    expect(r.openings.map((c) => c.opening)).toEqual(['stance-marker', 'determiner']);
    expect(r.openingsByMode.map((c) => `${c.mode}|${c.opening}`)).toEqual([
      'wholesome|determiner',
      'banter|stance-marker',
    ]);
    // Each crossed cell holds one row, under a gate of two: counts survive, the
    // claims do not.
    for (const c of r.openingsByMode) {
      expect(c.n).toBe(1);
      expect(c.avgYield).toBeNull();
      expect(c.captureBp).toBeNull();
      expect(c.sufficient).toBe(false);
    }
  });

  test('gate: 19 replies report n with null averages, 20 report them', () => {
    const rows = Array.from({ length: 19 }, () => reply({ views: 200, parentViews: 300 }));
    const thin = buildOwnReplyPerformance(rows, noRoster, 20);
    expect(thin.totalMeasured).toBe(19);
    expect(thin.totalViews).toBe(3_800);
    expect(thin.viewsPerReply).toBeNull();
    expect(thin.bands[0]).toMatchObject({
      band: '<1k',
      n: 19,
      totalViews: 3_800,
      avgYield: null,
      avgParentViews: null,
      sharePct: 100,
      sufficient: false,
    });

    const full = buildOwnReplyPerformance(
      [...rows, reply({ views: 200, parentViews: 300 })],
      noRoster,
      20,
    );
    expect(full.viewsPerReply).toBe(200);
    expect(full.bands[0]).toMatchObject({
      n: 20,
      avgYield: 200,
      avgParentViews: 300,
      sufficient: true,
    });
  });

  test('sharePct is computed over ALL views, so it still sums to 100 under the gate', () => {
    const rows = [
      ...Array.from({ length: 20 }, () => reply({ views: 50, parentViews: 500 })),
      ...Array.from({ length: 3 }, () => reply({ views: 1_000, parentViews: 300_000 })),
    ];
    const r = buildOwnReplyPerformance(rows, noRoster, 20);
    const thinCell = r.bands.find((c) => c.band === '200k+');
    expect(thinCell).toMatchObject({ n: 3, totalViews: 3_000, avgYield: null, sufficient: false });
    expect(thinCell?.sharePct).toBe(75);
    expect(r.bands.reduce((s, c) => s + c.sharePct, 0)).toBeCloseTo(100, 1);
  });

  test('the same tweet captured twice counts once, latest capture wins', () => {
    const first = reply({ tweetId: 'dup', views: 40 });
    const later = { ...first, views: 90 };
    const r = buildOwnReplyPerformance([first, later], noRoster, 1);
    expect(r.totalMeasured).toBe(1);
    expect(r.totalViews).toBe(90);
    expect(r.viewsPerReply).toBe(90);
  });

  test('empty input returns the empty shape', () => {
    const r = buildOwnReplyPerformance([], noRoster);
    expect(r).toEqual({
      totalMeasured: 0,
      totalViews: 0,
      viewsPerReply: null,
      captureBp: null,
      bands: [],
      latency: [],
      crowding: [],
      arms: [],
      modes: [],
      openings: [],
      openingsByMode: [],
      contamination: {
        n: 0,
        contaminated: 0,
        pct: null,
        avgYieldContaminated: null,
        avgYieldClean: null,
        sufficient: false,
      },
    });
  });

  test('the §2.2 reference corpus reproduces its published table', () => {
    // The 1,000-reply @thespacerr harvest, band by band: n, total views and the
    // parent-view band they sit in. Rows are synthesized to the published totals
    // so the builder's arithmetic is checked against numbers computed elsewhere.
    const corpus = [
      { band: '<1k', n: 774, total: 47_141, parentViews: 500, avgYield: 61, sharePct: 9.9 },
      { band: '1k-10k', n: 63, total: 17_166, parentViews: 5_000, avgYield: 272, sharePct: 3.6 },
      { band: '10k-50k', n: 54, total: 31_327, parentViews: 20_000, avgYield: 580, sharePct: 6.6 },
      {
        band: '50k-200k',
        n: 58,
        total: 110_610,
        parentViews: 100_000,
        avgYield: 1_907,
        sharePct: 23.2,
      },
      {
        band: '200k+',
        n: 51,
        total: 269_803,
        parentViews: 300_000,
        avgYield: 5_290,
        sharePct: 56.7,
      },
    ] as const;

    const rows: OwnReplyRow[] = [];
    for (const c of corpus) {
      const base = Math.floor(c.total / c.n);
      for (let i = 0; i < c.n; i++) {
        rows.push(
          reply({
            views: i === 0 ? c.total - base * (c.n - 1) : base,
            parentViews: c.parentViews,
          }),
        );
      }
    }

    const r = buildOwnReplyPerformance(rows, noRoster);
    expect(r.totalMeasured).toBe(1_000);
    expect(r.totalViews).toBe(476_047);
    expect(r.viewsPerReply).toBe(476.05);
    expect(r.bands.map((c) => c.band)).toEqual(['<1k', '1k-10k', '10k-50k', '50k-200k', '200k+']);
    for (const expected of corpus) {
      const cell = r.bands.find((c) => c.band === expected.band);
      expect(cell?.n).toBe(expected.n);
      expect(cell?.totalViews).toBe(expected.total);
      expect(cell?.sufficient).toBe(true);
      expect(Math.round(cell?.avgYield ?? 0)).toBe(expected.avgYield);
      expect(cell?.avgParentViews).toBe(expected.parentViews);
      expect(Math.round((cell?.sharePct ?? 0) * 10) / 10).toBe(expected.sharePct);
    }
    // 10.9% of the replies carrying 79.9% of the impressions — the finding.
    const top = r.bands.filter((c) => c.band === '50k-200k' || c.band === '200k+');
    expect(top.reduce((s, c) => s + c.n, 0)).toBe(109);
    expect(top.reduce((s, c) => s + c.sharePct, 0)).toBeCloseTo(79.9, 1);
  });
});
