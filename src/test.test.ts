import { describe, expect, test } from 'bun:test';
import { beat, heartbeatStatus, registerHeartbeat, unregisterHeartbeat } from './heartbeats.ts';
import { matchOrigin } from './middleware/cors.ts';
import { classifyBand } from './shared/replyBand.ts';
import { buildAuthorizeUrl, generatePkcePair } from './x/auth.ts';
import { containsUrl, createPost } from './x/endpoints.ts';
import { XApiError, classify } from './x/errors.ts';
import { defaultPostParams } from './x/fields.ts';
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
import { priceFor } from './x/pricing.ts';
import {
  type BatchTweet,
  type PostContext,
  REPLY_PROMPT_TEMPLATE,
  blankLineBetweenPropositions,
  buildBatchGrokInput,
  buildGrokInput,
  parseBatchReplies,
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
import {
  MAX_REFRESHES_PER_DAY,
  type RefreshLimiter,
  takeRefreshSlot,
} from './x/routes/mentions.ts';
import { aggregatePillars, buildAccountSeries, buildBestTimes } from './x/routes/metrics.ts';
import { parseBatchTweets } from './x/routes/replies.ts';
import { buildReplyOutcomes, gateSignalsFor, parseContext, replies } from './x/routes/replies.ts';
import {
  type FollowerSnapshotPoint,
  authorMomentum,
  rankTargets,
  targetBand,
} from './x/routes/voice.ts';
import { parseExtractedTemplate } from './x/routes/voiceExtract.ts';
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

  test('buildBatchGrokInput leaves an empty idea tag when none given', () => {
    const [msg] = buildBatchGrokInput(tweets);
    expect(msg?.content.trimEnd().endsWith('<idea></idea>')).toBe(true);
  });

  test('parseBatchReplies maps id→tweetId, trims, coerces unknown angles', () => {
    const out = parseBatchReplies(
      '{"replies":[{"id":"111","text":" hot take ","angle":"contrarian"},{"id":"222","text":"x","angle":"weird"}]}',
    );
    expect(out).toEqual([
      { tweetId: '111', text: 'hot take', angle: 'contrarian' },
      { tweetId: '222', text: 'x', angle: 'extends' },
    ]);
  });

  test('parseBatchReplies blank-line-separates multi-line replies', () => {
    expect(
      parseBatchReplies('{"replies":[{"id":"111","text":"a\\nb\\nc","angle":"extends"}]}'),
    ).toEqual([{ tweetId: '111', text: 'a\n\nb\n\nc', angle: 'extends' }]);
  });

  test('parseBatchReplies rejects garbage and blank text', () => {
    expect(parseBatchReplies('not json')).toBeNull();
    expect(parseBatchReplies('{"replies":[{"id":"1","text":"   ","angle":"extends"}]}')).toBeNull();
    expect(parseBatchReplies('{"replies":[{"text":"x","angle":"extends"}]}')).toBeNull();
    // empty array is a valid (if useless) batch response, not a parse failure
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
