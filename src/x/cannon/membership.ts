// Who is on the cannon roster (CQ.3) — the one definition the three consumers
// share: the reply band gate's second carve-out, the glance map's `isCannon`
// chip, and (through glance) the content script's `cannon` capture band.
//
// It is the deliberate sibling of `src/x/people/reciprocity.ts`, and the split
// between them is the point: reciprocity is "people I already have a
// relationship with", cannon is "accounts I camp for reach, relationship or
// not". A handle can be in both, in either, or in neither — which is why the
// gate stamps `'cannon'` and `'roster'` as DIFFERENT bypass values (§7.4a: an
// exempted call has to stay a cohort you can tell apart later).
//
// Membership is `active = 1` only. The bench (`active = 0`) is a parking lot for
// handles under review — a benched target must not keep opening the money gate,
// or benching would be a no-op that looks like a decision.
//
// Cost: $0 — one indexed SELECT over a hand-curated table. The gate calls this
// only on its refusal path, so a hot/warm post never pays for it (§7.4).

import { eq } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { cannonTargets } from '../db/schema.ts';
import { normalizePersonHandle } from '../people/store.ts';

/** The camped roster, lowercased. `cannon_targets.handle` is stored normalized
 *  already (routes/cannon.ts owns the only writes); the `toLowerCase` here is
 *  belt-and-suspenders against a hand-edited row.
 *
 *  The batch shape — a per-row membership test loads this once instead of
 *  calling the single-handle check in a loop (`loadReciprocityHandles`' rule). */
export async function loadCannonHandles(): Promise<Set<string>> {
  const rows = await db
    .select({ handle: cannonTargets.handle })
    .from(cannonTargets)
    .where(eq(cannonTargets.active, true));
  return new Set(rows.map((r) => r.handle.toLowerCase()));
}

/** Membership for one handle. Built on the set rather than a targeted query on
 *  purpose: the roster is small by construction (15–25 hand-curated handles),
 *  and one definition can't fork from itself. */
export async function isCannonHandle(handle: string): Promise<boolean> {
  const h = normalizePersonHandle(handle);
  if (!h) return false;
  return (await loadCannonHandles()).has(h);
}

/** §7.8: a roster-layer failure never fails the path that pays for it. False is
 *  the safe direction — the band gate keeps its refusal default and the caller
 *  gets the same 422 it got before this existed.
 *
 *  TWIN (§7.4c, CQ.4): the content script asks the same question client-side to
 *  stamp a `cannon` Radar sighting — `isCannonPerson` in
 *  `extension/src/shared/glance.ts`. Unlike the reciprocity pair (whose client
 *  half must REPRODUCE a stage rule over a superset map), that one reproduces
 *  nothing: it reads `GlanceEntry.isCannon`, which the glance route fills from
 *  `loadCannonHandles()` above. One definition, carried over the wire — keep it
 *  that way. Move this file and move that predicate. */
export async function isCannonHandleSafe(handle: string): Promise<boolean> {
  try {
    return await isCannonHandle(handle);
  } catch (err) {
    console.error(
      'cannon: roster lookup failed (gate keeps its refusal default):',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
