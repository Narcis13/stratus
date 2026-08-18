// UI.1 registry: the type/range/enum/numberArray validation matrix + grouping.
// Pure — no DB. The route wiring (store round-trip) is covered in
// ../routes/settings.test.ts.

import { describe, expect, test } from 'bun:test';
import { CANNON } from '../../shared/cannon.ts';
import { SWEEP } from '../../shared/radarSweep.ts';
import {
  SETTINGS_REGISTRY,
  type SettingDef,
  settingsByGroup,
  settingsRegistry,
  validateSettingValue,
} from './registry.ts';

type CannonKey = keyof typeof CANNON;
type SweepKey = keyof typeof SWEEP;

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
      'identity',
      'doctrine',
      'quests',
      'people',
      'followups',
      'pinned',
      'digest',
      'gates',
      'radar',
      'sweep',
      'cannon',
      'workers',
      'budgets',
      'ai',
      'display',
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      'Identity',
      'Doctrine',
      'Quests',
      'People',
      'Follow-ups',
      'Pinned watch',
      'Digest',
      'Stat gates',
      'Radar',
      'Sweep',
      'Cannon',
      'Workers',
      'Budgets',
      'AI calls',
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

  // The identity group is the "who am I" group and renders first. Its single
  // knob is deliberately validated no harder than `not_a_string`: the handle
  // shape is already owned by the ingest parser, and a second owner here would
  // mean a refused save — worse than a typo the user can see and fix.
  test('the identity group is exactly the self handle, mirrored and unvalidated', () => {
    const identity = settingsByGroup().find((g) => g.id === 'identity');
    expect(identity?.defs.map((d) => d.key)).toEqual(['x.identity.selfHandle']);
    expect(settingsRegistry.get('x.identity.selfHandle')?.scope).toBe('mirrored');
    // Unset is the shipped default and a legal value — it means "answer empty",
    // not "not configured yet, so guess".
    expect(settingsRegistry.get('x.identity.selfHandle')?.default).toBe('');
    expect(settingsRegistry.validate('x.identity.selfHandle', '')).toBeNull();
    expect(settingsRegistry.validate('x.identity.selfHandle', 'narcis13')).toBeNull();
    expect(settingsRegistry.validate('x.identity.selfHandle', 13)).toBe('not_a_string');
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
      'x.followups.reupMinViews',
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
    expect(keysOf('radar')).toEqual(['x.radar.draftTtlH', 'x.radar.curatedCount']);
    // One worker, one knob: the daily-pass hour and the two winner-re-read money
    // bounds died with the pass itself (2026-08-12), and the re-up view floor
    // moved to `x.followups.reupMinViews` where its only reader lives.
    expect(keysOf('workers')).toEqual(['x.workers.publisherIntervalSec']);
    expect(settingsRegistry.get('x.workers.dailyMetricsHourUtc')).toBeUndefined();
    expect(settingsRegistry.get('x.workers.winnerRereadMinViews')).toBeUndefined();
    expect(settingsRegistry.get('x.workers.winnerRereadCap')).toBeUndefined();
    expect(settingsRegistry.get('x.workers.discoveryExcludeReplies')).toBeUndefined();

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
    // The whole `mentions` group went with the mention pull (2026-08-12): all
    // three knobs bounded a billed read that no longer exists.
    expect(keysOf('mentions')).toEqual([]);
    expect(settingsRegistry.get('x.mentions.serverRefreshCap')).toBeUndefined();
    expect(settingsRegistry.get('x.mentions.panelRefreshCap')).toBeUndefined();
    expect(settingsRegistry.get('x.mentions.pullMax')).toBeUndefined();
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
  });

  test('only the worker CADENCE knobs are restart-scoped (decision 10)', () => {
    const restart = SETTINGS_REGISTRY.filter((d) => d.appliesOn === 'restart').map((d) => d.key);
    expect(restart).toEqual(['x.workers.publisherIntervalSec']);
    // The re-up view floor is read per request, so a change lands on the next
    // /followups read with no restart.
    const byKey = new Map(SETTINGS_REGISTRY.map((d) => [d.key, d]));
    expect(byKey.get('x.followups.reupMinViews')?.appliesOn).toBeUndefined();
  });

  test('validation honors UI.4 ranges (gate floors, TTL, worker bounds)', () => {
    expect(settingsRegistry.validate('x.gates.minCellN', 5)).toBeNull();
    expect(settingsRegistry.validate('x.gates.minCellN', 4)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.gates.minCellN', 101)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.gates.bestTimeMinN', 1)).toBeNull();
    expect(settingsRegistry.validate('x.gates.bestTimeMinN', 0)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.radar.draftTtlH', 168)).toBeNull();
    expect(settingsRegistry.validate('x.radar.draftTtlH', 169)).toBe('out_of_range');
    // RC.3: the curated size shares the batch cap's ceiling on purpose — the
    // effective size is the lower of the two, so a curated set that could
    // outgrow the cap would be a number the drafting call silently ignores.
    expect(settingsRegistry.validate('x.radar.curatedCount', 5)).toBeNull();
    expect(settingsRegistry.validate('x.radar.curatedCount', 4)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.radar.curatedCount', 50)).toBeNull();
    expect(settingsRegistry.validate('x.radar.curatedCount', 51)).toBe('out_of_range');
    const defs = new Map(SETTINGS_REGISTRY.map((d) => [d.key, d]));
    expect(defs.get('x.radar.curatedCount')?.max).toBe(defs.get('x.ai.batchReplyCap')?.max);
    expect(settingsRegistry.validate('x.workers.publisherIntervalSec', 29)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.workers.publisherIntervalSec', 301)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.followups.reupMinViews', 500)).toBeNull();
    expect(settingsRegistry.validate('x.followups.reupMinViews', 99)).toBe('out_of_range');
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
      'x.identity.selfHandle',
      'x.doctrine.anchors3',
      'x.doctrine.anchors4',
      'x.doctrine.ladderSwitchAt',
      'x.followups.neglectedTargetDays',
      'x.gates.bestTimeMinN',
      'x.radar.curatedCount',
      'x.sweep.minViews',
      'x.sweep.maxViews',
      'x.sweep.minLikes',
      'x.sweep.maxLikes',
      'x.sweep.minReplies',
      'x.sweep.maxReplies',
      'x.sweep.maxAgeMin',
      'x.sweep.media',
      'x.sweep.excludeAds',
      'x.sweep.verifiedOnly',
      'x.sweep.campedBypass',
      'x.sweep.circleBypass',
      'x.sweep.autoStopMin',
      'x.cannon.scoreMin',
      'x.cannon.maxAgeMin',
      'x.cannon.redAgeMin',
      'x.cannon.placedTarget',
      'x.ai.batchReplyCap',
      'x.display.doNextCap',
      'x.display.doNextSnoozeH',
      'x.display.fansAmberTopN',
      'x.display.radarDraftCap',
      'x.display.dossierListLen',
      'x.display.channelPostsShown',
      'x.display.voiceListLimit',
      'x.display.repliesListLimit',
    ]);
    // No mention knob is mirrored anymore — the group is gone entirely.
    expect(mirrored.filter((k) => k.startsWith('x.mentions.'))).toEqual([]);
  });

  // Same UI.7 rule one module over: the cannon group must be the WHOLE
  // CannonThresholds shape, all mirrored (the page's Cannon view and the
  // server's cannon routes filter with the same four numbers), and the defaults
  // must BE the module's constant rather than a second calibration — `scoreMin`
  // is a measured p90 and a retyped copy here could silently disagree with it.
  test('the cannon group is exactly the scorer shape, every key mirrored', () => {
    const cannon = settingsByGroup().find((g) => g.id === 'cannon');
    const suffixes = (cannon?.defs ?? []).map((d) => d.key.replace('x.cannon.', ''));
    expect(suffixes.slice().sort()).toEqual(Object.keys(CANNON).slice().sort());
    expect((cannon?.defs ?? []).every((d) => d.scope === 'mirrored')).toBe(true);
    for (const d of cannon?.defs ?? []) {
      expect([d.key, d.default]).toEqual([
        d.key,
        CANNON[d.key.replace('x.cannon.', '') as CannonKey],
      ]);
    }
  });

  // RS.1: the same UI.7 group-shape rule a third time. It matters more here than
  // anywhere else — these thirteen are the ONLY rule deciding what an armed
  // sweep captures, so a knob with no key would be a filter the user can see the
  // effect of and cannot move, and a server-scoped one would never reach the
  // content script that is its only consumer.
  test('the sweep group is exactly the predicate shape, every key mirrored', () => {
    const sweep = settingsByGroup().find((g) => g.id === 'sweep');
    const suffixes = (sweep?.defs ?? []).map((d) => d.key.replace('x.sweep.', ''));
    expect(suffixes.length).toBe(13);
    expect(suffixes.slice().sort()).toEqual(Object.keys(SWEEP).slice().sort());
    expect((sweep?.defs ?? []).every((d) => d.scope === 'mirrored')).toBe(true);
    // Capture binds the next mutation burst — nothing here arms a timer.
    expect((sweep?.defs ?? []).every((d) => d.appliesOn === undefined)).toBe(true);
    // The defaults ARE the module's constant, never a second calibration.
    for (const d of sweep?.defs ?? []) {
      expect([d.key, d.default]).toEqual([d.key, SWEEP[d.key.replace('x.sweep.', '') as SweepKey]]);
    }
    // §7.19 lives in the copy, not in a lock — every knob carries the sample size.
    for (const d of sweep?.defs ?? []) {
      expect([
        d.key,
        d.description.endsWith('recalibrate at n >= 100 swept rows, never by feel.'),
      ]).toEqual([d.key, true]);
    }
  });

  // The media gate is the group's only enum, and its options must BE the
  // predicate's branches: an option `passesContentGates` has no arm for would be
  // a setting the user can pick and the page silently ignores.
  test("the media gate is an enum over exactly the rule's three branches", () => {
    const media = SETTINGS_REGISTRY.find((d) => d.key === 'x.sweep.media');
    expect(media?.type).toBe('enum');
    expect(media?.options).toEqual(['any', 'with', 'without']);
    expect(media?.default).toBe(SWEEP.media);
    expect(settingsRegistry.validate('x.sweep.media', 'with')).toBeNull();
    expect(settingsRegistry.validate('x.sweep.media', 'photos')).toBe('not_in_options');
    expect(settingsRegistry.validate('x.sweep.media', true)).toBe('not_a_string');
  });

  test('the four sweep switches are booleans and validate as such', () => {
    for (const k of [
      'x.sweep.verifiedOnly',
      'x.sweep.campedBypass',
      'x.sweep.circleBypass',
      'x.sweep.excludeAds',
    ]) {
      expect([k, settingsRegistry.validate(k, true)]).toEqual([k, null]);
      expect([k, settingsRegistry.validate(k, false)]).toEqual([k, null]);
      expect([k, settingsRegistry.validate(k, 'true')]).toEqual([k, 'not_a_boolean']);
      expect([k, settingsRegistry.validate(k, 1)]).toEqual([k, 'not_a_boolean']);
    }
  });

  test('validation honors the RS.1 sweep ranges', () => {
    // 0 is a real value on every metric knob: a floor of 0 is no floor and a
    // ceiling of 0 is the documented "no ceiling" sentinel, so neither may be
    // refused the way a display cap's 0 is.
    for (const k of [
      'x.sweep.minViews',
      'x.sweep.maxViews',
      'x.sweep.minLikes',
      'x.sweep.maxLikes',
      'x.sweep.minReplies',
      'x.sweep.maxReplies',
    ]) {
      expect([k, settingsRegistry.validate(k, 0)]).toEqual([k, null]);
      expect([k, settingsRegistry.validate(k, 1_000_000)]).toEqual([k, null]);
      expect([k, settingsRegistry.validate(k, 1_000_001)]).toEqual([k, 'out_of_range']);
      expect([k, settingsRegistry.validate(k, -1)]).toEqual([k, 'out_of_range']);
    }
    // The age gate is the one maximum with no sentinel — it is always enforced,
    // so 0 ("nothing newer than this instant") is refused rather than read as off.
    expect(settingsRegistry.validate('x.sweep.maxAgeMin', 1)).toBeNull();
    expect(settingsRegistry.validate('x.sweep.maxAgeMin', 0)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.sweep.maxAgeMin', 1440)).toBeNull();
    expect(settingsRegistry.validate('x.sweep.maxAgeMin', 1441)).toBe('out_of_range');
    // A session shorter than a minute would expire before the first scroll.
    expect(settingsRegistry.validate('x.sweep.autoStopMin', 1)).toBeNull();
    expect(settingsRegistry.validate('x.sweep.autoStopMin', 0)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.sweep.autoStopMin', 240)).toBeNull();
    expect(settingsRegistry.validate('x.sweep.autoStopMin', 241)).toBe('out_of_range');
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
      'x.display.dossierListLen',
      'x.display.channelPostsShown',
      'x.display.voiceListLimit',
      'x.display.repliesListLimit',
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

  // UI.14: the People/Channels/Voice list caps. Same shape as UI.12's — the only
  // consumer is the side panel, so `mirrored` is the whole point, and every one
  // of them binds the next render.
  test('UI.14 display knobs are panel-read, mirrored, and bounded', () => {
    const byKey = new Map(SETTINGS_REGISTRY.map((d) => [d.key, d]));
    for (const k of [
      'x.display.dossierListLen',
      'x.display.channelPostsShown',
      'x.display.voiceListLimit',
    ]) {
      expect([k, byKey.get(k)?.scope]).toEqual([k, 'mirrored']);
      expect([k, byKey.get(k)?.appliesOn]).toEqual([k, undefined]);
    }

    expect(settingsRegistry.validate('x.display.dossierListLen', 3)).toBeNull();
    expect(settingsRegistry.validate('x.display.dossierListLen', 2)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.display.dossierListLen', 25)).toBeNull();
    expect(settingsRegistry.validate('x.display.dossierListLen', 26)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.display.channelPostsShown', 30)).toBeNull();
    expect(settingsRegistry.validate('x.display.channelPostsShown', 31)).toBe('out_of_range');
    // The Voice library is DOM-scraped, so a big page is $0 — the ceiling is
    // about scroll and render, which is why it is the loosest cap in the group.
    expect(settingsRegistry.validate('x.display.voiceListLimit', 500)).toBeNull();
    expect(settingsRegistry.validate('x.display.voiceListLimit', 501)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.display.voiceListLimit', 19)).toBe('out_of_range');
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
