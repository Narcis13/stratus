// SC.7 — the niche lexicon: the pure derivation (where the two lists' opposite
// error costs are encoded), the route's wire shape, and the one thing that
// actually matters end to end — a term the route emits flips `concrete_detail`
// in the engine that will consume it.

import { afterAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { scoreDraft } from '../../shared/postCoach.ts';
import type { ReachFit } from '../coach/reach.ts';
import { channels, metricsSnapshots, postsPublished } from '../db/schema.ts';
import { type CoachLexiconPayload, assembleCoachLexicon, coachRouter } from './coach.ts';

const app = new Hono();
app.route('/x', coachRouter);

const CH = 'sc7-macro-room';

async function getLexicon(): Promise<CoachLexiconPayload> {
  const res = await app.request('/x/coach/lexicon');
  expect(res.status).toBe(200);
  return (await res.json()) as CoachLexiconPayload;
}

afterAll(async () => {
  await db.delete(channels).where(eq(channels.slug, CH));
});

describe('assembleCoachLexicon', () => {
  const base = {
    nicheLabel: 'The nutrition coach',
    channelLabels: [] as string[],
    channelKeywords: [] as (string[] | null)[],
    pillarSlugs: [] as string[],
    pillarLabels: [] as string[],
  };

  test('channel keywords and pillar slugs enter specificTerms WHOLE', () => {
    const lex = assembleCoachLexicon({
      ...base,
      channelKeywords: [['Macros', 'protein timing'], null],
      pillarSlugs: ['meal-prep', 'fasting'],
    });
    // Lowercased, deduped, sorted — and never split, so the kebab slug stays
    // one term (it simply never matches) instead of leaking "meal" and "prep".
    expect(lex.specificTerms).toEqual(['fasting', 'macros', 'meal-prep', 'protein timing']);
  });

  test('a channel with no keywords contributes nothing specific', () => {
    const lex = assembleCoachLexicon({ ...base, channelLabels: ['Recipes'], channelKeywords: [] });
    expect(lex.specificTerms).toEqual([]);
    expect(lex.tribeTerms).toContain('recipes');
  });

  test('tribeTerms word-splits labels, dropping function words, digits and short words', () => {
    const lex = assembleCoachLexicon({
      ...base,
      nicheLabel: 'The 51-year-old builder',
      pillarLabels: ['AI-native craft — the WHAT'],
    });
    expect(lex.tribeTerms).toContain('builder');
    expect(lex.tribeTerms).toContain('craft');
    expect(lex.tribeTerms).toContain('native');
    // "the"/"51"/"old"/"ai" are below the length floor or on the stopword list;
    // "what" is a function word that survives the floor and must not become a
    // vocative.
    for (const junk of ['the', '51', 'old', 'ai', 'what']) {
      expect(lex.tribeTerms).not.toContain(junk);
    }
  });

  test('nothing active still yields a well-formed (near-empty) lexicon', () => {
    expect(assembleCoachLexicon({ ...base, nicheLabel: '' })).toEqual({
      specificTerms: [],
      tribeTerms: [],
    });
  });
});

describe('GET /x/coach/lexicon', () => {
  test('returns the wire shape with the active niche stamped on it', async () => {
    const body = await getLexicon();
    expect(typeof body.niche).toBe('string');
    expect(body.niche.length).toBeGreaterThan(0);
    expect(Array.isArray(body.specificTerms)).toBe(true);
    expect(Array.isArray(body.tribeTerms)).toBe(true);
    // Sorted and deduped, whatever this DB happens to hold.
    expect(body.specificTerms).toEqual([...new Set(body.specificTerms)].sort());
    expect(body.tribeTerms).toEqual([...new Set(body.tribeTerms)].sort());
  });

  test('an active channel keyword reaches the payload and flips concrete_detail', async () => {
    const before = await getLexicon();
    expect(before.specificTerms).not.toContain('creatine');

    await db.insert(channels).values({ slug: CH, label: 'Macro room', keywords: ['creatine'] });

    const after = await getLexicon();
    expect(after.specificTerms).toContain('creatine');
    expect(after.tribeTerms).toContain('macro');

    // The point of the whole task: a draft with no number is graded concrete
    // once the account's own vocabulary is in the lexicon.
    const draft = 'Held my creatine steady through a cut. Took a rebuild of the whole week.';
    const status = (lexicon?: { specificTerms: string[]; tribeTerms: string[] }): string =>
      scoreDraft(draft, lexicon ? { lexicon } : undefined).checks.find(
        (c) => c.id === 'concrete_detail',
      )?.status ?? 'missing';
    expect(status()).toBe('nudge');
    expect(status(after)).toBe('pass');
  });
});

// SC.8 — the reach route. The fit arithmetic is pinned in `coach/reach.test.ts`
// against a controlled corpus; what can only be checked HERE is which rows the
// route hands the fit. The population is a global aggregate over a table other
// suites also seed, so every count is a delta against a baseline read.
describe('GET /x/coach/reach', () => {
  const IDS = ['sc8-first-and-late', 'sc8-late-only', 'sc8-in-window'];
  // Well clear of the monitor/brief/digest windows and of the spoken-for
  // calendar fixture bands (the JD.1 recipe).
  const LONG_AGO = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

  async function getReach(): Promise<ReachFit> {
    const res = await app.request('/x/coach/reach');
    expect(res.status).toBe(200);
    return (await res.json()) as ReachFit;
  }

  async function cleanup(): Promise<void> {
    await db.delete(metricsSnapshots).where(inArray(metricsSnapshots.tweetId, IDS));
    await db.delete(postsPublished).where(inArray(postsPublished.tweetId, IDS));
  }

  afterAll(cleanup);

  test('reads the FIRST snapshot, and only inside the daily-pass window', async () => {
    const before = await getReach();

    try {
      await db.insert(postsPublished).values(
        IDS.map((tweetId, i) => ({
          tweetId,
          text: `Notes on the work.\nStill going, entry ${i}.`,
          postedAt: new Date(LONG_AGO.getTime() + i * 3_600_000),
          source: 'manual',
          isReply: false,
          // NT.7 — an un-retired row is a candidate for the daily BILLED pass.
          retired: true,
        })),
      );
      await db.insert(metricsSnapshots).values([
        // Measured by the daily pass, then re-read days later because it won.
        // The late row is the one a `latestOutcomes` read would have taken —
        // and it would have dropped this post from the population entirely.
        {
          tweetId: IDS[0] as string,
          snapshotAt: new Date(LONG_AGO.getTime() + 10 * 3_600_000),
          publicMetrics: { impression_count: 500 },
          ageAtSnapshotMin: 600,
        },
        {
          tweetId: IDS[0] as string,
          snapshotAt: new Date(LONG_AGO.getTime() + 200 * 3_600_000),
          publicMetrics: { impression_count: 5_000 },
          ageAtSnapshotMin: 9_000,
        },
        // Never read inside the window — no comparable first-day number exists.
        {
          tweetId: IDS[1] as string,
          snapshotAt: new Date(LONG_AGO.getTime() + 200 * 3_600_000),
          publicMetrics: { impression_count: 4_000 },
          ageAtSnapshotMin: 9_000,
        },
        {
          tweetId: IDS[2] as string,
          snapshotAt: new Date(LONG_AGO.getTime() + 12 * 3_600_000),
          publicMetrics: { impression_count: 120 },
          ageAtSnapshotMin: 700,
        },
      ]);

      const after = await getReach();
      expect(after.measuredPosts - before.measuredPosts).toBe(2);
    } finally {
      await cleanup();
    }
  });

  test('reports the configured gate and never a number below it', async () => {
    const fit = await getReach();
    expect(fit.minN).toBe(20);
    expect(fit.escapeMultiple).toBe(3);
    expect(fit.cells).toHaveLength(14);

    // SC decision 9, as a route-level contract: there is no seed table, so an
    // under-gate format has nothing numeric to return through any path.
    for (const cell of fit.cells) {
      if (cell.weightSource === 'fitted') continue;
      expect(cell.stallRange).toBeNull();
      expect(cell.escapeThreshold).toBeNull();
      expect(cell.escapeProbability).toBeNull();
      expect(cell.p50Multiplier).toBeNull();
    }
    // The three no-format-detected buckets can never be fitted, whatever the
    // shared corpus happens to hold when this runs.
    for (const format of ['substance', 'one_liner', 'other']) {
      expect(fit.cells.find((c) => c.format === format)?.weightSource).toBe('insufficient');
    }
  });
});
