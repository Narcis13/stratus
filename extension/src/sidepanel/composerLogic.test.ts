import { describe, expect, test } from 'bun:test';
import {
  ANCHORS_3,
  ANCHORS_4,
  estimatePostCostUsd,
  findScheduleGaps,
  jitterMinutes,
  pickAnchors,
  splitIntoThread,
  suggestSlotDate,
} from './composerLogic.ts';

describe('pickAnchors', () => {
  test('3/day until 4 slots are filled', () => {
    expect(pickAnchors(0)).toEqual(ANCHORS_3);
    expect(pickAnchors(3)).toEqual(ANCHORS_3);
    expect(pickAnchors(4)).toEqual(ANCHORS_4);
  });
});

describe('findScheduleGaps', () => {
  test('claims the nearest anchor and returns the rest', () => {
    // a post at 09:10 claims the 9 anchor
    expect(findScheduleGaps([9 * 60 + 10], ANCHORS_3)).toEqual([13, 18]);
  });
  test('all anchors open when nothing is slotted', () => {
    expect(findScheduleGaps([], ANCHORS_3)).toEqual(ANCHORS_3);
  });
  test('ties go to the earlier anchor', () => {
    // 11:00 is equidistant from 9 and 13 → claims 9
    expect(findScheduleGaps([11 * 60], ANCHORS_3)).toEqual([13, 18]);
  });
});

describe('jitterMinutes', () => {
  test('never top-of-hour, stays in [4,56]', () => {
    expect(jitterMinutes(() => 0)).toBe(4);
    expect(jitterMinutes(() => 0.999999)).toBe(56);
    for (let i = 0; i < 50; i++) {
      const m = jitterMinutes(() => i / 50);
      expect(m).toBeGreaterThanOrEqual(4);
      expect(m).toBeLessThanOrEqual(56);
    }
  });
});

describe('suggestSlotDate', () => {
  const fixedJitter = () => 0; // → minute 4

  test('picks the first future anchor today', () => {
    const now = new Date(2026, 5, 18, 7, 0); // 07:00 local, before the 9 anchor
    const d = suggestSlotDate(now, [], 7, fixedJitter);
    expect(d).not.toBeNull();
    expect(d?.getHours()).toBe(9);
    expect(d?.getMinutes()).toBe(4);
    expect(d?.getDate()).toBe(18);
  });

  test('skips an already-claimed anchor', () => {
    const now = new Date(2026, 5, 18, 7, 0);
    const claimed = [new Date(2026, 5, 18, 9, 5)]; // claims the 9 anchor
    const d = suggestSlotDate(now, claimed, 7, fixedJitter);
    expect(d?.getHours()).toBe(13);
  });

  test('rolls to the next day when today is past the last anchor', () => {
    const now = new Date(2026, 5, 18, 23, 0); // after 18:00
    const d = suggestSlotDate(now, [], 7, fixedJitter);
    expect(d?.getDate()).toBe(19);
    expect(d?.getHours()).toBe(9);
  });
});

describe('estimatePostCostUsd', () => {
  test('standard single post', () => {
    const c = estimatePostCostUsd({ threadMode: false, text: 'hello world', segments: [] });
    expect(c.usd).toBeCloseTo(0.015);
    expect(c.note).toBe('');
  });
  test('URL surcharge on a standalone post', () => {
    const c = estimatePostCostUsd({
      threadMode: false,
      text: 'read this https://example.com',
      segments: [],
    });
    expect(c.usd).toBeCloseTo(0.2);
    expect(c.note).toMatch(/surcharge/);
  });
  test('empty text is free', () => {
    expect(estimatePostCostUsd({ threadMode: false, text: '   ', segments: [] }).usd).toBe(0);
  });
  test('thread bills per non-empty segment', () => {
    const c = estimatePostCostUsd({ threadMode: true, text: '', segments: ['a', 'b', '', 'c'] });
    expect(c.usd).toBeCloseTo(0.045);
    expect(c.note).toBe('3 segments');
  });
  test('URL in head segment triggers the surcharge', () => {
    const c = estimatePostCostUsd({
      threadMode: true,
      text: '',
      segments: ['hook https://x.com', 'tail'],
    });
    expect(c.usd).toBeCloseTo(0.215); // 0.20 head + 0.015 tail
    expect(c.note).toMatch(/URL in head/);
  });
  test('URL in a tail segment stays at base price', () => {
    const c = estimatePostCostUsd({
      threadMode: true,
      text: '',
      segments: ['hook', 'link https://x.com'],
    });
    expect(c.usd).toBeCloseTo(0.03);
  });
});

describe('splitIntoThread', () => {
  test('short text stays one segment', () => {
    expect(splitIntoThread('just a tweet', 280)).toEqual(['just a tweet']);
  });
  test('splits on paragraph boundaries first', () => {
    const a = 'A'.repeat(150);
    const b = 'B'.repeat(150);
    const segs = splitIntoThread(`${a}\n\n${b}`, 280);
    expect(segs).toEqual([a, b]);
  });
  test('every segment respects the limit', () => {
    const long = 'Sentence one is here. Sentence two follows. '.repeat(20);
    const segs = splitIntoThread(long, 100);
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) expect(s.length).toBeLessThanOrEqual(100);
    // no content dropped (modulo whitespace)
    expect(segs.join(' ').replace(/\s+/g, ' ').trim()).toBe(long.replace(/\s+/g, ' ').trim());
  });
  test('hard-splits a single oversized token', () => {
    const segs = splitIntoThread('x'.repeat(50), 20);
    expect(segs).toEqual(['x'.repeat(20), 'x'.repeat(20), 'x'.repeat(10)]);
  });
});
