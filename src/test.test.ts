import { afterAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { db } from './db/client.ts';
import { beat, heartbeatStatus, registerHeartbeat, unregisterHeartbeat } from './heartbeats.ts';
import { matchOrigin } from './middleware/cors.ts';
import type { ActiveTimesGrid } from './shared/activeTimes.ts';
import { classifyBand } from './shared/replyBand.ts';
import { buildAuthorizeUrl, generatePkcePair } from './x/auth.ts';
import { metricsSnapshots, postsPublished } from './x/db/schema.ts';
import type { XTweet } from './x/endpoints.ts';
import { containsUrl, createPost } from './x/endpoints.ts';
import { XApiError, classify } from './x/errors.ts';
import { defaultPostParams } from './x/fields.ts';
import { DEFAULT_NICHE } from './x/niche/defaults.ts';
import {
  IDEAS_PROMPT_TEMPLATE,
  buildIdeasInput,
  parseIdeaProposals,
} from './x/posts/ideasPrompt.ts';
import { buildPillarDraftInput, parsePillarProposal } from './x/posts/pillarDraft.ts';
import {
  DEFAULT_PILLARS,
  type PillarDef,
  isValidPillarSlug,
  parsePillar,
  renderPillars,
} from './x/posts/pillars.ts';
import {
  POST_PROMPT_TEMPLATE,
  buildPostDraftInput,
  buildPostDraftsSchema,
  parsePostDrafts,
} from './x/posts/prompt.ts';
import {
  REWRITE_PROMPT_TEMPLATE,
  buildRewriteInput,
  parseRewrite,
} from './x/posts/rewritePrompt.ts';
import {
  THREAD_PROMPT_TEMPLATE,
  buildThreadDraftInput,
  parseThreadDraft,
} from './x/posts/threadPrompt.ts';
import { priceFor } from './x/pricing.ts';
import {
  type BatchTweet,
  type PostContext,
  REPLY_BATCH_PROMPT_TEMPLATE,
  REPLY_PROMPT_TEMPLATE,
  blankLineBetweenPropositions,
  buildBatchGrokInput,
  buildGrokInput,
  parseBatchReplies,
  parseReplyVariants,
  passesSpecificityGate,
} from './x/replies/prompt.ts';
import {
  type AnnotatedGap,
  type PinnedWatchPost,
  annotateGaps,
  attachLatestSnapshots,
  buildPinnedWatch,
  findScheduleGaps,
  followerTrend,
  localDayStart,
  localMinuteOfDay,
  pickAnchors,
  pinnedSince,
} from './x/routes/brief.ts';
import {
  type UnlinkedDraft,
  matchUnlinkedDraft,
  normalizeHarvestText,
  parseIngestRow,
} from './x/routes/harvest.ts';
import {
  MAX_REFRESHES_PER_DAY,
  type RefreshLimiter,
  takeRefreshSlot,
} from './x/routes/mentions.ts';
import {
  BEST_TIME_MIN_N,
  type BestTimeCell,
  aggregatePillars,
  bestTimeCellFor,
  bestTimeScore,
  buildAccountSeries,
  buildBestTimes,
  rankBestTimes,
} from './x/routes/metrics.ts';
import { type RadarBatchTweet, buildRadarDraftRows, radarDraftExpired } from './x/routes/radar.ts';
import { parseBatchTweets } from './x/routes/replies.ts';
import { buildReplyOutcomes, gateSignalsFor, parseContext, replies } from './x/routes/replies.ts';
import {
  type FollowerSnapshotPoint,
  authorMomentum,
  rankTargets,
  targetBand,
} from './x/routes/voice.ts';
import { EXTRACT_PROMPT_TEMPLATE, parseExtractedTemplate } from './x/voice/extractPrompt.ts';
import { ingestPulledTweet, maxTweetId, msUntilNextUtcHour } from './x/workers/dailyMetrics.ts';

describe('containsUrl', () => {
  test('flags http and https in any position', () => {
    expect(containsUrl('check this https://x.com/y')).toBe(true);
    expect(containsUrl('http://x.com is the link')).toBe(true);
    expect(containsUrl('see HTTPS://x.com')).toBe(true);
  });

  test('does not flag plain text', () => {
    expect(containsUrl('no link here')).toBe(false);
    expect(containsUrl(undefined)).toBe(false);
  });
});

describe('defaultPostParams', () => {
  test('owned-private adds non_public_metrics', () => {
    const p = defaultPostParams({ ownedPrivate: true });
    expect(p['tweet.fields']).toContain('non_public_metrics');
    expect(p['tweet.fields']).toContain('organic_metrics');
  });

  test('default omits private metrics', () => {
    const p = defaultPostParams();
    expect(p['tweet.fields']).not.toContain('non_public_metrics');
  });
});

describe('errors.classify', () => {
  test('401 → auth_invalid', () => {
    const e = new XApiError({ status: 401, type: 'about:blank', detail: '', rawBody: null });
    expect(classify(e)).toBe('auth_invalid');
  });

  test('reply restriction by detail keyword', () => {
    const e = new XApiError({
      status: 403,
      type: 'https://api.x.com/2/problems/client-forbidden',
      detail: 'You are not permitted to reply',
      rawBody: null,
    });
    expect(classify(e)).toBe('reply_restriction');
  });

  test('duplicate content', () => {
    const e = new XApiError({
      status: 403,
      type: 'https://api.x.com/2/problems/client-forbidden',
      detail: 'Duplicate content',
      rawBody: null,
    });
    expect(classify(e)).toBe('duplicate_content');
  });

  test('5xx → server_error', () => {
    const e = new XApiError({ status: 503, type: 'about:blank', detail: '', rawBody: null });
    expect(classify(e)).toBe('server_error');
  });
});

describe('pricing.priceFor', () => {
  test('POST /2/tweets is the $0.015 base (URL surcharge handled at call site)', () => {
    expect(priceFor('/2/tweets', 'POST', 201, null)).toBe(0.015);
  });

  test('DELETE /2/tweets/:id is $0.010', () => {
    expect(priceFor('/2/tweets/1234567890', 'DELETE', 200, null)).toBe(0.01);
  });

  test('GET /2/users/me is an owned read at $0.001', () => {
    expect(priceFor('/2/users/me', 'GET', 200, null)).toBe(0.001);
  });

  test('GET /2/tweets/:id prices as other-user $0.005 (conservative)', () => {
    expect(priceFor('/2/tweets/abc', 'GET', 200, null)).toBe(0.005);
  });

  test('GET /2/users/:id/tweets is an owned read priced per result', () => {
    expect(priceFor('/2/users/123/tweets', 'GET', 200, 40)).toBeCloseTo(0.04, 5);
    expect(priceFor('/2/users/123/tweets', 'GET', 200, null)).toBe(0.001);
  });

  test('GET /2/tweets batch lookup is an owned read priced per result', () => {
    expect(priceFor('/2/tweets?ids=1,2,3', 'GET', 200, 3)).toBeCloseTo(0.003, 5);
    expect(priceFor('/2/tweets', 'GET', 200, null)).toBe(0.001);
  });

  test('search/recent multiplies $0.005 by item count', () => {
    expect(priceFor('/2/tweets/search/recent', 'GET', 200, 10)).toBeCloseTo(0.05, 5);
  });

  test('GET /2/users/:id/mentions is an owned read priced per result (§7.5)', () => {
    expect(priceFor('/2/users/123/mentions', 'GET', 200, 12)).toBeCloseTo(0.012, 5);
    expect(priceFor('/2/users/123/mentions', 'GET', 200, null)).toBe(0.001);
  });

  test('search/recent with unknown items defaults to one result (undercount)', () => {
    expect(priceFor('/2/tweets/search/recent', 'GET', 200, null)).toBe(0.005);
  });

  test('query string is stripped before matching', () => {
    expect(priceFor('/2/users/me?user.fields=id', 'GET', 200, null)).toBe(0.001);
  });

  test('4xx returns 0 — X does not bill failed client requests', () => {
    expect(priceFor('/2/tweets', 'POST', 403, null)).toBe(0);
    expect(priceFor('/2/tweets/abc', 'GET', 429, null)).toBe(0);
  });

  test('unknown endpoint returns 0 (visible gap, not fabricated number)', () => {
    expect(priceFor('/2/something/new', 'GET', 200, null)).toBe(0);
  });
});

describe('dailyMetrics schedule', () => {
  const HOUR = 60 * 60_000;

  test('schedules the next 03:00 UTC ahead of now', () => {
    // 01:00 UTC → 2h until 03:00 the same day.
    expect(msUntilNextUtcHour(new Date(Date.UTC(2026, 5, 5, 1, 0, 0)), 3)).toBe(2 * HOUR);
    // 05:00 UTC → 22h until the next day's 03:00.
    expect(msUntilNextUtcHour(new Date(Date.UTC(2026, 5, 5, 5, 0, 0)), 3)).toBe(22 * HOUR);
  });

  test('exactly 03:00 UTC rolls to the following day', () => {
    expect(msUntilNextUtcHour(new Date(Date.UTC(2026, 5, 5, 3, 0, 0)), 3)).toBe(24 * HOUR);
  });

  test('crosses the month boundary correctly', () => {
    // 2026-06-30 05:00 UTC → next 03:00 is 2026-07-01 03:00 (22h).
    expect(msUntilNextUtcHour(new Date(Date.UTC(2026, 5, 30, 5, 0, 0)), 3)).toBe(22 * HOUR);
  });
});

describe('maxTweetId (discovery checkpoint high-water)', () => {
  test('compares snowflakes as BigInt, not Number', () => {
    // These differ only past Number's 2^53 safe range — a Number compare ties.
    const lo = '2078076276561093110';
    const hi = '2078111316628107769';
    expect(maxTweetId(lo, hi)).toBe(hi);
    expect(maxTweetId(hi, lo)).toBe(hi);
  });

  test('passes through when either side is undefined', () => {
    expect(maxTweetId(undefined, '123')).toBe('123');
    expect(maxTweetId('123', undefined)).toBe('123');
    expect(maxTweetId(undefined, undefined)).toBeUndefined();
  });

  test('never regresses on equal ids', () => {
    expect(maxTweetId('999', '999')).toBe('999');
  });
});

// The discovery pull now doubles as the snapshot read (one billed read per own
// tweet per day instead of two — audit 2026-07-23). The property that keeps that
// safe is idempotency: the pull can be replayed after a crash that lost the
// checkpoint, and a tweet already retired must cost nothing and write nothing.
describe('ingestPulledTweet (discovery pull = snapshot)', () => {
  const NOW = new Date('2026-07-24T03:00:00Z');
  const POSTED = new Date('2026-07-23T15:00:00Z');
  const IDS = ['dm1_new', 'dm1_replay', 'dm1_sched', 'dm1_reply'];

  // posts_published/metrics_snapshots are global to the in-memory DB and the
  // playbook suite aggregates over both — leave nothing behind.
  afterAll(async () => {
    await db.delete(metricsSnapshots).where(inArray(metricsSnapshots.tweetId, IDS));
    await db.delete(postsPublished).where(inArray(postsPublished.tweetId, IDS));
  });

  function pulled(id: string, extra: Partial<XTweet> = {}): XTweet {
    return {
      id,
      text: 'pulled from the timeline',
      created_at: POSTED.toISOString(),
      public_metrics: { impression_count: 900, like_count: 4 },
      non_public_metrics: { user_profile_clicks: 2 },
      ...extra,
    } as XTweet;
  }

  async function readRow(tweetId: string) {
    const [row] = await db
      .select({
        retired: postsPublished.retired,
        pollCount: postsPublished.pollCount,
        nextPollAt: postsPublished.nextPollAt,
        isReply: postsPublished.isReply,
        source: postsPublished.source,
      })
      .from(postsPublished)
      .where(eq(postsPublished.tweetId, tweetId));
    return row;
  }

  async function snapshotCount(tweetId: string) {
    const rows = await db
      .select({ id: metricsSnapshots.id })
      .from(metricsSnapshots)
      .where(eq(metricsSnapshots.tweetId, tweetId));
    return rows.length;
  }

  test('an unseen tweet lands retired, with its snapshot, in one step', async () => {
    expect(ingestPulledTweet(pulled('dm1_new'), NOW)).toBe('discovered');

    const row = await readRow('dm1_new');
    // Retired immediately: this is what stops snapshotDue buying the same read
    // a second time minutes later.
    expect(row?.retired).toBe(true);
    expect(row?.nextPollAt).toBeNull();
    // pollCount 1 keeps it eligible for the day-7 winner re-read.
    expect(row?.pollCount).toBe(1);
    expect(row?.source).toBe('manual');
    expect(await snapshotCount('dm1_new')).toBe(1);
  });

  test('replaying the same tweet writes nothing and never double-snapshots', async () => {
    ingestPulledTweet(pulled('dm1_replay'), NOW);
    expect(await snapshotCount('dm1_replay')).toBe(1);

    // A run that died before saveDiscoveryCheckpoint re-pulls this tweet.
    expect(ingestPulledTweet(pulled('dm1_replay'), NOW)).toBe('already-retired');
    expect(ingestPulledTweet(pulled('dm1_replay'), NOW)).toBe('already-retired');

    expect(await snapshotCount('dm1_replay')).toBe(1);
    expect((await readRow('dm1_replay'))?.pollCount).toBe(1); // not inflated
  });

  test('a publisher-inserted scheduled post is adopted, not re-read', async () => {
    await db.insert(postsPublished).values({
      tweetId: 'dm1_sched',
      text: 'scheduled by the publisher',
      postedAt: POSTED,
      source: 'scheduled',
      nextPollAt: new Date(POSTED.getTime() + 24 * 60 * 60 * 1000),
    });

    expect(ingestPulledTweet(pulled('dm1_sched'), NOW)).toBe('snapshotted');

    const row = await readRow('dm1_sched');
    expect(row?.retired).toBe(true);
    expect(row?.nextPollAt).toBeNull();
    expect(row?.source).toBe('scheduled'); // provenance survives adoption
    expect(await snapshotCount('dm1_sched')).toBe(1);
  });

  test('a reply is snapshotted too — the row is free once the pull is paid for', async () => {
    const outcome = ingestPulledTweet(
      pulled('dm1_reply', {
        in_reply_to_user_id: '999',
        referenced_tweets: [{ type: 'replied_to', id: 'parent-1' }],
      }),
      NOW,
    );
    expect(outcome).toBe('discovered');
    expect((await readRow('dm1_reply'))?.isReply).toBe(true);
    // Playbook reply attribution reads these; dropping them would save $0.
    expect(await snapshotCount('dm1_reply')).toBe(1);
  });
});

describe('heartbeats', () => {
  test('fresh after registration, stale past the threshold, refreshed by beat', () => {
    registerHeartbeat('test.worker', 5 * 60_000);
    try {
      const now = new Date();

      let [hb] = heartbeatStatus(now).filter((h) => h.name === 'test.worker');
      expect(hb?.stale).toBe(false);

      const later = new Date(now.getTime() + 5 * 60_000 + 1);
      [hb] = heartbeatStatus(later).filter((h) => h.name === 'test.worker');
      expect(hb?.stale).toBe(true);

      // beat() re-stamps lastBeatAt to wall-clock now, so check against a
      // fresh now — `later` is still ~threshold ahead of any real timestamp.
      beat('test.worker');
      [hb] = heartbeatStatus(new Date()).filter((h) => h.name === 'test.worker');
      expect(hb?.stale).toBe(false);
    } finally {
      unregisterHeartbeat('test.worker');
    }
  });

  test('unregister removes the entry; beat on unknown name is a no-op', () => {
    registerHeartbeat('test.gone', 1000);
    unregisterHeartbeat('test.gone');
    expect(heartbeatStatus().some((h) => h.name === 'test.gone')).toBe(false);
    expect(() => beat('test.gone')).not.toThrow();
  });
});

describe('cors.matchOrigin', () => {
  const NONE = new Set<string>();

  test('any chrome-extension://* origin is allowed', () => {
    expect(matchOrigin('chrome-extension://abc123', NONE)).toBe(true);
    expect(matchOrigin('chrome-extension://different-id', NONE)).toBe(true);
  });

  test('static set allows exact matches only', () => {
    const allowed = new Set(['https://stratus.fly.dev']);
    expect(matchOrigin('https://stratus.fly.dev', allowed)).toBe(true);
    expect(matchOrigin('https://stratus.fly.dev/', allowed)).toBe(false);
    expect(matchOrigin('https://evil.com', allowed)).toBe(false);
  });

  test('empty origin is rejected', () => {
    expect(matchOrigin('', NONE)).toBe(false);
  });

  test('chrome-extension prefix must be the scheme — no smuggling', () => {
    expect(matchOrigin('https://chrome-extension://abc', NONE)).toBe(false);
  });
});

describe('PKCE', () => {
  test('verifier is 43+ chars and challenge differs', async () => {
    const { codeVerifier, codeChallenge } = await generatePkcePair();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeChallenge).not.toBe(codeVerifier);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('authorize URL has all required params', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'cid',
        redirectUri: 'http://127.0.0.1:3000/cb',
        state: 's',
        codeChallenge: 'cc',
      }),
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('offline.access');
    expect(url.searchParams.get('scope')).toContain('tweet.write');
  });
});

