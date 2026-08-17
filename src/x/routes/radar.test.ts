// RU.5: the confirm endpoint promotes a radar draft into a measured
// reply_drafts row, plus the ?tweetId= list filter — over the real (in-memory,
// auto-migrated) SQLite DB; bun test runs with SQLITE_PATH=:memory:.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray, like } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  commitments,
  people,
  radarDrafts,
  radarSightings,
  replyDrafts,
  streaks,
} from '../db/schema.ts';
import { resetSettings, setSettings } from '../settings/registry.ts';
import { sweepConfigFromSettings } from '../settings/sweepConfig.ts';
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
const T_CANNON = '991000000000000007'; // CQ.4: band='cannon' + signals
const T_SWEEP = '991000000000000008'; // RS.2: band='sweep' + signals
const T_UNKNOWN = '991999999999999999'; // no row — 404
const IDS = [T_WITH, T_NULL, T_OTHER, T_MANUAL, T_TTL, T_ROSTER, T_CANNON, T_SWEEP];

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
      band: 'sweep',
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
    {
      // CQ.4: an arbitrage capture — dense post by an account with no
      // relationship, in the queue for the reply slot rather than the person.
      tweetId: T_CANNON,
      url: `https://x.com/frank/status/${T_CANNON}`,
      handle: 'frank',
      author: 'Frank',
      snippet: 'a 200k-view post with almost no replies under it',
      band: 'cannon',
      signals: { views: 204_000, replies: 6, ageMin: 9, vpm: 22_666, bait: false },
      replyText: 'cannon reply',
      angle: 'extends',
    },
    {
      // RS.2: an armed sweep's filters admitted this one — no classifier verdict
      // behind it, so the column is the only record of why it was queued.
      tweetId: T_SWEEP,
      url: `https://x.com/gina/status/${T_SWEEP}`,
      handle: 'gina',
      author: 'Gina',
      snippet: 'an ordinary post my sweep filters let through',
      band: 'sweep',
      signals: { views: 610, replies: 2, ageMin: 18, vpm: 34, bait: false },
      replyText: 'sweep reply',
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
    signals?: { views: number; ageMin: number };
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
      band: 'sweep',
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
    // contextSnapshot parse-shapes like PostContext (metrics from signals,
    // topComments []). The band is NOT copied in — it is queue metadata that
    // stays in its own column.
    expect(body.contextSnapshot.signals).not.toHaveProperty('band');
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

  // Every band is queue metadata about HOW the row entered — a ⊕ pin (RU.8), a
  // circle capture (GT.8), an arbitrage capture (CQ.4), a sweep admission
  // (RS.2). None of them may reach the reply snapshot: the snapshot records what
  // the TWEET looked like, and a capture reason sitting in it would be read back
  // as a fact about the post. The column keeps the value; the snapshot never
  // gets one.
  const CONFIRM_BANDS: Array<[string, string, number]> = [
    ['manual', T_MANUAL, 800],
    ['roster', T_ROSTER, 42],
    ['cannon', T_CANNON, 204_000],
    ['sweep', T_SWEEP, 610],
  ];

  for (const [band, tweetId, views] of CONFIRM_BANDS) {
    test(`confirm: a '${band}' band stays in its column and never enters the snapshot`, async () => {
      const { status, body } = await send<ReplyRow>(`/x/radar/drafts/${tweetId}/confirm`, 'POST');
      expect(status).toBe(201);
      // Asserted against the ROW READ BACK FROM THE DB, not the response body:
      // what a later Playbook read sees is the persisted snapshot, and a rule
      // that only held in the response would pass a body-only check.
      const [reply] = await db.select().from(replyDrafts).where(eq(replyDrafts.id, body.id));
      expect(reply).toBeDefined();
      const snapshot = reply?.contextSnapshot as ReplyRow['contextSnapshot'];
      // The signals block still rides (real metrics) — it just carries no band.
      expect(snapshot.signals).toBeDefined();
      expect(snapshot.signals).not.toHaveProperty('band');
      expect(snapshot.metrics.views).toBe(views);
      // The queue must still be able to say why it held the row.
      const [row] = await db.select().from(radarDrafts).where(eq(radarDrafts.tweetId, tweetId));
      expect(row?.band).toBe(band);
    });
  }
});

