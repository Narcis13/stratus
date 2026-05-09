// Typed client that routes through the background service worker. Use this
// from contexts that don't read settings directly (content scripts, future
// scrape buttons). The side panel can also use it; today the side panel keeps
// its own direct path (sidepanel/api.ts) for latency.

import type { ApiRequest, ApiResponse } from './messages.ts';
import {
  ApiError,
  type CreateBody,
  type ListOpts,
  type ScheduledPost,
  type UpdateBody,
} from './types.ts';

async function send<T>(req: Omit<ApiRequest, 'type'>): Promise<T> {
  const payload: ApiRequest = { type: 'stratus/api', ...req };
  const res = (await chrome.runtime.sendMessage(payload)) as ApiResponse<T> | undefined;
  if (!res) throw new ApiError(0, 'no_response');
  if (!res.ok) throw new ApiError(res.status, res.code);
  return res.data;
}

function buildQuery(opts: ListOpts): Record<string, string> {
  const q: Record<string, string> = {};
  if (opts.from) q.from = opts.from;
  if (opts.to) q.to = opts.to;
  if (opts.status) q.status = opts.status;
  return q;
}

export const bgApi = {
  list(opts: ListOpts = {}): Promise<ScheduledPost[]> {
    return send<ScheduledPost[]>({
      method: 'GET',
      path: '/x/posts/scheduled',
      query: buildQuery(opts),
    });
  },

  create(body: CreateBody): Promise<ScheduledPost> {
    return send<ScheduledPost>({ method: 'POST', path: '/x/posts/scheduled', body });
  },

  update(id: string, body: UpdateBody): Promise<ScheduledPost> {
    return send<ScheduledPost>({
      method: 'PATCH',
      path: `/x/posts/scheduled/${id}`,
      body,
    });
  },

  remove(id: string): Promise<void> {
    return send<void>({ method: 'DELETE', path: `/x/posts/scheduled/${id}` });
  },
};

export { ApiError };
