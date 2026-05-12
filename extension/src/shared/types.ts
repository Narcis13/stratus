// Shared between the side panel, content script, and background worker.
// Mirrors the server route shapes in src/x/routes/calendar.ts and voice.ts.

export type PostStatus = 'draft' | 'pending' | 'posted' | 'failed' | 'cancelled';

export interface ScheduledPost {
  id: string;
  text: string;
  mediaIds: string[] | null;
  scheduledFor: string | null;
  status: PostStatus;
  postedTweetId: string | null;
  errorClass: string | null;
  errorDetail: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBody {
  text: string;
  scheduledFor?: string | null;
  status?: 'draft' | 'pending';
  mediaIds?: string[] | null;
}

export interface UpdateBody {
  text?: string;
  scheduledFor?: string | null;
  status?: 'draft' | 'pending' | 'cancelled';
  mediaIds?: string[] | null;
}

export interface ListOpts {
  from?: string;
  to?: string;
  status?: PostStatus;
}

// ---------------------------------------------------------------- voice

export type VoiceAuthorSource = 'manual' | 'auto_from_scrape';

export interface VoiceAuthor {
  xUserId: string;
  username: string;
  addedAt: string;
  lastPulledAt: string | null;
  source: VoiceAuthorSource;
  pullEnabled: boolean;
  metricsPollingEnabled: boolean;
  maxPolledTweets: number;
  tweetCount: number;
}

export interface VoicePublicMetrics {
  retweet_count?: number;
  reply_count?: number;
  like_count?: number;
  quote_count?: number;
  bookmark_count?: number;
  impression_count?: number;
}

export interface VoiceTweet {
  tweetId: string;
  authorXUserId: string;
  authorUsername: string;
  text: string;
  createdAt: string;
  isReply: boolean;
  inReplyToTweetId: string | null;
  conversationId: string | null;
  source: string;
  fetchedAt: string;
  lastSeenAt: string | null;
  nextPollAt: string | null;
  pollCount: number;
  retired: boolean;
  latestPublicMetrics: VoicePublicMetrics | null;
}

export interface VoiceTweetsOpts {
  author?: string;
  q?: string;
  minLikes?: number;
  includeReplies?: boolean;
  limit?: number;
}

export interface VoiceAuthorPatch {
  pullEnabled?: boolean;
  metricsPollingEnabled?: boolean;
  maxPolledTweets?: number;
  source?: VoiceAuthorSource;
}

// --------------------------------------------------------------- replies

export type ReplyDraftStatus = 'generated' | 'copied' | 'posted' | 'discarded';

export interface TopComment {
  author: string;
  handle: string;
  text: string;
}

export interface PostContextMetrics {
  views: number;
  replies: number;
  reposts: number;
  likes: number;
}

export interface PostContext {
  tweetId: string;
  handle: string;
  author: string;
  text: string;
  url: string;
  postedAt: string;
  metrics: PostContextMetrics;
  topComments: TopComment[];
}

export interface ReplyDraft {
  id: string;
  sourceTweetId: string;
  sourceAuthorUsername: string;
  sourceAuthorDisplayName: string | null;
  sourceText: string;
  sourceUrl: string;
  sourcePostedAt: string | null;
  contextSnapshot: PostContext;
  replyText: string;
  replyTextEdited: string | null;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: string | null;
  grokRequestId: string | null;
  systemPromptOverride: string | null;
  status: ReplyDraftStatus;
  postedTweetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RepliesListOpts {
  status?: ReplyDraftStatus;
  sourceAuthor?: string;
  limit?: number;
  since?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
  }
}
