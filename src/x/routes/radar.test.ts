// RU.5: the confirm endpoint promotes a radar draft into a measured
// reply_drafts row, plus the ?tweetId= list filter — over the real (in-memory,
// auto-migrated) SQLite DB; bun test runs with SQLITE_PATH=:memory:.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { commitments, radarDrafts, replyDrafts, streaks } from '../db/schema.ts';
import { resetSettings, setSettings } from '../settings/registry.ts';
import { radar } from './radar.ts';

const app = new Hono();
app.route('/x', radar);

// Distinct high ids so we never collide with another suite's radar rows.
const T_WITH = '991000000000000001'; // full signals + 3 variants + model
const T_NULL = '991000000000000002'; // CLI-shaped: null signals/variants/model
const T_OTHER = '991000000000000003'; // filter-isolation sentinel
const T_MANUAL = '991000000000000004'; // RU.8: band='manual' + signals
const T_TTL = '991000000000000005'; // UI.4: 10h-old row for the TTL knob
const T_ROSTER = '991000000000000006'; // GT.8: band='roster' + signals
const T_UNKNOWN = '991999999999999999'; // no row — 404
const IDS = [T_WITH, T_NULL, T_OTHER, T_MANUAL, T_TTL, T_ROSTER];

const PRIMARY_TEXT = 'v1 extends: I shipped mine in 3 days';
const VARIANTS = [
  { text: PRIMARY_TEXT, angle: 'extends' },
  { text: 'v2 contrarian: that never scales', angle: 'contrarian' },
  { text: 'v3 debate: define "done" first', angle: 'debate' },
];

async function send<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const parsed = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  return { status: res.status, body: parsed };
}

beforeAll(async () => {
  await db.delete(replyDrafts).where(inArray(replyDrafts.sourceTweetId, IDS));
  await db.delete(radarDrafts).where(inArray(radarDrafts.tweetId, IDS));
  await db.insert(radarDrafts).values([
    {
      tweetId: T_WITH,
      url: `https://x.com/alice/status/${T_WITH}`,
      handle: 'alice',
      author: 'Alice Builder',
      snippet: 'shipping is a skill you learn by shipping',
      band: 'hot',
      signals: { views: 1500, replies: 8, ageMin: 22, vpm: 68, bait: false },
      replyText: PRIMARY_TEXT,
      angle: 'extends',
      variants: VARIANTS,
      model: 'grok-4.3',
    },
    {
      // CLI/smoke-shaped: no signals, no variants, no model, no url.
      tweetId: T_NULL,
      handle: 'bob',
      snippet: 'cold tweet, no captured signals',
      replyText: 'a plain reply',
      angle: 'extends',
    },
    {
      tweetId: T_OTHER,
      handle: 'carol',
      snippet: 'another tweet',
      replyText: 'r',
      angle: 'debate',
    },
    {
      // RU.8: a ⊕ manual add carries band='manual' with real signals.
      tweetId: T_MANUAL,
      url: `https://x.com/dave/status/${T_MANUAL}`,
      handle: 'dave',
      author: 'Dave',
      snippet: 'a manually pinned tweet',
      band: 'manual',
      signals: { views: 800, replies: 3, ageMin: 10, vpm: 80, bait: false },
      replyText: 'manual reply',
      angle: 'extends',
    },
    {
      // GT.8: a roster capture — quiet post, real signals, in the queue because
      // of who posted it.
      tweetId: T_ROSTER,
      url: `https://x.com/erin/status/${T_ROSTER}`,
      handle: 'erin',
      author: 'Erin',
      snippet: 'a quiet post by someone in my circle',
      band: 'roster',
      signals: { views: 42, replies: 0, ageMin: 30, vpm: 1.4, bait: false },
      replyText: 'roster reply',
      angle: 'extends',
    },
  ]);
});

afterAll(async () => {
  await db.delete(replyDrafts).where(inArray(replyDrafts.sourceTweetId, IDS));
  await db.delete(radarDrafts).where(inArray(radarDrafts.tweetId, IDS));
});

