// DM drafting pure core (A3.9): prompt shaping + reply parsing. The whole
// safety story lives in the prompt (no fabricated familiarity) and in the
// route's refusal ladder (tested in routes/dms.test.ts); here we prove the
// stable-prefix / variable-tail contract (§7.15) and the schema/parse shapes.

import { describe, expect, test } from 'bun:test';
import { DM_PROMPT_TEMPLATE, DM_SCHEMA, buildDmPrompt, parseDm } from './dm.ts';

const PREFIX = DM_PROMPT_TEMPLATE.split('{{PURPOSE}}')[0] ?? '';

/** The single user message's content — buildDmPrompt always returns one. */
function dmText(
  grounding: string,
  idea: string | null,
  purpose: string | null,
  template?: string,
): string {
  const msgs =
    template === undefined
      ? buildDmPrompt(grounding, idea, purpose)
      : buildDmPrompt(grounding, idea, purpose, template);
  return msgs[0]?.content ?? '';
}

describe('buildDmPrompt (A3.9)', () => {
  test('is a single user message', () => {
    const msgs = buildDmPrompt('g', null, null);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.role).toBe('user');
  });

  test('grounding and idea land at the tail, after the instruction block', () => {
    const grounding = 'PERSON: @sam — relationship stage: responded.';
    const content = dmText(grounding, 'ask about their drizzle migration post', 'reconnect');

    const rulesAt = content.indexOf('HARD RULES:');
    expect(rulesAt).toBeGreaterThan(-1);
    // Both variable inputs sit strictly after the stable instruction block.
    expect(content.indexOf('ask about their drizzle migration post')).toBeGreaterThan(rulesAt);
    expect(content.indexOf(grounding)).toBeGreaterThan(rulesAt);
    expect(content.indexOf('reconnect')).toBeGreaterThan(rulesAt);
    // No leftover placeholders once every slot is filled.
    expect(content).not.toContain('{{GROUNDING}}');
    expect(content).not.toContain('{{IDEA}}');
    expect(content).not.toContain('{{PURPOSE}}');
  });

  test('language clause is in the stable prefix; a Romanian idea never shifts the prefix bytes', () => {
    // The prefix states any-language-in / English-out (decision 13).
    expect(PREFIX).toContain('any language');
    expect(PREFIX).toContain('natural English');

    const g = 'PERSON: @ana — relationship stage: mutual.';
    const english = dmText(g, 'talk about shipping in public', null);
    const romanian = dmText(g, 'întreabă-o despre postarea ei despre migrări', null);

    // Identical stable prefix regardless of the tail language — the cacheable
    // bytes never move with the steer.
    expect(english.startsWith(PREFIX)).toBe(true);
    expect(romanian.startsWith(PREFIX)).toBe(true);
    // The Romanian steer really did reach the tail.
    expect(romanian).toContain('întreabă-o despre postarea ei despre migrări');
  });

  test('absent idea/purpose render a labeled sentinel, not an empty slot', () => {
    const content = dmText('PERSON: @x — stage: aware.', null, null);
    expect(content).toContain('(none — react to something concrete in the grounding)');
    expect(content).toContain('(none — a warm, low-pressure check-in)');
    expect(content).not.toContain('{{IDEA}}');
    expect(content).not.toContain('{{PURPOSE}}');
  });

  test('token-less custom override still gets the grounding appended', () => {
    const content = dmText('GROUND', 'idea', 'purpose', 'A custom prompt with no tokens.');
    expect(content).toContain('A custom prompt with no tokens.');
    expect(content).toContain('GROUNDING:\nGROUND');
  });

  test("'$' in the grounding is inserted literally (split/join, not replace)", () => {
    const content = dmText('cost is $5 for $0.20', 'x', 'y');
    expect(content).toContain('cost is $5 for $0.20');
  });
});

describe('DM_SCHEMA', () => {
  test('requires exactly a string dm, no extra properties', () => {
    expect(DM_SCHEMA.required).toEqual(['dm']);
    expect(DM_SCHEMA.additionalProperties).toBe(false);
    expect(DM_SCHEMA.properties.dm.type).toBe('string');
  });
});

describe('parseDm', () => {
  test('valid JSON with a dm string → trimmed', () => {
    expect(parseDm('{"dm": "  hey, saw your post  "}')).toEqual({ dm: 'hey, saw your post' });
  });

  test('missing/empty/non-object/non-json → null', () => {
    expect(parseDm('{"dm": ""}')).toBeNull();
    expect(parseDm('{"dm": "   "}')).toBeNull();
    expect(parseDm('{"other": "x"}')).toBeNull();
    expect(parseDm('["dm"]')).toBeNull();
    expect(parseDm('not json')).toBeNull();
    expect(parseDm('{"dm": 5}')).toBeNull();
  });
});
