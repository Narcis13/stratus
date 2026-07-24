// UI.1 registry: the type/range/enum/numberArray validation matrix + grouping.
// Pure — no DB. The route wiring (store round-trip) is covered in
// ../routes/settings.test.ts.

import { describe, expect, test } from 'bun:test';
import { BAND } from '../../shared/replyBand.ts';
import {
  SETTINGS_REGISTRY,
  type SettingDef,
  settingsByGroup,
  settingsRegistry,
  validateSettingValue,
} from './registry.ts';

type BandKey = keyof typeof BAND;

function def(over: Partial<SettingDef>): SettingDef {
  return {
    key: 'x.test.k',
    group: 'test',
    label: 'K',
    description: '',
    type: 'number',
    default: 0,
    scope: 'server',
    ...over,
  };
}

describe('validateSettingValue', () => {
  test('number: type + range', () => {
    const d = def({ type: 'number', min: 1, max: 100 });
    expect(validateSettingValue(d, 10)).toBeNull();
    expect(validateSettingValue(d, 1)).toBeNull();
    expect(validateSettingValue(d, 100)).toBeNull();
    expect(validateSettingValue(d, 0)).toBe('out_of_range');
    expect(validateSettingValue(d, 101)).toBe('out_of_range');
    expect(validateSettingValue(d, '10')).toBe('not_a_number');
    expect(validateSettingValue(d, Number.NaN)).toBe('not_a_number');
    expect(validateSettingValue(d, Number.POSITIVE_INFINITY)).toBe('not_a_number');
  });

  test('boolean', () => {
    const d = def({ type: 'boolean', default: false });
    expect(validateSettingValue(d, true)).toBeNull();
    expect(validateSettingValue(d, false)).toBeNull();
    expect(validateSettingValue(d, 'true')).toBe('not_a_boolean');
    expect(validateSettingValue(d, 1)).toBe('not_a_boolean');
  });

  test('string', () => {
    const d = def({ type: 'string', default: '' });
    expect(validateSettingValue(d, 'anything')).toBeNull();
    expect(validateSettingValue(d, 5)).toBe('not_a_string');
  });

  test('enum', () => {
    const d = def({ type: 'enum', default: 'low', options: ['none', 'low', 'high'] });
    expect(validateSettingValue(d, 'low')).toBeNull();
    expect(validateSettingValue(d, 'high')).toBeNull();
    expect(validateSettingValue(d, 'medium')).toBe('not_in_options');
    expect(validateSettingValue(d, 3)).toBe('not_a_string');
  });

  test('numberArray: entries, range, item count, sorted-unique', () => {
    const d = def({
      type: 'numberArray',
      default: [9, 13, 18],
      min: 0,
      max: 23,
      minItems: 1,
      maxItems: 8,
      sortedUnique: true,
    });
    expect(validateSettingValue(d, [8, 14, 19])).toBeNull();
    expect(validateSettingValue(d, [0])).toBeNull();
    expect(validateSettingValue(d, 5)).toBe('not_an_array');
    expect(validateSettingValue(d, [])).toBe('array_length');
    expect(validateSettingValue(d, [1, 2, 3, 4, 5, 6, 7, 8, 9])).toBe('array_length');
    expect(validateSettingValue(d, [1, '2'])).toBe('not_a_number');
    expect(validateSettingValue(d, [5, 24])).toBe('out_of_range');
    expect(validateSettingValue(d, [-1, 5])).toBe('out_of_range');
    expect(validateSettingValue(d, [18, 9])).toBe('not_sorted_unique');
    expect(validateSettingValue(d, [9, 9])).toBe('not_sorted_unique');
  });

  test('numberArray without sortedUnique allows any order', () => {
    const d = def({ type: 'numberArray', default: [], min: 0, max: 100 });
    expect(validateSettingValue(d, [5, 3, 3])).toBeNull();
  });
});

