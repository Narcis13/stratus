// Who counts as "my people" for the reciprocity lane (GT.6/GT.7): the set the
// reply band gate carves out, and the set the daily reciprocity quest counts
// against. ONE definition, so the gate and the quest can never disagree.
//
// It is deliberately the SAME membership `GET /x/people/rankmap` already ships
// as "handles worth tiering" (S0.3): non-retired people the stage machine has
// promoted past ambient sighting, plus the current 2–10x target roster. The
// Radar chip and the money gate reading the same set is the point — UI.7's
// badge-vs-gate fork is what happens when two surfaces re-cut one threshold.
//
// Cost: $0 — indexed SQL over rows we already own. The gate calls this only on
// its refusal path, so a hot/warm post never pays for it (§7.4).

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { people } from '../db/schema.ts';
import { loadTargetHandles } from '../routes/voice.ts';
import { STAGES, type Stage, stageRank } from './stage.ts';
import { normalizePersonHandle } from './store.ts';

/** The stage floor for "my people": `engaged` = I have posted a reply to them
 *  at least once (computeStage's own definition of the rung).
 *
 *  The GT plan proposed `noticed`, and that was measured before shipping (§7.33)
 *  against the real DB: `noticed` is reached by `hover_sighting` — the ambient
 *  AX.1 hover-card capture — and **730 of the 730 `noticed` rows are hover-only**
 *  (the entire DB holds exactly one `saved_tweet`). At that floor the carve-out
 *  covers **24 of the 25 accounts ever drafted for**, i.e. it switches the money
 *  gate off for the whole deliberate-reply flow instead of carving out a lane,
 *  and `contextSnapshot.gateBypass` stops being a distinguishable cohort. At
 *  `engaged` it covers the ~12 handles a reply was actually posted to. Widen it
 *  here, in one place, if the gate turns out to nag on people it shouldn't. */
export const RECIPROCITY_MIN_STAGE: Stage = 'engaged';

/** The whole set, lowercased. The batch shape — a per-row membership test loads
 *  this once instead of calling the single-handle check in a loop. */
export async function loadReciprocityHandles(): Promise<Set<string>> {
  const floor = stageRank(RECIPROCITY_MIN_STAGE);
  const stages = STAGES.filter((s) => stageRank(s) >= floor);
  const [rows, targets] = await Promise.all([
    db
      .select({ handle: people.handle })
      .from(people)
      .where(and(eq(people.retired, false), inArray(people.stage, stages))),
    loadTargetHandles(),
  ]);
  const set = new Set(rows.map((r) => r.handle.toLowerCase()));
  // A roster target with no people row — or a retired one — is still my people:
  // the 2–10x band IS the doctrine's reply list, and `voice_authors.retired`
  // already governs that half (loadTargetHandles filters it).
  for (const h of targets) set.add(h.toLowerCase());
  return set;
}

/** Membership for one handle. Built on the set rather than a targeted query on
 *  purpose: the set is small by construction (stage ≥ engaged), and one
 *  definition can't fork from itself. */
export async function isReciprocityHandle(handle: string): Promise<boolean> {
  const h = normalizePersonHandle(handle);
  if (!h) return false;
  return (await loadReciprocityHandles()).has(h);
}

/** §7.8: a people-layer failure never fails the path that pays for it. False is
 *  the safe direction — the band gate keeps its refusal default and the caller
 *  gets the same 422 it got before this existed. */
export async function isReciprocityHandleSafe(handle: string): Promise<boolean> {
  try {
    return await isReciprocityHandle(handle);
  } catch (err) {
    console.error(
      'people: reciprocity lookup failed (gate keeps its refusal default):',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