describe('buildAccountSeries', () => {
  const snap = (iso: string, followers: number, tweets = 100) => ({
    snapshotAt: new Date(iso),
    followersCount: followers,
    followingCount: 50,
    tweetCount: tweets,
    listedCount: 2,
  });
  const post = (iso: string, isReply = false) => ({ postedAt: new Date(iso), isReply });

  test('empty input → empty series', () => {
    expect(buildAccountSeries([], [])).toEqual([]);
  });

  test('first point has null deltas and 24h-lookback activity', () => {
    const series = buildAccountSeries(
      [snap('2026-06-10T03:00:00Z', 1000)],
      [
        post('2026-06-09T02:00:00Z'), // before lookback window
        post('2026-06-09T09:00:00Z'),
        post('2026-06-10T01:00:00Z', true),
      ],
    );
    expect(series).toHaveLength(1);
    expect(series[0]?.deltas).toBeNull();
    expect(series[0]?.activity).toEqual({ posts: 1, replies: 1 });
  });

  test('deltas vs previous snapshot, activity bucketed (prev, cur]', () => {
    const series = buildAccountSeries(
      [snap('2026-06-11T03:00:00Z', 1012, 105), snap('2026-06-10T03:00:00Z', 1000, 100)],
      [
        post('2026-06-10T03:00:00Z'), // exactly at prev boundary → belongs to day 1, not day 2
        post('2026-06-10T09:00:00Z'),
        post('2026-06-10T12:00:00Z', true),
        post('2026-06-11T03:00:00Z', true), // exactly at cur boundary → inclusive
        post('2026-06-11T04:00:00Z'), // after window → unattributed
      ],
    );
    expect(series).toHaveLength(2);
    // Sorted ascending even though input was newest-first.
    expect(series[0]?.followersCount).toBe(1000);
    expect(series[1]?.deltas).toEqual({ followers: 12, following: 0, tweets: 5, listed: 0 });
    expect(series[0]?.activity).toEqual({ posts: 1, replies: 0 });
    expect(series[1]?.activity).toEqual({ posts: 1, replies: 2 });
  });
});

describe('reply prompt (§7.1)', () => {
  const promptCtx: PostContext = {
    tweetId: '123456',
    handle: 'someone',
    author: 'Some One',
    text: 'a tweet about agents',
    url: 'https://x.com/someone/status/123456',
    postedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    metrics: { views: 1500, replies: 8, reposts: 2, likes: 30 },
    topComments: [],
  };

  test('embedded template stays in sync with reply prompt.md', async () => {
    const md = await Bun.file(new URL('../reply prompt.md', import.meta.url)).text();
    expect(REPLY_PROMPT_TEMPLATE.trimEnd()).toBe(md.trimEnd());
  });

  test('template carries the structured-output contract, not the clipboard one', () => {
    expect(REPLY_PROMPT_TEMPLATE).not.toContain('clipboard');
    expect(REPLY_PROMPT_TEMPLATE).toContain('"replies"');
    expect(REPLY_PROMPT_TEMPLATE).toContain('{{IDEA}}');
    // Variable content must sit at the very end so the prefix caches.
    expect(REPLY_PROMPT_TEMPLATE.trimEnd().endsWith('<idea>{{IDEA}}</idea>')).toBe(true);
  });

  test('template asks for three variants, one per angle (RU.1)', () => {
    expect(REPLY_PROMPT_TEMPLATE).toContain('## The three variants');
    expect(REPLY_PROMPT_TEMPLATE).toContain('exactly three');
    expect(REPLY_PROMPT_TEMPLATE).not.toContain('two variants');
    for (const angle of ['extends', 'contrarian', 'debate']) {
      expect(REPLY_PROMPT_TEMPLATE).toContain(angle);
    }
  });

  // N0.4 equivalence guarantee: with the untouched seed niche (all defaults),
  // the assembled prompt must carry the ORIGINAL "Who I am" body byte-exact,
  // in place. The fixture is an independent copy of the pre-extraction text —
  // deliberately NOT read from the .md (which now holds the placeholder) nor
  // from DEFAULT_NICHE (which is what's under test).
  const ORIGINAL_WHO_I_AM_BODY = `- I'm a **solopreneur**.
- I'm **passionate about programming, AI, and marketing**.
- I **build in public**.

That is the entire biography you have. Never invent or imply anything else — no age, no location, no day job, no family, no client stories, no career arc. You can voice opinions and stances as mine, in first person. You cannot invent autobiographical facts — no "I shipped X in 14 days", no "my clients", no made-up numbers. If the steer gives a fact, use it; otherwise stay at the level of stance and observation. A fabricated "37%" or a fake anecdote is worse than no specific at all.`;

  test('N0.4: template holds the placeholder, not the persona', () => {
    expect(REPLY_PROMPT_TEMPLATE).toContain('{{REPLY_PERSONA}}');
    expect(REPLY_PROMPT_TEMPLATE).not.toContain('solopreneur');
  });

  test('N0.4 equivalence: seed niche restores the original "Who I am" body byte-exact', () => {
    // DEFAULT_NICHE itself must not have drifted from the original prose.
    expect(DEFAULT_NICHE.replyPersona).toBe(ORIGINAL_WHO_I_AM_BODY);

    const [msg] = buildGrokInput(promptCtx);
    const content = msg?.content ?? '';
    expect(content).toContain(
      `## Who I am (the COMPLETE persona — infer nothing beyond these three facts)\n\n${ORIGINAL_WHO_I_AM_BODY}\n\n---`,
    );
    expect(content).not.toContain('{{REPLY_PERSONA}}');
  });

  test('N0.4: custom reply persona substitutes in place of the builder identity', () => {
    const [msg] = buildGrokInput(promptCtx, undefined, undefined, undefined, {
      replyPersona: 'NUTRITION REPLY PERSONA BLOCK',
    });
    const content = msg?.content ?? '';
    expect(content).toContain('NUTRITION REPLY PERSONA BLOCK');
    expect(content).not.toContain('solopreneur');
    expect(content).not.toContain('{{REPLY_PERSONA}}');
  });

  test('N0.4: custom override without the token passes through untouched', () => {
    const [msg] = buildGrokInput(
      promptCtx,
      'Custom prompt: {{TWEET_CONTEXT}}',
      undefined,
      undefined,
      {
        replyPersona: 'NUTRITION REPLY PERSONA BLOCK',
      },
    );
    expect(msg?.content).not.toContain('NUTRITION REPLY PERSONA BLOCK');
  });

  test('buildGrokInput substitutes the idea into the tag', () => {
    const [msg] = buildGrokInput(promptCtx, undefined, 'fă-l să sune ca un constructor');
    expect(msg?.content).toContain('<idea>fă-l să sune ca un constructor</idea>');
    expect(msg?.content).not.toContain('{{IDEA}}');
    expect(msg?.content).not.toContain('{{TWEET_CONTEXT}}');
    expect(msg?.content).toContain('a tweet about agents');
  });

  test('empty idea renders an empty tag', () => {
    const [msg] = buildGrokInput(promptCtx);
    expect(msg?.content).toContain('<idea></idea>');
  });

  test('override without the token still gets the idea appended', () => {
    const [msg] = buildGrokInput(promptCtx, 'Custom prompt: {{TWEET_CONTEXT}}', 'seed');
    expect(msg?.content).toContain('<idea>seed</idea>');
  });

  test('parent (mention thread context, §7.5) renders before the original tweet', () => {
    const [msg] = buildGrokInput({ ...promptCtx, parent: { text: 'my post about shipping' } });
    const content = msg?.content ?? '';
    expect(content).toContain('MY POST (the tweet below is a reply to it)');
    expect(content.indexOf('my post about shipping')).toBeLessThan(
      content.indexOf('ORIGINAL TWEET'),
    );
  });

  test('no parent → no thread-context block', () => {
    const [msg] = buildGrokInput(promptCtx);
    expect(msg?.content).not.toContain('MY POST');
  });

  test('parseReplyVariants accepts the schema shape and trims', () => {
    const out = parseReplyVariants(
      '{"replies":[{"text":"  one\\n\\ntwo  ","angle":"contrarian"},{"text":"solo","angle":"extends"}]}',
    );
    expect(out).toEqual([
      { text: 'one\n\ntwo', angle: 'contrarian' },
      { text: 'solo', angle: 'extends' },
    ]);
  });

  test('blankLineBetweenPropositions inserts a blank line between propositions', () => {
    // single newline → blank line between
    expect(blankLineBetweenPropositions('line one\nline two')).toBe('line one\n\nline two');
    // already blank-line-separated → unchanged
    expect(blankLineBetweenPropositions('a\n\nb')).toBe('a\n\nb');
    // collapses extra blank lines and strips per-line + outer whitespace
    expect(blankLineBetweenPropositions('  a  \n\n\n  b  ')).toBe('a\n\nb');
    // a single proposition is left alone
    expect(blankLineBetweenPropositions('just one line')).toBe('just one line');
    // three propositions each get a blank line
    expect(blankLineBetweenPropositions('a\nb\nc')).toBe('a\n\nb\n\nc');
    // sentences sharing one line are split (the common model output)
    expect(blankLineBetweenPropositions('Sentence one. Sentence two.')).toBe(
      'Sentence one.\n\nSentence two.',
    );
    // ? and ! end sentences too
    expect(blankLineBetweenPropositions('Really? Yes! Ship it.')).toBe(
      'Really?\n\nYes!\n\nShip it.',
    );
    // a decimal is not a sentence boundary
    expect(blankLineBetweenPropositions('I shipped 3.5 features today. It worked.')).toBe(
      'I shipped 3.5 features today.\n\nIt worked.',
    );
    // an ellipsis signals continuation — kept whole
    expect(blankLineBetweenPropositions('Hmm... Maybe it works.')).toBe('Hmm... Maybe it works.');
    // already-split sentences are not doubled up
    expect(blankLineBetweenPropositions('Sentence one.\n\nSentence two.')).toBe(
      'Sentence one.\n\nSentence two.',
    );
  });

  test('parseReplyVariants blank-line-separates multi-line replies', () => {
    expect(parseReplyVariants('{"replies":[{"text":"hook\\npunch","angle":"debate"}]}')).toEqual([
      { text: 'hook\n\npunch', angle: 'debate' },
    ]);
  });

  test('parseReplyVariants coerces unknown angles and rejects garbage', () => {
    expect(parseReplyVariants('{"replies":[{"text":"x","angle":"weird"}]}')).toEqual([
      { text: 'x', angle: 'extends' },
    ]);
    expect(parseReplyVariants('not json')).toBeNull();
    expect(parseReplyVariants('{"replies":[]}')).toBeNull();
    expect(parseReplyVariants('{"replies":[{"angle":"extends"}]}')).toBeNull();
    expect(parseReplyVariants('{"replies":[{"text":"   ","angle":"extends"}]}')).toBeNull();
  });

  test('specificity gate: digit, first person, or named tool pass', () => {
    expect(passesSpecificityGate('Shipped it in 14 days.')).toBe(true);
    expect(passesSpecificityGate("I'm 51 and the arc still compounds.")).toBe(true);
    expect(passesSpecificityGate('My wife reconciles ANAF reports by hand.')).toBe(true);
    expect(passesSpecificityGate('Claude Code closes that loop already.')).toBe(true);
  });

  test('specificity gate: generic agreement fails', () => {
    expect(passesSpecificityGate('That take lands. People underestimate this.')).toBe(false);
    expect(passesSpecificityGate('Hard agree — the future belongs to builders.')).toBe(false);
  });
});

