// Typed thin client over the stratus API. Since §9.5 every call routes through
// the background service worker (shared/messages.ts ApiRequest) — one transport,
// one place that reads the bearer token and stamps the Authorization header.
// The `Settings` parameter stays in the signatures so callers keep gating on
// configuration, but the background loads its own copy from chrome.storage.

import type { ApiRequest, ApiResponse } from '../shared/messages.ts';
import {
  ApiError,
  type AuthorProfile,
  type BatchReplyGenerateBody,
  type BatchReplyItem,
  type BatchReplyResponse,
  type BatchReplyTweet,
  type Brief,
  type BriefTweet,
  type ContentPillar,
  type CreateBody,
  type CreateThreadBody,
  type CreateThreadResponse,
  type ListOpts,
  type Mention,
  type MentionPatchBody,
  type MentionStatus,
  type MentionsRefreshResult,
  type MentionsResponse,
  type PillarCreateBody,
  type PillarDraftBody,
  type PillarDraftResult,
  type PillarUpdateBody,
  type PostContext,
  type PostDraftBody,
  type PostDraftResponse,
  type PostReupBody,
  type PostStatus,
  type RepliesListOpts,
  type ReplyDraft,
  type ReplyDraftStatus,
  type ReplyGenerateBody,
  type ReplyPatchBody,
  type ScheduledPost,
  type ScheduledPostWithThread,
  type ScrapeBody,
  type TopComment,
  type UpdateBody,
  type VoiceAuthor,
  type VoiceExtractBatchResult,
  type VoiceTarget,
  type VoiceTargets,
  type VoiceTweet,
  type VoiceTweetsOpts,
} from '../shared/types.ts';
import type { Settings } from './storage.ts';

export { ApiError };
export type {
  AuthorProfile,
  BatchReplyGenerateBody,
  BatchReplyItem,
  BatchReplyResponse,
  BatchReplyTweet,
  Brief,
  BriefTweet,
  ContentPillar,
  CreateBody,
  CreateThreadBody,
  CreateThreadResponse,
  ListOpts,
  Mention,
  PillarCreateBody,
  PillarDraftBody,
  PillarDraftResult,
  PillarUpdateBody,
  MentionPatchBody,
  MentionStatus,
  MentionsRefreshResult,
  MentionsResponse,
  PostContext,
  PostDraftBody,
  PostDraftResponse,
  PostReupBody,
  PostStatus,
  RepliesListOpts,
  ReplyDraft,
  ReplyDraftStatus,
  ReplyGenerateBody,
  ReplyPatchBody,
  ScheduledPost,
  ScheduledPostWithThread,
  ScrapeBody,
  TopComment,
  UpdateBody,
  VoiceAuthor,
  VoiceExtractBatchResult,
  VoiceTarget,
  VoiceTargets,
  VoiceTweet,
  VoiceTweetsOpts,
};

interface RequestInitLite {
  method?: ApiRequest['method'];
  body?: unknown;
}

