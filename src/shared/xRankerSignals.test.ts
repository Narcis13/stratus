import { describe, expect, test } from 'bun:test';
import { scoreDraft } from './postCoach.ts';
import { POST_FORMATS } from './postFormat.ts';
import { type XHeadName, X_HEADS, scoreHeads } from './xRanker.ts';
import {
  ENGAGEMENT_SHRINKAGE_PSEUDO_VIEWS,
  MIN_VIDEO_DURATION_MS,
  RANKER_BAND_CUTS,
  RANKER_BAND_CUTS_PROVENANCE,
  RANKER_BAND_CUTS_SAMPLE,
  SIGNAL_FREE_SCORE,
  X_BASELINE_P,
  X_BASELINE_P_PROVENANCE,
  X_MODIFIERS,
  X_OBSERVED_RATES,
  X_OBSERVED_RATES_PROVENANCE,
  X_OBSERVED_RATES_SAMPLE,
  positiveFloorRaw,
  rankerDraftBand,
  rankerMeasuredBand,
  resetRankerBaselineCache,
  scoreDraftRanker,
  scoreMeasured,
  signalFreeBaselineRaw,
  signalsToHeadPs,
  vqvEligible,
} from './xRankerSignals.ts';

/** A draft that trips NO modifier: flat opener, no contrast, no anchor, no
 *  first-person proof, nothing quotable, under 30 words, one line, classified
 *  `one_liner`. It is the calibration anchor the whole C scale rests on, and
 *  finding one is harder than it sounds — twelve of the modifiers fire on a
 *  `postCoach` check PASSING, which an ordinary competent post does several
 *  times over. */
const SIGNAL_FREE =
  'The documentation was rewritten over the weekend and reads a little more clearly than before.';

/** Curiosity bait + shouting + tag-spam + hashtags + a canned closer: the four
 *  heads with the largest negative weights, all at once. */
const NET_NEGATIVE =
  "YOU WON'T BELIEVE THIS. STAY TUNED!!! @alpha @beta @gamma #one #two #three thoughts?";

const STRONG =
  'I cut our deploy from 14 minutes to 90 seconds.\n\n' +
  'The fix was not caching. It was that we rebuilt the image on every push instead of only when the lockfile changed.\n\n' +
  'Most teams never look. Check yours.';

