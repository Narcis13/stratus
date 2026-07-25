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
  harvestRows,
  harvestRuns,
  ideas,
  metricsSnapshots,
  people,
  postTemplates,
  postsPublished,
  radarDrafts,
  replyDrafts,
  replyListUses,
  scheduledPosts,
} from '../db/schema.ts';
import { buildIdeaEffectiveness } from '../playbook.ts';
import { buildPostDraftInput } from '../posts/prompt.ts';
import { buildBatchGrokInput, buildGrokInput } from '../replies/prompt.ts';
import { getSetting, resetSettings, setSettings } from '../settings/registry.ts';
import {
  loadIdeaRows,
  loadPostGuidance,
  loadReplyGuidance,
  loadRosterCoverage,
  playbook,
} from './playbook.ts';

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
  me?: string;
  source?: 'radar' | 'reply_master';
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
        ...(opts.me ? { me: opts.me } : {}),
      },
      replyText,
      variants: [{ text: replyText, angle: opts.angle }],
      model: 'test',
      ...(opts.source ? { source: opts.source } : {}),
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
      me: 'ME: Goal: 5K MRR — at 800 (16%)',
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

    // M1 (ME.5) personal-context lift — pb_r1 carries a me-brief, pb_r2 doesn't.
    expect(body.meEffectiveness.withMe.n).toBe(1);
    expect(body.meEffectiveness.withoutMe.n).toBe(1);
    expect(body.meEffectiveness.viewsLift).toBeNull(); // gated
    expect(body.meEffectiveness.withMe.n + body.meEffectiveness.withoutMe.n).toBe(
      body.meEffectiveness.totalMeasured,
    );

    // §S0.7 roster coverage rides along — assert the partition invariants
    // (band-value correctness is covered by the pure test, which doesn't depend
    // on whatever account snapshot other test files left as "latest").
    const rc = body.rosterCoverage;
    expect(typeof rc.total).toBe('number');
    expect(rc.counts.in_band + rc.counts.above_band + rc.counts.below_band).toBe(rc.known);
    expect(rc.known + rc.counts.unknown).toBe(rc.total);

    // §S0.8 idea → outcome rides along — assert the partition invariant (every
    // measured row lands in exactly one seeded/unseeded cell, pooled and split).
    const ie = body.ideaEffectiveness;
    expect(ie.seeded.n + ie.unseeded.n).toBe(ie.totalMeasured);
    expect(
      ie.posts.seeded.n + ie.posts.unseeded.n + ie.replies.seeded.n + ie.replies.unseeded.n,
    ).toBe(ie.totalMeasured);

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

  test('model effectiveness buckets posted replies by drafting model (AI.12)', async () => {
    const body = (await (await app.request('/x/playbook')).json()) as {
      modelEffectiveness: {
        cells: Array<{ model: string; posted: number; n: number; medianViews: number | null }>;
        totalMeasured: number;
      };
    };
    // Both posted single replies seed model 'test' (pb_r1 400, pb_r2 100).
    const testBucket = body.modelEffectiveness.cells.find((c) => c.model === 'test');
    expect(testBucket).toMatchObject({ posted: 2, n: 2, medianViews: 250 });
    expect(body.modelEffectiveness.totalMeasured).toBe(2);
    // Partition invariant: every measured reply lands in exactly one bucket.
    expect(body.modelEffectiveness.cells.reduce((s, c) => s + c.n, 0)).toBe(
      body.modelEffectiveness.totalMeasured,
    );
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
    expect(body.meEffectiveness.viewsLift).toBe(4); // 400 (with me) / 100 (cold)
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

  test('extract-winners with no LLM provider is 503', async () => {
    const prev = process.env.XAI_API_KEY;
    const prevOr = process.env.OPENROUTER_API_KEY;
    // AI.6: the gate is llmConfigured() now — both keys must be off, else the
    // pre-flight passes and the route would reach askLLM.
    // biome-ignore lint/performance/noDelete: assigning undefined leaves the env var set
    delete process.env.XAI_API_KEY;
    // biome-ignore lint/performance/noDelete: assigning undefined leaves the env var set
    delete process.env.OPENROUTER_API_KEY;
    try {
      const res = await app.request('/x/playbook/extract-winners', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(503);
    } finally {
      if (prev !== undefined) process.env.XAI_API_KEY = prev;
      if (prevOr !== undefined) process.env.OPENROUTER_API_KEY = prevOr;
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

// §S0.8 — loadIdeaRows over the real DB: the consumed-idea → draft → snapshot
// join. Seeded rows are deterministic because ONLY this block creates a consumed
// idea that backlinks a real posted draft (other tests point at fake ids). The
// outcome join is metrics_snapshots-by-postedTweetId, so no posts_published row
// is needed. All rows are cleaned up in afterAll.
describe('loadIdeaRows (S0.8)', () => {
  const POST_ID = 's08-post-row';
  const REPLY_ID = 's08-reply-row';
  const POST_TWEET = 's08_pt';
  const REPLY_TWEET = 's08_rt';
  const IDEA_POST = 'd0000000-0000-4000-8000-000000000001';
  const IDEA_REPLY = 'd0000000-0000-4000-8000-000000000002';

  beforeAll(async () => {
    await db
      .insert(scheduledPosts)
      .values({ id: POST_ID, text: 's08 seeded post', status: 'posted', postedTweetId: POST_TWEET })
      .onConflictDoNothing();
    await db
      .insert(replyDrafts)
      .values({
        id: REPLY_ID,
        sourceTweetId: '8000',
        sourceAuthorUsername: 's08_author',
        sourceText: 't',
        sourceUrl: 'https://x.com/x/status/8000',
        contextSnapshot: {},
        replyText: 's08 seeded reply',
        model: 'test',
        status: 'posted',
        postedTweetId: REPLY_TWEET,
      })
      .onConflictDoNothing();
    // metrics_snapshots.tweetId FKs to posts_published — seed the parent rows.
    await db
      .insert(postsPublished)
      .values({
        tweetId: POST_TWEET,
        text: 's08 seeded post',
        postedAt: at(300),
        isReply: false,
        source: 'test',
      })
      .onConflictDoNothing();
    await db
      .insert(postsPublished)
      .values({
        tweetId: REPLY_TWEET,
        text: 's08 seeded reply',
        postedAt: at(200),
        isReply: true,
        inReplyToTweetId: '8000',
        source: 'test',
      })
      .onConflictDoNothing();
    await db.insert(metricsSnapshots).values({
      tweetId: POST_TWEET,
      publicMetrics: { impression_count: 1234, like_count: 3, reply_count: 0 },
      nonPublicMetrics: { user_profile_clicks: 15 },
    });
    await db.insert(metricsSnapshots).values({
      tweetId: REPLY_TWEET,
      publicMetrics: { impression_count: 2468, like_count: 5, reply_count: 0 },
      nonPublicMetrics: { user_profile_clicks: 25 },
    });
    await db
      .insert(ideas)
      .values([
        {
          id: IDEA_POST,
          text: 's08 idea → post',
          status: 'consumed',
          consumedByTable: 'scheduled_posts',
          consumedById: POST_ID,
        },
        {
          id: IDEA_REPLY,
          text: 's08 idea → reply',
          status: 'consumed',
          consumedByTable: 'reply_drafts',
          consumedById: REPLY_ID,
        },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(ideas).where(eq(ideas.id, IDEA_POST));
    await db.delete(ideas).where(eq(ideas.id, IDEA_REPLY));
    await db.delete(scheduledPosts).where(eq(scheduledPosts.id, POST_ID));
    await db.delete(replyDrafts).where(eq(replyDrafts.id, REPLY_ID));
    await db.delete(metricsSnapshots).where(eq(metricsSnapshots.tweetId, POST_TWEET));
    await db.delete(metricsSnapshots).where(eq(metricsSnapshots.tweetId, REPLY_TWEET));
    await db.delete(postsPublished).where(eq(postsPublished.tweetId, POST_TWEET));
    await db.delete(postsPublished).where(eq(postsPublished.tweetId, REPLY_TWEET));
  });

  test('joins consumed ideas to their drafts and measured outcomes', async () => {
    const idea = buildIdeaEffectiveness(await loadIdeaRows(), 1);
    // Exactly the two rows this block seeds are attributed as seeded.
    expect(idea.posts.seeded).toMatchObject({ n: 1, medianViews: 1234, medianProfileVisits: 15 });
    expect(idea.replies.seeded).toMatchObject({ n: 1, medianViews: 2468, medianProfileVisits: 25 });
    expect(idea.totalSeeded).toBe(2);
    // Pooled seeded median over the two surfaces.
    expect(idea.seeded).toMatchObject({ n: 2, medianViews: (1234 + 2468) / 2 });
    // The main-describe's posted originals/replies (pb_p1, pb_r1…) are unseeded,
    // so both surfaces have an unseeded baseline → the lift computes at minN=1.
    expect(idea.posts.unseeded.n).toBeGreaterThanOrEqual(1);
    expect(typeof idea.posts.viewsLift).toBe('number');
  });

  test('the default gate keeps the payoff silent on this thin sample', async () => {
    const idea = buildIdeaEffectiveness(await loadIdeaRows());
    expect(idea.viewsLift).toBeNull();
    expect(idea.posts.viewsLift).toBeNull();
    expect(idea.replies.viewsLift).toBeNull();
  });
});

describe('radar source-exact attribution (RU.9)', () => {
  // A radar-confirmed draft: a posted reply_drafts row carrying source='radar'
  // and a postedTweetId link, whose text matches NO radar_drafts row (its
  // target 4242 has none). Under the old draftPostedIds→'single' rule this was
  // misattributed 'single'; the source column now attributes it 'radar' with
  // zero text equality. The main describe's permanent pb_r1/pb_r2 (single) and
  // pb_r3 (radar, via legacy text-match) still stand, so this adds one to radar.
  const ID = 'a0000000-0000-4000-8000-0000000000f9';

  beforeAll(async () => {
    await seedReply({
      id: ID,
      angle: 'extends',
      postedTweetId: 'pb_ru9',
      views: 300,
      profileVisits: 3,
      source: 'radar',
    });
  });

  afterAll(async () => {
    await db.delete(replyDrafts).where(eq(replyDrafts.id, ID));
    await db.delete(metricsSnapshots).where(eq(metricsSnapshots.tweetId, 'pb_ru9'));
    await db.delete(postsPublished).where(eq(postsPublished.tweetId, 'pb_ru9'));
  });

  test('a confirmed+posted radar draft classifies radar without text equality', async () => {
    const res = await app.request('/x/playbook');
    expect(res.status).toBe(200);
    // biome-ignore lint/suspicious/noExplicitAny: the test walks the payload
    const body = (await res.json()) as any;
    // pb_r1, pb_r2 stay single; pb_r3 (legacy fallback) + pb_ru9 (source) = radar.
    expect(body.batchVsSingle.single.n).toBe(2);
    expect(body.batchVsSingle.radar.n).toBe(2);
  });
});

describe('canned attribution (RL.7)', () => {
  // A canned reply leaves NO reply_drafts row — only a reply_list_uses row with
  // the rendered text. reply_list_uses is FK-free (D79i) so this seed carries no
  // list/item rows, and other suites may leave strays behind: assert the delta
  // this describe causes, never an absolute count.
  const TEXT = 'thanks for the early read, this one lands';
  const USE_ID = 'c0000000-0000-4000-8000-0000000000c1';

  let before = { canned: 0, unattributed: 0 };

  async function batchVsSingle(): Promise<{
    canned: { n: number; medianViews: number | null };
    unattributed: number;
  }> {
    const res = await app.request('/x/playbook');
    // biome-ignore lint/suspicious/noExplicitAny: the test walks the payload
    const body = (await res.json()) as any;
    return body.batchVsSingle;
  }

  beforeAll(async () => {
    // The published reply exists first and is unattributed — the use row is
    // what moves it, which is exactly what the delta proves.
    await db
      .insert(postsPublished)
      .values({
        tweetId: 'pb_canned1',
        text: `${TEXT}\n`, // trailing whitespace: the match is normalized, not literal
        postedAt: at(150),
        isReply: true,
        inReplyToTweetId: '4242',
        source: 'test',
      })
      .onConflictDoNothing();
    await db.insert(metricsSnapshots).values({
      tweetId: 'pb_canned1',
      publicMetrics: { impression_count: 120, like_count: 1, reply_count: 0 },
      nonPublicMetrics: { user_profile_clicks: 3 },
    });
    const b = await batchVsSingle();
    before = { canned: b.canned.n, unattributed: b.unattributed };

    await db.insert(replyListUses).values({
      id: USE_ID,
      listId: 'c0000000-0000-4000-8000-0000000000a1',
      itemId: 'c0000000-0000-4000-8000-0000000000b1',
      renderedText: TEXT,
      targetTweetId: '4242',
      targetHandle: 'pb_author',
    });
  });

  afterAll(async () => {
    await db.delete(replyListUses).where(eq(replyListUses.id, USE_ID));
    await db.delete(metricsSnapshots).where(eq(metricsSnapshots.tweetId, 'pb_canned1'));
    await db.delete(postsPublished).where(eq(postsPublished.tweetId, 'pb_canned1'));
  });

  test('a published reply matching a use rendered text moves to the canned cell', async () => {
    const b = await batchVsSingle();
    expect(b.canned.n).toBe(before.canned + 1);
    expect(b.unattributed).toBe(before.unattributed - 1);
    // Only a clean run (no stray use rows) can pin the median to our seed.
    if (before.canned === 0) expect(b.canned.medianViews).toBe(120);
  });
});

// HV.5 opportunity funnel. Rows are seeded DIRECTLY (a multi-sighting history is
// unbuildable through POST /harvest/passive's 30-min recapture gate) under this
// suite's own mode='timeline' run, and everything is deleted in afterAll — the
// in-memory DB is shared, harvest.test.ts asserts that NO timeline run exists,
// and a stray posted reply_drafts row would move other suites' cells. Kept LAST
// in the file for the same reason.
describe('loadTimelineFunnel (HV.5)', () => {
  const RUN_ID = 'd0000000-0000-4000-8000-0000000000f1';
  const DRAFT_ID = 'd0000000-0000-4000-8000-0000000000f2';

  async function funnel(minN?: number): Promise<{
    cells: Array<{ band: string | null; seen: number; replied: number; rate: number | null }>;
    totalSeen: number;
    totalReplied: number;
  }> {
    const res = await app.request(`/x/playbook${minN === undefined ? '' : `?minN=${minN}`}`);
    expect(res.status).toBe(200);
    // biome-ignore lint/suspicious/noExplicitAny: the test walks the payload
    const body = (await res.json()) as any;
    return body.timelineFunnel;
  }

  beforeAll(async () => {
    await db
      .insert(harvestRuns)
      .values({ id: RUN_ID, handle: 'timeline', mode: 'timeline', scope: 'passive' })
      .onConflictDoNothing();
    const row = (o: {
      tweetId: string;
      views?: number;
      comments?: number;
      tweetTime?: Date | null;
      capturedAt: Date;
    }) => ({
      runId: RUN_ID,
      tweetId: o.tweetId,
      handle: 'hv5_author',
      mode: 'timeline',
      text: 'a plain statement about shipping',
      views: o.views ?? 5000,
      comments: o.comments ?? 3,
      tweetTime:
        o.tweetTime === undefined ? new Date(o.capturedAt.getTime() - 30 * 60_000) : o.tweetTime,
      capturedAt: o.capturedAt,
    });
    await db.insert(harvestRows).values([
      // hv5_a: hot at first sighting, re-scrolled 3h later as a buried thread.
      row({ tweetId: 'hv5_a', capturedAt: at(300) }),
      row({ tweetId: 'hv5_a', views: 300_000, comments: 900, capturedAt: at(120) }),
      // hv5_b: hot, and the one I actually replied to.
      row({ tweetId: 'hv5_b', capturedAt: at(240) }),
      // hv5_c: no tweet time → unknown, never the null band.
      row({ tweetId: 'hv5_c', tweetTime: null, capturedAt: at(200) }),
      // Outside the 30-day window.
      row({ tweetId: 'hv5_old', capturedAt: at(40 * 24 * 60) }),
    ]);

    await db
      .insert(replyDrafts)
      .values({
        id: DRAFT_ID,
        sourceTweetId: 'hv5_b',
        sourceAuthorUsername: 'hv5_author',
        sourceText: 'a plain statement about shipping',
        sourceUrl: 'https://x.com/hv5_author/status/hv5_b',
        contextSnapshot: {},
        replyText: 'shipped mine last week',
        model: 'test',
        status: 'posted',
        createdAt: at(230),
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(harvestRows).where(eq(harvestRows.runId, RUN_ID));
    await db.delete(harvestRuns).where(eq(harvestRuns.id, RUN_ID));
    await db.delete(replyDrafts).where(eq(replyDrafts.id, DRAFT_ID));
  });

  test('bands at first sighting, counts distinct tweets, windows at 30 days', async () => {
    const f = await funnel(1);
    expect(f.totalSeen).toBe(3); // hv5_a (twice) + hv5_b + hv5_c, hv5_old excluded
    expect(f.totalReplied).toBe(1);
    // The 900-reply re-sighting of hv5_a must not re-band it into 'skip'.
    expect(f.cells.map((c) => c.band)).toEqual(['hot', 'unknown']);
    const hot = f.cells.find((c) => c.band === 'hot');
    expect(hot?.seen).toBe(2);
    expect(hot?.replied).toBe(1);
    expect(hot?.rate).toBe(0.5);
  });

  test('a posted draft on a tweet I never saw is not credited', async () => {
    const f = await funnel(1);
    // The main describe's posted drafts all target 4242, which is not in the
    // ambient corpus — the intersection is what counts, not the draft count.
    expect(f.totalReplied).toBe(1);
  });

  test('the default gate keeps a thin cell silent', async () => {
    const f = await funnel();
    expect(f.cells.every((c) => c.rate === null)).toBe(true);
  });
});

// UI.4: `x.gates.minCellN` is the DEFAULT gate for a bare read; `?minN=` still
// wins per read. Demonstrated on the funnel because its population is entirely
// this block's own rows (the HV.5 block above deleted its own in afterAll), so
// a 12-sample cell is buildable without moving any other suite's medians. Last
// in the file for the same reason the HV.5 block is.
describe('x.gates.minCellN is the default playbook gate', () => {
  const RUN_ID = 'd0000000-0000-4000-8000-0000000000f3';

  beforeAll(async () => {
    await db
      .insert(harvestRuns)
      .values({ id: RUN_ID, handle: 'timeline', mode: 'timeline', scope: 'passive' })
      .onConflictDoNothing();
    // 12 distinct sightings, all banding the same way — one cell, n = 12.
    await db.insert(harvestRows).values(
      Array.from({ length: 12 }, (_, i) => ({
        runId: RUN_ID,
        tweetId: `ui4_${i}`,
        handle: 'ui4_author',
        mode: 'timeline',
        text: 'a plain statement about shipping',
        views: 5000,
        comments: 3,
        tweetTime: at(150 + i),
        capturedAt: at(120 + i),
      })),
    );
  });

  afterAll(async () => {
    await db.delete(harvestRows).where(eq(harvestRows.runId, RUN_ID));
    await db.delete(harvestRuns).where(eq(harvestRuns.id, RUN_ID));
    resetSettings({ keys: ['x.gates.minCellN'] });
  });

  test('PATCHing the gate to 10 flips the 12-sample cell to sufficient', async () => {
    const thin = await funnelCells();
    expect(thin.some((c) => c.seen >= 12)).toBe(true);
    expect(thin.every((c) => c.rate === null)).toBe(true); // default gate 20

    setSettings({ 'x.gates.minCellN': 10 });
    const open = await funnelCells();
    expect(open.find((c) => c.seen >= 12)?.rate).not.toBeNull();

    // …and an explicit ?minN= still overrides the configured baseline.
    const strict = await funnelCells(20);
    expect(strict.every((c) => c.rate === null)).toBe(true);
  });

  async function funnelCells(
    minN?: number,
  ): Promise<Array<{ band: string | null; seen: number; rate: number | null }>> {
    const res = await app.request(`/x/playbook${minN === undefined ? '' : `?minN=${minN}`}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      minN: number;
      timelineFunnel: { cells: Array<{ band: string | null; seen: number; rate: number | null }> };
    };
    expect(body.minN).toBe(minN ?? getSetting<number>('x.gates.minCellN'));
    return body.timelineFunnel.cells;
  }
});