describe('batch replies (Radar §7.2)', () => {
  const tweets: BatchTweet[] = [
    { tweetId: '111', handle: 'alice', author: 'Alice', text: 'shipping beats planning' },
    { tweetId: '222', handle: 'bob', author: 'Bob', text: 'AI will replace junior devs' },
  ];

  test('buildBatchGrokInput anchors each post by id and keeps the steer last', () => {
    const [msg] = buildBatchGrokInput(tweets, 'fii contrarian');
    expect(msg?.content).toContain('id: 111');
    expect(msg?.content).toContain('id: 222');
    expect(msg?.content).toContain('@alice (Alice):');
    // reuses the master persona/voice block
    expect(msg?.content).toContain('solopreneur');
    // variable content sits at the very end (cacheable prefix)
    expect(msg?.content.trimEnd().endsWith('<idea>fii contrarian</idea>')).toBe(true);
  });

  test('batch head keeps the voice block, not the single-reply variants section', () => {
    const content = buildBatchGrokInput(tweets)[0]?.content ?? '';
    // The persona + forbidden lists live verbatim in the standalone batch
    // template (AI.5 — the anti-drift test below locks them to the single
    // default). Single-reply-only content must never leak in.
    expect(content).toContain('Forbidden openers');
    expect(content).toContain('solopreneur');
    expect(content).not.toContain('not three paraphrases');
    expect(content).not.toContain('{{TWEET_CONTEXT}}');
    // The template's own {{POSTS}}/{{IDEA}} tokens must be fully substituted.
    expect(content).not.toContain('{{POSTS}}');
    expect(content).not.toContain('{{IDEA}}');
    // N0.4: the voice block carries {{REPLY_PERSONA}} — the batch builder must
    // substitute it, never ship the raw token to Grok.
    expect(content).not.toContain('{{REPLY_PERSONA}}');
  });

  test('N0.4: batch grounds on the seed persona by default, custom persona via opts', () => {
    const defaultContent = buildBatchGrokInput(tweets)[0]?.content ?? '';
    expect(defaultContent).toContain("- I'm a **solopreneur**.");
    expect(defaultContent).toContain('That is the entire biography you have.');

    const custom = buildBatchGrokInput(tweets, undefined, undefined, undefined, undefined, {
      replyPersona: 'NUTRITION REPLY PERSONA BLOCK',
    })[0]?.content;
    expect(custom).toContain('NUTRITION REPLY PERSONA BLOCK');
    expect(custom).not.toContain('solopreneur');
    expect(custom).not.toContain('{{REPLY_PERSONA}}');
  });

  test('buildBatchGrokInput leaves an empty idea tag when none given', () => {
    const [msg] = buildBatchGrokInput(tweets);
    expect(msg?.content.trimEnd().endsWith('<idea></idea>')).toBe(true);
  });

  test('AI.5 anti-drift: the standalone batch DEFAULT embeds the reply DEFAULT voice block verbatim', () => {
    // The old slicer's headings, now applied to DEFAULTS only (Decision 2):
    // both defaults carry the raw {{REPLY_PERSONA}} token (D3), so the sliced
    // block compares verbatim. A voice edit to reply prompt.md that isn't
    // mirrored into REPLY_BATCH_PROMPT_TEMPLATE fails here.
    const start = REPLY_PROMPT_TEMPLATE.indexOf('## Who I am');
    const end = REPLY_PROMPT_TEMPLATE.indexOf('## The three variants');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const voiceBlock = REPLY_PROMPT_TEMPLATE.slice(start, end).trimEnd();
    expect(REPLY_BATCH_PROMPT_TEMPLATE).toContain(voiceBlock);
    // The render contract: posts + idea at the variable tail, persona in place.
    expect(REPLY_BATCH_PROMPT_TEMPLATE).toContain('{{POSTS}}');
    expect(REPLY_BATCH_PROMPT_TEMPLATE).toContain('{{IDEA}}');
    expect(REPLY_BATCH_PROMPT_TEMPLATE).toContain('{{REPLY_PERSONA}}');
    expect(REPLY_BATCH_PROMPT_TEMPLATE.indexOf('{{POSTS}}')).toBeLessThan(
      REPLY_BATCH_PROMPT_TEMPLATE.indexOf('{{IDEA}}'),
    );
  });

  test('AI.5: a reply-batch template override changes the rendered batch prompt', () => {
    const custom = 'CUSTOM BATCH HEAD\n\nPOSTS:\n{{POSTS}}\n\nSTEER: <idea>{{IDEA}}</idea>';
    const content =
      buildBatchGrokInput(tweets, 'go', undefined, undefined, undefined, { template: custom })[0]
        ?.content ?? '';
    expect(content.startsWith('CUSTOM BATCH HEAD')).toBe(true);
    expect(content).toContain('id: 111');
    expect(content).toContain('<idea>go</idea>');
    expect(content).not.toContain('{{POSTS}}');
    expect(content).not.toContain('solopreneur');
  });

  test('parseBatchReplies maps id→tweetId, keeps variants, trims, coerces unknown angles', () => {
    const out = parseBatchReplies(
      '{"replies":[{"id":"111","variants":[{"text":" hot take ","angle":"contrarian"},{"text":"x","angle":"weird"}]}]}',
    );
    expect(out).toEqual([
      {
        tweetId: '111',
        variants: [
          { text: 'hot take', angle: 'contrarian' },
          { text: 'x', angle: 'extends' },
        ],
      },
    ]);
  });

  test('parseBatchReplies blank-line-separates each variant', () => {
    expect(
      parseBatchReplies(
        '{"replies":[{"id":"111","variants":[{"text":"a\\nb\\nc","angle":"extends"}]}]}',
      ),
    ).toEqual([{ tweetId: '111', variants: [{ text: 'a\n\nb\n\nc', angle: 'extends' }] }]);
  });

  test('parseBatchReplies rejects garbage, blank text, and a missing/empty variants array', () => {
    expect(parseBatchReplies('not json')).toBeNull();
    // blank variant text
    expect(
      parseBatchReplies('{"replies":[{"id":"1","variants":[{"text":"   ","angle":"extends"}]}]}'),
    ).toBeNull();
    // missing id
    expect(
      parseBatchReplies('{"replies":[{"variants":[{"text":"x","angle":"extends"}]}]}'),
    ).toBeNull();
    // old flat shape (no variants array) → null
    expect(parseBatchReplies('{"replies":[{"id":"1","text":"x","angle":"extends"}]}')).toBeNull();
    // empty variants array → null (a post must carry ≥1 variant)
    expect(parseBatchReplies('{"replies":[{"id":"1","variants":[]}]}')).toBeNull();
    // empty replies array is a valid (if useless) batch response, not a parse failure
    expect(parseBatchReplies('{"replies":[]}')).toEqual([]);
  });

  test('parseBatchTweets validates, dedups by id, and clamps the batch', () => {
    const ok = parseBatchTweets([
      { tweetId: '111', handle: '@alice', author: 'Alice', text: 'a' },
      { tweetId: '111', handle: 'alice', author: 'Alice', text: 'dup dropped' },
      { tweetId: '222', handle: 'bob', text: 'no author falls back to handle' },
    ]);
    if ('error' in ok) throw new Error(ok.error);
    expect(ok.tweets.map((t) => t.tweetId)).toEqual(['111', '222']);
    expect(ok.tweets[0]?.handle).toBe('alice');
    expect(ok.tweets[1]?.author).toBe('bob');

    expect(parseBatchTweets([])).toEqual({ error: 'empty_tweets' });
    expect(parseBatchTweets('nope')).toEqual({ error: 'invalid_tweets' });
    expect(parseBatchTweets([{ tweetId: 'abc', handle: 'a', text: 'x' }])).toEqual({
      error: 'invalid_tweet_id_0',
    });
    expect(
      parseBatchTweets(
        Array.from({ length: 26 }, (_, i) => ({ tweetId: String(i), handle: 'a', text: 'x' })),
      ),
    ).toEqual({ error: 'too_many_tweets' });
  });

  test('parseBatchTweets carries band + signals through (C0) and rejects junk', () => {
    const signals = { views: 1500, replies: 8, ageMin: 22, vpm: 68, bait: false };
    const ok = parseBatchTweets([
      { tweetId: '111', handle: 'alice', text: 'a', band: 'hot', signals },
      { tweetId: '222', handle: 'bob', text: 'b' },
    ]);
    if ('error' in ok) throw new Error(ok.error);
    expect(ok.tweets[0]?.band).toBe('hot');
    expect(ok.tweets[0]?.signals).toEqual(signals);
    expect('band' in (ok.tweets[1] ?? {})).toBe(false);

    // A ⊕ manual add (RU.8) carries band: 'manual' through to radar_drafts.
    const manual = parseBatchTweets([
      { tweetId: '333', handle: 'carol', text: 'c', band: 'manual' },
    ]);
    if ('error' in manual) throw new Error(manual.error);
    expect(manual.tweets[0]?.band).toBe('manual');

    expect(parseBatchTweets([{ tweetId: '1', handle: 'a', text: 'x', band: 'cold' }])).toEqual({
      error: 'invalid_tweet_band_0',
    });
    expect(
      parseBatchTweets([{ tweetId: '1', handle: 'a', text: 'x', signals: { views: -1 } }]),
    ).toEqual({ error: 'invalid_tweet_signals_0' });
  });
});

describe('radar drafts (C0)', () => {
  const tweets: RadarBatchTweet[] = [
    {
      tweetId: '111',
      handle: 'alice',
      author: 'Alice',
      text: 'shipping beats planning',
      url: 'https://x.com/alice/status/111',
      band: 'hot',
      signals: { views: 1500, replies: 8, ageMin: 22, vpm: 68, bait: false },
    },
    // author fell back to handle at parse time → stored as null, not duplicated
    { tweetId: '222', handle: 'bob', author: 'bob', text: 'AI take' },
  ];

  test('buildRadarDraftRows pairs replies with their tweets, keeps signals, stores variants, threads model', () => {
    const rows = buildRadarDraftRows(
      tweets,
      [
        {
          tweetId: '111',
          text: 'my reply',
          angle: 'contrarian',
          variants: [
            { text: 'my reply', angle: 'contrarian' },
            { text: 'push it further', angle: 'extends' },
            { text: 'pick a side', angle: 'debate' },
          ],
        },
        {
          tweetId: '222',
          text: 'other reply',
          angle: 'extends',
          variants: [{ text: 'other reply', angle: 'extends' }],
        },
        {
          tweetId: '999',
          text: 'unknown id dropped',
          angle: 'extends',
          variants: [{ text: 'unknown id dropped', angle: 'extends' }],
        },
      ],
      'grok-4',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      tweetId: '111',
      url: 'https://x.com/alice/status/111',
      handle: 'alice',
      author: 'Alice',
      snippet: 'shipping beats planning',
      band: 'hot',
      signals: { views: 1500, replies: 8, ageMin: 22, vpm: 68, bait: false },
      replyText: 'my reply',
      angle: 'contrarian',
      variants: [
        { text: 'my reply', angle: 'contrarian' },
        { text: 'push it further', angle: 'extends' },
        { text: 'pick a side', angle: 'debate' },
      ],
      model: 'grok-4',
    });
    expect(rows[1]?.author).toBeNull();
    expect(rows[1]?.band).toBeNull();
    expect(rows[1]?.url).toBeNull();
    expect(rows[1]?.model).toBe('grok-4');
    // A caller supplying only the primary (no variants) → null (RU.2 "unknown"
    // semantics); null model threads through too (CLI callers).
    const primaryOnly = buildRadarDraftRows(
      tweets,
      [{ tweetId: '111', text: 'x', angle: 'debate' }],
      null,
    );
    expect(primaryOnly[0]?.model).toBeNull();
    expect(primaryOnly[0]?.variants).toBeNull();
  });

  test('radarDraftExpired flips at exactly 48h', () => {
    const drafted = new Date('2026-07-01T00:00:00Z');
    const t = drafted.getTime();
    expect(radarDraftExpired(drafted, t + 47 * 3600_000)).toBe(false);
    expect(radarDraftExpired(drafted, t + 48 * 3600_000)).toBe(true);
  });
});

// CIRCLES-PLAN C0 item 1: the top comments scraped into PostContext must
// survive the trip into contextSnapshot untruncated — C1 mines them. The
// route stores parseContext's output verbatim, so this round-trip IS the
// persistence contract (the prompt render may cap at 10; storage never does).
describe('contextSnapshot keeps top comments (C0)', () => {
  test('all comments survive parseContext + JSON round-trip, full text, in order', () => {
    const topComments = Array.from({ length: 12 }, (_, i) => ({
      author: `Commenter ${i}`,
      handle: `@commenter${i}`,
      text: `comment ${i} — ${'long enough that truncation would show '.repeat(8)}`,
    }));
    const out = parseContext({
      tweetId: '123456',
      handle: '@someone',
      author: 'Some One',
      text: 'a tweet',
      url: 'https://x.com/someone/status/123456',
      postedAt: '2026-06-10T08:00:00Z',
      metrics: { views: 1500, replies: 8, reposts: 2, likes: 30 },
      topComments,
    });
    if ('error' in out) throw new Error(out.error);
    expect(out.topComments).toEqual(topComments);
    // what the DB json column stores and returns
    const roundTrip = JSON.parse(JSON.stringify(out)) as { topComments: unknown };
    expect(roundTrip.topComments).toEqual(topComments);
  });
});

