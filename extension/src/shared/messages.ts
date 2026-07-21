// Wire format for chrome.runtime.sendMessage between extension contexts and
// the background service worker. The background worker is the only place that
// reads the bearer token and attaches the Authorization header.

import type { EarlyReply } from './launch.ts';
import type { RadarSighting } from './radar.ts';
import type { ReplyVariant } from './types.ts';

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequest {
  type: 'stratus/api';
  method: ApiMethod;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  // §S4: when true, the background reads a non-JSON (image) response as bytes
  // and returns `data: { base64, mediaType }` — the JSON message channel can't
  // carry a Blob, so binary rides as base64. Used by GET /x/assets/:id/png to
  // re-open a saved asset without ever leaving the one-transport discipline.
  binary?: boolean;
}

/** Shape the background returns for a binary ApiRequest. */
export interface BinaryPayload {
  base64: string;
  mediaType: string;
}

export type ApiResponse<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string };

export function isApiRequest(msg: unknown): msg is ApiRequest {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.type === 'stratus/api' && typeof m.method === 'string' && typeof m.path === 'string';
}

// --- Radar (§7.2) — both routed through the background so it stays the
// single writer of the chrome.storage.session ring buffer (no transactions
// there; concurrent read-modify-writes from tabs + panel would drop entries).

export interface RadarReport {
  type: 'stratus/radar-report';
  sightings: RadarSighting[];
}

export interface RadarDismiss {
  type: 'stratus/radar-dismiss';
  tweetIds: string[];
}

// Batch-drafted replies attached to existing sightings (§7.2). Routed through
// the background so it stays the single writer of the session ring buffer.
export interface RadarReplies {
  type: 'stratus/radar-replies';
  // `reply` is the primary (variants[0].text); `variants` carries all 3 angles
  // (RU.4) so the buffer can serve the on-page variant chips (Task 7).
  replies: { tweetId: string; reply: string; variants?: ReplyVariant[] }[];
}

// User clicked a reply-ready Radar row (its reply was copied). Routed through
// the background so it stays the single writer: the sighting is stamped
// clickedAt and moves from the queue to the "Clicked" view.
export interface RadarClick {
  type: 'stratus/radar-click';
  tweetId: string;
  clickedAt: string;
}

// Rehydrate the session buffer from the server's radar_drafts copy (C0) —
// sent by the panel on mount; the background (single writer + Authorization
// owner) fetches GET /x/radar/drafts?status=ready and merges rows the buffer
// doesn't already hold, so a browser restart no longer loses drafted replies.
export interface RadarRehydrate {
  type: 'stratus/radar-rehydrate';
}

export function isRadarRehydrate(msg: unknown): msg is RadarRehydrate {
  if (typeof msg !== 'object' || msg === null) return false;
  return (msg as Record<string, unknown>).type === 'stratus/radar-rehydrate';
}

export function isRadarReport(msg: unknown): msg is RadarReport {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.type === 'stratus/radar-report' && Array.isArray(m.sightings);
}

export function isRadarDismiss(msg: unknown): msg is RadarDismiss {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.type === 'stratus/radar-dismiss' && Array.isArray(m.tweetIds);
}

export function isRadarReplies(msg: unknown): msg is RadarReplies {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.type === 'stratus/radar-replies' && Array.isArray(m.replies);
}

export function isRadarClick(msg: unknown): msg is RadarClick {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m.type === 'stratus/radar-click' &&
    typeof m.tweetId === 'string' &&
    typeof m.clickedAt === 'string'
  );
}

// User opened a reply-ready Radar row (RU.6): promote its radar draft into a
// real reply_drafts row. Routed through the background (single writer +
// Authorization owner): it POSTs /x/radar/drafts/:tweetId/confirm and stamps
// the returned draft id onto the sighting, so the on-page paste flow (RU.7)
// can PATCH that row to `posted`.
export interface RadarConfirm {
  type: 'stratus/radar-confirm';
  tweetId: string;
}

export function isRadarConfirm(msg: unknown): msg is RadarConfirm {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.type === 'stratus/radar-confirm' && typeof m.tweetId === 'string';
}

