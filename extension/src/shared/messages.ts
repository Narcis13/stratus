// Wire format for chrome.runtime.sendMessage between extension contexts and
// the background service worker. The background worker is the only place that
// reads the bearer token and attaches the Authorization header.

import type { RadarSighting } from './radar.ts';

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequest {
  type: 'stratus/api';
  method: ApiMethod;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
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
  replies: { tweetId: string; reply: string }[];
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
