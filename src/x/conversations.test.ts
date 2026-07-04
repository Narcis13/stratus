// C2 thread grouping: interleave, open-loop and chain detection, ranking,
// read/snooze/mute state — all pure, no DB.

import { describe, expect, test } from 'bun:test';
import {
  type ConversationThread,
  type InboundInput,
  type OutboundInput,
  buildThreads,
  isActionable,
  rankThreads,
  threadKeyFor,
} from './conversations.ts';

const NOW = new Date('2026-07-04T12:00:00Z');
const at = (min: number): Date => new Date(NOW.getTime() - min * 60_000);

let seq = 0;
function inboundOf(over: Partial<InboundInput> = {}): InboundInput {
  seq += 1;
  return {
    tweetId: `9${String(seq).padStart(6, '0')}`,
    conversationId: 'c1',
    authorUsername: 'alice',
    authorName: 'Alice',
    text: 'hey',
    postedAt: at(60),
    inReplyToTweetId: null,
    status: 'unanswered',
    ...over,
  };
}

function outboundOf(over: Partial<OutboundInput> = {}): OutboundInput {
  seq += 1;
  return {
    tweetId: `9${String(seq).padStart(6, '0')}`,
    conversationId: 'c1',
    text: 'my post',
    postedAt: at(120),
    isReply: false,
    ...over,
  };
}

function build(
  inbound: InboundInput[],
  outbound: OutboundInput[] = [],
  metas: Parameters<typeof buildThreads>[2] = [],
  myReplyIds?: Set<string>,
): ConversationThread[] {
  return buildThreads(inbound, outbound, metas, {
    now: NOW,
    ...(myReplyIds ? { myReplyIds } : {}),
  });
}

describe('buildThreads', () => {
  test('groups by conversationId and interleaves items by postedAt', () => {
    const threads = build(
      [
        inboundOf({ tweetId: '300', postedAt: at(30) }),
        inboundOf({ tweetId: '100', postedAt: at(90) }),
      ],
      [outboundOf({ tweetId: '200', postedAt: at(60), isReply: true })],
    );
    expect(threads.length).toBe(1);
    const t = threads[0] as ConversationThread;
    expect(t.conversationId).toBe('c1');
    expect(t.items.map((i) => i.tweetId)).toEqual(['100', '200', '300']);
    expect(t.items.map((i) => i.kind)).toEqual(['inbound', 'outbound', 'inbound']);
    expect(t.lastActivityAt).toEqual(at(30));
    expect(t.inboundCount).toBe(2);
    expect(t.outboundCount).toBe(1);
    expect(t.counterpartHandle).toBe('alice');
  });

  test('my posts without a mention in the conversation form no thread', () => {
    const threads = build(
      [inboundOf({ conversationId: 'c1' })],
      [
        outboundOf({ conversationId: 'c1' }),
        outboundOf({ conversationId: 'lonely' }),
        outboundOf({ conversationId: null }),
      ],
    );
    expect(threads.length).toBe(1);
    expect(threads[0]?.outboundCount).toBe(1);
  });

  test('a mention with null conversationId gets its own tweetId-keyed thread', () => {
    const m = inboundOf({ conversationId: null, tweetId: '777' });
    expect(threadKeyFor(m)).toBe('777');
    const threads = build([m]);
    expect(threads[0]?.conversationId).toBe('777');
  });

  test('open loop: newest item inbound and unanswered → owed, age-stamped', () => {
    const threads = build(
      [inboundOf({ postedAt: at(45) })],
      [outboundOf({ postedAt: at(90), isReply: true })],
    );
    const t = threads[0] as ConversationThread;
    expect(t.openLoop).toBe(true);
    expect(t.owedSince).toEqual(at(45));
  });

  test('owedSince is the OLDEST unanswered inbound after my last outbound', () => {
    const threads = build(
      [inboundOf({ postedAt: at(50) }), inboundOf({ postedAt: at(20) })],
      [outboundOf({ postedAt: at(90), isReply: true })],
    );
    expect(threads[0]?.owedSince).toEqual(at(50));
  });

  test('no open loop when my reply came after their mention', () => {
    const threads = build(
      [inboundOf({ postedAt: at(90) })],
      [outboundOf({ postedAt: at(45), isReply: true })],
    );
    expect(threads[0]?.openLoop).toBe(false);
    expect(threads[0]?.owedSince).toBeNull();
  });

  test('answered/dismissed mentions settle the loop even before discovery sees my reply', () => {
    for (const status of ['answered', 'dismissed']) {
      const threads = build([inboundOf({ status, postedAt: at(30) })]);
      expect(threads[0]?.openLoop).toBe(false);
    }
  });

  test('chain: owed inbound replying to MY REPLY (via myReplyIds) flags the thread', () => {
    const threads = build(
      [inboundOf({ postedAt: at(30), inReplyToTweetId: 'myreply1' })],
      [],
      [],
      new Set(['myreply1']),
    );
    expect(threads[0]?.chain).toBe(true);
  });

  test('chain: also detected from an in-thread outbound reply row', () => {
    const threads = build(
      [inboundOf({ postedAt: at(30), inReplyToTweetId: '555' })],
      [outboundOf({ tweetId: '555', postedAt: at(60), isReply: true })],
    );
    expect(threads[0]?.chain).toBe(true);
  });

  test('no chain when the inbound replies to my ORIGINAL post', () => {
    const threads = build(
      [inboundOf({ postedAt: at(30), inReplyToTweetId: '555' })],
      [outboundOf({ tweetId: '555', postedAt: at(60), isReply: false })],
    );
    expect(threads[0]?.openLoop).toBe(true);
    expect(threads[0]?.chain).toBe(false);
  });

  test('read/snooze/mute state from conversation_meta', () => {
    const meta = {
      conversationId: 'c1',
      snoozedUntil: new Date(NOW.getTime() + 60_000),
      lastReadAt: at(10),
      muted: false,
    };
    const [t] = build([inboundOf({ postedAt: at(30) })], [], [meta]);
    expect(t?.unread).toBe(false); // read after the last activity
    expect(t?.snoozed).toBe(true);
    expect(isActionable(t as ConversationThread)).toBe(false);

    const [t2] = build([inboundOf({ postedAt: at(5) })], [], [meta]);
    expect(t2?.unread).toBe(true); // new activity since lastReadAt
    expect(t2?.snoozed).toBe(true);

    const expired = { ...meta, snoozedUntil: at(1) };
    const [t3] = build([inboundOf({ postedAt: at(5) })], [], [expired]);
    expect(t3?.snoozed).toBe(false);
    expect(isActionable(t3 as ConversationThread)).toBe(true);
  });

  test('no meta row → unread by definition', () => {
    const [t] = build([inboundOf()]);
    expect(t?.unread).toBe(true);
    expect(t?.muted).toBe(false);
    expect(t?.snoozed).toBe(false);
  });
});

