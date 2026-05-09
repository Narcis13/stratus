// Typed thin client over the stratus API. The side panel calls this directly
// using bearer + apiUrl from chrome.storage.local; the background-routed
// client lives in shared/bgClient.ts and is what content scripts use.

import {
  ApiError,
  type CreateBody,
  type ListOpts,
  type PostStatus,
  type ScheduledPost,
  type UpdateBody,
} from '../shared/types.ts';
import type { Settings } from './storage.ts';

export { ApiError };
export type { CreateBody, ListOpts, PostStatus, ScheduledPost, UpdateBody };

async function request<T>(s: Settings, path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${s.bearer}`,
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  if (init.body !== undefined && init.body !== null) {
    headers['Content-Type'] = 'application/json';
  }
  const r = await fetch(`${s.apiUrl}${path}`, { ...init, headers });
  if (!r.ok) {
    let code = `http_${r.status}`;
    try {
      const body = (await r.json()) as { error?: unknown };
      if (typeof body.error === 'string') code = body.error;
    } catch {
      // body wasn't JSON — keep generic code
    }
    throw new ApiError(r.status, code);
  }
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

export const api = {
  list(s: Settings, opts: ListOpts = {}): Promise<ScheduledPost[]> {
    const q = new URLSearchParams();
    if (opts.from) q.set('from', opts.from);
    if (opts.to) q.set('to', opts.to);
    if (opts.status) q.set('status', opts.status);
    const qs = q.toString();
    return request<ScheduledPost[]>(s, `/x/posts/scheduled${qs ? `?${qs}` : ''}`);
  },

  create(s: Settings, body: CreateBody): Promise<ScheduledPost> {
    return request<ScheduledPost>(s, '/x/posts/scheduled', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  update(s: Settings, id: string, body: UpdateBody): Promise<ScheduledPost> {
    return request<ScheduledPost>(s, `/x/posts/scheduled/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  remove(s: Settings, id: string): Promise<void> {
    return request<void>(s, `/x/posts/scheduled/${id}`, { method: 'DELETE' });
  },
};