describe('the calibration anchor', () => {
  test('a draft with no modifiers scores exactly the signal-free midpoint', () => {
    const r = scoreDraftRanker(SIGNAL_FREE);
    expect(r.modifiers).toEqual([]);
    expect(r.score).toBe(SIGNAL_FREE_SCORE);
    // XR.4: `below`, and that is the re-cut working rather than a regression —
    // 50 is the signal-free reference, and our own published originals run a
    // measured q1 of 56. A draft carrying nothing IS below what we typically
    // ship; under the imported 40/65 it read `typical` and so did 68% of
    // everything else.
    expect(r.band).toBe('below');
    expect(r.netNegative).toBe(false);
    // `normalizeScore` puts the reference on 50 by construction, so this also
    // proves the score is measured against the signal-free baseline and not
    // against some other number that happens to be close.
    expect(r.raw).toBeCloseTo(r.baselineRaw, 12);
  });

  test('the baseline is DERIVED from X_BASELINE_P, never a written-down literal', () => {
    const before = signalFreeBaselineRaw();
    resetRankerBaselineCache();
    expect(signalFreeBaselineRaw()).toBe(before);
    // Rebuilt here from the priors independently of the module's own loop.
    const alwaysOn: XHeadName[] = [
      'favorite',
      'reply',
      'retweet',
      'click',
      'share',
      'share_via_dm',
      'share_via_copy_link',
      'quote',
      'cont_dwell_time',
      'follow_author',
      'not_interested',
      'block_author',
      'mute_author',
      'report',
      'not_dwelled',
    ];
    const headPs: Partial<Record<XHeadName, number>> = {};
    for (const h of alwaysOn) {
      const p = X_BASELINE_P[h];
      if (p !== undefined) headPs[h] = p;
    }
    expect(scoreHeads(headPs).raw).toBeCloseTo(before, 15);
  });

  test('band cut points and their edges, on both scales', () => {
    for (const [band, cuts] of [
      [rankerDraftBand, RANKER_BAND_CUTS.draft],
      [rankerMeasuredBand, RANKER_BAND_CUTS.measured],
    ] as const) {
      expect(band(cuts.strong)).toBe('strong');
      expect(band(cuts.strong - 1)).toBe('typical');
      expect(band(cuts.typical)).toBe('typical');
      expect(band(cuts.typical - 1)).toBe('below');
    }
    // XR.4: the cuts stopped being borrowed. Every ranker constant that is not
    // one of X's published facts now carries the provenance of how we got it.
    expect(RANKER_BAND_CUTS_PROVENANCE).toBe('measured');
    expect(X_OBSERVED_RATES_PROVENANCE).toBe('measured');
    expect(X_BASELINE_P_PROVENANCE).toBe('bangermeter-estimate');
  });

  test('the two scales are cut SEPARATELY, and a score in the gap proves it', () => {
    // The whole reason `rankerBand(score, scale)` does not exist: E's measured
    // distribution sits an order of magnitude tighter around 50 than C's, so
    // one number reads two different bands and nothing but the call site says
    // which is meant. 60 is `typical` as a draft and `strong` as a measurement.
    expect(rankerDraftBand(60)).toBe('typical');
    expect(rankerMeasuredBand(60)).toBe('strong');
    expect(RANKER_BAND_CUTS.draft).not.toEqual(RANKER_BAND_CUTS.measured);
  });

  test('each pair IS its corpus quartiles — the cuts are not free parameters', () => {
    // The rule (not the numbers) is what must not drift: a cut point is the
    // measured q1/q3 of the corpus that scale is applied to, so a band always
    // means a quartile position. A future recalibration moves the sample stamp
    // and the cuts together or it is a vibes edit.
    expect(RANKER_BAND_CUTS.draft.typical).toBe(RANKER_BAND_CUTS_SAMPLE.draft.quartiles.q1);
    expect(RANKER_BAND_CUTS.draft.strong).toBe(RANKER_BAND_CUTS_SAMPLE.draft.quartiles.q3);
    expect(RANKER_BAND_CUTS.measured.typical).toBe(RANKER_BAND_CUTS_SAMPLE.measured.quartiles.q1);
    expect(RANKER_BAND_CUTS.measured.strong).toBe(RANKER_BAND_CUTS_SAMPLE.measured.quartiles.q3);
    for (const stamp of [RANKER_BAND_CUTS_SAMPLE.draft, RANKER_BAND_CUTS_SAMPLE.measured]) {
      expect(stamp.n).toBeGreaterThanOrEqual(100);
      expect(stamp.quartiles.q1).toBeLessThan(stamp.quartiles.median);
      expect(stamp.quartiles.median).toBeLessThan(stamp.quartiles.q3);
    }
  });

  test('the band is read off the ROUNDED score, so pill and word cannot disagree', () => {
    for (const text of [SIGNAL_FREE, NET_NEGATIVE, STRONG]) {
      const r = scoreDraftRanker(text);
      expect(r.band).toBe(rankerDraftBand(r.score));
      expect(Number.isInteger(r.score)).toBe(true);
    }
  });
});

