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

/** ML.3: the language pinned on a roster row, `null` when the handle is not on
 *  the roster or its `language` is blank. One indexed SELECT — `handle` is the
 *  primary key, so this is a PK lookup, not a scan.
 *
 *  Unlike `loadCannonHandles` this deliberately does NOT filter on `active`. A
 *  benched handle is still a Japanese account: benching means "stop camping",
 *  not "start replying in English", and the language column answers a question
 *  about the account rather than about whether we are spending on it. (The band
 *  gate's carve-out is the opposite call for the opposite reason — there
 *  `active` IS the decision.)
 *
 *  Free text by design (CQ.2, ≤16 chars): a row may read `'ro'`, `'Japanese'`
 *  or `'日本語'`. Normalizing it into a profile is the resolver's job
 *  (`src/x/replies/language.ts`), not this lookup's. */
export async function cannonLanguageFor(handle: string): Promise<string | null> {
  const h = normalizePersonHandle(handle);
  if (!h) return null;
  const [row] = await db
    .select({ language: cannonTargets.language })
    .from(cannonTargets)
    .where(eq(cannonTargets.handle, h))
    .limit(1);
  const language = row?.language?.trim() ?? '';
  return language === '' ? null : language;
}

/** §7.8, the `isCannonHandleSafe` discipline one column over: a DB hiccup drafts
 *  in ENGLISH rather than failing a call the user is about to pay for. `null` is
 *  the safe direction here because it is also the ordinary answer — the resolver
 *  falls through to script detection, which is pure. */
export async function cannonLanguageForSafe(handle: string): Promise<string | null> {
  try {
    return await cannonLanguageFor(handle);
  } catch (err) {
    console.error(
      'cannon: language lookup failed (the draft falls through to detection):',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
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
