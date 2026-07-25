import { describe, expect, test } from 'bun:test';
import { COMING_SOON, type ComingSoonFeature, comingSoonMatches } from './comingSoon.ts';

// Resolved from the test file, not the cwd — `bun run test` runs from the repo
// root but the same file must pass if someone runs bun test inside extension/.
const REPO_ROOT = `${import.meta.dir}/../../..`;

describe('coming-soon manifest', () => {
  test('every entry is renderable — id, title, summary, 3-5 knobs', () => {
    expect(COMING_SOON.length).toBeGreaterThan(0);
    for (const f of COMING_SOON) {
      expect(f.id).not.toBe('');
      expect(f.title).not.toBe('');
      expect(f.summary).not.toBe('');
      expect(f.planFile.startsWith('plans/')).toBe(true);
      // A feature with no knobs says nothing about what would become tunable,
      // which is the whole reason the roadmap sits in the settings tab.
      expect(f.knobs.length).toBeGreaterThanOrEqual(3);
      expect(f.knobs.length).toBeLessThanOrEqual(5);
      for (const k of f.knobs) {
        expect(k.label).not.toBe('');
        expect(k.hint).not.toBe('');
      }
    }
  });

  test('ids are unique', () => {
    const ids = COMING_SOON.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // D8: the manifest is pruned as plans ship, so the realistic decay is a
  // planFile that was renamed or deleted out from under a stale entry.
  test('every planFile points at a plan that exists', async () => {
    for (const f of COMING_SOON) {
      expect(await Bun.file(`${REPO_ROOT}/${f.planFile}`).exists()).toBe(true);
    }
  });

  test('the roadmap is exactly the unbuilt backlog plans', () => {
    // Waves 0-4 shipped the other eight plans this manifest originally listed.
    expect(COMING_SOON.map((f) => f.id).sort()).toEqual([
      'growth-tactics',
      'llm-judge',
      'static-coach',
    ]);
  });
});

function feature(id: string): ComingSoonFeature {
  const found = COMING_SOON.find((f) => f.id === id);
  if (found === undefined) throw new Error(`no coming-soon feature with id ${id}`);
  return found;
}

describe('comingSoonMatches', () => {
  const judge = feature('llm-judge');

  test('an empty query matches everything', () => {
    expect(comingSoonMatches(judge, '')).toBe(true);
    expect(comingSoonMatches(judge, '   ')).toBe(true);
  });

  test('matches on title, summary, knob label and knob hint, case-insensitively', () => {
    expect(comingSoonMatches(judge, 'JUDGE')).toBe(true); // title
    expect(comingSoonMatches(judge, 'dimension')).toBe(true); // summary
    expect(comingSoonMatches(judge, 'staleness')).toBe(true); // knob label
    expect(comingSoonMatches(judge, 'grading its own')).toBe(true); // knob hint
  });

  test('drops a feature nothing in it mentions', () => {
    expect(comingSoonMatches(judge, 'harvest cursor')).toBe(false);
  });
});
