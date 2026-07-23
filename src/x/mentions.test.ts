// CA.1 — the mention inbox pull pages past 50 without widening per-request
// max_results (invariant #5). Prod returned exactly 50 rows/day since Jul 14
// while real inbound ran 50–90/day: everything past 50 fell below the next
// pull's since_id checkpoint and was lost permanently. These tests stub
// globalThis.fetch to serve multi-page fixtures and assert (a) every mention
// above the checkpoint lands, (b) the page size never exceeds the clamp,
// (c) a caller-supplied maxResults stays a TOTAL cap (smoke --live relies on
// its "≤ $0.01" promise), (d) a cold pull stays bounded at the default 50.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { mentions } from './db/schema.ts';
import { getUserMentions } from './endpoints.ts';
import { pullMentions } from './mentions.ts';

const SELF = '999';
// Near the top of int64 so the CAST(tweet_id AS INTEGER) checkpoint query
// always resolves to OUR baseline even with other test files' fixture rows
// sharing the in-memory DB (smoke uses a 9.0e18 prefix; this sits above it).
const BASE = 9_200_000_000_000_000_000n;
const idAt = (i: number): string => String(BASE + BigInt(i));

interface FixturePage {
  ids: string[];
  nextToken?: string;
}

const seenRequests: URL[] = [];
const realFetch = globalThis.fetch;

// Serve fixture pages keyed by pagination_token (first page = no token) and
// record every request URL so tests can assert max_results / since_id.
function installFetch(pages: Record<string, FixturePage>): void {
  const stub = ((input: string | URL | Request) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    seenRequests.push(url);
    const page = pages[url.searchParams.get('pagination_token') ?? 'first'];
    if (!page) throw new Error(`fixture: no page for ${url.href}`);
    const body = {
      data: page.ids.map((id) => ({
        id,
        text: `mention ${id}`,
        author_id: '12345',
        created_at: '2026-07-23T10:00:00.000Z',
        conversation_id: id,
      })),
      meta: {
        result_count: page.ids.length,
        ...(page.nextToken ? { next_token: page.nextToken } : {}),
      },
    };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof globalThis.fetch;
  globalThis.fetch = stub;
}

const insertedIds: string[] = [];

beforeAll(async () => {
  // The since_id checkpoint = max stored tweet_id; seed it explicitly.
  await db.insert(mentions).values({
    tweetId: idAt(0),
    authorId: '12345',
    text: 'checkpoint baseline',
    postedAt: new Date('2026-07-22T10:00:00Z'),
  });
  insertedIds.push(idAt(0));
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await db.delete(mentions).where(inArray(mentions.tweetId, insertedIds));
});

describe('getUserMentions paging (CA.1)', () => {
  test('cold pull without maxTotal stays bounded at maxResults — one page, no walk to 800', async () => {
    seenRequests.length = 0;
    installFetch({
      first: { ids: Array.from({ length: 50 }, (_, i) => idAt(500 + i)), nextToken: 'more' },
      more: { ids: Array.from({ length: 50 }, (_, i) => idAt(600 + i)) },
    });
    const got: string[] = [];
    for await (const m of getUserMentions('tok', SELF, {})) got.push(m.id);
    expect(got.length).toBe(50);
    expect(seenRequests.length).toBe(1);
    expect(seenRequests[0]?.searchParams.get('max_results')).toBe('50');
  });

  test('maxTotal pages past 50 while every request keeps the clamped page size', async () => {
    seenRequests.length = 0;
    installFetch({
      first: { ids: Array.from({ length: 50 }, (_, i) => idAt(700 + i)), nextToken: 'p2' },
      p2: { ids: Array.from({ length: 50 }, (_, i) => idAt(760 + i)), nextToken: 'p3' },
      p3: { ids: Array.from({ length: 20 }, (_, i) => idAt(820 + i)) },
    });
    const got: string[] = [];
    for await (const m of getUserMentions('tok', SELF, { maxResults: 50, maxTotal: 800 })) {
      got.push(m.id);
    }
    expect(got.length).toBe(120);
    expect(seenRequests.length).toBe(3);
    for (const url of seenRequests) {
      expect(url.searchParams.get('max_results')).toBe('50');
    }
  });
});

describe('pullMentions (CA.1)', () => {
  test('incremental pull inserts all 120 mentions above the checkpoint, not the first 50', async () => {
    seenRequests.length = 0;
    // Newest-first like the real endpoint; 120 new mentions above idAt(0).
    const page1 = Array.from({ length: 50 }, (_, i) => idAt(120 - i));
    const page2 = Array.from({ length: 50 }, (_, i) => idAt(70 - i));
    const page3 = Array.from({ length: 20 }, (_, i) => idAt(20 - i));
    insertedIds.push(...page1, ...page2, ...page3);
    installFetch({
      first: { ids: page1, nextToken: 'p2' },
      p2: { ids: page2, nextToken: 'p3' },
      p3: { ids: page3 },
    });

    const result = await pullMentions('tok', SELF);
    expect(result.scanned).toBe(120);
    expect(result.inserted).toBe(120);

    // Every request stayed on the clamped page size and under the checkpoint.
    expect(seenRequests.length).toBe(3);
    for (const url of seenRequests) {
      expect(url.searchParams.get('max_results')).toBe('50');
      expect(url.searchParams.get('since_id')).toBe(idAt(0));
    }

    // The checkpoint (max stored id) only advanced because the rows committed
    // — same order-by-cast read pullMentions itself uses (int64-exact; a
    // max() pulled into JS would round at this magnitude).
    const [latest] = await db
      .select({ tweetId: mentions.tweetId })
      .from(mentions)
      .orderBy(sql`CAST(${mentions.tweetId} AS INTEGER) desc`)
      .limit(1);
    expect(latest?.tweetId).toBe(idAt(120));
  });

  test('caller-supplied maxResults stays a total cap — no paging past caller intent', async () => {
    seenRequests.length = 0;
    const ids = Array.from({ length: 10 }, (_, i) => idAt(210 - i));
    insertedIds.push(...ids);
    installFetch({
      first: { ids, nextToken: 'never-fetched' },
    });

    const result = await pullMentions('tok', SELF, { maxResults: 10 });
    expect(result.inserted).toBe(10);
    expect(seenRequests.length).toBe(1);
    expect(seenRequests[0]?.searchParams.get('max_results')).toBe('10');
  });
});
