// JD.5 — the verdict-driven rewrite prompt: parser shapes, render caps, and the
// single-pass substitution.
//
// The parser matrix is the point of the file, for the same reason JD.3's is:
// `parseJudgeRewrite` stands between a call that has already been billed and a
// user's textarea. Its three accepted shapes are observed failure modes from the
// study, not defensive padding — a body we could unwrap but refuse to is a paid
// call thrown away, and a body we unwrap wrongly is JSON pasted into a post.

import { describe, expect, test } from 'bun:test';
import type { JudgeAnnotation } from '../../shared/judge.ts';
import { MAX_ANNOTATIONS, MAX_JUDGE_TEXT, MAX_LIST_ITEMS } from './prompt.ts';
import {
  JUDGE_REWRITE_PROMPT_TEMPLATE,
  JUDGE_REWRITE_SCHEMA,
  NO_FIXES_VALUE,
  NO_IMPROVEMENTS_VALUE,
  buildJudgeRewriteInput,
  parseJudgeRewrite,
} from './rewritePrompt.ts';

function fix(quote: string, recommendation = 'Cut it.'): JudgeAnnotation {
  return { quote, severity: 'warning', recommendation };
}

describe('parseJudgeRewrite — the three accepted shapes (JD.5)', () => {
  test('the contract shape: {"text": "..."}', () => {
    expect(parseJudgeRewrite('{"text":"Shipped the publisher worker today."}')).toBe(
      'Shipped the publisher worker today.',
    );
  });

  test('a bare JSON string', () => {
    expect(parseJudgeRewrite('"Shipped the publisher worker today."')).toBe(
      'Shipped the publisher worker today.',
    );
  });

  test('double-encoded: the text field carries a JSON-stringified {text}', () => {
    const raw = JSON.stringify({ text: JSON.stringify({ text: 'The real post.' }) });
    expect(parseJudgeRewrite(raw)).toBe('The real post.');
  });

  test('double-encoded bare: the whole body is a stringified {text}', () => {
    const raw = JSON.stringify(JSON.stringify({ text: 'The real post.' }));
    expect(parseJudgeRewrite(raw)).toBe('The real post.');
  });

  test('the unwrap terminates instead of recursing on a pathologically nested body', () => {
    let raw = JSON.stringify({ text: 'too deep' });
    for (let i = 0; i < 6; i++) raw = JSON.stringify({ text: raw });
    // Whatever it returns, it returns — the guard is that this does not blow the
    // stack and does not hand back a JSON blob as a post.
    const out = parseJudgeRewrite(raw);
    expect(out === null || out === 'too deep').toBe(true);
  });

  test('a post that merely starts with { is not treated as JSON', () => {
    expect(parseJudgeRewrite('{"text":"{not json, just a brace} and then a claim."}')).toBe(
      '{not json, just a brace} and then a claim.',
    );
  });

  test('the text is trimmed', () => {
    expect(parseJudgeRewrite('{"text":"  padded  "}')).toBe('padded');
  });
});

describe('parseJudgeRewrite — null cases (the route 502s on each)', () => {
  test('a body that will not parse', () => {
    expect(parseJudgeRewrite('not json at all')).toBeNull();
  });

  test('an object with no text field', () => {
    expect(parseJudgeRewrite('{"variants":[{"text":"nope"}]}')).toBeNull();
  });

  test('a non-string text', () => {
    expect(parseJudgeRewrite('{"text":123}')).toBeNull();
  });

  test('an array', () => {
    expect(parseJudgeRewrite('["a","b"]')).toBeNull();
  });

  test('null', () => {
    expect(parseJudgeRewrite('null')).toBeNull();
  });

  test('empty after trimming', () => {
    expect(parseJudgeRewrite('{"text":"   \\n  "}')).toBeNull();
  });

  test('longer than the judge can read — dropped, never truncated', () => {
    const long = 'x'.repeat(MAX_JUDGE_TEXT + 1);
    expect(parseJudgeRewrite(JSON.stringify({ text: long }))).toBeNull();
    // Exactly at the ceiling still passes: the cap is the judge's input limit,
    // and a rewrite it can read is a rewrite the apply route can compare.
    expect(parseJudgeRewrite(JSON.stringify({ text: 'y'.repeat(MAX_JUDGE_TEXT) }))?.length).toBe(
      MAX_JUDGE_TEXT,
    );
  });

  test('a caller-supplied cap overrides the default', () => {
    expect(parseJudgeRewrite('{"text":"12345"}', 4)).toBeNull();
    expect(parseJudgeRewrite('{"text":"1234"}', 4)).toBe('1234');
  });
});

