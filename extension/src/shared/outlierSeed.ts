// OU.6 — the one-click seeds on the Outliers tab (channel keywords → the `any`
// group) merge into a field the user may already have typed in, so the merge is
// its own pure core rather than three lines inside the component.
//
// Two rules it exists to hold:
//   1. **Dedupe on the SAME key `parseSearchQuery` does** — lowercased — so the
//      field the user reads and the query the server stores agree about what a
//      duplicate is. A seed that visibly added "Bun" next to "bun" would look
//      like it worked and compile to one term.
//   2. **Report the truncation.** The compiler keeps the first
//      `MAX_TERMS_PER_FIELD` terms and silently drops the rest; a one-click
//      seed makes that easy to hit, and a channel whose keywords half-landed is
//      indistinguishable from a channel with fewer keywords unless the merge
//      says so.
//
// The cap is a parameter, not an import: this module stays dependency-free like
// its siblings here, and the caller passes the compiler's own constant.

export interface TermMerge {
  /** Existing terms first, in order, then the new ones that survived. */
  terms: string[];
  /** How many incoming terms actually landed (0 = everything was already there). */
  added: number;
  /** How many were cut by the cap — the number the UI has to admit to. */
  dropped: number;
}

/** Append `incoming` to `existing`, trimming, dropping blanks, deduping
 *  case-insensitively and truncating at `cap`. Pure; order is stable. */
export function mergeTerms(existing: string[], incoming: string[], cap: number): TermMerge {
  const kept: string[] = [];
  const seen = new Set<string>();
  let added = 0;
  let dropped = 0;

  const push = (raw: string, isNew: boolean): void => {
    const term = raw.trim();
    if (term === '') return;
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    // A term over the cap is dropped rather than pushed — and only an INCOMING
    // one counts as dropped, because an existing term the user typed past the
    // cap was already not compiling before this click.
    if (kept.length >= cap) {
      if (isNew) dropped += 1;
      return;
    }
    kept.push(term);
    if (isNew) added += 1;
  };

  for (const term of existing) push(term, false);
  for (const term of incoming) push(term, true);

  return { terms: kept, added, dropped };
}
