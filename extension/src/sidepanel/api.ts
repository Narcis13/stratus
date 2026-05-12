// Typed thin client over the stratus API. The side panel calls this directly
// using bearer + apiUrl from chrome.storage.local; the background-routed
// client lives in shared/bgClient.ts and is what content scripts use.

import {
  ApiError,
  type CreateBody,
  type ListOpts,
  type PostContext,
  type PostStatus,
  type RepliesListOpts,
  type ReplyDraft,
  type ReplyDraftStatus,
  type ScheduledPost,
  type TopComment,
  type UpdateBody,
  type VoiceAuthor,
  type VoiceAuthorPatch,
  type VoiceAuthorSource,
  type VoiceTweet,
  type VoiceTweetsOpts,
} from '../shared/types.ts';
import type { Settings } from './storage.ts';

export { ApiError };
export type {
  CreateBody,
  ListOpts,
  PostContext,
  PostStatus,
  RepliesListOpts,
  ReplyDraft,
  ReplyDraftStatus,
  ScheduledPost,
  TopComment,
  UpdateBody,
  VoiceAuthor,
  VoiceAuthorPatch,
  VoiceAuthorSource,
  VoiceTweet,
  VoiceTweetsOpts,
};

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

  voice: {
    listAuthors(s: Settings, source?: VoiceAuthorSource): Promise<VoiceAuthor[]> {
      const qs = source ? `?source=${encodeURIComponent(source)}` : '';
      return request<VoiceAuthor[]>(s, `/x/voice/authors${qs}`);
    },

    listTweets(s: Settings, opts: VoiceTweetsOpts = {}): Promise<VoiceTweet[]> {
      const q = new URLSearchParams();
      if (opts.author) q.set('author', opts.author);
      if (opts.q) q.set('q', opts.q);
      if (opts.minLikes !== undefined) q.set('minLikes', String(opts.minLikes));
      if (opts.includeReplies) q.set('includeReplies', 'true');
      if (opts.limit !== undefined) q.set('limit', String(opts.limit));
      const qs = q.toString();
      return request<VoiceTweet[]>(s, `/x/voice/tweets${qs ? `?${qs}` : ''}`);
    },

    patchAuthor(s: Settings, username: string, patch: VoiceAuthorPatch): Promise<VoiceAuthor> {
      return request<VoiceAuthor>(s, `/x/voice/authors/${encodeURIComponent(username)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
    },

    untrack(s: Settings, username: string): Promise<unknown> {
      return request<unknown>(s, `/x/voice/track/${encodeURIComponent(username)}`, {
        method: 'DELETE',
      });
    },
  },

  replies: {
    list(s: Settings, opts: RepliesListOpts = {}): Promise<ReplyDraft[]> {
      const q = new URLSearchParams();
      if (opts.status) q.set('status', opts.status);
      if (opts.sourceAuthor) q.set('sourceAuthor', opts.sourceAuthor);
      if (opts.limit !== undefined) q.set('limit', String(opts.limit));
      if (opts.since) q.set('since', opts.since);
      const qs = q.toString();
      return request<ReplyDraft[]>(s, `/x/replies${qs ? `?${qs}` : ''}`);
    },
  },
};
