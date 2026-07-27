// SC.7 — the niche lexicon: the pure derivation (where the two lists' opposite
// error costs are encoded), the route's wire shape, and the one thing that
// actually matters end to end — a term the route emits flips `concrete_detail`
// in the engine that will consume it.

import { afterAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { scoreDraft } from '../../shared/postCoach.ts';
import { channels } from '../db/schema.ts';
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
