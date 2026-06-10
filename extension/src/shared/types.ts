// Shared between the side panel, content script, and background worker.
// Mirrors the server route shapes in src/x/routes/calendar.ts and voice.ts.

export type PostStatus = 'draft' | 'pending' | 'publishing' | 'posted' | 'failed' | 'cancelled';

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

// A swipe file of other people's tweets, captured straight from the x.com DOM.
// No X API, no metrics — these mirror the server's voice_authors / voice_tweets
// rows (timestamps arrive as ISO strings).

// Author row as returned by GET /x/voice/authors (includes tweetCount).
export interface VoiceAuthor {
  handle: string;
  xUserId: string | null;
  displayName: string | null;
  bio: string | null;
  followersCount: number | null;
  followingCount: number | null;
  pinnedTweetId: string | null;
  pinnedTweetText: string | null;
  profileSummary: string | null;
  profileUrl: string | null;
  source: string;
  addedAt: string;
  enrichedAt: string | null;
  updatedAt: string;
  retired: boolean;
  tweetCount: number;
}

// Stashed tweet as returned by GET /x/voice/tweets.
export interface VoiceTweet {
  tweetId: string;
  authorHandle: string;
  authorDisplayName: string | null;
  text: string;
  scrapedHtml: string | null;
  createdAt: string;
  url: string | null;
  source: string;
  savedAt: string;
  updatedAt: string | null;
  retired: boolean;
}

export interface VoiceTweetsOpts {
  author?: string;
  q?: string;
  limit?: number;
  retired?: boolean;
}

// --- scrape payloads (content script → server) ---

// One tweet read from the DOM. `html` is the innerHTML of [data-testid="tweetText"].
export interface ScrapedTweet {
  tweetId: string;
  handle: string;
  displayName: string | null;
  text: string;
  html: string | null;
  createdAt: string | null;
  url: string | null;
}

// Best-effort author fields scraped from the tweet's hover card.
export interface ScrapedAuthor {
  handle: string;
  displayName: string | null;
  bio: string | null;
  followersCount: number | null;
  followingCount: number | null;
  xUserId: string | null;
}

export interface ScrapeBody {
  tweet: ScrapedTweet;
  author?: ScrapedAuthor;
}

// Full profile-header capture (PUT /x/voice/authors/:handle). All optional —
// whatever the profile page exposed.
export interface AuthorProfile {
  displayName?: string | null;
  bio?: string | null;
  followersCount?: number | null;
  followingCount?: number | null;
  pinnedTweetId?: string | null;
  pinnedTweetText?: string | null;
  xUserId?: string | null;
  profileUrl?: string | null;
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

// Band verdict + the exact classifier inputs (replyBand.ts), frozen at capture
// time so every persisted draft is a labeled row for recalibrating BAND from
// first-party outcomes (GET /x/replies/outcomes, evals/analyze-own-replies.ts).
export interface PostSignals {
  band: 'hot' | 'warm' | 'skip' | null;
  views: number;
  replies: number;
  ageMin: number;
  vpm: number;
  bait: boolean;
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
  signals?: PostSignals;
}

export type ReplyAngle = 'extends' | 'contrarian' | 'debate';

export interface ReplyVariant {
  text: string;
  angle: ReplyAngle;
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
  /** Both Grok variants ({text, angle}); null on pre-7.1 rows. */
  variants: ReplyVariant[] | null;
  /** The optional steer sent with the generate call; null when none. */
  idea: string | null;
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

export interface ReplyGenerateBody {
  context: PostContext;
  /** Optional steer (may be Romanian) substituted into the prompt's <idea> tag. */
  idea?: string;
  systemPromptOverride?: string;
  model?: string;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
}

export interface ReplyPatchBody {
  replyTextEdited?: string | null;
  status?: ReplyDraftStatus;
  postedTweetId?: string | null;
}

// ---------------------------------------------------------------- brief

// GET /x/brief — the Today tab's single payload (src/x/routes/brief.ts).
// Post/reply/schedule windows are the *local* day (we send tzOffsetMin);
// spend stays anchored to the UTC billing day.

export interface BriefTweetMetrics {
  views: number | null;
  likes: number | null;
  replies: number | null;
  retweets: number | null;
  quotes: number | null;
  bookmarks: number | null;
  profileVisits: number | null;
}

export interface BriefTweet {
  tweetId: string;
  text: string;
  postedAt: string;
  isReply: boolean;
  measuredAt: string | null;
  // null until the 03:00 UTC pass has snapshotted the tweet.
  metrics: BriefTweetMetrics | null;
}

export interface BriefScheduledPost {
  id: string;
  text: string;
  scheduledFor: string | null;
  status: PostStatus;
}

export interface Brief {
  generatedAt: string;
  tzOffsetMin: number;
  account: {
    followers: number | null;
    measuredAt: string | null;
    delta7d: number | null;
    sparkline: Array<{ snapshotAt: string; followers: number }>;
  };
  yesterday: {
    from: string;
    to: string;
    posts: BriefTweet[];
    replies: BriefTweet[];
    profileClickLeaders: BriefTweet[];
  };
  today: {
    from: string;
    to: string;
    scheduled: BriefScheduledPost[];
    anchors: number[];
    gaps: number[];
  };
  replyQuota: {
    postedToday: number;
    target: { min: number; max: number };
  };
  week: {
    from: string;
    to: string;
    posts: number;
    replies: number;
    replyPct: number | null;
    targetReplyPct: number;
  };
  spend: {
    from: string;
    to: string;
    xUsd: number;
    grokUsd: number;
    totalUsd: number;
    byPlatform: Array<{ platform: string; costUsd: number; calls: number }>;
  };
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