describe('replies parseContext signals', () => {
  const baseCtx = {
    tweetId: '123456',
    handle: '@someone',
    author: 'Some One',
    text: 'a tweet',
    url: 'https://x.com/someone/status/123456',
    postedAt: '2026-06-10T08:00:00Z',
    metrics: { views: 1500, replies: 8, reposts: 2, likes: 30 },
    topComments: [],
  };
  const signals = { band: 'hot', views: 1500, replies: 8, ageMin: 22.5, vpm: 66.7, bait: false };

  test('context without signals stays valid and carries no signals key', () => {
    const out = parseContext(baseCtx);
    if ('error' in out) throw new Error(out.error);
    expect('signals' in out).toBe(false);
  });

  test('valid signals are preserved verbatim (band null allowed)', () => {
    const out = parseContext({ ...baseCtx, signals });
    if ('error' in out) throw new Error(out.error);
    expect(out.signals).toEqual({
      band: 'hot',
      views: 1500,
      replies: 8,
      ageMin: 22.5,
      vpm: 66.7,
      bait: false,
    });

    const nullBand = parseContext({ ...baseCtx, signals: { ...signals, band: null } });
    if ('error' in nullBand) throw new Error(nullBand.error);
    expect(nullBand.signals?.band).toBeNull();
  });

  test('rejects unknown band, negative numbers, non-boolean bait', () => {
    expect(parseContext({ ...baseCtx, signals: { ...signals, band: 'meh' } })).toEqual({
      error: 'invalid_context_signals_band',
    });
    expect(parseContext({ ...baseCtx, signals: { ...signals, views: -1 } })).toEqual({
      error: 'invalid_context_signals_views',
    });
    expect(parseContext({ ...baseCtx, signals: { ...signals, vpm: Number.NaN } })).toEqual({
      error: 'invalid_context_signals_vpm',
    });
    expect(parseContext({ ...baseCtx, signals: { ...signals, bait: 'yes' } })).toEqual({
      error: 'invalid_context_signals_bait',
    });
    expect(parseContext({ ...baseCtx, signals: [] })).toEqual({ error: 'invalid_context_signals' });
  });

  test('optional parent is preserved; junk parents are rejected (§7.5)', () => {
    const out = parseContext({ ...baseCtx, parent: { text: 'my original post' } });
    if ('error' in out) throw new Error(out.error);
    expect(out.parent).toEqual({ text: 'my original post' });

    const none = parseContext(baseCtx);
    if ('error' in none) throw new Error(none.error);
    expect('parent' in none).toBe(false);

    expect(parseContext({ ...baseCtx, parent: 'text' })).toEqual({
      error: 'invalid_context_parent',
    });
    expect(parseContext({ ...baseCtx, parent: { text: '   ' } })).toEqual({
      error: 'invalid_context_parent',
    });
    expect(parseContext({ ...baseCtx, parent: {} })).toEqual({
      error: 'invalid_context_parent',
    });
  });
});

describe('ME.3 personal-context injection at the variable tail', () => {
  // The builders append ctx.me / meContext / meBrief verbatim as opaque strings,
  // so unique sentinels prove placement/order/count without a real rendered block
  // (and can never collide with the template prose).
  const POST_BLOCK = 'MEBLOCK::post-context-for-grounding';
  const BRIEF = 'MEBRIEF::reply-personal-context';

  const ctx: PostContext = {
    url: 'https://x.com/someone/status/1',
    tweetId: '1',
    author: 'Some One',
    handle: 'someone',
    text: 'agents are eating SaaS',
    postedAt: '2026-06-10T08:00:00Z',
    metrics: { views: 100, replies: 1, reposts: 0, likes: 2 },
    topComments: [],
  };

  test('post drafter: meContext appended purely at the tail; absent → byte-identical', () => {
    const base = { winners: [] };
    const cold = buildPostDraftInput(base)[0]?.content ?? '';
    expect(cold).not.toContain(POST_BLOCK);

    const warm = buildPostDraftInput({ ...base, meContext: POST_BLOCK })[0]?.content ?? '';
    // Purely additive at the tail — the cold prompt is an exact prefix.
    expect(warm).toBe(`${cold}\n\n${POST_BLOCK}`);

    // Whitespace-only meContext counts as absent (no change).
    expect(buildPostDraftInput({ ...base, meContext: '   ' })[0]?.content).toBe(cold);
  });

  test('post drafter: meContext sits before the guidance line', () => {
    const both =
      buildPostDraftInput({ winners: [], meContext: POST_BLOCK, guidance: 'GUIDE::structures' })[0]
        ?.content ?? '';
    expect(both.indexOf(POST_BLOCK)).toBeGreaterThan(-1);
    expect(both.indexOf('GUIDE::structures')).toBeGreaterThan(both.indexOf(POST_BLOCK));
  });

  test('single reply: ctx.me appended after the idea, only when stamped', () => {
    const cold = buildGrokInput(ctx)[0]?.content ?? '';
    expect(cold).not.toContain(BRIEF);

    const warm = buildGrokInput({ ...ctx, me: BRIEF })[0]?.content ?? '';
    expect(warm).toContain(BRIEF);
    expect(warm.indexOf(BRIEF)).toBeGreaterThan(warm.indexOf('</idea>'));

    // Empty me → no change.
    expect(buildGrokInput({ ...ctx, me: '' })[0]?.content).toBe(cold);
  });

  test('single reply: tail order is relationship → me → guidance', () => {
    const warm =
      buildGrokInput({ ...ctx, relationship: 'REL::block', me: BRIEF, guidance: 'GUIDE::block' })[0]
        ?.content ?? '';
    expect(warm.indexOf(BRIEF)).toBeGreaterThan(warm.indexOf('REL::block'));
    expect(warm.indexOf('GUIDE::block')).toBeGreaterThan(warm.indexOf(BRIEF));
  });

  test('batch: meBrief rides exactly once at the tail, only when supplied', () => {
    const t: BatchTweet = { tweetId: '1', handle: 'someone', author: 'SO', text: 'post one' };
    const cold = buildBatchGrokInput([t])[0]?.content ?? '';
    expect(cold).not.toContain(BRIEF);

    const warm =
      buildBatchGrokInput([t, { ...t, tweetId: '2' }], undefined, undefined, undefined, undefined, {
        meBrief: BRIEF,
      })[0]?.content ?? '';
    // Exactly once — it describes me, not each of the 2 posts.
    expect(warm.split(BRIEF).length - 1).toBe(1);
    // At the very tail, after the last post.
    expect(warm.indexOf(BRIEF)).toBeGreaterThan(warm.indexOf('POST 2'));
  });

  test('parseContext never copies a client-supplied me (server-stamped only)', () => {
    const out = parseContext({
      tweetId: '123456',
      handle: '@someone',
      author: 'Some One',
      text: 'a tweet',
      url: 'https://x.com/someone/status/123456',
      postedAt: '2026-06-10T08:00:00Z',
      metrics: { views: 10, replies: 0, reposts: 0, likes: 0 },
      topComments: [],
      me: 'INJECTED BY CLIENT',
    });
    if ('error' in out) throw new Error(out.error);
    expect('me' in out).toBe(false);
  });
});

describe('mentions refresh limiter (§7.5)', () => {
  const day1 = new Date('2026-06-10T08:00:00Z');

  test('counts up within a day and refuses past the cap', () => {
    let state: RefreshLimiter = { day: '', used: 0 };
    for (let i = 0; i < MAX_REFRESHES_PER_DAY; i++) {
      const slot = takeRefreshSlot(state, day1);
      expect(slot.ok).toBe(true);
      expect(slot.remaining).toBe(MAX_REFRESHES_PER_DAY - i - 1);
      state = slot.state;
    }
    const refused = takeRefreshSlot(state, day1);
    expect(refused.ok).toBe(false);
    expect(refused.remaining).toBe(0);
  });

  test('the counter resets on the next UTC day', () => {
    const exhausted: RefreshLimiter = { day: '2026-06-10', used: MAX_REFRESHES_PER_DAY };
    expect(takeRefreshSlot(exhausted, day1).ok).toBe(false);
    const next = takeRefreshSlot(exhausted, new Date('2026-06-11T00:00:01Z'));
    expect(next.ok).toBe(true);
    expect(next.state).toEqual({ day: '2026-06-11', used: 1 });
  });
});