// RA.1 — the sighting mirror. The ingest is `POST /harvest/passive`'s twin, so
// the assertions here are its counterparts: the throttle, the batch dedup, the
// per-UTC-day cap on NEW rows, the lazy prune, and honest `skipped*` counts. The
// two that are NOT shared with the passive twin get the most attention: this
// table upserts one row per tweet (so `updated` is a real outcome, not a second
// row), and a BAND CHANGE punches through the recapture window.
describe('POST /radar/sightings (RA.1)', () => {
  // A separate 992-prefixed block so the drafts seeded above can't collide, and
  // a 9925-prefixed one for the cap test's bulk rows (deleted by prefix).
  const S_NEW = '992000000000000001';
  const S_THROTTLE = '992000000000000002';
  const S_BAND = '992000000000000003';
  const S_STALE = '992000000000000004'; // 61 days old — must be pruned
  const S_FRESH = '992000000000000005'; // sighted today — must survive
  const S_DEDUP = '992000000000000006';
  const S_REJECT = '992000000000000007';
  const S_AGED = '992000000000000008'; // stored outside the throttle window
  const S_CAP = '992000000000000009';
  const BULK_PREFIX = '9925';
  const S_IDS = [S_NEW, S_THROTTLE, S_BAND, S_STALE, S_FRESH, S_DEDUP, S_REJECT, S_AGED, S_CAP];

  interface IngestResult {
    inserted: number;
    updated: number;
    skippedRecent: number;
    skippedCap: number;
  }

  function wire(tweetId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      tweetId,
      url: `https://x.com/ra_alice/status/${tweetId}`,
      handle: 'ra_alice',
      author: 'RA Alice',
      text: 'a swept tweet',
      band: 'sweep',
      views: 900,
      replies: 3,
      likes: 5,
      bait: false,
      verified: true,
      ageMin: 12,
      sourcePath: '/home',
      ...over,
    };
  }

  const post = (rows: unknown[]) => send<IngestResult>('/x/radar/sightings', 'POST', { rows });

  async function rowOf(tweetId: string) {
    const [row] = await db.select().from(radarSightings).where(eq(radarSightings.tweetId, tweetId));
    return row;
  }

  async function wipe(): Promise<void> {
    await db.delete(radarSightings).where(inArray(radarSightings.tweetId, S_IDS));
    await db.delete(radarSightings).where(like(radarSightings.tweetId, `${BULK_PREFIX}%`));
  }

  beforeAll(wipe);
  afterAll(wipe);

  test('a new sighting inserts with everything the page read', async () => {
    const { status, body } = await post([wire(S_NEW)]);
    expect(status).toBe(201);
    expect(body).toEqual({ inserted: 1, updated: 0, skippedRecent: 0, skippedCap: 0 });

    const row = await rowOf(S_NEW);
    expect(row?.handle).toBe('ra_alice');
    expect(row?.band).toBe('sweep');
    expect(row?.views).toBe(900);
    expect(row?.verified).toBe(true);
    expect(row?.sourcePath).toBe('/home');
    expect(row?.seenCount).toBe(1);
    // posted_at is derived from seenAt − ageMin, which is what keeps the confirm
    // route's `draftedAt − ageMin` landing on the true post time hours later.
    const gap = (row?.lastSeenAt.getTime() ?? 0) - (row?.postedAt?.getTime() ?? 0);
    expect(gap).toBe(12 * 60_000);
  });

  test('a re-sighting inside the window is the same sighting, not a new one', async () => {
    expect((await post([wire(S_THROTTLE)])).body.inserted).toBe(1);
    const { body } = await post([wire(S_THROTTLE, { views: 4000 })]);
    expect(body).toEqual({ inserted: 0, updated: 0, skippedRecent: 1, skippedCap: 0 });
    // The throttled read is dropped whole — including its metrics.
    const row = await rowOf(S_THROTTLE);
    expect(row?.views).toBe(900);
    expect(row?.seenCount).toBe(1);
  });

  test('a BAND change punches through the recapture window', async () => {
    expect((await post([wire(S_BAND, { band: 'roster' })])).body.inserted).toBe(1);
    const { body } = await post([wire(S_BAND, { band: 'sweep', views: 2100 })]);
    expect(body.updated).toBe(1);
    expect(body.skippedRecent).toBe(0);

    const row = await rowOf(S_BAND);
    // roster → sweep is an upgrade, and the fresher metrics ride in with it.
    expect(row?.band).toBe('sweep');
    expect(row?.views).toBe(2100);
    expect(row?.seenCount).toBe(2);
  });

  test('a sighting past the window updates the stored row in place', async () => {
    const old = new Date(Date.now() - 10 * 60_000);
    await db.insert(radarSightings).values({
      tweetId: S_AGED,
      handle: 'ra_bob',
      text: 'first capture',
      band: 'sweep',
      views: 100,
      replies: 1,
      likes: null,
      bait: false,
      verified: null,
      postedAt: old,
      sourcePath: null,
      firstSeenAt: old,
      lastSeenAt: old,
      seenCount: 1,
    });

    const { body } = await post([
      wire(S_AGED, { handle: 'ra_bob', views: 5000, replies: 9, likes: 40, sourcePath: '/search' }),
    ]);
    expect(body).toEqual({ inserted: 0, updated: 1, skippedRecent: 0, skippedCap: 0 });

    const row = await rowOf(S_AGED);
    expect(row?.views).toBe(5000);
    expect(row?.likes).toBe(40);
    expect(row?.seenCount).toBe(2);
    // Fill-only: the row learns what it didn't know...
    expect(row?.verified).toBe(true);
    expect(row?.sourcePath).toBe('/search');
    // ...but where it FIRST entered the queue never moves.
    expect(row?.firstSeenAt.getTime()).toBe(old.getTime());
    expect(row?.postedAt?.getTime()).toBe(old.getTime());
  });

  test('the same tweet twice in one batch is one sighting', async () => {
    const { body } = await post([wire(S_DEDUP, { views: 100 }), wire(S_DEDUP, { views: 700 })]);
    expect(body).toEqual({ inserted: 1, updated: 0, skippedRecent: 1, skippedCap: 0 });
    // The LAST copy wins — it is the fresher read of the same card.
    expect((await rowOf(S_DEDUP))?.views).toBe(700);
  });

  test('a bad row 400s with its index and lands nothing', async () => {
    const { status, body } = await send<{ error: string; index: number }>(
      '/x/radar/sightings',
      'POST',
      { rows: [wire(S_REJECT), wire(S_REJECT, { tweetId: 'nope' })] },
    );
    expect(status).toBe(400);
    expect(body.error).toBe('tweetId_invalid');
    expect(body.index).toBe(1);
    // Parse-all-then-write: the VALID row in front of it was not written either.
    expect(await rowOf(S_REJECT)).toBeUndefined();
  });

  test('an oversized batch is refused whole', async () => {
    const rows = Array.from({ length: 101 }, (_, i) => wire(`9924${String(i).padStart(14, '0')}`));
    const { status, body } = await send<{ error: string; max: number }>(
      '/x/radar/sightings',
      'POST',
      { rows },
    );
    expect(status).toBe(400);
    expect(body.error).toBe('too_many_rows');
    expect(body.max).toBe(100);
    const written = await db
      .select()
      .from(radarSightings)
      .where(like(radarSightings.tweetId, '9924%'));
    expect(written.length).toBe(0);
  });

  test('an empty or malformed body is refused', async () => {
    expect((await send<{ error: string }>('/x/radar/sightings', 'POST', {})).body.error).toBe(
      'rows_required',
    );
    expect((await post([])).body).toEqual({ error: 'rows_required' } as never);
    expect((await send<{ error: string }>('/x/radar/sightings', 'POST', [1, 2])).body.error).toBe(
      'invalid_body',
    );
  });

  test('the ingest path prunes what aged out and keeps what did not', async () => {
    const stale = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000);
    const fresh = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await db.insert(radarSightings).values([
      {
        tweetId: S_STALE,
        handle: 'ra_old',
        text: 'sighted two months ago',
        band: 'sweep',
        views: 10,
        replies: 0,
        likes: null,
        bait: false,
        verified: null,
        postedAt: stale,
        sourcePath: null,
        firstSeenAt: stale,
        lastSeenAt: stale,
        seenCount: 1,
      },
      {
        tweetId: S_FRESH,
        handle: 'ra_new',
        text: 'sighted this week',
        band: 'sweep',
        views: 10,
        replies: 0,
        likes: null,
        bait: false,
        verified: null,
        postedAt: fresh,
        sourcePath: null,
        firstSeenAt: fresh,
        lastSeenAt: fresh,
        seenCount: 1,
      },
    ]);

    // Retention is lazy — it only runs because a new batch arrived.
    expect((await post([wire(S_CAP)])).body.inserted).toBe(1);
    expect(await rowOf(S_STALE)).toBeUndefined();
    expect(await rowOf(S_FRESH)).toBeDefined();
  });

  // Runs LAST on purpose: it fills today's quota, so any insert asserted after
  // it would be capped for reasons that have nothing to do with the test.
  test('new rows are capped per UTC day; re-sightings are not', async () => {
    const now = new Date();
    const bulk = Array.from({ length: 2000 }, (_, i) => ({
      tweetId: `${BULK_PREFIX}${String(i).padStart(14, '0')}`,
      handle: 'ra_bulk',
      text: 'quota filler',
      band: 'sweep',
      views: 1,
      replies: 0,
      likes: null,
      bait: false,
      verified: null,
      postedAt: now,
      sourcePath: null,
      firstSeenAt: now,
      lastSeenAt: now,
      seenCount: 1,
    }));
    // Chunked: 2,000 × 16 columns would sit on SQLite's bound-parameter ceiling.
    for (let i = 0; i < bulk.length; i += 250) {
      await db.insert(radarSightings).values(bulk.slice(i, i + 250));
    }

    const { body } = await post([wire('992000000000000099')]);
    expect(body).toEqual({ inserted: 0, updated: 0, skippedRecent: 0, skippedCap: 1 });

    // An UPDATE still lands — capping re-sightings would freeze the corpus at
    // whatever a busy morning happened to write first.
    const capped = await post([
      wire(`${BULK_PREFIX}00000000000000`, { handle: 'ra_bulk', views: 55, band: 'manual' }),
    ]);
    expect(capped.body.updated).toBe(1);
    expect(capped.body.skippedCap).toBe(0);
  });
});

