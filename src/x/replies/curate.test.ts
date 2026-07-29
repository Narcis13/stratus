// RC.1 — the curation core. Two things are worth testing here and both are
// about not losing queue rows: `parseCurateScores` degrades a bad response to
// null rather than to a row that dismisses the wrong tweet, and `selectCurated`
// is anchored to the ids we ASKED about, so a model that under-answers costs
// coverage instead of silently deleting the posts it skipped.

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { db } from '../../db/client.ts';
import { promptOverrides } from '../db/schema.ts';
import { loadPrompt, loadPromptSafe, validatePromptBody } from '../prompts/registry.ts';
import {
  CURATE_PROMPT_TEMPLATE,
  CURATE_SCHEMA,
  type CurateScore,
  MAX_CURATE_TWEETS,
  MAX_REASON_LENGTH,
  buildCurateInput,
  parseCurateScores,
  selectCurated,
} from './curate.ts';
import { UNTRUSTED_CONTEXT_MARKER } from './prompt.ts';

const tweets = [
  { tweetId: '1', handle: '@alice', author: 'Alice', text: 'shipped the agent loop today' },
  { tweetId: '2', handle: 'bob', author: 'Bob', text: 'drop a link, let us connect' },
];

function score(over: Partial<CurateScore> & { tweetId: string }): CurateScore {
  return { score: 50, lowValue: false, reason: '', ...over };
}

describe('CURATE_PROMPT_TEMPLATE + buildCurateInput', () => {
  test('the template carries both placeholders and nothing else', () => {
    expect(CURATE_PROMPT_TEMPLATE).toContain('{{POSTS}}');
    expect(CURATE_PROMPT_TEMPLATE).toContain('{{REPLY_PERSONA}}');
    expect([...new Set(CURATE_PROMPT_TEMPLATE.match(/\{\{[A-Z_]+\}\}/g) ?? [])].sort()).toEqual([
      '{{POSTS}}',
      '{{REPLY_PERSONA}}',
    ]);
    // Scoring, not drafting: the queue's paid call is the one AFTER this.
    expect(CURATE_PROMPT_TEMPLATE).toContain('lowValue');
    expect(MAX_CURATE_TWEETS).toBe(100);
  });

  test('renders the trust label once, then the numbered queue, at the tail', () => {
    const content = buildCurateInput(tweets)[0]?.content ?? '';
    expect(content.split(UNTRUSTED_CONTEXT_MARKER)).toHaveLength(2);
    expect(content).toContain('POST 1 (id: 1)');
    expect(content).toContain('@alice (Alice):');
    expect(content).toContain('POST 2 (id: 2)');
    expect(content).toContain('shipped the agent loop today');
    expect(content).not.toContain('{{POSTS}}');
    // Variable content sits at the very end (cacheable-prefix layout).
    expect(content.trimEnd().endsWith('drop a link, let us connect')).toBe(true);
  });

  test('the persona substitutes first, and a $-heavy post cannot corrupt the render', () => {
    const content =
      buildCurateInput([{ tweetId: '9', handle: 'x', author: 'X', text: "$& $' $1 {{POSTS}}" }], {
        replyPersona: 'a test persona',
      })[0]?.content ?? '';
    expect(content).toContain('a test persona');
    expect(content).not.toContain('{{REPLY_PERSONA}}');
    expect(content).toContain("$& $' $1 {{POSTS}}");
  });

  test('a custom template without the token still gets the queue appended', () => {
    const content = buildCurateInput(tweets, { template: 'MY OWN RUBRIC' })[0]?.content ?? '';
    expect(content.startsWith('MY OWN RUBRIC')).toBe(true);
    expect(content).toContain('POST 1 (id: 1)');
    expect(content).toContain(UNTRUSTED_CONTEXT_MARKER);
  });

  test('a server-stamped relationship line never reaches the scoring prompt', () => {
    const content =
      buildCurateInput([
        {
          tweetId: '1',
          handle: 'alice',
          author: 'Alice',
          text: 'shipped the agent loop today',
          relationship: 'RELATIONSHIP: ally, 3 exchanges',
        },
      ])[0]?.content ?? '';
    expect(content).toContain('shipped the agent loop today');
    expect(content).not.toContain('RELATIONSHIP');
  });

  test('the schema is strict-mode clean — no unsupported keywords', () => {
    const walk = (node: unknown): string[] => {
      if (!node || typeof node !== 'object') return [];
      const found: string[] = [];
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (['minimum', 'maximum', 'minItems', 'maxItems', 'maxLength'].includes(k)) found.push(k);
        found.push(...walk(v));
      }
      return found;
    };
    expect(walk(CURATE_SCHEMA)).toEqual([]);
    expect(CURATE_SCHEMA.properties.scores.items.required).toEqual([
      'id',
      'score',
      'lowValue',
      'reason',
    ]);
  });
});