describe('replies band gate (§7.3)', () => {
  const now = Date.parse('2026-06-10T09:00:00Z');
  const ctx = (over: Partial<PostContext> = {}): PostContext => ({
    tweetId: '123456',
    handle: 'someone',
    author: 'Some One',
    text: 'a plain statement tweet.',
    url: 'https://x.com/someone/status/123456',
    postedAt: '2026-06-10T08:00:00Z', // 60 min before `now`
    metrics: { views: 1500, replies: 8, reposts: 2, likes: 30 },
    topComments: [],
    ...over,
  });

  test('capture-time signals win, but the band is recomputed server-side', () => {
    const stamped = { band: null, views: 1500, replies: 8, ageMin: 22.5, vpm: 66.7, bait: false };
    const sig = gateSignalsFor(ctx({ signals: stamped }), now);
    expect(sig).toEqual({ views: 1500, replies: 8, ageMin: 22.5, vpm: 66.7, bait: false });
    // The extension stamped null; current thresholds say hot — the gate must
    // trust its own classifyBand, not the stale verdict.
    expect(classifyBand(sig)).toBe('hot');
  });

  test('without signals, inputs derive from metrics + postedAt + text bait', () => {
    const sig = gateSignalsFor(ctx(), now);
    expect(sig.views).toBe(1500);
    expect(sig.replies).toBe(8);
    expect(sig.ageMin).toBe(60);
    expect(sig.vpm).toBe(25);
    expect(sig.bait).toBe(false);
    expect(classifyBand(sig)).toBe('hot');

    const baity = gateSignalsFor(ctx({ text: 'agree or disagree' }), now);
    expect(baity.bait).toBe(true);
  });

  test('future postedAt clamps age to 0 instead of going negative', () => {
    const sig = gateSignalsFor(ctx({ postedAt: '2026-06-10T10:00:00Z' }), now);
    expect(sig.ageMin).toBe(0);
    expect(sig.vpm).toBe(1500);
  });

  test('dead and buried posts land in the refused bands', () => {
    const dead = gateSignalsFor(
      ctx({ metrics: { views: 40, replies: 1, reposts: 0, likes: 2 } }),
      now,
    );
    expect(classifyBand(dead)).toBeNull();
    const buried = gateSignalsFor(
      ctx({ metrics: { views: 70000, replies: 168, reposts: 50, likes: 900 } }),
      now,
    );
    expect(classifyBand(buried)).toBe('skip');
  });

  // Route-level wiring, through the real Hono handler. Safe to call in tests:
  // the gate refuses BEFORE any Grok call or DB write.
  const post = (body: unknown) =>
    replies.request('/replies/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('generate refuses a dead post with 422 band_gate', async () => {
    // Old + tiny + slow + not bait → null band whatever "now" is.
    const res = await post({
      context: ctx({
        postedAt: '2026-06-08T08:00:00Z',
        metrics: { views: 40, replies: 1, reposts: 0, likes: 2 },
      }),
    });
    expect(res.status).toBe(422);
    const out = (await res.json()) as { error: string; band: unknown; signals: { bait: boolean } };
    expect(out.error).toBe('band_gate');
    expect(out.band).toBeNull();
    expect(out.signals.bait).toBe(false);
  });

  test('generate refuses a buried post (skip band) regardless of age', async () => {
    const res = await post({
      context: ctx({ metrics: { views: 70000, replies: 168, reposts: 50, likes: 900 } }),
    });
    expect(res.status).toBe(422);
    const out = (await res.json()) as { error: string; band: unknown };
    expect(out.error).toBe('band_gate');
    expect(out.band).toBe('skip');
  });

  test('non-boolean override is a 400', async () => {
    const res = await post({ context: ctx(), override: 'yes' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_override');
  });
});

describe('buildReplyOutcomes', () => {
  const draft = (over: Partial<Parameters<typeof buildReplyOutcomes>[0][number]> = {}) => ({
    id: 'd1',
    sourceTweetId: '111',
    sourceAuthorUsername: 'alice',
    sourceText: 'original tweet',
    sourceUrl: 'https://x.com/alice/status/111',
    sourcePostedAt: new Date('2026-06-09T10:00:00Z'),
    contextSnapshot: {
      metrics: { views: 900, replies: 4, reposts: 1, likes: 12 },
      signals: { band: 'hot', views: 900, replies: 4, ageMin: 30, vpm: 30, bait: false },
    },
    replyText: 'drafted reply',
    replyTextEdited: null,
    postedTweetId: '222',
    createdAt: new Date('2026-06-09T10:30:00Z'),
    ...over,
  });

  test('joins posted draft to its latest snapshot and surfaces profile clicks', () => {
    const [row] = buildReplyOutcomes(
      [draft({ replyTextEdited: 'edited reply' })],
      [{ tweetId: '222', postedAt: new Date('2026-06-09T10:31:00Z'), retired: true }],
      [
        // newest-first, like the route's ORDER BY — first row per tweet wins
        {
          tweetId: '222',
          snapshotAt: new Date('2026-06-11T03:00:00Z'),
          publicMetrics: {
            impression_count: 480,
            like_count: 6,
            reply_count: 2,
            retweet_count: 0,
            quote_count: 0,
            bookmark_count: 1,
          },
          nonPublicMetrics: { user_profile_clicks: 3 },
        },
        {
          tweetId: '222',
          snapshotAt: new Date('2026-06-10T03:00:00Z'),
          publicMetrics: { impression_count: 100, like_count: 1 },
          nonPublicMetrics: { user_profile_clicks: 0 },
        },
      ],
    );
    expect(row?.replyText).toBe('edited reply'); // the human edit is what went out
    expect(row?.signals?.band).toBe('hot');
    expect(row?.measuredAt).toEqual(new Date('2026-06-11T03:00:00Z'));
    expect(row?.outcome).toEqual({
      views: 480,
      likes: 6,
      replies: 2,
      retweets: 0,
      quotes: 0,
      bookmarks: 1,
      profileVisits: 3,
    });
    expect(row?.retired).toBe(true);
  });

  test('unlinked or unsnapshotted drafts surface with null outcome', () => {
    const rows = buildReplyOutcomes(
      [
        draft({
          id: 'd-unlinked',
          postedTweetId: null,
          contextSnapshot: { metrics: { views: 1, replies: 0, reposts: 0, likes: 0 } },
        }),
        draft({ id: 'd-pending', postedTweetId: '333' }),
      ],
      [{ tweetId: '333', postedAt: new Date('2026-06-10T12:00:00Z'), retired: false }],
      [],
    );
    expect(rows[0]?.outcome).toBeNull();
    expect(rows[0]?.postedAt).toBeNull();
    expect(rows[0]?.signals).toBeNull(); // pre-stamping draft
    expect(rows[1]?.outcome).toBeNull(); // discovered but not yet snapshotted
    expect(rows[1]?.postedAt).toEqual(new Date('2026-06-10T12:00:00Z'));
    expect(rows[1]?.signals?.band).toBe('hot');
  });
});

describe('harvest parseIngestRow', () => {
  const valid = {
    tweetId: '1234567890',
    handle: '@Some_User',
    text: 'hello world',
    comments: 3,
    reposts: 1,
    likes: 12,
    bookmarks: 2,
    views: 845.0,
    time: '2026-06-09T18:30:00.000Z',
  };

  test('accepts a posts-mode row and normalizes the handle', () => {
    const r = parseIngestRow(valid);
    if ('error' in r) throw new Error(r.error);
    expect(r.handle).toBe('some_user');
    expect(r.views).toBe(845);
    expect(r.tweetTime).toEqual(new Date('2026-06-09T18:30:00.000Z'));
    expect(r.orig).toBeNull();
  });

  test('empty text and missing time are fine (image-only tweet)', () => {
    const r = parseIngestRow({ ...valid, text: '', time: null });
    if ('error' in r) throw new Error(r.error);
    expect(r.text).toBe('');
    expect(r.tweetTime).toBeNull();
  });

  test('rejects bad tweet id, handle, and negative metrics', () => {
    expect(parseIngestRow({ ...valid, tweetId: 'abc' })).toEqual({
      error: 'invalid_row_tweet_id',
    });
    expect(parseIngestRow({ ...valid, handle: 'way-too-long-for-a-handle' })).toEqual({
      error: 'invalid_row_handle',
    });
    expect(parseIngestRow({ ...valid, likes: -1 })).toEqual({ error: 'invalid_row_likes' });
    expect(parseIngestRow({ ...valid, time: 'not-a-date' })).toEqual({ error: 'invalid_row_time' });
  });

  test('parses the replies-mode orig block', () => {
    const r = parseIngestRow({
      ...valid,
      orig: {
        tweetId: '999',
        handle: 'BigAuthor',
        text: 'original post',
        time: '2026-06-09T17:00:00Z',
        comments: 19,
        likes: 38,
        views: 1500,
      },
    });
    if ('error' in r) throw new Error(r.error);
    expect(r.orig?.tweetId).toBe('999');
    expect(r.orig?.handle).toBe('bigauthor');
    expect(r.orig?.views).toBe(1500);
  });

  test('orig with missing id/handle still parses (deep-thread pairing)', () => {
    const r = parseIngestRow({ ...valid, orig: { text: 'orig', comments: 0, likes: 0, views: 0 } });
    if ('error' in r) throw new Error(r.error);
    expect(r.orig?.tweetId).toBeNull();
    expect(r.orig?.handle).toBeNull();
  });
});

describe('harvest matchUnlinkedDraft', () => {
  const draft = (over: Partial<UnlinkedDraft>): UnlinkedDraft => ({
    id: 'd1',
    sourceTweetId: '100',
    replyText: 'my reply',
    replyTextEdited: null,
    createdAt: new Date('2026-06-09T12:00:00Z'),
    ...over,
  });
  const row = (text: string, time: string, origId?: string) => ({
    text,
    tweetTime: new Date(time),
    orig: origId ? { tweetId: origId } : null,
  });

  test('matches on collapsed-whitespace text within the time window', () => {
    const d = draft({ replyText: 'line one\nline two' });
    expect(matchUnlinkedDraft(row('line one line two', '2026-06-09T12:05:00Z'), [d])).toBe(d);
  });

  test('prefers the human edit over the generated text', () => {
    const d = draft({ replyText: 'generated', replyTextEdited: 'what I actually posted' });
    expect(matchUnlinkedDraft(row('generated', '2026-06-09T12:05:00Z'), [d])).toBeNull();
    expect(matchUnlinkedDraft(row('what I actually posted', '2026-06-09T12:05:00Z'), [d])).toBe(d);
  });

  test('rejects replies posted before the draft or too long after', () => {
    const d = draft({});
    expect(matchUnlinkedDraft(row('my reply', '2026-06-09T11:00:00Z'), [d])).toBeNull();
    expect(matchUnlinkedDraft(row('my reply', '2026-06-17T12:00:00Z'), [d])).toBeNull();
    expect(matchUnlinkedDraft(row('my reply', '2026-06-09T11:55:00Z'), [d])).toBe(d); // skew slack
  });

  test('no time or empty text → no fallback match', () => {
    const d = draft({});
    expect(matchUnlinkedDraft({ text: 'my reply', tweetTime: null }, [d])).toBeNull();
    expect(matchUnlinkedDraft(row('   ', '2026-06-09T12:05:00Z'), [d])).toBeNull();
  });

  test('same-source candidate beats a closer text-only twin', () => {
    const other = draft({ id: 'd-other', sourceTweetId: '200' });
    const same = draft({
      id: 'd-same',
      sourceTweetId: '100',
      createdAt: new Date('2026-06-09T08:00:00Z'),
    });
    const m = matchUnlinkedDraft(row('my reply', '2026-06-09T12:05:00Z', '100'), [other, same]);
    expect(m?.id).toBe('d-same');
  });

  test('ties go to the draft created closest to posting time', () => {
    const far = draft({ id: 'd-far', createdAt: new Date('2026-06-09T06:00:00Z') });
    const near = draft({ id: 'd-near', createdAt: new Date('2026-06-09T11:30:00Z') });
    const m = matchUnlinkedDraft(row('my reply', '2026-06-09T12:05:00Z'), [far, near]);
    expect(m?.id).toBe('d-near');
  });
});

describe('harvest normalizeHarvestText', () => {
  test('collapses all whitespace runs to single spaces', () => {
    expect(normalizeHarvestText('a\n\nb\t c  d ')).toBe('a b c d');
  });
});

describe('brief localDayStart / localMinuteOfDay', () => {
  test('tzOffsetMin=0 is the UTC day', () => {
    const now = new Date('2026-06-10T15:30:00Z');
    expect(localDayStart(now, 0).toISOString()).toBe('2026-06-10T00:00:00.000Z');
    expect(localDayStart(now, 0, 1).toISOString()).toBe('2026-06-09T00:00:00.000Z');
  });

  test('UTC+3 (getTimezoneOffset = -180) rolls the day at 21:00 UTC', () => {
    // 22:30 UTC = 01:30 local on the next day → local midnight is 21:00 UTC.
    const now = new Date('2026-06-10T22:30:00Z');
    expect(localDayStart(now, -180).toISOString()).toBe('2026-06-10T21:00:00.000Z');
    // 20:30 UTC = 23:30 local same day.
    const earlier = new Date('2026-06-10T20:30:00Z');
    expect(localDayStart(earlier, -180).toISOString()).toBe('2026-06-09T21:00:00.000Z');
  });

  test('localMinuteOfDay converts an instant to local wall-clock minutes', () => {
    expect(localMinuteOfDay(new Date('2026-06-10T21:30:00Z'), -180)).toBe(30); // 00:30 local
    expect(localMinuteOfDay(new Date('2026-06-10T06:12:00Z'), -180)).toBe(9 * 60 + 12);
  });
});

describe('brief pickAnchors / findScheduleGaps', () => {
  test('3 or fewer filled slots compare against the 3/day ladder', () => {
    expect(pickAnchors(0)).toEqual([9, 13, 18]);
    expect(pickAnchors(3)).toEqual([9, 13, 18]);
    expect(pickAnchors(4)).toEqual([8, 12, 16, 20]);
  });

  test('empty schedule means every anchor is a gap', () => {
    expect(findScheduleGaps([], [9, 13, 18])).toEqual([9, 13, 18]);
  });

  test('posts claim their nearest anchor', () => {
    // 09:12 and 13:25 fill 9 and 13; 18:00 stays open.
    expect(findScheduleGaps([9 * 60 + 12, 13 * 60 + 25], [9, 13, 18])).toEqual([18]);
  });

  test('two posts near one anchor leave the others as gaps', () => {
    expect(findScheduleGaps([9 * 60 + 5, 9 * 60 + 35], [9, 13, 18])).toEqual([13, 18]);
  });

  test('fully slotted day has no gaps', () => {
    const minutes = [8 * 60 + 7, 12 * 60 + 21, 16 * 60 + 33, 20 * 60 + 14];
    expect(findScheduleGaps(minutes, [8, 12, 16, 20])).toEqual([]);
  });
});

describe('brief annotateGaps (S0.4)', () => {
  const c = (weekday: number, hour: number, posts: number, rate: number | null): BestTimeCell => ({
    weekday,
    hour,
    posts,
    avgViews: rate,
    avgViewsPerDay: rate,
    avgLikes: null,
    avgProfileVisits: null,
  });

  test('annotates each gap with its cell and gates at n≥3', () => {
    const cells = [c(3, 9, 5, 400), c(3, 13, 2, 9999), c(3, 18, 4, 800)];
    const gaps = annotateGaps([9, 13, 18], cells, 3);
    const byHour = new Map(gaps.map((g) => [g.hour, g]));
    // n≥3 → sufficient with a score; the 2-post cell reads as "no data".
    expect(byHour.get(9)?.sufficient).toBe(true);
    expect(byHour.get(9)?.score).toBe(400);
    expect(byHour.get(18)?.sufficient).toBe(true);
    expect(byHour.get(13)?.sufficient).toBe(false);
    expect(byHour.get(13)?.score).toBeNull();
    expect(byHour.get(13)?.n).toBe(2);
  });

  test('sorts highest-value hole first, no-data gaps last (by hour)', () => {
    const cells = [c(3, 9, 5, 400), c(3, 18, 4, 800)]; // 13 has no cell at all
    const gaps: AnnotatedGap[] = annotateGaps([9, 13, 18], cells, 3);
    expect(gaps.map((g) => g.hour)).toEqual([18, 9, 13]);
    expect(gaps[2]?.n).toBe(0); // 13 had no measured posts
    expect(gaps[2]?.sufficient).toBe(false);
  });

  test('looks up the requested weekday only', () => {
    const cells = [c(2, 9, 5, 999)]; // Tuesday cell — must not leak into a Wednesday gap
    const [gap] = annotateGaps([9], cells, 3);
    expect(gap?.sufficient).toBe(false);
    expect(gap?.n).toBe(0);
  });

  test('carries audience intensity when a capture exists, never reordering (A3.4)', () => {
    const cells = [c(3, 9, 5, 400)]; // only Wed 9h is measured
    // Wed audience hot at 18h, cold elsewhere. Columns are Mon..Su → col (3+6)%7.
    const audGrid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    (audGrid[(3 + 6) % 7] as number[])[18] = 1;
    const audience: ActiveTimesGrid = {
      cols: 7,
      rows: 24,
      grid: audGrid,
      tzOffsetMin: 0,
      metric: 'likes',
    };
    const withAud = annotateGaps([9, 13, 18], cells, 3, audience);
    const byHour = new Map(withAud.map((g) => [g.hour, g]));
    expect(byHour.get(18)?.audienceScore).toBe(1); // the audience peak
    expect(byHour.get(9)?.audienceScore).toBe(0); // measured but cold audience
    // Ordering stays own-score-first — audience is display data, not a key.
    const noAud = annotateGaps([9, 13, 18], cells, 3);
    expect(noAud.every((g) => g.audienceScore === null)).toBe(true);
    expect(withAud.map((g) => g.hour)).toEqual(noAud.map((g) => g.hour));
    expect(withAud[0]?.hour).toBe(9); // the measured hole still leads
  });
});

describe('brief followerTrend', () => {
  const pt = (iso: string, followers: number) => ({ snapshotAt: new Date(iso), followers });
  const now = new Date('2026-06-10T12:00:00Z');

  test('empty history returns nulls', () => {
    expect(followerTrend([], now)).toEqual({ followers: null, measuredAt: null, delta7d: null });
  });

  test('single point has no delta', () => {
    const t = followerTrend([pt('2026-06-10T03:00:00Z', 120)], now);
    expect(t.followers).toBe(120);
    expect(t.delta7d).toBeNull();
  });

  test('uses the newest snapshot at least 7 days old as baseline', () => {
    const t = followerTrend(
      [
        pt('2026-06-01T03:00:00Z', 100),
        pt('2026-06-03T03:00:00Z', 105), // newest ≤ now-7d → baseline
        pt('2026-06-08T03:00:00Z', 112),
        pt('2026-06-10T03:00:00Z', 118),
      ],
      now,
    );
    expect(t.followers).toBe(118);
    expect(t.delta7d).toBe(13);
  });

  test('falls back to the oldest point when history is shorter than 7 days', () => {
    const t = followerTrend(
      [pt('2026-06-08T03:00:00Z', 110), pt('2026-06-10T03:00:00Z', 118)],
      now,
    );
    expect(t.delta7d).toBe(8);
  });
});

describe('brief pinnedSince (S0.9)', () => {
  const p = (iso: string, id: string | null) => ({ snapshotAt: new Date(iso), pinnedTweetId: id });

  test('no recorded pin yet → nulls', () => {
    expect(pinnedSince([])).toEqual({ pinnedTweetId: null, since: null });
    // Pre-S0.9 rows carry a null pin and must be ignored.
    expect(pinnedSince([p('2026-06-01T03:00:00Z', null)])).toEqual({
      pinnedTweetId: null,
      since: null,
    });
  });

  test('unchanged pin → since is the earliest snapshot of the run', () => {
    const r = pinnedSince([
      p('2026-06-01T03:00:00Z', null), // backfilled history, ignored
      p('2026-06-02T03:00:00Z', 'AAA'),
      p('2026-06-03T03:00:00Z', 'AAA'),
      p('2026-06-04T03:00:00Z', 'AAA'),
    ]);
    expect(r.pinnedTweetId).toBe('AAA');
    expect(r.since).toEqual(new Date('2026-06-02T03:00:00Z'));
  });

  test('a pin change resets since to the start of the newest run', () => {
    const r = pinnedSince([
      p('2026-06-02T03:00:00Z', 'AAA'),
      p('2026-06-03T03:00:00Z', 'AAA'),
      p('2026-06-05T03:00:00Z', 'BBB'), // re-pinned
      p('2026-06-06T03:00:00Z', 'BBB'),
    ]);
    expect(r.pinnedTweetId).toBe('BBB');
    expect(r.since).toEqual(new Date('2026-06-05T03:00:00Z'));
  });

  test('unordered input is sorted before the walk', () => {
    const r = pinnedSince([
      p('2026-06-06T03:00:00Z', 'BBB'),
      p('2026-06-02T03:00:00Z', 'AAA'),
      p('2026-06-05T03:00:00Z', 'BBB'),
    ]);
    expect(r.pinnedTweetId).toBe('BBB');
    expect(r.since).toEqual(new Date('2026-06-05T03:00:00Z'));
  });
});

describe('brief buildPinnedWatch (S0.9)', () => {
  const now = new Date('2026-07-11T12:00:00Z');
  const post = (id: string, views: number | null, daysAgo = 3): PinnedWatchPost => ({
    tweetId: id,
    text: `post ${id}`,
    postedAt: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000),
    views,
  });

  test('no pin recorded → all quiet', () => {
    const w = buildPinnedWatch({ pinnedTweetId: null, since: null }, null, [], now);
    expect(w).toEqual({
      pinnedTweetId: null,
      since: null,
      ageDays: null,
      stale: false,
      pinnedViews: null,
      outperformer: null,
    });
  });

  test('(a) pin unchanged >21d is stale; exactly 21d is not', () => {
    const day = 24 * 60 * 60 * 1000;
    const stale = buildPinnedWatch(
      { pinnedTweetId: 'AAA', since: new Date(now.getTime() - 22 * day) },
      100,
      [],
      now,
    );
    expect(stale.ageDays).toBe(22);
    expect(stale.stale).toBe(true);

    const fresh = buildPinnedWatch(
      { pinnedTweetId: 'AAA', since: new Date(now.getTime() - 21 * day) },
      100,
      [],
      now,
    );
    expect(fresh.ageDays).toBe(21);
    expect(fresh.stale).toBe(false);
  });

  test('(b) surfaces the top ≥3× post, ignoring the pin itself and sub-3× posts', () => {
    const pin = { pinnedTweetId: 'AAA', since: new Date(now.getTime() - 5 * 86_400_000) };
    const w = buildPinnedWatch(
      pin,
      100,
      [
        post('AAA', 9999), // the pin itself, excluded
        post('BBB', 250), // 2.5× — below the ratio
        post('CCC', 300), // exactly 3×
        post('DDD', 500), // 5× — the winner
        post('EEE', null), // unmeasured, ignored
      ],
      now,
    );
    expect(w.outperformer?.tweetId).toBe('DDD');
    expect(w.outperformer?.views).toBe(500);
    expect(w.outperformer?.ratio).toBe(5);
  });

  test('(b) no outperformer when pinned views are null or zero', () => {
    const pin = { pinnedTweetId: 'AAA', since: new Date(now.getTime() - 5 * 86_400_000) };
    expect(buildPinnedWatch(pin, null, [post('DDD', 500)], now).outperformer).toBeNull();
    expect(buildPinnedWatch(pin, 0, [post('DDD', 500)], now).outperformer).toBeNull();
  });
});

