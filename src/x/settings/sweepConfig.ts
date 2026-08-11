// The server half of the sweep filters.
//
// src/shared/radarSweep.ts is shared with the page and must stay
// dependency-free (§7.26/7.27), so it can never read the settings store
// itself — the config arrives as an argument. This is the one place that turns
// the `x.sweep.*` rows into that argument for a SERVER caller, so the page's
// capture rule and any server-side reading of it can't drift.
//
// This replaces `bandThresholds.ts`, deleted with the reply-band classifier:
// the sweep is now the only rule that decides what a tweet qualifies for, so
// it is also the only axis a server-side measurement may bucket against.
//
// Read at REQUEST time (the store is sync + Map-cached, invalidated on write),
// so a PATCH moves the next call with no restart. The page half is
// extension/src/shared/serverSettings.ts, fed by the mirrored blob.

import type { SweepConfig } from '../../shared/radarSweep.ts';
import { getSetting } from './registry.ts';

export function sweepConfigFromSettings(): SweepConfig {
  return {
    minViews: getSetting<number>('x.sweep.minViews'),
    maxViews: getSetting<number>('x.sweep.maxViews'),
    minLikes: getSetting<number>('x.sweep.minLikes'),
    maxLikes: getSetting<number>('x.sweep.maxLikes'),
    minReplies: getSetting<number>('x.sweep.minReplies'),
    maxReplies: getSetting<number>('x.sweep.maxReplies'),
    maxAgeMin: getSetting<number>('x.sweep.maxAgeMin'),
    verifiedOnly: getSetting<boolean>('x.sweep.verifiedOnly'),
    campedBypass: getSetting<boolean>('x.sweep.campedBypass'),
    circleBypass: getSetting<boolean>('x.sweep.circleBypass'),
    autoStopMin: getSetting<number>('x.sweep.autoStopMin'),
  };
}
