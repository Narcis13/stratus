// ML.3 — which language a reply gets drafted in, decided in ONE place.
//
// The precedence, and it is the whole module:
//
//   explicit body `language`     the Radar's roster pick or a panel override
//   ?? the cannon roster's pin   $0 PK lookup (cannon/membership.ts)
//   ?? the post's own script     pure detection (src/shared/language.ts)
//   ?? undefined                 English — the language-less path, unchanged
//
// Both generate routes call this and nothing else, so single and batch cannot
// fork on the rule. Server-side by design (§7.16, decision 2): the server
// already receives `handle` and `text` on every reply path, so resolving here
// fixes the in-page Reply Master, the Replies tab, Conversations and LaunchRoom
// at once and no surface hand-threads a field.
//
// SET SEMANTICS — the batch resolves per CALL, not per tweet. The batch prompt
// has ONE instruction block (a per-tweet language would need a template change
// this rendering exists to avoid), so both the roster step and the detection
// step are ALL-OR-NOTHING over the set: every target must answer, and every
// answer must agree, or the set falls through to English. Do not "fix" this
// into a per-tweet field without changing `REPLY_BATCH_PROMPT_TEMPLATE` first.
// The single path is the same function over a one-element set, which is exactly
// why it collapses to the plain precedence above.
//
// §7.11 runs through all of it: an unrecognized string resolves to a `null`
// PROFILE, not to a near-miss guess — the clause still names the language, it
// just carries no register axis or character budget. And `null` from detection
// means UNKNOWN (no letters, no majority, a tie, or Latin script, which cannot
// pick between es/pt/fr/de/ro), which reads as English rather than as a coerced
// nearest neighbour.
//
// Cost: $0. One PK SELECT per distinct handle plus pure detection. The routes
// call it INSIDE the refuse-before-spend ladder — after the band gate — so a
// 422'd post never pays for even this (§7.4: the rule is about order, not
// amount).

import {
  type LanguageProfile,
  detectScript,
  resolveLanguageProfile,
} from '../../shared/language.ts';
import { cannonLanguageForSafe } from '../cannon/membership.ts';
import type { ReplyVariant } from './prompt.ts';

/** One post the language has to cover. The batch passes its whole queue. */
export interface ReplyLanguageTarget {
  handle: string;
  text: string;
}

/** Which rule fired. Echoed to the panel so the chip can say WHY it picked —
 *  a resolution you cannot explain is one you will not trust. */
export type ReplyLanguageSource = 'explicit' | 'roster' | 'detected';

export interface ResolvedReplyLanguage {
  /** The language named in the prompt clause. `undefined` = English, i.e. the
   *  pre-ML path with no clause at all and byte-identical prompt bytes. */
  language?: string;
  /** The profile owning `language`, or `null` when the table has no entry for
   *  it. This — not the string — is what gates the single-`extends` trim and
   *  the specificity-gate skip: "is this string English" is not decidable for
   *  free text, and English deliberately has no profile, so an explicit
   *  `language: 'English'` keeps all three angles and today's gate. */
  profile: LanguageProfile | null;
  source?: ReplyLanguageSource;
}

/** The language-less path: no clause, three angles, the gate as it has always
 *  been. Every fall-through in here returns exactly this. */
const ENGLISH: ResolvedReplyLanguage = { profile: null };

export async function resolveReplyLanguage(input: {
  explicit?: string;
  targets: readonly ReplyLanguageTarget[];
}): Promise<ResolvedReplyLanguage> {
  // 1. Explicit wins outright — and short-circuits before the DB is touched.
  //    The string is the caller's (already validated by the route: 1–40 chars,
  //    single line); the profile is ours.
  const explicit = input.explicit?.trim() ?? '';
  if (explicit !== '') {
    return { language: explicit, profile: resolveLanguageProfile(explicit), source: 'explicit' };
  }

  const targets = input.targets;
  if (targets.length === 0) return ENGLISH;

  // 2. The roster pin. One lookup per DISTINCT handle (a 25-tweet batch from
  //    one camped account is one SELECT, not 25) and all-or-nothing: a set
  //    where only some authors are pinned falls through to detection, which can
  //    still answer for the whole set.
  const byHandle = new Map<string, string | null>();
  const pinned: string[] = [];
  let everyTargetPinned = true;
  for (const t of targets) {
    const key = t.handle.trim().toLowerCase();
    if (!byHandle.has(key)) byHandle.set(key, await cannonLanguageForSafe(t.handle));
    const value = byHandle.get(key) ?? null;
    if (value === null) {
      everyTargetPinned = false;
      break;
    }
    pinned.push(value);
  }
  if (everyTargetPinned) {
    const agreed = agree(pinned);
    if (agreed) return { ...agreed, source: 'roster' };
  }

  // 3. The post's own script. All-or-nothing again: one undetectable or
  //    disagreeing tweet sends the whole batch to English rather than drafting
  //    25 replies in a language only the first one was written in.
  const detected: LanguageProfile[] = [];
  for (const t of targets) {
    const profile = detectScript(t.text);
    if (!profile) return ENGLISH;
    detected.push(profile);
  }
  const first = detected[0];
  if (!first) return ENGLISH;
  if (detected.some((p) => p.code !== first.code)) return ENGLISH;
  return { language: first.name, profile: first, source: 'detected' };
}

/** Do a set of free-text language values name the same language? Compared on
 *  the resolved profile CODE where one resolves (so `'ja'` and `'Japanese'`
 *  agree) and on the normalized string otherwise (so two unrecognized values
 *  still have to match literally). The returned `language` is the profile's
 *  name when we know it — "Write all variants in ro" reads badly and the
 *  clause is a sentence, not a code. */
function agree(
  values: readonly string[],
): { language: string; profile: LanguageProfile | null } | null {
  const first = values[0];
  if (first === undefined) return null;
  const profile = resolveLanguageProfile(first);
  const key = profile?.code ?? normalizeKey(first);
  for (const v of values) {
    const p = resolveLanguageProfile(v);
    if ((p?.code ?? normalizeKey(v)) !== key) return null;
  }
  return { language: profile ? profile.name : first.trim(), profile };
}

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

/**
 * Decision 7's contract: a non-English draft ships ONE variant, on the
 * `extends` angle.
 *
 * The narrowed schema (`angles:['extends']`) and the clause's scoped narrowing
 * are optimizations — they stop the model paying output tokens for variants we
 * would throw away. THIS is the guarantee, because `maxItems` is in the D164b
 * unsupported-keyword set and strict structured outputs cannot cap an array's
 * length. One helper, called by both routes, so the two cannot fork.
 *
 * Prefers an `extends` variant over positional first: with the narrowed schema
 * they are the same variant, and when they are not (a non-strict provider, an
 * older response) the angle is what the contract names. Never returns an empty
 * array — an empty input stays empty and the caller's own primary check fires.
 */
export function trimToSingleVariant(variants: readonly ReplyVariant[]): ReplyVariant[] {
  const keep = variants.find((v) => v.angle === 'extends') ?? variants[0];
  return keep ? [keep] : [];
}