describe('parseCurateScores', () => {
  test('happy path maps id→tweetId and trims the reason', () => {
    const out = parseCurateScores(
      '{"scores":[{"id":"1","score":88,"lowValue":false,"reason":"  concrete number  "},{"id":"2","score":4,"lowValue":true,"reason":"connection invite"}]}',
    );
    expect(out).toEqual([
      { tweetId: '1', score: 88, lowValue: false, reason: 'concrete number' },
      { tweetId: '2', score: 4, lowValue: true, reason: 'connection invite' },
    ]);
  });

  test('an out-of-range score clamps to 0–100 rather than failing the batch', () => {
    const out = parseCurateScores(
      '{"scores":[{"id":"a","score":140,"lowValue":false,"reason":"x"},{"id":"b","score":-3,"lowValue":false,"reason":"y"}]}',
    );
    expect(out?.map((s) => s.score)).toEqual([100, 0]);
  });

  test('an over-long reason is clipped, not rejected', () => {
    const out = parseCurateScores(
      `{"scores":[{"id":"a","score":50,"lowValue":false,"reason":"${'z'.repeat(400)}"}]}`,
    );
    expect(out?.[0]?.reason).toHaveLength(MAX_REASON_LENGTH);
  });

  test('an empty scores array is valid (everything lands unscored downstream)', () => {
    expect(parseCurateScores('{"scores":[]}')).toEqual([]);
  });

  test('garbage and shape failures degrade to null, never a malformed row', () => {
    expect(parseCurateScores('not json')).toBeNull();
    expect(parseCurateScores('[]')).toBeNull();
    expect(parseCurateScores('{"scores":{}}')).toBeNull();
    expect(parseCurateScores('{}')).toBeNull();
    // Truncated mid-array — the JSON.parse itself fails.
    expect(parseCurateScores('{"scores":[{"id":"a","score":50,"lowVal')).toBeNull();
    // Missing / blank id: nothing to anchor the verdict to.
    expect(parseCurateScores('{"scores":[{"score":50,"lowValue":false,"reason":"x"}]}')).toBeNull();
    expect(
      parseCurateScores('{"scores":[{"id":"   ","score":50,"lowValue":false,"reason":"x"}]}'),
    ).toBeNull();
    // A fractional or stringy score means the model ignored the schema.
    expect(
      parseCurateScores('{"scores":[{"id":"a","score":3.5,"lowValue":false,"reason":"x"}]}'),
    ).toBeNull();
    expect(
      parseCurateScores('{"scores":[{"id":"a","score":"50","lowValue":false,"reason":"x"}]}'),
    ).toBeNull();
    // lowValue drives a dismissal — a missing one is not defaulted away.
    expect(parseCurateScores('{"scores":[{"id":"a","score":50,"reason":"x"}]}')).toBeNull();
    expect(parseCurateScores('{"scores":[null]}')).toBeNull();
  });

  test('a missing reason is tolerated — it is display metadata', () => {
    expect(parseCurateScores('{"scores":[{"id":"a","score":50,"lowValue":false}]}')).toEqual([
      { tweetId: 'a', score: 50, lowValue: false, reason: '' },
    ]);
  });
});