describe('rankThreads', () => {
  test('chains first, then open loops oldest-debt-first, then settled by activity', () => {
    const threads = build(
      [
        inboundOf({ conversationId: 'settled', postedAt: at(5), status: 'answered' }),
        inboundOf({ conversationId: 'old-loop', postedAt: at(300) }),
        inboundOf({ conversationId: 'young-loop', postedAt: at(30) }),
        inboundOf({ conversationId: 'chain', postedAt: at(10), inReplyToTweetId: 'myreply1' }),
      ],
      [],
      [],
      new Set(['myreply1']),
    );
    expect(threads.map((t) => t.conversationId)).toEqual([
      'chain',
      'old-loop',
      'young-loop',
      'settled',
    ]);
  });

  test('snoozed and muted open loops sink to the settled tier', () => {
    const threads = build(
      [
        inboundOf({ conversationId: 'snoozed-loop', postedAt: at(500) }),
        inboundOf({ conversationId: 'muted-loop', postedAt: at(400) }),
        inboundOf({ conversationId: 'live-loop', postedAt: at(10) }),
      ],
      [],
      [
        {
          conversationId: 'snoozed-loop',
          snoozedUntil: new Date(NOW.getTime() + 3_600_000),
          lastReadAt: null,
          muted: false,
        },
        { conversationId: 'muted-loop', snoozedUntil: null, lastReadAt: null, muted: true },
      ],
    );
    expect(threads[0]?.conversationId).toBe('live-loop');
    const rest = threads.slice(1).map((t) => t.conversationId);
    expect(rest).toEqual(['muted-loop', 'snoozed-loop']); // settled: activity desc
  });

  test('rankThreads is pure — does not mutate its input', () => {
    const threads = build([
      inboundOf({ conversationId: 'a', postedAt: at(10) }),
      inboundOf({ conversationId: 'b', postedAt: at(20) }),
    ]);
    const copy = [...threads];
    rankThreads(threads);
    expect(threads).toEqual(copy);
  });
});
