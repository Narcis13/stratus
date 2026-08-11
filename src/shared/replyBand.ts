// Pure capture metadata for reply targets — no DOM, unit-testable.
//
// Canonical home (§7.27): consumed by BOTH the extension (via the re-export
// shim extension/src/replyBand.ts, inlined by Vite) and the server, so the two
// can never disagree about the shape a sighting is recorded in.
//
// **What used to live here and no longer does.** This file was the reply-band
// classifier (`classifyBand`, `BAND`, twelve `x.band.*` thresholds): it drew a
// green/amber rail on the timeline, and it gated /x/replies/generate with a
// 422. RS.3 moved queue admission onto the sweep filters, RS.7 hid the
// thresholds from Settings, and the classifier is now deleted outright —
// `src/shared/radarSweep.ts::passesSweep` is the ONE rule that decides what a
// tweet qualifies for, and the Radar's sweep gear is the one place it is
// tuned. Do not reintroduce a second opinion here; that drift is exactly what
// was removed. History: docs/PHASE-HISTORY.md, evals/reply-eval-*.md.
//
// Dependency-free by contract — not one import — because the content IIFE has
// no module loader.

/** One tweet as the page read it at capture time. Stored on
 *  `radar_drafts.signals` and on `reply_drafts.contextSnapshot.signals`; read
 *  back by the Playbook's latency table (`ageMin`) and the Radar's queue
 *  ranking (`vpm`). `bait` is DOM/text-derived metadata about the post's shape,
 *  kept because it is a fact about the tweet — it no longer feeds any gate. */
export interface TweetSignals {
  views: number;
  replies: number;
  ageMin: number; // minutes since the post went up
  vpm: number; // views per minute = views / max(ageMin, 1)
  bait: boolean; // question / poll / take-bait format
}

const BAIT_PHRASES =
  /\b(agree or disagree|what'?s your|which one|be honest|your take|hot take|thoughts\??|am i wrong|change my mind|guess the)\b/i;

/** Text-only half of the bait check, shared so a server-derived sighting is
 *  labelled the same way the page labels one. The extension layers a DOM poll
 *  check on top (content.ts::looksLikeReplyBait) — polls aren't recoverable
 *  from text alone. */
export function textLooksLikeReplyBait(text: string): boolean {
  const t = text.trim();
  if (/\?$/.test(t)) return true; // ends on a question
  return BAIT_PHRASES.test(t);
}

// "1541" -> "1.5k", "70000" -> "70k", "500" -> "500", "2100000" -> "2.1M".
export function formatCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}
