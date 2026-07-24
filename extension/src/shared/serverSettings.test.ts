import { describe, expect, test } from 'bun:test';
import { BAND } from '../replyBand.ts';
import { SERVER_DEFAULTS, readServerConfig } from './serverSettings.ts';

describe('readServerConfig — the mirrored blob (UI.6)', () => {
  test('a full blob wins over every baked default', () => {
    expect(
      readServerConfig({
        'x.doctrine.anchors3': [8, 14, 19],
        'x.doctrine.anchors4': [7, 11, 15, 21],
        'x.doctrine.ladderSwitchAt': 3,
        'x.gates.bestTimeMinN': 8,
        'x.mentions.panelRefreshCap': 1,
      }),
    ).toEqual({
      anchors3: [8, 14, 19],
      anchors4: [7, 11, 15, 21],
      ladderSwitchAt: 3,
      bestTimeMinN: 8,
      panelRefreshCap: 1,
      band: BAND,
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
    expect(readServerConfig({ 'x.mentions.panelRefreshCap': null }).panelRefreshCap).toBe(
      SERVER_DEFAULTS.panelRefreshCap,
    );
    expect(readServerConfig({ 'x.doctrine.ladderSwitchAt': '4' }).ladderSwitchAt).toBe(
      SERVER_DEFAULTS.ladderSwitchAt,
    );
  });

  test('zero is a real value, not a missing one', () => {
    // x.mentions.panelRefreshCap bottoms out at 0 = "the panel offers none".
    expect(readServerConfig({ 'x.mentions.panelRefreshCap': 0 }).panelRefreshCap).toBe(0);
  });

  test('server-scope keys riding along are ignored', () => {
    const cfg = readServerConfig({
      'x.mentions.serverRefreshCap': 6,
      'x.mentions.panelRefreshCap': 2,
    });
    expect(cfg.panelRefreshCap).toBe(2);
    expect(Object.keys(cfg).sort()).toEqual([
      'anchors3',
      'anchors4',
      'band',
      'bestTimeMinN',
      'ladderSwitchAt',
      'panelRefreshCap',
    ]);
  });
});

// UI.7 — the band knobs are the first mirrored keys the CONTENT SCRIPT reads,
// and the badge they drive has to agree with the server's gate. Every fallback
// here is BAND itself, so an unreachable server bands exactly as the shipped
// build did.
describe('readServerConfig — band thresholds (UI.7)', () => {
  test('a configured band arrives whole', () => {
    const cfg = readServerConfig({
      'x.band.bigViews': 1000,
      'x.band.baitViews': 600,
      'x.band.earlyReplies': 20,
      'x.band.midReplies': 200,
      'x.band.freshMin': 30,
      'x.band.risingVPM': 40,
      'x.band.baitVPM': 25,
      'x.band.watchVPM': 15,
      'x.band.watchReplyCeiling': 10,
      'x.band.tooSmallAgeMin': 45,
      'x.band.tooSmallViews': 500,
      'x.band.tooSmallVpm': 20,
    });
    expect(cfg.band).toEqual({
      bigViews: 1000,
      baitViews: 600,
      earlyReplies: 20,
      midReplies: 200,
      freshMin: 30,
      risingVPM: 40,
      baitVPM: 25,
      watchVPM: 15,
      watchReplyCeiling: 10,
      tooSmallAgeMin: 45,
      tooSmallViews: 500,
      tooSmallVpm: 20,
    });
  });

  test('no band keys at all = the shipped classifier, unchanged', () => {
    expect(readServerConfig({}).band).toEqual(BAND);
    expect(readServerConfig(undefined).band).toEqual(BAND);
  });

  test('one corrupt threshold falls back alone', () => {
    // A half-applied band would classify differently from the server gate,
    // which is the exact failure the mirror exists to prevent — so the fallback
    // is per key, never "drop the whole band".
    const cfg = readServerConfig({ 'x.band.bigViews': 'lots', 'x.band.midReplies': 200 });
    expect(cfg.band.bigViews).toBe(BAND.bigViews);
    expect(cfg.band.midReplies).toBe(200);
  });

  test('0 is a real threshold — it switches the dead-zone rule off', () => {
    expect(readServerConfig({ 'x.band.tooSmallViews': 0 }).band.tooSmallViews).toBe(0);
  });
});
