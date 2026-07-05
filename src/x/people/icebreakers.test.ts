import { describe, expect, test } from 'bun:test';
import {
  buildIcebreakerInput,
  parseIcebreakers,
  renderIcebreakerGrounding,
} from './icebreakers.ts';

const NOW = new Date('2026-07-05T12:00:00Z');

const EMPTY = {
  handle: 'ghost',
  displayName: null,
  stage: 'noticed' as const,
  bio: null,
  notes: null,
  exchanges: [],
  savedTweets: [],
  sharedChannels: [],
};

describe('renderIcebreakerGrounding', () => {
  test('no real shared context → null (a stage alone is not material)', () => {
    expect(renderIcebreakerGrounding(EMPTY, NOW)).toBeNull();
    expect(renderIcebreakerGrounding({ ...EMPTY, notes: '   ' }, NOW)).toBeNull();
  });

  test('renders only what it was given — nothing else to reference', () => {
    const g = renderIcebreakerGrounding(
      {
        ...EMPTY,
        handle: 'maker_jane',
        displayName: 'Jane',
        stage: 'responded',
        notes: 'met at the SQLite thread',
        exchanges: [
          {
            direction: 'outbound',
            at: new Date('2026-07-03T10:00:00Z'),
            summary: 'replied about local-first sync',
          },
        ],
        savedTweets: [{ text: 'shipping beats planning', createdAt: null }],
        sharedChannels: ['ai-craft'],
      },
      NOW,
    );
    expect(g).not.toBeNull();
    const text = g as string;
    expect(text).toContain('@maker_jane');
    expect(text).toContain('responded');
    expect(text).toContain('met at the SQLite thread');
    expect(text).toContain('me → them');
    expect(text).toContain('local-first sync');
    expect(text).toContain('shipping beats planning');
    expect(text).toContain('ai-craft');
    // Empty sections are omitted entirely, not rendered as headers.
    expect(text).not.toContain('THEIR BIO');
  });

  test('bio alone is enough material for a cold-but-honest opener', () => {
    const g = renderIcebreakerGrounding({ ...EMPTY, bio: 'indie hacker, sql fan' }, NOW);
    expect(g).toContain('indie hacker');
  });

  test('long inputs are clamped to one line', () => {
    const g = renderIcebreakerGrounding(
      { ...EMPTY, notes: `line one\nline two ${'x'.repeat(600)}` },
      NOW,
    ) as string;
    expect(g).not.toContain('\nline two');
    expect(g).toContain('line one line two');
  });
});

describe('buildIcebreakerInput', () => {
  test('grounding rides at the tail; the no-fabrication rule is in the prefix', () => {
    const [msg] = buildIcebreakerInput('GROUND-MARKER');
    const content = msg?.content ?? '';
    expect(content).toContain('Reference ONLY what is in it');
    expect(content.indexOf('GROUND-MARKER')).toBeGreaterThan(
      content.indexOf('Reference ONLY what is in it'),
    );
    expect(content.trimEnd().endsWith('GROUND-MARKER')).toBe(true);
  });
});

describe('parseIcebreakers', () => {
  test('valid, partial, and malformed payloads', () => {
    expect(parseIcebreakers('{"reply":" a ","dm":" b "}')).toEqual({ reply: 'a', dm: 'b' });
    expect(parseIcebreakers('{"reply":"a","dm":""}')).toBeNull();
    expect(parseIcebreakers('{"reply":"a"}')).toBeNull();
    expect(parseIcebreakers('nope')).toBeNull();
  });
});
