// ML.5 — what the PANEL does with the language the server already resolved.
//
// Everything here reads an answer; nothing here decides one. The precedence
// (explicit > cannon roster > the post's own script > English) lives in
// `src/x/replies/language.ts` and is echoed on both reply responses as
// `language` + `languageSource`, so this module never re-derives which language
// a draft is in — §7.4c's rule is reproduce the RULE or read the server's
// answer, and here we read it. The one thing it does look up is a PROPERTY of
// that answer: `rtl` comes from the profile table keyed by the string the
// server sent back, which is a fact about the language, not a second guess at
// which one it is.
//
// The counter is why this file exists rather than three inline expressions. X
// counts a WEIGHTED sum over codepoints, not `String.length`: a 140-character
// Japanese reply is already full, and `280 - text.length` told the user they
// had 140 characters left on a reply X would refuse. Arabic/Hebrew/Cyrillic are
// weight 1 and keep the whole 280 — read src/shared/language.ts's header before
// "fixing" that into a blanket halving.

import { MAX_WEIGHTED, resolveLanguageProfile, weightedLength } from '../language.ts';
import type { PostContext, ReplyLanguageSource, ReplyVariant } from './types.ts';

/** What X has left, in X's own units. Negative = over, which is exactly what
 *  the `.counter.over` affordance has always rendered: this changes the NUMBER,
 *  never the affordance. */
export function weightedRemaining(text: string): number {
  return MAX_WEIGHTED - weightedLength(text);
}

export interface DraftLanguage {
  language: string;
  source: ReplyLanguageSource;
}

/** The language a draft was written in, as the SERVER reported it. Two carriers,
 *  in precedence order: the generate response's top-level echo (a fresh draft),
 *  then `contextSnapshot`, which the route stamps before the insert (§7.16) so a
 *  row re-read from History still knows. `null` means the language-less path —
 *  an English draft or a pre-ML row — never "unknown". */
export function draftLanguage(draft: {
  language?: string | null;
  languageSource?: ReplyLanguageSource | null;
  contextSnapshot?: Pick<PostContext, 'language' | 'languageSource'>;
}): DraftLanguage | null {
  return (
    languagePair(draft.language, draft.languageSource) ??
    languagePair(draft.contextSnapshot?.language, draft.contextSnapshot?.languageSource)
  );
}

/** The pair moves together or not at all — a language with no source is a row
 *  written by something that doesn't know the rule, and the chip's whole value
 *  is being able to say which rule fired. */
function languagePair(language: unknown, source: unknown): DraftLanguage | null {
  if (typeof language !== 'string' || language.trim() === '') return null;
  if (source !== 'explicit' && source !== 'roster' && source !== 'detected') return null;
  return { language: language.trim(), source };
}

/** Why this draft is in this language, in one sentence — the chip's tooltip. A
 *  resolution you cannot explain is one you will not trust. */
export function languageSourceTitle(source: ReplyLanguageSource): string {
  switch (source) {
    case 'explicit':
      return 'You chose this language.';
    case 'roster':
      return 'Pinned on the cannon roster — this account gets drafted in its own language.';
    case 'detected':
      return 'Detected from the post being replied to.';
  }
}

/** `'rtl'` only when the profile table says the resolved language is — Arabic
 *  and Hebrew today. `undefined` rather than `'ltr'` so an English draft renders
 *  the markup it always did. Set it on the TEXT elements themselves: flipping a
 *  container mirrors the whole card, including controls that are not text. */
export function textDirFor(language: string | null | undefined): 'rtl' | undefined {
  return resolveLanguageProfile(language)?.rtl === true ? 'rtl' : undefined;
}

/** The gloss belonging to the text currently in the box — the literal English
 *  rendering the model returned under a non-English reply (ML.2). Matched by
 *  TEXT, not by index: the moment the human edits the reply the gloss stops
 *  describing it, and a stale gloss under an edited reply is worse than none.
 *  Blank or absent (English drafts, pre-ML rows, a gloss the server's lenient
 *  parse discarded) reads as `null`, and a `null` gloss must render NOTHING —
 *  no empty row, no placeholder. */
export function glossFor(
  variants: readonly ReplyVariant[] | null | undefined,
  text: string,
): string | null {
  if (!variants) return null;
  const hit = variants.find((v) => v.text === text);
  const gloss = hit?.gloss;
  if (typeof gloss !== 'string') return null;
  const trimmed = gloss.trim();
  return trimmed === '' ? null : trimmed;
}