// Content script → background (RU.7): fetch a tweet's radar variants to render
// the on-page chip strip. The background reads the session buffer first, then
// falls back to GET /x/radar/drafts?tweetId= (covers a deep link that skipped
// the panel). Response: `{ ok, variants: ReplyVariant[] | null, draftId }`.
export interface RadarVariantsGet {
  type: 'stratus/radar-variants-get';
  tweetId: string;
}

// Content script → background (RU.7): the user clicked a variant chip (its text
// was typed into the reply box). The background confirms the radar draft into a
// reply_drafts row if needed (idempotent — covers deep links), then PATCHes it
// to `posted` (paste-time semantics, §7.28 — the human still hits Reply). If the
// chosen text differs from the primary it rides as replyTextEdited.
export interface RadarVariantPasted {
  type: 'stratus/radar-variant-pasted';
  tweetId: string;
  text: string;
}

export function isRadarVariantsGet(msg: unknown): msg is RadarVariantsGet {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.type === 'stratus/radar-variants-get' && typeof m.tweetId === 'string';
}

export function isRadarVariantPasted(msg: unknown): msg is RadarVariantPasted {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m.type === 'stratus/radar-variant-pasted' &&
    typeof m.tweetId === 'string' &&
    typeof m.text === 'string'
  );
}

// --- People dossier click-through (AX.6). A timeline chip or the tweet-page
// context-panel header sends OpenPerson on click; the background opens the side
// panel (best-effort — the click is a user gesture that may survive one hop) and
// writes the handoff session key `stratus:openPerson` (background = single
// session writer). App.tsx reads it, routes to the dossier, then sends
// OpenPersonClear so a later panel open can't replay the stale handle.

export interface OpenPerson {
  type: 'stratus/open-person';
  handle: string;
}

export interface OpenPersonClear {
  type: 'stratus/open-person-clear';
}

export function isOpenPerson(msg: unknown): msg is OpenPerson {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.type === 'stratus/open-person' && typeof m.handle === 'string';
}

export function isOpenPersonClear(msg: unknown): msg is OpenPersonClear {
  if (typeof msg !== 'object' || msg === null) return false;
  return (msg as Record<string, unknown>).type === 'stratus/open-person-clear';
}

// --- Launch Room (C7) — all routed through the background: it owns the
// chrome.alarms schedule and is the single writer of the launch:* session keys.

/** Panel → background on Today mount: re-sync alarms against today's pending
 *  scheduled posts (the 15-min periodic alarm covers the rest of the day). */
export interface LaunchSync {
  type: 'stratus/launch-sync';
}

/** Content script → background: is a Launch Room live right now? Response:
 *  `{ ok: true, active: ActiveLaunch | null }`. */
export interface LaunchGet {
  type: 'stratus/launch-get';
}

/** Content script → background: early repliers parsed from the launched
 *  tweet's status page. tweetId names the launch so a stale report (room
 *  already over / different launch) is dropped. */
export interface LaunchReport {
  type: 'stratus/launch-report';
  tweetId: string;
  replies: EarlyReply[];
}

/** Panel → background: close the room early. */
export interface LaunchDismiss {
  type: 'stratus/launch-dismiss';
}

export function isLaunchSync(msg: unknown): msg is LaunchSync {
  if (typeof msg !== 'object' || msg === null) return false;
  return (msg as Record<string, unknown>).type === 'stratus/launch-sync';
}

export function isLaunchGet(msg: unknown): msg is LaunchGet {
  if (typeof msg !== 'object' || msg === null) return false;
  return (msg as Record<string, unknown>).type === 'stratus/launch-get';
}

export function isLaunchReport(msg: unknown): msg is LaunchReport {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m.type === 'stratus/launch-report' && typeof m.tweetId === 'string' && Array.isArray(m.replies)
  );
}

export function isLaunchDismiss(msg: unknown): msg is LaunchDismiss {
  if (typeof msg !== 'object' || msg === null) return false;
  return (msg as Record<string, unknown>).type === 'stratus/launch-dismiss';
}