describe('selectCurated', () => {
  test('keeps the top N by score, best first, and drops the rest', () => {
    const sel = selectCurated(
      [
        score({ tweetId: 'a', score: 40 }),
        score({ tweetId: 'b', score: 90 }),
        score({ tweetId: 'c', score: 70 }),
      ],
      ['a', 'b', 'c'],
      2,
    );
    expect(sel.keep).toEqual(['b', 'c']);
    expect(sel.drop).toEqual(['a']);
    expect(sel.unscored).toEqual([]);
  });

  test('lowValue drops even at score 100', () => {
    const sel = selectCurated(
      [score({ tweetId: 'a', score: 100, lowValue: true }), score({ tweetId: 'b', score: 10 })],
      ['a', 'b'],
      25,
    );
    expect(sel.keep).toEqual(['b']);
    expect(sel.drop).toEqual(['a']);
  });

  test('ties keep the panel ranked order, whatever order the model answered in', () => {
    const wanted = ['a', 'b', 'c'];
    const forward = selectCurated(
      wanted.map((id) => score({ tweetId: id, score: 50 })),
      wanted,
      3,
    );
    const reversed = selectCurated(
      [...wanted].reverse().map((id) => score({ tweetId: id, score: 50 })),
      wanted,
      3,
    );
    expect(forward.keep).toEqual(['a', 'b', 'c']);
    expect(reversed.keep).toEqual(['a', 'b', 'c']);
  });

  test('ids the model never scored are neither drafted nor dismissed', () => {
    const sel = selectCurated([score({ tweetId: 'a', score: 80 })], ['a', 'b', 'c'], 25);
    expect(sel.keep).toEqual(['a']);
    expect(sel.drop).toEqual([]);
    expect(sel.unscored).toEqual(['b', 'c']);
  });

  test('ids nobody asked about are ignored; a duplicated score keeps the first', () => {
    const sel = selectCurated(
      [
        score({ tweetId: 'ghost', score: 99 }),
        score({ tweetId: 'a', score: 10 }),
        score({ tweetId: 'a', score: 99, lowValue: true }),
      ],
      ['a', 'a'],
      25,
    );
    expect(sel.keep).toEqual(['a']);
    expect(sel.drop).toEqual([]);
    expect(sel.unscored).toEqual([]);
  });

  test('keep never exceeds N, and N=0 drops everything scoreable', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const scored = ids.map((id, i) => score({ tweetId: id, score: 10 * i }));
    expect(selectCurated(scored, ids, 1).keep).toEqual(['d']);
    const none = selectCurated(scored, ids, 0);
    expect(none.keep).toEqual([]);
    expect(none.drop.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  test('an empty response leaves the whole queue untouched', () => {
    const sel = selectCurated([], ['a', 'b'], 25);
    expect(sel).toEqual({ keep: [], drop: [], unscored: ['a', 'b'] });
  });
});

describe('the reply-curate registry key', () => {
  function clearOverrides() {
    db.delete(promptOverrides).run();
  }
  afterEach(clearOverrides);
  afterAll(clearOverrides);

  test('loadPromptSafe returns the shipped default with a cache key; an override wins', () => {
    const loaded = loadPromptSafe('reply-curate');
    expect(loaded.body).toBe(CURATE_PROMPT_TEMPLATE);
    expect(loaded.customized).toBe(false);
    expect(loaded.cacheKey).toMatch(/^stratus-x-reply-curate:[0-9a-f]{8}$/);

    const custom = 'MY OWN RUBRIC {{POSTS}}';
    db.insert(promptOverrides).values({ key: 'reply-curate', body: custom }).run();
    const overridden = loadPrompt('reply-curate');
    expect(overridden.body).toBe(custom);
    expect(overridden.customized).toBe(true);
    expect(overridden.cacheKey).not.toBe(loaded.cacheKey);
  });

  test('{{POSTS}} is required and {{REPLY_PERSONA}} may be dropped', () => {
    const without = validatePromptBody('reply-curate', 'My own rubric, no tokens.');
    expect(without.ok).toBe(false);
    expect(without.missing).toEqual(['{{POSTS}}']);

    const personaless = validatePromptBody('reply-curate', 'My hardcoded persona. {{POSTS}}');
    expect(personaless.ok).toBe(true);
    expect(personaless.unknown).toEqual([]);
  });
});