describe('brief attachLatestSnapshots', () => {
  const post = (tweetId: string, isReply = false) => ({
    tweetId,
    text: `t-${tweetId}`,
    postedAt: new Date('2026-06-09T10:00:00Z'),
    isReply,
  });

  test('takes the first (newest) snapshot per tweet and maps metric names', () => {
    const out = attachLatestSnapshots(
      [post('1'), post('2', true)],
      [
        {
          tweetId: '1',
          snapshotAt: new Date('2026-06-10T03:00:00Z'),
          publicMetrics: { impression_count: 900, like_count: 12, reply_count: 3 },
          nonPublicMetrics: { user_profile_clicks: 7 },
        },
        {
          tweetId: '1',
          snapshotAt: new Date('2026-06-09T03:00:00Z'),
          publicMetrics: { impression_count: 100, like_count: 1, reply_count: 0 },
          nonPublicMetrics: null,
        },
      ],
    );
    expect(out[0]?.metrics?.views).toBe(900);
    expect(out[0]?.metrics?.likes).toBe(12);
    expect(out[0]?.metrics?.profileVisits).toBe(7);
    expect(out[0]?.measuredAt?.toISOString()).toBe('2026-06-10T03:00:00.000Z');
    // Tweet 2 has no snapshot yet — metrics stay null, not zero.
    expect(out[1]?.metrics).toBeNull();
    expect(out[1]?.measuredAt).toBeNull();
  });
});

describe('voice targetBand', () => {
  test('is 2x to 10x of my follower count', () => {
    expect(targetBand(150)).toEqual({ min: 300, max: 1500 });
    expect(targetBand(0)).toEqual({ min: 0, max: 0 });
  });
});

describe('voice authorMomentum', () => {
  const pt = (iso: string, followers: number): FollowerSnapshotPoint => ({
    capturedAt: new Date(iso),
    followersCount: followers,
  });

  test('fewer than two points has no momentum', () => {
    expect(authorMomentum([])).toBeNull();
    expect(authorMomentum([pt('2026-06-01T00:00:00Z', 500)])).toBeNull();
  });

  test('computes followers/day between oldest and newest, regardless of input order', () => {
    const m = authorMomentum([
      pt('2026-06-09T00:00:00Z', 560),
      pt('2026-06-01T00:00:00Z', 500),
      pt('2026-06-05T00:00:00Z', 900), // interior points don't affect the slope
    ]);
    expect(m).toEqual({ delta: 60, days: 8, perDay: 7.5 });
  });

  test('clamps the span to one day so back-to-back enriches do not explode', () => {
    const m = authorMomentum([pt('2026-06-10T10:00:00Z', 500), pt('2026-06-10T10:05:00Z', 510)]);
    expect(m?.perDay).toBe(10);
  });

  test('shrinking accounts get negative momentum', () => {
    const m = authorMomentum([pt('2026-06-01T00:00:00Z', 1000), pt('2026-06-03T00:00:00Z', 950)]);
    expect(m).toEqual({ delta: -50, days: 2, perDay: -25 });
  });
});

describe('voice rankTargets', () => {
  const t = (handle: string, followersCount: number, perDay: number | null) => ({
    handle,
    followersCount,
    momentum: perDay === null ? null : { delta: 0, days: 1, perDay },
  });

  test('momentum desc, unknown momentum last ordered by size asc', () => {
    const ranked = rankTargets([
      t('big-unknown', 9000, null),
      t('slow', 4000, 2),
      t('small-unknown', 600, null),
      t('fast', 8000, 40),
    ]);
    expect(ranked.map((x) => x.handle)).toEqual(['fast', 'slow', 'small-unknown', 'big-unknown']);
  });

  test('equal momentum breaks ties by follower count asc', () => {
    const ranked = rankTargets([t('bigger', 5000, 3), t('smaller', 700, 3)]);
    expect(ranked.map((x) => x.handle)).toEqual(['smaller', 'bigger']);
  });
});

// ---------------------------------------------------------------- Phase 8/9

describe('post prompt (§8.1)', () => {
  test('embedded template stays in sync with post prompt.md', async () => {
    const md = await Bun.file(new URL('../post prompt.md', import.meta.url)).text();
    expect(POST_PROMPT_TEMPLATE.trimEnd()).toBe(md.trimEnd());
  });

  test('variable content sits at the very end (cacheable prefix)', () => {
    const winnersAt = POST_PROMPT_TEMPLATE.indexOf('{{MY_WINNERS}}');
    expect(winnersAt).toBeGreaterThan(POST_PROMPT_TEMPLATE.length * 0.8);
    expect(POST_PROMPT_TEMPLATE.trimEnd().endsWith('<idea>{{IDEA}}</idea>')).toBe(true);
  });

  // N0.3 equivalence guarantee: with the untouched seed niche (all defaults),
  // the assembled prompt must carry the ORIGINAL §1 and §5 bodies byte-exact,
  // in place. Fixtures are independent copies of the pre-extraction text —
  // deliberately NOT read from the .md (which now holds the placeholder) nor
  // from DEFAULT_NICHE (which is what's under test).
  const ORIGINAL_SECTION_1_BODY = `- 51 years old. Live in **Pitești, Romania.**
- Day job: **IT administrator at a public hospital**, 08:00–15:00, Mon–Fri. Personal projects run after 15:00 and on weekends. ~2–4h/day.
- Trained as an **economist** (ASE București, Faculty of Management). Spent **10 years as head of the hospital's accounting office** before IT.
- **30 years of coding** — a serious hobby since the 386 era. Arc: 386 → Turbo Pascal → FoxPro → Delphi 3 → today, AI coding agents (Claude Code). Four years ago a simple CRUD took me days; now I ship quality code fast.
- Building **Alteramens** — a lab turning ideas into products. Goal: solopreneur income, **5K MRR**, then leave the hospital job. Working in a **ship-or-die** cadence (one project to publish every 30 days).
- **My wife is an independent accountant** with ~20 SMB clients. I help her with the books → I see real business problems daily, from both sides.
- **My son David** is prepping for the UMF (med-school) admission exam.
- I'm Romanian. **I think in Romanian and publish in English.** My English is plain and direct, not flowery — that's a feature, not a gap.

My unfair angle: economist **+** 30-year dev **+** 51 in a junior-dominated AI space **+** access to two laboratories nobody on SF Twitter sees (a Romanian public hospital and ~20 SMB accounting clients). I don't claim to be an "AI expert." I'm a practitioner who writes code and ships.

These facts are the ONLY biography you may use. Never invent or imply anything else — no client stories I didn't give you, no made-up shipping timelines, no fabricated numbers. If the steer gives a fact, use it; otherwise stay inside this list. A fabricated "37%" or a fake anecdote is worse than no specific at all.`;

  const ORIGINAL_SECTION_5_BODY = `Content should **encode judgment, not just transmit information.** Start from a principle I actually believe (often Naval-derived — productize yourself, specific knowledge, leverage, compounding games, authenticity removes competition), anchor it in the **present AI moment**, and land it on something concrete I've lived.

Active stances you can voice as mine:
- **Authentic human voice > sterilized AI fluency.** Identifiability is the asset.
- **Shipping > perfection.** Weekly publishing beats finished drafts.
- **Encoded judgment > mechanical functionality.** Skills/tools with opinions, not just APIs.
- **Pragmatic > elegant.** What works beats what's refined.
- **Bias for action.** Small iterations, tangible results, better done than perfect.
- **In the AI era, sustained focus + simplification are the highest-leverage skills.**
- **Marketing is now harder than writing code.** AI compressed execution; distribution is the real bottleneck.
- **Organic growth, no shortcuts** — zero bots, auto-reply, or engagement pods.

A background tension I own honestly: I scatter across too many projects out of enthusiasm, and I **procrastinate on publishing** — the bottleneck is hitting *publish*, not producing. Confession and real stakes are fair game. Founder-porn is not.`;

  test('N0.3 equivalence: seed niche restores the original §1/§5 bodies byte-exact', () => {
    // DEFAULT_NICHE itself must not have drifted from the original prose.
    expect(DEFAULT_NICHE.persona).toBe(ORIGINAL_SECTION_1_BODY);
    expect(DEFAULT_NICHE.beliefs).toBe(ORIGINAL_SECTION_5_BODY);

    const [msg] = buildPostDraftInput({ winners: [] });
    const content = msg?.content ?? '';
    expect(content).toContain(
      `## 1. Who I am (grounding — use these for specificity, NEVER invent biography)\n\n${ORIGINAL_SECTION_1_BODY}\n\n---`,
    );
    expect(content).toContain(
      `## 5. What I believe (take these positions — don't fence-sit, don't contradict them)\n\n${ORIGINAL_SECTION_5_BODY}\n\n---`,
    );
    expect(content).not.toContain('{{PERSONA}}');
    expect(content).not.toContain('{{BELIEFS}}');
  });

  test('N0.3: custom persona/beliefs substitute in place of the builder identity', () => {
    const [msg] = buildPostDraftInput({
      winners: [],
      persona: 'NUTRITION PERSONA BLOCK',
      beliefs: 'NUTRITION BELIEFS BLOCK',
    });
    const content = msg?.content ?? '';
    expect(content).toContain('NUTRITION PERSONA BLOCK');
    expect(content).toContain('NUTRITION BELIEFS BLOCK');
    // §1/§5-only markers (Pitești/386 still appear in §6's palette — not these).
    expect(content).not.toContain('Alteramens');
    expect(content).not.toContain('Naval-derived');
    expect(content).not.toContain('{{PERSONA}}');
    expect(content).not.toContain('{{BELIEFS}}');
  });

  test('buildPostDraftInput substitutes every placeholder, incl. pillars', () => {
    const [msg] = buildPostDraftInput({
      winners: [{ text: 'won post', views: 412, profileVisits: 9 }],
      remix: {
        hookType: 'contrast hook',
        skeleton: 'hook -> list of 3 -> question close',
        lineBreakPattern: 'list with blank lines',
        templateLength: 'medium',
        device: 'numbered list',
        rawText: null,
      },
      pillar: 'builder-51',
      idea: 'ceva despre spitale',
      pillars: [{ slug: 'edge-cases', label: 'Edge cases — the GAP', body: 'body of edge-cases' }],
    });
    const content = msg?.content ?? '';
    expect(content).not.toContain('{{MY_WINNERS}}');
    expect(content).not.toContain('{{REMIX}}');
    expect(content).not.toContain('{{PILLAR}}');
    expect(content).not.toContain('{{IDEA}}');
    expect(content).not.toContain('{{PILLARS}}');
    expect(content).toContain('won post');
    expect(content).toContain('412 views · 9 profile clicks');
    expect(content).toContain('hook -> list of 3 -> question close');
    expect(content).toContain('<pillar>builder-51</pillar>');
    expect(content).toContain('<idea>ceva despre spitale</idea>');
    // The injected pillar (not a default) appears in the PILLARS block.
    expect(content).toContain('**edge-cases** — Edge cases — the GAP');
    expect(content).toContain('body of edge-cases');
  });

  test('buildPostDraftInput falls back to the seed pillars when none passed', () => {
    const [msg] = buildPostDraftInput({ winners: [] });
    const content = msg?.content ?? '';
    for (const p of DEFAULT_PILLARS) expect(content).toContain(`**${p.slug}** — ${p.label}`);
  });

  test('no winners renders the empty marker, $ in idea is safe', () => {
    const [msg] = buildPostDraftInput({ winners: [], idea: 'price it at $99 $& $`' });
    const content = msg?.content ?? '';
    expect(content).toContain('(no measured winners yet)');
    expect(content).toContain('price it at $99 $& $`');
  });

  test('un-extracted remix falls back to deriving from raw text', () => {
    const [msg] = buildPostDraftInput({
      winners: [],
      remix: {
        hookType: null,
        skeleton: null,
        lineBreakPattern: null,
        templateLength: null,
        device: null,
        rawText: 'the swiped tweet body',
      },
    });
    expect(msg?.content).toContain('derive it yourself');
    expect(msg?.content).toContain('the swiped tweet body');
  });

  test('parsePostDrafts accepts the schema shape and rejects junk', () => {
    const ok = parsePostDrafts(
      JSON.stringify({
        posts: [
          { text: 'a', register: 'plain', pillar: 'ai-craft' },
          { text: 'b', register: 'spicy', pillar: 'unsexy-problems' },
          { text: 'c', register: 'reflective', pillar: 'builder-51' },
        ],
      }),
    );
    expect(ok).toHaveLength(3);
    expect(ok?.[1]?.register).toBe('spicy');
    expect(parsePostDrafts('not json')).toBeNull();
    expect(parsePostDrafts('{"posts":[]}')).toBeNull();
    expect(parsePostDrafts('{"posts":[{"text":""}]}')).toBeNull();
    // Unknown register/pillar degrade to defaults rather than dropping the draft.
    const degraded = parsePostDrafts(
      JSON.stringify({ posts: [{ text: 'x', register: 'weird', pillar: 'nope' }] }),
    );
    expect(degraded?.[0]).toEqual({ text: 'x', register: 'plain', pillar: 'ai-craft' });
  });

  test('parsePillar maps 1/2/3 and slugs, rejects junk', () => {
    expect(parsePillar(1)).toBe('ai-craft');
    expect(parsePillar(2)).toBe('builder-51');
    expect(parsePillar(3)).toBe('unsexy-problems');
    expect(parsePillar('builder-51')).toBe('builder-51');
    expect(parsePillar(undefined)).toBeUndefined();
    expect(parsePillar(0)).toBe('invalid');
    expect(parsePillar('growth')).toBe('invalid');
  });
});

