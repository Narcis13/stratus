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
  /** "Visual made" marker (S3) — the post must ship manually with its image. */
  mediaNote: string | null;
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
  mediaNote?: string;
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
  /** S3 "visual made" marker; null clears it. */
  mediaNote?: string | null;
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
  // Channel tags (C8) — null until tagged.
  tags: string[] | null;
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
  /** S3 "visual made" marker — Today renders the amber post-manually chip. */
  mediaNote: string | null;
}

// S0.4: engagement by local weekday × hour over own non-reply posts. weekday
// (0=Sun) and hour are the viewer's local clock when fetched with tzOffsetMin.
export interface BestTimeCell {
  weekday: number;
  hour: number;
  posts: number;
  avgViews: number | null;
  avgViewsPerDay: number | null;
  avgLikes: number | null;
  avgProfileVisits: number | null;
}

export interface BestTimesResponse {
  measuredPosts: number;
  tzOffsetMin: number;
  /** Advice gate: cells with fewer measured posts are "no data". */
  minN: number;
  top: BestTimeCell[];
  cells: BestTimeCell[];
}

// GET /x/metrics/account — the daily follower KPI series (S5.5 milestone card
// reads it). `snapshotAt` is the JSON-serialized Date (ISO string).
export interface AccountSeriesPoint {
  snapshotAt: string;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  listedCount: number;
  deltas: { followers: number; following: number; tweets: number; listed: number } | null;
  activity: { posts: number; replies: number };
}

export interface MetricsAccountResponse {
  count: number;
  latest: AccountSeriesPoint | null;
  series: AccountSeriesPoint[];
}

// S0.4: one empty cadence anchor + its best-times score for today's weekday.
// `sufficient` is n ≥ the advice gate; below it the UI renders "no data".
export interface BriefGap {
  hour: number;
  n: number;
  avgViewsPerDay: number | null;
  avgViews: number | null;
  score: number | null;
  sufficient: boolean;
}

// S0.1: earned-visit → follow conversion over a trailing window. rate is a
// fraction (×100 for %), null below 20 summed clicks or with <2 follower points.
export interface ConversionWindow {
  windowDays: number;
  profileClicks: number;
  followerDelta: number | null;
  rate: number | null;
}

// S0.9: pinned-post watch. `stale` = the pin is unchanged >21d; `outperformer`
// = a last-30d post with ≥3× the pinned tweet's measured views. Both are
// nudges to re-pin (pinning stays manual in the X app). All null/false until
// the daily getMe() has recorded at least one pin.
export interface PinnedWatch {
  pinnedTweetId: string | null;
  since: string | null;
  ageDays: number | null;
  stale: boolean;
  pinnedViews: number | null;
  outperformer: {
    tweetId: string;
    text: string;
    postedAt: string;
    views: number;
    ratio: number;
  } | null;
}

export interface Brief {
  generatedAt: string;
  tzOffsetMin: number;
  account: {
    followers: number | null;
    measuredAt: string | null;
    delta7d: number | null;
    sparkline: Array<{ snapshotAt: string; followers: number }>;
    // Optional: absent when the deployed server predates S0.1 — the panel must
    // tolerate a brief payload without it rather than crash on destructure.
    conversion?: { d7: ConversionWindow; d28: ConversionWindow };
  };
  pinnedWatch: PinnedWatch;
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
    gaps: BriefGap[];
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
  quests: BriefQuests;
}

// -------------------------------------------------------------- quests (C9)

export type QuestKey = 'replies' | 'original' | 'targets' | 'loop' | 'launch';

export interface Quest {
  key: QuestKey;
  label: string;
  n: number;
  /** 0 means the quest had no opportunity today (vacuously done). */
  target: number;
  done: boolean;
  note: string | null;
}

export interface BriefQuests {
  day: string;
  items: Quest[];
  streak: { current: number; todayComplete: boolean };
}

// -------------------------------------------------------------- digest (C9)

export interface DigestFacts {
  weekKey: string;
  from: string;
  to: string;
  followers: { start: number | null; end: number | null; delta: number | null };
  // S0.1: earned-visit → follow conversion for the week (rate null < 20 clicks).
  conversion: { profileClicks: number; followerDelta: number | null; rate: number | null };
  activity: { posts: number; replies: number; replyPct: number | null };
  topTweets: Array<{
    text: string;
    isReply: boolean;
    views: number | null;
    profileVisits: number | null;
  }>;
  stageTransitions: Array<{ handle: string; stage: string }>;
  topFans: Array<{ handle: string; inbound: number; newThisWeek: boolean }>;
  neglected: { targets: string[]; allies: string[] };
  spend: { totalUsd: number; byPlatform: Array<{ platform: string; costUsd: number }> };
  quests: { daysAllDone: number; daysTracked: number };
  guidance: { reply: string | null; post: string | null };
  // S0.7: where this week's posted replies landed vs my 2–10x target band.
  rosterCoverage: PlaybookRosterCoverage;
  // S4: the week's AI image spend + the all-time media-vs-text lift the Studio
  // exists to earn. Optional — digests cached before S4 landed lack them.
  imageSpendUsd?: number;
  mediaVsText?: MediaEffectiveness;
}

