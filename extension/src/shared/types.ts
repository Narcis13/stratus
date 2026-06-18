// Shared between the side panel, content script, and background worker.
// Mirrors the server route shapes in src/x/routes/calendar.ts and voice.ts.

export type PostStatus =
  | 'draft'
  | 'pending'
  | 'segment'
  | 'publishing'
  | 'posted'
  | 'failed'
  | 'cancelled';

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
  /** Thread membership (§8.2); null on standalone posts. */
  threadId: string | null;
  threadPosition: number | null;
  /** Content pillar declared by the drafter (§8.4). */
  pillar: string | null;
  /** Self-quote re-up target (§8.5). */
  quoteTweetId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** GET /x/posts/scheduled/:id on a thread member carries its siblings. */
export interface ScheduledPostWithThread extends ScheduledPost {
  thread?: ScheduledPost[];
}

export interface CreateBody {
  text: string;
  scheduledFor?: string | null;
  status?: 'draft' | 'pending';
  mediaIds?: string[] | null;
}

export interface CreateThreadBody {
  segments: string[];
  scheduledFor?: string | null;
  status?: 'draft' | 'pending';
  pillar?: string | null;
}

export interface CreateThreadResponse {
  threadId: string;
  segments: ScheduledPost[];
}

// --------------------------------------------------------------- drafter §8.1

// Pillars are DB-backed and editable (§8.6) — a slug is any active pillar's id,
// no longer a closed union. Kept as a string alias for readability.
export type PostPillar = string;
export type PostRegister = 'plain' | 'spicy' | 'reflective';

export interface PostDraftBody {
  pillar?: PostPillar;
  idea?: string;
  voiceTweetId?: string;
}

export interface PostReupBody {
  tweetId: string;
  idea?: string;
  pillar?: PostPillar;
}

// --------------------------------------------------------------- pillars §8.6

export interface ContentPillar {
  slug: string;
  label: string;
  body: string;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PillarCreateBody {
  slug: string;
  label: string;
  body: string;
  sortOrder?: number;
  active?: boolean;
}

export interface PillarUpdateBody {
  label?: string;
  body?: string;
  sortOrder?: number;
  active?: boolean;
}

export interface PillarDraftBody {
  mode: 'new' | 'tweak';
  idea?: string;
  slug?: string;
  instruction?: string;
}

export interface PillarDraftResult {
  proposal: { slug: string; label: string; body: string };
  model: string;
  costUsd: number;
  requestId: string | null;
}

export interface PostDraftResponse {
  drafts: Array<ScheduledPost & { register: PostRegister | null }>;
  winnersUsed: number;
  model: string;
  costUsd: number;
  requestId: string | null;
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
  // Template extraction (§8.3) — null until extracted.
  hookType: string | null;
  skeleton: string | null;
  lineBreakPattern: string | null;
  templateLength: string | null;
  device: string | null;
  templateExtractedAt: string | null;
}

export interface VoiceTweetsOpts {
  author?: string;
  q?: string;
  hook?: string;
  extracted?: boolean;
  limit?: number;
  retired?: boolean;
}

export interface VoiceExtractBatchResult {
  requested: number;
  extracted: number;
  failures: Array<{ tweetId: string; error: string }>;
  costUsd: number;
  remaining: number | null;
}

// --- target roster (GET /x/voice/targets, §7.4) ---

// Followers/day computed from the append-only enrich series.
export interface TargetMomentum {
  delta: number;
  days: number;
  perDay: number;
}

export interface VoiceTarget {
  handle: string;
  displayName: string | null;
  followersCount: number;
  followingCount: number | null;
  profileUrl: string | null;
  enrichedAt: string | null;
  ratio: number;
  momentum: TargetMomentum | null;
  snapshotCount: number;
  lastRepliedAt: string | null;
  postedReplies: number;
}

export interface VoiceTargets {
  myFollowers: number | null;
  measuredAt: string | null;
  band: { min: number; max: number } | null;
  targets: VoiceTarget[];
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
  /** Thread context (§7.5 mention inbox): my post the target tweet replies to. */
  parent?: { text: string };
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
  /** Skip the server-side band gate (§7.3) — mentions are never band-gated. */
  override?: boolean;
  systemPromptOverride?: string;
  model?: string;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
}

// Batch reply drafting (Radar §7.2): one Grok call, one reply per queued
// tweet, anchored by tweetId. Not persisted server-side — the replies attach
// to the session radar buffer.
export interface BatchReplyTweet {
  tweetId: string;
  handle: string;
  author: string;
  text: string;
  url?: string;
}

export interface BatchReplyGenerateBody {
  tweets: BatchReplyTweet[];
  idea?: string;
  model?: string;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
}

export interface BatchReplyItem {
  tweetId: string;
  text: string;
  angle: ReplyAngle;
}

export interface BatchReplyResponse {
  replies: BatchReplyItem[];
  count: number;
  requested: number;
  costUsd: number;
  model: string;
  requestId: string | null;
}

export interface ReplyPatchBody {
  replyTextEdited?: string | null;
  status?: ReplyDraftStatus;
  postedTweetId?: string | null;
}

// -------------------------------------------------------------- mentions

// Mention inbox rows (§7.5) as returned by GET /x/mentions — mirrors the
// server's `mentions` table plus the joined parentText (my post the mention
// replies to, when it's one of mine).

export type MentionStatus = 'unanswered' | 'answered' | 'dismissed';

export interface Mention {
  tweetId: string;
  authorId: string | null;
  authorUsername: string | null;
  authorName: string | null;
  text: string;
  postedAt: string;
  conversationId: string | null;
  inReplyToTweetId: string | null;
  status: MentionStatus;
  answeredDraftId: string | null;
  answeredAt: string | null;
  fetchedAt: string;
  parentText: string | null;
}

export interface MentionsResponse {
  counts: { unanswered: number };
  mentions: Mention[];
}

export interface MentionsRefreshResult {
  scanned: number;
  inserted: number;
  selfSkipped: number;
  answered: number;
  refreshesRemaining: number;
}

export interface MentionPatchBody {
  status?: MentionStatus;
  draftId?: string | null;
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
