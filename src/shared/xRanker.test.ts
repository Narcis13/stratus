import { describe, expect, test } from 'bun:test';
import {
  AUTHOR_DIVERSITY,
  BIDIRECTIONAL_FOLLOW_REPLY_BOOST,
  NEGATIVE_SCORES_OFFSET,
  NEGATIVE_SUM_MEMBERS,
  OON_WEIGHT_FACTOR,
  POSITIVE_SUM_MEMBERS,
  type XHeadName,
  X_HEADS,
  X_WEIGHT_SUMS,
  diversityMultiplier,
  normalizeScore,
  offsetScore,
  oonApplies,
  replyWeightFor,
  scoreHeads,
} from './xRanker.ts';

/** The transcription oracle, written out separately from the module so the two
 *  have to agree. Read on 2026-09-02 off xai-org/x-algorithm @ 7ba77684 —
 *  `home-mixer/params/param.rs`. Order is the `compute_weighted_parts` terms
 *  array; the count IS the claim that there are 26 heads.
 *
 *  The `param` STRING matters as much as the number: two heads share a weight
 *  (0.05 appears three times, 0.0 five times), so a value-only assertion would
 *  pass with two heads swapped. */
const EXPECTED: ReadonlyArray<readonly [XHeadName, number, string]> = [
  ['favorite', 0.5, 'rust_home_mixer_favorite_weight'],
  ['reply', 5.0, 'rust_home_mixer_reply_weight'],
  ['retweet', 1.0, 'rust_home_mixer_retweet_weight'],
  ['photo_expand', 0.05, 'rust_home_mixer_photo_expand_weight'],
  ['video_open', 0.07, 'rust_home_mixer_video_open_weight'],
  ['click', 0.4, 'rust_home_mixer_click_weight'],
  ['open_link', 0.2, 'rust_home_mixer_open_link_weight'],
  ['profile_click', 0.0, 'rust_home_mixer_profile_click_weight'],
  ['vqv', 0.0, 'rust_home_mixer_vqv_weight'],
  ['share', 2.0, 'rust_home_mixer_share_weight'],
  ['share_via_dm', 5.0, 'rust_home_mixer_share_via_dm_weight'],
  ['share_via_copy_link', 20.0, 'rust_home_mixer_share_via_copy_link_weight'],
  ['dwell', 0.05, 'rust_home_mixer_dwell_weight'],
  ['quote', 5.0, 'rust_home_mixer_quote_weight'],
  ['quoted_click', 0.05, 'rust_home_mixer_quoted_click_weight'],
  ['quoted_vqv', 0.0, 'rust_home_mixer_quoted_vqv_weight'],
  ['cont_dwell_time', 0.004, 'rust_home_mixer_cont_dwell_time_weight'],
  ['cont_click_dwell_time', 0.0, 'rust_home_mixer_cont_click_dwell_time_weight'],
  [
    'cont_active_secs_5m_residual_norm',
    0.0,
    'rust_home_mixer_cont_active_secs_5m_residual_norm_weight',
  ],
  ['follow_author', 4.0, 'rust_home_mixer_follow_author_weight'],
  ['not_interested', -43.2, 'rust_home_mixer_not_interested_weight'],
  ['block_author', -31.2, 'rust_home_mixer_block_author_weight'],
  ['mute_author', -58.8, 'rust_home_mixer_mute_author_weight'],
  ['report', -234.0, 'rust_home_mixer_report_weight'],
  ['not_dwelled', -0.02, 'rust_home_mixer_not_dwelled_weight'],
  ['post_unexplored', 0.02, 'rust_home_mixer_post_unexplored_weight'],
];

