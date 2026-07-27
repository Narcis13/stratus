// JD.4 — judge route guards + the persisted row shape, over the real
// (in-memory) SQLite DB (`bun run test` uses SQLITE_PATH=:memory:). The judge
// router carries no auth of its own (the /x bearer is shared, covered by
// app.test), so it mounts on a bare Hono like drafter.test / prompts.test.
//
// NOTHING HERE MAY SPEND. Every guard case is refused before the call by
// construction (§7.4), and the one test that walks the whole ladder force-unsets
// BOTH provider keys in a `finally` so it 503s even on a dev machine with a key
// set — reaching `llm_not_configured` IS the proof the request got all the way
// to the LLM layer without a network call happening.

import { afterAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  type JudgeScores,
  type JudgeVerdict,
  deriveApproved,
  deriveVerdictBand,
} from '../../shared/judge.ts';
import { draftJudgments } from '../db/schema.ts';
import { judgeTextHash, normalizeJudgeText } from '../judge/prompt.ts';
import { insertJudgment, judgeRouter } from './judge.ts';

const app = new Hono();
app.route('/x', judgeRouter);

const createdIds: string[] = [];
afterAll(() => {
  if (createdIds.length > 0) {
    db.delete(draftJudgments).where(inArray(draftJudgments.id, createdIds)).run();
  }
});

