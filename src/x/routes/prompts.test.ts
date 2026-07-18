// AI.4 — prompt editor routes over the real (in-memory, auto-migrated) SQLite
// DB; `bun run test` runs with SQLITE_PATH=:memory:. The router carries no auth
// of its own (the /x bearer middleware is shared and covered by app.test /
// mcp.test), so it mounts on a bare Hono like niche.test / channels.test.
//
// CRITICAL: every override row this file writes is deleted again (afterEach +
// afterAll). Other suites (registry.test, test.test equivalence, app.test)
// render prompts over the SAME shared in-memory DB and must see defaults.

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { promptOverrides } from '../db/schema.ts';
import { POST_PROMPT_TEMPLATE } from '../posts/prompt.ts';
import { PROMPT_KEYS, loadPrompt } from '../prompts/registry.ts';
import { REPLY_PROMPT_TEMPLATE } from '../replies/prompt.ts';
import { promptsRouter } from './prompts.ts';

function clearOverrides() {
  db.delete(promptOverrides).run();
}

afterEach(clearOverrides);
afterAll(clearOverrides);

const app = new Hono();
app.route('/x', promptsRouter);

async function send<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  return { status: res.status, body: (await res.json()) as T };
}

// A valid custom reply body: both required placeholders + one unknown token
// (asserts unknownPlaceholders surfaces without failing the save).
const CUSTOM_REPLY = 'CUSTOM REPLY {{TWEET_CONTEXT}} <idea>{{IDEA}}</idea> {{MYSTERY}}';
const CUSTOM_POST = 'CUSTOM POST {{PILLARS}} {{MY_WINNERS}} {{REMIX}} {{PILLAR}} {{IDEA}}';

describe('GET /x/prompts (list)', () => {
  test('lists every registry key, all uncustomized on an empty table', async () => {
    const { status, body } = await send<
      Array<{
        key: string;
        name: string;
        description: string;
        required: string[];
        customized: boolean;
        updatedAt: number | null;
      }>
    >('/x/prompts', 'GET');
    expect(status).toBe(200);
    expect(body.map((p) => p.key).sort()).toEqual([...PROMPT_KEYS].sort());
    for (const p of body) {
      expect(p.customized).toBe(false);
      expect(p.updatedAt).toBeNull();
      expect(typeof p.name).toBe('string');
      expect(Array.isArray(p.required)).toBe(true);
    }
  });
});

describe('GET /x/prompts/:key', () => {
  test('returns the default body when uncustomized', async () => {
    const { status, body } = await send<{
      key: string;
      body: string;
      defaultBody: string;
      customized: boolean;
      required: string[];
    }>('/x/prompts/reply', 'GET');
    expect(status).toBe(200);
    expect(body.body).toBe(REPLY_PROMPT_TEMPLATE);
    expect(body.defaultBody).toBe(REPLY_PROMPT_TEMPLATE);
    expect(body.customized).toBe(false);
    expect(body.required).toContain('{{TWEET_CONTEXT}}');
  });

  test('unknown key → 404 unknown_prompt', async () => {
    const { status, body } = await send<{ error: string }>('/x/prompts/thread', 'GET');
    expect(status).toBe(404);
    expect(body.error).toBe('unknown_prompt');
  });
});

