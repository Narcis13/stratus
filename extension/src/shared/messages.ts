// Wire format for chrome.runtime.sendMessage between extension contexts and
// the background service worker. The background worker is the only place that
// reads the bearer token and attaches the Authorization header.

export type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

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
