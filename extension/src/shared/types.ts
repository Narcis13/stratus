// Shared between the side panel, content script, and background worker.
// Mirrors the server route shapes in src/x/routes/calendar.ts and voice.ts.

import type { HumanizerConfig } from '../humanize.ts';
import type { JudgeVerdict, JudgeVerdictLabel } from '../judge.ts';
import type { CoachBand } from '../postCoach.ts';
import type { PostFormat } from '../postFormat.ts';
import type { TweetSignals } from '../replyBand.ts';

export type PostStatus =
  | 'draft'
  | 'pending'
  // A3.5: scheduled, but the USER pastes it at the slot — the publisher never
  // claims it; → posted via POST /posts/scheduled/:id/mark-posted or the
  // daily reconcile.
  | 'manual'
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

/** POST /x/posts/scheduled answers with the row plus GR.6's schedule-time
 *  advisory. `warnings` is never a refusal — the row is already saved when they
 *  are computed; absent when the deployed server predates GR.6. */
export interface ScheduledPostCreated extends ScheduledPost {
  warnings?: string[];
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
  /** `manual` requires scheduledFor and skips the URL surcharge guard (A3.5). */
  status?: 'draft' | 'pending' | 'manual';
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

// AI.7 — one LLM call drafts a whole thread; the head lands status='draft' and
// the tails status='segment', sharing a threadId (loads into the thread editor).
export interface ThreadDraftBody {
  idea?: string;
  ideaId?: string;
  pillar?: PostPillar;
  /** Target tweet count, clamped 3–8 server-side. */
  tweetCount?: number;
  model?: string;
  provider?: 'grok' | 'openrouter';
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
}

export interface ThreadDraftResponse {
  threadId: string;
  segments: ScheduledPost[];
  costUsd: number;
  model: string;
  requestId?: string;
}

// AI.8 — rewrite assist: one LLM call returns three sharper versions of a draft.
// No DB rows; the Composer applies the picked variant to its own text state.
export type RewriteKind = 'tightened' | 'rehooked' | 'restructured';

export interface RewriteVariant {
  text: string;
  kind: RewriteKind;
}

export interface RewriteBody {
  text: string;
  instruction?: string;
  model?: string;
  provider?: 'grok' | 'openrouter';
}

export interface RewriteResponse {
  variants: RewriteVariant[];
  costUsd: number;
  model: string;
  requestId?: string;
}

// JD.4/JD.5 — the LLM judge: one structured-outputs call grades ONE draft on the
// 13-dimension rubric and comes back with anchored fixes; `apply` rewrites from
// those fixes and keeps the result only if it re-judges strictly better.
//
// The verdict half of both responses is the CANONICAL `JudgeVerdict` from
// src/shared/judge.ts (reached through the extension shim), extended rather than
// re-typed: the band, the thirteen score keys and the annotation shape are the
// same objects the server derived, so the panel can never grade a different
// vocabulary than the row in `draft_judgments` (§7 rule 4c).

export interface JudgeRunBody {
  text: string;
  /** v1 judges originals only (JD decision 2); the column is wider than this. */
  surface?: 'post';
  model?: string;
  provider?: 'grok' | 'openrouter';
}

/** `POST /x/judge`. **`id` is null when the best-effort `draft_judgments` insert
 *  failed** (JD decision 9 — a paid verdict is returned regardless), and with no
 *  id there is nothing for `/judge/apply` to load, so a consumer must treat
 *  "apply" as unavailable rather than assume a string. */
export interface JudgeRunResponse extends JudgeVerdict {
  id: string | null;
  textHash: string;
  model: string;
  provider: string;
  costUsd: number;
  requestId: string | null;
}

export interface JudgeApplyBody {
  judgmentId: string;
  text: string;
  /** Steers the REWRITER only — the re-judge is pinned to the stored judgment's
   *  model+provider, because a never-worse compare across two graders compares
   *  the graders (JD decision 11). */
  model?: string;
  provider?: 'grok' | 'openrouter';
}

/** `POST /x/judge/apply`. **`improved: false` is a 200, not an error**: the
 *  never-worse guard kept the caller's own words and handed back the ORIGINAL
 *  verdict. `text`, `textHash` and the verdict always describe the same draft
 *  (JD decision 7), so a consumer reads them as one triple. `judgmentId` is the
 *  row the returned verdict belongs to — null when persisting the winner failed. */
export interface JudgeApplyResponse extends JudgeVerdict {
  text: string;
  improved: boolean;
  judgmentId: string | null;
  textHash: string;
  model: string;
  provider: string;
  costUsd: number;
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

// AI.9 — idea generator: one LLM call turns pillars + measured winners into
// post ideas. Writes nothing; the panel saves picked ones via POST /x/ideas.
export type IdeaAngle = 'observation' | 'stance' | 'story' | 'question';

export interface IdeaGenerateBody {
  steer?: string;
  /** 1–10, clamped server-side; default 8. */
  count?: number;
  model?: string;
  provider?: 'grok' | 'openrouter';
}

export interface IdeaProposal {
  text: string;
  /** A slug from the active pillar set, or null when the model mis-tagged it. */
  pillar: string | null;
  angle: IdeaAngle;
}

export interface IdeaGenerateResponse {
  ideas: IdeaProposal[];
  count: number;
  requested: number;
  costUsd: number;
  model: string;
  requestId?: string;
}

// ------------------------------------------------------------------ AI / LLM §AI

// AI.10 — Settings → AI panel. The provider config edited via /llm/settings.
// API keys never live here (Decision 5) — they stay in server env; these are
// only the routing knobs the panel can change.
export type LlmProvider = 'grok' | 'openrouter';
export type LlmReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export interface AiSettings {
  provider: LlmProvider;
  openrouterModel: string;
  /** null = each call site's own house default wins (the merge in askLLM). */
  temperature: number | null;
  maxOutputTokens: number | null;
  reasoningEffort: LlmReasoningEffort | null;
}

/** GET /llm/settings — the typed settings plus env-key presence flags, so the
 *  panel can grey out a provider whose key isn't set on the server. */
export interface AiSettingsResponse extends AiSettings {
  providers: { grok: boolean; openrouter: boolean };
}

/** PATCH /llm/settings — partial; an explicit null clears the numeric/effort
 *  field back to the surface default (blank inputs map to null). */
export interface AiSettingsPatchBody {
  provider?: LlmProvider;
  openrouterModel?: string;
  temperature?: number | null;
  maxOutputTokens?: number | null;
  reasoningEffort?: LlmReasoningEffort | null;
}

/** GET /llm/models — OpenRouter's free model list. Prices are per-token USD
 *  strings (as OpenRouter returns them), null when the model is free/unlisted. */
export interface LlmModel {
  id: string;
  name: string;
  promptPrice: string | null;
  completionPrice: string | null;
}

export interface LlmModelsResponse {
  models: LlmModel[];
}

/** POST /x/prompts/restore-defaults — deletes every override row. */
export interface PromptsRestoreResult {
  restored: number;
}

/** GET /x/prompts — one row per editable prompt key (AI.11). `customized` is
 *  structural (an override row exists), never a diff. */
export interface PromptSummary {
  key: string;
  name: string;
  description: string;
  required: string[];
  customized: boolean;
  updatedAt: number | null;
}

/** GET /x/prompts/:key — the live body (override or shipped default), the
 *  default for eyeballing the diff, and the required-placeholder contract. */
export interface PromptDetail {
  key: string;
  body: string;
  defaultBody: string;
  required: string[];
  customized: boolean;
}

/** PATCH /x/prompts/:key — an override was upserted. `unknownPlaceholders` are
 *  `{{TOKENS}}` the render will drop (a warning, never fatal). */
export interface PromptPatchResult {
  customized: boolean;
  unknownPlaceholders: string[];
}

/** POST /x/prompts/:key/reset — the override row was deleted. */
export interface PromptResetResult {
  customized: boolean;
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

// ------------------------------------------------------------ me / profile M1

export type MeKind = 'fact' | 'event' | 'emotion' | 'note';
// GR.7 added the two counted kinds (stratus counts them itself, from the goal's
// baseline) and the `missed` status the deadline flip writes.
export type GoalKind = 'followers' | 'mrr' | 'custom' | 'posted_replies' | 'originals';
export type GoalStatus = 'active' | 'achieved' | 'missed' | 'dropped';

// Date columns serialize as ISO strings over the JSON transport. `inWindow` is
// server-computed on GET /x/me (never re-derived client-side — §7.27).
export interface MeEntry {
  id: string;
  kind: MeKind;
  text: string;
  happenedAt: string | null;
  pinned: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  inWindow: boolean;
}

export interface MeGoalProgress {
  current: number;
  pct: number;
  daysLeft: number | null;
}

// `progress` is server-computed on GET /x/me (followers goals read the latest
// account_snapshot; posted_replies/originals are counted from the goal's own
// baseline; mrr/custom use currentValue).
export interface MeGoal {
  id: string;
  label: string;
  kind: GoalKind;
  target: number;
  unit: string | null;
  currentValue: number | null;
  deadline: string | null;
  status: GoalStatus;
  // GR.7: where the goal started. Null on goals created before it.
  baselineValue?: number | null;
  baselineAt?: string | null;
  createdAt: string;
  updatedAt: string;
  progress: MeGoalProgress | null;
}

export interface MeResponse {
  entries: MeEntry[];
  goals: MeGoal[];
}

export interface MeContextResponse {
  mode: 'post' | 'reply';
  block: string | null;
}

export interface MeEntryCreateBody {
  kind: MeKind;
  text: string;
  happenedAt?: string | null;
  pinned?: boolean;
}

export interface MeEntryPatchBody {
  kind?: MeKind;
  text?: string;
  happenedAt?: string | null;
  pinned?: boolean;
  active?: boolean;
}

export interface MeGoalCreateBody {
  label: string;
  kind: GoalKind;
  target: number;
  unit?: string | null;
  deadline?: string | null;
  currentValue?: number | null;
}

export interface MeGoalPatchBody {
  label?: string;
  kind?: GoalKind;
  target?: number;
  unit?: string | null;
  deadline?: string | null;
  currentValue?: number | null;
  status?: GoalStatus;
}

// N0 — the niche: first-class identity + strategy container. Persona/beliefs/
// replyPersona ground the prompts; the 5 doctrine knobs are the REPLY-GUIDE
// numbers. Exactly one active niche at a time; pillars/channels follow it.
export interface NicheDoctrine {
  replyTargetMin: number;
  replyTargetMax: number;
  weekReplyTargetPct: number;
  targetBandMinX: number;
  targetBandMaxX: number;
  reciprocityTargetMin: number;
}

export interface Niche {
  slug: string;
  label: string;
  description: string | null;
  persona: string;
  beliefs: string;
  replyPersona: string;
  doctrine: Partial<NicheDoctrine> | null; // null = all defaults (stored partial)
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// GET /x/niche — the active niche plus its RESOLVED doctrine (all 5 present).
export interface NicheActive {
  niche: Niche;
  doctrine: NicheDoctrine;
}

export interface NicheCreateBody {
  slug: string;
  label: string;
  persona: string;
  beliefs: string;
  replyPersona: string;
  description?: string;
  doctrine?: Partial<NicheDoctrine> | null;
}

export interface NichePatchBody {
  label?: string;
  persona?: string;
  beliefs?: string;
  replyPersona?: string;
  description?: string | null;
  doctrine?: Partial<NicheDoctrine> | null;
  active?: boolean;
}

// N0.8 — the wizard proposal: prose → a complete proposed niche. Never persisted
// by the server; the panel reviews/edits then saves via niche/pillars/channels
// create routes.
export interface NichePillarProposal {
  slug: string;
  label: string;
  body: string;
}

export interface NicheChannelProposal {
  slug: string;
  label: string;
  keywords: string[];
}

export interface NicheProposal {
  slug: string;
  label: string;
  description: string;
  persona: string;
  beliefs: string;
  replyPersona: string;
  pillars: NichePillarProposal[];
  channels: NicheChannelProposal[];
}

export interface NicheDraftResult {
  proposal: NicheProposal;
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
  /** `manual` is rejected on thread members (manual_threads_unsupported). */
  status?: 'draft' | 'pending' | 'manual' | 'cancelled';
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

// ---------------------------------------------------------------- harvest

// One `GET /x/harvest/runs` row. `mode` is the corpus discriminator: hand-run
// harvests are 'posts'/'replies', while HV.1's ambient timeline capture hangs
// its rows off a server-owned 'timeline' run, one per UTC day.
export interface HarvestRun {
  id: string;
  handle: string;
  mode: string;
  scope: string;
  rowCount: number;
  createdAt: string;
}

// HV.4 `GET /x/harvest/affinity` — who the algorithm keeps feeding the home
// timeline, over the mode='timeline' corpus only. `inRoster` is true when the
// handle already has a people or voice_authors row (retired ones included):
// what's left with `inRoster: false` is the discovery worth a dossier.
export interface TimelineAffinityAuthor {
  handle: string;
  distinctDays: number;
  sightings: number;
  lastSeenAt: string;
  avgViews: number;
  stage: PersonStage | null;
  inRoster: boolean;
}

export interface TimelineAffinityResponse {
  days: number;
  minDays: number;
  authors: TimelineAffinityAuthor[];
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
  /** ML.3: the language this draft was actually written in and which rule picked
   *  it — SERVER-stamped before the insert (the route's whitelist refuses both
   *  from a client), so a draft re-read from History still knows. English drafts
   *  and every pre-ML row leave both absent. Mirrors src/x/replies/prompt.ts. */
  language?: string;
  languageSource?: ReplyLanguageSource;
}

/** Which rule picked the draft's language (src/x/replies/language.ts). The panel
 *  reads this rather than re-deriving the precedence (§7.4c). */
export type ReplyLanguageSource = 'explicit' | 'roster' | 'detected';

export type ReplyAngle = 'extends' | 'contrarian' | 'debate';

export interface ReplyVariant {
  text: string;
  angle: ReplyAngle;
  /** ML.2: literal English rendering of a non-English reply — a reading aid, not
   *  a polished translation. `null` on every English draft, and on any variant
   *  whose gloss the server read leniently and discarded (§7.35). Mirrors
   *  src/x/replies/prompt.ts. Older drafts persisted before ML.2 have no gloss
   *  key at all, so read it as possibly-absent at the render site. */
  gloss: string | null;
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

/** What POST /x/replies/generate answers with: the persisted row plus ML.3's
 *  echo of the language resolution. Both `null` on an English draft. The row
 *  itself is a plain `ReplyDraft` everywhere else (History, PATCH, storage) —
 *  those paths read the same pair off `contextSnapshot`. */
export interface ReplyDraftGenerated extends ReplyDraft {
  language: string | null;
  languageSource: ReplyLanguageSource | null;
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
  // ML.5 — draft this reply in a named language instead of letting the server
  // resolve one. Top-level, never inside `context` (the route's whitelist drops
  // it there): it takes the `explicit` branch of the ML.3 precedence, which is
  // also how the panel's "Draft in English" override redrafts — one existing
  // concept, no new server field.
  language?: string;
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
  // 'manual' = a ⊕ pinned tweet (RU.8), 'roster' = a quiet post by someone in my
  // circle (GT.8), 'cannon' = an arbitrage capture (CQ.4); carried through so
  // radar_drafts.band records it (queue metadata), never sent to Grok.
  band?: 'hot' | 'warm' | 'manual' | 'roster' | 'cannon';
  signals?: TweetSignals;
  // RC.2/RC.4 — the 0–100 reply-payoff score the curation pass gave this tweet,
  // stored on radar_drafts so "did curation pick better tweets?" is answerable
  // later. Storage metadata like band/signals: it never reaches the prompt.
  // Omitted (not 0) when this draft didn't come through a curated pass — the
  // column's whole value dies if "graded 0" and "never graded" collapse.
  curationScore?: number;
}

export interface BatchReplyGenerateBody {
  tweets: BatchReplyTweet[];
  idea?: string;
  model?: string;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  // CQ.7 — draft this batch in a language other than English. ONE per call, not
  // per tweet: the batch prompt carries a single instruction block, so the panel
  // only sends it when every row in the set shares one `cannon_targets.language`.
  // The server validates it (1–40 chars, single-line) and renders the clause —
  // this string never reaches a prompt template.
  language?: string;
}

export interface BatchReplyItem {
  tweetId: string;
  text: string;
  angle: ReplyAngle;
  // All 3 angle variants (RU.3); text/angle stay the primary (variants[0]).
  variants: ReplyVariant[];
}

export interface BatchReplyResponse {
  replies: BatchReplyItem[];
  count: number;
  requested: number;
  // ML.3 — the language the whole batch was drafted in and which rule picked it.
  // The panel sends one only from the Cannon roster, but the server also
  // resolves from the roster itself and from the posts' own script, so this can
  // name a language the panel never sent. Both `null` on an English batch.
  language: string | null;
  languageSource: ReplyLanguageSource | null;
  costUsd: number;
  model: string;
  requestId: string | null;
}

// Curated drafting (RC.3/RC.4): one cheap scoring call in FRONT of the paid
// batch draft, so the drafting money goes to the best N of a long queue instead
// of the newest N. Mirrors POST /x/replies/curate field-for-field. The call
// writes nothing — only the panel owns the session queue, so acting on `drop`
// (dismissing) and on `keep` (drafting) is the panel's job.
export interface CurateTweet {
  tweetId: string;
  handle: string;
  author: string;
  text: string;
  url?: string;
}

export interface CurateBody {
  tweets: CurateTweet[];
  model?: string;
  provider?: 'grok' | 'openrouter';
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
}

export interface CurateScoredItem {
  tweetId: string;
  /** Reply payoff, integer 0–100. */
  score: number;
  /** Filler not worth a reply at any score — always dropped. */
  lowValue: boolean;
  /** One sentence naming what decided the score. Not rendered in v1. */
  reason: string;
}

export interface CurateResponse {
  /** Verdicts, anchored to the ids we asked about (first occurrence wins). */
  scored: CurateScoredItem[];
  /** Ids to draft, **best first** — so trimming the tail trims the weakest. */
  keep: string[];
  /** Ids to dismiss: every lowValue post plus everything past the cut. */
  drop: string[];
  /** Asked-for ids the model never scored (a truncated response). Left alone:
   *  a degraded response costs coverage, never queue rows. */
  unscored: string[];
  keepTarget: number;
  costUsd: number;
  model: string;
  requestId: string | null;
}

export interface ReplyPatchBody {
  replyTextEdited?: string | null;
  status?: ReplyDraftStatus;
  postedTweetId?: string | null;
}

// CQ.3 — GET /x/radar/placed-today, the Cannon head's daily instrument.
// `placed` counts reply_drafts that reached `posted` (the on-page paste, RU.7)
// inside the local day; `target` is the active replies commitment or the
// doctrine ceiling — one owner, so the counter and the quest can't disagree.
export interface PlacedTodayResponse {
  dayKey: string;
  placed: number;
  target: number;
}

// CQ.2 — the cannon roster (`/x/cannon/*`). Field for field the route's
// `CannonTargetView`; a hand-synced mirror like every other type in this file,
// since the extension build can't import `src/x/`.
//
// EVERY route behind these types is $0 by construction: the scores are computed
// from `harvest_rows` (what the DOM scrape already captured), never from a
// billed lookup. That is why the panel is allowed a Rescore button at all.
export interface CannonTarget {
  handle: string;
  displayName: string | null;
  language: string | null;
  score: number | null;
  medianViews: number | null;
  medianComments: number | null;
  sampleN: number;
  scoredAt: string | null;
  active: boolean;
  notes: string | null;
  addedAt: string;
  /** Whole days since the last rescore; null when never scored. */
  staleDays: number | null;
  /** Under `x.cannon.scoreMin` — the Sunday "drop this one" flag. Never true for
   *  an unscored handle: absent is not below. */
  belowFloor: boolean;
}

export interface CannonTargetsResponse {
  /** `x.cannon.scoreMin` as it was at read time — the line `belowFloor` is measured against. */
  floor: number;
  /** Score desc, nulls last. */
  targets: CannonTarget[];
}

export interface CannonTargetCreateBody {
  handle: string;
  displayName?: string;
  language?: string;
  notes?: string;
  active?: boolean;
}

/** Partial — an empty patch is refused (`empty_patch`), not treated as a no-op. */
export interface CannonTargetPatchBody {
  active?: boolean;
  language?: string | null;
  notes?: string | null;
  displayName?: string | null;
}

/** An author already in the harvest corpus who is NOT on the roster, scored the
 *  way the roster is — "who should I be camping" in the same units. */
export interface CannonCandidate {
  handle: string;
  score: number;
  medianViews: number;
  medianComments: number;
  sampleN: number;
}

export interface CannonCandidatesResponse {
  limit: number;
  minSample: number;
  candidates: CannonCandidate[];
}

export interface CannonRescoreSkip {
  handle: string;
  sampleN: number;
  reason: 'insufficient_sample';
}

export interface CannonRescoreResponse {
  scored: number;
  /** Handles the harvest hasn't covered enough of yet — they keep their `scoredAt`. */
  skipped: CannonRescoreSkip[];
  /** A POST COUNT, not a day count: the score reads an author's newest N posts. */
  samplePosts: number;
  minSample: number;
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

/** GET /x/analytics/active-times (A3.2) — the newest captured audience heatmap
 *  row, or null when the user has never visited X Analytics. The full DB row is
 *  returned: `grid` is number[col][row] (col 0 = Monday, 0..1 intensity) and
 *  `capturedAt` is an ISO string over the wire. Structurally a superset of the
 *  shared `ActiveTimesGrid`, so it feeds `audienceScoreFor` directly (A3.4). */
export interface AudienceCapture {
  id: number;
  capturedAt: string;
  metric: string;
  tzOffsetMin: number;
  cols: number;
  rows: number;
  grid: number[][];
}

export interface ActiveTimesResponse {
  capture: AudienceCapture | null;
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

// GT.4: a follower milestone crossed in the last 3 days, or null the rest of
// the time. The server only reports a crossing it witnessed (a snapshot below
// the rung precedes the one that reaches it), so a fresh install doesn't
// announce a milestone it merely inherited. `followers` is the count on the
// crossing snapshot — all three fields describe one event.
export interface MilestoneWatch {
  milestone: number;
  crossedOn: string;
  followers: number;
}

// GR.6: the activity monitor's alerts, mirrored from `src/x/monitor.ts` (§5
// build isolation — the extension never imports server modules). At most one
// alert per rule, so `rule` is a safe React key; sorted most-severe first.
export type MonitorSeverity = 'info' | 'warn' | 'critical';

export interface MonitorAlert {
  rule: string;
  severity: MonitorSeverity;
  message: string;
  evidence: Record<string, unknown>;
}

export interface BriefMonitor {
  alerts: MonitorAlert[];
  worst: MonitorSeverity | null;
}

// GR.8: the accountability blocks, mirrored from `src/x/goals.ts` and the
// `me_goals` / `commitments` rows (§5 build isolation — the extension never
// imports server modules). Dates arrive as ISO strings over the JSON transport.
export type GoalVerdict = 'achieved' | 'ahead' | 'on_pace' | 'behind' | 'overdue' | 'unknown';

export interface GoalPacing {
  /** null = unknown, never a fake 0. */
  current: number | null;
  pctComplete: number | null;
  /** Whole days to the deadline; ≤0 = past it; null = no deadline. */
  daysLeft: number | null;
  requiredPerDay: number | null;
  actualPerDay: number | null;
  verdict: GoalVerdict;
  projectedAt: string | null;
}

/** A `me_goals` row as the brief ships it: the row plus live pacing. Distinct
 *  from `MeGoal`, which carries the Me tab's own ME.1 `progress` instead. */
export interface BriefGoal {
  id: string;
  label: string;
  kind: GoalKind;
  target: number;
  unit: string | null;
  currentValue: number | null;
  deadline: string | null;
  baselineValue: number | null;
  baselineAt: string | null;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
  pacing: GoalPacing;
}

export type CommitmentKey = 'replies' | 'originals';

export interface CommitmentDebt {
  missedLast7: number;
  missedLast30: number;
  /** Days inside the 7-day window the promise was actually live — the honest
   *  denominator for "N of the last M days". */
  trackedLast7: number;
  tier: 0 | 1 | 2 | 3;
}

export interface Commitment {
  key: CommitmentKey;
  dailyTarget: number;
  active: boolean;
  activeSince: string;
  updatedAt: string;
  debt: CommitmentDebt;
}

export interface CommitmentsResponse {
  commitments: Commitment[];
}

export interface CommitmentPutBody {
  key: CommitmentKey;
  dailyTarget: number;
  active?: boolean;
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
  // GT.4, same predates-the-server tolerance: null on any ordinary day.
  milestoneWatch?: MilestoneWatch | null;
  // Optional: absent when the deployed server predates GR.6 — the panel must
  // tolerate a brief payload without it rather than crash (the S0.1 precedent).
  monitor?: BriefMonitor;
  // GR.8, same tolerance: active goals with live pacing, and every commitment
  // (paused ones included) with its debt against the C9 diary.
  goals?: BriefGoal[];
  commitments?: Commitment[];
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

// Mirrors QUEST_KEYS in src/x/quests.ts (GT.7 added `reciprocity`).
export type QuestKey = 'replies' | 'original' | 'targets' | 'loop' | 'launch' | 'reciprocity';

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
  // M1 (ME.5): active Me goals with progress. Optional/nullable — digests cached
  // before ME.5 lack the key; null when there are no active goals.
  goals?: Array<{
    label: string;
    unit: string | null;
    target: number;
    current: number | null;
    pct: number | null;
  }> | null;
  guidance: { reply: string | null; post: string | null };
  // S0.7: where this week's posted replies landed vs my 2–10x target band.
  rosterCoverage: PlaybookRosterCoverage;
  // S4: the week's AI image spend + the all-time media-vs-text lift the Studio
  // exists to earn. Optional — digests cached before S4 landed lack them.
  imageSpendUsd?: number;
  mediaVsText?: MediaEffectiveness;
  // GR.9: the week graded 0–100. Optional/nullable on the same contract —
  // absent on digests cached before GR.9, null whenever the week was tracked
  // for fewer than 4 days (the server never ships a card it can't stand behind,
  // so the panel renders the grade or nothing).
  scorecard?: DigestScorecard | null;
}

/** GR.9 — mirrors the server's `DigestScorecard`. Components are 0–100 with
 *  null for "no data this week"; `delta` is null when last week wasn't graded. */
export interface DigestScorecard {
  score: number | null;
  components: {
    questAdherence: number | null;
    cadenceConsistency: number | null;
    replyQuota: number | null;
    goalPacing: number | null;
    ratioAdherence: number | null;
  };
  sufficient: boolean;
  daysTracked: number;
  prevScore: number | null;
  delta: number | null;
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

// ------------------------------------------------------------ DM drafts (A3.9)

// Grounded outbound direct messages (src/x/routes/dms.ts). Drafting spends one
// Grok call behind the same refusal ladder as icebreakers; list/patch are $0.
// Sending stays manual in X — patch(status:'sent') just logs the timeline event.
export type DmStatus = 'draft' | 'sent' | 'discarded';

/** A stored dm_drafts row (GET /x/dms, PATCH /x/dms/:id). Dates are ISO
 *  strings; `grounding` is the {block, idea} snapshot the draft was built on. */
export interface DmDraft {
  id: string;
  handle: string;
  text: string;
  purpose: string | null;
  status: DmStatus;
  grounding: { block: string; idea: string | null } | null;
  costUsd: number | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
}

export interface DmsListResponse {
  count: number;
  dms: DmDraft[];
}

/** POST /x/dms/draft — the fresh draft plus the grounding block it was allowed
 *  to see (a plain string here, unlike the stored row's {block, idea} object). */
export interface DmDraftResult {
  id: string;
  text: string;
  grounding: string;
  costUsd: number;
  model: string;
  requestId: string;
}

export interface DmPatchBody {
  text?: string;
  status?: 'sent' | 'discarded';
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
  | 'manual_dm_logged'
  // C10 notification harvest — timeline-only, never a stage or ranking input.
  | 'their_like'
  | 'their_repost'
  | 'their_follow';

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
  /** C10 likes/reposts/follows in the same window — display-only, never ranked. */
  engagementCount: number;
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

// ------------------------------------------- following ledger (Guardrails §A)

// The $0 following ledger (src/x/routes/following.ts). Rows arrive from the
// extension's own /following scrape — no X API anywhere — and unfollowing stays
// a manual act in the X app, so `status` is a ratchet the user and the scrape
// advance together, never an action this client performs.
export type FollowingStatus = 'active' | 'queued' | 'done' | 'confirmed' | 'gone';

export interface FollowingRow {
  handle: string;
  displayName: string | null;
  followsBack: boolean;
  listPosition: number | null;
  /** The follow-date proxy (§7.11) — X never exposes the real one. */
  firstSeenAt: string;
  lastSeenAt: string;
  lastRunId: string;
  status: FollowingStatus;
  keep: boolean;
  unfollowMarkedAt: string | null;
}

export interface FollowingListOpts {
  status?: FollowingStatus;
  q?: string;
  limit?: number;
}

export interface FollowingListResponse {
  count: number;
  total: number;
  lastCompleteRunAt: string | null;
  following: FollowingRow[];
}

export interface FollowingQueueItem {
  handle: string;
  displayName: string | null;
  firstSeenAt: string;
  url: string;
}

// GET /x/following/queue. `eligibleTotal` is the whole backlog (already-released
// rows included), not just what's left to release; window/daily counters are the
// cadence caps the server enforces (15–18 per 6h, 40/day).
export interface FollowingQueueResponse {
  batch: FollowingQueueItem[];
  eligibleTotal: number;
  releasedNow: number;
  windowUsed: number;
  windowCap: number;
  dailyUsed: number;
  dailyCeiling: number;
  lastCompleteRunAt: string | null;
}

/** `status: 'done'` is the only status a client may set, and only out of
 *  `queued`; `keep` is an independent pin that moves no status. */
export interface FollowingPatchBody {
  status?: 'done';
  keep?: boolean;
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

export interface PlaybookModelCell extends PlaybookCell {
  model: string;
}

export interface PlaybookFormatCell extends PlaybookCell {
  format: PostFormat;
}

export interface PlaybookCoachScoreCell extends PlaybookCell {
  band: CoachBand;
}

export interface PlaybookJudgeBandCell extends PlaybookCell {
  band: JudgeVerdictLabel;
}

/** SC.7 — `GET /x/coach/lexicon`. The two term lists `scoreDraft` takes as its
 *  `lexicon` option (a superset of `CoachLexicon`: `niche` is provenance only),
 *  derived server-side from the active niche + channels + pillars. */
export interface CoachLexiconResponse {
  niche: string;
  specificTerms: string[];
  tribeTerms: string[];
}

/** SC.6 — `GET /x/posts/cooldowns`. One cell per format published inside the
 *  window, in `POST_FORMATS` cascade order. Mirrors the wire shape of
 *  `src/shared/postCooldown.ts` (which the panel never builds, only reads):
 *  `lastPostedAt` is an ISO string here because it crossed JSON.
 *
 *  `exempt` marks the three fallback labels that mean "no format detected" and
 *  can therefore never warn — read it instead of keeping a copy of the list, or
 *  the panel and the server will disagree about what counts as a shape. */
export type CooldownStatus = 'clear' | 'warming' | 'cooldown';

export interface CooldownCell {
  format: PostFormat;
  count: number;
  status: CooldownStatus;
  exempt: boolean;
  lastPostedAt: string;
  exampleText: string;
}

export interface CooldownsResponse {
  windowDays: number;
  warmingAt: number;
  cooldownAt: number;
  cells: CooldownCell[];
}

/** SC.8 — `GET /x/coach/reach`. One cell per format, always all 14, in
 *  `POST_FORMATS` cascade order. Mirrors `src/x/coach/reach.ts`; the panel reads
 *  finished cells and does no arithmetic, so no shim ships for that module.
 *
 *  `weightSource` is the whole contract: `'insufficient'` cells carry `null` in
 *  every numeric field because there is no seed table to fall back on — a format
 *  we have not measured has no band, not a default one. Render `n` (and `minN`)
 *  to say how far off it is; never invent the rest. */
export interface ReachCell {
  format: PostFormat;
  n: number;
  exempt: boolean;
  weightSource: 'fitted' | 'insufficient';
  /** Absolute views, `[p25, p75]` of the outcomes that did not escape. */
  stallRange: [number, number] | null;
  escapeThreshold: number | null;
  /** 0–1. */
  escapeProbability: number | null;
  p50Multiplier: number | null;
}

export interface ReachFit {
  base: number | null;
  measuredPosts: number;
  fittedPosts: number;
  minN: number;
  escapeMultiple: number;
  baseWindow: number;
  cells: ReachCell[];
}

// Opportunity-capture funnel (HV.5). `unknown` is not a verdict — the row had
// no tweet time, so no age and no velocity to classify with; it never folds
// into the null band, which does mean "judged not worth replying to".
export interface PlaybookFunnelCell {
  band: 'hot' | 'warm' | 'skip' | null | 'unknown';
  seen: number;
  replied: number;
  rate: number | null;
  sufficient: boolean;
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
    canned: PlaybookCell;
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
  // Personal-context lift (M1/ME.5): replies that carried the Me brief vs cold
  // ones. Replies are the only measured surface (posts always inject). Lift only
  // when both sides clear the gate.
  meEffectiveness: {
    withMe: PlaybookCell;
    withoutMe: PlaybookCell;
    totalMeasured: number;
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
  // Post format × outcome (SC.5): the fourth axis — pillar = topic, register =
  // tone, angle = reply stance, FORMAT = structure. Classified at read time from
  // posts_published.text, so it has n on day one. Cells in cascade order, only
  // for formats that occur; no lift line (no canonical baseline pair).
  formatEffectiveness: {
    cells: PlaybookFormatCell[];
    totalPosted: number;
    totalMeasured: number;
  };
  // The coach's own judge (SC.5): does the score the Composer shows predict
  // anything? Bands partition every original; `clean`/`flagged` is the same
  // corpus split on fix count, which is the question the band alone can't answer
  // (a 90-scoring draft can still carry one red fix row).
  coachScoreEffectiveness: {
    cells: PlaybookCoachScoreCell[];
    clean: PlaybookCell;
    flagged: PlaybookCell;
    totalPosted: number;
    totalMeasured: number;
    spread: number | null;
    profileVisitsSpread: number | null;
    spreadBands: { high: CoachBand; low: CoachBand } | null;
    fixSpread: number | null;
    fixProfileVisitsSpread: number | null;
  };
  // Does the LLM judge predict anything (JD.7)? The same own originals bucketed
  // by the verdict band the judge gave that EXACT text — the link is a read-time
  // hash, so a post edited after judging reads as `unjudged` (its own bucket,
  // never folded into a band). `approved`/`rejected` is the same judged rows
  // split two ways, which clears the gate at half the sample.
  judgeEffectiveness: {
    cells: PlaybookJudgeBandCell[];
    unjudged: PlaybookCell;
    approved: PlaybookCell;
    rejected: PlaybookCell;
    totalPosted: number;
    totalMeasured: number;
    spread: number | null;
    profileVisitsSpread: number | null;
    spreadBands: { high: JudgeVerdictLabel; low: JudgeVerdictLabel } | null;
    approvedSpread: number | null;
    approvedProfileVisitsSpread: number | null;
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
  // Model effectiveness (AI.12): posted replies grouped by the model that
  // drafted them — the judge of the OpenRouter experiment. Buckets only, each
  // independently gated; no lift line (no canonical baseline pair).
  modelEffectiveness: {
    cells: PlaybookModelCell[];
    totalMeasured: number;
  };
  // Timeline opportunity-capture funnel (HV.5): of the tweets the algorithm
  // actually put in front of me (the passive home-timeline corpus), how many did
  // I reply to, per band at first sighting. Rate is null under the per-cell gate.
  timelineFunnel: {
    cells: PlaybookFunnelCell[];
    totalSeen: number;
    totalReplied: number;
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

// ---------------------------------------------------------------------------
// Reply lists (RL) — premade canned replies, picked + rendered + humanized on
// the server (Decision 1: the anti-repeat state lives in the DB, never here).
// The panel only manages the lists and copies the returned text; posting stays
// a manual paste (§7.28). Mirrors the `/x/reply-lists` JSON — Date columns are
// ISO strings over the transport.

/** The per-list jitter knobs. A stored config is ALWAYS fully normalized by the
 *  server, so a non-null value here has every field. `null` on a list means the
 *  engine defaults apply — PATCH `{humanizer:{}}` to materialize them.
 *
 *  HM.3: re-exported from the `../humanize.ts` shim rather than declared here —
 *  the panel now RUNS that engine (Radar picks), so a hand-mirrored copy of the
 *  seven fields could drift from the module doing the work (§7 rule 4c, the
 *  JD.6 `JudgeVerdict` precedent). Type-only, so nothing is bundled. */
export type { HumanizerConfig };

// HM.2/HM.3 — the PROJECT-level humanizer: one server-owned `app_settings` row
// (`GET/PATCH/DELETE /x/humanizer`) that the Radar's pick path reads. A sibling
// of the per-list configs above, never a replacement — lists keep their own.
export interface HumanizerSettings extends HumanizerConfig {
  /** Opt-in: the Radar checkbox defaults OFF. */
  enabled: boolean;
}

/** PATCH is strict per field server-side — a bad value 400s (`invalid_enabled`,
 *  `invalid_prefixes`, `invalid_typo_chance`, …), it never silently falls back. */
export type HumanizerPatchBody = Partial<HumanizerSettings>;

export type ReplyTemplateVar = 'name' | 'first_name' | 'handle';
export type ReplyListItemSource = 'manual' | 'ai';

export interface ReplyList {
  id: string;
  name: string;
  description: string | null;
  humanizer: HumanizerConfig | null;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** The collection GET adds both counts — the rail renders "n items · m on". */
export interface ReplyListSummary extends ReplyList {
  itemCount: number;
  enabledCount: number;
}

export interface ReplyListItem {
  id: string;
  listId: string;
  text: string;
  enabled: boolean;
  source: ReplyListItemSource;
  /** The anti-repeat watermark — null = never used. */
  lastUsedAt: string | null;
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReplyListDetail {
  list: ReplyList;
  items: ReplyListItem[];
}

export interface ReplyListCreateBody {
  name: string;
  description?: string;
  humanizer?: HumanizerConfig | null;
}

export interface ReplyListPatchBody {
  name?: string;
  description?: string | null;
  /** null clears back to the engine defaults; `{}` materializes them. */
  humanizer?: HumanizerConfig | Record<string, never> | null;
  active?: boolean;
  sortOrder?: number;
}

/** `replace` swaps the whole set in one txn; `source` is per CALL, not per item. */
export interface ReplyListItemsBody {
  mode: 'append' | 'replace';
  items: { text: string }[];
  source?: ReplyListItemSource;
}

export interface ReplyListItemPatchBody {
  text?: string;
  enabled?: boolean;
}

export interface UseReplyBody {
  vars?: { name?: string; handle?: string };
  targetTweetId?: string;
  targetHandle?: string;
  /** true = render a sample without stamping the anti-repeat state. */
  preview?: boolean;
}

export interface UseReplyResponse {
  itemId: string;
  text: string;
  /** Vars the template wanted but the target didn't supply (stripped, not left raw). */
  missingVars: ReplyTemplateVar[];
  /** Which jitters fired, e.g. `['prefix', 'typo:swap']`. */
  applied: string[];
}

export interface GenerateItemsBody {
  prompt: string;
  /** 1..30 — refused, not clamped, past the cap. */
  count?: number;
  model?: string;
  provider?: LlmProvider;
}

/** Proposal only — nothing is persisted until the panel applies it via setItems. */
export interface GenerateItemsResponse {
  items: { text: string }[];
  count: number;
  requested: number;
  model: string;
  costUsd: number;
  requestId?: string;
}
