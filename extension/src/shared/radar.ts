// The Radar (OVERHAUL-PLAN §7.2) — band verdicts used to evaporate as you
// scrolled past them. The content script streams every hot/warm sighting to
// the background, which keeps a session-scoped ring buffer in
// chrome.storage.session; the side panel's Today tab renders it as a ranked
// worked queue. $0 — pure presentation of what the badge already computes.
//
// This module is the pure, unit-testable core (merge + cap + rank). The
// chrome plumbing lives in background.ts (single writer) and
// sidepanel/Radar.tsx (reader).

import { CANNON, type CannonThresholds, cannonAgeTone, cannonScore } from '../cannon.ts';
import type { TweetSignals } from '../replyBand.ts';
import type { ReplyModeId } from '../replyMode.ts';
import type { ReplyModeSource, ReplyVariant } from './types.ts';

// 'manual' = the user pinned this tweet into the queue via the ⊕ button (RU.8).
// 'roster' = a fresh post by someone already in my circle, captured despite a
// null/skip verdict (GT.8) — the reciprocity lane is about who posted it, not
// how it's doing.
// 'cannon' = a fresh post that clears the arbitrage bar (CQ.4): either its
// views-per-reply score is in the top decile (src/shared/cannon.ts) or its
// author is on the camped cannon roster. Unlike 'roster' this one IS partly a
// claim about the tweet — but it is the Cannon view's own reading, not the
// band classifier's, so it stays queue metadata like the other two.
// All three are queue/UX metadata, not classifier verdicts — none ever enters
// the Playbook's hot/warm band cells (their reply_drafts signals keep the real
// computed band, null when uncomputed; the confirm endpoint coerces all three
// away).
export type RadarBand = 'hot' | 'warm' | 'manual' | 'roster' | 'cannon';

// How strongly a stored band resists being overwritten by a re-sighting. A
// human pin outranks everything; a real classifier verdict outranks a roster
// capture, which only says "someone I know posted this". Equal stickiness → the
// fresher incoming band wins, which is the pre-GT.8 behaviour for every
// hot/warm pair. This is also the eviction preference under cap pressure —
// keep-longest is the same order as deserves-the-slot.
//
// 'cannon' sits on the hot/warm rung, NOT the roster one: an arbitrage capture
// is a real reason to be in the queue (a measured score, or a roster I camp on
// purpose), so between a cannon and a hot sighting the fresher one wins — the
// pre-existing behaviour for every hot/warm pair. Only 'roster', which says
// nothing about the tweet, sits below.
//
// The asymmetry matters in both directions: a roster row that catches fire takes
// the fresher hot/warm verdict (the upgrade), while a tweet that EARNED hot and
// then went quiet is never demoted to 'roster' on the next scroll past it — vpm
// decays with age, so hot → skip is a live transition, not a hypothetical.
function bandStickiness(b: RadarBand): number {
  if (b === 'manual') return 2;
  if (b === 'roster') return 0;
  return 1; // hot / warm / cannon
}

// Who the author is, as far as the people layer knows (S0.3). A warm post from
// an ally/mutual compounds a real relationship; a hot post from a rando is a
// lottery ticket — so tier beats band/vpm in the queue order.
export type PersonTier = 'ally' | 'mutual' | 'target';

// One entry of GET /x/people/rankmap: the author's relationship stage (for
// stage ≥ engaged) plus whether they're in the current 2–10x targets roster.
// Keyed by lowercased handle. The background caches the whole map (10 min TTL)
// and derives each sighting's personTier from it.
export interface RankMapEntry {
  stage: string;
  isTarget: boolean;
}
export type RankMap = Record<string, RankMapEntry>;

