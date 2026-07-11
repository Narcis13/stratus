// C4 Playbook route over the real (in-memory, auto-migrated) SQLite DB — the
// aggregation math lives in ../playbook.test.ts; this checks the route wiring:
// the joins land in the right stats, the minN knob, the guidance loaders, and
// the C4 prompt-tail injection.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  accountSnapshots,
  metricsSnapshots,
  people,
  postTemplates,
  postsPublished,
  radarDrafts,
  replyDrafts,
  scheduledPosts,
} from '../db/schema.ts';
import { buildPostDraftInput } from '../posts/prompt.ts';
import { buildBatchGrokInput, buildGrokInput } from '../replies/prompt.ts';
import { loadPostGuidance, loadReplyGuidance, loadRosterCoverage, playbook } from './playbook.ts';

const app = new Hono();
app.route('/x', playbook);

const NOW = Date.now();
const at = (min: number): Date => new Date(NOW - min * 60_000);

async function seedReply(opts: {
  id: string;
  angle: 'extends' | 'contrarian' | 'debate';
  postedTweetId: string;
  views: number;
  profileVisits: number;
  handle?: string;
  relationship?: string;
}): Promise<void> {
  const replyText = `reply ${opts.id}`;
  await db
    .insert(replyDrafts)
    .values({
      id: opts.id,
      sourceTweetId: '4242',
      sourceAuthorUsername: opts.handle ?? 'pb_author',
      sourceText: 'What is your take?',
      sourceUrl: 'https://x.com/pb_author/status/4242',
      sourcePostedAt: at(600),
      contextSnapshot: {
        signals: { band: 'hot', views: 5000, replies: 4, ageMin: 12, vpm: 400, bait: true },
        metrics: { views: 5000, replies: 4, reposts: 1, likes: 20 },
        ...(opts.relationship ? { relationship: opts.relationship } : {}),
      },
      replyText,
      variants: [{ text: replyText, angle: opts.angle }],
      model: 'test',
      status: 'posted',
      postedTweetId: opts.postedTweetId,
      createdAt: at(500),
    })
    .onConflictDoNothing();
  await db
    .insert(postsPublished)
    .values({
      tweetId: opts.postedTweetId,
      text: replyText,
      postedAt: at(490),
      isReply: true,
      inReplyToTweetId: '4242',
      source: 'test',
    })
    .onConflictDoNothing();
  await db.insert(metricsSnapshots).values({
    tweetId: opts.postedTweetId,
    publicMetrics: { impression_count: opts.views, like_count: 2, reply_count: 0 },
    nonPublicMetrics: { user_profile_clicks: opts.profileVisits },
  });
}

