import { describe, expect, test } from 'bun:test';
import { CANNON } from '../cannon.ts';
import { SWEEP } from '../radarSweep.ts';
import {
  SERVER_DEFAULTS,
  curatedBatchSize,
  radarBatchSize,
  readServerConfig,
} from './serverSettings.ts';

describe('readServerConfig — the mirrored blob (UI.6)', () => {
  test('a full blob wins over every baked default', () => {
    expect(
      readServerConfig({
        'x.doctrine.anchors3': [8, 14, 19],
        'x.doctrine.anchors4': [7, 11, 15, 21],
        'x.doctrine.ladderSwitchAt': 3,
        'x.gates.bestTimeMinN': 8,
        'x.display.doNextCap': 8,
        'x.display.doNextSnoozeH': 48,
        'x.display.fansAmberTopN': 25,
        'x.display.radarDraftCap': 12,
        'x.ai.batchReplyCap': 40,
        'x.radar.curatedCount': 30,
        'x.followups.neglectedTargetDays': 10,
        'x.display.dossierListLen': 12,
        'x.display.channelPostsShown': 20,
        'x.display.voiceListLimit': 250,
        'x.display.repliesListLimit': 300,
        'x.identity.selfHandle': 'narcis13',
      }),
    ).toEqual({
      anchors3: [8, 14, 19],
      anchors4: [7, 11, 15, 21],
      ladderSwitchAt: 3,
      bestTimeMinN: 8,
      cannon: CANNON,
      sweep: SWEEP,
      doNextCap: 8,
      doNextSnoozeH: 48,
      fansAmberTopN: 25,
      radarDraftCap: 12,
      batchReplyCap: 40,
      curatedCount: 30,
      neglectedTargetDays: 10,
      dossierListLen: 12,
      channelPostsShown: 20,
      voiceListLimit: 250,
      repliesListLimit: 300,
      selfHandle: 'narcis13',
    });
  });

  test('no blob at all falls back to the baked values', () => {
    expect(readServerConfig(undefined)).toEqual(SERVER_DEFAULTS);
    expect(readServerConfig(null)).toEqual(SERVER_DEFAULTS);
    expect(readServerConfig({})).toEqual(SERVER_DEFAULTS);
    // A dead server can only ever hand us a JSON object; anything else is
    // corruption and must not throw on the way to the fallback.
    expect(readServerConfig('nope')).toEqual(SERVER_DEFAULTS);
    expect(readServerConfig([1, 2, 3])).toEqual(SERVER_DEFAULTS);
  });

  test('a garbage key falls back alone — the rest of the blob still applies', () => {
    const cfg = readServerConfig({
      'x.doctrine.anchors3': 'nine',
      'x.gates.bestTimeMinN': 9,
    });
    expect(cfg.anchors3).toEqual(SERVER_DEFAULTS.anchors3);
    expect(cfg.bestTimeMinN).toBe(9);
  });

  test('malformed hour arrays fall back rather than emit a bad ladder', () => {
    expect(readServerConfig({ 'x.doctrine.anchors3': [] }).anchors3).toEqual(
      SERVER_DEFAULTS.anchors3,
    );
    expect(readServerConfig({ 'x.doctrine.anchors3': [9, '13', 18] }).anchors3).toEqual(
      SERVER_DEFAULTS.anchors3,
    );
    expect(readServerConfig({ 'x.doctrine.anchors4': [8, Number.NaN] }).anchors4).toEqual(
      SERVER_DEFAULTS.anchors4,
    );
  });

  test('non-finite and non-number scalars fall back', () => {
    expect(readServerConfig({ 'x.gates.bestTimeMinN': Number.NaN }).bestTimeMinN).toBe(
      SERVER_DEFAULTS.bestTimeMinN,
    );
    expect(readServerConfig({ 'x.display.doNextCap': null }).doNextCap).toBe(
      SERVER_DEFAULTS.doNextCap,
    );
    expect(readServerConfig({ 'x.doctrine.ladderSwitchAt': '4' }).ladderSwitchAt).toBe(
      SERVER_DEFAULTS.ladderSwitchAt,
    );
  });

  test('zero is a real value, not a missing one', () => {
    // x.display.fansAmberTopN bottoms out at 0 = "amber nobody".
    expect(readServerConfig({ 'x.display.fansAmberTopN': 0 }).fansAmberTopN).toBe(0);
  });

  test('server-scope keys riding along are ignored', () => {
    const cfg = readServerConfig({
      'x.budgets.xSoftDailyUsd': 0.15,
      'x.display.doNextCap': 2,
    });
    expect(cfg.doNextCap).toBe(2);
    expect(Object.keys(cfg).sort()).toEqual([
      'anchors3',
      'anchors4',
      'batchReplyCap',
      'bestTimeMinN',
      'cannon',
      'channelPostsShown',
      'curatedCount',
      'doNextCap',
      'doNextSnoozeH',
      'dossierListLen',
      'fansAmberTopN',
      'ladderSwitchAt',
      'neglectedTargetDays',
      'radarDraftCap',
      'repliesListLimit',
      'selfHandle',
      'sweep',
      'voiceListLimit',
    ]);
  });

  // The one string knob in the blob. Blank is the real "unset" value the
  // Harvest preset keys off, so a non-string must fall back to blank rather
  // than reaching a consumer as a handle.
  test('the self handle reads through, and anything unstringy falls back to blank', () => {
    expect(readServerConfig({ 'x.identity.selfHandle': 'narcis13' }).selfHandle).toBe('narcis13');
    expect(readServerConfig({ 'x.identity.selfHandle': '' }).selfHandle).toBe('');
    expect(readServerConfig({ 'x.identity.selfHandle': 13 }).selfHandle).toBe('');
    expect(readServerConfig({}).selfHandle).toBe('');
  });
});