describe('X_MODIFIERS is anchored in OUR vocabulary', () => {
  /** Live oracle rather than a hardcoded list: a non-reply draft runs every
   *  rule, so this set IS `postCoach`'s current check inventory. Renaming a
   *  check breaks this test instead of silently disabling a modifier. */
  const coachIds = new Set(scoreDraft(STRONG).checks.map((c) => c.id));

  test('the oracle really is the full check inventory', () => {
    expect(coachIds.size).toBe(29);
  });

  test('every `from` names a real coach check, a real format, or a real feature', () => {
    const featureFlags = new Set([
      'hasImage',
      'hasVideo',
      'videoSeconds',
      'hasExternalLink',
      'isThreadStarter',
      'isReply',
      'isQuote',
      'isMutualFollow',
      'assumeOutOfNetwork',
    ]);
    for (const mod of X_MODIFIERS) {
      if (mod.from.kind === 'coach') expect(coachIds.has(mod.from.id)).toBe(true);
      else if (mod.from.kind === 'format') expect(POST_FORMATS).toContain(mod.from.format);
      else expect(featureFlags.has(mod.from.flag)).toBe(true);
    }
  });

  test('every head a modifier moves is a real head, and every `why` names a weight', () => {
    for (const mod of X_MODIFIERS) {
      const heads = Object.keys(mod.applies) as XHeadName[];
      expect(heads.length).toBeGreaterThan(0);
      for (const h of heads) expect(X_HEADS[h]).toBeDefined();
      // The rule that keeps a guess from becoming a hunch: the `why` has to
      // cite the published number the factor is exploiting.
      expect(mod.why).toMatch(/-?\d/);
      expect(mod.provenance).toBe('estimate');
    }
  });

  test('ids are unique', () => {
    const ids = X_MODIFIERS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("none of Bangermeter's contentModifiers survives as an entry", () => {
    // Plan Decision 1 / the XR.2 done-when: their table is provenance, never
    // source. Their ten ids, verbatim from `extension/weights.js`.
    const theirs = [
      'question',
      'conversation_length',
      'thread_starter',
      'media_image',
      'has_video',
      'external_link',
      'link_no_context',
      'many_hashtags',
      'engagement_bait',
      'all_caps_shout',
    ];
    const ours = new Set(X_MODIFIERS.map((m) => m.id));
    // `thread_starter` is the one name we share; it is a `DraftFeatures` flag
    // here, not their text heuristic, so the assertion is on the SOURCE.
    for (const id of theirs) {
      if (id === 'thread_starter') continue;
      expect(ours.has(id)).toBe(false);
    }
    const threadMod = X_MODIFIERS.find((m) => m.id === 'thread_starter');
    expect(threadMod?.from).toEqual({ kind: 'feature', flag: 'isThreadStarter' });
  });

  test('each modifier moves the raw score in its declared direction, one at a time', () => {
    // The fixture that isolates a modifier is the HEAD-P MAP, not a sentence:
    // no text trips exactly one coach check, and a text-level test would be
    // measuring the coach's rules rather than this table's arithmetic.
    const base: Partial<Record<XHeadName, number>> = {};
    for (const [head, p] of Object.entries(X_BASELINE_P) as [XHeadName, number][]) {
      base[head] = p;
    }
    const baseRaw = scoreHeads(base).raw;

    for (const mod of X_MODIFIERS) {
      const moved = { ...base };
      for (const [head, factor] of Object.entries(mod.applies) as [XHeadName, number][]) {
        const current = moved[head];
        if (current === undefined) continue;
        moved[head] = current * factor;
      }
      const raw = scoreHeads(moved).raw;
      if (mod.direction === 'up') expect(raw).toBeGreaterThan(baseRaw);
      else expect(raw).toBeLessThan(baseRaw);
    }
  });
});

describe('enable-only heads', () => {
  const coach = scoreDraft(SIGNAL_FREE);
  const heads = (feats: Parameters<typeof scoreDraftRanker>[1]) =>
    new Set(scoreDraftRanker(SIGNAL_FREE, feats, { coach }).contributions.map((c) => c.head));

  test('vqv needs a duration STRICTLY over the published minimum', () => {
    expect(MIN_VIDEO_DURATION_MS).toBe(10_000);
    expect(heads({ hasVideo: true, videoSeconds: 9 }).has('vqv')).toBe(false);
    expect(heads({ hasVideo: true, videoSeconds: 10 }).has('vqv')).toBe(false);
    expect(heads({ hasVideo: true, videoSeconds: 11 }).has('vqv')).toBe(true);
  });

  test('a GIF — video with no duration — earns no vqv', () => {
    expect(vqvEligible({ hasVideo: true, videoSeconds: null })).toBe(false);
    expect(heads({ hasVideo: true, videoSeconds: null }).has('vqv')).toBe(false);
    // The video head itself still fires; it is the quality-view gate that does not.
    expect(heads({ hasVideo: true, videoSeconds: null }).has('video_open')).toBe(true);
  });

  test('vqv is a zeroed head, so the gate documents rather than scores', () => {
    const withVqv = scoreDraftRanker(SIGNAL_FREE, { hasVideo: true, videoSeconds: 11 }, { coach });
    const without = scoreDraftRanker(SIGNAL_FREE, { hasVideo: true, videoSeconds: 9 }, { coach });
    expect(withVqv.raw).toBeCloseTo(without.raw, 15);
    expect(withVqv.contributions.find((c) => c.head === 'vqv')?.contribution).toBe(0);
  });

  test('an absent affordance leaves the head ABSENT, not zero', () => {
    const bare = heads({});
    expect(bare.has('open_link')).toBe(false);
    expect(bare.has('photo_expand')).toBe(false);
    expect(bare.has('quoted_click')).toBe(false);
    expect(heads({ hasExternalLink: true }).has('open_link')).toBe(true);
    expect(heads({ hasImage: true }).has('photo_expand')).toBe(true);
    expect(heads({ isQuote: true }).has('quoted_click')).toBe(true);
  });

  test('video suppresses the photo-expand head', () => {
    expect(heads({ hasImage: true, hasVideo: true }).has('photo_expand')).toBe(false);
  });

  test('a link is a REACH gain, because the ranker pays 0.2 to open one', () => {
    // Invariant #1 is an API BILLING rule about `createPost`; it is not a
    // ranking fact and must never be modelled as one.
    const withLink = scoreDraftRanker(SIGNAL_FREE, { hasExternalLink: true }, { coach });
    const without = scoreDraftRanker(SIGNAL_FREE, {}, { coach });
    expect(withLink.raw).toBeGreaterThan(without.raw);
  });
});

describe('the out-of-network rescore lands exactly once', () => {
  const coach = scoreDraft(SIGNAL_FREE);
  const original = scoreDraftRanker(SIGNAL_FREE, {}, { coach });

  test('a reply takes 0.75 against the same draft scored as an original', () => {
    const reply = scoreDraftRanker(SIGNAL_FREE, { isReply: true }, { coach });
    // On `raw`, not on `score`: the display map is non-linear, so the same
    // 0.75 shows up as 50 -> 43 rather than as a 0.75 score ratio.
    expect(reply.raw / original.raw).toBeCloseTo(0.75, 12);
    expect(reply.rescorers).toHaveLength(1);
  });

  test('a reply seen out-of-network is still 0.75, never 0.5625', () => {
    const both = scoreDraftRanker(
      SIGNAL_FREE,
      { isReply: true, assumeOutOfNetwork: true },
      { coach },
    );
    expect(both.raw / original.raw).toBeCloseTo(0.75, 12);
    expect(both.rescorers).toHaveLength(1);
  });

  test('an in-network original takes no factor at all', () => {
    expect(original.rescorers).toEqual([]);
  });

  test('a mutual-follow original quadruples the reply weight', () => {
    const mutual = scoreDraftRanker(SIGNAL_FREE, { isMutualFollow: true }, { coach });
    expect(mutual.contributions.find((c) => c.head === 'reply')?.weight).toBe(20);
    expect(original.contributions.find((c) => c.head === 'reply')?.weight).toBe(5);
    expect(mutual.raw).toBeGreaterThan(original.raw);
  });
});

describe('the net-negative branch, end to end', () => {
  const bad = scoreDraftRanker(NET_NEGATIVE);

  test('a post whose signals are all negative goes net-negative', () => {
    expect(bad.netNegative).toBe(true);
    expect(bad.combined).toBeLessThan(0);
    expect(bad.modifiers.map((m) => m.id)).toEqual(
      expect.arrayContaining(['curiosity_bait', 'shouting', 'tag_spam', 'canned_closer']),
    );
  });

  test('it is SQUASHED below every positive post, not clamped to zero', () => {
    // The plan asked for "normalizes to 0". It cannot, and asserting it would
    // have encoded a clamp `xRanker.offsetScore` deliberately does not do
    // (trap 3): negatives keep their order relative to each other, so they land
    // in a sliver just under the floor of any positive post rather than on it.
    // The claim worth testing is the ORDERING.
    expect(bad.raw).toBeGreaterThan(0);
    expect(bad.raw).toBeLessThan(positiveFloorRaw());
    expect(bad.score).toBeLessThan(RANKER_BAND_CUTS.draft.typical);
    expect(bad.band).toBe('below');
    for (const text of [SIGNAL_FREE, STRONG]) {
      expect(bad.raw).toBeLessThan(scoreDraftRanker(text).raw);
    }
  });

  test('two net-negative posts keep their order inside the sliver', () => {
    // At the head-map level, because the sliver is NARROW: the text-level test
    // below shows that dropping a single trigger flips this same post back
    // over the floor, so "an even worse sentence" is not a fixture that can be
    // written by piling on words — more words also buy dwell.
    const shallow: Partial<Record<XHeadName, number>> = { favorite: 0.005, not_interested: 0.001 };
    const deep: Partial<Record<XHeadName, number>> = { favorite: 0.005, not_interested: 0.01 };
    const a = scoreHeads(shallow).raw;
    const b = scoreHeads(deep).raw;
    expect(a).toBeLessThan(positiveFloorRaw());
    expect(b).toBeLessThan(a);
    expect(b).toBeGreaterThan(0);
  });

  test('removing ONE negative trigger flips the same post back over the floor', () => {
    // The boundary is real and it is exactly `offsetScore(0)`. Same sentence,
    // sentence case instead of caps: `shouting` stops firing, `not_interested`
    // and `mute_author` lose their 1.5x, and the post lands above every
    // net-negative one.
    const deShouted = scoreDraftRanker(
      "You won't believe this. Stay tuned!!! @alpha @beta @gamma #one #two #three thoughts?",
    );
    expect(bad.modifiers.map((m) => m.id)).toContain('shouting');
    expect(deShouted.modifiers.map((m) => m.id)).not.toContain('shouting');
    expect(deShouted.netNegative).toBe(false);
    expect(deShouted.raw).toBeGreaterThan(positiveFloorRaw());
    expect(bad.raw).toBeLessThan(positiveFloorRaw());
  });
});

describe('C against the coach — two numbers, two questions', () => {
  test('a long post the coach docks is a post the ranker pays for', () => {
    // The clearest place the two pills disagree, and the reason C exists.
    const long =
      'We moved the whole build off the shared runner last month and the thing that finally made it fast was not more cores or a bigger cache but noticing that the image was rebuilt on every single push instead of only when the lockfile actually changed, which is a one line condition.';
    const coach = scoreDraft(long);
    const r = scoreDraftRanker(long, {}, { coach });
    expect(coach.checks.find((c) => c.id === 'word_count')?.status).not.toBe('pass');
    expect(r.modifiers.map((m) => m.id)).toContain('reads_long');
    expect(r.raw).toBeGreaterThan(signalFreeBaselineRaw());
  });

  test('the coach result is passed through, never recomputed behind the caller', () => {
    const coach = scoreDraft(STRONG);
    expect(scoreDraftRanker(STRONG, {}, { coach }).coachScore).toBe(coach.score);
  });

  test('a caller with no coach still works, and threads isReply into it', () => {
    // `hook_opener` and `breathing_room` do not apply to a reply, so the coach
    // run inside must know it is scoring one.
    const asReply = scoreDraftRanker(STRONG, { isReply: true });
    const asPost = scoreDraftRanker(STRONG, {});
    expect(asReply.coachScore).not.toBe(asPost.coachScore);
  });

  test('signalsToHeadPs is usable on its own and reports what it applied', () => {
    const coach = scoreDraft(STRONG);
    const { headPs, applied } = signalsToHeadPs(coach, 'substance', {});
    expect(applied.length).toBeGreaterThan(0);
    expect(headPs.favorite).toBeGreaterThan(0);
    expect(headPs.open_link).toBeUndefined();
  });
});

describe('E — the measured score', () => {
  test('a missing view count is unknown, never a zero-rate post', () => {
    const nul = scoreMeasured({ likes: 5, replies: 1, reposts: 0, views: null });
    expect(nul.available).toBe(false);
    if (!nul.available) expect(nul.reason).toMatch(/unknown, not zero/);
    expect(scoreMeasured({ likes: 5, replies: 1, reposts: 0, views: 0 }).available).toBe(false);
    expect(scoreMeasured({ likes: 5, replies: 1, reposts: 0, views: -3 }).available).toBe(false);
  });

  test('shrinkage: a 1-like/10-view post scores below a 100-like/1000-view post', () => {
    const tiny = scoreMeasured({ likes: 1, replies: 0, reposts: 0, views: 10 });
    // Above the measured median on ALL THREE observable heads. XR.3 re-picked
    // this fixture: it used to carry 5 replies, which was 3.7x above the
    // imported reply reference and is 0.25x below the measured one, so the
    // comparison was silently testing the reply head rather than shrinkage.
    const real = scoreMeasured({ likes: 100, replies: 40, reposts: 3, views: 1000 });
    expect(tiny.available).toBe(true);
    expect(real.available).toBe(true);
    if (!tiny.available || !real.available) return;
    // Raw rate says the tiny post wins 10% to 10%; empirical Bayes says the
    // one with a sample behind it wins.
    expect(tiny.score).toBeLessThan(real.score);
    expect(tiny.lowSample).toBe(true);
    expect(tiny.note).toMatch(/smoothed/);
  });

  test('a post at exactly the measured feed rates reads the midpoint', () => {
    const views = 100_000;
    const at = scoreMeasured({
      likes: Math.round(views * X_OBSERVED_RATES.favorite),
      replies: Math.round(views * X_OBSERVED_RATES.reply),
      reposts: Math.round(views * X_OBSERVED_RATES.retweet),
      views,
    });
    expect(at.available).toBe(true);
    if (!at.available) return;
    expect(at.score).toBe(SIGNAL_FREE_SCORE);
  });

  test('only the three observable heads are scored', () => {
    const r = scoreMeasured({ likes: 10, replies: 2, reposts: 1, views: 5000 });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.contributions.map((c) => c.head).sort()).toEqual(['favorite', 'reply', 'retweet']);
    for (const c of r.contributions) expect(X_HEADS[c.head].observable).toBe(true);
    expect(r.lowSample).toBe(false);
    expect(r.note).toMatch(/23 heads/);
  });

  test('an unmeasured counter is absent, not zero', () => {
    const r = scoreMeasured({ likes: 10, replies: null, reposts: null, views: 5000 });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.contributions.map((c) => c.head)).toEqual(['favorite']);
  });

  test('a mutual-follow post scoring above the baseline is the finding', () => {
    const counts = { likes: 10, replies: 20, reposts: 1, views: 5000 };
    const stranger = scoreMeasured(counts);
    const mutual = scoreMeasured(counts, { isMutualFollow: true });
    expect(stranger.available && mutual.available).toBe(true);
    if (!stranger.available || !mutual.available) return;
    // The baseline is fixed at the BASE reply weight for both, so the mutual's
    // 20.0 shows up as a real gain rather than moving the reference with it.
    expect(mutual.baselineRaw).toBe(stranger.baselineRaw);
    expect(mutual.score).toBeGreaterThan(stranger.score);
  });

  test('the measured score is NOT rescored — the counts already embed it', () => {
    const counts = { likes: 10, replies: 2, reposts: 1, views: 5000 };
    const plain = scoreMeasured(counts);
    const oon = scoreMeasured(counts, { assumeOutOfNetwork: true, isReply: true });
    expect(plain.available && oon.available).toBe(true);
    if (!plain.available || !oon.available) return;
    expect(oon.raw).toBe(plain.raw);
  });

  test('the shrinkage constant is the published pseudo-view count', () => {
    expect(ENGAGEMENT_SHRINKAGE_PSEUDO_VIEWS).toBe(2000);
  });
});

