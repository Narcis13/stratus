// Prompt registry (AI.3): override-rows-only storage, sha cache keys,
// placeholder validation, and the template param threaded into both prompt
// builders. Runs over the shared in-memory DB — every override row this file
// writes is deleted again (other suites render prompts and must see defaults).

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { db } from '../../db/client.ts';
import { promptOverrides } from '../db/schema.ts';
import { DIGEST_PROMPT_TEMPLATE } from '../digest.ts';
import { ICEBREAKER_PROMPT_TEMPLATE } from '../people/icebreakers.ts';
import { PILLAR_DRAFT_TEMPLATE } from '../posts/pillarDraft.ts';
import { POST_PROMPT_TEMPLATE, buildPostDraftInput } from '../posts/prompt.ts';
import { THREAD_PROMPT_TEMPLATE } from '../posts/threadPrompt.ts';
import {
  type PostContext,
  REPLY_BATCH_PROMPT_TEMPLATE,
  REPLY_PROMPT_TEMPLATE,
  buildGrokInput,
} from '../replies/prompt.ts';
import { EXTRACT_PROMPT_TEMPLATE } from '../voice/extractPrompt.ts';
import {
  PROMPT_KEYS,
  PROMPT_SPECS,
  isPromptKey,
  loadPrompt,
  loadPromptSafe,
  promptCacheKey,
  renderPrompt,
  validatePromptBody,
} from './registry.ts';

function clearOverrides() {
  db.delete(promptOverrides).run();
}

afterEach(clearOverrides);
afterAll(clearOverrides);

const ctx: PostContext = {
  tweetId: '123456',
  handle: 'someone',
  author: 'Some One',
  text: 'a tweet about agents',
  url: 'https://x.com/someone/status/123456',
  postedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  metrics: { views: 1500, replies: 8, reposts: 2, likes: 30 },
  topComments: [],
};

describe('prompt registry (AI.3)', () => {
  test('keys + specs: defaults are the byte-synced templates, required present', () => {
    expect(PROMPT_KEYS).toEqual([
      'reply',
      'reply-batch',
      'post',
      'thread',
      'rewrite',
      'voice-extract',
      'pillar-draft',
      'digest',
      'icebreaker',
    ]);
    expect(isPromptKey('reply')).toBe(true);
    expect(isPromptKey('reply-batch')).toBe(true);
    expect(isPromptKey('digest')).toBe(true);
    expect(isPromptKey('icebreaker')).toBe(true);
    expect(isPromptKey('thread')).toBe(true);
    expect(isPromptKey('rewrite')).toBe(true);
    expect(isPromptKey('nonsense')).toBe(false);
    expect(PROMPT_SPECS.reply.defaultBody).toBe(REPLY_PROMPT_TEMPLATE);
    expect(PROMPT_SPECS.post.defaultBody).toBe(POST_PROMPT_TEMPLATE);
    expect(PROMPT_SPECS.thread.defaultBody).toBe(THREAD_PROMPT_TEMPLATE);
    expect(PROMPT_SPECS['reply-batch'].defaultBody).toBe(REPLY_BATCH_PROMPT_TEMPLATE);
    expect(PROMPT_SPECS['voice-extract'].defaultBody).toBe(EXTRACT_PROMPT_TEMPLATE);
    expect(PROMPT_SPECS['pillar-draft'].defaultBody).toBe(PILLAR_DRAFT_TEMPLATE);
    expect(PROMPT_SPECS.digest.defaultBody).toBe(DIGEST_PROMPT_TEMPLATE);
    expect(PROMPT_SPECS.icebreaker.defaultBody).toBe(ICEBREAKER_PROMPT_TEMPLATE);
    // Every spec's own default must validate clean — required present, no
    // unknown tokens (the optional niche placeholders are known).
    for (const key of PROMPT_KEYS) {
      const v = validatePromptBody(key, PROMPT_SPECS[key].defaultBody);
      expect(v.ok).toBe(true);
      expect(v.missing).toEqual([]);
      expect(v.unknown).toEqual([]);
    }
  });

  test('loadPrompt: default fallback on empty table', () => {
    const loaded = loadPrompt('reply');
    expect(loaded.body).toBe(REPLY_PROMPT_TEMPLATE);
    expect(loaded.customized).toBe(false);
    expect(loaded.cacheKey.startsWith('stratus-x-reply:')).toBe(true);
    expect(loadPromptSafe('reply')).toEqual(loaded);
  });

  test('loadPrompt: override row wins, delete restores the default', () => {
    const body = 'Custom reply prompt.\n\n{{TWEET_CONTEXT}}\n\n<idea>{{IDEA}}</idea>';
    db.insert(promptOverrides).values({ key: 'reply', body }).run();
    const loaded = loadPrompt('reply');
    expect(loaded.body).toBe(body);
    expect(loaded.customized).toBe(true);
    expect(loaded.cacheKey).not.toBe(loadPrompt('post').cacheKey);
    expect(loaded.cacheKey).not.toBe(promptCacheKey('reply', REPLY_PROMPT_TEMPLATE));
    // The other key is untouched by a reply override.
    expect(loadPrompt('post').customized).toBe(false);

    db.delete(promptOverrides).run();
    expect(loadPrompt('reply').body).toBe(REPLY_PROMPT_TEMPLATE);
  });

  test('promptCacheKey: stable per body, distinct per body and per key', () => {
    expect(promptCacheKey('reply', 'abc')).toBe(promptCacheKey('reply', 'abc'));
    expect(promptCacheKey('reply', 'abc')).not.toBe(promptCacheKey('reply', 'abcd'));
    expect(promptCacheKey('reply', 'abc')).not.toBe(promptCacheKey('post', 'abc'));
    expect(promptCacheKey('reply', 'abc')).toMatch(/^stratus-x-reply:[0-9a-f]{8}$/);
  });

  test('validatePromptBody: missing required placeholders are listed', () => {
    const v = validatePromptBody('reply', 'no placeholders at all');
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(['{{TWEET_CONTEXT}}', '{{IDEA}}']);

    const partial = validatePromptBody('post', '{{PILLARS}} {{MY_WINNERS}} {{IDEA}}');
    expect(partial.ok).toBe(false);
    expect(partial.missing).toEqual(['{{REMIX}}', '{{PILLAR}}']);
  });

  test('validatePromptBody: optional niche placeholders may be dropped', () => {
    // An override that hardcodes its own persona (no {{REPLY_PERSONA}}) is
    // sanctioned — token-tolerant substitution just passes it through.
    const v = validatePromptBody('reply', 'My own persona.\n{{TWEET_CONTEXT}}\n{{IDEA}}');
    expect(v.ok).toBe(true);
    expect(v.missing).toEqual([]);
    expect(v.unknown).toEqual([]);
  });

  test('validatePromptBody: unknown {{TOKENS}} are a deduped warning, not an error', () => {
    const v = validatePromptBody(
      'reply',
      '{{TWEET_CONTEXT}} {{IDEA}} {{MYSTERY}} {{MYSTERY}} {{REPLY_PERSONA}} {{lower_case}}',
    );
    expect(v.ok).toBe(true);
    expect(v.unknown).toEqual(['{{MYSTERY}}']);
  });

  test('renderPrompt: replaces all occurrences, $-safe, unknown tokens untouched', () => {
    expect(renderPrompt('{{A}} and {{A}} then {{B}}', { A: 'x', B: 'y' })).toBe('x and x then y');
    expect(renderPrompt('{{A}}', { A: "$& $' $1" })).toBe("$& $' $1");
    expect(renderPrompt('{{A}} {{KEEP}}', { A: 'x' })).toBe('x {{KEEP}}');
  });
});