describe('buildJudgeRewriteInput (JD.5)', () => {
  test('renders draft, fixes and improvements; one user message', () => {
    const messages = buildJudgeRewriteInput({
      draft: 'Thoughts? Everyone always ships on Friday.',
      annotations: [fix('Thoughts?', 'Ask something a person can answer.')],
      improvements: ['Lead with the number.'],
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('user');
    const content = messages[0]?.content ?? '';
    expect(content).toContain('Thoughts? Everyone always ships on Friday.');
    expect(content).toContain('- warning · "Thoughts?" — Ask something a person can answer.');
    expect(content).toContain('- Lead with the number.');
    expect(content).not.toContain('{{DRAFT}}');
    expect(content).not.toContain('{{FIXES}}');
    expect(content).not.toContain('{{IMPROVEMENTS}}');
  });

  test('substitution is ONE pass: a token that arrives inside a quote stays inert', () => {
    // The quote is copied verbatim out of the draft, so this is reachable —
    // sequential split/join would expand the injected token on the next step.
    const draft = 'A post about {{IMPROVEMENTS}} and templating.';
    const content =
      buildJudgeRewriteInput({
        draft,
        annotations: [fix('{{IMPROVEMENTS}}', 'Say what you mean.')],
        improvements: ['Only this line is a real improvement.'],
      })[0]?.content ?? '';
    expect(content).toContain('- warning · "{{IMPROVEMENTS}}" — Say what you mean.');
    expect(content).toContain('- Only this line is a real improvement.');
    // Exactly two survivors of the literal token: the draft's and the quote's.
    expect(content.split('{{IMPROVEMENTS}}')).toHaveLength(3);
  });

  test("a '$' in the draft survives verbatim (no replace-pattern expansion)", () => {
    const draft = 'Costs $0.20 vs $0.015 — $& $` $$ and all of it.';
    const content =
      buildJudgeRewriteInput({ draft, annotations: [fix('$0.20')], improvements: [] })[0]
        ?.content ?? '';
    expect(content).toContain(draft);
  });

  test('caps: 12 fixes and 5 improvements, taken from the parser rather than retyped', () => {
    const annotations = Array.from({ length: MAX_ANNOTATIONS + 4 }, (_, i) => fix(`quote ${i}`));
    const improvements = Array.from({ length: MAX_LIST_ITEMS + 3 }, (_, i) => `note ${i}`);
    const content =
      buildJudgeRewriteInput({ draft: 'A draft.', annotations, improvements })[0]?.content ?? '';
    expect(content).toContain(`"quote ${MAX_ANNOTATIONS - 1}"`);
    expect(content).not.toContain(`"quote ${MAX_ANNOTATIONS}"`);
    expect(content).toContain(`- note ${MAX_LIST_ITEMS - 1}`);
    expect(content).not.toContain(`- note ${MAX_LIST_ITEMS}`);
  });

  test('a multi-line quote collapses to one line so the list stays a list', () => {
    const content =
      buildJudgeRewriteInput({
        draft: 'first line\n\nsecond line',
        annotations: [fix('first line\n\nsecond line', 'Join them.')],
        improvements: [],
      })[0]?.content ?? '';
    expect(content).toContain('- warning · "first line second line" — Join them.');
  });

  test('empty lists render the placeholders, not a blank section', () => {
    const content =
      buildJudgeRewriteInput({ draft: 'A draft.', annotations: [], improvements: ['  ', ''] })[0]
        ?.content ?? '';
    expect(content).toContain(NO_FIXES_VALUE);
    expect(content).toContain(NO_IMPROVEMENTS_VALUE);
  });

  test('a registry override body is honored', () => {
    const content =
      buildJudgeRewriteInput({
        draft: 'D',
        annotations: [fix('D', 'R')],
        improvements: ['I'],
        template: 'FIX:{{FIXES}} IMP:{{IMPROVEMENTS}} DRAFT:{{DRAFT}}',
      })[0]?.content ?? '';
    expect(content).toBe('FIX:- warning · "D" — R IMP:- I DRAFT:D');
  });
});

describe('JUDGE_REWRITE_SCHEMA (JD.5)', () => {
  test('one required string field, closed object', () => {
    expect(JUDGE_REWRITE_SCHEMA.required).toEqual(['text']);
    expect(JUDGE_REWRITE_SCHEMA.additionalProperties).toBe(false);
    expect(JSON.stringify(JUDGE_REWRITE_SCHEMA)).toContain('"type":"string"');
  });

  test('no strict-mode unsupported keywords (D164b — the parser owns the ceiling)', () => {
    const serialized = JSON.stringify(JUDGE_REWRITE_SCHEMA);
    for (const keyword of ['minLength', 'maxLength', 'minimum', 'maximum', 'pattern']) {
      expect(serialized).not.toContain(keyword);
    }
  });
});

describe('JUDGE_REWRITE_PROMPT_TEMPLATE (JD.5)', () => {
  test('carries all three placeholders, with the variable content at the tail', () => {
    for (const token of ['{{DRAFT}}', '{{FIXES}}', '{{IMPROVEMENTS}}']) {
      expect(JUDGE_REWRITE_PROMPT_TEMPLATE).toContain(token);
    }
    // §7.15: the instruction block stays a stable, cacheable prefix.
    expect(JUDGE_REWRITE_PROMPT_TEMPLATE.indexOf('{{FIXES}}')).toBeGreaterThan(
      JUDGE_REWRITE_PROMPT_TEMPLATE.indexOf('## Output'),
    );
    expect(JUDGE_REWRITE_PROMPT_TEMPLATE.endsWith('{{DRAFT}}')).toBe(true);
  });

  test('asks for one post and forbids adding substance', () => {
    expect(JUDGE_REWRITE_PROMPT_TEMPLATE).toContain('{"text": "..."}');
    expect(JUDGE_REWRITE_PROMPT_TEMPLATE).toContain('Address every fix below.');
    expect(JUDGE_REWRITE_PROMPT_TEMPLATE).toContain("aren't already in the draft");
  });
});
