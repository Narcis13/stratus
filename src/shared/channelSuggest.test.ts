import { describe, expect, test } from 'bun:test';
import { suggestChannels } from './channelSuggest.ts';

const CHANNELS = [
  { slug: 'ai-agents', keywords: ['ai agent', 'agents', 'claude', 'mcp'] },
  { slug: 'indie-smb', keywords: ['smb', 'small business', 'solopreneur'] },
  { slug: 'claude-code', keywords: ['claude code', '#buildinpublic'] },
  { slug: 'no-keywords', keywords: null },
  { slug: 'empty-keywords', keywords: [] },
];

describe('suggestChannels', () => {
  test('matches keywords case-insensitively on word boundaries', () => {
    expect(suggestChannels('Shipped a new AI agent today', CHANNELS)).toEqual(['ai-agents']);
    expect(suggestChannels('CLAUDE is great', CHANNELS)).toEqual(['ai-agents']);
  });

  test('substring inside a word does not fire', () => {
    // "agents" inside "reagents", "smb" inside "asmbly"
    expect(suggestChannels('lab reagents and asmbly lines', CHANNELS)).toEqual([]);
  });

  test('phrase and hashtag keywords match', () => {
    expect(suggestChannels('day 3 of #buildinpublic with claude code', CHANNELS)).toEqual([
      'claude-code',
      'ai-agents', // "claude code" also contains the word "claude"
    ]);
  });

  test('ranks by keyword hit count, slug asc tie-break', () => {
    const out = suggestChannels('claude runs my mcp agents for a solopreneur', CHANNELS);
    expect(out).toEqual(['ai-agents', 'indie-smb']);
  });

  test('punctuation counts as a boundary', () => {
    expect(suggestChannels('agents, everywhere', CHANNELS)).toEqual(['ai-agents']);
    expect(suggestChannels('(claude)', CHANNELS)).toEqual(['ai-agents']);
  });

  test('channels without keywords never self-suggest', () => {
    expect(suggestChannels('no keywords empty keywords', CHANNELS)).toEqual([]);
  });

  test('empty text suggests nothing', () => {
    expect(suggestChannels('', CHANNELS)).toEqual([]);
    expect(suggestChannels('   ', CHANNELS)).toEqual([]);
  });

  test('regex metacharacters in keywords are taken literally', () => {
    const chans = [{ slug: 'cpp', keywords: ['c++'] }];
    expect(suggestChannels('learning c++ today', chans)).toEqual(['cpp']);
    expect(suggestChannels('learning c today', chans)).toEqual([]);
  });
});
