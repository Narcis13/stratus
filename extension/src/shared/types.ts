// Shared between the side panel, content script, and background worker.
// Mirrors the server route shapes in src/x/routes/calendar.ts and voice.ts.

import type { TweetSignals } from '../replyBand.ts';

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

/** GET /x/posts/scheduled/:id on a thread member carries its siblings, plus
 *  the Idea Inbox idea that seeded it (C6 provenance), when one backlinks. */
export interface ScheduledPostWithThread extends ScheduledPost {
  thread?: ScheduledPost[];
  seededBy?: { id: string; text: string; status: IdeaStatus } | null;
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
  /** C6: the Idea Inbox row the steer came from — the server consumes it. */
  ideaId?: string;
  voiceTweetId?: string;
}

// --------------------------------------------------------------- ideas (C6)

export type IdeaStatus = 'open' | 'consumed' | 'discarded';

export interface Idea {
  id: string;
  text: string;
  sourceUrl: string | null;
  tags: string[] | null;
  status: IdeaStatus;
  consumedByTable: string | null;
  consumedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IdeasResponse {
  count: number;
  ideas: Idea[];
}

export interface IdeaCreateBody {
  text: string;
  sourceUrl?: string;
  tags?: string[];
}

export interface IdeaPatchBody {
  text?: string;
  sourceUrl?: string | null;
  tags?: string[] | null;
  status?: IdeaStatus;
  consumedByTable?: string;
  consumedById?: string;
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
  /** C6: the Idea Inbox row the steer came from — the server consumes it. */
  ideaId?: string;
  /** Skip the server-side band gate (§7.3) — mentions are never band-gated. */
  override?: boolean;
  systemPromptOverride?: string;
  model?: string;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
}

// Batch reply drafting (Radar §7.2): one Grok call, one reply per queued
// tweet, anchored by tweetId. The replies attach to the session radar buffer
// AND land in the server's radar_drafts table (C0) so a browser restart can
// rehydrate the queue — band/signals ride along for that copy only, they
// never reach the Grok prompt.
export interface BatchReplyTweet {
  tweetId: string;
  handle: string;
  author: string;
  text: string;
  url?: string;
  band?: 'hot' | 'warm';
  signals?: TweetSignals;
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

// -------------------------------------------------------- conversations (C2)

// GET /x/conversations (src/x/routes/conversations.ts): the mention inbox as
// Slack-style threads — my posts + their mentions grouped by conversation_id,
// interleaved by postedAt. Read state (unread/snooze/mute) from conversation_meta.

export type ConversationItem =
  | {
      kind: 'inbound';
      tweetId: string;
      text: string;
      postedAt: string;
      authorUsername: string | null;
      authorName: string | null;
      status: MentionStatus;
      inReplyToTweetId: string | null;
    }
  | {
      kind: 'outbound';
      tweetId: string;
      text: string;
      postedAt: string;
      isReply: boolean;
    };

export interface ConversationThread {
  conversationId: string;
  items: ConversationItem[];
  lastActivityAt: string;
  counterpartHandle: string | null;
  counterpartName: string | null;
  inboundCount: number;
  outboundCount: number;
  /** The last word is theirs — an unanswered inbound with no post of mine after it. */
  openLoop: boolean;
  owedSince: string | null;
  /** Open loop where the owed inbound replies to MY REPLY — the 75x moment. */
  chain: boolean;
  unread: boolean;
  snoozedUntil: string | null;
  snoozed: boolean;
  muted: boolean;
  /** C1 stage chip for the thread header; null when no dossier exists yet. */
  person: { handle: string; stage: PersonStage; displayName: string | null } | null;
}

export interface ConversationsResponse {
  counts: { threads: number; openLoops: number; chains: number; unread: number };
  threads: ConversationThread[];
}

export interface ConversationPatchBody {
  read?: true;
  snoozedUntil?: string | null;
  muted?: boolean;
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

// ---------------------------------------------------------------- people (C1)

// Circles CRM rows (src/x/routes/people.ts). Stage describes reciprocity only.
export type PersonStage = 'stranger' | 'noticed' | 'engaged' | 'responded' | 'mutual' | 'ally';

export type PersonEventType =
  | 'saved_tweet'
  | 'saved_author'
  | 'my_reply'
  | 'their_mention'
  | 'their_reply_to_me'
  | 'hover_sighting'
  | 'harvest_seen'
  | 'note'
  | 'manual_dm_logged';

export interface Person {
  handle: string;
  xUserId: string | null;
  displayName: string | null;
  bio: string | null;
  followersCount: number | null;
  followingCount: number | null;
  stage: PersonStage;
  stageUpdatedAt: string | null;
  notes: string | null;
  tags: string[] | null;
  source: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  retired: boolean;
}

export interface PersonListItem extends Person {
  inboundCount: number;
  outboundCount: number;
  eventCount: number;
}

export interface PeopleListResponse {
  count: number;
  people: PersonListItem[];
}

export interface PeopleListOpts {
  stage?: PersonStage;
  tag?: string;
  q?: string;
  sort?: 'last_seen' | 'last_inbound' | 'last_outbound' | 'first_seen';
  retired?: boolean;
  limit?: number;
}

export interface PersonEvent {
  id: string;
  handle: string;
  type: PersonEventType;
  refTable: string | null;
  refId: string | null;
  summary: string | null;
  at: string;
}

export interface PersonReplyOutcome {
  draftId: string;
  sourceTweetId: string;
  sourceText: string;
  sourceUrl: string;
  replyText: string;
  draftCreatedAt: string;
  postedTweetId: string | null;
  postedAt: string | null;
  measuredAt: string | null;
  outcome: {
    views: number | null;
    likes: number | null;
    replies: number | null;
    retweets: number | null;
    quotes: number | null;
    bookmarks: number | null;
    profileVisits: number | null;
  } | null;
}

export interface PersonAngleCell {
  angle: string | null;
  posted: number;
  measured: number;
  medianViews: number | null;
  medianProfileVisits: number | null;
  medianReplies: number | null;
}

export interface PersonDossier {
  person: Person;
  voiceAuthor: Omit<VoiceAuthor, 'tweetCount'> | null;
  events: PersonEvent[];
  replies: { count: number; measured: number; outcomes: PersonReplyOutcome[] };
  angles: PersonAngleCell[];
  mentions: Omit<Mention, 'parentText'>[];
  savedTweets: Omit<VoiceTweet, 'authorDisplayName'>[];
  followerSeries: Array<{ followersCount: number; capturedAt: string; source: 'voice' | 'person' }>;
}

export interface PersonPatchBody {
  notes?: string | null;
  tags?: string[] | null;
  stage?: PersonStage;
  retired?: boolean;
}

export interface PersonEventCreateBody {
  type: 'note' | 'manual_dm_logged';
  summary: string;
  at?: string;
}

// ---------------------------------------------- followups + fans (C5)

// Follow-up queue (src/x/routes/followups.ts) — who do I owe, who should I
// nurture, who's heating up. Recomputed on every GET; only snoozes persist.
export type FollowupKind =
  | 'chain_live'
  | 'dm_ready'
  | 'neglected_target'
  | 'neglected_ally'
  | 'momentum';

export interface FollowupItem {
  kind: FollowupKind;
  handle: string;
  displayName: string | null;
  stage: PersonStage | null;
  reason: string;
  at: string | null;
  /** chain_live only: the owed inbound tweet. */
  tweetId?: string;
  url?: string;
}

export interface FollowupsResponse {
  generatedAt: string;
  myFollowers: number | null;
  counts: { total: number; snoozed: number; byKind: Partial<Record<FollowupKind, number>> };
  items: FollowupItem[];
}

export interface FollowupSnoozeBody {
  kind: FollowupKind;
  handle: string;
  /** null = unsnooze. */
  snoozedUntil: string | null;
}

export interface FanItem {
  rank: number;
  handle: string;
  displayName: string | null;
  stage: PersonStage | null;
  followersCount: number | null;
  inboundCount: number;
  lastInboundAt: string;
  /** My last outbound to them — the "last acknowledged" reading. */
  lastOutboundAt: string | null;
  /** Never replied, or my last reply is >7d old. */
  unacknowledged: boolean;
}

export interface FansResponse {
  days: number;
  count: number;
  fans: FanItem[];
}

// ---------------------------------------------------------------- playbook (C4)

// GET /x/playbook (src/x/routes/playbook.ts): the measured playbook. Every
// cell carries n + `sufficient` (the min-sample gate); the page shows
// "insufficient data (n=7)" instead of a confident lie.

export interface PlaybookCell {
  posted: number;
  n: number;
  medianViews: number | null;
  medianProfileVisits: number | null;
  sufficient: boolean;
}

export interface PlaybookAngleCell extends PlaybookCell {
  angle: string | null;
}

export interface PlaybookBandCell {
  band: 'hot' | 'warm' | 'skip' | null;
  n: number;
  medianViews: number | null;
  meanViews: number | null;
  hitRate: number | null;
  likeRate: number | null;
  meanProfileClicks: number | null;
  sufficient: boolean;
}

export interface PlaybookBaitCell {
  n: number;
  medianViews: number | null;
  meanLikes: number | null;
  sufficient: boolean;
}

export interface Playbook {
  minN: number;
  angleEffectiveness: {
    overall: PlaybookAngleCell[];
    byAuthorSize: Array<{ bucket: string; cells: PlaybookAngleCell[] }>;
    totalMeasured: number;
  };
  pillarRegister: {
    cells: Array<PlaybookCell & { pillar: string | null; register: string | null }>;
    totalMeasured: number;
  };
  structures: {
    hooks: Array<PlaybookCell & { key: string }>;
    devices: Array<PlaybookCell & { key: string }>;
    totalMeasured: number;
  };
  batchVsSingle: {
    single: PlaybookCell;
    radar: PlaybookCell;
    unattributed: number;
  };
  bandCalibration: {
    totalMeasured: number;
    hitThresholdViews: number | null;
    bands: PlaybookBandCell[];
    actionable: { n: number; medianViews: number | null; hitRate: number | null };
    passed: { n: number; medianViews: number | null; hitRate: number | null };
    bait: { bait: PlaybookBaitCell; nonBait: PlaybookBaitCell };
  };
  relationshipLift: {
    withRelationship: PlaybookCell;
    withoutRelationship: PlaybookCell;
    viewsLift: number | null;
    profileVisitsLift: number | null;
  };
  guidance: { reply: string | null; post: string | null };
}

export interface PlaybookExtractResult {
  requested: number;
  extracted: number;
  failures: Array<{ tweetId: string; error: string }>;
  costUsd: number;
  remaining: number;
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