describe('registry adapter + grouping', () => {
  test('unknown key → undefined / unknown_setting', () => {
    expect(settingsRegistry.get('x.nope.key')).toBeUndefined();
    expect(settingsRegistry.validate('x.nope.key', 1)).toBe('unknown_setting');
  });

  test('known key validates through its def', () => {
    expect(settingsRegistry.validate('x.doctrine.ladderSwitchAt', 4)).toBeNull();
    expect(settingsRegistry.validate('x.doctrine.ladderSwitchAt', 1)).toBe('out_of_range');
    // anchors are mirrored to the extension; the quest knobs are server-only.
    expect(settingsRegistry.get('x.doctrine.anchors3')?.scope).toBe('mirrored');
    expect(settingsRegistry.get('x.quests.originalsTarget')?.scope).toBe('server');
  });

  // D2/D30c: the reply band (min/max), week-reply-% and 2–10x multipliers are
  // owned by the active niche, NOT the settings store — UI.2 dropped those keys.
  test('the niche-owned doctrine band keys are absent from the registry', () => {
    for (const gone of [
      'x.doctrine.replyTargetMin',
      'x.doctrine.replyTargetMax',
      'x.doctrine.weekReplyTargetPct',
    ]) {
      expect(settingsRegistry.get(gone)).toBeUndefined();
    }
  });

  test('settingsByGroup returns every group in GROUP_LABELS order, each labelled', () => {
    const groups = settingsByGroup();
    expect(groups.map((g) => g.id)).toEqual([
      'doctrine',
      'quests',
      'people',
      'followups',
      'pinned',
      'digest',
      'band',
      'gates',
      'radar',
      'workers',
      'budgets',
      'ai',
      'mentions',
      'display',
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      'Doctrine',
      'Quests',
      'People',
      'Follow-ups',
      'Pinned watch',
      'Digest',
      'Reply band',
      'Stat gates',
      'Radar',
      'Workers',
      'Budgets',
      'AI calls',
      'Mentions',
      'Display',
    ]);

    const doctrine = groups.find((g) => g.id === 'doctrine');
    const dkeys = doctrine?.defs.map((d) => d.key) ?? [];
    // Only the cadence ladder survives in the doctrine group.
    expect(dkeys).toEqual([
      'x.doctrine.anchors3',
      'x.doctrine.anchors4',
      'x.doctrine.ladderSwitchAt',
    ]);

    const quests = groups.find((g) => g.id === 'quests');
    expect(quests?.defs.map((d) => d.key)).toContain('x.quests.originalsTarget');
    const display = groups.find((g) => g.id === 'display');
    expect(display?.defs.map((d) => d.key)).toContain('x.display.sparklineDays');

    // Every def belongs to exactly one group (no orphans).
    const grouped = groups.reduce((n, g) => n + g.defs.length, 0);
    expect(grouped).toBe(SETTINGS_REGISTRY.length);
  });

  test('UI.3 groups carry their knobs; the niche-owned band multipliers stay out', () => {
    const groups = settingsByGroup();
    const keysOf = (id: string) => groups.find((g) => g.id === id)?.defs.map((d) => d.key) ?? [];

    expect(keysOf('people')).toEqual([
      'x.people.mutualExchangeDays',
      'x.people.allyExchangeDays',
      'x.people.allyWindowDays',
    ]);
    expect(keysOf('followups')).toEqual([
      'x.followups.chainLiveMaxAgeH',
      'x.followups.dmReadyWindowDays',
      'x.followups.neglectedTargetDays',
      'x.followups.neglectedAllyDays',
      'x.followups.momentumWeeklyPct',
      'x.followups.reupMinAgeDays',
      'x.followups.reupMaxAgeDays',
      'x.followups.fanUnacknowledgedDays',
    ]);
    expect(keysOf('pinned')).toEqual(['x.pinned.staleDays', 'x.pinned.outperformRatio']);
    expect(keysOf('digest')).toEqual(['x.digest.neglectedCap']);

    // The 2–10x target-band multipliers are niche doctrine (loadDoctrine), never
    // settings keys — the D2/D30c single-owner call, same as the reply band.
    const allKeys = SETTINGS_REGISTRY.map((d) => d.key);
    expect(allKeys).not.toContain('x.people.targetBandMinX');
    expect(allKeys).not.toContain('x.people.targetBandMaxX');
  });

  test('UI.4 groups carry the gate / radar / worker knobs', () => {
    const groups = settingsByGroup();
    const keysOf = (id: string) => groups.find((g) => g.id === id)?.defs.map((d) => d.key) ?? [];

    expect(keysOf('gates')).toEqual(['x.gates.minCellN', 'x.gates.bestTimeMinN']);
    expect(keysOf('radar')).toEqual(['x.radar.draftTtlH']);
    expect(keysOf('workers')).toEqual([
      'x.workers.dailyMetricsHourUtc',
      'x.workers.publisherIntervalSec',
      'x.workers.winnerRereadMinViews',
      'x.workers.winnerRereadCap',
    ]);

    // The best-time gate is mirrored — the composer chips gate client-side on
    // the same number (UI.6 ships the mirror); everything else here is server-only.
    expect(settingsRegistry.get('x.gates.bestTimeMinN')?.scope).toBe('mirrored');
    expect(settingsRegistry.get('x.gates.minCellN')?.scope).toBe('server');
  });

  test('UI.5 groups carry the money + AI-param knobs', () => {
    const groups = settingsByGroup();
    const keysOf = (id: string) => groups.find((g) => g.id === id)?.defs.map((d) => d.key) ?? [];

    expect(keysOf('budgets')).toEqual(['x.budgets.xSoftDailyUsd', 'x.budgets.imageDailyUsd']);
    expect(keysOf('ai')).toEqual([
      'x.ai.replyMaxOutputTokens',
      'x.ai.replyTemperature',
      'x.ai.replyReasoningEffort',
      'x.ai.drafterMaxOutputTokens',
      'x.ai.digestMaxOutputTokens',
      'x.ai.batchReplyCap',
    ]);
    expect(keysOf('mentions')).toEqual([
      'x.mentions.serverRefreshCap',
      'x.mentions.panelRefreshCap',
      'x.mentions.pullMax',
    ]);

    // Only the panel's own budget is mirrored — the server cap is the real
    // limit and stays server-side (UI.6 wires the panel to the mirrored one).
    expect(settingsRegistry.get('x.mentions.panelRefreshCap')?.scope).toBe('mirrored');
    expect(settingsRegistry.get('x.mentions.serverRefreshCap')?.scope).toBe('server');
    // Money knobs bind the next call, never a restart — every one of them is
    // read inside the refuse-before-spend ladder.
    const byKey = new Map(SETTINGS_REGISTRY.map((d) => [d.key, d]));
    for (const k of ['x.budgets.xSoftDailyUsd', 'x.budgets.imageDailyUsd', 'x.ai.batchReplyCap']) {
      expect([k, byKey.get(k)?.appliesOn]).toEqual([k, undefined]);
    }
  });

  test('validation honors UI.5 ceilings (money caps + the first enum knob)', () => {
    // Decision 5: the ceilings ARE the guard — an agent with x_update_setting
    // hits the same wall as the UI.
    expect(settingsRegistry.validate('x.budgets.imageDailyUsd', 2)).toBeNull();
    expect(settingsRegistry.validate('x.budgets.imageDailyUsd', 2.01)).toBe('out_of_range');
    // 0 is legal here (it disables image generation) but NOT for the soft X
    // budget, whose floor keeps the watchdog meaningful.
    expect(settingsRegistry.validate('x.budgets.imageDailyUsd', 0)).toBeNull();
    expect(settingsRegistry.validate('x.budgets.xSoftDailyUsd', 0)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.budgets.xSoftDailyUsd', 1)).toBeNull();
    expect(settingsRegistry.validate('x.budgets.xSoftDailyUsd', 1.01)).toBe('out_of_range');

    // Reply token floor: below the measured three-variant need a tuned cap
    // would buy a truncated draft, so the floor is the money guard.
    expect(settingsRegistry.validate('x.ai.replyMaxOutputTokens', 300)).toBeNull();
    expect(settingsRegistry.validate('x.ai.replyMaxOutputTokens', 299)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.ai.replyTemperature', 1.5)).toBeNull();
    expect(settingsRegistry.validate('x.ai.replyTemperature', 1.6)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.ai.batchReplyCap', 50)).toBeNull();
    expect(settingsRegistry.validate('x.ai.batchReplyCap', 51)).toBe('out_of_range');

    // First enum knob in the registry.
    expect(settingsRegistry.validate('x.ai.replyReasoningEffort', 'high')).toBeNull();
    expect(settingsRegistry.validate('x.ai.replyReasoningEffort', 'ludicrous')).toBe(
      'not_in_options',
    );
    expect(settingsRegistry.validate('x.ai.replyReasoningEffort', 2)).toBe('not_a_string');

    // Mentions: invariant #5 — pullMax is the per-request page size, ceiling 100.
    expect(settingsRegistry.validate('x.mentions.pullMax', 100)).toBeNull();
    expect(settingsRegistry.validate('x.mentions.pullMax', 101)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.mentions.pullMax', 9)).toBe('out_of_range');
    // 0 refreshes = refuse every manual pull; 13 is past the money ceiling.
    expect(settingsRegistry.validate('x.mentions.serverRefreshCap', 0)).toBeNull();
    expect(settingsRegistry.validate('x.mentions.serverRefreshCap', 13)).toBe('out_of_range');
  });

  test('only the worker CADENCE knobs are restart-scoped (decision 10)', () => {
    const restart = SETTINGS_REGISTRY.filter((d) => d.appliesOn === 'restart').map((d) => d.key);
    expect(restart).toEqual(['x.workers.dailyMetricsHourUtc', 'x.workers.publisherIntervalSec']);
    // The winner re-read bounds are read at the start of each daily pass, so a
    // change lands on the next 03:00 run without a restart.
    const byKey = new Map(SETTINGS_REGISTRY.map((d) => [d.key, d]));
    expect(byKey.get('x.workers.winnerRereadCap')?.appliesOn).toBeUndefined();
  });

  test('validation honors UI.4 ranges (gate floors, TTL, worker bounds)', () => {
    expect(settingsRegistry.validate('x.gates.minCellN', 5)).toBeNull();
    expect(settingsRegistry.validate('x.gates.minCellN', 4)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.gates.minCellN', 101)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.gates.bestTimeMinN', 1)).toBeNull();
    expect(settingsRegistry.validate('x.gates.bestTimeMinN', 0)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.radar.draftTtlH', 168)).toBeNull();
    expect(settingsRegistry.validate('x.radar.draftTtlH', 169)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.workers.dailyMetricsHourUtc', 23)).toBeNull();
    expect(settingsRegistry.validate('x.workers.dailyMetricsHourUtc', 24)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.workers.publisherIntervalSec', 29)).toBe('out_of_range');
    // 0 is a legal cap — it disables the re-read; 11 is past the money ceiling.
    expect(settingsRegistry.validate('x.workers.winnerRereadCap', 0)).toBeNull();
    expect(settingsRegistry.validate('x.workers.winnerRereadCap', 11)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.workers.winnerRereadMinViews', 99)).toBe('out_of_range');
  });

  // The env default must itself be inside the knob's range — an env typo can
  // never hand the store a default its own validator would reject.
  test('every registry default validates against its own def', () => {
    for (const d of SETTINGS_REGISTRY) {
      expect([d.key, validateSettingValue(d, d.default)]).toEqual([d.key, null]);
    }
  });

  // The mirrored set is the extension's whole wire contract (UI.6): the
  // background ships exactly these keys and `extension/src/shared/
  // serverSettings.ts` holds the matching baked fallback for each. Asserting the
  // exact list means a new mirrored key can't be added without also giving the
  // panel/page something to fall back to — otherwise the knob silently does
  // nothing on the client side.
  test('the mirrored scope is exactly the keys the extension mirrors', () => {
    const mirrored = SETTINGS_REGISTRY.filter((d) => d.scope === 'mirrored').map((d) => d.key);
    expect(mirrored).toEqual([
      'x.doctrine.anchors3',
      'x.doctrine.anchors4',
      'x.doctrine.ladderSwitchAt',
      'x.followups.neglectedTargetDays',
      'x.band.bigViews',
      'x.band.baitViews',
      'x.band.earlyReplies',
      'x.band.midReplies',
      'x.band.freshMin',
      'x.band.risingVPM',
      'x.band.baitVPM',
      'x.band.watchVPM',
      'x.band.watchReplyCeiling',
      'x.band.tooSmallAgeMin',
      'x.band.tooSmallViews',
      'x.band.tooSmallVpm',
      'x.gates.bestTimeMinN',
      'x.ai.batchReplyCap',
      'x.mentions.panelRefreshCap',
      'x.display.doNextCap',
      'x.display.doNextSnoozeH',
      'x.display.fansAmberTopN',
      'x.display.radarDraftCap',
    ]);
    // The server's own refresh cap is the real limit and stays server-side —
    // the panel budget degrading to its baked value must never widen it.
    expect(mirrored).not.toContain('x.mentions.serverRefreshCap');
  });

  // UI.7: the band group must be the WHOLE BandThresholds shape, not a subset.
  // A threshold with no key is a number only a rebuild can change, sitting
  // beside eleven that a PATCH moves — and half a rule (the three dead-zone
  // knobs) reads as an oversight rather than a decision.
  test('the band group is exactly the classifier shape, every key mirrored', () => {
    const band = settingsByGroup().find((g) => g.id === 'band');
    const suffixes = (band?.defs ?? []).map((d) => d.key.replace('x.band.', ''));
    expect(suffixes.slice().sort()).toEqual(Object.keys(BAND).slice().sort());
    // The badge and the /x/replies/generate gate must classify with the same
    // numbers, so no band knob may be server-only.
    expect((band?.defs ?? []).every((d) => d.scope === 'mirrored')).toBe(true);
    // And the shipped defaults ARE the classifier's own — the registry is not a
    // second calibration.
    for (const d of band?.defs ?? []) {
      expect([d.key, d.default]).toEqual([d.key, BAND[d.key.replace('x.band.', '') as BandKey]]);
    }
  });

  test('validation honors UI.7 band ranges (calibration, never a lock)', () => {
    expect(settingsRegistry.validate('x.band.bigViews', 50)).toBeNull();
    expect(settingsRegistry.validate('x.band.bigViews', 49)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.band.bigViews', 5001)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.band.midReplies', 4)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.band.freshMin', 241)).toBe('out_of_range');
    // The two dead-zone knobs a user may legitimately want to switch OFF bottom
    // out at 0 (nothing has fewer than 0 views, or under 0 views/min).
    expect(settingsRegistry.validate('x.band.tooSmallViews', 0)).toBeNull();
    expect(settingsRegistry.validate('x.band.tooSmallVpm', 0)).toBeNull();
    // §7.19 lives in the copy, not in a lock — every knob says so.
    for (const d of SETTINGS_REGISTRY.filter((x) => x.group === 'band')) {
      expect([d.key, d.description.includes('>=100 measured replies')]).toEqual([d.key, true]);
    }
  });

  // UI.12: the Today tab's own presentation caps. They are the first knobs whose
  // ONLY consumer is the side panel, so `mirrored` is not an optimization here —
  // a server-scoped one would never reach the code that reads it.
  test('UI.12 display knobs are panel-read, mirrored, and bounded', () => {
    const groups = settingsByGroup();
    expect(groups.find((g) => g.id === 'display')?.defs.map((d) => d.key)).toEqual([
      'x.display.sparklineDays',
      'x.display.leaderCount',
      'x.display.doNextCap',
      'x.display.doNextSnoozeH',
      'x.display.fansAmberTopN',
      'x.display.radarDraftCap',
    ]);

    const byKey = new Map(SETTINGS_REGISTRY.map((d) => [d.key, d]));
    for (const k of [
      'x.display.doNextCap',
      'x.display.doNextSnoozeH',
      'x.display.fansAmberTopN',
      'x.display.radarDraftCap',
    ]) {
      expect([k, byKey.get(k)?.scope]).toEqual([k, 'mirrored']);
      // Presentation caps bind the next render — nothing here arms a timer.
      expect([k, byKey.get(k)?.appliesOn]).toEqual([k, undefined]);
    }
    // The two brief-read display knobs stay server-side: the panel gets those
    // numbers already applied, inside the brief payload.
    expect(byKey.get('x.display.sparklineDays')?.scope).toBe('server');
    expect(byKey.get('x.display.leaderCount')?.scope).toBe('server');

    // The roster tint and the follow-up queue read ONE key, and the Radar's
    // batch size and the cap the server enforces travel together — both are the
    // reason these two flipped to mirrored rather than growing panel twins.
    expect(byKey.get('x.followups.neglectedTargetDays')?.scope).toBe('mirrored');
    expect(byKey.get('x.ai.batchReplyCap')?.scope).toBe('mirrored');
    // …and the quests group keeps its own same-named knob (a different question:
    // how many neglected targets today's quest asks for), still server-only.
    expect(byKey.get('x.quests.neglectedTargetDays')?.scope).toBe('server');

    expect(settingsRegistry.validate('x.display.doNextCap', 15)).toBeNull();
    expect(settingsRegistry.validate('x.display.doNextCap', 16)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.display.doNextCap', 0)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.display.doNextSnoozeH', 168)).toBeNull();
    expect(settingsRegistry.validate('x.display.doNextSnoozeH', 169)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.display.fansAmberTopN', 50)).toBeNull();
    expect(settingsRegistry.validate('x.display.fansAmberTopN', 51)).toBe('out_of_range');
    // The radar cap tops out where the batch cap does; between the two the panel
    // clamps, so this ceiling is the outer bound, not the effective one.
    expect(settingsRegistry.validate('x.display.radarDraftCap', 50)).toBeNull();
    expect(settingsRegistry.validate('x.display.radarDraftCap', 51)).toBe('out_of_range');
    expect(byKey.get('x.display.radarDraftCap')?.max).toBe(byKey.get('x.ai.batchReplyCap')?.max);
  });

  test('validation honors UI.3 ranges (fractional outperform ratio + bounds)', () => {
    expect(settingsRegistry.validate('x.people.mutualExchangeDays', 3)).toBeNull();
    expect(settingsRegistry.validate('x.people.mutualExchangeDays', 0)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.followups.chainLiveMaxAgeH', 72)).toBeNull();
    expect(settingsRegistry.validate('x.followups.chainLiveMaxAgeH', 73)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.pinned.outperformRatio', 2.5)).toBeNull();
    expect(settingsRegistry.validate('x.pinned.outperformRatio', 1)).toBe('out_of_range');
  });
});
