// Article assist prompt (A3.12) — byte-sync with `article prompt.md`, the stable
// cacheable prefix across differing tails (incl. a Romanian idea), the language
// contract's presence, and per-mode schema parsing. The paid Grok path itself is
// exercised only by the A3.15 --live smoke (no mock harness — the A3.9 DM
// convention); here everything is pure and $0.

import { describe, expect, test } from 'bun:test';
import {
  ARTICLE_PROMPT_TEMPLATE,
  type ArticleAssistContext,
  buildArticleAssistInput,
  parseAssist,
} from './prompt.ts';

const EMPTY_CTX: Omit<ArticleAssistContext, 'idea'> = {
  pillars: [],
  winners: [],
  guidance: null,
  article: { title: 'Untitled', subtitle: null, outline: null, bodyMd: '' },
  heading: null,
  selection: null,
};

describe('article prompt (A3.12)', () => {
  test('embedded template stays byte-identical to article prompt.md', async () => {
    const md = await Bun.file(new URL('../../../article prompt.md', import.meta.url)).text();
    expect(ARTICLE_PROMPT_TEMPLATE.trimEnd()).toBe(md.trimEnd());
  });

  test('all five tail placeholders are present and the instruction is last', () => {
    for (const token of [
      '{{PILLARS}}',
      '{{WINNERS}}',
      '{{GUIDANCE}}',
      '{{ARTICLE}}',
      '{{INSTRUCTION}}',
    ]) {
      expect(ARTICLE_PROMPT_TEMPLATE.includes(token)).toBe(true);
    }
    // {{INSTRUCTION}} is the very last thing so per-call content never shifts the
    // cacheable prefix.
    expect(ARTICLE_PROMPT_TEMPLATE.trimEnd().endsWith('{{INSTRUCTION}}')).toBe(true);
  });

  test('language contract lives in the template (so an override cannot silently drop it)', () => {
    expect(ARTICLE_PROMPT_TEMPLATE.includes('ALWAYS natural English')).toBe(true);
    expect(ARTICLE_PROMPT_TEMPLATE.toLowerCase().includes('any language')).toBe(true);
  });

  test('the instruction block is byte-stable across two different tails (English vs Romanian idea)', () => {
    const [english] = buildArticleAssistInput('outline', {
      ...EMPTY_CTX,
      idea: 'How I ship a project every 30 days',
    });
    const [romanian] = buildArticleAssistInput('outline', {
      ...EMPTY_CTX,
      idea: 'Cum livrez un proiect la fiecare 30 de zile',
    });
    const marker = 'WHAT TO DO NOW:';
    const prefixEn = english?.content.slice(0, english.content.indexOf(marker));
    const prefixRo = romanian?.content.slice(0, romanian.content.indexOf(marker));
    expect(prefixEn).toBe(prefixRo);
    // ...but the tail did change — the Romanian idea rode through into the tail.
    expect(english?.content).not.toBe(romanian?.content);
    expect(romanian?.content.includes('Cum livrez')).toBe(true);
  });

  test('buildArticleAssistInput substitutes the grounding blocks (no raw tokens left)', () => {
    const [msg] = buildArticleAssistInput('full', { ...EMPTY_CTX, idea: 'a topic' });
    expect(msg?.content.includes('{{')).toBe(false);
    expect(msg?.content.includes('(no measured winners yet)')).toBe(true);
    expect(msg?.content.includes('(none yet)')).toBe(true);
  });

  test('parseAssist: outline shape', () => {
    const ok = parseAssist(
      'outline',
      JSON.stringify({
        title: 'T',
        subtitle: 'S',
        sections: [{ heading: 'H1', beats: ['b1', 'b2'] }],
      }),
    );
    expect(ok).toEqual({
      title: 'T',
      subtitle: 'S',
      sections: [{ heading: 'H1', beats: ['b1', 'b2'] }],
    });
    // missing sections → null; truncated JSON → null.
    expect(parseAssist('outline', JSON.stringify({ title: 'T', subtitle: 'S' }))).toBeNull();
    expect(
      parseAssist('outline', '{"title":"T","subtitle":"S","sections":[{"heading":'),
    ).toBeNull();
    // a section with no heading is rejected.
    expect(
      parseAssist(
        'outline',
        JSON.stringify({ title: 'T', subtitle: 'S', sections: [{ heading: '', beats: [] }] }),
      ),
    ).toBeNull();
  });

  test('parseAssist: section/polish return markdown; empty → null', () => {
    expect(parseAssist('section', JSON.stringify({ markdown: '## Hi\n\nbody' }))).toEqual({
      markdown: '## Hi\n\nbody',
    });
    expect(parseAssist('polish', JSON.stringify({ markdown: 'tight' }))).toEqual({
      markdown: 'tight',
    });
    expect(parseAssist('section', JSON.stringify({ markdown: '   ' }))).toBeNull();
    expect(parseAssist('polish', JSON.stringify({}))).toBeNull();
  });

  test('parseAssist: full requires title + subtitle + markdown', () => {
    expect(
      parseAssist('full', JSON.stringify({ title: 'T', subtitle: 'S', markdown: '# body' })),
    ).toEqual({ title: 'T', subtitle: 'S', markdown: '# body' });
    expect(parseAssist('full', JSON.stringify({ title: 'T', subtitle: 'S' }))).toBeNull();
    expect(parseAssist('full', JSON.stringify({ title: 'T', markdown: 'x' }))).toBeNull();
  });
});