// RA.3 — the corpus read. The route's whole job is to answer questions the
// table has no columns for (`admitted`, `vpm`, `worked`, `stage`), so almost
// every assertion below is about a derived field. Its own 993-prefixed ids and
// `ra3*` handles keep it isolated from the ingest block above and from every
// other suite sharing the in-memory DB.
describe('GET /radar/sightings (RA.3)', () => {
  const G_ADMIT = '993000000000000001'; // admitted, untouched — the finding
  const G_WORKED = '993000000000000002'; // has an EXPIRED radar draft
  const G_REPLIED = '993000000000000003'; // has a POSTED reply
  const G_FILTERED = '993000000000000004'; // too few views for the sweep
  const G_OLD = '993000000000000005'; // last seen 40 days ago
  const G_BOB = '993000000000000006'; // a second author
  const G_IDS = [G_ADMIT, G_WORKED, G_REPLIED, G_FILTERED, G_OLD, G_BOB];

  const MIN = 60_000;
  const ALICE = 'ra3alice';
  const BOB = 'ra3bob';

  interface ViewRow {
    tweetId: string;
    handle: string;
    band: string;
    views: number;
    vpm: number | null;
    ageMinAtLastSeen: number | null;
    admitted: boolean | null;
    drafted: boolean;
    replied: boolean;
    worked: boolean;
    stage: string | null;
    isTarget: boolean;
    sourcePath: string | null;
  }
  interface ListBody {
    days: number;
    order: string;
    sweep: Record<string, number | boolean>;
    scanned: number;
    truncated: boolean;
    count: number;
    summary: {
      total: number;
      admitted: number;
      worked: number;
      unworkedAdmitted: number;
      byBand: Record<string, number>;
      bySourcePath: Record<string, number>;
      topHandles: { handle: string; sightings: number }[];
    };
    sightings: ViewRow[];
  }

  // Every fixture is placed relative to one `now` so the ages below are exact.
  const now = Date.now();
  const sighting = (
    tweetId: string,
    over: {
      handle?: string;
      band?: string;
      views?: number;
      lastSeenMinAgo: number;
      ageMin: number;
      sourcePath?: string | null;
    },
  ) => {
    const lastSeen = new Date(now - over.lastSeenMinAgo * MIN);
    return {
      tweetId,
      url: `https://x.com/${over.handle ?? ALICE}/status/${tweetId}`,
      handle: over.handle ?? ALICE,
      author: 'RA3 Author',
      text: 'a swept tweet',
      band: over.band ?? 'sweep',
      views: over.views ?? 900,
      replies: 3,
      likes: 5,
      bait: false,
      verified: true,
      postedAt: new Date(lastSeen.getTime() - over.ageMin * MIN),
      sourcePath: over.sourcePath === undefined ? '/home' : over.sourcePath,
      firstSeenAt: lastSeen,
      lastSeenAt: lastSeen,
      seenCount: 1,
    };
  };

  const list = (q: string) => send<ListBody>(`/x/radar/sightings${q}`, 'GET');
  const ids = (b: ListBody) => b.sightings.map((s) => s.tweetId);
  const rowOf = (b: ListBody, tweetId: string) => b.sightings.find((s) => s.tweetId === tweetId);

  async function wipe(): Promise<void> {
    await db.delete(replyDrafts).where(inArray(replyDrafts.sourceTweetId, G_IDS));
    await db.delete(radarDrafts).where(inArray(radarDrafts.tweetId, G_IDS));
    await db.delete(radarSightings).where(inArray(radarSightings.tweetId, G_IDS));
    await db.delete(people).where(inArray(people.handle, [ALICE, BOB]));
  }

  beforeAll(async () => {
    await wipe();
    await db.insert(radarSightings).values([
      // vpm 900/10 = 90; views 900; last seen 10m ago.
      sighting(G_ADMIT, { lastSeenMinAgo: 10, ageMin: 10 }),
      // vpm 1200/10 = 120 — the vpm AND views leader.
      sighting(G_WORKED, { views: 1200, lastSeenMinAgo: 40, ageMin: 10 }),
      // vpm 600/30 = 20 — third by views, LAST by vpm.
      sighting(G_REPLIED, { views: 600, band: 'manual', lastSeenMinAgo: 20, ageMin: 30 }),
      // vpm 50/1 = 50 — last by views, third by vpm. Below the 300-view floor.
      sighting(G_FILTERED, {
        views: 50,
        band: 'roster',
        lastSeenMinAgo: 30,
        ageMin: 1,
        sourcePath: '/search',
      }),
      sighting(G_OLD, { lastSeenMinAgo: 40 * 24 * 60, ageMin: 15 }),
      sighting(G_BOB, { handle: BOB, views: 800, lastSeenMinAgo: 15, ageMin: 20 }),
    ]);

    // `worked` is any draft status — an expired one still means I worked it.
    await db.insert(radarDrafts).values({
      tweetId: G_WORKED,
      handle: ALICE,
      snippet: 'a swept tweet',
      replyText: 'a reply I drafted and let rot',
      angle: 'extends',
      status: 'expired',
      draftedAt: new Date(now - 100 * 60 * MIN),
    });

    await db.insert(replyDrafts).values([
      {
        sourceTweetId: G_REPLIED,
        sourceAuthorUsername: ALICE,
        sourceText: 'a swept tweet',
        sourceUrl: `https://x.com/${ALICE}/status/${G_REPLIED}`,
        contextSnapshot: {},
        replyText: 'the reply I actually pasted',
        model: 'grok-4.3',
        source: 'radar',
        status: 'posted',
      },
      // Copied is NOT posted: a draft that never reached anyone is not a reply.
      {
        sourceTweetId: G_ADMIT,
        sourceAuthorUsername: ALICE,
        sourceText: 'a swept tweet',
        sourceUrl: `https://x.com/${ALICE}/status/${G_ADMIT}`,
        contextSnapshot: {},
        replyText: 'never pasted',
        model: 'grok-4.3',
        source: 'radar',
        status: 'copied',
      },
    ]);

    await db.insert(people).values({ handle: ALICE, stage: 'engaged' });
  });

  afterAll(wipe);

  test('returns the read-time answers and echoes the config it judged with', async () => {
    const { status, body } = await list(`?handle=${ALICE}&days=7`);
    expect(status).toBe(200);
    expect(body.days).toBe(7);
    expect(body.order).toBe('vpm');
    expect(body.truncated).toBe(false);
    // The echo is what makes "why did this row stop being admitted?" answerable.
    expect(body.sweep).toEqual(sweepConfigFromSettings() as unknown as typeof body.sweep);

    expect(body.count).toBe(4); // G_OLD is outside the window, G_BOB is another author
    const admit = rowOf(body, G_ADMIT);
    expect(admit).toMatchObject({
      ageMinAtLastSeen: 10,
      vpm: 90,
      admitted: true,
      drafted: false,
      // The `copied` reply draft above must not read as a posted one.
      replied: false,
      worked: false,
      stage: 'engaged',
      isTarget: false,
      sourcePath: '/home',
    });
    // An EXPIRED radar draft still counts as worked.
    expect(rowOf(body, G_WORKED)).toMatchObject({ drafted: true, replied: false, worked: true });
    expect(rowOf(body, G_REPLIED)).toMatchObject({ drafted: false, replied: true, worked: true });
    expect(rowOf(body, G_FILTERED)?.admitted).toBe(false);
  });

  test('the summary counts the whole filtered set, never a rate', async () => {
    const { body } = await list(`?handle=${ALICE}&days=7`);
    expect(body.summary).toMatchObject({
      total: 4,
      admitted: 3,
      worked: 2,
      // Admitted and untouched: exactly G_ADMIT. The finding.
      unworkedAdmitted: 1,
      byBand: { sweep: 2, manual: 1, roster: 1 },
      bySourcePath: { '/home': 3, '/search': 1 },
      topHandles: [{ handle: ALICE, sightings: 4 }],
    });
  });

  test('the window is on last-seen: 7 days hides the 40-day-old row, 60 shows it', async () => {
    expect(ids((await list(`?handle=${ALICE}&days=7`)).body)).not.toContain(G_OLD);
    const wide = await list(`?handle=${ALICE}&days=60`);
    expect(ids(wide.body)).toContain(G_OLD);
    // Above the retention window is a clamp, not an error.
    const clamped = await list(`?handle=${ALICE}&days=999`);
    expect(clamped.body.days).toBe(60);
  });

  test('band and handle narrow the set', async () => {
    const manual = await list(`?handle=${ALICE}&band=manual`);
    expect(ids(manual.body)).toEqual([G_REPLIED]);
    const bob = await list(`?handle=@${BOB}`);
    expect(ids(bob.body)).toEqual([G_BOB]);
    // The people layer knows alice, not bob.
    expect(bob.body.sightings[0]?.stage).toBeNull();
  });

  test('admitted and worked filter independently', async () => {
    const finding = await list(`?handle=${ALICE}&admitted=true&worked=false`);
    expect(ids(finding.body)).toEqual([G_ADMIT]);
    expect(finding.body.summary.total).toBe(1);

    expect(ids((await list(`?handle=${ALICE}&worked=true`)).body).sort()).toEqual(
      [G_REPLIED, G_WORKED].sort(),
    );
    expect(ids((await list(`?handle=${ALICE}&admitted=false`)).body)).toEqual([G_FILTERED]);
  });

  // The reason `sweep` is echoed at all: the same stored rows answer differently
  // after a preset change, and that has to read as a config change rather than
  // as data rot.
  test('admitted follows the live sweep settings', async () => {
    const before = await list(`?handle=${ALICE}&admitted=true`);
    expect(before.body.count).toBe(3);

    try {
      setSettings({ 'x.sweep.minViews': 1000 });
      const after = await list(`?handle=${ALICE}&admitted=true`);
      // Only the 1200-view row still clears the floor.
      expect(ids(after.body)).toEqual([G_WORKED]);
      expect(after.body.sweep.minViews).toBe(1000);
    } finally {
      resetSettings({ keys: ['x.sweep.minViews'] });
    }

    expect((await list(`?handle=${ALICE}&admitted=true`)).body.count).toBe(3);
  });

  test('order picks a genuinely different ranking each time', async () => {
    expect(ids((await list(`?handle=${ALICE}&days=7`)).body)).toEqual([
      G_WORKED, // 120 vpm
      G_ADMIT, // 90
      G_FILTERED, // 50
      G_REPLIED, // 20
    ]);
    expect(ids((await list(`?handle=${ALICE}&days=7&order=views`)).body)).toEqual([
      G_WORKED, // 1200
      G_ADMIT, // 900
      G_REPLIED, // 600
      G_FILTERED, // 50
    ]);
    expect(ids((await list(`?handle=${ALICE}&days=7&order=lastSeen`)).body)).toEqual([
      G_ADMIT, // 10m ago
      G_REPLIED, // 20m
      G_FILTERED, // 30m
      G_WORKED, // 40m
    ]);
  });

  test('limit slices the list but not the summary', async () => {
    const { body } = await list(`?handle=${ALICE}&days=7&limit=1`);
    expect(body.count).toBe(1);
    expect(ids(body)).toEqual([G_WORKED]);
    // `count < summary.total` is what tells a caller the LIST was truncated and
    // the ANSWER was not.
    expect(body.summary.total).toBe(4);
    // Above the ceiling is a clamp, not an error.
    expect((await list(`?handle=${ALICE}&limit=9999`)).status).toBe(200);
  });

  test('every parameter has its own 400', async () => {
    const bad = async (q: string) =>
      (await send<{ error: string }>(`/x/radar/sightings${q}`, 'GET')).body.error;
    expect(await bad('?days=0')).toBe('invalid_days');
    expect(await bad('?days=abc')).toBe('invalid_days');
    expect(await bad('?limit=0')).toBe('invalid_limit');
    expect(await bad('?band=hot')).toBe('invalid_band');
    expect(await bad('?handle=not a handle')).toBe('invalid_handle');
    expect(await bad('?order=random')).toBe('invalid_order');
    // Stricter than the repo's `=== 'true'` flags on purpose: a fat-fingered
    // filter must not hand back a full list the caller believes is filtered.
    expect(await bad('?admitted=1')).toBe('invalid_admitted');
    expect(await bad('?worked=yes')).toBe('invalid_worked');
  });
});