describe('thread prompt (AI.7)', () => {
  test('embedded template stays in sync with thread prompt.md', async () => {
    const md = await Bun.file(new URL('../thread prompt.md', import.meta.url)).text();
    expect(THREAD_PROMPT_TEMPLATE.trimEnd()).toBe(md.trimEnd());
  });

  test('variable content sits at the very end (cacheable prefix)', () => {
    const fewShotAt = THREAD_PROMPT_TEMPLATE.indexOf('{{FEW_SHOT}}');
    expect(fewShotAt).toBeGreaterThan(THREAD_PROMPT_TEMPLATE.length * 0.8);
    expect(THREAD_PROMPT_TEMPLATE.trimEnd().endsWith('<idea>{{IDEA}}</idea>')).toBe(true);
    // §1/§5 persona family substitutes in place, not at the tail.
    expect(THREAD_PROMPT_TEMPLATE.indexOf('{{PERSONA}}')).toBeLessThan(
      THREAD_PROMPT_TEMPLATE.length * 0.5,
    );
  });

  const SLUGS = ['ai-craft', 'builder-51', 'unsexy-problems'];

  test('parseThreadDraft returns pillar + ordered tweets, trims, flags no over-longs', () => {
    const raw = JSON.stringify({ pillar: 'ai-craft', tweets: ['  one  ', 'two', 'three'] });
    const out = parseThreadDraft(raw, SLUGS);
    expect(out).toEqual({ pillar: 'ai-craft', tweets: ['one', 'two', 'three'], overLong: [] });
  });

  test('parseThreadDraft detects 280-char over-longs (1-based positions)', () => {
    const long = 'x'.repeat(281);
    const out = parseThreadDraft(
      JSON.stringify({ pillar: 'builder-51', tweets: ['ok', long, 'ok'] }),
      SLUGS,
    );
    expect(out?.overLong).toEqual([2]);
  });

  test('parseThreadDraft rejects a pillar outside the allowed set', () => {
    expect(parseThreadDraft(JSON.stringify({ pillar: 'growth', tweets: ['a', 'b'] }), SLUGS)).toBe(
      null,
    );
  });

  test('parseThreadDraft rejects non-thread / malformed shapes', () => {
    expect(parseThreadDraft('not json', SLUGS)).toBe(null);
    expect(
      parseThreadDraft(JSON.stringify({ pillar: 'ai-craft', tweets: ['only one'] }), SLUGS),
    ).toBe(null);
    expect(parseThreadDraft(JSON.stringify({ pillar: 'ai-craft', tweets: ['a', ''] }), SLUGS)).toBe(
      null,
    );
    expect(parseThreadDraft(JSON.stringify({ pillar: 'ai-craft', tweets: 'nope' }), SLUGS)).toBe(
      null,
    );
  });

  test('buildThreadDraftInput folds pillar + count into the steer, keeps persona in place', () => {
    const [msg] = buildThreadDraftInput({
      winners: [],
      pillar: 'ai-craft',
      tweetCount: 5,
      idea: 'de ce AI',
    });
    expect(msg?.content).toContain('Serve the "ai-craft" content pillar.');
    expect(msg?.content).toContain('Write exactly 5 tweets.');
    expect(msg?.content).toContain('de ce AI');
    // Persona/beliefs substituted (no leftover tokens), few-shot placeholder gone.
    expect(msg?.content).not.toContain('{{PERSONA}}');
    expect(msg?.content).not.toContain('{{BELIEFS}}');
    expect(msg?.content).not.toContain('{{FEW_SHOT}}');
    expect(msg?.content).toContain('(no measured winners yet)');
  });

  test('buildThreadDraftInput appends meContext + guidance at the tail only', () => {
    const base = buildThreadDraftInput({ winners: [] })[0]?.content ?? '';
    const withTail = buildThreadDraftInput({
      winners: [],
      meContext: 'ME BLOCK',
      guidance: 'GUIDANCE LINE',
    })[0]?.content;
    expect(withTail).toBe(`${base}\n\nME BLOCK\n\nGUIDANCE LINE`);
  });
});

describe('rewrite prompt (AI.8)', () => {
  test('variable content ({{DRAFT}}/{{INSTRUCTION}}) sits at the very end', () => {
    const draftAt = REWRITE_PROMPT_TEMPLATE.indexOf('{{DRAFT}}');
    expect(draftAt).toBeGreaterThan(REWRITE_PROMPT_TEMPLATE.length * 0.7);
    expect(REWRITE_PROMPT_TEMPLATE.trimEnd().endsWith('{{INSTRUCTION}}')).toBe(true);
  });

  test('parseRewrite returns trimmed variants of the three known kinds', () => {
    const raw = JSON.stringify({
      variants: [
        { text: '  tight one  ', kind: 'tightened' },
        { text: 'hook two', kind: 'rehooked' },
        { text: 'shape three', kind: 'restructured' },
      ],
    });
    expect(parseRewrite(raw)).toEqual([
      { text: 'tight one', kind: 'tightened' },
      { text: 'hook two', kind: 'rehooked' },
      { text: 'shape three', kind: 'restructured' },
    ]);
  });

  test('parseRewrite drops over-long and empty variants, keeps the survivors', () => {
    const long = 'x'.repeat(561);
    const raw = JSON.stringify({
      variants: [
        { text: long, kind: 'tightened' },
        { text: '   ', kind: 'rehooked' },
        { text: 'keeper', kind: 'restructured' },
      ],
    });
    expect(parseRewrite(raw)).toEqual([{ text: 'keeper', kind: 'restructured' }]);
    // The 560-char boundary is inclusive.
    const edge = JSON.stringify({ variants: [{ text: 'y'.repeat(560), kind: 'tightened' }] });
    expect(parseRewrite(edge)).toHaveLength(1);
  });

  test('parseRewrite skips unknown kinds and non-object entries, never the whole call', () => {
    const raw = JSON.stringify({
      variants: [
        { text: 'ok', kind: 'punchier' },
        'not an object',
        { text: 'good', kind: 'tightened' },
      ],
    });
    expect(parseRewrite(raw)).toEqual([{ text: 'good', kind: 'tightened' }]);
  });

  test('parseRewrite returns null on malformed shape, [] on an empty variants array', () => {
    expect(parseRewrite('not json')).toBe(null);
    expect(parseRewrite(JSON.stringify({ variants: 'nope' }))).toBe(null);
    expect(parseRewrite(JSON.stringify({ nope: [] }))).toBe(null);
    expect(parseRewrite(JSON.stringify({ variants: [] }))).toEqual([]);
  });

  test('buildRewriteInput substitutes the draft + instruction at the tail', () => {
    const [msg] = buildRewriteInput({ draft: 'my $5 draft', instruction: 'fă-l mai tăios' });
    expect(msg?.content).toContain('my $5 draft');
    expect(msg?.content).toContain('fă-l mai tăios');
    expect(msg?.content).not.toContain('{{DRAFT}}');
    expect(msg?.content).not.toContain('{{INSTRUCTION}}');
  });

  test('buildRewriteInput fills a placeholder when no instruction is given', () => {
    const [msg] = buildRewriteInput({ draft: 'a draft' });
    expect(msg?.content).not.toContain('{{INSTRUCTION}}');
    expect(msg?.content).toContain('(none — just sharpen it)');
  });
});

describe('ideas prompt (AI.9)', () => {
  const SLUGS = ['ai-craft', 'builder-51', 'unsexy-problems'];

  test('variable content ({{PILLARS}}/{{WINNERS}}/{{STEER}}) sits at the very end', () => {
    const pillarsAt = IDEAS_PROMPT_TEMPLATE.indexOf('{{PILLARS}}');
    expect(pillarsAt).toBeGreaterThan(IDEAS_PROMPT_TEMPLATE.length * 0.5);
    expect(IDEAS_PROMPT_TEMPLATE.trimEnd().endsWith('{{STEER}}')).toBe(true);
  });

  test('parseIdeaProposals returns trimmed proposals of the known angles', () => {
    const raw = JSON.stringify({
      ideas: [
        { text: '  an observation about agents  ', pillar: 'ai-craft', angle: 'observation' },
        { text: 'a hot take', pillar: 'unsexy-problems', angle: 'stance' },
      ],
    });
    expect(parseIdeaProposals(raw, SLUGS)).toEqual([
      { text: 'an observation about agents', pillar: 'ai-craft', angle: 'observation' },
      { text: 'a hot take', pillar: 'unsexy-problems', angle: 'stance' },
    ]);
  });

  test('parseIdeaProposals NULLS a pillar outside the active set, never drops the idea', () => {
    const raw = JSON.stringify({
      ideas: [{ text: 'still a good idea', pillar: 'not-a-real-pillar', angle: 'story' }],
    });
    expect(parseIdeaProposals(raw, SLUGS)).toEqual([
      { text: 'still a good idea', pillar: null, angle: 'story' },
    ]);
  });

  test('parseIdeaProposals drops empty/over-long text and unknown angles, keeps survivors', () => {
    const long = 'x'.repeat(501);
    const raw = JSON.stringify({
      ideas: [
        { text: long, pillar: 'ai-craft', angle: 'observation' },
        { text: '   ', pillar: 'ai-craft', angle: 'stance' },
        { text: 'bad angle', pillar: 'ai-craft', angle: 'rant' },
        'not an object',
        { text: 'keeper', pillar: 'builder-51', angle: 'question' },
      ],
    });
    expect(parseIdeaProposals(raw, SLUGS)).toEqual([
      { text: 'keeper', pillar: 'builder-51', angle: 'question' },
    ]);
  });

  test('parseIdeaProposals clamps to maxCount and null/[]-guards malformed shapes', () => {
    const ideasArr = Array.from({ length: 6 }, (_, i) => ({
      text: `idea ${i}`,
      pillar: 'ai-craft',
      angle: 'observation',
    }));
    expect(parseIdeaProposals(JSON.stringify({ ideas: ideasArr }), SLUGS, 3)).toHaveLength(3);
    expect(parseIdeaProposals('not json', SLUGS)).toBe(null);
    expect(parseIdeaProposals(JSON.stringify({ ideas: 'nope' }), SLUGS)).toBe(null);
    expect(parseIdeaProposals(JSON.stringify({ nope: [] }), SLUGS)).toBe(null);
    expect(parseIdeaProposals(JSON.stringify({ ideas: [] }), SLUGS)).toEqual([]);
  });

  test('buildIdeasInput renders pillars/winners/steer at the tail, $-safe', () => {
    const [msg] = buildIdeasInput({
      pillars: [{ slug: 'ai-craft', label: 'AI craft', body: 'lab journal' }],
      winners: [{ text: 'my $5 winner', views: 4200, profileVisits: 30 }],
      steer: 'despre agenți',
      count: 5,
    });
    expect(msg?.content).toContain('ai-craft');
    expect(msg?.content).toContain('my $5 winner');
    expect(msg?.content).toContain('4200 views');
    expect(msg?.content).toContain('despre agenți');
    expect(msg?.content).toContain('Return exactly 5 ideas.');
    expect(msg?.content).not.toContain('{{PILLARS}}');
    expect(msg?.content).not.toContain('{{WINNERS}}');
    expect(msg?.content).not.toContain('{{STEER}}');
  });

  test('buildIdeasInput fills placeholders when winners + steer are empty', () => {
    const [msg] = buildIdeasInput({ winners: [] });
    expect(msg?.content).toContain('(no measured winners yet)');
    expect(msg?.content).toContain('(none — spread the ideas across the pillars)');
  });
});

