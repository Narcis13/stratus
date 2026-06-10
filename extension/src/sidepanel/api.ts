// Typed thin client over the stratus API. The side panel calls this directly
// using bearer + apiUrl from chrome.storage.local; the background-routed
// client lives in shared/bgClient.ts and is what content scripts use.

import {
  ApiError,
  type AuthorProfile,
  type Brief,
  type BriefTweet,
  type CreateBody,
  type ListOpts,
  type PostContext,
  type PostStatus,
  type RepliesListOpts,
  type ReplyDraft,
  type ReplyDraftStatus,
  type ReplyGenerateBody,
  type ReplyPatchBody,
  type ScheduledPost,
  type ScrapeBody,
  type TopComment,
  type UpdateBody,
  type VoiceAuthor,
  type VoiceTweet,
  type VoiceTweetsOpts,
} from '../shared/types.ts';
import type { Settings } from './storage.ts';

export { ApiError };
export type {
  AuthorProfile,
  Brief,
  BriefTweet,
  CreateBody,
  ListOpts,
  PostContext,
  PostStatus,
  RepliesListOpts,
  ReplyDraft,
  ReplyDraftStatus,
  ReplyGenerateBody,
  ReplyPatchBody,
  ScheduledPost,
  ScrapeBody,
  TopComment,
  UpdateBody,
  VoiceAuthor,
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
  // The server computes "today"/"yesterday" in the browser's timezone;
  // getTimezoneOffset() is UTC − local (e.g. -180 for UTC+3).
  brief(s: Settings): Promise<Brief> {
    return request<Brief>(s, `/x/brief?tzOffsetMin=${new Date().getTimezoneOffset()}`);
  },

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
    listAuthors(s: Settings, opts: { retired?: boolean } = {}): Promise<VoiceAuthor[]> {
      const qs = opts.retired ? '?retired=true' : '';
      return request<VoiceAuthor[]>(s, `/x/voice/authors${qs}`);
    },

    listTweets(s: Settings, opts: VoiceTweetsOpts = {}): Promise<VoiceTweet[]> {
      const q = new URLSearchParams();
      if (opts.author) q.set('author', opts.author);
      if (opts.q) q.set('q', opts.q);
      if (opts.limit !== undefined) q.set('limit', String(opts.limit));
      if (opts.retired) q.set('retired', 'true');
      const qs = q.toString();
      return request<VoiceTweet[]>(s, `/x/voice/tweets${qs ? `?${qs}` : ''}`);
    },

    scrape(s: Settings, body: ScrapeBody): Promise<{ tweet: VoiceTweet; author: VoiceAuthor }> {
      return request(s, '/x/voice/scrape', { method: 'POST', body: JSON.stringify(body) });
    },

    enrichAuthor(s: Settings, handle: string, profile: AuthorProfile): Promise<VoiceAuthor> {
      return request<VoiceAuthor>(s, `/x/voice/authors/${encodeURIComponent(handle)}`, {
        method: 'PUT',
        body: JSON.stringify(profile),
      });
    },

    retireTweet(s: Settings, tweetId: string, retired: boolean): Promise<VoiceTweet> {
      return request<VoiceTweet>(s, `/x/voice/tweets/${encodeURIComponent(tweetId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ retired }),
      });
    },

    deleteTweet(s: Settings, tweetId: string): Promise<unknown> {
      return request<unknown>(s, `/x/voice/tweets/${encodeURIComponent(tweetId)}`, {
        method: 'DELETE',
      });
    },

    retireAuthor(s: Settings, handle: string, retired: boolean): Promise<VoiceAuthor> {
      return request<VoiceAuthor>(s, `/x/voice/authors/${encodeURIComponent(handle)}`, {
        method: 'PATCH',
        body: JSON.stringify({ retired }),
      });
    },

    deleteAuthor(s: Settings, handle: string): Promise<unknown> {
      return request<unknown>(s, `/x/voice/authors/${encodeURIComponent(handle)}`, {
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

    get(s: Settings, id: string): Promise<ReplyDraft> {
      return request<ReplyDraft>(s, `/x/replies/${encodeURIComponent(id)}`);
    },

    generate(s: Settings, body: ReplyGenerateBody): Promise<ReplyDraft> {
      return request<ReplyDraft>(s, '/x/replies/generate', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },

    patch(s: Settings, id: string, body: ReplyPatchBody): Promise<ReplyDraft> {
      return request<ReplyDraft>(s, `/x/replies/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    },

    remove(s: Settings, id: string): Promise<void> {
      return request<void>(s, `/x/replies/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  },
};