// CQ.3 — the placed-today counter. Three things are being pinned: the predicate
// is brief.ts's (posted + updatedAt inside the LOCAL day, nothing else), the
// target follows an active commitment and falls back to doctrine, and the route
// WRITES NOTHING. The last one is the reason the panel is allowed to poll it,
// so it is asserted, not assumed.
describe('GET /radar/placed-today (CQ.3)', () => {
  // Its own tweet ids so the drafts seeded above (and any other suite's) can't
  // land in the window by accident.
  const P_TODAY = '992000000000000001';
  const P_YESTERDAY = '992000000000000002';
  const P_COPIED = '992000000000000003';
  const P_IDS = [P_TODAY, P_YESTERDAY, P_COPIED];

  // Fixed offset so the local day is a known window whatever the host TZ is.
  // 0 = UTC, and every seeded time below is placed relative to UTC noon-ish.
  const TZ = 0;
  const now = new Date();
  const utcDayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const DAY = 24 * 60 * 60 * 1000;

  const draft = (tweetId: string, status: string, updatedAt: Date) => ({
    sourceTweetId: tweetId,
    sourceAuthorUsername: 'cq3author',
    sourceText: 'a post',
    sourceUrl: `https://x.com/cq3author/status/${tweetId}`,
    contextSnapshot: {},
    replyText: 'a reply',
    model: 'test',
    status,
    updatedAt,
  });

  beforeAll(async () => {
    await db.delete(replyDrafts).where(inArray(replyDrafts.sourceTweetId, P_IDS));
    await db.insert(replyDrafts).values([
      // Mid-day today: inside the window on any run.
      draft(P_TODAY, 'posted', new Date(utcDayStart + 12 * 60 * 60 * 1000)),
      // Same time yesterday: posted, but outside the day.
      draft(P_YESTERDAY, 'posted', new Date(utcDayStart + 12 * 60 * 60 * 1000 - DAY)),
      // Inside the day, but only copied — the paste never happened.
      draft(P_COPIED, 'copied', new Date(utcDayStart + 13 * 60 * 60 * 1000)),
    ]);
  });

  afterAll(async () => {
    await db.delete(replyDrafts).where(inArray(replyDrafts.sourceTweetId, P_IDS));
    await db.delete(commitments).where(eq(commitments.key, 'replies'));
  });

  const placedToday = () =>
    send<{ dayKey: string; placed: number; target: number }>(
      `/x/radar/placed-today?tzOffsetMin=${TZ}`,
      'GET',
    );

  test('counts only posted rows inside the local day; target falls back to doctrine', async () => {
    const { status, body } = await placedToday();
    expect(status).toBe(200);
    expect(body.dayKey).toBe(new Date(utcDayStart).toISOString().slice(0, 10));
    // Exactly one of the three fixtures qualifies. Other suites' posted drafts
    // are dated by their own inserts, so this counts THIS suite's rows plus any
    // they happen to have placed today — hence the >= 1 lower bound paired with
    // the strict absence checks that follow.
    expect(body.placed).toBeGreaterThanOrEqual(1);
    // Doctrine default (niche `replyTargetMax`) when no commitment is active.
    expect(body.target).toBe(20);
  });

  test('neither a yesterday row nor a copied row is a placed reply', async () => {
    const before = (await placedToday()).body.placed;

    // Move the yesterday row into today and the count moves by exactly one —
    // which is what proves the window, not the row set, is doing the filtering.
    await db
      .update(replyDrafts)
      .set({ updatedAt: new Date(utcDayStart + 11 * 60 * 60 * 1000) })
      .where(eq(replyDrafts.sourceTweetId, P_YESTERDAY));
    expect((await placedToday()).body.placed).toBe(before + 1);

    // The copied row is inside the window already; flipping it to posted is the
    // same one-row move, which proves the status half independently.
    await db
      .update(replyDrafts)
      .set({ status: 'posted' })
      .where(eq(replyDrafts.sourceTweetId, P_COPIED));
    expect((await placedToday()).body.placed).toBe(before + 2);
  });

  test('an active replies commitment outranks the doctrine default', async () => {
    await db.insert(commitments).values({ key: 'replies', dailyTarget: 7, active: true });
    expect((await placedToday()).body.target).toBe(7);

    // Paused is not a promise — the doctrine number comes back (GR.8).
    await db.update(commitments).set({ active: false }).where(eq(commitments.key, 'replies'));
    expect((await placedToday()).body.target).toBe(20);
  });

  test('invalid tzOffsetMin → 400, absent → UTC', async () => {
    const bad = await send<{ error: string }>('/x/radar/placed-today?tzOffsetMin=1200', 'GET');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_tz_offset_min');

    const bare = await send<{ dayKey: string }>('/x/radar/placed-today', 'GET');
    expect(bare.status).toBe(200);
    expect(bare.body.dayKey).toBe(new Date(utcDayStart).toISOString().slice(0, 10));
  });

  // The one-line proof that polling this route is safe. `GET /brief` reports the
  // same number but upserts a streak row and flips goal statuses on the way —
  // this one is a pure SELECT pair, and the day that changes, a panel that polls
  // every 30s starts writing a streak diary out of nothing. Counted rather than
  // asserted empty: the in-memory DB is shared with brief.test.ts.
  test('writes nothing — the streaks table is untouched', async () => {
    const before = db.select().from(streaks).all().length;
    await placedToday();
    expect(db.select().from(streaks).all()).toHaveLength(before);
  });
});