describe('X_HEADS — the published transcription', () => {
  test('there are exactly 26 heads', () => {
    expect(Object.keys(X_HEADS)).toHaveLength(26);
    expect(EXPECTED).toHaveLength(26);
  });

  test('declaration order is the production scoring order', () => {
    expect(Object.keys(X_HEADS)).toEqual(EXPECTED.map(([name]) => name));
  });

  // One test per head, so a slip names the head it slipped on.
  for (const [name, weight, param] of EXPECTED) {
    test(`${name} = ${weight} (${param})`, () => {
      expect(X_HEADS[name].weight).toBe(weight);
      expect(X_HEADS[name].param).toBe(param);
    });
  }

  test('the five explicitly-zeroed heads are shipped, not omitted', () => {
    const zeroed = EXPECTED.filter(([name]) => X_HEADS[name].weight === 0).map(([name]) => name);
    expect(zeroed).toEqual([
      'profile_click',
      'vqv',
      'quoted_vqv',
      'cont_click_dwell_time',
      'cont_active_secs_5m_residual_norm',
    ]);
    for (const name of zeroed) expect(X_HEADS[name].note).toBeTruthy();
  });

  test('only the three public counters are observable to a DOM harvest', () => {
    const observable = EXPECTED.filter(([name]) => X_HEADS[name].observable).map(([name]) => name);
    expect(observable).toEqual(['favorite', 'reply', 'retweet']);
  });

  test('the continuous heads are exactly the three cont_* heads', () => {
    const continuous = EXPECTED.filter(([name]) => X_HEADS[name].continuous).map(([name]) => name);
    expect(continuous).toEqual([
      'cont_dwell_time',
      'cont_click_dwell_time',
      'cont_active_secs_5m_residual_norm',
    ]);
  });

  test('every param name is unique and upstream-shaped', () => {
    const params = EXPECTED.map(([, , param]) => param);
    expect(new Set(params).size).toBe(26);
    for (const param of params) expect(param.startsWith('rust_home_mixer_')).toBe(true);
  });
});

describe('X_WEIGHT_SUMS — ScoringWeights::from_params', () => {
  test('positive_sum EXCLUDES the cont_* heads and the mutual boost (trap 1)', () => {
    for (const name of [
      'cont_dwell_time',
      'cont_click_dwell_time',
      'cont_active_secs_5m_residual_norm',
    ] as const) {
      expect(POSITIVE_SUM_MEMBERS).not.toContain(name);
      expect(NEGATIVE_SUM_MEMBERS).not.toContain(name);
    }
    // The boost is not a head at all, so it cannot be a member of either sum.
    expect(Object.keys(X_HEADS)).not.toContain('bidirectional_follow_reply_boost');
    expect(POSITIVE_SUM_MEMBERS).toHaveLength(18);
    expect(NEGATIVE_SUM_MEMBERS).toHaveLength(5);
    // 26 heads = 18 positive-sum + 5 negative-sum + the 3 excluded cont_* heads.
    expect(POSITIVE_SUM_MEMBERS.length + NEGATIVE_SUM_MEMBERS.length + 3).toBe(26);
  });

  test('the sums are the hand-computed values', () => {
    expect(X_WEIGHT_SUMS.positive).toBeCloseTo(43.34, 10);
    expect(X_WEIGHT_SUMS.negative).toBeCloseTo(367.22, 10);
    expect(X_WEIGHT_SUMS.total).toBeCloseTo(410.56, 10);
  });

  test('negative_sum is the NEGATED sum of the five penalties, so it is positive', () => {
    const raw = NEGATIVE_SUM_MEMBERS.reduce((acc, name) => acc + X_HEADS[name].weight, 0);
    expect(raw).toBeLessThan(0);
    expect(X_WEIGHT_SUMS.negative).toBeCloseTo(-raw, 10);
    expect(X_WEIGHT_SUMS.total).toBeCloseTo(X_WEIGHT_SUMS.positive + X_WEIGHT_SUMS.negative, 10);
  });

  test('share_via_copy_link is nearly half of positive_sum on its own', () => {
    expect(X_HEADS.share_via_copy_link.weight / X_WEIGHT_SUMS.positive).toBeGreaterThan(0.45);
  });
});

describe('offsetScore', () => {
  test('a positive combined just takes the offset', () => {
    expect(offsetScore(0.4)).toBe(0.401);
    expect(offsetScore(0)).toBe(NEGATIVE_SCORES_OFFSET);
  });

  test('a net-negative combined is SQUASHED below offsetScore(0), never clamped', () => {
    // The supremum of the negative branch, as combined approaches 0 from below.
    const ceiling = (X_WEIGHT_SUMS.negative / X_WEIGHT_SUMS.total) * NEGATIVE_SCORES_OFFSET;
    expect(ceiling).toBeCloseTo(0.000894437, 9);

    for (const combined of [-0.001, -1, -50, -367]) {
      const score = offsetScore(combined);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(ceiling);
      expect(score).toBeLessThan(offsetScore(0));
    }
  });

  test('negative posts keep their order relative to each other', () => {
    expect(offsetScore(-1)).toBeGreaterThan(offsetScore(-50));
    expect(offsetScore(-50)).toBeGreaterThan(offsetScore(-367));
  });

  test('the deepest possible negative lands at exactly zero, and beyond it goes under', () => {
    expect(offsetScore(-X_WEIGHT_SUMS.negative)).toBe(0);
    expect(offsetScore(-X_WEIGHT_SUMS.negative - 1)).toBeLessThan(0);
  });

  test('never NaN', () => {
    for (const combined of [-1000, -1, 0, 1, 1000]) {
      expect(Number.isNaN(offsetScore(combined))).toBe(false);
    }
  });
});

