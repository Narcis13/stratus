// The server half of the configurable reply band (UI.7).
//
// src/shared/replyBand.ts is shared with the page and must stay
// dependency-free (§7.26/7.27), so it can never read the settings store
// itself — thresholds arrive as an argument. This is the one place that turns
// the `x.band.*` override rows into that argument, so the gate, the Playbook
// funnel and any future server consumer can't drift into reading a different
// subset of the knobs.
//
// Read at REQUEST time (the store is sync + Map-cached, invalidated on write),
// so a PATCH moves the next call with no restart. The page half is
// extension/src/shared/serverSettings.ts, fed by the mirrored blob.

import type { BandThresholds } from '../../shared/replyBand.ts';
import { getSetting } from './registry.ts';

export function bandThresholdsFromSettings(): BandThresholds {
  return {
    bigViews: getSetting<number>('x.band.bigViews'),
    baitViews: getSetting<number>('x.band.baitViews'),
    earlyReplies: getSetting<number>('x.band.earlyReplies'),
    midReplies: getSetting<number>('x.band.midReplies'),
    freshMin: getSetting<number>('x.band.freshMin'),
    risingVPM: getSetting<number>('x.band.risingVPM'),
    baitVPM: getSetting<number>('x.band.baitVPM'),
    watchVPM: getSetting<number>('x.band.watchVPM'),
    watchReplyCeiling: getSetting<number>('x.band.watchReplyCeiling'),
    tooSmallAgeMin: getSetting<number>('x.band.tooSmallAgeMin'),
    tooSmallViews: getSetting<number>('x.band.tooSmallViews'),
    tooSmallVpm: getSetting<number>('x.band.tooSmallVpm'),
  };
}