describe('the E reference is ours, and stamped (XR.3)', () => {
  test('provenance is measured or an honestly labeled import — never unvalidated', () => {
    // The refusal rule made enforceable: `scripts/calibrate-ranker.ts` emits
    // constants only above n=100, so claiming 'measured' with a small sample
    // is the one failure this assertion exists to catch.
    expect(['measured', 'imported-pending-calibration']).toContain(X_OBSERVED_RATES_PROVENANCE);
    if (X_OBSERVED_RATES_PROVENANCE === 'measured') {
      expect(X_OBSERVED_RATES_SAMPLE.n).toBeGreaterThanOrEqual(100);
      expect(X_OBSERVED_RATES_SAMPLE.source.length).toBeGreaterThan(0);
      expect(X_OBSERVED_RATES_SAMPLE.collected.length).toBeGreaterThan(0);
      // The stamp has to say what to rerun, not just that something was run.
      expect(X_OBSERVED_RATES_SAMPLE.source).toContain('harvest_rows');
    }
  });

  test('the rates are probabilities, and retweet is legitimately zero', () => {
    // The plan asked for all three in (0, 1). Measured, the retweet median is
    // exactly 0 — 66% of the posts in our feed have no reposts, so zero is the
    // honest central value rather than a missing measurement. The head goes
    // one-sided (at-reference with none, above it with any) and nothing divides
    // by it, so the assertion is [0, 1) with the two observed heads positive.
    for (const rate of Object.values(X_OBSERVED_RATES)) {
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThan(1);
    }
    expect(X_OBSERVED_RATES.favorite).toBeGreaterThan(0);
    expect(X_OBSERVED_RATES.reply).toBeGreaterThan(0);
  });

  test('a zero retweet reference still scores, and rewards a repost', () => {
    // The failure this guards: a zero baseline term making `normalizeScore`
    // divide by zero, or the head silently dropping out of the comparison.
    const none = scoreMeasured({ likes: 30, replies: 20, reposts: 0, views: 1000 });
    const few = scoreMeasured({ likes: 30, replies: 20, reposts: 5, views: 1000 });
    const many = scoreMeasured({ likes: 30, replies: 20, reposts: 60, views: 1000 });
    expect(none.available && few.available && many.available).toBe(true);
    if (!none.available || !few.available || !many.available) return;
    expect(Number.isFinite(none.score)).toBe(true);
    // The head is live and directional in the RAW score at any repost count...
    expect(few.raw).toBeGreaterThan(none.raw);
    expect(many.raw).toBeGreaterThan(few.raw);
    // ...but five reposts do not survive rounding, and sixty do. That is the
    // shrinkage constant flattening the scale on a low-view corpus, not the
    // zero reference: K=2000 against a 1000-view post keeps two thirds of the
    // weight on the reference. Pinned so XR.4's re-cut sees it.
    expect(few.score).toBe(none.score);
    expect(many.score).toBeGreaterThan(none.score);
  });

  test('a below-median reply rate outweighs a large favorite surplus', () => {
    // Exposed by XR.3's measured reference and worth pinning, because it looks
    // wrong at a glance: `real` has 10x the like rate of `tiny` and still loses.
    // Reply carries X's published 5.0 against favorite's 0.5, our measured feed
    // median reply rate is 0.019774 (an engagement-bait timeline), and 5 replies
    // on 1000 views is a quarter of it. Meanwhile shrinkage hands a 10-view post
    // the median on every head for free — which is what `lowSample` is for.
    const tiny = scoreMeasured({ likes: 1, replies: 0, reposts: 0, views: 10 });
    const real = scoreMeasured({ likes: 100, replies: 5, reposts: 3, views: 1000 });
    expect(tiny.available && real.available).toBe(true);
    if (!tiny.available || !real.available) return;
    expect(real.score).toBeLessThan(tiny.score);
    expect(tiny.lowSample).toBe(true);
  });

  test('the two baselines stay two numbers (plan Decision 4)', () => {
    // A measured median is the rate of a typical post INCLUDING whatever
    // signals it carries; using it as the signal-free prior double-counts the
    // average signal. A future "why do we have two of these" cleanup dies here.
    expect(X_BASELINE_P.favorite).not.toBe(X_OBSERVED_RATES.favorite);
    expect(X_BASELINE_P.reply).not.toBe(X_OBSERVED_RATES.reply);
    expect(X_BASELINE_P_PROVENANCE).not.toBe(X_OBSERVED_RATES_PROVENANCE);
  });
});
