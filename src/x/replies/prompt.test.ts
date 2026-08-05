import { describe, expect, test } from 'bun:test';
import {
  BATCH_REPLY_SCHEMA,
  MAX_GLOSS_LENGTH,
  REPLY_ANGLES,
  REPLY_VARIANTS_SCHEMA,
  batchReplySchema,
  parseBatchReplies,
  parseReplyVariants,
  replyVariantsSchema,
} from './prompt.ts';

// The D164b walk: strict structured outputs reject these keywords outright, and
// a schema that carries one fails the call rather than degrading. Same walk
// curate.test.ts runs — the two schemas must not drift apart on it.
const walkUnsupported = (node: unknown): string[] => {
  if (!node || typeof node !== 'object') return [];
  const found: string[] = [];
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (['minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength'].includes(k)) {
      found.push(k);
    }
    found.push(...walkUnsupported(v));
  }
  return found;
};

// biome-ignore lint/suspicious/noExplicitAny: schema literals are plain JSON.
const variantItemOf = (schema: any) => schema.properties.replies.items;
// biome-ignore lint/suspicious/noExplicitAny: schema literals are plain JSON.
const batchVariantItemOf = (schema: any) =>
  schema.properties.replies.items.properties.variants.items;

describe('ML.2 reply schemas', () => {
  test('both schemas are strict-mode clean — no unsupported keywords', () => {
    expect(walkUnsupported(REPLY_VARIANTS_SCHEMA)).toEqual([]);
    expect(walkUnsupported(BATCH_REPLY_SCHEMA)).toEqual([]);
    expect(walkUnsupported(replyVariantsSchema({ angles: ['extends'] }))).toEqual([]);
    expect(walkUnsupported(batchReplySchema({ angles: ['extends'] }))).toEqual([]);
  });

  test('gloss is nullable AND required — strict mode has no optional properties', () => {
    for (const item of [
      variantItemOf(REPLY_VARIANTS_SCHEMA),
      batchVariantItemOf(BATCH_REPLY_SCHEMA),
    ]) {
      expect(item.properties.gloss.type).toEqual(['string', 'null']);
      expect(item.required).toEqual(['text', 'angle', 'gloss']);
      expect(item.additionalProperties).toBe(false);
    }
  });

  test('the no-arg builders deep-equal the exported default consts', () => {
    // A fresh object each call (so this is a real comparison, not identity) and
    // byte-identical to what today's callers already pass.
    expect(replyVariantsSchema()).not.toBe(REPLY_VARIANTS_SCHEMA);
    expect(replyVariantsSchema()).toEqual(REPLY_VARIANTS_SCHEMA);
    expect(batchReplySchema()).toEqual(BATCH_REPLY_SCHEMA);
    expect(variantItemOf(REPLY_VARIANTS_SCHEMA).properties.angle.enum).toEqual([...REPLY_ANGLES]);
  });

  test('angles:[extends] makes contrarian and debate UNREPRESENTABLE', () => {
    expect(
      variantItemOf(replyVariantsSchema({ angles: ['extends'] })).properties.angle.enum,
    ).toEqual(['extends']);
    expect(
      batchVariantItemOf(batchReplySchema({ angles: ['extends'] })).properties.angle.enum,
    ).toEqual(['extends']);
    // Everything else about the narrowed schema is unchanged.
    expect(replyVariantsSchema({ angles: ['extends'] }).required).toEqual(['replies']);
  });
});

describe('ML.2 gloss parsing (§7.35 asymmetry)', () => {
  test('a real gloss survives, trimmed', () => {
    expect(
      parseReplyVariants('{"replies":[{"text":"はい","angle":"extends","gloss":"  Yes.  "}]}'),
    ).toEqual([{ text: 'はい', angle: 'extends', gloss: 'Yes.' }]);
  });

  test('missing, null, non-string or blank gloss → null, and the variant SURVIVES', () => {
    for (const body of [
      '{"replies":[{"text":"x","angle":"extends"}]}',
      '{"replies":[{"text":"x","angle":"extends","gloss":null}]}',
      '{"replies":[{"text":"x","angle":"extends","gloss":42}]}',
      '{"replies":[{"text":"x","angle":"extends","gloss":{"a":1}}]}',
      '{"replies":[{"text":"x","angle":"extends","gloss":"   "}]}',
    ]) {
      expect(parseReplyVariants(body)).toEqual([{ text: 'x', angle: 'extends', gloss: null }]);
    }
  });

  test('a long gloss is CLIPPED, never rejected — it rides a variant already paid for', () => {
    const long = 'g'.repeat(MAX_GLOSS_LENGTH + 50);
    const out = parseReplyVariants(
      `{"replies":[{"text":"x","angle":"extends","gloss":"${long}"}]}`,
    );
    expect(out?.[0]?.gloss?.length).toBe(MAX_GLOSS_LENGTH);
  });

  test('the parser still returns all three variants when handed three (no trim here)', () => {
    const out = parseReplyVariants(
      '{"replies":[{"text":"a","angle":"extends","gloss":null},{"text":"b","angle":"contrarian","gloss":null},{"text":"c","angle":"debate","gloss":null}]}',
    );
    expect(out?.length).toBe(3);
    expect(out?.map((v) => v.angle)).toEqual(['extends', 'contrarian', 'debate']);
  });

  test('the batch parser reads gloss the same way, per variant', () => {
    expect(
      parseBatchReplies(
        '{"replies":[{"id":"111","variants":[{"text":"はい","angle":"extends","gloss":"Yes."},{"text":"b","angle":"debate","gloss":7}]}]}',
      ),
    ).toEqual([
      {
        tweetId: '111',
        variants: [
          { text: 'はい', angle: 'extends', gloss: 'Yes.' },
          { text: 'b', angle: 'debate', gloss: null },
        ],
      },
    ]);
  });

  test('a bad gloss never rescues a bad text — text stays strict', () => {
    expect(
      parseReplyVariants('{"replies":[{"text":"   ","angle":"extends","gloss":"fine gloss"}]}'),
    ).toBeNull();
  });
});
