// C3 relationship-aware drafting: pure render + angle-preference gate, the
// prompt-tail injection, and the facts loader over the real (in-memory,
// auto-migrated) SQLite DB — bun test runs with SQLITE_PATH=:memory:.

import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { people } from '../db/schema.ts';
import {
  type BatchTweet,
  type PostContext,
  buildBatchGrokInput,
  buildGrokInput,
} from '../replies/prompt.ts';
import type { AngleCell } from './angles.ts';
import {
  MIN_MEASURED_FOR_ANGLE_PREFERENCE,
  RELATIONSHIP_INSTRUCTION,
  type RelationshipFacts,
  pickAnglePreference,
  renderRelationship,
  renderRelationshipBrief,
} from './relationship.ts';
import { loadRelationshipFacts, logPersonEvents } from './store.ts';

const NOW = new Date('2026-07-04T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function facts(overrides: Partial<RelationshipFacts> = {}): RelationshipFacts {
  return {
    handle: 'somebuilder',
    stage: 'mutual',
    eventCount: 6,
    inboundCount: 2,
    outboundCount: 4,
    lastOutbound: {
      at: new Date(NOW.getTime() - 2 * DAY_MS),
      summary: 'replied to: "agents are eating SaaS"',
    },
    lastInbound: {
      at: new Date(NOW.getTime() - 1 * DAY_MS),
      summary: 'mentioned me: "good point on evals"',
    },
    anglePreference: null,
    notes: null,
    ...overrides,
  };
}

function cell(angle: string | null, overrides: Partial<AngleCell> = {}): AngleCell {
  return {
    angle,
    posted: 1,
    measured: 1,
    medianViews: null,
    medianProfileVisits: null,
    medianReplies: null,
    ...overrides,
  };
}

describe('renderRelationship', () => {
  test('empty person → empty string', () => {
    expect(renderRelationship(null, NOW)).toBe('');
    expect(renderRelationship(facts({ eventCount: 0 }), NOW)).toBe('');
  });

  test('renders stage, exchange counts, instruction, and last-exchange topics', () => {
    const block = renderRelationship(facts(), NOW);
    expect(block).toContain('@somebuilder');
    expect(block).toContain(RELATIONSHIP_INSTRUCTION);
    expect(block).toContain('Stage: mutual — 6 prior exchanges');
    expect(block).toContain('my replies: 4');
    expect(block).toContain('their replies/mentions back: 2');
    expect(block).toContain('my last reply (2d ago): replied to: "agents are eating SaaS"');
    expect(block).toContain('their last (1d ago): mentioned me: "good point on evals"');
    expect(block).not.toContain('angle preference');
  });

  test('events without exchanges still render (tracking, no direct exchange)', () => {
    const block = renderRelationship(
      facts({
        eventCount: 3,
        inboundCount: 0,
        outboundCount: 0,
        lastInbound: null,
        lastOutbound: null,
        stage: 'noticed',
      }),
      NOW,
    );
    expect(block).toContain('Stage: noticed — no direct exchanges yet');
  });

  test('notes render verbatim; angle preference renders when present', () => {
    const block = renderRelationship(
      facts({
        notes: 'met at conf; hates hype threads',
        anglePreference: {
          angle: 'contrarian',
          measured: 3,
          totalMeasured: 5,
          medianViews: 850,
          medianProfileVisits: 4,
        },
      }),
      NOW,
    );
    expect(block).toContain('My notes on them (verbatim): met at conf; hates hype threads');
    expect(block).toContain("'contrarian' lands best");
    expect(block).toContain('3 of 5 measured replies');
    expect(block).toContain('median 850 views');
  });
});

describe('pickAnglePreference (min-sample gate)', () => {
  test('under the ≥3-measured gate → null (same discipline as BAND recalibration)', () => {
    const cells = [cell('contrarian', { measured: 2, medianViews: 900 })];
    expect(pickAnglePreference(cells)).toBeNull();
    expect(MIN_MEASURED_FOR_ANGLE_PREFERENCE).toBe(3);
  });

  test('at the gate, picks by median profile visits then views; skips null angle', () => {
    const pref = pickAnglePreference([
      cell(null, { measured: 1, medianViews: 9999 }),
      cell('extends', { measured: 1, medianViews: 500, medianProfileVisits: 1 }),
      cell('contrarian', { measured: 2, medianViews: 300, medianProfileVisits: 6 }),
    ]);
    expect(pref?.angle).toBe('contrarian');
    expect(pref?.totalMeasured).toBe(4);
    expect(pref?.measured).toBe(2);
  });
});

