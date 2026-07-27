// SC.7 — one panel-wide copy of the niche lexicon the static coach grades with.
//
// Every coach surface must grade with the SAME vocabulary: the Composer's live
// column and the four reply-variant pickers would otherwise disagree about
// whether a draft has a concrete detail, which is the badge-vs-gate fork one
// component later. So the fetch lives here, once, and both consumers read it
// through `useCoachLexicon()` — no call site passes a lexicon around.
//
// Cache shape is the `ChannelTags.loadActiveChannels` idiom: module-level value
// + a 60 s TTL + one in-flight promise all subscribers share. No explicit
// invalidation — the TTL IS the mechanism, so a channel keyword added on the
// Channels tab starts counting as concrete detail within a minute, and the
// worst case is a stale-but-valid list.
//
// A failed or unconfigured fetch keeps `DEFAULT_LEXICON` and says nothing: a
// niche-less coach is still right about every platform and prose rule it has
// (SC decision 7), and a toast about a lexicon would be noise on a surface
// whose whole promise is that it costs nothing and interrupts nothing.

import { useEffect, useState } from 'react';
import { type CoachLexicon, DEFAULT_LEXICON } from '../postCoach.ts';
import { api } from './api.ts';
import { getSettings } from './storage.ts';

const CACHE_TTL_MS = 60_000;

let current: CoachLexicon = DEFAULT_LEXICON;
let loadedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** The lexicon as last loaded — synchronous, always safe, never null. */
export function coachLexicon(): CoachLexicon {
  return current;
}

/** Load it if the cached copy has aged out. Resolves once `coachLexicon()` is
 *  current; concurrent callers share the one request. */
export function refreshCoachLexicon(): Promise<void> {
  if (loadedAt > 0 && Date.now() - loadedAt < CACHE_TTL_MS) return Promise.resolve();
  if (!inflight) {
    inflight = getSettings()
      .then((s) => api.coach.lexicon(s))
      .then((res) => {
        // Only the two term lists cross into the engine; `niche` is provenance.
        current = { specificTerms: res.specificTerms, tribeTerms: res.tribeTerms };
      })
      .catch(() => {
        current = DEFAULT_LEXICON;
      })
      .then(() => {
        loadedAt = Date.now();
        inflight = null;
        for (const notify of listeners) notify();
      });
  }
  return inflight;
}

/** Subscribe a component to the shared lexicon. Renders immediately with
 *  whatever is cached (the neutral default on the first paint of a cold panel)
 *  and re-renders once the real one lands — the score simply gets sharper. */
export function useCoachLexicon(): CoachLexicon {
  const [lexicon, setLexicon] = useState(current);
  useEffect(() => {
    const notify = (): void => setLexicon(coachLexicon());
    listeners.add(notify);
    void refreshCoachLexicon().then(notify);
    return () => {
      listeners.delete(notify);
    };
  }, []);
  return lexicon;
}