// §S4/§S0.2 — media vs text-only own-originals; the shape the digest and the
// Playbook both carry. Lift numbers only when both sides clear n≥20.
export interface MediaEffectiveness {
  media: PlaybookCell;
  textOnly: PlaybookCell;
  unknown: PlaybookCell;
  totalMeasured: number;
  viewsLift: number | null;
  profileVisitsLift: number | null;
}

// ---- SURFACES S4: AI image generation + the Studio asset library ----

export interface ImageGenerateBody {
  prompt: string;
  /** 1..2 — clamped server-side. */
  n?: number;
}

export interface GeneratedImageItem {
  /** data:<mime>;base64,… — ready to build an ImageBitmap (never a raw xAI URL). */
  dataUrl: string;
  mediaType: string;
  revisedPrompt: string | null;
}

export interface ImageGenerateResponse {
  images: GeneratedImageItem[];
  model: string;
  count: number;
  costUsd: number;
  requestId: string | null;
}

/** Asset metadata (never the blob) — the history-rail row shape. */
export interface MediaAsset {
  id: string;
  kind: string;
  prompt: string | null;
  mediaType: string;
  width: number | null;
  height: number | null;
  byteLength: number | null;
  usedOnTweetId: string | null;
  createdAt: string;
}

export interface AssetSaveBody {
  pngBase64: string;
  kind: string;
  prompt?: string;
  mediaType?: string;
  width?: number;
  height?: number;
  usedOnTweetId?: string;
}

export interface DigestResponse {
  weekKey: string;
  from: string;
  to: string;
  facts: DigestFacts;
  narrative: string | null;
  narrativeError?: string;
  model?: string | null;
  costUsd?: number | null;
  cached: boolean;
  generatedAt?: string;
}

// --------------------------------------------------------- icebreakers (C9)