describe('scoreHeads', () => {
  test('a null p omits the head from contributions AND from both sums', () => {
    const withNull = scoreHeads({ favorite: 0.02, reply: null, retweet: 0.01 });
    const without = scoreHeads({ favorite: 0.02, retweet: 0.01 });

    expect(withNull.contributions.map((c) => c.head)).not.toContain('reply');
    expect(withNull.positive).toBe(without.positive);
    expect(withNull.negative).toBe(without.negative);
    expect(withNull.combined).toBe(without.combined);
    expect(withNull.raw).toBe(without.raw);
  });

  test('a zero p is NOT the same as a null p — it is a measured nothing', () => {
    const zero = scoreHeads({ favorite: 0.02, reply: 0 });
    expect(zero.contributions.map((c) => c.head)).toContain('reply');
    expect(zero.contributions).toHaveLength(2);
  });

  test('an absent head is skipped like a null one', () => {
    const result = scoreHeads({ favorite: 0.02 });
    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0]?.head).toBe('favorite');
  });

  test('contributions sort by absolute contribution, descending', () => {
    const result = scoreHeads({
      favorite: 0.05,
      reply: 0.01,
      report: 0.001,
      share_via_copy_link: 0.002,
    });
    const magnitudes = result.contributions.map((c) => Math.abs(c.contribution));
    expect(magnitudes).toEqual([...magnitudes].sort((a, b) => b - a));
    // A 0.1% predicted report outranks a 1% predicted reply (-0.234 vs 0.05).
    // That is what the -234 weight is FOR: report probabilities are ~1000x
    // rarer than likes, so the weight buys the head enough range to matter at
    // all. It is not "one report cancels 468 likes".
    expect(result.contributions[0]?.head).toBe('report');
    expect(result.contributions[0]?.contribution).toBeCloseTo(-0.234, 10);
  });

  test('terms split by the sign of the TERM, not of the weight (trap 2)', () => {
    // A negative probability against a POSITIVE weight belongs in the negative
    // pile. Nothing produces this in normal use; the branch is what is asserted.
    const result = scoreHeads({ favorite: -1 });
    expect(result.positive).toBe(0);
    expect(result.negative).toBe(0.5);
    expect(result.combined).toBe(-0.5);
  });

  test('combined is positive minus negative, and raw is its offsetScore', () => {
    const result = scoreHeads({ favorite: 0.05, report: 0.0001 });
    expect(result.combined).toBeCloseTo(result.positive - result.negative, 12);
    expect(result.raw).toBe(offsetScore(result.combined));
  });

  test('a weights override replaces one head for one call', () => {
    const base = scoreHeads({ reply: 0.01 });
    const boosted = scoreHeads(
      { reply: 0.01 },
      { reply: replyWeightFor({ isMutualFollow: true }) },
    );
    expect(base.contributions[0]?.weight).toBe(5.0);
    expect(boosted.contributions[0]?.weight).toBe(20.0);
    expect(boosted.combined).toBeCloseTo(base.combined * 4, 12);
  });

  test('an all-negative post goes net-negative and normalizes to 0', () => {
    const result = scoreHeads({ not_interested: 0.01, report: 0.001 });
    expect(result.combined).toBeLessThan(0);
    expect(result.raw).toBeGreaterThan(0);
    expect(result.raw).toBeLessThan(offsetScore(0));
    expect(normalizeScore(result.raw, offsetScore(1))).toBeLessThan(1);
  });

  test('an empty input scores the signal-free baseline, not NaN', () => {
    const result = scoreHeads({});
    expect(result.combined).toBe(0);
    expect(result.raw).toBe(NEGATIVE_SCORES_OFFSET);
    expect(result.contributions).toEqual([]);
  });
});

