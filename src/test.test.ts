import { describe, expect, test } from 'bun:test';
import { beat, heartbeatStatus, registerHeartbeat, unregisterHeartbeat } from './heartbeats.ts';
import { matchOrigin } from './middleware/cors.ts';
import { buildAuthorizeUrl, generatePkcePair } from './x/auth.ts';
import { containsUrl } from './x/endpoints.ts';
import { XApiError, classify } from './x/errors.ts';
import { defaultPostParams } from './x/fields.ts';
import { priceFor } from './x/pricing.ts';
import {
  type PostContext,
  REPLY_PROMPT_TEMPLATE,
  buildGrokInput,
  parseReplyVariants,
  passesSpecificityGate,
} from './x/replies/prompt.ts';
import {
  attachLatestSnapshots,
  findScheduleGaps,
  followerTrend,
  localDayStart,
  localMinuteOfDay,
  pickAnchors,
} from './x/routes/brief.ts';
import {
  type UnlinkedDraft,
  matchUnlinkedDraft,
  normalizeHarvestText,
  parseIngestRow,
} from './x/routes/harvest.ts';
import { buildAccountSeries } from './x/routes/metrics.ts';
import { buildReplyOutcomes, parseContext } from './x/routes/replies.ts';
import { msUntilNextUtcHour } from './x/workers/dailyMetrics.ts';

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

  test('parseReplyVariants accepts the schema shape and trims', () => {
    const out = parseReplyVariants(
      '{"replies":[{"text":"  one\\n\\ntwo  ","angle":"contrarian"},{"text":"solo","angle":"extends"}]}',
    );
    expect(out).toEqual([
      { text: 'one\n\ntwo', angle: 'contrarian' },
      { text: 'solo', angle: 'extends' },
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