export interface RadarSighting {
  tweetId: string;
  url: string;
  handle: string;
  author: string | null;
  text: string; // snippet, clipped at capture time
  band: RadarBand;
  signals: TweetSignals; // as measured at lastSeenAt — age keeps ticking after
  firstSeenAt: string;
  lastSeenAt: string;
  // Batch-drafted Grok reply (§7.2 Radar reply drafting), attached client-side
  // by the background after a "Draft replies" run. Survives re-sightings so a
  // drafted reply isn't wiped when the content script re-reports the tweet.
  reply?: string;
  // Every angle variant (RU.4) from the batch draft. Since RC.4 the angle set is
  // five wide and a batch may return fewer than three of them — the post's mode
  // narrows it — so never assume a length here.
  // `reply` stays the primary (variants[0].text); the full set rides for the
  // on-page variant chips (Task 7). Survives re-sightings like `reply`.
  variants?: ReplyVariant[];
  // RC.5 — the room the server drafted this reply into and the rule that picked
  // it, attached with the reply and surviving re-sightings like it. Kept on the
  // sighting rather than derived here on purpose (§7.4c): the resolution is the
  // server's (an override, the curate call, a `cannon_targets.topic` pin, then
  // keyword detection), and a panel that re-derived it would eventually disagree
  // with the prompt the reply was actually written against. Absent on a row
  // drafted before RC.5 or rehydrated from `radar_drafts`, which stores neither.
  mode?: ReplyModeId;
  modeSource?: ReplyModeSource;
  // ISO time the user clicked a reply-ready row (its reply was copied). A
  // clicked sighting leaves the live queue for the "Clicked" view so the queue
  // stays the not-yet-worked set. Survives re-sightings like `reply`.
  clickedAt?: string;
  // The reply_drafts row id (RU.6), stamped by the background after the confirm
  // endpoint promotes this radar draft into a measured reply row. The on-page
  // paste flow (RU.7) PATCHes it to `posted`. Survives re-sightings like `reply`.
  draftId?: string;
  // Roster tier of the author (S0.3), stamped by the background from the cached
  // rankmap after every buffer write — always re-derived, never merged, so a
  // stage change is reflected on the next write.
  personTier?: PersonTier;
}

// Buffer keys. These live in **chrome.storage.local**, not `.session`: the
// session area is dropped whenever Chrome decides the extension's session ended
// (an extension reload, an update, a browser-process restart — none of which the
// user does deliberately), and a queue that silently collapses from 18 rows to
// whatever the next scroll re-sights is worse than useless: you can't work a
// queue you can't trust. `local` survives all of it, and RADAR_TTL_MS below is
// what actually bounds the queue's lifetime now — an explicit rule instead of a
// browser lifecycle detail.
export const RADAR_SIGHTINGS_KEY = 'radar:sightings';
export const RADAR_DISMISSED_KEY = 'radar:dismissed';

export const RADAR_CAP = 100;
export const RADAR_DISMISSED_CAP = 500;

// How long a sighting stays queueable. Replacing "until the browser closes",
// and deliberately the same 24h ROSTER_MAX_AGE_MIN uses in content.ts: a tweet
// you first saw yesterday is not a reply opportunity today, and the server
// expires its own drafted copy at 48h anyway. This is the ONLY implicit way a
// row leaves the queue — everything else is a dismiss the human asked for.
export const RADAR_TTL_MS = 24 * 60 * 60 * 1000;

// Merge a report batch into the stored queue, keyed by tweetId: fresher
// signals/band/lastSeenAt win, firstSeenAt survives from the earlier entry.
// Dismissed ids never re-enter — the content script keeps re-sighting a tweet
// for as long as it's rendered, so a worked item must stay gone. Past the cap,
// least-recently-seen entries are evicted.
export function mergeSightings(
  existing: RadarSighting[],
  incoming: RadarSighting[],
  dismissed: string[],
): RadarSighting[] {
  const byId = new Map(existing.map((s) => [s.tweetId, s]));
  const gone = new Set(dismissed);
  for (const s of incoming) {
    if (gone.has(s.tweetId)) continue;
    const prev = byId.get(s.tweetId);
    if (!prev) {
      byId.set(s.tweetId, s);
      continue;
    }
    // Re-sighting from the content script carries no reply/clickedAt — keep the
    // ones the panel/background set earlier (incoming wins only if it has one).
    const reply = s.reply ?? prev.reply;
    const variants = s.variants ?? prev.variants;
    const clickedAt = s.clickedAt ?? prev.clickedAt;
    const draftId = s.draftId ?? prev.draftId;
    // RC.5: the room belongs to the reply, so it survives a re-sighting on the
    // same terms — a content-script report that wiped it would leave a drafted
    // row with no chip the moment the tweet scrolled past again.
    const mode = s.mode ?? prev.mode;
    const modeSource = s.modeSource ?? prev.modeSource;
    // The stickier band survives (RU.8 human pin > classifier verdict > GT.8
    // roster capture); at equal stickiness the fresher incoming band wins.
    const band = bandStickiness(prev.band) > bandStickiness(s.band) ? prev.band : s.band;
    const merged: RadarSighting = { ...s, band, firstSeenAt: prev.firstSeenAt };
    if (reply !== undefined) merged.reply = reply;
    if (variants !== undefined) merged.variants = variants;
    if (clickedAt !== undefined) merged.clickedAt = clickedAt;
    if (draftId !== undefined) merged.draftId = draftId;
    if (mode !== undefined) merged.mode = mode;
    if (modeSource !== undefined) merged.modeSource = modeSource;
    byId.set(s.tweetId, merged);
  }
  const all = [...byId.values()];
  if (all.length <= RADAR_CAP) return all;
  // Evict least-recently-seen within a stickiness rung: the least sticky rows
  // sort to the front (dropped first), the stickiest to the back (kept). A
  // manual pin (RU.8) outlives any auto-capture, and a GT.8 roster capture goes
  // before a real hot/warm verdict — otherwise a chatty circle could push the
  // loudest opportunities of the day out of a cap-100 buffer. slice() keeps the
  // tail.
  all.sort((a, b) => {
    const sa = bandStickiness(a.band);
    const sb = bandStickiness(b.band);
    if (sa !== sb) return sa - sb;
    return a.lastSeenAt.localeCompare(b.lastSeenAt);
  });
  return all.slice(all.length - RADAR_CAP);
}