interface DraftRow {
  tweetId: string;
  status: string;
  replyDraftId: string | null;
}
interface ReplyRow {
  id: string;
  source: string | null;
  status: string;
  model: string;
  replyText: string;
  sourceUrl: string;
  sourcePostedAt: string | null; // Date column → ISO string over JSON
  variants: { text: string; angle: string }[] | null;
  contextSnapshot: {
    signals?: { band: string | null; views: number; ageMin: number };
    metrics: { views: number; replies: number; reposts: number; likes: number };
    topComments: unknown[];
  };
}

describe('GET /radar/drafts?tweetId=', () => {
  test('filter returns only that tweet’s rows', async () => {
    const { status, body } = await send<{ drafts: DraftRow[] }>(
      `/x/radar/drafts?tweetId=${T_WITH}`,
      'GET',
    );
    expect(status).toBe(200);
    expect(body.drafts.length).toBeGreaterThanOrEqual(1);
    expect(body.drafts.every((d) => d.tweetId === T_WITH)).toBe(true);
  });

  test('malformed tweetId → 400', async () => {
    const { status, body } = await send<{ error: string }>(
      '/x/radar/drafts?tweetId=not-a-number',
      'GET',
    );
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_tweet_id');
  });
});

// UI.4: the lazy-expiry window is `x.radar.draftTtlH`. The seeded row is 10h
// old, so it survives the 48h default and dies at a 6h TTL — and the flip is
// one-way, so restoring the default does NOT bring it back.
describe('GET /radar/drafts expiry honors x.radar.draftTtlH', () => {
  test('a 10h-old ready draft survives 48h and expires at 6h', async () => {
    await db.insert(radarDrafts).values({
      tweetId: T_TTL,
      url: `https://x.com/carol/status/${T_TTL}`,
      handle: 'carol',
      author: null,
      snippet: 'ttl fixture',
      band: 'warm',
      signals: null,
      replyText: 'still fresh at the default window',
      angle: 'extends',
      variants: null,
      model: null,
      draftedAt: new Date(Date.now() - 10 * 60 * 60 * 1000),
    });

    const alive = await send<{ drafts: DraftRow[] }>(`/x/radar/drafts?tweetId=${T_TTL}`, 'GET');
    expect(alive.body.drafts[0]?.status).toBe('ready');

    try {
      setSettings({ 'x.radar.draftTtlH': 6 });
      await send<{ drafts: DraftRow[] }>('/x/radar/drafts', 'GET');
    } finally {
      resetSettings({ keys: ['x.radar.draftTtlH'] });
    }

    // A bare tweetId list hides expired rows; ask for them explicitly.
    const gone = await send<{ drafts: DraftRow[] }>(`/x/radar/drafts?tweetId=${T_TTL}`, 'GET');
    expect(gone.body.drafts).toHaveLength(0);
    const dead = await send<{ drafts: DraftRow[] }>(
      `/x/radar/drafts?tweetId=${T_TTL}&status=expired`,
      'GET',
    );
    expect(dead.body.drafts[0]?.status).toBe('expired');
  });
});

