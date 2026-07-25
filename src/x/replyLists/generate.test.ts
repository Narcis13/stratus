// RL.4 — the reply-list item generator's pure halves: the prompt assembly
// (variable tail, $-safety, registry template threading) and the response parse
// (drop/dedupe/degrade rules). No DB, no network — the route suite covers the
// pre-spend guards.

import { describe, expect, test } from 'bun:test';
import { MAX_REPLY_LENGTH } from './engine.ts';
import {
  DEFAULT_GENERATED_ITEMS,
  MAX_GENERATED_ITEMS,
  REPLY_LIST_PROMPT_TEMPLATE,
  buildListGenInput,
  parseGeneratedItems,
} from './generate.ts';

function content(opts: Parameters<typeof buildListGenInput>[0]): string {
  const [msg] = buildListGenInput(opts);
  if (!msg) throw new Error('no message built');
  return msg.content;
}

describe('buildListGenInput (RL.4)', () => {
  test('the request and the existing items land after the instruction block', () => {
    const out = content({
      prompt: 'short congratulation replies',
      count: 7,
      existingItems: ['congrats!', 'huge, {first_name}'],
    });

    // Instructions first, per-call content last (§7.15) — otherwise the
    // cacheable prefix moves on every call.
    const rules = out.indexOf('## Rules');
    expect(rules).toBeGreaterThan(-1);
    expect(out.indexOf('short congratulation replies')).toBeGreaterThan(rules);
    expect(out.indexOf('huge, {first_name}')).toBeGreaterThan(
      out.indexOf('short congratulation replies'),
    );

    expect(out).toContain('Exactly 7 items');
    expect(out).toContain('congrats!\nhuge, {first_name}');
    expect(out).not.toContain('{{COUNT}}');
    expect(out).not.toContain('{{REQUEST}}');
    expect(out).not.toContain('{{EXISTING_ITEMS}}');
  });

  test('empty list and default count degrade to placeholders, not empty holes', () => {
    const out = content({ prompt: 'banter replies' });
    expect(out).toContain('(none yet — this list is empty)');
    expect(out).toContain(`Exactly ${DEFAULT_GENERATED_ITEMS} items`);
  });

  test('a registry override body is the base; the shipped default is byte-identical', () => {
    const marker = 'OVERRIDE-MARKER {{COUNT}} | {{REQUEST}} | {{EXISTING_ITEMS}}';
    const overridden = content({ prompt: 'thanks replies', template: marker });
    expect(overridden).toBe(
      'OVERRIDE-MARKER Exactly 12 | thanks replies | (none yet — this list is empty)',
    );

    const withDefault = content({ prompt: 'x', count: 5, template: REPLY_LIST_PROMPT_TEMPLATE });
    const without = content({ prompt: 'x', count: 5 });
    expect(withDefault).toBe(without);
  });

  test('$-sequences in user content survive verbatim (split/join, not replace)', () => {
    const out = content({ prompt: "replies about $& and $' and $1", existingItems: ['$`'] });
    expect(out).toContain("replies about $& and $' and $1");
    expect(out).toContain('$`');
  });

  test('the prompt itself carries no persona token (cache prefix stays niche-independent)', () => {
    expect(REPLY_LIST_PROMPT_TEMPLATE).not.toContain('{{PERSONA}}');
    expect(REPLY_LIST_PROMPT_TEMPLATE).not.toContain('{{REPLY_PERSONA}}');
  });
});

describe('parseGeneratedItems (RL.4)', () => {
  test('happy path returns items in order, ready to POST to /items', () => {
    const items = parseGeneratedItems(
      JSON.stringify({ items: [{ text: '  congrats! ' }, { text: 'huge, {name}' }] }),
    );
    expect(items).toEqual([{ text: 'congrats!' }, { text: 'huge, {name}' }]);
  });

  test('drops empty and over-long entries, keeps the rest', () => {
    const items = parseGeneratedItems(
      JSON.stringify({
        items: [
          { text: '   ' },
          { text: 'x'.repeat(MAX_REPLY_LENGTH + 1) },
          { text: 'y'.repeat(MAX_REPLY_LENGTH) },
          { text: 42 },
          'a bare string',
          null,
          { text: 'keeper' },
        ],
      }),
    );
    expect(items).toEqual([{ text: 'y'.repeat(MAX_REPLY_LENGTH) }, { text: 'keeper' }]);
  });

  test('dedupes on casing and whitespace, keeping the first spelling', () => {
    const items = parseGeneratedItems(
      JSON.stringify({
        items: [{ text: 'Love this' }, { text: 'love   this' }, { text: 'love this too' }],
      }),
    );
    expect(items).toEqual([{ text: 'Love this' }, { text: 'love this too' }]);
  });

  test('caps at the requested count', () => {
    const many = { items: Array.from({ length: 20 }, (_, i) => ({ text: `item ${i}` })) };
    expect(parseGeneratedItems(JSON.stringify(many), 5)).toHaveLength(5);
    expect(parseGeneratedItems(JSON.stringify(many))).toHaveLength(20);
  });

  test('malformed output degrades to null, never to bad rows', () => {
    expect(parseGeneratedItems('not json')).toBeNull();
    expect(parseGeneratedItems('[]')).toBeNull();
    expect(parseGeneratedItems(JSON.stringify({ items: 'nope' }))).toBeNull();
    expect(parseGeneratedItems(JSON.stringify({ nope: [] }))).toBeNull();
    // A well-formed envelope with nothing usable is an empty array, not null —
    // the route tells those two apart (parse error vs nothing survived).
    expect(parseGeneratedItems(JSON.stringify({ items: [{ text: '' }] }))).toEqual([]);
  });

  test('the ceiling is the default cap', () => {
    const many = { items: Array.from({ length: 40 }, (_, i) => ({ text: `item ${i}` })) };
    expect(parseGeneratedItems(JSON.stringify(many))).toHaveLength(MAX_GENERATED_ITEMS);
  });
});