describe('replyWeightFor', () => {
  test('5.0 by default', () => {
    expect(replyWeightFor({})).toBe(5.0);
    expect(replyWeightFor({ isMutualFollow: false })).toBe(5.0);
  });

  test('20.0 only on an ORIGINAL from a mutual follow', () => {
    expect(replyWeightFor({ isMutualFollow: true })).toBe(20.0);
    expect(X_HEADS.reply.weight + BIDIRECTIONAL_FOLLOW_REPLY_BOOST).toBe(20.0);
  });

  test("a mutual's reply and a mutual's repost get the base weight", () => {
    expect(replyWeightFor({ isMutualFollow: true, isReply: true })).toBe(5.0);
    expect(replyWeightFor({ isMutualFollow: true, isRepost: true })).toBe(5.0);
  });
});

describe('oonApplies — a boolean gate, applied once (trap 4)', () => {
  test('out-of-network always applies', () => {
    expect(oonApplies({ inNetwork: false })).toBe(true);
    expect(oonApplies({ inNetwork: false, isReply: true })).toBe(true);
  });

  test('an in-network reply and an in-network repost also take it', () => {
    expect(oonApplies({ inNetwork: true, isReply: true })).toBe(true);
    expect(oonApplies({ inNetwork: true, isRepost: true })).toBe(true);
  });

  test('an in-network original does not', () => {
    expect(oonApplies({ inNetwork: true })).toBe(false);
  });

  test('an UNKNOWN network position does not — the Rust matches None => false', () => {
    expect(oonApplies({})).toBe(false);
    expect(oonApplies({ isReply: true })).toBe(false);
  });

  test('the factor is a published 0.75', () => {
    expect(OON_WEIGHT_FACTOR).toBe(0.75);
  });
});

describe('diversityMultiplier', () => {
  test('the first post from an author keeps its whole score', () => {
    expect(diversityMultiplier(0)).toBe(1);
  });

  test('the published decay: 0.625 then 0.4375', () => {
    expect(diversityMultiplier(1)).toBe(0.625);
    expect(diversityMultiplier(2)).toBe(0.4375);
  });

  test('it approaches the floor rather than reaching zero', () => {
    expect(diversityMultiplier(50)).toBeCloseTo(AUTHOR_DIVERSITY.floor, 12);
    expect(diversityMultiplier(50)).toBeGreaterThan(AUTHOR_DIVERSITY.floor);
    expect(diversityMultiplier(1000)).toBe(AUTHOR_DIVERSITY.floor);
  });

  test('it is monotonically decreasing', () => {
    for (let k = 0; k < 10; k += 1) {
      expect(diversityMultiplier(k + 1)).toBeLessThan(diversityMultiplier(k));
    }
  });
});

describe('normalizeScore', () => {
  test('the baseline lands on exactly 50', () => {
    expect(normalizeScore(0.401, 0.401)).toBe(50);
  });

  test('twice the baseline reads 67, half reads 33', () => {
    expect(normalizeScore(2, 1)).toBeCloseTo(66.667, 3);
    expect(normalizeScore(0.5, 1)).toBeCloseTo(33.333, 3);
  });

  test('it is bounded on (0, 100) — a viral outlier cannot run the scale away', () => {
    expect(normalizeScore(1e9, 1)).toBeLessThan(100);
    expect(normalizeScore(1e9, 1)).toBeGreaterThan(99);
  });

  test('non-positive or non-finite inputs return 0, never NaN', () => {
    for (const [raw, baseline] of [
      [0, 1],
      [-1, 1],
      [1, 0],
      [1, -1],
      [Number.NaN, 1],
      [1, Number.NaN],
    ] as const) {
      expect(normalizeScore(raw, baseline)).toBe(0);
    }
  });

  test('it is monotonic in raw', () => {
    expect(normalizeScore(3, 1)).toBeGreaterThan(normalizeScore(2, 1));
    expect(normalizeScore(2, 1)).toBeGreaterThan(normalizeScore(1, 1));
  });
});

describe('the module is IIFE-safe (§7.26)', () => {
  test('no runtime import can reach the content script', async () => {
    const source = await Bun.file(`${import.meta.dir}/xRanker.ts`).text();
    const imports = source.split('\n').filter((line) => /^\s*import\b/.test(line));
    expect(imports).toEqual([]);
  });
});
