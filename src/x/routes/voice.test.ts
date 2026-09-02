// OU.7 — swipe-file provenance. `POST /x/voice/scrape` had no route suite at
// all before this task (voice's pure helpers are covered in `src/test.test.ts`;
// the scrape itself was covered by nothing), so this file starts one and covers
// exactly the new behaviour: the client reports which x.com page the Save was
// clicked on, and the SERVER decides what that means.
//
// Bare-Hono over the real (in-memory, auto-migrated) SQLite DB — `bun run test`
// sets SQLITE_PATH=:memory:. A scrape also fires the people-layer side hooks
// (`upsertPerson` + `safeLogPersonEvents`), so afterAll deletes those rows too;
// the DB is shared across suites and a leaked `people` row is exactly the kind
// of fixture that makes a different file's count assertion fail.

import { afterAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { scoreMeasured } from '../../shared/xRankerSignals.ts';
import { people, personEvents, voiceAuthors, voiceTweets } from '../db/schema.ts';
import { createVoiceRouter, parseScrapedMetrics, scrapeSourceFor } from './voice.ts';

const app = new Hono();
app.route('/x', createVoiceRouter());

// Handles must be ≤15 chars or `normalizeHandle` rejects the whole tweet.
const HANDLES = [
  'ou7hunter',
  'ou7timeline',
  'ou7quiet',
  'ou7junkpath',
  'xr7full',
  'xr7bare',
  'xr7zero',
  'xr7liar',
  'xr7resave',
];
// Named rather than indexed out of an array — `noUncheckedIndexedAccess` makes
// `IDS[0]` a `string | undefined` that every assertion would have to widen.
const ID_SEARCH = '9007001';
const ID_HOME = '9007002';
const ID_ABSENT = '9007003';
const ID_JUNK = '9007004';
const ID_RESAVE = '9007005';
// XR.7 — the five score columns.
const ID_METRICS = '9007101';
const ID_NO_METRICS = '9007102';
const ID_ZERO_VIEWS = '9007103';
const ID_CLIENT_SCORE = '9007104';
const ID_METRIC_RESAVE = '9007105';
const TWEET_IDS = [
  ID_SEARCH,
  ID_HOME,
  ID_ABSENT,
  ID_JUNK,
  ID_RESAVE,
  ID_METRICS,
  ID_NO_METRICS,
  ID_ZERO_VIEWS,
  ID_CLIENT_SCORE,
  ID_METRIC_RESAVE,
];

afterAll(async () => {
  await db.delete(voiceTweets).where(inArray(voiceTweets.tweetId, TWEET_IDS));
  await db.delete(voiceAuthors).where(inArray(voiceAuthors.handle, HANDLES));
  await db.delete(personEvents).where(inArray(personEvents.handle, HANDLES));
  await db.delete(people).where(inArray(people.handle, HANDLES));
});

async function scrape(
  tweetId: string,
  handle: string,
  extra: Record<string, unknown>,
  text = 'an outlier worth stealing the shape of',
): Promise<Response> {
  return app.request('/x/voice/scrape', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tweet: {
        tweetId,
        handle,
        displayName: 'OU7',
        text,
        url: `https://x.com/${handle}/status/${tweetId}`,
      },
      ...extra,
    }),
  });
}

async function sourceOf(tweetId: string): Promise<string | undefined> {
  const [row] = await db.select().from(voiceTweets).where(eq(voiceTweets.tweetId, tweetId));
  return row?.source;
}

async function rowOf(tweetId: string) {
  const [row] = await db.select().from(voiceTweets).where(eq(voiceTweets.tweetId, tweetId));
  if (!row) throw new Error(`no voice_tweets row for ${tweetId}`);
  return row;
}

describe('scrapeSourceFor', () => {
  test('a search page — with or without the query string — is an outlier hunt', () => {
    expect(scrapeSourceFor('/search')).toBe('outlier_search');
    expect(scrapeSourceFor('/search?q=bun%20outlier&f=top')).toBe('outlier_search');
    expect(scrapeSourceFor('/search/')).toBe('outlier_search');
    expect(scrapeSourceFor('  /search#top  ')).toBe('outlier_search');
  });

  test('every other page is the ordinary scrape source', () => {
    expect(scrapeSourceFor('/home')).toBe('extension_scrape');
    expect(scrapeSourceFor('/someone/status/123')).toBe('extension_scrape');
    expect(scrapeSourceFor('/explore')).toBe('extension_scrape');
  });

  test('matches the segment, not the prefix — /searchlight is a profile', () => {
    expect(scrapeSourceFor('/searchlight')).toBe('extension_scrape');
    expect(scrapeSourceFor('/searchlight/status/1')).toBe('extension_scrape');
  });

  test('an absent or unusable path degrades, never throws (§7.35)', () => {
    expect(scrapeSourceFor(undefined)).toBe('extension_scrape');
    expect(scrapeSourceFor(null)).toBe('extension_scrape');
    expect(scrapeSourceFor(42)).toBe('extension_scrape');
    expect(scrapeSourceFor({ pathname: '/search' })).toBe('extension_scrape');
    expect(scrapeSourceFor('')).toBe('extension_scrape');
  });
});