// Append ids to the dismissed set; past the cap, the oldest dismissals fall
// off (their tweets are long out of the buffer anyway).
export function appendDismissed(dismissed: string[], ids: string[]): string[] {
  const merged = [...new Set([...dismissed, ...ids])];
  return merged.length <= RADAR_DISMISSED_CAP
    ? merged
    : merged.slice(merged.length - RADAR_DISMISSED_CAP);
}

// The roster tier for a rankmap entry (S0.3). ally/mutual are relationships
// worth compounding; a target is an in-band account worth building; everyone
// else is null. An entry can be a target below mutual stage (a saved voice
// author I've never talked to) — stage wins when it's ally/mutual, else the
// target flag decides.
export function personTierFor(entry: RankMapEntry | undefined): PersonTier | null {
  if (!entry) return null;
  if (entry.stage === 'ally') return 'ally';
  if (entry.stage === 'mutual') return 'mutual';
  if (entry.isTarget) return 'target';
  return null;
}

// Re-derive personTier on every sighting from the current rankmap. Returns a
// new array; only rows whose tier actually changed are cloned. Handles are
// matched case-insensitively (rankmap keys are lowercased people handles; a
// sighting's handle is the raw scraped username).
export function stampTiers(sightings: RadarSighting[], map: RankMap): RadarSighting[] {
  return sightings.map((s) => {
    const tier = personTierFor(map[s.handle.toLowerCase()]);
    if (tier === (s.personTier ?? null)) return s;
    // Rebuild without personTier when it clears — exactOptionalPropertyTypes
    // forbids assigning `undefined`, biome forbids `delete`.
    const { personTier: _prev, ...rest } = s;
    return tier ? { ...rest, personTier: tier } : rest;
  });
}

// Higher tier ranks first: ally/mutual (an existing relationship) beat a target,
// which beats an unknown author. ally and mutual share the top rung.
function tierWeight(t: PersonTier | undefined): number {
  if (t === 'ally' || t === 'mutual') return 2;
  if (t === 'target') return 1;
  return 0;
}

// How loud the tweet itself is. hot > warm > roster: a roster capture (GT.8) is
// in the queue for who posted it, and the tier comparison above has already had
// its say about that — so within a tier it sits below a real verdict.
//
// 'cannon' weighs 0 here on purpose, unlike its stickiness rung above: the main
// Queue is the reciprocity lane, ranked tier-first, and an arbitrage capture
// must not outrank a hot one inside it. The cannon ordering (by score, by age)
// lives in the Cannon view and nowhere else.
function bandWeight(b: RadarBand): number {
  if (b === 'hot') return 2;
  if (b === 'warm') return 1;
  return 0; // roster / cannon — and 'manual', which never reaches here against a non-pin
}

// Queue order: a manual add (the human pinned it, RU.8) tops everything; then
// (S0.3) who the author is (roster tier), THEN band (hot over warm over the
// GT.8 roster capture), then views-per-minute, then recency — the original
// order preserved within a rung.
export function rankSightings(sightings: RadarSighting[]): RadarSighting[] {
  return [...sightings].sort((a, b) => {
    const am = a.band === 'manual' ? 1 : 0;
    const bm = b.band === 'manual' ? 1 : 0;
    if (am !== bm) return bm - am;
    const tw = tierWeight(b.personTier) - tierWeight(a.personTier);
    if (tw !== 0) return tw;
    const bw = bandWeight(b.band) - bandWeight(a.band);
    if (bw !== 0) return bw;
    if (a.signals.vpm !== b.signals.vpm) return b.signals.vpm - a.signals.vpm;
    return b.lastSeenAt.localeCompare(a.lastSeenAt);
  });
}

