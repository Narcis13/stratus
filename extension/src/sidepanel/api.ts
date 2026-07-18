// Typed thin client over the stratus API. Since §9.5 every call routes through
// the background service worker (shared/messages.ts ApiRequest) — one transport,
// one place that reads the bearer token and stamps the Authorization header.
// The `Settings` parameter stays in the signatures so callers keep gating on
// configuration, but the background loads its own copy from chrome.storage.

import type { ApiRequest, ApiResponse, BinaryPayload } from '../shared/messages.ts';
import {
  ApiError,
  type AssetSaveBody,
  type AuthorProfile,
  type BatchReplyGenerateBody,
  type BatchReplyItem,
  type BatchReplyResponse,
  type BatchReplyTweet,
  type BestTimeCell,
  type BestTimesResponse,
  type Brief,
  type BriefGap,
  type BriefQuests,
  type BriefTweet,
  type Channel,
  type ChannelAggregate,
  type ChannelCreateBody,
  type ChannelPatchBody,
  type ContentPillar,
  type ConversationItem,
  type ConversationPatchBody,
  type ConversationThread,
  type ConversationsResponse,
  type ConversionWindow,
  type CreateBody,
  type CreateThreadBody,
  type CreateThreadResponse,
  type DigestFacts,
  type DigestResponse,
  type FanItem,
  type FansResponse,
  type FollowupItem,
  type FollowupKind,
  type FollowupSnoozeBody,
  type FollowupsResponse,
  type GeneratedImageItem,
  type GoalKind,
  type GoalStatus,
  type IcebreakersResponse,
  type Idea,
  type IdeaCreateBody,
  type IdeaPatchBody,
  type IdeaStatus,
  type IdeasResponse,
  type ImageGenerateBody,
  type ImageGenerateResponse,
  type ListOpts,
  type MeContextResponse,
  type MeEntry,
  type MeEntryCreateBody,
  type MeEntryPatchBody,
  type MeGoal,
  type MeGoalCreateBody,
  type MeGoalPatchBody,
  type MeKind,
  type MeResponse,
  type MediaAsset,
  type Mention,
  type MentionPatchBody,
  type MentionStatus,
  type MentionsRefreshResult,
  type MentionsResponse,
  type MetricsAccountResponse,
  type Niche,
  type NicheActive,
  type NicheChannelProposal,
  type NicheCreateBody,
  type NicheDoctrine,
  type NicheDraftResult,
  type NichePatchBody,
  type NichePillarProposal,
  type NicheProposal,
  type PeopleListOpts,
  type PeopleListResponse,
  type Person,
  type PersonAngleCell,
  type PersonDossier,
  type PersonEvent,
  type PersonEventCreateBody,
  type PersonListItem,
  type PersonPatchBody,
  type PersonReplyOutcome,
  type PersonStage,
  type PillarCreateBody,
  type PillarDraftBody,
  type PillarDraftResult,
  type PillarUpdateBody,
  type PinnedWatch,
  type Playbook,
  type PlaybookAngleCell,
  type PlaybookCell,
  type PlaybookExtractResult,
  type PlaybookIdeaSurface,
  type PlaybookLatencyCell,
  type PlaybookRosterCoverage,
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
  type SettingEntry,
  type SettingsGroup,
  type SettingsPatchResult,
  type SettingsResetResult,
  type SettingsResponse,
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
  AssetSaveBody,
  AuthorProfile,
  GeneratedImageItem,
  ImageGenerateBody,
  ImageGenerateResponse,
  MediaAsset,
  BatchReplyGenerateBody,
  BatchReplyItem,
  BatchReplyResponse,
  BatchReplyTweet,
  BestTimeCell,
  BestTimesResponse,
  Brief,
  BriefGap,
  BriefQuests,
  BriefTweet,
  DigestFacts,
  DigestResponse,
  IcebreakersResponse,
  Channel,
  ChannelAggregate,
  ChannelCreateBody,
  ChannelPatchBody,
  ContentPillar,
  ConversationItem,
  ConversationPatchBody,
  ConversationThread,
  ConversationsResponse,
  ConversionWindow,
  CreateBody,
  CreateThreadBody,
  CreateThreadResponse,
  FanItem,
  FansResponse,
  FollowupItem,
  FollowupKind,
  FollowupSnoozeBody,
  FollowupsResponse,
  Idea,
  IdeaCreateBody,
  IdeaPatchBody,
  IdeaStatus,
  IdeasResponse,
  PinnedWatch,
  ListOpts,
  GoalKind,
  GoalStatus,
  MeContextResponse,
  MeEntry,
  MeEntryCreateBody,
  MeEntryPatchBody,
  MeGoal,
  MeGoalCreateBody,
  MeGoalPatchBody,
  MeKind,
  MeResponse,
  Mention,
  MetricsAccountResponse,
  Niche,
  NicheActive,
  NicheChannelProposal,
  NicheCreateBody,
  NicheDoctrine,
  NicheDraftResult,
  NichePatchBody,
  NichePillarProposal,
  NicheProposal,
  PillarCreateBody,
  PillarDraftBody,
  PillarDraftResult,
  PillarUpdateBody,
  MentionPatchBody,
  MentionStatus,
  MentionsRefreshResult,
  MentionsResponse,
  PeopleListOpts,
  PeopleListResponse,
  Person,
  Playbook,
  PlaybookAngleCell,
  PlaybookCell,
  PlaybookExtractResult,
  PlaybookIdeaSurface,
  PlaybookLatencyCell,
  PlaybookRosterCoverage,
  PersonAngleCell,
  PersonDossier,
  PersonEvent,
  PersonEventCreateBody,
  PersonListItem,
  PersonPatchBody,
  PersonReplyOutcome,
  PersonStage,
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
  SettingEntry,
  SettingsGroup,
  SettingsPatchResult,
  SettingsResetResult,
  SettingsResponse,
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

/** §S4 — fetch an image endpoint as base64 (the background reads the blob and
 *  encodes it; the JSON channel can't carry a Blob). */
async function requestBinary(_s: Settings, path: string): Promise<BinaryPayload> {
  const payload: ApiRequest = { type: 'stratus/api', method: 'GET', path, binary: true };
  const res = (await chrome.runtime.sendMessage(payload)) as ApiResponse<BinaryPayload> | undefined;
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

  // C9 — the Sunday Digest. Cached per week server-side; only refresh=true
  // re-spends the ~$0.01 narration call. factsOnly (S3 stat card) never
  // triggers Grok narration — the read stays $0.
  digest(
    s: Settings,
    opts: { week?: string; refresh?: boolean; factsOnly?: boolean } = {},
  ): Promise<DigestResponse> {
    const q = new URLSearchParams({ tzOffsetMin: String(new Date().getTimezoneOffset()) });
    if (opts.week) q.set('week', opts.week);
    if (opts.refresh) q.set('refresh', 'true');
    if (opts.factsOnly) q.set('factsOnly', 'true');
    return request<DigestResponse>(s, `/x/digest?${q.toString()}`);
  },

  list(s: Settings, opts: ListOpts = {}): Promise<ScheduledPost[]> {
    const q = new URLSearchParams();
    if (opts.from) q.set('from', opts.from);
    if (opts.to) q.set('to', opts.to);
    if (opts.status) q.set('status', opts.status);
    const qs = q.toString();
    return request<ScheduledPost[]>(s, `/x/posts/scheduled${qs ? `?${qs}` : ''}`);
  },

  // §8.4 / S0.4 — engagement by local weekday × hour, for the Composer's
  // best-time slot picker. Bucketed in the browser's local timezone.
  metrics: {
    bestTimes(s: Settings): Promise<BestTimesResponse> {
      return request<BestTimesResponse>(
        s,
        `/x/metrics/best-times?tzOffsetMin=${new Date().getTimezoneOffset()}`,
      );
    },

    // S5.5 — the daily follower KPI series; the milestone card detects the
    // latest crossed rung client-side over it ($0, already-billed data).
    account(s: Settings): Promise<MetricsAccountResponse> {
      return request<MetricsAccountResponse>(s, '/x/metrics/account');
    },
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

  // S4 — AI backgrounds (xAI grok-imagine-image) composited UNDER the Studio's
  // text. Base64 in the response (never a raw xAI URL); ~$0.02/image, watchdogged.
  images: {
    generate(s: Settings, body: ImageGenerateBody): Promise<ImageGenerateResponse> {
      return request<ImageGenerateResponse>(s, '/x/images/generate', { method: 'POST', body });
    },
  },

  // S4 — the Studio asset library: composed PNGs + generated backgrounds as
  // SQLite blobs. list() is metadata only; png() streams bytes as base64.
  assets: {
    list(s: Settings): Promise<MediaAsset[]> {
      return request<{ assets: MediaAsset[] }>(s, '/x/assets').then((r) => r.assets);
    },

    save(s: Settings, body: AssetSaveBody): Promise<MediaAsset> {
      return request<MediaAsset>(s, '/x/assets', { method: 'POST', body });
    },

    /** Re-open a saved asset: raw PNG bytes as base64 (build an ImageBitmap). */
    png(s: Settings, id: string): Promise<BinaryPayload> {
      return requestBinary(s, `/x/assets/${encodeURIComponent(id)}/png`);
    },

    remove(s: Settings, id: string): Promise<void> {
      return request<void>(s, `/x/assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

  // N0 — the niche: identity + strategy container. get() returns the active
  // niche + resolved doctrine; activation is update(slug, { active: true }).
  niche: {
    get(s: Settings): Promise<NicheActive> {
      return request<NicheActive>(s, '/x/niche');
    },

    list(s: Settings): Promise<Niche[]> {
      return request<Niche[]>(s, '/x/niches');
    },

    create(s: Settings, body: NicheCreateBody): Promise<Niche> {
      return request<Niche>(s, '/x/niches', { method: 'POST', body });
    },

    update(s: Settings, slug: string, body: NichePatchBody): Promise<Niche> {
      return request<Niche>(s, `/x/niches/${encodeURIComponent(slug)}`, { method: 'PATCH', body });
    },

    remove(s: Settings, slug: string): Promise<unknown> {
      return request<unknown>(s, `/x/niches/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    },

    // N0.8 — Grok wizard: prose → a proposed niche (persona/beliefs/pillars/
    // channels). Not persisted; review/edit then create.
    draft(s: Settings, description: string): Promise<NicheDraftResult> {
      return request<NicheDraftResult>(s, '/x/niche/draft', {
        method: 'POST',
        body: { description },
      });
    },
  },

  // M1 — Me / My Profile: the dynamic personal-context layer. get() returns
  // entries (each with a server-computed inWindow flag) + goals (each with
  // computed progress); context() is the exact rendered block a draft would see.
  me: {
    get(s: Settings, opts: { kind?: MeKind; active?: boolean } = {}): Promise<MeResponse> {
      const q = new URLSearchParams();
      if (opts.kind) q.set('kind', opts.kind);
      if (opts.active !== undefined) q.set('active', String(opts.active));
      const qs = q.toString();
      return request<MeResponse>(s, `/x/me${qs ? `?${qs}` : ''}`);
    },

    context(s: Settings, mode: 'post' | 'reply'): Promise<MeContextResponse> {
      return request<MeContextResponse>(s, `/x/me/context?mode=${mode}`);
    },

    addEntry(s: Settings, body: MeEntryCreateBody): Promise<MeEntry> {
      return request<MeEntry>(s, '/x/me/entries', { method: 'POST', body });
    },

    patchEntry(s: Settings, id: string, body: MeEntryPatchBody): Promise<MeEntry> {
      return request<MeEntry>(s, `/x/me/entries/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body,
      });
    },

    deleteEntry(s: Settings, id: string): Promise<void> {
      return request<void>(s, `/x/me/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    addGoal(s: Settings, body: MeGoalCreateBody): Promise<MeGoal> {
      return request<MeGoal>(s, '/x/me/goals', { method: 'POST', body });
    },

    patchGoal(s: Settings, id: string, body: MeGoalPatchBody): Promise<MeGoal> {
      return request<MeGoal>(s, `/x/me/goals/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body,
      });
    },

    deleteGoal(s: Settings, id: string): Promise<void> {
      return request<void>(s, `/x/me/goals/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  },

  // UI.1/UI.10 — the server settings registry. The panel renders from GET
  // /x/settings (never the registry itself); PATCH validates per-key against the
  // registry floors/ceilings, all-or-nothing.
  settings: {
    get(s: Settings): Promise<SettingsResponse> {
      return request<SettingsResponse>(s, '/x/settings');
    },

    patch(s: Settings, patch: Record<string, unknown>): Promise<SettingsPatchResult> {
      return request<SettingsPatchResult>(s, '/x/settings', { method: 'PATCH', body: patch });
    },

    reset(s: Settings, opts: { keys?: string[]; group?: string }): Promise<SettingsResetResult> {
      return request<SettingsResetResult>(s, '/x/settings/reset', { method: 'POST', body: opts });
    },
  },

  // C8 — channels: topic rooms as saved views over tags.
  channels: {
    list(s: Settings, opts: { active?: boolean } = {}): Promise<Channel[]> {
      const qs = opts.active === undefined ? '' : `?active=${opts.active}`;
      return request<Channel[]>(s, `/x/channels${qs}`);
    },

    aggregate(s: Settings, slug: string): Promise<ChannelAggregate> {
      return request<ChannelAggregate>(s, `/x/channels/${encodeURIComponent(slug)}`);
    },

    create(s: Settings, body: ChannelCreateBody): Promise<Channel> {
      return request<Channel>(s, '/x/channels', { method: 'POST', body });
    },

    update(s: Settings, slug: string, body: ChannelPatchBody): Promise<Channel> {
      return request<Channel>(s, `/x/channels/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        body,
      });
    },

    remove(s: Settings, slug: string): Promise<unknown> {
      return request<unknown>(s, `/x/channels/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    },

    // Channel tags on a radar row, keyed by tweetId (every draft row of that
    // tweet gets them so any copy rehydrates correctly).
    tagRadarDraft(s: Settings, tweetId: string, tags: string[]): Promise<unknown> {
      return request<unknown>(s, `/x/radar/drafts/${encodeURIComponent(tweetId)}/tags`, {
        method: 'PATCH',
        body: { tags },
      });
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

    // C8 — replace a saved tweet's channel tags.
    setTweetTags(s: Settings, tweetId: string, tags: string[]): Promise<VoiceTweet> {
      return request<VoiceTweet>(s, `/x/voice/tweets/${encodeURIComponent(tweetId)}`, {
        method: 'PATCH',
        body: { tags },
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

  // C6 — the Idea Inbox: capture seeds, consume them explicitly, reopen freely.
  ideas: {
    list(s: Settings, opts: { status?: IdeaStatus | 'all'; limit?: number } = {}): Promise<Idea[]> {
      const q = new URLSearchParams();
      if (opts.status) q.set('status', opts.status);
      if (opts.limit !== undefined) q.set('limit', String(opts.limit));
      const qs = q.toString();
      return request<IdeasResponse>(s, `/x/ideas${qs ? `?${qs}` : ''}`).then((r) => r.ideas);
    },

    create(s: Settings, body: IdeaCreateBody): Promise<Idea> {
      return request<Idea>(s, '/x/ideas', { method: 'POST', body });
    },

    patch(s: Settings, id: string, body: IdeaPatchBody): Promise<Idea> {
      return request<Idea>(s, `/x/ideas/${encodeURIComponent(id)}`, { method: 'PATCH', body });
    },

    remove(s: Settings, id: string): Promise<void> {
      return request<void>(s, `/x/ideas/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  },

  // C4 — the measured playbook + one-time own-winner template extraction.
  playbook: {
    get(s: Settings, opts: { minN?: number } = {}): Promise<Playbook> {
      const qs = opts.minN !== undefined ? `?minN=${opts.minN}` : '';
      return request<Playbook>(s, `/x/playbook${qs}`);
    },

    extractWinners(s: Settings, limit?: number): Promise<PlaybookExtractResult> {
      return request<PlaybookExtractResult>(s, '/x/playbook/extract-winners', {
        method: 'POST',
        body: limit !== undefined ? { limit } : {},
      });
    },
  },

  // C1 — the people layer: list, dossier, notes/stage edits, manual log.
  people: {
    list(s: Settings, opts: PeopleListOpts = {}): Promise<PeopleListResponse> {
      const q = new URLSearchParams();
      if (opts.stage) q.set('stage', opts.stage);
      if (opts.tag) q.set('tag', opts.tag);
      if (opts.q) q.set('q', opts.q);
      if (opts.sort) q.set('sort', opts.sort);
      if (opts.retired) q.set('retired', 'true');
      if (opts.limit !== undefined) q.set('limit', String(opts.limit));
      const qs = q.toString();
      return request<PeopleListResponse>(s, `/x/people${qs ? `?${qs}` : ''}`);
    },

    dossier(s: Settings, handle: string): Promise<PersonDossier> {
      return request<PersonDossier>(s, `/x/people/${encodeURIComponent(handle)}`);
    },

    patch(s: Settings, handle: string, body: PersonPatchBody): Promise<Person> {
      return request<Person>(s, `/x/people/${encodeURIComponent(handle)}`, {
        method: 'PATCH',
        body,
      });
    },

    addEvent(
      s: Settings,
      handle: string,
      body: PersonEventCreateBody,
    ): Promise<{ person: Person; event: PersonEvent }> {
      return request(s, `/x/people/${encodeURIComponent(handle)}/events`, {
        method: 'POST',
        body,
      });
    },

    // C5 — the follow-up queue: who do I owe, who to nurture, who's heating up.
    followups(s: Settings): Promise<FollowupsResponse> {
      return request<FollowupsResponse>(s, '/x/people/followups');
    },

    snoozeFollowup(s: Settings, body: FollowupSnoozeBody): Promise<unknown> {
      return request<unknown>(s, '/x/people/followups', { method: 'PATCH', body });
    },

    // C9 — two conversation starters grounded strictly on real shared context.
    icebreakers(s: Settings, handle: string): Promise<IcebreakersResponse> {
      return request<IcebreakersResponse>(
        s,
        `/x/people/${encodeURIComponent(handle)}/icebreakers`,
        { method: 'POST', body: {} },
      );
    },

    // C5 — Top Fans: inbound-ranked "people who already notice you".
    fans(s: Settings, opts: { days?: number; limit?: number } = {}): Promise<FansResponse> {
      const q = new URLSearchParams();
      if (opts.days !== undefined) q.set('days', String(opts.days));
      if (opts.limit !== undefined) q.set('limit', String(opts.limit));
      const qs = q.toString();
      return request<FansResponse>(s, `/x/people/fans${qs ? `?${qs}` : ''}`);
    },
  },

  // C2 — the mention inbox as threads, with Slack-style read state.
  conversations: {
    list(s: Settings, opts: { limit?: number } = {}): Promise<ConversationsResponse> {
      const qs = opts.limit !== undefined ? `?limit=${opts.limit}` : '';
      return request<ConversationsResponse>(s, `/x/conversations${qs}`);
    },

    patch(s: Settings, conversationId: string, body: ConversationPatchBody): Promise<unknown> {
      return request<unknown>(s, `/x/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'PATCH',
        body,
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

    // The default Grok system prompt the override field replaces ($0).
    defaultPrompt(s: Settings): Promise<{ prompt: string }> {
      return request<{ prompt: string }>(s, '/x/replies/default-prompt');
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