describe('template param in the prompt builders (AI.3)', () => {
  test('buildGrokInput: opts.template is the base when no per-request override', () => {
    const marker = 'OVERRIDE-MARKER-REPLY {{TWEET_CONTEXT}} <idea>{{IDEA}}</idea>';
    const [msg] = buildGrokInput(ctx, undefined, 'my idea', undefined, { template: marker });
    expect(msg?.content).toContain('OVERRIDE-MARKER-REPLY');
    expect(msg?.content).toContain('a tweet about agents');
    expect(msg?.content).toContain('<idea>my idea</idea>');
    expect(msg?.content).not.toContain('{{TWEET_CONTEXT}}');
  });

  test('buildGrokInput: a per-request systemPromptOverride still beats the template', () => {
    const [msg] = buildGrokInput(ctx, 'REQUEST-OVERRIDE {{TWEET_CONTEXT}}', undefined, undefined, {
      template: 'DB-TEMPLATE {{TWEET_CONTEXT}}',
    });
    expect(msg?.content).toContain('REQUEST-OVERRIDE');
    expect(msg?.content).not.toContain('DB-TEMPLATE');
  });

  test('buildGrokInput: {{REPLY_PERSONA}} in a custom template still substitutes', () => {
    const [msg] = buildGrokInput(ctx, undefined, undefined, undefined, {
      template: 'PERSONA: {{REPLY_PERSONA}}\n{{TWEET_CONTEXT}}',
      replyPersona: 'a test persona',
    });
    expect(msg?.content).toContain('PERSONA: a test persona');
    expect(msg?.content).not.toContain('{{REPLY_PERSONA}}');
  });

  test('buildGrokInput: explicit default template is byte-identical to omitting it', () => {
    const withDefault = buildGrokInput(ctx, undefined, 'idea', undefined, {
      template: REPLY_PROMPT_TEMPLATE,
    });
    const without = buildGrokInput(ctx, undefined, 'idea');
    expect(withDefault[0]?.content).toBe(without[0]?.content);
  });

  test('buildPostDraftInput: opts.template is the base; default is byte-identical', () => {
    const marker =
      'OVERRIDE-MARKER-POST {{PILLARS}} {{MY_WINNERS}} {{REMIX}} <pillar>{{PILLAR}}</pillar> <idea>{{IDEA}}</idea>';
    const [msg] = buildPostDraftInput({ winners: [], idea: 'steer', template: marker });
    expect(msg?.content).toContain('OVERRIDE-MARKER-POST');
    expect(msg?.content).toContain('<idea>steer</idea>');
    expect(msg?.content).toContain('(no measured winners yet)');

    const withDefault = buildPostDraftInput({
      winners: [],
      idea: 'steer',
      template: POST_PROMPT_TEMPLATE,
    });
    const without = buildPostDraftInput({ winners: [], idea: 'steer' });
    expect(withDefault[0]?.content).toBe(without[0]?.content);
  });
});