// A clicked sighting (its reply was copied) leaves the live queue for the
// "Clicked" view, most-recently-clicked first. The queue keeps the caller's
// existing rank.
export function splitClicked(ranked: RadarSighting[]): {
  queue: RadarSighting[];
  clicked: RadarSighting[];
} {
  const queue: RadarSighting[] = [];
  const clicked: RadarSighting[] = [];
  for (const s of ranked) (s.clickedAt ? clicked : queue).push(s);
  clicked.sort((a, b) => (b.clickedAt ?? '').localeCompare(a.clickedAt ?? ''));
  return { queue, clicked };
}

// Within the live queue, keep reply-ready and freshly-discovered tweets in
// separate blocks so they don't interleave. Order inside each block is the
// caller's rank.
export function groupQueue(queue: RadarSighting[]): {
  ready: RadarSighting[];
  fresh: RadarSighting[];
} {
  const ready: RadarSighting[] = [];
  const fresh: RadarSighting[] = [];
  for (const s of queue) (s.reply ? ready : fresh).push(s);
  return { ready, fresh };
}

// How old the tweet is on screen. `signals.ageMin` was measured at lastSeenAt
// and the tweet keeps aging while the row sits in the queue, so the displayed
// age is capture age + time since capture. An unparseable `lastSeenAt` falls
// back to the capture age rather than to NaN — same instinct as pruneStale's.
//
// CQ.5 moved this out of Radar.tsx: the Cannon view's 30-minute cutoff and the
// age it prints have to be one reading. Two functions would eventually let the
// list show `28m` on a row the filter had already decided was 31 minutes old.
export function displayAgeMin(s: RadarSighting, nowMs: number): number {
  const sinceSeen = (nowMs - Date.parse(s.lastSeenAt)) / 60000;
  return s.signals.ageMin + (Number.isFinite(sinceSeen) ? Math.max(0, sinceSeen) : 0);
}

// CQ.5 — one row of the Cannon view: the sighting plus the three numbers the
// membership decision already computed, so the component never recomputes (and
// never disagrees with) them.
export interface CannonRow {
  s: RadarSighting;
  /** views / (replies + 1), from the shared scorer. */
  score: number;
  /** displayAgeMin at the nowMs the queue was built with. */
  ageMin: number;
  /** How that age renders — 'red' past `redAgeMin`, still eligible. */
  tone: 'ok' | 'red';
}

// The arbitrage lane: fresh posts with a lot of eyes and almost no replies.
//
// Membership is two independent halves (decision 4). `band === 'cannon'` is the
// CAPTURE reason — content.ts queued it because the author is on the camped
// roster, or because it cleared the floor when it was sighted — and it holds
// even if the row has since fallen under the floor: the reason it is here is
// not a number that has to keep being true. The score test is the READ-TIME
// half, which is what lets a tweet the classifier already called `hot` appear
// here without being re-banded.
//
// The `maxAgeMin` cutoff is display-time filtering and nothing else (decision
// 5): the row stays in the buffer under its own 24h TTL and keeps its place in
// the main Queue. `hidden` is what makes that visible — "you missed the window"
// and "there was nothing to shoot at" are different facts, and only one of them
// is a reason to go change the roster.
//
// Clicked rows are excluded. The caller passes the QUEUE (groupQueue's
// contract), so this is belt-and-braces — but a clicked row surfacing in a
// lane whose whole promise is "not worked yet" is the one failure worth a line.
export function cannonQueue(
  sightings: RadarSighting[],
  nowMs: number,
  t: CannonThresholds = CANNON,
): { rows: CannonRow[]; hidden: number } {
  const rows: CannonRow[] = [];
  let hidden = 0;
  for (const s of sightings) {
    if (s.clickedAt) continue;
    const score = cannonScore(s.signals);
    if (s.band !== 'cannon' && score < t.scoreMin) continue;
    const ageMin = displayAgeMin(s, nowMs);
    if (ageMin > t.maxAgeMin) {
      hidden += 1;
      continue;
    }
    rows.push({ s, score, ageMin, tone: cannonAgeTone(ageMin, t) });
  }
  // Score desc — the whole point of the lane — then the fresher sighting, which
  // is the tiebreak the rest of the queue uses.
  rows.sort((a, b) =>
    a.score !== b.score ? b.score - a.score : b.s.lastSeenAt.localeCompare(a.s.lastSeenAt),
  );
  return { rows, hidden };
}

