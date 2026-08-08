import { describe, expect, test } from 'bun:test';
import {
  GENERAL_MODE,
  REPLY_MODES,
  type ReplyMode,
  type ReplyModeId,
  REPLY_ANGLES as SHARED_REPLY_ANGLES,
} from '../../shared/replyMode.ts';
import {
  BATCH_REPLY_SCHEMA,
  type BatchTweet,
  MAX_GLOSS_LENGTH,
  type PostContext,
  REPLY_ANGLES,
  REPLY_BATCH_PROMPT_TEMPLATE,
  REPLY_PROMPT_TEMPLATE,
  REPLY_VARIANTS_SCHEMA,
  batchReplySchema,
  buildBatchGrokInput,
  buildGrokInput,
  parseBatchReplies,
  parseReplyVariants,
  renderBatchModeNote,
  renderBatchTweet,
  renderModeClause,
  renderReplyWinnersBlock,
  replyVariantsSchema,
} from './prompt.ts';
import type { ReplyWinner } from './winners.ts';

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

// RC.5 — the mode, rendered. Everything here is a per-call VALUE: the two
// byte-synced literals must not move for this feature, which is what the last
// test in the block asserts.
describe('RC.5 mode rendering', () => {
  const byId = (id: ReplyModeId): ReplyMode => {
    const m = REPLY_MODES.find((x) => x.id === id);
    if (!m) throw new Error(`${id} must exist in the table`);
    return m;
  };
  const WHOLESOME = byId('wholesome');
  const EXPERTISE = byId('expertise');
  const t: BatchTweet = { tweetId: '1', handle: 'someone', author: 'SO', text: 'post one' };

  test('the clause is ONE line — it rides at the tail and is paid for every call', () => {
    const clause = renderModeClause(WHOLESOME);
    expect(clause.includes('\n')).toBe(false);
    expect(clause).toContain('`wholesome`');
  });

  test('it carries the room, the persona level, the register, the move and the budget', () => {
    const clause = renderModeClause(WHOLESOME);
    expect(clause).toContain('Persona: off');
    expect(clause).toContain(WHOLESOME.registerNote);
    expect(clause).toContain(WHOLESOME.moves);
    expect(clause).toContain('30–90 characters');
  });

  test('the angle narrowing names the count, the allowed angles AND the excluded ones', () => {
    // wholesome allows three of five: the count matters because the head asks
    // for exactly three variants and a two-angle room would buy a duplicate.
    expect(renderModeClause(WHOLESOME)).toContain(
      'In this room produce exactly 3 variants, one per angle: observation, question and extends. No contrarian and debate.',
    );
    // banter allows two — the singular/plural and the count both move.
    expect(renderModeClause(byId('banter'))).toContain(
      'In this room produce exactly 2 variants, one per angle: observation and extends.',
    );
  });

  test('narrowAngles:false drops the angle sentence and keeps everything else', () => {
    const off = renderModeClause(WHOLESOME, { narrowAngles: false });
    // ML.3 already narrowed a resolved-language call to one `extends` variant;
    // two narrowing sentences in one tail is a contradiction the model arbitrates.
    expect(off).not.toContain('In this room produce');
    expect(off).toContain('Persona: off');
    expect(off).toContain('30–90 characters');
  });

  test('renderBatchTweet stays byte-identical without a mode, and adds ONE line with one', () => {
    const cold = renderBatchTweet(t, 0);
    expect(cold).not.toContain('MODE:');
    const warm = renderBatchTweet({ ...t, mode: EXPERTISE }, 0);
    expect(warm).toBe(`${cold}\nMODE: expertise`);
  });

  test('the legend describes each room ONCE, in first-seen order', () => {
    const note = renderBatchModeNote([WHOLESOME, EXPERTISE, WHOLESOME]);
    expect(note.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(2);
    expect(note.indexOf('`wholesome`')).toBeLessThan(note.indexOf('`expertise`'));
    // Only the rooms in the queue — a football batch never pays for six specs.
    expect(note).not.toContain('`banter`');
  });

  test('batch: no mode → byte-identical to the pre-RC.5 prompt; modes → one legend at the tail', () => {
    const cold = buildBatchGrokInput([t, { ...t, tweetId: '2' }])[0]?.content ?? '';
    expect(cold).not.toContain('MODE:');
    expect(cold).not.toContain('The rooms in this batch:');

    const warm =
      buildBatchGrokInput([
        { ...t, mode: WHOLESOME },
        { ...t, tweetId: '2', mode: WHOLESOME },
      ])[0]?.content ?? '';
    // Two MODE lines (one per post), one legend (the whole batch).
    expect(warm.split('MODE: wholesome').length - 1).toBe(2);
    expect(warm.split('The rooms in this batch:').length - 1).toBe(1);
    expect(warm.indexOf('The rooms in this batch:')).toBeGreaterThan(warm.indexOf('POST 2'));
  });

  test('batch: a resolved language turns the legend narrowing off and still lands BEFORE the clause', () => {
    const warm =
      buildBatchGrokInput([{ ...t, mode: WHOLESOME }], undefined, undefined, undefined, undefined, {
        language: 'Japanese',
        languageProfile: { code: 'ja' } as never,
      })[0]?.content ?? '';
    expect(warm).not.toContain('In this room produce');
    expect(warm.indexOf('Write all variants in Japanese')).toBeGreaterThan(
      warm.indexOf('The rooms in this batch:'),
    );
  });

  test('the general room renders like any other — a fallback is an answer, not an absence', () => {
    expect(renderModeClause(GENERAL_MODE)).toContain('`general`');
    expect(renderModeClause(GENERAL_MODE)).toContain('Persona: stance');
  });

  test('provenance: neither byte-synced literal carries the mode prose', () => {
    for (const template of [REPLY_PROMPT_TEMPLATE, REPLY_BATCH_PROMPT_TEMPLATE]) {
      expect(template).not.toContain("This post's room is");
      expect(template).not.toContain('The rooms in this batch:');
      expect(template).not.toContain('In this room produce');
    }
  });
});

// RC.6 — the measured few-shot, RENDERED. Selection is winners.test.ts's job;
// what is asserted here is the shape, the placement and (again) that neither
// byte-synced literal moved for it.
describe('RC.6 winners rendering', () => {
  const w = (mode: ReplyModeId, text: string, views: number): ReplyWinner => ({
    mode,
    text,
    views,
  });
  const WINNERS: ReplyWinner[] = [
    w('hot-take', 'IMO buying flowers once still beats forgetting tha request entirely', 19_088),
    w('hot-take', "Five years apart isn't predatory.", 2_248),
    w('wholesome', 'the ear twitch at 0:04', 311),
  ];
  const t: BatchTweet = { tweetId: '1', handle: 'someone', author: 'SO', text: 'post one' };
  const ctx: PostContext = {
    url: 'https://x.com/someone/status/1',
    tweetId: '1',
    author: 'SO',
    handle: 'someone',
    text: 'post one',
    postedAt: new Date().toISOString(),
    metrics: { views: 10, replies: 1, reposts: 0, likes: 2 },
    topComments: [],
  };

  test('every winner carries the yield it actually earned, grouped by room', () => {
    const block = renderReplyWinnersBlock(WINNERS);
    expect(block).toContain('`hot-take`\n1. [19088 views] IMO buying flowers');
    expect(block).toContain('`wholesome`\n1. [311 views] the ear twitch at 0:04');
    // Each room named once, in the order handed over.
    expect(block.indexOf('`hot-take`')).toBeLessThan(block.indexOf('`wholesome`'));
    expect(block.split('`hot-take`').length - 1).toBe(1);
  });

  test('the note says match the voice and never reuse the words', () => {
    const block = renderReplyWinnersBlock(WINNERS);
    expect(block).toContain('Never reuse their words');
    expect(block).toContain("never take a winner from one room as a template for another room's");
  });

  test('single: no winners → byte-identical to the pre-RC.6 prompt', () => {
    const cold = buildGrokInput(ctx)[0]?.content ?? '';
    expect(buildGrokInput(ctx, undefined, undefined, undefined, { winners: [] })[0]?.content).toBe(
      cold,
    );
  });

  test('single: the block lands AFTER the mode clause and BEFORE the language clause', () => {
    const mode = REPLY_MODES.find((m) => m.id === 'hot-take');
    if (!mode) throw new Error('hot-take must exist in the table');
    const content =
      buildGrokInput(ctx, undefined, undefined, undefined, {
        mode,
        winners: WINNERS,
        language: 'Japanese',
        languageProfile: { code: 'ja' } as never,
      })[0]?.content ?? '';
    const at = (s: string) => content.indexOf(s);
    expect(at("This post's room is")).toBeLessThan(at('Replies of mine that actually worked'));
    expect(at('Replies of mine that actually worked')).toBeLessThan(
      at('Write all variants in Japanese'),
    );
  });

  test('batch: the block lands after the legend that names its rooms', () => {
    const content =
      buildBatchGrokInput(
        [{ ...t, mode: GENERAL_MODE }],
        undefined,
        undefined,
        undefined,
        undefined,
        { winners: WINNERS },
      )[0]?.content ?? '';
    expect(content.indexOf('The rooms in this batch:')).toBeLessThan(
      content.indexOf('Replies of mine that actually worked'),
    );
    // One block for the whole batch, not one per post.
    expect(content.split('Replies of mine that actually worked').length - 1).toBe(1);
  });

  test('provenance: neither byte-synced literal carries the winners prose', () => {
    for (const template of [REPLY_PROMPT_TEMPLATE, REPLY_BATCH_PROMPT_TEMPLATE]) {
      expect(template).not.toContain('Replies of mine that actually worked');
      expect(template).not.toContain('{{REPLY_WINNERS}}');
    }
  });
});