// UI.12 — the Today tab's presentation caps. Four of them exist only for the
// panel; the other two were server-scoped knobs flipped to mirrored so the panel
// reads the SAME number the server acts on rather than a lookalike constant.
describe('readServerConfig — Today display caps (UI.12)', () => {
  test('each cap falls back on its own', () => {
    const cfg = readServerConfig({ 'x.display.doNextCap': 'five', 'x.display.fansAmberTopN': 3 });
    expect(cfg.doNextCap).toBe(SERVER_DEFAULTS.doNextCap);
    expect(cfg.fansAmberTopN).toBe(3);
    expect(cfg.radarDraftCap).toBe(SERVER_DEFAULTS.radarDraftCap);
    expect(cfg.neglectedTargetDays).toBe(SERVER_DEFAULTS.neglectedTargetDays);
  });

  test('the baked caps ARE the registry defaults', () => {
    // Drift here is invisible: the panel would simply behave differently before
    // the first sync than after it.
    expect(SERVER_DEFAULTS.doNextCap).toBe(5);
    expect(SERVER_DEFAULTS.doNextSnoozeH).toBe(24);
    expect(SERVER_DEFAULTS.fansAmberTopN).toBe(10);
    expect(SERVER_DEFAULTS.radarDraftCap).toBe(20);
    expect(SERVER_DEFAULTS.batchReplyCap).toBe(25);
    expect(SERVER_DEFAULTS.curatedCount).toBe(25);
    expect(SERVER_DEFAULTS.neglectedTargetDays).toBe(7);
  });
});

describe('radarBatchSize — the display cap clamped to what the server allows', () => {
  test('the lower of the two wins, in both directions', () => {
    expect(radarBatchSize({ ...SERVER_DEFAULTS, radarDraftCap: 20, batchReplyCap: 25 })).toBe(20);
    // Raising the radar cap past the server's ceiling used to buy a refused
    // click; now it just stops at the ceiling.
    expect(radarBatchSize({ ...SERVER_DEFAULTS, radarDraftCap: 50, batchReplyCap: 25 })).toBe(25);
    expect(radarBatchSize({ ...SERVER_DEFAULTS, radarDraftCap: 3, batchReplyCap: 50 })).toBe(3);
  });

  test('a corrupt blob can never produce a zero-or-negative batch', () => {
    // Both knobs floor at 1 in the registry, so this is corruption-only — but a
    // 0 here would silently disable the button rather than surface a problem.
    expect(radarBatchSize({ ...SERVER_DEFAULTS, radarDraftCap: 0, batchReplyCap: 0 })).toBe(1);
  });
});