export interface IcebreakersResponse {
  handle: string;
  icebreakers: { reply: string; dm: string };
  /** Exactly what the openers were allowed to know — shown for transparency. */
  grounding: string;
  model: string;
  costUsd: number;
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
  // §S0.6: not a person — a proven own post worth quote-tweeting again. handle
  // is empty; tweetId/url point at the post, click-through drafts via /posts/reup.
  | 'reup_candidate'
  | 'momentum';

export interface FollowupItem {
  kind: FollowupKind;
  handle: string;
  displayName: string | null;
  stage: PersonStage | null;
  reason: string;
  at: string | null;
  /** chain_live: the owed inbound tweet. reup_candidate: my post to re-up. */
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
  /** Person kinds. */
  handle?: string;
  /** reup_candidate snoozes on the tweet (reup:<tweetId>), not a handle. */
  tweetId?: string;
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

export interface PlaybookLatencyCell extends PlaybookCell {
  bucket: '<15m' | '15-60m' | '1-6h' | '>6h' | 'unknown';
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

// Roster coverage (§S0.7): where the window's posted replies went vs my 2–10x
// target band. `pct` is each band's share of ALL replies; `majorityInBand` is
// the gated doctrine verdict over KNOWN-size replies (null under the gate or
// with no account size yet). Shared by the Playbook page and the digest facts.
export interface PlaybookRosterCoverage {
  total: number;
  counts: { in_band: number; above_band: number; below_band: number; unknown: number };
  pct: {
    in_band: number | null;
    above_band: number | null;
    below_band: number | null;
    unknown: number | null;
  };
  known: number;
  inBandPctOfKnown: number | null;
  sufficient: boolean;
  majorityInBand: boolean | null;
  band: { min: number; max: number } | null;
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
  // Image-lift baseline (§S0.2): media vs text-only own originals. null bucket
  // is "unknown" (pre-column rows), never folded into text-only.
  mediaEffectiveness: {
    media: PlaybookCell;
    textOnly: PlaybookCell;
    unknown: PlaybookCell;
    totalMeasured: number;
    viewsLift: number | null;
    profileVisitsLift: number | null;
  };
  // Reply-latency × outcome (§S0.5): grades the doctrine's "reply early" bet.
  // `early` = replied <15m, `late` = replied ≥1h; lift only when both clear the
  // gate. `cells` is the per-bucket table in chronological order.
  latencyEffectiveness: {
    cells: PlaybookLatencyCell[];
    totalMeasured: number;
    early: PlaybookCell;
    late: PlaybookCell;
    viewsLift: number | null;
    profileVisitsLift: number | null;
  };
  // Roster coverage (§S0.7): of the last 7 days' posted replies, how many went
  // to in-band (2–10x) vs above/below/unknown-size authors.
  rosterCoverage: PlaybookRosterCoverage;
  // Idea → outcome (§S0.8): does the Idea Inbox pay? The top-level seeded/
  // unseeded is the pooled headline; posts/replies split it out since the two
  // surfaces have different view distributions. Lift only when both sides gate.
  ideaEffectiveness: PlaybookIdeaSurface & {
    posts: PlaybookIdeaSurface;
    replies: PlaybookIdeaSurface;
    totalSeeded: number;
    totalMeasured: number;
  };
  guidance: { reply: string | null; post: string | null };
}

export interface PlaybookIdeaSurface {
  seeded: PlaybookCell;
  unseeded: PlaybookCell;
  viewsLift: number | null;
  profileVisitsLift: number | null;
}

export interface PlaybookExtractResult {
  requested: number;
  extracted: number;
  failures: Array<{ tweetId: string; error: string }>;
  costUsd: number;
  remaining: number;
}

// ------------------------------------------------------------ channels (C8)

// A topic room: tags + a saved view. `pillar` optionally maps the channel to a
// content-pillar slug (own-post performance in the aggregate); `keywords` feed
// the pure client-side auto-suggest (human always confirms the tag).
export interface Channel {
  slug: string;
  label: string;
  color: string | null;
  sortOrder: number;
  active: boolean;
  pillar: string | null;
  keywords: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelCreateBody {
  slug: string;
  label: string;
  color?: string | null;
  pillar?: string | null;
  keywords?: string[] | null;
  sortOrder?: number;
  active?: boolean;
}

export type ChannelPatchBody = Omit<ChannelCreateBody, 'slug'>;

export interface ChannelPerson {
  handle: string;
  displayName: string | null;
  stage: PersonStage;
  followersCount: number | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  tags: string[] | null;
}

export interface ChannelVoiceTweet {
  tweetId: string;
  authorHandle: string;
  authorDisplayName: string | null;
  text: string;
  url: string | null;
  createdAt: string;
  savedAt: string;
  hookType: string | null;
  tags: string[] | null;
}

export interface ChannelRadarDraft {
  tweetId: string;
  url: string | null;
  handle: string;
  author: string | null;
  snippet: string;
  band: 'hot' | 'warm' | null;
  replyText: string;
  angle: string;
  status: 'ready' | 'clicked' | 'expired';
  draftedAt: string;
  tags: string[] | null;
}

export interface ChannelPostItem {
  scheduledPostId: string;
  text: string;
  register: string | null;
  postedTweetId: string | null;
  postedAt: string | null;
  outcome: {
    views: number | null;
    likes: number | null;
    replies: number | null;
    retweets: number | null;
    bookmarks: number | null;
    profileVisits: number | null;
  } | null;
}

export interface ChannelPosts {
  pillar: string;
  count: number;
  measured: number;
  medianViews: number | null;
  medianProfileVisits: number | null;
  items: ChannelPostItem[];
}

// GET /x/channels/:slug — the room on one screen.
export interface ChannelAggregate {
  channel: Channel;
  people: ChannelPerson[];
  voiceTweets: ChannelVoiceTweet[];
  ideas: Idea[];
  radarDrafts: ChannelRadarDraft[];
  posts: ChannelPosts | null;
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

// ---------------------------------------------------------------------------
// Settings platform (UI.1 server registry → UI.10 primitives). The panel renders
// entirely from GET /x/settings and never imports the server registry — these
// types mirror that JSON contract (SettingDef + resolved value + isDefault).
// ---------------------------------------------------------------------------

export type SettingType = 'number' | 'boolean' | 'string' | 'enum' | 'numberArray';

/** One knob from GET /x/settings: the registry def plus its resolved value and
 *  whether that value is still the registry default. */
export interface SettingEntry {
  key: string;
  group: string;
  label: string;
  description: string;
  type: SettingType;
  default: unknown;
  value: unknown;
  isDefault: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  unit?: string;
  appliesOn?: 'immediate' | 'restart';
  minItems?: number;
  maxItems?: number;
  sortedUnique?: boolean;
}

export interface SettingsGroup {
  id: string;
  label: string;
  settings: SettingEntry[];
}

export interface SettingsResponse {
  groups: SettingsGroup[];
}

export interface SettingsPatchResult {
  updated: Array<{ key: string; value: unknown }>;
}

export interface SettingsResetResult {
  reset: string[];
}