describe('playbook route', () => {
  beforeAll(async () => {
    // Two measured single-draft replies with different angles + a person row
    // carrying the author's follower count for the size bucket.
    await db
      .insert(people)
      .values({ handle: 'pb_author', followersCount: 50_000 })
      .onConflictDoNothing();
    await seedReply({
      id: 'a0000000-0000-4000-8000-000000000001',
      angle: 'contrarian',
      postedTweetId: 'pb_r1',
      views: 400,
      profileVisits: 6,
      relationship: '## My history with @pb_author',
    });
    await seedReply({
      id: 'a0000000-0000-4000-8000-000000000002',
      angle: 'extends',
      postedTweetId: 'pb_r2',
      views: 100,
      profileVisits: 1,
    });

    // A radar-drafted reply: published reply whose text matches the drafted
    // one under the drafted target, with no reply_drafts link.
    await db
      .insert(radarDrafts)
      .values({
        tweetId: '5555',
        handle: 'pb_radar',
        snippet: 'hot post',
        replyText: 'Radar says ship it.',
        angle: 'extends',
        status: 'clicked',
      })
      .onConflictDoNothing();
    await db
      .insert(postsPublished)
      .values({
        tweetId: 'pb_r3',
        text: 'Radar  says ship it.',
        postedAt: at(200),
        isReply: true,
        inReplyToTweetId: '5555',
        source: 'test',
      })
      .onConflictDoNothing();
    await db.insert(metricsSnapshots).values({
      tweetId: 'pb_r3',
      publicMetrics: { impression_count: 50, like_count: 0, reply_count: 0 },
    });

    // A drafter original with pillar + register and a measured outcome.
    await db
      .insert(scheduledPosts)
      .values({
        id: 'b0000000-0000-4000-8000-000000000001',
        text: 'original post',
        status: 'posted',
        source: 'drafter',
        pillar: 'ai-craft',
        register: 'spicy',
        postedTweetId: 'pb_p1',
      })
      .onConflictDoNothing();
    await db
      .insert(postsPublished)
      .values({
        tweetId: 'pb_p1',
        text: 'original post',
        postedAt: at(300),
        isReply: false,
        source: 'test',
      })
      .onConflictDoNothing();
    await db.insert(metricsSnapshots).values({
      tweetId: 'pb_p1',
      publicMetrics: { impression_count: 900, like_count: 4, reply_count: 1 },
    });

    // An extracted own-winner template on that original.
    await db
      .insert(postTemplates)
      .values({
        tweetId: 'pb_p1',
        hookType: 'stat hook',
        skeleton: 'stat -> claim -> close',
        lineBreakPattern: 'one-liner',
        templateLength: 'short',
        device: 'direct address',
      })
      .onConflictDoNothing();

    // §S0.2 media baseline: two media originals + two text-only originals, all
    // measured. pb_p1 above stays hasMedia=null → the "unknown" bucket.
    for (const m of [
      { tweetId: 'pb_m1', hasMedia: true, views: 800, clicks: 12 },
      { tweetId: 'pb_m2', hasMedia: true, views: 400, clicks: 8 },
      { tweetId: 'pb_t1', hasMedia: false, views: 200, clicks: 4 },
      { tweetId: 'pb_t2', hasMedia: false, views: 100, clicks: 2 },
    ]) {
      await db
        .insert(postsPublished)
        .values({
          tweetId: m.tweetId,
          text: `original ${m.tweetId}`,
          postedAt: at(300),
          isReply: false,
          source: 'test',
          hasMedia: m.hasMedia,
        })
        .onConflictDoNothing();
      await db.insert(metricsSnapshots).values({
        tweetId: m.tweetId,
        publicMetrics: { impression_count: m.views, like_count: 1, reply_count: 0 },
        nonPublicMetrics: { user_profile_clicks: m.clicks },
      });
    }
  });

  test('GET /x/playbook serves every stat with n and gates', async () => {
    const res = await app.request('/x/playbook');
    expect(res.status).toBe(200);
    // biome-ignore lint/suspicious/noExplicitAny: the test walks the whole payload
    const body = (await res.json()) as any;

    expect(body.minN).toBe(20);
    const contrarian = body.angleEffectiveness.overall.find(
      (c: { angle: string | null }) => c.angle === 'contrarian',
    );
    expect(contrarian).toMatchObject({ n: 1, medianViews: 400, sufficient: false });
    const bucket = body.angleEffectiveness.byAuthorSize.find(
      (b: { bucket: string }) => b.bucket === '10k-100k',
    );
    expect(bucket).toBeDefined();

    const pr = body.pillarRegister.cells.find(
      (c: { pillar: string | null; register: string | null }) =>
        c.pillar === 'ai-craft' && c.register === 'spicy',
    );
    expect(pr).toMatchObject({ n: 1, medianViews: 900 });

    const hook = body.structures.hooks.find((h: { key: string }) => h.key === 'stat hook');
    expect(hook).toMatchObject({ n: 1, medianViews: 900, sufficient: false });

    expect(body.batchVsSingle.single.n).toBe(2);
    expect(body.batchVsSingle.radar.n).toBe(1);
    expect(body.batchVsSingle.radar.medianViews).toBe(50);

    expect(body.bandCalibration.totalMeasured).toBeGreaterThanOrEqual(2);
    expect(body.bandCalibration.bands.length).toBeGreaterThanOrEqual(1);

    expect(body.relationshipLift.withRelationship.n).toBe(1);
    expect(body.relationshipLift.withoutRelationship.n).toBe(1);
    expect(body.relationshipLift.viewsLift).toBeNull(); // gated

    // §S0.7 roster coverage rides along — assert the partition invariants
    // (band-value correctness is covered by the pure test, which doesn't depend
    // on whatever account snapshot other test files left as "latest").
    const rc = body.rosterCoverage;
    expect(typeof rc.total).toBe('number');
    expect(rc.counts.in_band + rc.counts.above_band + rc.counts.below_band).toBe(rc.known);
    expect(rc.known + rc.counts.unknown).toBe(rc.total);

    // Nothing clears the default gate on 2 measured rows.
    expect(body.guidance.reply).toBeNull();
    expect(body.guidance.post).toBeNull();
  });

  test('media effectiveness buckets originals and gates the lift', async () => {
    const gated = (await (await app.request('/x/playbook')).json()) as {
      mediaEffectiveness: {
        media: { n: number; medianViews: number | null };
        textOnly: { n: number; medianViews: number | null };
        unknown: { n: number; medianViews: number | null };
        viewsLift: number | null;
      };
    };
    expect(gated.mediaEffectiveness.media).toMatchObject({ n: 2, medianViews: 600 });
    expect(gated.mediaEffectiveness.textOnly).toMatchObject({ n: 2, medianViews: 150 });
    // pb_p1 (hasMedia null) is the unknown bucket — never counted as text-only.
    expect(gated.mediaEffectiveness.unknown.medianViews).toBe(900);
    expect(gated.mediaEffectiveness.viewsLift).toBeNull(); // n<20 per side

    const open = (await (await app.request('/x/playbook?minN=1')).json()) as {
      mediaEffectiveness: { viewsLift: number | null; profileVisitsLift: number | null };
    };
    expect(open.mediaEffectiveness.viewsLift).toBe(4); // 600 / 150
  });

  test('latency buckets posted replies by age-at-draft', async () => {
    const body = (await (await app.request('/x/playbook')).json()) as {
      latencyEffectiveness: {
        cells: Array<{ bucket: string; n: number; medianViews: number | null }>;
        totalMeasured: number;
        early: { n: number; medianViews: number | null };
        late: { n: number };
        viewsLift: number | null;
      };
    };
    // Both seeded replies carry signals.ageMin=12 → the <15m bucket.
    const early = body.latencyEffectiveness.cells.find((c) => c.bucket === '<15m');
    expect(early).toMatchObject({ n: 2, medianViews: 250 });
    expect(body.latencyEffectiveness.totalMeasured).toBe(2);
    expect(body.latencyEffectiveness.early.n).toBe(2);
    // No late (≥1h) replies were seeded → the doctrine grade stays silent.
    expect(body.latencyEffectiveness.late.n).toBe(0);
    expect(body.latencyEffectiveness.viewsLift).toBeNull();

    // Even minN=1 can't manufacture a lift with an empty late cohort.
    const open = (await (await app.request('/x/playbook?minN=1')).json()) as {
      latencyEffectiveness: { viewsLift: number | null };
    };
    expect(open.latencyEffectiveness.viewsLift).toBeNull();
  });

  test('minN=1 opens the gates and the guidance speaks', async () => {
    const res = await app.request('/x/playbook?minN=1');
    // biome-ignore lint/suspicious/noExplicitAny: the test walks the whole payload
    const body = (await res.json()) as any;
    const contrarian = body.angleEffectiveness.overall.find(
      (c: { angle: string | null }) => c.angle === 'contrarian',
    );
    expect(contrarian?.sufficient).toBe(true);
    expect(body.relationshipLift.viewsLift).toBe(4); // 400 / 100
    // guidance stays on the DEFAULT gate even when the page opens its own.
    expect(body.guidance.reply).toBeNull();
  });

  test('minN validation', async () => {
    for (const q of ['0', '-1', '1.5', 'abc', '100000']) {
      const res = await app.request(`/x/playbook?minN=${q}`);
      expect(res.status).toBe(400);
    }
  });

  test('guidance loaders gate on the default and inject at the prompt tail', async () => {
    // Loaders read the same rows the page shows; 2 measured < 20 → silent.
    expect(await loadReplyGuidance()).toBeNull();
    expect(await loadPostGuidance()).toBeNull();

    // Tail placement (pure): a guidance line lands at the very end.
    const line = "measured: my 'contrarian' replies earn 2x — prefer it.";
    const single = buildGrokInput(
      {
        url: 'https://x.com/a/status/1',
        tweetId: '1',
        author: 'A',
        handle: 'a',
        text: 'post',
        postedAt: new Date().toISOString(),
        metrics: { views: 0, replies: 0, reposts: 0, likes: 0 },
        topComments: [],
        guidance: line,
      },
      undefined,
      undefined,
    )[0]?.content as string;
    expect(single.endsWith(line)).toBe(true);

    const batch = buildBatchGrokInput(
      [{ tweetId: '1', handle: 'a', author: 'A', text: 'post' }],
      undefined,
      undefined,
      undefined,
      line,
    )[0]?.content as string;
    expect(batch.endsWith(line)).toBe(true);

    const post = buildPostDraftInput({ winners: [], guidance: line })[0]?.content as string;
    expect(post.endsWith(line)).toBe(true);
  });

  test('extract-winners without XAI_API_KEY is 503', async () => {
    const prev = process.env.XAI_API_KEY;
    // biome-ignore lint/performance/noDelete: assigning undefined leaves the env var set
    delete process.env.XAI_API_KEY;
    try {
      const res = await app.request('/x/playbook/extract-winners', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(503);
    } finally {
      if (prev !== undefined) process.env.XAI_API_KEY = prev;
    }
  });
});

// §S0.7 — loadRosterCoverage over the real DB. A far-future account snapshot
// forces a known 2–10x band regardless of what other files seeded (cleaned up
// in afterAll so it never leaks); a distant-past window isolates these replies
// from every other test's now-stamped posted drafts.
describe('loadRosterCoverage (S0.7)', () => {
  const FUTURE = new Date('2999-01-01T00:00:00Z'); // guaranteed latest snapshot
  const WIN_START = new Date('2024-02-01T00:00:00Z');
  const WIN_END = new Date('2024-02-08T00:00:00Z');
  const PASTE = new Date('2024-02-03T12:00:00Z');
  const specs = [
    { id: 'c0000000-0000-4000-8000-000000000001', handle: 'rc_inband', followers: 50_000 },
    { id: 'c0000000-0000-4000-8000-000000000002', handle: 'rc_inband2', followers: 40_000 },
    { id: 'c0000000-0000-4000-8000-000000000003', handle: 'rc_toobig', followers: 500_000 },
    { id: 'c0000000-0000-4000-8000-000000000004', handle: 'rc_unknown', followers: null },
  ];

  beforeAll(async () => {
    // My size 10k → 2–10x band = 20k–100k.
    await db.insert(accountSnapshots).values({
      snapshotAt: FUTURE,
      followersCount: 10_000,
      followingCount: 100,
      tweetCount: 500,
      listedCount: 5,
    });
    for (const s of specs) {
      if (s.followers !== null) {
        await db
          .insert(people)
          .values({ handle: s.handle, followersCount: s.followers })
          .onConflictDoNothing();
      }
      await db
        .insert(replyDrafts)
        .values({
          id: s.id,
          sourceTweetId: '7000',
          sourceAuthorUsername: s.handle,
          sourceText: 't',
          sourceUrl: 'https://x.com/x/status/7000',
          contextSnapshot: {},
          replyText: 'r',
          model: 'test',
          status: 'posted',
          updatedAt: PASTE,
        })
        .onConflictDoNothing();
    }
  });

  afterAll(async () => {
    await db.delete(accountSnapshots).where(eq(accountSnapshots.snapshotAt, FUTURE));
    for (const s of specs) {
      await db.delete(replyDrafts).where(eq(replyDrafts.id, s.id));
      if (s.followers !== null) await db.delete(people).where(eq(people.handle, s.handle));
    }
  });

  test('bands windowed posted replies by resolved author size', async () => {
    const r = await loadRosterCoverage(WIN_START, WIN_END, 1);
    expect(r.total).toBe(4);
    expect(r.band).toEqual({ min: 20_000, max: 100_000 });
    expect(r.counts).toEqual({ in_band: 2, above_band: 1, below_band: 0, unknown: 1 });
    expect(r.known).toBe(3);
    expect(r.inBandPctOfKnown).toBe(67); // 2/3
    expect(r.majorityInBand).toBe(true); // 2 of 3 known
  });

  test('an empty window is all zeros', async () => {
    const r = await loadRosterCoverage(
      new Date('2023-01-01T00:00:00Z'),
      new Date('2023-01-02T00:00:00Z'),
    );
    expect(r.total).toBe(0);
    expect(r.majorityInBand).toBeNull();
  });
});