describe('POST /x/voice/scrape — provenance', () => {
  test('a save off a search-results page stamps outlier_search', async () => {
    const id = ID_SEARCH;
    const res = await scrape(id, 'ou7hunter', { sourcePath: '/search?q=bun%20outlier&f=top' });
    expect(res.status).toBe(201);
    expect(await sourceOf(id)).toBe('outlier_search');
  });

  test('a save off the timeline stamps extension_scrape', async () => {
    const id = ID_HOME;
    const res = await scrape(id, 'ou7timeline', { sourcePath: '/home' });
    expect(res.status).toBe(201);
    expect(await sourceOf(id)).toBe('extension_scrape');
  });

  test('an absent sourcePath still saves, at the ordinary source', async () => {
    const id = ID_ABSENT;
    const res = await scrape(id, 'ou7quiet', {});
    expect(res.status).toBe(201);
    expect(await sourceOf(id)).toBe('extension_scrape');
  });

  test('a non-string sourcePath still saves, at the ordinary source', async () => {
    const id = ID_JUNK;
    const res = await scrape(id, 'ou7junkpath', { sourcePath: 42 });
    expect(res.status).toBe(201);
    expect(await sourceOf(id)).toBe('extension_scrape');
  });

  test('first save wins — re-saving from the timeline keeps outlier_search', async () => {
    const id = ID_RESAVE;
    await scrape(id, 'ou7hunter', { sourcePath: '/search?q=drizzle' }, 'the original text');
    expect(await sourceOf(id)).toBe('outlier_search');

    const again = await scrape(id, 'ou7hunter', { sourcePath: '/home' }, 'the edited text');
    expect(again.status).toBe(201);

    const [row] = await db.select().from(voiceTweets).where(eq(voiceTweets.tweetId, id));
    // The re-save DID land — it refreshed the text — so the unchanged source is
    // the set-clause omission working, not the second POST failing silently.
    expect(row?.text).toBe('the edited text');
    expect(row?.source).toBe('outlier_search');
  });
});

// XR.7 — the counts a scrape saw, and the score the SERVER puts on them. Every
// assertion reads the COLUMNS rather than the response, because the response is
// the row drizzle returns and could have been built from the request body.
describe('parseScrapedMetrics', () => {
  test('a full block parses', () => {
    expect(parseScrapedMetrics({ views: 5000, likes: 90, replies: 20, reposts: 4 })).toEqual({
      views: 5000,
      likes: 90,
      replies: 20,
      reposts: 4,
    });
  });

  test('an absent field is null, never 0 (§7.11)', () => {
    expect(parseScrapedMetrics({ views: 5000 })).toEqual({
      views: 5000,
      likes: null,
      replies: null,
      reposts: null,
    });
  });

  // Whatever `optCount` refuses is unknown, not zero — a negative or a string
  // count is a broken reading, and pretending it is 0 writes a measurement.
  test('unusable fields drop to null instead of to zero', () => {
    expect(parseScrapedMetrics({ views: -1, likes: 'many', replies: 1.9, reposts: null })).toEqual({
      views: null,
      likes: null,
      replies: 1,
      reposts: null,
    });
  });

  test('a block with nothing usable is not an observation', () => {
    expect(parseScrapedMetrics({})).toBeNull();
    expect(parseScrapedMetrics({ views: null, likes: null })).toBeNull();
    expect(parseScrapedMetrics(undefined)).toBeNull();
    expect(parseScrapedMetrics('5000 views')).toBeNull();
    expect(parseScrapedMetrics([5000])).toBeNull();
  });
});