describe('PATCH /x/prompts/:key', () => {
  test('missing a required placeholder → 400 missing_placeholder + missing list', async () => {
    const { status, body } = await send<{ error: string; missing: string[] }>(
      '/x/prompts/reply',
      'PATCH',
      { body: 'has context {{TWEET_CONTEXT}} but no idea token' },
    );
    expect(status).toBe(400);
    expect(body.error).toBe('missing_placeholder');
    expect(body.missing).toContain('{{IDEA}}');
  });

  test('valid override → customized true, unknown tokens surfaced, GET reflects it', async () => {
    const patched = await send<{ customized: boolean; unknownPlaceholders: string[] }>(
      '/x/prompts/reply',
      'PATCH',
      { body: CUSTOM_REPLY },
    );
    expect(patched.status).toBe(200);
    expect(patched.body.customized).toBe(true);
    expect(patched.body.unknownPlaceholders).toEqual(['{{MYSTERY}}']);

    const got = await send<{ body: string; defaultBody: string; customized: boolean }>(
      '/x/prompts/reply',
      'GET',
    );
    expect(got.body.customized).toBe(true);
    expect(got.body.body).toBe(CUSTOM_REPLY);
    expect(got.body.body).not.toBe(got.body.defaultBody);

    // The registry (and thus every draft call site + GET /replies/default-prompt,
    // which all read loadPromptSafe) sees the override.
    expect(loadPrompt('reply').body).toBe(CUSTOM_REPLY);
    // The other key is untouched.
    expect(loadPrompt('post').customized).toBe(false);
  });

  test('body over 32KB → 413', async () => {
    const huge = `{{TWEET_CONTEXT}} {{IDEA}} ${'x'.repeat(33 * 1024)}`;
    const { status, body } = await send<{ error: string; maxBytes: number }>(
      '/x/prompts/reply',
      'PATCH',
      { body: huge },
    );
    expect(status).toBe(413);
    expect(body.error).toBe('body_too_large');
    expect(loadPrompt('reply').customized).toBe(false);
  });

  test('empty/absent body → 400 invalid_body_field', async () => {
    const empty = await send<{ error: string }>('/x/prompts/reply', 'PATCH', { body: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('invalid_body_field');
    const absent = await send<{ error: string }>('/x/prompts/reply', 'PATCH', { notBody: 1 });
    expect(absent.status).toBe(400);
    expect(absent.body.error).toBe('invalid_body_field');
  });

  test('unknown key → 404', async () => {
    const { status, body } = await send<{ error: string }>('/x/prompts/thread', 'PATCH', {
      body: 'x {{TWEET_CONTEXT}} {{IDEA}}',
    });
    expect(status).toBe(404);
    expect(body.error).toBe('unknown_prompt');
  });
});

describe('reset + restore-defaults', () => {
  test('reset deletes just this key’s override', async () => {
    await send('/x/prompts/reply', 'PATCH', { body: CUSTOM_REPLY });
    await send('/x/prompts/post', 'PATCH', { body: CUSTOM_POST });
    expect(loadPrompt('reply').customized).toBe(true);

    const { status, body } = await send<{ customized: boolean }>('/x/prompts/reply/reset', 'POST');
    expect(status).toBe(200);
    expect(body.customized).toBe(false);
    expect(loadPrompt('reply').customized).toBe(false);
    // post's override is untouched by a reply reset.
    expect(loadPrompt('post').customized).toBe(true);
  });

  test('reset unknown key → 404', async () => {
    const { status, body } = await send<{ error: string }>('/x/prompts/thread/reset', 'POST');
    expect(status).toBe(404);
    expect(body.error).toBe('unknown_prompt');
  });

  test('restore-defaults clears every override at once and reports the count', async () => {
    await send('/x/prompts/reply', 'PATCH', { body: CUSTOM_REPLY });
    await send('/x/prompts/post', 'PATCH', { body: CUSTOM_POST });

    const { status, body } = await send<{ restored: number }>(
      '/x/prompts/restore-defaults',
      'POST',
    );
    expect(status).toBe(200);
    expect(body.restored).toBe(2);

    const list = await send<Array<{ customized: boolean }>>('/x/prompts', 'GET');
    expect(list.body.every((p) => p.customized === false)).toBe(true);
    expect(loadPrompt('reply').customized).toBe(false);
    expect(loadPrompt('post').customized).toBe(false);
  });

  test('done-when chain: override → loadPrompt reflects → restore reverts', async () => {
    expect(loadPrompt('reply').body).toBe(REPLY_PROMPT_TEMPLATE);
    await send('/x/prompts/reply', 'PATCH', { body: CUSTOM_REPLY });
    expect(loadPrompt('reply').body).toBe(CUSTOM_REPLY);
    await send('/x/prompts/restore-defaults', 'POST');
    expect(loadPrompt('reply').body).toBe(REPLY_PROMPT_TEMPLATE);
    expect(loadPrompt('post').body).toBe(POST_PROMPT_TEMPLATE);
  });
});