describe('content pillars (§8.6)', () => {
  const SLUGS = ['growth', 'edge-cases', 'tooling'];

  test('parsePillar honors a dynamic slug list (slug + 1/2/3 index)', () => {
    expect(parsePillar('edge-cases', SLUGS)).toBe('edge-cases');
    expect(parsePillar(1, SLUGS)).toBe('growth');
    expect(parsePillar(3, SLUGS)).toBe('tooling');
    expect(parsePillar(4, SLUGS)).toBe('invalid');
    // A default slug is not valid against a different live set.
    expect(parsePillar('ai-craft', SLUGS)).toBe('invalid');
    expect(parsePillar(undefined, SLUGS)).toBeUndefined();
  });

  test('parsePostDrafts validates pillar against the allowed slugs, falls back to first', () => {
    const out = parsePostDrafts(
      JSON.stringify({ posts: [{ text: 'x', register: 'spicy', pillar: 'nope' }] }),
      SLUGS,
    );
    expect(out?.[0]).toEqual({ text: 'x', register: 'spicy', pillar: 'growth' });
    const ok = parsePostDrafts(
      JSON.stringify({ posts: [{ text: 'y', register: 'plain', pillar: 'tooling' }] }),
      SLUGS,
    );
    expect(ok?.[0]?.pillar).toBe('tooling');
  });

  test('buildPostDraftsSchema reflects the live slug set in the enum', () => {
    const schema = buildPostDraftsSchema(SLUGS);
    expect(schema.properties.posts.items.properties.pillar.enum).toEqual(SLUGS);
    // Default schema (no args) keeps the seed slugs.
    expect(buildPostDraftsSchema().properties.posts.items.properties.pillar.enum).toEqual(
      DEFAULT_PILLARS.map((p) => p.slug),
    );
  });

  test('renderPillars formats the block, empty set is marked', () => {
    const pillars: PillarDef[] = [
      { slug: 'tooling', label: 'Tooling — the HOW', body: 'guidance' },
    ];
    expect(renderPillars(pillars)).toBe('**tooling** — Tooling — the HOW\nguidance');
    expect(renderPillars([])).toContain('no pillars configured');
  });

  test('isValidPillarSlug enforces kebab-case', () => {
    expect(isValidPillarSlug('ai-craft')).toBe(true);
    expect(isValidPillarSlug('a1')).toBe(true);
    expect(isValidPillarSlug('A')).toBe(false);
    expect(isValidPillarSlug('x')).toBe(false); // too short (min 2)
    expect(isValidPillarSlug('-lead')).toBe(false);
    expect(isValidPillarSlug('has space')).toBe(false);
    expect(isValidPillarSlug(42)).toBe(false);
  });

  test('parsePillarProposal coerces near-miss slugs, forces the tweak slug, rejects empties', () => {
    expect(
      parsePillarProposal(JSON.stringify({ slug: 'Edge Cases', label: 'L', body: 'B' })),
    ).toEqual({ slug: 'edge-cases', label: 'L', body: 'B' });
    // forceSlug (tweak) wins over whatever the model returned.
    expect(
      parsePillarProposal(JSON.stringify({ slug: 'renamed', label: 'L', body: 'B' }), 'ai-craft'),
    ).toEqual({ slug: 'ai-craft', label: 'L', body: 'B' });
    expect(parsePillarProposal('not json')).toBeNull();
    expect(
      parsePillarProposal(JSON.stringify({ slug: 'ok-slug', label: '', body: 'B' })),
    ).toBeNull();
  });

  test('buildPillarDraftInput grounds new vs tweak distinctly', () => {
    const newMsg = buildPillarDraftInput({
      mode: 'new',
      existing: DEFAULT_PILLARS,
      idea: 'despre AI',
    });
    expect(newMsg[0]?.content).toContain('Propose ONE new content pillar');
    expect(newMsg[0]?.content).toContain('despre AI');
    expect(newMsg[0]?.content).toContain('**ai-craft**'); // existing pillars grounded in

    const target: PillarDef = { slug: 'ai-craft', label: 'AI', body: 'old body' };
    const tweakMsg = buildPillarDraftInput({
      mode: 'tweak',
      existing: DEFAULT_PILLARS,
      target,
      instruction: 'make it spicier',
    });
    expect(tweakMsg[0]?.content).toContain('Revise this existing content pillar');
    expect(tweakMsg[0]?.content).toContain('Keep its slug exactly as "ai-craft"');
    expect(tweakMsg[0]?.content).toContain('make it spicier');
  });

  test('buildPillarDraftInput grounds on the niche persona (N0.3)', () => {
    // Default: the builder niche persona (no hardcoded biography left here).
    const defaulted = buildPillarDraftInput({ mode: 'new', existing: DEFAULT_PILLARS });
    expect(defaulted[0]?.content).toContain('Alteramens');

    const custom = buildPillarDraftInput({
      mode: 'new',
      existing: DEFAULT_PILLARS,
      persona: 'NUTRITION COACH PERSONA',
    });
    expect(custom[0]?.content).toContain('NUTRITION COACH PERSONA');
    expect(custom[0]?.content).not.toContain('Alteramens');
    expect(custom[0]?.content).not.toContain('Pitești');
  });

  test('AI.5: a pillar-draft template override changes the prompt; jobs stay code-built', () => {
    const msg = buildPillarDraftInput({
      mode: 'new',
      existing: [],
      template: 'MY TEMPLATE | {{PERSONA}} | {{EXISTING_PILLARS}} | {{JOB}}',
      persona: 'P',
      idea: 'steer',
    });
    const content = msg[0]?.content ?? '';
    expect(content.startsWith('MY TEMPLATE | P | (none yet) | ')).toBe(true);
    expect(content).toContain('Propose ONE new content pillar');
    expect(content).toContain('steer');
    expect(content).not.toContain('{{JOB}}');
  });
});

describe('createPost gates (§9.2/§8.5)', () => {
  test('quote without verifiedSelfQuote throws before any network call', async () => {
    await expect(
      createPost('tok', { text: 'take', quote_tweet_id: '123' }, { selfXUserId: '1' }),
    ).rejects.toThrow(/verified self-quote/);
  });

  test('reply with a known non-self parent author throws', async () => {
    await expect(
      createPost(
        'tok',
        { text: 'hi', reply: { in_reply_to_tweet_id: '5' } },
        { selfXUserId: '1', parentAuthorId: '2' },
      ),
    ).rejects.toThrow(/non-self tweet/);
  });

  test('reply without selfXUserId still throws (pre-existing gate)', async () => {
    await expect(
      createPost('tok', { text: 'hi', reply: { in_reply_to_tweet_id: '5' } }),
    ).rejects.toThrow(/selfXUserId/);
  });
});

describe('buildBestTimes (§8.4)', () => {
  test('groups by UTC weekday+hour and normalizes by age', () => {
    // 2026-06-08 is a Monday (UTC weekday 1).
    const cells = buildBestTimes([
      {
        postedAt: new Date('2026-06-08T09:10:00Z'),
        views: 1440,
        likes: 10,
        profileVisits: 2,
        ageAtSnapshotMin: 1440,
      },
      {
        postedAt: new Date('2026-06-08T09:40:00Z'),
        views: 720,
        likes: 4,
        profileVisits: null,
        ageAtSnapshotMin: 720,
      },
      {
        postedAt: new Date('2026-06-09T18:00:00Z'),
        views: 100,
        likes: 1,
        profileVisits: 0,
        ageAtSnapshotMin: null,
      },
    ]);
    expect(cells).toHaveLength(2);
    const mon9 = cells.find((c) => c.weekday === 1 && c.hour === 9);
    expect(mon9?.posts).toBe(2);
    expect(mon9?.avgViews).toBe(1080);
    // 1440 views over 1440 min = 1440/day; 720 over 720 min = 1440/day.
    expect(mon9?.avgViewsPerDay).toBe(1440);
    expect(mon9?.avgProfileVisits).toBe(2);
    const tue18 = cells.find((c) => c.weekday === 2 && c.hour === 18);
    expect(tue18?.avgViewsPerDay).toBeNull();
    expect(tue18?.avgViews).toBe(100);
  });

  test('empty input → no cells', () => {
    expect(buildBestTimes([])).toEqual([]);
  });

  test('tzOffsetMin buckets by the local wall clock (S0.4)', () => {
    // 2026-06-08 23:30Z is Monday (UTC weekday 1); at UTC+3 (tzOffsetMin -180)
    // it's Tuesday 02:30 local → weekday 2, hour 2.
    const [cell] = buildBestTimes(
      [
        {
          postedAt: new Date('2026-06-08T23:30:00Z'),
          views: 100,
          likes: 1,
          profileVisits: 1,
          ageAtSnapshotMin: 1440,
        },
      ],
      -180,
    );
    expect(cell?.weekday).toBe(2);
    expect(cell?.hour).toBe(2);
  });
});

describe('best-times advice gate (S0.4)', () => {
  const cell = (
    over: Partial<BestTimeCell> & Pick<BestTimeCell, 'weekday' | 'hour' | 'posts'>,
  ) => ({
    avgViews: null,
    avgViewsPerDay: null,
    avgLikes: null,
    avgProfileVisits: null,
    ...over,
  });

  test('bestTimeScore prefers per-day rate, gates at n≥3', () => {
    expect(BEST_TIME_MIN_N).toBe(3);
    expect(
      bestTimeScore(cell({ weekday: 1, hour: 9, posts: 3, avgViewsPerDay: 500, avgViews: 100 })),
    ).toBe(500);
    // no per-day rate → raw avg views
    expect(bestTimeScore(cell({ weekday: 1, hour: 9, posts: 3, avgViews: 100 }))).toBe(100);
    // below the gate → null even with data
    expect(bestTimeScore(cell({ weekday: 1, hour: 9, posts: 2, avgViewsPerDay: 999 }))).toBeNull();
    // no data at all → null
    expect(bestTimeScore(cell({ weekday: 1, hour: 9, posts: 5 }))).toBeNull();
    expect(bestTimeScore(undefined)).toBeNull();
  });

  test('rankBestTimes drops sub-gate cells and sorts by score desc', () => {
    const ranked = rankBestTimes([
      cell({ weekday: 1, hour: 9, posts: 5, avgViewsPerDay: 500 }),
      cell({ weekday: 1, hour: 13, posts: 2, avgViewsPerDay: 9999 }), // below gate — excluded
      cell({ weekday: 2, hour: 18, posts: 4, avgViewsPerDay: 800 }),
    ]);
    expect(ranked.map((c) => `${c.weekday}:${c.hour}`)).toEqual(['2:18', '1:9']);
    expect(ranked.every((c) => c.posts >= BEST_TIME_MIN_N)).toBe(true);
  });

  test('bestTimeCellFor matches on weekday+hour', () => {
    const cells = [cell({ weekday: 3, hour: 17, posts: 6, avgViewsPerDay: 2100 })];
    expect(bestTimeCellFor(cells, 3, 17)?.posts).toBe(6);
    expect(bestTimeCellFor(cells, 3, 18)).toBeUndefined();
    expect(bestTimeCellFor(cells, 4, 17)).toBeUndefined();
  });
});

describe('aggregatePillars (§8.4)', () => {
  test('aggregates per pillar with unassigned bucket, sorted by views', () => {
    const out = aggregatePillars([
      { pillar: 'ai-craft', isReply: false, views: 100, likes: 5, profileVisits: 3 },
      { pillar: 'ai-craft', isReply: false, views: 300, likes: 10, profileVisits: 1 },
      { pillar: 'ai-craft', isReply: true, views: null, likes: null, profileVisits: null },
      { pillar: null, isReply: false, views: 50, likes: 1, profileVisits: null },
    ]);
    expect(out[0]?.pillar).toBe('ai-craft');
    expect(out[0]?.posts).toBe(2);
    expect(out[0]?.replies).toBe(1);
    expect(out[0]?.measured).toBe(2);
    expect(out[0]?.views).toBe(400);
    expect(out[0]?.avgViews).toBe(200);
    expect(out[0]?.profileVisits).toBe(4);
    expect(out[1]?.pillar).toBe('unassigned');
  });
});

describe('parseExtractedTemplate (§8.3)', () => {
  test('valid shape parses; unknown length degrades to medium', () => {
    const t = parseExtractedTemplate(
      JSON.stringify({
        hookType: 'stat hook',
        skeleton: 'stat -> consequence -> question',
        lineBreakPattern: 'one-liner',
        length: 'bizarre',
        device: 'direct address',
      }),
    );
    expect(t?.hookType).toBe('stat hook');
    expect(t?.length).toBe('medium');
  });

  test('missing field → null', () => {
    expect(parseExtractedTemplate(JSON.stringify({ hookType: 'x' }))).toBeNull();
    expect(parseExtractedTemplate('garbage')).toBeNull();
  });

  test('AI.5: EXTRACT_PROMPT_TEMPLATE renders the tweet at the tail (old prefix+text parity)', () => {
    const rendered = EXTRACT_PROMPT_TEMPLATE.split('{{TWEET_TEXT}}').join('MY FIXTURE TWEET');
    expect(rendered.startsWith('Analyze the STRUCTURE')).toBe(true);
    expect(rendered.endsWith('THE POST:\n\nMY FIXTURE TWEET')).toBe(true);
    expect(rendered).not.toContain('{{TWEET_TEXT}}');
  });
});

describe('harvest parseIngestRow content-shape fields (§9.4)', () => {
  const base = {
    tweetId: '123',
    handle: 'someone',
    text: 'hello',
    comments: 1,
    reposts: 2,
    likes: 3,
    bookmarks: 4,
    views: 5,
    time: '2026-06-09T10:00:00Z',
  };

  test('optional fields parse and floor', () => {
    const row = parseIngestRow({
      ...base,
      hasPhoto: true,
      hasVideo: false,
      isQuote: true,
      textLen: 12.9,
      lineBreaks: 2,
      groupPosition: 3,
    });
    if ('error' in row) throw new Error(row.error);
    expect(row.hasPhoto).toBe(true);
    expect(row.isQuote).toBe(true);
    expect(row.textLen).toBe(12);
    expect(row.groupPosition).toBe(3);
  });

  test('absent fields stay null (older extension builds)', () => {
    const row = parseIngestRow(base);
    if ('error' in row) throw new Error(row.error);
    expect(row.hasPhoto).toBeNull();
    expect(row.groupPosition).toBeNull();
  });

  test('wrong types rejected', () => {
    expect(parseIngestRow({ ...base, hasPhoto: 'yes' })).toEqual({
      error: 'invalid_row_hasPhoto',
    });
    expect(parseIngestRow({ ...base, groupPosition: -1 })).toEqual({
      error: 'invalid_row_groupPosition',
    });
  });
});