// RC.4 — the curated pass reads a DIFFERENT pair of knobs than the plain batch:
// curatedCount is what the server will keep, radarDraftCap has no say (curation
// looks at the whole queue, not the display cap). The shared ceiling is the one
// the drafting call actually enforces.
describe('curatedBatchSize — the curated size clamped to the same server cap', () => {
  test('the lower of curatedCount and batchReplyCap wins', () => {
    expect(curatedBatchSize({ ...SERVER_DEFAULTS, curatedCount: 25, batchReplyCap: 25 })).toBe(25);
    expect(curatedBatchSize({ ...SERVER_DEFAULTS, curatedCount: 50, batchReplyCap: 25 })).toBe(25);
    expect(curatedBatchSize({ ...SERVER_DEFAULTS, curatedCount: 10, batchReplyCap: 25 })).toBe(10);
  });

  test('the display cap does not bind it', () => {
    // radarDraftCap sizes "Draft replies", not "Curate & draft": curation reads
    // the whole fresh queue and the survivors are what get drafted, so a small
    // display cap must not silently shrink a curated pass.
    expect(curatedBatchSize({ ...SERVER_DEFAULTS, radarDraftCap: 5, curatedCount: 25 })).toBe(25);
  });

  test('a corrupt blob can never produce a zero-or-negative batch', () => {
    expect(curatedBatchSize({ ...SERVER_DEFAULTS, curatedCount: 0, batchReplyCap: 0 })).toBe(1);
  });
});

// RS.1 — the sweep filters, and since the reply band was deleted the ONLY rule
// that decides what a tweet qualifies for. The content script is the reader that
// matters, so this resolver is the whole path from a PATCH to what a scroll
// captures. It also holds the mirror's first booleans, which is why the fallback discipline is asserted on those too — a
// `'false'` string reaching `campedBypass` as truthy would re-open a bypass the
// user switched off.
describe('readServerConfig — sweep filters (RS.1)', () => {
  test('a configured sweep arrives whole', () => {
    const cfg = readServerConfig({
      'x.sweep.minViews': 1000,
      'x.sweep.maxViews': 50_000,
      'x.sweep.minLikes': 5,
      'x.sweep.maxLikes': 900,
      'x.sweep.minReplies': 1,
      'x.sweep.maxReplies': 25,
      'x.sweep.maxAgeMin': 90,
      'x.sweep.verifiedOnly': true,
      'x.sweep.campedBypass': false,
      'x.sweep.circleBypass': true,
      'x.sweep.autoStopMin': 45,
    });
    expect(cfg.sweep).toEqual({
      minViews: 1000,
      maxViews: 50_000,
      minLikes: 5,
      maxLikes: 900,
      minReplies: 1,
      maxReplies: 25,
      maxAgeMin: 90,
      verifiedOnly: true,
      campedBypass: false,
      circleBypass: true,
      autoStopMin: 45,
    });
  });

  test('no sweep keys at all = the shipped filters, unchanged', () => {
    expect(readServerConfig({}).sweep).toEqual(SWEEP);
    expect(readServerConfig(undefined).sweep).toEqual(SWEEP);
  });

  test('one corrupt filter falls back alone — the other ten still apply', () => {
    const cfg = readServerConfig({
      'x.sweep.minViews': 'lots',
      'x.sweep.maxReplies': 12,
      'x.sweep.verifiedOnly': 'yes',
      'x.sweep.circleBypass': true,
    });
    expect(cfg.sweep.minViews).toBe(SWEEP.minViews);
    expect(cfg.sweep.maxReplies).toBe(12);
    expect(cfg.sweep.verifiedOnly).toBe(SWEEP.verifiedOnly);
    expect(cfg.sweep.circleBypass).toBe(true);
  });

  test('0 is a real value — it is the "no ceiling" sentinel, not a missing key', () => {
    const cfg = readServerConfig({ 'x.sweep.maxViews': 0, 'x.sweep.minViews': 0 });
    expect(cfg.sweep.maxViews).toBe(0);
    expect(cfg.sweep.minViews).toBe(0);
  });

  test('a false switch reads as false, not as unset', () => {
    expect(readServerConfig({ 'x.sweep.campedBypass': false }).sweep.campedBypass).toBe(false);
    expect(readServerConfig({ 'x.sweep.campedBypass': 0 }).sweep.campedBypass).toBe(
      SWEEP.campedBypass,
    );
  });
});
