// RC.3 — which ROOM a reply is being written into, decided in ONE place.
//
// The precedence, and it is the whole module:
//
//   explicit                     a panel override, or an operator's `mode` on the body
//   ?? the curate pass's call    a free rider on an LLM call already paid for (RC.8)
//   ?? the roster pin            $0 PK lookup on `cannon_targets.topic`
//   ?? keyword detection         pure (src/shared/replyMode.ts)
//   ?? 'general'                 unresolvable is `general`, never a guess (§7.11)
//
// `language.ts`'s twin and deliberately its own file: both generate routes call
// this and nothing else, so single and batch cannot fork on the rule (§7.16).
//
// PER-POST, NOT PER-CALL — the one place this is NOT symmetric with
// `resolveReplyLanguage`, and the asymmetry is the point. ML.3 resolves the
// language all-or-nothing over the set because the batch template carries ONE
// language block, and a mixed set can fall back to English without lying. A
// Cannon queue is *deliberately* heterogeneous: football, an Apple headline and
// a Japanese grief post in the same 25 is the doctrine working, not a defect.
// Collapsing that to one mode would hand 24 posts the register of whichever one
// voted loudest, so this returns one resolution PER TARGET, aligned by index,
// and the mode rides where `relationship` rides — a line per post inside
// `{{POSTS}}` (RC.5). Do not "fix" this into set semantics.
//
// The roster pin is the rule worth having and it is nearly free: the Cannon
// doctrine is *camp a roster*, so the same handles recur for weeks.
// @fabrizioromano is always football, @9to5mac is always Apple news,
// @hiiragi2280 is always wholesome — pin once, correct forever, and a wrong
// detection on a camped handle is fixable rather than recurring. One PK SELECT
// per DISTINCT handle: a 25-tweet batch from one camped account is one SELECT,
// not 25.
//
// §7.11 runs through all of it. Every string input goes through `resolveModeId`,
// which answers `null` for anything it does not recognize rather than picking a
// near neighbour, so a stale pin or an LLM inventing `'sports-banter'` falls
// through to the next rule instead of silently drafting in a register the post
// did not earn. `detectReplyMode`'s `null` means UNKNOWN for the same reason —
// mapping unknown onto `general` is THIS function's job, and `source` records
// that it happened.
//
// Cost: $0. One PK SELECT per distinct handle plus pure detection. The routes
// call it INSIDE the refuse-before-spend ladder — after the band gate — so a
// 422'd post never pays for even this (§7.4: the rule is about order, not
// amount).

import {
  GENERAL_MODE,
  type ReplyMode,
  detectReplyMode,
  resolveModeId,
} from '../../shared/replyMode.ts';
import { cannonTopicForSafe } from '../cannon/membership.ts';
import type { ReplyVariant } from './prompt.ts';

/** One post the mode has to be resolved for. The batch passes its whole queue. */
export interface ReplyModeTarget {
  handle: string;
  text: string;
  /** The curate pass's classification for THIS post, when the queue came
   *  through curation (RC.8). Free by construction — it rides back on a call
   *  already paid for — which is why it outranks the pin: it read the actual
   *  post, and the pin only knows the account. */
  curated?: string | null;
}

/** Which rule fired. Echoed so the panel chip can say WHY it picked — a
 *  resolution you cannot explain is one you will not trust, and a wrong mode has
 *  to be visible BEFORE the paste. `fallback` is the honest fifth value: it
 *  means nothing answered, not that the post was judged neutral. */
export type ReplyModeSource = 'explicit' | 'curated' | 'roster' | 'detected' | 'fallback';

export interface ResolvedReplyMode {
  mode: ReplyMode;
  source: ReplyModeSource;
}

/**
 * Resolve a mode for every target, in order, aligned by index with `targets`.
 *
 * The single-draft path is this same function over a one-element array — that is
 * what stops the two paths forking (§7.16). An empty target set returns an empty
 * array; there is no post to pick a room for.
 */
export async function resolveReplyMode(input: {
  explicit?: string;
  targets: readonly ReplyModeTarget[];
}): Promise<ResolvedReplyMode[]> {
  // Resolved once, before the loop: an override is per CALL. An unrecognized
  // string is not an error here — it falls through to the rest of the chain,
  // which is the §7.11 direction (a typo'd override drafts on the post's own
  // evidence rather than on nothing).
  const explicit = resolveModeId(input.explicit);

  // Per-handle memo, so a batch camped on one account is one SELECT. Keyed on
  // the raw trimmed/lowercased handle; `cannonTopicForSafe` does the real
  // normalization (`@` stripping) itself.
  const pinByHandle = new Map<string, ReplyMode | null>();

  const out: ResolvedReplyMode[] = [];
  for (const t of input.targets) {
    if (explicit) {
      out.push({ mode: explicit, source: 'explicit' });
      continue;
    }

    const curated = resolveModeId(t.curated);
    if (curated) {
      out.push({ mode: curated, source: 'curated' });
      continue;
    }

    const key = t.handle.trim().toLowerCase();
    if (!pinByHandle.has(key)) {
      pinByHandle.set(key, resolveModeId(await cannonTopicForSafe(t.handle)));
    }
    const pinned = pinByHandle.get(key) ?? null;
    if (pinned) {
      out.push({ mode: pinned, source: 'roster' });
      continue;
    }

    const detected = detectReplyMode(t.text);
    if (detected) {
      out.push({ mode: detected, source: 'detected' });
      continue;
    }

    out.push({ mode: GENERAL_MODE, source: 'fallback' });
  }
  return out;
}

/**
 * RC.5 — keep only the variants whose angle the room actually allows.
 *
 * `trimToSingleVariant`'s twin (ML.3's decision-7 guarantee) and the same
 * division of labour: the narrowed schema (`angles: mode.angles`) is the
 * optimization — it stops the model paying output tokens for a `contrarian`
 * under a funeral post — and THIS is the contract, because a non-strict
 * provider, an older response, or `parseReplyVariants`' coercion of an
 * unrecognized angle to `'extends'` can all land an angle the room excludes.
 * One helper, called per tweet by both routes, so the two cannot fork.
 *
 * An empty result returns the input untouched rather than nothing: money is
 * already spent, and a paid draft in the wrong ANGLE column is still a reply I
 * can read and edit, while zero variants is a wasted call. Same asymmetry §7.35
 * draws for the gloss — degrade the label, never the payload.
 */
export function trimToModeAngles(
  variants: readonly ReplyVariant[],
  mode: ReplyMode,
): ReplyVariant[] {
  const allowed = new Set<string>(mode.angles);
  const kept = variants.filter((v) => allowed.has(v.angle));
  return kept.length > 0 ? kept : [...variants];
}