describe('GET /radar/sightings/:tweetId (RA.3)', () => {
  const D_TWEET = '993100000000000001';
  const D_UNKNOWN = '993199999999999999';
  const D_HANDLE = 'ra3carol';

  interface DetailBody {
    sweep: Record<string, number | boolean>;
    sighting: { tweetId: string; admitted: boolean | null; vpm: number | null; worked: boolean };
    drafts: { tweetId: string; status: string; angle: string; model: string | null }[];
    replies: { id: string; replyText: string; status: string; model: string }[];
  }

  async function wipe(): Promise<void> {
    await db.delete(replyDrafts).where(eq(replyDrafts.sourceTweetId, D_TWEET));
    await db.delete(radarDrafts).where(eq(radarDrafts.tweetId, D_TWEET));
    await db.delete(radarSightings).where(eq(radarSightings.tweetId, D_TWEET));
  }

  beforeAll(async () => {
    await wipe();
    const lastSeen = new Date(Date.now() - 5 * 60_000);
    await db.insert(radarSightings).values({
      tweetId: D_TWEET,
      url: `https://x.com/${D_HANDLE}/status/${D_TWEET}`,
      handle: D_HANDLE,
      author: 'RA3 Carol',
      text: 'the tweet I want the whole history of',
      band: 'sweep',
      views: 1000,
      replies: 4,
      likes: 6,
      bait: false,
      verified: true,
      postedAt: new Date(lastSeen.getTime() - 20 * 60_000),
      sourcePath: '/home',
      firstSeenAt: lastSeen,
      lastSeenAt: lastSeen,
      seenCount: 3,
    });
    // Deliberately older than any TTL: the read must not expire it (below).
    await db.insert(radarDrafts).values({
      tweetId: D_TWEET,
      handle: D_HANDLE,
      snippet: 'the tweet I want the whole history of',
      replyText: 'draft one',
      angle: 'extends',
      variants: [{ text: 'draft one', angle: 'extends' }],
      model: 'grok-4.3',
      status: 'ready',
      draftedAt: new Date(Date.now() - 100 * 60 * 60 * 1000),
    });
    await db.insert(replyDrafts).values({
      sourceTweetId: D_TWEET,
      sourceAuthorUsername: D_HANDLE,
      sourceText: 'the tweet I want the whole history of',
      sourceUrl: `https://x.com/${D_HANDLE}/status/${D_TWEET}`,
      contextSnapshot: { big: 'blob' },
      replyText: 'the one I pasted',
      model: 'grok-4.3',
      source: 'radar',
      status: 'posted',
    });
  });

  afterAll(wipe);

  test('one call answers "did I already answer this, and with what"', async () => {
    const { status, body } = await send<DetailBody>(`/x/radar/sightings/${D_TWEET}`, 'GET');
    expect(status).toBe(200);
    expect(body.sighting.tweetId).toBe(D_TWEET);
    expect(body.sighting.vpm).toBe(50); // 1000 views / 20 min
    expect(body.sighting.admitted).toBe(true);
    expect(body.sighting.worked).toBe(true);
    expect(body.sweep).toEqual(sweepConfigFromSettings() as unknown as typeof body.sweep);

    expect(body.drafts).toHaveLength(1);
    expect(body.drafts[0]?.angle).toBe('extends');
    expect(body.replies).toHaveLength(1);
    expect(body.replies[0]?.replyText).toBe('the one I pasted');
    // The projection: the whole rendered prompt context would dwarf everything
    // else in an agent's window and the drafts already carry the variants.
    expect(body.replies[0]).not.toHaveProperty('contextSnapshot');
  });

  // Both sighting reads are pure SELECTs, which is what makes them safe to page.
  // GET /radar/drafts flips stale ready rows to expired on the way; this one
  // must not, or an agent browsing the corpus advances the panel's queue.
  test('reading writes nothing — a 100h-old ready draft stays ready', async () => {
    await send<DetailBody>(`/x/radar/sightings/${D_TWEET}`, 'GET');
    await send(`/x/radar/sightings?handle=${D_HANDLE}`, 'GET');
    const [row] = await db.select().from(radarDrafts).where(eq(radarDrafts.tweetId, D_TWEET));
    expect(row?.status).toBe('ready');
  });

  test('a malformed id is a 400 and an unknown one is a 404', async () => {
    const bad = await send<{ error: string }>('/x/radar/sightings/not-an-id', 'GET');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_tweet_id');

    const missing = await send<{ error: string }>(`/x/radar/sightings/${D_UNKNOWN}`, 'GET');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('not_found');
  });
});