// RC.4 — how a "Curate & draft" click splits the fresh queue before it spends.
// Three buckets, and the sum is always the input: a curated pass may dismiss a
// row on the scorer's verdict, never by losing track of it here.
export interface CuratePartition {
  /** ⊕ manual pins (RU.8) — never sent for scoring, always drafted, ahead of
   *  the survivors. A deliberate human click outranks the model (decision 4).
   *  `roster`/`hot`/`warm` are all scored: content quality is exactly what the
   *  band numbers can't see. */
  pinned: RadarSighting[];
  /** Rows the scorer can grade — the ones the curate call is spent on. */
  scoreable: RadarSighting[];
  /** Rows a curated pass cannot touch at all, because they carry no text: an
   *  image-only sighting has `text: ''` (the card renders its url instead).
   *  Scoring is text-only (decision 5) so there is nothing to grade, and the
   *  server's tweet validator refuses an empty text for the WHOLE request —
   *  one such row in a 40-tweet queue would 400 the entire pass. They stay
   *  queued and undrafted; "Draft replies" is still there for them. */
  skipped: RadarSighting[];
}

export function partitionForCurate(rows: RadarSighting[]): CuratePartition {
  const pinned: RadarSighting[] = [];
  const scoreable: RadarSighting[] = [];
  const skipped: RadarSighting[] = [];
  for (const s of rows) {
    if (s.text.trim() === '') skipped.push(s);
    else if (s.band === 'manual') pinned.push(s);
    else scoreable.push(s);
  }
  return { pinned, scoreable, skipped };
}

// --- server rehydration (CIRCLES-PLAN C0) ---

// A radar_drafts row as GET /x/radar/drafts returns it (timestamps as ISO).
export interface RadarDraftRow {
  id: string;
  tweetId: string;
  url: string | null;
  handle: string;
  author: string | null;
  snippet: string;
  band: RadarBand | null;
  signals: TweetSignals | null;
  replyText: string;
  angle: string;
  // All 3 angle variants (RU.2 column); null on pre-feature / CLI-primary rows.
  // replyText/angle stay the primary (variants[0]).
  variants: ReplyVariant[] | null;
  status: 'ready' | 'clicked' | 'expired';
  draftedAt: string;
  createdAt: string;
}

// Rebuild a sighting from the server copy after a browser restart wiped the
// session buffer. Rows without band/signals (CLI-originated drafts) can't be
// ranked or given a "why" line, so they don't rehydrate. seen-at times are the
// draft time — displayAgeMin keeps ticking from there, same as a live capture.
export function draftRowToSighting(row: RadarDraftRow): RadarSighting | null {
  if (!row.band || !row.signals) return null;
  const s: RadarSighting = {
    tweetId: row.tweetId,
    url: row.url ?? `https://x.com/${row.handle}/status/${row.tweetId}`,
    handle: row.handle,
    author: row.author,
    text: row.snippet,
    band: row.band,
    signals: row.signals,
    firstSeenAt: row.draftedAt,
    lastSeenAt: row.draftedAt,
    reply: row.replyText,
  };
  if (row.variants && row.variants.length > 0) s.variants = row.variants;
  return s;
}

export function isRadarSighting(v: unknown): v is RadarSighting {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.tweetId === 'string' &&
    typeof r.url === 'string' &&
    (r.band === 'hot' ||
      r.band === 'warm' ||
      r.band === 'manual' ||
      r.band === 'roster' ||
      r.band === 'cannon') &&
    typeof r.signals === 'object' &&
    r.signals !== null
  );
}

export function isRadarSightings(v: unknown): v is RadarSighting[] {
  return Array.isArray(v) && v.every(isRadarSighting);
}

// Read a stored buffer: keep every row that IS a sighting, drop the ones that
// aren't. The all-or-nothing guard above used to be the reader, and that made
// one malformed row (a hand-edited buffer, a future field, a half-written set)
// silently equivalent to an empty queue — which the writers then persisted,
// turning a single bad row into a wiped queue. A reader that can only ever
// delete the rows it can't parse cannot do that.
export function coerceSightings(v: unknown): RadarSighting[] {
  return Array.isArray(v) ? v.filter(isRadarSighting) : [];
}

// Drop sightings last seen more than `ttlMs` ago (see RADAR_TTL_MS). An
// unparseable `lastSeenAt` is KEPT, not dropped: the TTL exists to retire dead
// opportunities, and a bad timestamp is a reason to distrust the clock, not a
// reason to throw the row away.
export function pruneStale(
  sightings: RadarSighting[],
  nowMs: number,
  ttlMs: number = RADAR_TTL_MS,
): RadarSighting[] {
  return sightings.filter((s) => {
    const seen = Date.parse(s.lastSeenAt);
    return Number.isFinite(seen) ? nowMs - seen < ttlMs : true;
  });
}
