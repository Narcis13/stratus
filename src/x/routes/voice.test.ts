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
import { people, personEvents, voiceAuthors, voiceTweets } from '../db/schema.ts';
import { createVoiceRouter, scrapeSourceFor } from './voice.ts';

const app = new Hono();
app.route('/x', createVoiceRouter());

// Handles must be ≤15 chars or `normalizeHandle` rejects the whole tweet.
const HANDLES = ['ou7hunter', 'ou7timeline', 'ou7quiet', 'ou7junkpath'];
// Named rather than indexed out of an array — `noUncheckedIndexedAccess` makes
// `IDS[0]` a `string | undefined` that every assertion would have to widen.
const ID_SEARCH = '9007001';
const ID_HOME = '9007002';
const ID_ABSENT = '9007003';
const ID_JUNK = '9007004';
const ID_RESAVE = '9007005';
const TWEET_IDS = [ID_SEARCH, ID_HOME, ID_ABSENT, ID_JUNK, ID_RESAVE];

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
