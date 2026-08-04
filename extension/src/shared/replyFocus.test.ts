import { describe, expect, test } from 'bun:test';
import {
  REPLY_FOCUS_TTL_MS,
  isReplyFocusRequest,
  makeReplyFocusRequest,
  shouldFocusReply,
} from './replyFocus.ts';

const NOW = 1_800_000_000_000;

describe('isReplyFocusRequest', () => {
  test('accepts a stamped request', () => {
    expect(isReplyFocusRequest(makeReplyFocusRequest('123', NOW))).toBe(true);
  });

  test('rejects junk', () => {
    expect(isReplyFocusRequest(null)).toBe(false);
    expect(isReplyFocusRequest('123')).toBe(false);
    expect(isReplyFocusRequest({ tweetId: '', at: NOW })).toBe(false);
    expect(isReplyFocusRequest({ tweetId: '123' })).toBe(false);
    expect(isReplyFocusRequest({ tweetId: 123, at: NOW })).toBe(false);
  });
});

describe('shouldFocusReply', () => {
  const req = makeReplyFocusRequest('123', NOW);

  test('matching tweet inside the TTL', () => {
    expect(shouldFocusReply(req, '123', NOW)).toBe(true);
    expect(shouldFocusReply(req, '123', NOW + REPLY_FOCUS_TTL_MS)).toBe(true);
  });

  test('a different tweet never takes the request', () => {
    expect(shouldFocusReply(req, '456', NOW)).toBe(false);
  });

  test('not on a status page', () => {
    expect(shouldFocusReply(req, null, NOW)).toBe(false);
  });

  test('expired, and clock-skewed into the future, are both ignored', () => {
    expect(shouldFocusReply(req, '123', NOW + REPLY_FOCUS_TTL_MS + 1)).toBe(false);
    expect(shouldFocusReply(req, '123', NOW - 1)).toBe(false);
  });

  test('junk is never a request', () => {
    expect(shouldFocusReply(undefined, '123', NOW)).toBe(false);
  });
});