async function post<T>(body: unknown): Promise<{ status: number; body: T }> {
  const res = await app.request('/x/judge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

function scores(overall: number): JudgeScores {
  return {
    overall,
    replies: 70,
    profileClicks: 60,
    impressions: 55,
    bookmarkValue: 40,
    dwellProxy: 65,
    voiceMatch: 80,
    negativeRisk: 10,
    answerEffort: 50,
    strangerAnswerability: 45,
    statusDependency: 20,
    replyVsQuoteOrientation: 75,
    audienceMatch: null,
  };
}

function verdictFor(overall: number): JudgeVerdict {
  const band = deriveVerdictBand(overall);
  return {
    verdict: band,
    approved: deriveApproved(band),
    headline: 'Solid take, the closer asks for nothing.',
    confidence: 'medium',
    scores: scores(overall),
    annotations: [
      { quote: 'thoughts?', severity: 'warning', recommendation: 'Ask something real.' },
    ],
    strengths: ['Concrete opening.'],
    improvements: ['Cut the last line.'],
  };
}

describe('POST /x/judge guards (JD.4) — all refuse before any spend', () => {
  test('non-object body → 400 invalid_body', async () => {
    const { status, body } = await post<{ error: string }>(['not', 'an', 'object']);
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_body');
  });

  test('missing text → 400 invalid_text', async () => {
    const { status, body } = await post<{ error: string }>({});
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_text');
  });

  test('whitespace-only text → 400 invalid_text (trimmed before the length check)', async () => {
    const { status, body } = await post<{ error: string }>({ text: '   \n\t  ' });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_text');
  });

  test('text over 2000 chars → 400 invalid_text', async () => {
    const { status, body } = await post<{ error: string }>({ text: 'x'.repeat(2001) });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_text');
  });

  test("surface 'reply' → 400 invalid_surface (the column is wider than v1, the validator is not)", async () => {
    const { status, body } = await post<{ error: string }>({
      text: 'a real draft',
      surface: 'reply',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_surface');
  });

  test('empty model → 400 invalid_model', async () => {
    const { status, body } = await post<{ error: string }>({ text: 'a real draft', model: '  ' });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_model');
  });

  test('unknown provider → 400 invalid_provider', async () => {
    const { status, body } = await post<{ error: string }>({
      text: 'a real draft',
      provider: 'gemini',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_provider');
  });

  test('valid body, no LLM configured → 503 llm_not_configured (the whole ladder passed, nothing spent)', async () => {
    const xai = process.env.XAI_API_KEY;
    const openrouter = process.env.OPENROUTER_API_KEY;
    process.env.XAI_API_KEY = '';
    process.env.OPENROUTER_API_KEY = '';
    try {
      const { status, body } = await post<{ error: string }>({
        text: 'A draft that would otherwise cost ~$0.003 to grade.',
        surface: 'post',
      });
      expect(status).toBe(503);
      expect(body.error).toBe('llm_not_configured');
    } finally {
      process.env.XAI_API_KEY = xai ?? '';
      process.env.OPENROUTER_API_KEY = openrouter ?? '';
    }
  });
});

describe('insertJudgment row shape (JD.4)', () => {
  test('stores the derived band, the overall, and a text_hash that round-trips', async () => {
    const text = 'Shipped the publisher worker today.   It claims a row before it posts.';
    const id = await insertJudgment({
      text,
      surface: 'post',
      verdict: verdictFor(88),
      model: 'grok-4-fast',
      provider: 'grok',
      costUsd: 0.0031,
    });
    expect(id).not.toBeNull();
    if (id === null) return;
    createdIds.push(id);

    const row = await db.select().from(draftJudgments).where(eq(draftJudgments.id, id)).get();
    expect(row).toBeDefined();
    if (!row) return;

    // §7.12: the link is the hash of the NORMALIZED text, and `judgeTextHash`
    // normalizes internally — so the two spellings a future caller might reach
    // for have to agree, or JD.7's Playbook join silently finds nothing.
    expect(row.textHash).toBe(judgeTextHash(text));
    expect(row.textHash).toBe(judgeTextHash(normalizeJudgeText(text)));
    // Whitespace-only edits are NOT edits (the reset-on-edit reading).
    expect(row.textHash).toBe(
      judgeTextHash('Shipped the publisher worker today. It claims a row before it posts.'),
    );

    // The band is stored as `deriveVerdictBand` derived it — never recomputed
    // by the route, which is what makes the label and the number inseparable.
    expect(row.overall).toBe(88);
    expect(row.verdict).toBe('post_now');
    expect(row.verdict).toBe(deriveVerdictBand(row.overall));
    // `approved` is deliberately NOT a column: it is a pure function of the band.
    expect(Object.keys(row)).not.toContain('approved');

    expect(row.text).toBe(text);
    expect(row.surface).toBe('post');
    expect(row.model).toBe('grok-4-fast');
    expect(row.provider).toBe('grok');
    expect(row.costUsd).toBeCloseTo(0.0031, 6);
    expect(row.parentJudgmentId).toBeNull();
    expect(row.judgedAt).toBeInstanceOf(Date);
  });

  test('the JSON columns round-trip, including a null audienceMatch (§7.11)', async () => {
    const text = 'A second draft, judged low.';
    const id = await insertJudgment({
      text,
      surface: 'post',
      verdict: verdictFor(31),
      model: 'grok-4-fast',
      provider: 'grok',
      costUsd: null,
    });
    expect(id).not.toBeNull();
    if (id === null) return;
    createdIds.push(id);

    const row = await db.select().from(draftJudgments).where(eq(draftJudgments.id, id)).get();
    if (!row) throw new Error('row missing');

    expect(row.verdict).toBe('do_not_post');
    expect(row.scores.audienceMatch).toBeNull();
    expect(row.scores.overall).toBe(31);
    expect(Object.keys(row.scores)).toHaveLength(13);
    expect(row.annotations).toHaveLength(1);
    expect(row.annotations[0]?.quote).toBe('thoughts?');
    expect(row.annotations[0]?.severity).toBe('warning');
    expect(row.strengths).toEqual(['Concrete opening.']);
    expect(row.improvements).toEqual(['Cut the last line.']);
    expect(row.headline).toBe('Solid take, the closer asks for nothing.');
    expect(row.confidence).toBe('medium');
    expect(row.costUsd).toBeNull();
  });

  test('two judgments of the same text share a hash — that is the point of the read-time link', async () => {
    const text = 'The same draft, judged twice.';
    const ids: string[] = [];
    for (const overall of [72, 74]) {
      const id = await insertJudgment({
        text,
        surface: 'post',
        verdict: verdictFor(overall),
        model: 'grok-4-fast',
        provider: 'grok',
        costUsd: 0.003,
      });
      if (id === null) throw new Error('insert failed');
      ids.push(id);
      createdIds.push(id);
    }
    const rows = await db
      .select()
      .from(draftJudgments)
      .where(inArray(draftJudgments.id, ids))
      .all();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.textHash)).size).toBe(1);
    expect(rows.every((r) => r.verdict === 'slight_rework')).toBe(true);
  });
});
