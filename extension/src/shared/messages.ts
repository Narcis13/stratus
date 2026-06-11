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
