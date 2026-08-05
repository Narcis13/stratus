// The server half of the configurable Cannon (the `bandThresholds.ts` twin).
//
// src/shared/cannon.ts is shared with the page and must stay dependency-free
// (§7.26/7.27), so it can never read the settings store itself — thresholds
// arrive as an argument. This is the one place that turns the `x.cannon.*`
// override rows into that argument, so the queue routes, the roster floor and
// any future server consumer can't drift into reading a different subset.
//
// Read at REQUEST time (the store is sync + Map-cached, invalidated on write),
// so a PATCH moves the next call with no restart. The page half is
// extension/src/shared/serverSettings.ts, fed by the mirrored blob.

import type { CannonThresholds } from '../../shared/cannon.ts';
import { getSetting } from './registry.ts';

export function cannonThresholdsFromSettings(): CannonThresholds {
  return {
    scoreMin: getSetting<number>('x.cannon.scoreMin'),
    maxAgeMin: getSetting<number>('x.cannon.maxAgeMin'),
    redAgeMin: getSetting<number>('x.cannon.redAgeMin'),
    placedTarget: getSetting<number>('x.cannon.placedTarget'),
  };
}