describe('renderRelationshipBrief (batch, ≤2 lines)', () => {
  test('empty person → empty string', () => {
    expect(renderRelationshipBrief(null, NOW)).toBe('');
  });

  test('caps at two lines with the facts inline', () => {
    const brief = renderRelationshipBrief(
      facts({
        notes: 'x'.repeat(500),
        anglePreference: {
          angle: 'debate',
          measured: 3,
          totalMeasured: 3,
          medianViews: 100,
          medianProfileVisits: null,
        },
      }),
      NOW,
    );
    const lines = brief.split('\n');
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines[0]).toStartWith('RELATIONSHIP: Stage: mutual');
    expect(lines[0]).toContain('Best angle so far: debate (3/3 measured)');
    expect(lines[1]).toContain('Last exchange (my reply, 2d ago)');
    expect(lines[1]?.length).toBeLessThan(400); // notes clamped, never verbatim walls
  });
});

describe('prompt injection at the variable tail', () => {
  const ctx: PostContext = {
    url: 'https://x.com/somebuilder/status/1',
    tweetId: '1',
    author: 'Some Builder',
    handle: 'somebuilder',
    text: 'agents are eating SaaS',
    postedAt: NOW.toISOString(),
    metrics: { views: 100, replies: 1, reposts: 0, likes: 2 },
    topComments: [],
  };

  test('single: block appended after the idea tag only when stamped', () => {
    const cold = buildGrokInput(ctx)[0]?.content ?? '';
    expect(cold).not.toContain('My history with');

    const block = renderRelationship(facts(), NOW);
    const warm = buildGrokInput({ ...ctx, relationship: block })[0]?.content ?? '';
    expect(warm).toContain(block);
    expect(warm.indexOf(block)).toBeGreaterThan(warm.indexOf('</idea>'));
  });

  test('batch: RELATIONSHIP line rides with its post; note appended once, only when present', () => {
    const t1: BatchTweet = { tweetId: '1', handle: 'somebuilder', author: 'SB', text: 'post one' };
    const cold = buildBatchGrokInput([t1])[0]?.content ?? '';
    expect(cold).not.toContain('RELATIONSHIP');

    const brief = renderRelationshipBrief(facts(), NOW);
    const warm =
      buildBatchGrokInput([
        { ...t1, relationship: brief },
        { ...t1, tweetId: '2' },
      ])[0]?.content ?? '';
    expect(warm).toContain(brief);
    expect(warm).toContain(RELATIONSHIP_INSTRUCTION);
    // The instruction sits in the variable tail, not the cacheable head.
    expect(warm.indexOf(RELATIONSHIP_INSTRUCTION)).toBeGreaterThan(warm.indexOf('POST 2'));
  });
});

describe('loadRelationshipFacts', () => {
  const H = 'c3_test_person';

  beforeAll(async () => {
    const base = NOW.getTime() - 10 * DAY_MS;
    await logPersonEvents(
      [
        {
          handle: H,
          type: 'my_reply',
          refTable: 't',
          refId: 'c3r1',
          summary: 'replied to: "ship it"',
          at: new Date(base),
        },
        {
          handle: H,
          type: 'their_mention',
          refTable: 't',
          refId: 'c3m1',
          summary: 'mentioned me: "nice"',
          at: new Date(base + 3_600_000),
        },
      ],
      { source: 'test' },
    );
    await db.update(people).set({ notes: 'likes evals' }).where(eq(people.handle, H));
  });

  test('unknown handle / person without events → null', async () => {
    expect(await loadRelationshipFacts('c3_nobody_xyz')).toBeNull();
  });

  test('counts, latest summaries, notes; angle preference gated off with no posted replies', async () => {
    const f = await loadRelationshipFacts(H);
    expect(f).not.toBeNull();
    expect(f?.eventCount).toBe(2);
    expect(f?.inboundCount).toBe(1);
    expect(f?.outboundCount).toBe(1);
    expect(f?.lastOutbound?.summary).toBe('replied to: "ship it"');
    expect(f?.lastInbound?.summary).toBe('mentioned me: "nice"');
    expect(f?.notes).toBe('likes evals');
    expect(f?.anglePreference).toBeNull();
    expect(renderRelationship(f, NOW)).toContain('My notes on them (verbatim): likes evals');
  });
});
