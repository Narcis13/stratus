import { describe, expect, test } from 'bun:test';
import { REPLY_MODES, REPLY_ANGLES as SHARED_REPLY_ANGLES } from '../../shared/replyMode.ts';
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

  // RC.4 (plans/2026-08-08-reply-craft-overhaul.md, Task 4). The angle union is
  // ONE list, owned by src/shared/replyMode.ts, because the mode table narrows
  // the schema to `mode.angles` — a second copy here could offer an angle the
  // schema cannot represent, and the call would fail in strict mode.
  test('RC.4: the vocabulary is the shared one, five wide, and both schemas carry it', () => {
    expect([...REPLY_ANGLES]).toEqual([...SHARED_REPLY_ANGLES]);
    expect([...REPLY_ANGLES]).toEqual([
      'extends',
      'contrarian',
      'debate',
      'observation',
      'question',
    ]);
    expect(variantItemOf(REPLY_VARIANTS_SCHEMA).properties.angle.enum).toEqual([...REPLY_ANGLES]);
    expect(batchVariantItemOf(BATCH_REPLY_SCHEMA).properties.angle.enum).toEqual([...REPLY_ANGLES]);
  });

  test('RC.4: every mode narrows to a representable set, and stays strict-clean', () => {
    for (const mode of REPLY_MODES) {
      const single = replyVariantsSchema({ angles: mode.angles });
      const batch = batchReplySchema({ angles: mode.angles });
      expect(walkUnsupported(single)).toEqual([]);
      expect(walkUnsupported(batch)).toEqual([]);
      expect(variantItemOf(single).properties.angle.enum).toEqual([...mode.angles]);
      expect(batchVariantItemOf(batch).properties.angle.enum).toEqual([...mode.angles]);
    }
    // The one that matters: a grief post cannot be handed `contrarian` at all.
    const wholesome = REPLY_MODES.find((m) => m.id === 'wholesome');
    expect(
      variantItemOf(replyVariantsSchema({ angles: wholesome?.angles ?? [] })).properties.angle.enum,
    ).not.toContain('contrarian');
  });

  test('RC.4: the parsers keep the new angles instead of coercing them to extends', () => {
    expect(
      parseReplyVariants(
        '{"replies":[{"text":"the ear twitch at 0:04","angle":"observation","gloss":null},{"text":"which take did you keep?","angle":"question","gloss":null}]}',
      )?.map((v) => v.angle),
    ).toEqual(['observation', 'question']);
    expect(
      parseBatchReplies(
        '{"replies":[{"id":"111","variants":[{"text":"a","angle":"observation","gloss":null},{"text":"b","angle":"nonsense","gloss":null}]}]}',
      )?.[0]?.variants.map((v) => v.angle),
      // An unknown angle still falls back to `extends` — widening the union
      // widened what is KNOWN, it did not loosen the parser.
    ).toEqual(['observation', 'extends']);
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
