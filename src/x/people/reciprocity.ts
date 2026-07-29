// Who counts as "my people" for the reciprocity lane (GT.6/GT.7): the set the
// reply band gate carves out, and the set the daily reciprocity quest counts
// against. ONE definition, so the gate and the quest can never disagree — the
// quest asks for it as of the day's start (`{asOf}`), which is the same rule at
// an earlier instant, not a second rule. See ReciprocityScope for why.
//
// It is deliberately the SAME membership `GET /x/people/rankmap` already ships
// as "handles worth tiering" (S0.3): non-retired people the stage machine has
// promoted past ambient sighting, plus the current 2–10x target roster. The
// Radar chip and the money gate reading the same set is the point — UI.7's
// badge-vs-gate fork is what happens when two surfaces re-cut one threshold.
//
// Cost: $0 — indexed SQL over rows we already own. The gate calls this only on
// its refusal path, so a hot/warm post never pays for it (§7.4).

import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm';
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
 *  here, in one place, if the gate turns out to nag on people it shouldn't.
 *
 *  TWIN (GT.8): the content script decides the same membership client-side, to
 *  stamp a `roster` Radar sighting on a quiet post — `isReciprocityPerson` in
 *  `extension/src/shared/glance.ts`, over the glance map (which is a superset:
 *  every non-retired people row, at every stage). It cannot import this module
 *  (db + drizzle, and the content script is a dependency-free IIFE), so the
 *  floor is duplicated there. Move this constant and move that predicate. */
export const RECIPROCITY_MIN_STAGE: Stage = 'engaged';

export interface ReciprocityScope {
  /** "Who was already mine at this instant" — the stage half additionally
   *  requires a rung reached BEFORE it. Omit for "who is mine right now",
   *  which is what the band gate asks.
   *
   *  GT.7 needs the qualifier and the gate must not have it, because
   *  RECIPROCITY_MIN_STAGE is `engaged` = "I have replied to them": posting the
   *  reply is what creates the membership. Unqualified, a reply to a total
   *  stranger counts as reciprocity the moment the people hook promotes them,
   *  and the quest degenerates into a second copy of the replies quest — over
   *  the whole measured corpus (14 posted replies, every one a first contact)
   *  it would have read `n === repliesPostedToday` on every single day. Asking
   *  the same set as of the day's start is what makes the number mean what its
   *  label says. It is ONE rule with a time qualifier, not a second definition —
   *  keep it that way (D157). */
  asOf?: Date;
}

/** The whole set, lowercased. The batch shape — a per-row membership test loads
 *  this once instead of calling the single-handle check in a loop. */
export async function loadReciprocityHandles(scope: ReciprocityScope = {}): Promise<Set<string>> {
  const floor = stageRank(RECIPROCITY_MIN_STAGE);
  const stages = STAGES.filter((s) => stageRank(s) >= floor);
  // `stageUpdatedAt` is written ONLY when the rung actually changes
  // (store.ts::recomputePerson), so it reads as "when they became this" — an
  // ally who merely liked something today keeps their old stamp. A null stamp
  // predates the stage machine and counts as already-mine. Known undercount,
  // in the safe direction: someone promoted engaged→responded today drops out
  // of today's quest, and they replied to me, which is its own good news.
  const asOfStage = scope.asOf
    ? or(isNull(people.stageUpdatedAt), lt(people.stageUpdatedAt, scope.asOf))
    : undefined;
  const [rows, targets] = await Promise.all([
    db
      .select({ handle: people.handle })
      .from(people)
      .where(and(eq(people.retired, false), inArray(people.stage, stages), asOfStage)),
    loadTargetHandles(),
  ]);
  const set = new Set(rows.map((r) => r.handle.toLowerCase()));
  // A roster target with no people row — or a retired one — is still my people:
  // the 2–10x band IS the doctrine's reply list, and `voice_authors.retired`
  // already governs that half (loadTargetHandles filters it). This half is
  // deliberately NOT time-qualified: saving someone as a target is a curation
  // act that precedes the reply, so it can't be self-created by replying.
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