describe('POST /x/voice/scrape — the ranker reading (XR.7)', () => {
  test('a save carrying metrics stores them and a server-computed ranker_e', async () => {
    const metrics = { views: 5000, likes: 90, replies: 20, reposts: 4 };
    const res = await scrape(ID_METRICS, 'xr7full', { metrics });
    expect(res.status).toBe(201);

    const row = await rowOf(ID_METRICS);
    expect(row.views).toBe(5000);
    expect(row.likes).toBe(90);
    expect(row.replies).toBe(20);
    expect(row.reposts).toBe(4);

    // The score is not just non-null: it is `scoreMeasured` over the same
    // counts, which is the §7.27 claim that the panel, the Playbook cell and
    // this column are one estimator rather than three. A drift on either side
    // fails here rather than showing up as two disagreeing numbers.
    const expected = scoreMeasured(metrics);
    expect(expected.available).toBe(true);
    if (expected.available) expect(row.rankerE).toBe(expected.score);
  });

  test('a save with no metrics leaves all five columns null', async () => {
    const res = await scrape(ID_NO_METRICS, 'xr7bare', {});
    expect(res.status).toBe(201);

    const row = await rowOf(ID_NO_METRICS);
    expect(row.views).toBeNull();
    expect(row.likes).toBeNull();
    expect(row.replies).toBeNull();
    expect(row.reposts).toBeNull();
    expect(row.rankerE).toBeNull();
  });

  // Views is E's denominator, so without one there is no rate to score. The
  // counts are still a real reading and are kept; the score is absent, NOT 0 —
  // a 0 would read as the ranker rating this at the floor.
  test('counts with no view count store the counts and a NULL ranker_e', async () => {
    const res = await scrape(ID_ZERO_VIEWS, 'xr7zero', {
      metrics: { views: 0, likes: 3, replies: 1, reposts: 0 },
    });
    expect(res.status).toBe(201);

    const row = await rowOf(ID_ZERO_VIEWS);
    expect(row.likes).toBe(3);
    expect(row.replies).toBe(1);
    expect(row.reposts).toBe(0);
    expect(row.rankerE).toBeNull();
  });

  // §7.16 — the client reports the observation, the server decides the meaning.
  // A page that names its own score is a number this service cannot defend.
  test('a client-supplied rankerE is ignored', async () => {
    const res = await scrape(ID_CLIENT_SCORE, 'xr7liar', {
      metrics: { views: 1000, likes: 1, replies: 0, reposts: 0, rankerE: 99 },
      rankerE: 99,
    });
    expect(res.status).toBe(201);

    const row = await rowOf(ID_CLIENT_SCORE);
    const expected = scoreMeasured({ views: 1000, likes: 1, replies: 0, reposts: 0 });
    expect(expected.available).toBe(true);
    if (expected.available) {
      expect(row.rankerE).toBe(expected.score);
      expect(row.rankerE).not.toBe(99);
    }
  });

  // The five columns are ONE observation. A re-save that read the card refreshes
  // all five together; a re-save from a build that reports none leaves the whole
  // reading alone rather than blanking it — and never leaves a row whose
  // `ranker_e` is the score of counts it no longer holds.
  test('a re-save moves all five columns together, or none of them', async () => {
    await scrape(ID_METRIC_RESAVE, 'xr7resave', {
      metrics: { views: 1000, likes: 5, replies: 1, reposts: 0 },
    });
    const first = await rowOf(ID_METRIC_RESAVE);
    expect(first.views).toBe(1000);
    expect(first.rankerE).not.toBeNull();

    const grown = await scrape(
      ID_METRIC_RESAVE,
      'xr7resave',
      { metrics: { views: 9000, likes: 400, replies: 60, reposts: 12 } },
      'the edited text',
    );
    expect(grown.status).toBe(201);
    const second = await rowOf(ID_METRIC_RESAVE);
    expect(second.views).toBe(9000);
    expect(second.likes).toBe(400);
    expect(second.rankerE).not.toBe(first.rankerE);
    const expected = scoreMeasured({ views: 9000, likes: 400, replies: 60, reposts: 12 });
    if (expected.available) expect(second.rankerE).toBe(expected.score);

    const silent = await scrape(ID_METRIC_RESAVE, 'xr7resave', {}, 'edited again');
    expect(silent.status).toBe(201);
    const third = await rowOf(ID_METRIC_RESAVE);
    // The re-save DID land — the text moved — so the unchanged reading is the
    // set-clause omission working rather than the POST failing silently (D184a).
    expect(third.text).toBe('edited again');
    expect(third.views).toBe(9000);
    expect(third.likes).toBe(400);
    expect(third.rankerE).toBe(second.rankerE);
  });
});