// RA.4 — a Claude Code session writes into the queue. The two assertions that
// matter aren't the 201: a draft with a null `band` or null `signals` is dropped
// by `draftRowToSighting` on rehydrate (D186), so the feature would ship
// invisible with every test green; and `signals.ageMin` is recomputed at COMPOSE
// time, which is what keeps the confirm route's `draftedAt − ageMin` landing on
// the real post time hours after the capture.
describe('POST /radar/drafts/compose (RA.4)', () => {
  const C_BASE = '994000000000000001'; // the happy path + the two-writer race
  const C_AGE = '994000000000000002'; // posted 2h ago, last seen 30m ago
  const C_SELFNAME = '994000000000000003'; // author === handle, legacy band
  const C_UNKNOWN = '994999999999999999'; // no sighting — 404
  const C_IDS = [C_BASE, C_AGE, C_SELFNAME, C_UNKNOWN];
  const C_HANDLE = 'ra4dana';

  const MIN = 60_000;

  interface DraftBody {
    id: string;
    tweetId: string;
    url: string | null;
    handle: string;
    author: string | null;
    snippet: string;
    band: string | null;
    signals: { views: number; replies: number; ageMin: number; vpm: number; bait: boolean } | null;
    replyText: string;
    angle: string;
    variants: { text: string; angle: string }[] | null;
    model: string | null;
    curationScore: number | null;
    status: string;
  }

  const compose = (body: unknown) =>
    send<DraftBody & { error?: string; allowed?: string[] }>(
      '/x/radar/drafts/compose',
      'POST',
      body,
    );

  const PRIMARY = 'the part nobody says out loud is the migration';
  const V2 = [
    { text: PRIMARY, angle: 'extends' },
    { text: 'this only holds under 10k rows', angle: 'contrarian' },
  ];

  async function wipe(): Promise<void> {
    await db.delete(replyDrafts).where(inArray(replyDrafts.sourceTweetId, C_IDS));
    await db.delete(radarDrafts).where(inArray(radarDrafts.tweetId, C_IDS));
    await db.delete(radarSightings).where(inArray(radarSightings.tweetId, C_IDS));
  }

  beforeAll(async () => {
    await wipe();
    const seen = new Date(Date.now() - 10 * MIN);
    await db.insert(radarSightings).values([
      {
        tweetId: C_BASE,
        url: `https://x.com/${C_HANDLE}/status/${C_BASE}`,
        handle: C_HANDLE,
        author: 'RA4 Dana',
        text: 'a swept tweet worth answering',
        band: 'sweep',
        views: 1200,
        replies: 4,
        likes: 9,
        bait: false,
        verified: true,
        postedAt: new Date(seen.getTime() - 20 * MIN),
        sourcePath: '/search',
        firstSeenAt: seen,
        lastSeenAt: seen,
        seenCount: 2,
      },
      {
        // Last seen 30m ago but posted 2h ago: the two ages differ, so a route
        // stamping the stored last-seen age instead of recomputing shows up.
        tweetId: C_AGE,
        url: `https://x.com/${C_HANDLE}/status/${C_AGE}`,
        handle: C_HANDLE,
        author: 'RA4 Dana',
        text: 'a tweet I got round to hours later',
        band: 'manual',
        views: 600,
        replies: 2,
        likes: 3,
        bait: true,
        verified: null,
        postedAt: new Date(Date.now() - 120 * MIN),
        sourcePath: '/home',
        firstSeenAt: new Date(Date.now() - 30 * MIN),
        lastSeenAt: new Date(Date.now() - 30 * MIN),
        seenCount: 1,
      },
      {
        // No display name distinct from the handle, and a band written by a
        // build older than RS.2 — both are folds, not refusals.
        tweetId: C_SELFNAME,
        url: null,
        handle: C_HANDLE,
        author: C_HANDLE,
        text: 'a tweet from a hand-edited row',
        band: 'hot',
        views: 300,
        replies: 1,
        likes: null,
        bait: false,
        verified: false,
        postedAt: new Date(Date.now() - 15 * MIN),
        sourcePath: null,
        firstSeenAt: seen,
        lastSeenAt: seen,
        seenCount: 1,
      },
    ]);
  });

  afterAll(wipe);

  test('stamps band + signals from the sighting and lands a ready draft', async () => {
    const { status, body } = await compose({ tweetId: C_BASE, variants: V2 });
    expect(status).toBe(201);

    // THE rehydrate contract (D186): either of these null and the panel silently
    // shows nothing, with every other assertion here still green.
    expect(body.band).toBe('sweep');
    expect(body.signals).not.toBeNull();
    expect(body.signals?.views).toBe(1200);
    expect(body.signals?.replies).toBe(4);
    expect(body.signals?.bait).toBe(false);

    expect(body.model).toBe('claude-code-mcp');
    expect(body.status).toBe('ready');
    expect(body.curationScore).toBeNull();
    expect(body.variants).toHaveLength(2);
    // The primary is variants[0], the same rule the batch path uses.
    expect(body.replyText).toBe(PRIMARY);
    expect(body.angle).toBe('extends');
    // Straight off the sighting, never from the caller (§7.16).
    expect(body.handle).toBe(C_HANDLE);
    expect(body.author).toBe('RA4 Dana');
    expect(body.snippet).toBe('a swept tweet worth answering');
    expect(body.url).toBe(`https://x.com/${C_HANDLE}/status/${C_BASE}`);

    // And it is visible through the route the panel actually rehydrates from —
    // asserting only the 201 would pass on a row the Radar never shows.
    const queue = await send<{ count: number; drafts: DraftBody[] }>(
      `/x/radar/drafts?tweetId=${C_BASE}&status=ready`,
      'GET',
    );
    expect(queue.status).toBe(200);
    expect(queue.body.count).toBe(1);
    expect(queue.body.drafts[0]?.band).toBe('sweep');
    expect(queue.body.drafts[0]?.signals).not.toBeNull();
  });

  test('a display name equal to the handle is not a display name; a legacy band folds', async () => {
    const { status, body } = await compose({
      tweetId: C_SELFNAME,
      variants: [{ text: 'one variant is enough', angle: 'question' }],
    });
    expect(status).toBe(201);
    expect(body.author).toBeNull();
    expect(body.url).toBeNull();
    // 'hot' is a dead classifier verdict — folded, not refused, and never null
    // (a null band is the invisible-draft case).
    expect(body.band).toBe('sweep');
  });

  test('ageMin is recomputed at compose time, and confirm lands on the true post time', async () => {
    const postedAtMs = Date.now() - 120 * MIN;
    const { status, body } = await compose({
      tweetId: C_AGE,
      variants: [{ text: 'late but still worth saying', angle: 'observation' }],
    });
    expect(status).toBe(201);
    // ~120, NOT the 30 minutes the row had when the queue last saw it.
    expect(body.signals?.ageMin).toBeGreaterThanOrEqual(119);
    expect(body.signals?.ageMin).toBeLessThanOrEqual(121);
    expect(body.signals?.vpm).toBeCloseTo(5, 1); // 600 views / ~120 min
    expect(body.signals?.bait).toBe(true);

    // The whole point of recomputing: confirm derives the post time back out as
    // draftedAt − ageMin, and it has to land where the post actually went up.
    const confirmed = await send<{ sourcePostedAt: string; model: string; source: string }>(
      `/x/radar/drafts/${C_AGE}/confirm`,
      'POST',
    );
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.source).toBe('radar');
    expect(confirmed.body.model).toBe('claude-code-mcp');
    expect(Math.abs(Date.parse(confirmed.body.sourcePostedAt) - postedAtMs)).toBeLessThan(60_000);
  });

  test('composing again expires the previous draft — one ready row per tweet', async () => {
    const second = await compose({
      tweetId: C_BASE,
      variants: [{ text: 'a better second pass', angle: 'debate' }],
    });
    expect(second.status).toBe(201);

    const rows = await db.select().from(radarDrafts).where(eq(radarDrafts.tweetId, C_BASE));
    expect(rows).toHaveLength(2);
    const ready = rows.filter((r) => r.status === 'ready');
    expect(ready).toHaveLength(1);
    expect(ready[0]?.id).toBe(second.body.id);
    expect(rows.filter((r) => r.status === 'expired')).toHaveLength(1);
  });

  test('an unknown tweet is a 404 — a composed draft is anchored to a real capture', async () => {
    const { status, body } = await compose({ tweetId: C_UNKNOWN, variants: V2 });
    expect(status).toBe(404);
    expect(body.error).toBe('sighting_not_found');
    const rows = await db.select().from(radarDrafts).where(eq(radarDrafts.tweetId, C_UNKNOWN));
    expect(rows).toHaveLength(0);
  });

  test('every refusal has its own code, and none of them writes', async () => {
    const before = await db.select().from(radarDrafts).where(eq(radarDrafts.tweetId, C_SELFNAME));

    const bad = await compose('not an object');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_body');

    const badId = await compose({ tweetId: 'not-an-id', variants: V2 });
    expect(badId.status).toBe(400);
    expect(badId.body.error).toBe('invalid_tweet_id');

    const none = await compose({ tweetId: C_SELFNAME, variants: [] });
    expect(none.status).toBe(400);
    expect(none.body.error).toBe('invalid_variants');

    const four = await compose({
      tweetId: C_SELFNAME,
      variants: [...V2, ...V2].map((v) => ({ ...v })),
    });
    expect(four.status).toBe(400);
    expect(four.body.error).toBe('invalid_variants');

    const blank = await compose({
      tweetId: C_SELFNAME,
      variants: [{ text: '   ', angle: 'extends' }],
    });
    expect(blank.status).toBe(400);
    expect(blank.body.error).toBe('invalid_variants');

    const long = await compose({
      tweetId: C_SELFNAME,
      variants: [{ text: 'x'.repeat(501), angle: 'extends' }],
    });
    expect(long.status).toBe(400);
    expect(long.body.error).toBe('reply_too_long');

    const angle = await compose({
      tweetId: C_SELFNAME,
      variants: [{ text: 'a fine reply', angle: 'snark' }],
    });
    expect(angle.status).toBe(400);
    expect(angle.body.error).toBe('invalid_angle');
    // The refusal names the vocabulary, so a caller can fix it in one round trip.
    expect(angle.body.allowed).toContain('contrarian');

    // Refuse before write (§7.4): the id was valid on most of those and none of
    // them may have touched the tweet's queue.
    const after = await db.select().from(radarDrafts).where(eq(radarDrafts.tweetId, C_SELFNAME));
    expect(after).toHaveLength(before.length);
  });

  test('a 500-char reply is stored, not clamped (decision 7)', async () => {
    const text = 'y'.repeat(500);
    const { status, body } = await compose({
      tweetId: C_SELFNAME,
      variants: [{ text, angle: 'network' }],
    });
    expect(status).toBe(201);
    expect(body.replyText).toHaveLength(500);
  });
});