async function request<T>(_s: Settings, path: string, init: RequestInitLite = {}): Promise<T> {
  const payload: ApiRequest = {
    type: 'stratus/api',
    method: init.method ?? 'GET',
    path,
    ...(init.body !== undefined && init.body !== null ? { body: init.body } : {}),
  };
  const res = (await chrome.runtime.sendMessage(payload)) as ApiResponse<T> | undefined;
  if (!res) throw new ApiError(0, 'no_response');
  if (!res.ok) throw new ApiError(res.status, res.code);
  return res.data;
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

  // Single-row fetch (§9.5) — thread members carry their siblings.
  get(s: Settings, id: string): Promise<ScheduledPostWithThread> {
    return request<ScheduledPostWithThread>(s, `/x/posts/scheduled/${id}`);
  },

  create(s: Settings, body: CreateBody): Promise<ScheduledPost> {
    return request<ScheduledPost>(s, '/x/posts/scheduled', { method: 'POST', body });
  },

  createThread(s: Settings, body: CreateThreadBody): Promise<CreateThreadResponse> {
    return request<CreateThreadResponse>(s, '/x/posts/threads', { method: 'POST', body });
  },

  update(s: Settings, id: string, body: UpdateBody): Promise<ScheduledPost> {
    return request<ScheduledPost>(s, `/x/posts/scheduled/${id}`, { method: 'PATCH', body });
  },

  remove(s: Settings, id: string): Promise<void> {
    return request<void>(s, `/x/posts/scheduled/${id}`, { method: 'DELETE' });
  },

  drafts: {
    // §8.1 — three register-distinct drafts land as draft rows in the calendar.
    generate(s: Settings, body: PostDraftBody): Promise<PostDraftResponse> {
      return request<PostDraftResponse>(s, '/x/posts/draft', { method: 'POST', body });
    },

    // §8.5 — quote-tweet re-up of one of my published posts.
    reup(s: Settings, body: PostReupBody): Promise<PostDraftResponse> {
      return request<PostDraftResponse>(s, '/x/posts/reup', { method: 'POST', body });
    },
  },

  // §8.6 — editable content pillars (Voice → Pillars subtab + Composer dropdown).
  pillars: {
    list(s: Settings, opts: { active?: boolean } = {}): Promise<ContentPillar[]> {
      const qs = opts.active === undefined ? '' : `?active=${opts.active}`;
      return request<ContentPillar[]>(s, `/x/pillars${qs}`);
    },

    create(s: Settings, body: PillarCreateBody): Promise<ContentPillar> {
      return request<ContentPillar>(s, '/x/pillars', { method: 'POST', body });
    },

    update(s: Settings, slug: string, body: PillarUpdateBody): Promise<ContentPillar> {
      return request<ContentPillar>(s, `/x/pillars/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        body,
      });
    },

    remove(s: Settings, slug: string): Promise<unknown> {
      return request<unknown>(s, `/x/pillars/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    },

    // Grok proposal (not persisted) — review/edit, then create/update to save.
    draft(s: Settings, body: PillarDraftBody): Promise<PillarDraftResult> {
      return request<PillarDraftResult>(s, '/x/pillars/draft', { method: 'POST', body });
    },
  },

  voice: {
    listAuthors(s: Settings, opts: { retired?: boolean } = {}): Promise<VoiceAuthor[]> {
      const qs = opts.retired ? '?retired=true' : '';
      return request<VoiceAuthor[]>(s, `/x/voice/authors${qs}`);
    },

    targets(s: Settings): Promise<VoiceTargets> {
      return request<VoiceTargets>(s, '/x/voice/targets');
    },

    listTweets(s: Settings, opts: VoiceTweetsOpts = {}): Promise<VoiceTweet[]> {
      const q = new URLSearchParams();
      if (opts.author) q.set('author', opts.author);
      if (opts.q) q.set('q', opts.q);
      if (opts.hook) q.set('hook', opts.hook);
      if (opts.extracted !== undefined) q.set('extracted', String(opts.extracted));
      if (opts.limit !== undefined) q.set('limit', String(opts.limit));
      if (opts.retired) q.set('retired', 'true');
      const qs = q.toString();
      return request<VoiceTweet[]>(s, `/x/voice/tweets${qs ? `?${qs}` : ''}`);
    },

    scrape(s: Settings, body: ScrapeBody): Promise<{ tweet: VoiceTweet; author: VoiceAuthor }> {
      return request(s, '/x/voice/scrape', { method: 'POST', body });
    },

    enrichAuthor(s: Settings, handle: string, profile: AuthorProfile): Promise<VoiceAuthor> {
      return request<VoiceAuthor>(s, `/x/voice/authors/${encodeURIComponent(handle)}`, {
        method: 'PUT',
        body: profile,
      });
    },

    // §8.3 — one Grok structured-output pass distilling the tweet's skeleton.
    extractTemplate(s: Settings, tweetId: string): Promise<{ tweet: VoiceTweet; costUsd: number }> {
      return request(s, `/x/voice/tweets/${encodeURIComponent(tweetId)}/extract`, {
        method: 'POST',
        body: {},
      });
    },

    extractBatch(s: Settings, limit?: number): Promise<VoiceExtractBatchResult> {
      return request<VoiceExtractBatchResult>(s, '/x/voice/extract-batch', {
        method: 'POST',
        body: limit !== undefined ? { limit } : {},
      });
    },

    retireTweet(s: Settings, tweetId: string, retired: boolean): Promise<VoiceTweet> {
      return request<VoiceTweet>(s, `/x/voice/tweets/${encodeURIComponent(tweetId)}`, {
        method: 'PATCH',
        body: { retired },
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
        body: { retired },
      });
    },

    deleteAuthor(s: Settings, handle: string): Promise<unknown> {
      return request<unknown>(s, `/x/voice/authors/${encodeURIComponent(handle)}`, {
        method: 'DELETE',
      });
    },
  },

  mentions: {
    list(
      s: Settings,
      opts: { status?: MentionStatus; limit?: number } = {},
    ): Promise<MentionsResponse> {
      const q = new URLSearchParams();
      if (opts.status) q.set('status', opts.status);
      if (opts.limit !== undefined) q.set('limit', String(opts.limit));
      const qs = q.toString();
      return request<MentionsResponse>(s, `/x/mentions${qs ? `?${qs}` : ''}`);
    },

    refresh(s: Settings): Promise<MentionsRefreshResult> {
      return request<MentionsRefreshResult>(s, '/x/mentions/refresh', {
        method: 'POST',
        body: {},
      });
    },

    patch(s: Settings, tweetId: string, body: MentionPatchBody): Promise<Mention> {
      return request<Mention>(s, `/x/mentions/${encodeURIComponent(tweetId)}`, {
        method: 'PATCH',
        body,
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
      // §8.6: the Settings toggle rides along centrally so no call site changes.
      return request<ReplyDraft>(s, '/x/replies/generate', {
        method: 'POST',
        body: { ...body, applyPillars: s.applyPillarsToReplies },
      });
    },

    // §7.2 — one Grok call drafts a reply per queued Radar tweet (not persisted).
    generateBatch(s: Settings, body: BatchReplyGenerateBody): Promise<BatchReplyResponse> {
      return request<BatchReplyResponse>(s, '/x/replies/generate-batch', {
        method: 'POST',
        body: { ...body, applyPillars: s.applyPillarsToReplies },
      });
    },

    patch(s: Settings, id: string, body: ReplyPatchBody): Promise<ReplyDraft> {
      return request<ReplyDraft>(s, `/x/replies/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body,
      });
    },

    remove(s: Settings, id: string): Promise<void> {
      return request<void>(s, `/x/replies/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  },
};
