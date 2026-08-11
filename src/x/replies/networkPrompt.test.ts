// NW.1 — the networking objective's prompt and its one-variant contract.
//
// Everything here is PURE and $0: the template's placeholder contract (what the
// registry will refuse an override for), the guarantees that make this prompt a
// different objective rather than the reach prompt with a new name, and the trim
// that turns whatever the model returned into exactly one `network` variant.
// The route-level half (which registry key loads, which blocks are withheld)
// lives in routes/replies.test.ts, against the stubbed provider.

import { describe, expect, test } from 'bun:test';
import { REPLY_ANGLES, ROOM_ANGLES } from '../../shared/replyMode.ts';
import { PROMPT_SPECS, validatePromptBody } from '../prompts/registry.ts';
import { NETWORK_BATCH_PROMPT_TEMPLATE, toNetworkVariants } from './networkPrompt.ts';
import { REPLY_BATCH_PROMPT_TEMPLATE, type ReplyVariant } from './prompt.ts';

describe('the networking template (NW.1)', () => {
  test('it is the registry default for its key and satisfies its own contract', () => {
    const spec = PROMPT_SPECS['reply-batch-network'];
    expect(spec.defaultBody).toBe(NETWORK_BATCH_PROMPT_TEMPLATE);
    const v = validatePromptBody('reply-batch-network', NETWORK_BATCH_PROMPT_TEMPLATE);
    expect(v.ok).toBe(true);
    expect(v.missing).toEqual([]);
    // An unknown {{TOKEN}} in a shipped default is a render bug, not a warning:
    // it would print literally in every prompt this key ever sends.
    expect(v.unknown).toEqual([]);
  });

  // The persona's absence is the POINT of this prompt, so it is asserted rather
  // than left to the reader of the template: the route deliberately loads no
  // niche persona on this path, and a token here would render as literal text.
  test('no persona token, in the template or in the spec', () => {
    expect(NETWORK_BATCH_PROMPT_TEMPLATE).not.toContain('{{REPLY_PERSONA}}');
    expect(PROMPT_SPECS['reply-batch-network'].optional).toEqual([]);
    expect(REPLY_BATCH_PROMPT_TEMPLATE).toContain('{{REPLY_PERSONA}}');
  });

  test('it asks for ONE variant on the network angle, never the reach three', () => {
    expect(NETWORK_BATCH_PROMPT_TEMPLATE).toContain('EXACTLY ONE variant');
    expect(NETWORK_BATCH_PROMPT_TEMPLATE).toContain('"angle": "network"');
    // The three-angle vocabulary belongs to the other objective. A copy of it
    // drifting in here is how the switch quietly stops being a switch.
    expect(NETWORK_BATCH_PROMPT_TEMPLATE).not.toContain('exactly three variants');
    for (const angle of ROOM_ANGLES) {
      expect(NETWORK_BATCH_PROMPT_TEMPLATE).not.toContain(`**${angle}**`);
    }
  });

  // The two rules the user's brief turns on, and the two most likely to be lost
  // in a later edit: the reply reads as typed rather than composed, and the OP —
  // not the reply stack — is who it is written to.
  test('the punctuation floor and the audience are both stated', () => {
    expect(NETWORK_BATCH_PROMPT_TEMPLATE).toContain('No terminal punctuation.');
    expect(NETWORK_BATCH_PROMPT_TEMPLATE).toContain('No em dashes. Not one.');
    expect(NETWORK_BATCH_PROMPT_TEMPLATE).toContain('a real newline between them');
    expect(NETWORK_BATCH_PROMPT_TEMPLATE).toContain('recognition, not praise');
  });
});

describe('toNetworkVariants (NW.1) — the one-variant contract', () => {
  const v = (text: string, angle: ReplyVariant['angle']): ReplyVariant => ({
    text,
    angle,
    gloss: null,
  });

  test('keeps the first variant and stamps the angle the GOAL decided', () => {
    const out = toNetworkVariants([v('first line', 'extends'), v('second', 'contrarian')]);
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe('first line');
    // Stamped, not read: `parseBatchReplies` coerces an unrecognized angle to
    // `extends`, and an `extends` row here would file a networking reply in the
    // reach path's column for every crosstab that ever reads it.
    expect(out[0]?.angle).toBe('network');
  });

  test('an already-correct single variant is unchanged apart from identity', () => {
    const input = [{ ...v('one line', 'network'), gloss: 'a gloss' }];
    const out = toNetworkVariants(input);
    expect(out).toEqual(input);
    expect(out[0]).not.toBe(input[0]);
  });

  test('empty in, empty out — the caller`s own primary check fires', () => {
    expect(toNetworkVariants([])).toEqual([]);
  });

  test('`network` is a real angle, and no room can ask for it', () => {
    expect(REPLY_ANGLES).toContain('network');
    expect(ROOM_ANGLES).not.toContain('network');
  });
});
