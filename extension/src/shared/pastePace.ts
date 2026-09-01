// The paste pace clock. Taking a Radar angle copies it and opens the tweet; the
// paste itself happens by hand on x.com, and the ONE thing that makes a worked
// queue look automated is the gap between two of them. Ten replies pasted forty
// seconds apart is a person having a morning; ten pasted eight seconds apart is
// a bot, and X reads it the same way.
//
// So the panel stamps the moment of every pick and shows how long ago it was.
// It never blocks a click — the human is the one holding the ⌘V, and a hard
// lock would only teach them to work around it. It just makes the elapsed time
// impossible not to see.
//
// This module is the pure core (read + resolve + format). The chrome plumbing —
// the `chrome.storage.local` stamp and the once-a-second re-render — lives in
// sidepanel/Radar.tsx, which is both the writer and the reader of the key: it
// is a CONTROL, not part of the sightings buffer, so §7.24's single-writer rule
// doesn't apply (the `radar:replyGoal` precedent).

/** Epoch ms of the last angle picked, in `chrome.storage.local`. */
export const PASTE_PACE_KEY = 'radar:lastPickAt';

/** The gap a paste should clear. An opening guess and a deliberately round one:
 *  it's the number the human asked for, not a measured threshold, so it stays a
 *  constant until there's a reason to move it. */
export const PASTE_COOLDOWN_MS = 40_000;

/** Past this the clock stops being interesting — you went and did something
 *  else, and "23m since your last copy" is noise. It's also what bounds the
 *  once-a-second tick: the panel stops ticking as soon as the pace reads
 *  `cold`. */
export const PASTE_PACE_STALE_MS = 10 * 60_000;

/** `cold` — nothing copied recently, so there is nothing to pace against.
 *  `wait` — inside the cooldown; pasting now is the machine-gun pattern.
 *  `clear` — the gap has been cleared, paste away. */
export type PasteTone = 'cold' | 'wait' | 'clear';

export interface PastePace {
  tone: PasteTone;
  /** ms since the last pick, 0 when there is none. */
  sinceMs: number;
  /** ms left of the cooldown, 0 once cleared. */
  remainingMs: number;
  /** The strip's whole line. */
  label: string;
  /** Compact warning for a row's own pick hint — null unless we're waiting, so
   *  a row only shouts when clicking it would be the too-fast paste. */
  hint: string | null;
}

/** What survives a read of the stored key. Anything else (a cleared profile, a
 *  hand-edited value, a future stamp from a clock that jumped) reads as "no
 *  pick", which is the safe answer: it can only ever under-warn, never invent a
 *  cooldown that didn't happen. */
export function readLastPickAt(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** `12s`, `1m 04s`, `12m` — seconds while seconds are what you're counting,
 *  and tabular in the CSS so the number doesn't shimmy on every tick. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const min = Math.floor(total / 60);
  const sec = total % 60;
  if (min >= 10) return `${min}m`;
  return `${min}m ${String(sec).padStart(2, '0')}s`;
}

/** Resolve the clock at `now`. Pure and stamp-driven on purpose: the stored ms
 *  is the truth and `Date.now()` is the clock on every render, so a side panel
 *  whose timers were throttled while backgrounded still paints the real gap
 *  instead of however many ticks it was allowed to run. */
export function pastePaceAt(
  lastPickAt: number | null,
  now: number,
  cooldownMs: number = PASTE_COOLDOWN_MS,
): PastePace {
  // A stamp from the future (a clock change, a profile synced across machines)
  // is clamped to "just now" rather than trusted: it would otherwise read as a
  // cleared gap forever.
  const sinceMs = lastPickAt === null ? 0 : Math.max(0, now - lastPickAt);
  if (lastPickAt === null || sinceMs >= PASTE_PACE_STALE_MS) {
    return {
      tone: 'cold',
      sinceMs: 0,
      remainingMs: 0,
      label: 'No recent copy — clear to paste',
      hint: null,
    };
  }
  const remainingMs = Math.max(0, cooldownMs - sinceMs);
  const ago = formatElapsed(sinceMs);
  if (remainingMs > 0) {
    const wait = Math.ceil(remainingMs / 1000);
    return {
      tone: 'wait',
      sinceMs,
      remainingMs,
      label: `Copied ${ago} ago — wait ${wait}s before pasting`,
      hint: `wait ${wait}s — you copied one ${ago} ago`,
    };
  }
  return {
    tone: 'clear',
    sinceMs,
    remainingMs: 0,
    label: `Copied ${ago} ago — clear to paste`,
    hint: null,
  };
}