describe('POST /radar/drafts/:tweetId/confirm', () => {
  let createdId = '';

  test('malformed tweetId → 400', async () => {
    const { status, body } = await send<{ error: string }>(
      '/x/radar/drafts/not-a-number/confirm',
      'POST',
    );
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_tweet_id');
  });

  test('unknown tweet → 404', async () => {
    const { status, body } = await send<{ error: string }>(
      `/x/radar/drafts/${T_UNKNOWN}/confirm`,
      'POST',
    );
    expect(status).toBe(404);
    expect(body.error).toBe('not_found');
  });

  test('creates a measured reply_drafts row and ratchets the radar draft', async () => {
    const { status, body } = await send<ReplyRow>(`/x/radar/drafts/${T_WITH}/confirm`, 'POST');
    expect(status).toBe(201);
    createdId = body.id;
    expect(body.source).toBe('radar');
    expect(body.status).toBe('copied');
    expect(body.model).toBe('grok-4.3');
    expect(body.replyText).toBe(PRIMARY_TEXT);
    expect(body.variants).toHaveLength(3);
    expect(body.sourceUrl).toBe(`https://x.com/alice/status/${T_WITH}`);
    // contextSnapshot parse-shapes like PostContext (band from the column,
    // metrics from signals, topComments []).
    expect(body.contextSnapshot.signals?.band).toBe('hot');
    expect(body.contextSnapshot.signals?.views).toBe(1500);
    expect(body.contextSnapshot.metrics).toEqual({
      views: 1500,
      replies: 8,
      reposts: 0,
      likes: 0,
    });
    expect(body.contextSnapshot.topComments).toEqual([]);
    // sourcePostedAt derived back from draftedAt − ageMin (ISO string on the wire).
    expect(body.sourcePostedAt).not.toBeNull();

    // The radar draft is now clicked and soft-linked.
    const [draftRow] = await db
      .select()
      .from(radarDrafts)
      .where(inArray(radarDrafts.tweetId, [T_WITH]));
    expect(draftRow?.status).toBe('clicked');
    expect(draftRow?.replyDraftId).toBe(createdId);
  });

  test('second confirm is idempotent (returns the same draft)', async () => {
    const { status, body } = await send<ReplyRow>(`/x/radar/drafts/${T_WITH}/confirm`, 'POST');
    expect(status).toBe(200);
    expect(body.id).toBe(createdId);
  });

  test('signals-null row confirms with no signals block and the primary as variants', async () => {
    const { status, body } = await send<ReplyRow>(`/x/radar/drafts/${T_NULL}/confirm`, 'POST');
    expect(status).toBe(201);
    expect(body.contextSnapshot.signals).toBeUndefined();
    expect(body.contextSnapshot.metrics.views).toBe(0);
    expect(body.sourcePostedAt).toBeNull();
    expect(body.model).toBe('radar-batch'); // fallback for a null-model row
    expect(body.sourceUrl).toBe(`https://x.com/bob/status/${T_NULL}`); // constructed
    expect(body.variants).toEqual([{ text: 'a plain reply', angle: 'extends' }]);
  });

  test('a manual-band row (RU.8) confirms with signals.band coerced to null', async () => {
    const { status, body } = await send<ReplyRow>(`/x/radar/drafts/${T_MANUAL}/confirm`, 'POST');
    expect(status).toBe(201);
    // The signals block still rides (metrics present) but band is NOT 'manual' —
    // a manual pin is queue metadata, never a classifier verdict, so it can't
    // enter the Playbook's hot/warm band cells (§7.19).
    expect(body.contextSnapshot.signals).toBeDefined();
    expect(body.contextSnapshot.signals?.band).toBeNull();
    expect(body.contextSnapshot.metrics.views).toBe(800);
  });

  test("confirm: a 'roster' band never reaches the reply snapshot (GT.8, §7.19)", async () => {
    const { status, body } = await send<ReplyRow>(`/x/radar/drafts/${T_ROSTER}/confirm`, 'POST');
    expect(status).toBe(201);
    // Same rule as the ⊕ pin above: the queue's reason for holding the row is
    // not a classifier verdict, so it must not become one in the Playbook's
    // hot/warm cells. The real metrics still ride.
    expect(body.contextSnapshot.signals).toBeDefined();
    expect(body.contextSnapshot.signals?.band).toBeNull();
    expect(body.contextSnapshot.metrics.views).toBe(42);
  });
});
