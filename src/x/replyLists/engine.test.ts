// RL.1 reply-list engine: template render, anti-repeat pick, humanizer.
// Everything is pure, so every roll is a stubbed rng sequence — no flaky
// randomness, and the seeded sweeps assert the statistical promises (typo rate,
// protected spans) deterministically.

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_HUMANIZER,
  HUMANIZE_DRAWS,
  type HumanizerConfig,
  MAX_REPLY_LENGTH,
  type PickableItem,
  availableVarsFor,
  composeReply,
  humanize,
  parseHumanizerConfig,
  pickItem,
  renderTemplate,
  resolveHumanizer,
  templateVars,
} from './engine.ts';

/** Stubbed rng: the listed draws in order, then a value no chance can clear. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[i++] ?? 0.999;
}

function counted(inner: () => number): { rng: () => number; calls: () => number } {
  let calls = 0;
  return {
    rng: () => {
      calls++;
      return inner();
    },
    calls: () => calls,
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALWAYS: HumanizerConfig = {
  prefixes: ['honestly,'],
  suffixes: ['well said'],
  prefixChance: 1,
  suffixChance: 1,
  lowercaseChance: 1,
  dropPeriodChance: 1,
  typoChance: 1,
};

function cfg(over: Partial<HumanizerConfig>): HumanizerConfig {
  return { ...ALWAYS, ...over };
}

const OFF = cfg({
  prefixChance: 0,
  suffixChance: 0,
  lowercaseChance: 0,
  dropPeriodChance: 0,
  typoChance: 0,
});

describe('renderTemplate', () => {
  test('fills every var', () => {
    const r = renderTemplate('Thanks for the early read, {name}! ({handle})', {
      name: 'Narcis B',
      handle: '@narcis13',
    });
    expect(r.text).toBe('Thanks for the early read, Narcis B! (narcis13)');
    expect(r.missingVars).toEqual([]);
  });

  test('first_name is the first token of the name', () => {
    const r = renderTemplate('hey {first_name}', { name: 'Narcis Brindusescu' });
    expect(r.text).toBe('hey Narcis');
    expect(r.missingVars).toEqual([]);
  });

  test('missing var takes its leading separator with it', () => {
    const r = renderTemplate('Thank you, {name}!', {});
    expect(r.text).toBe('Thank you!');
    expect(r.missingVars).toEqual(['name']);
  });

  test('missing var at the start takes the trailing separator instead', () => {
    expect(renderTemplate('{name} thanks for this', {}).text).toBe('thanks for this');
  });

  test('two missing vars degrade without a dangling comma', () => {
    const r = renderTemplate('Hi {name}, {handle}', {});
    expect(r.text).toBe('Hi');
    expect(r.missingVars).toEqual(['name', 'handle']);
  });

  test('unknown placeholders are left verbatim', () => {
    const r = renderTemplate('Nice {thing} you built, {name}', { name: 'Narcis' });
    expect(r.text).toBe('Nice {thing} you built, Narcis');
    expect(r.missingVars).toEqual([]);
  });

  test('emoji are stripped from the name', () => {
    expect(renderTemplate('yo {name}', { name: '🔥 Narcis 🚀' }).text).toBe('yo Narcis');
    expect(renderTemplate('yo {name}', { name: 'Narcis 🇷🇴' }).text).toBe('yo Narcis');
  });

  test('an all-emoji name counts as missing', () => {
    const r = renderTemplate('Thank you, {name}!', { name: '🔥🔥' });
    expect(r.text).toBe('Thank you!');
    expect(r.missingVars).toEqual(['name']);
  });

  test('handle is stored without the @', () => {
    expect(renderTemplate('cc {handle}', { handle: 'narcis13' }).text).toBe('cc narcis13');
  });
});

describe('templateVars / availableVarsFor', () => {
  test('lists known vars in first-appearance order, deduped', () => {
    expect(templateVars('{handle} hi {name}, {name} again {nope}')).toEqual(['handle', 'name']);
  });

  test('available vars follow what actually resolves', () => {
    expect([...availableVarsFor({ name: 'Narcis B', handle: '@x' })].sort()).toEqual([
      'first_name',
      'handle',
      'name',
    ]);
    expect([...availableVarsFor({ handle: '@x' })]).toEqual(['handle']);
    expect([...availableVarsFor({ name: '   ', handle: '@' })]).toEqual([]);
  });
});

describe('pickItem', () => {
  const ALL_VARS = new Set(['name', 'first_name', 'handle']);
  const NO_VARS = new Set<string>();

  function item(id: string, over: Partial<PickableItem> = {}): PickableItem {
    return { id, text: 'Thanks!', enabled: true, lastUsedAt: null, ...over };
  }

  test('empty and all-disabled pools return null', () => {
    expect(pickItem([], ALL_VARS, seq(0))).toBeNull();
    expect(pickItem([item('a', { enabled: false })], ALL_VARS, seq(0))).toBeNull();
  });

  test('a single item repeats — nothing else to pick', () => {
    const only = [item('a')];
    expect(pickItem(only, ALL_VARS, seq(0))?.id).toBe('a');
    expect(pickItem(only, ALL_VARS, seq(0.99))?.id).toBe('a');
  });

  test('n=2 always excludes the most recently used', () => {
    const items = [item('a', { lastUsedAt: new Date('2026-07-20T10:00:00Z') }), item('b')];
    for (const r of [0, 0.5, 0.99]) {
      expect(pickItem(items, ALL_VARS, seq(r))?.id).toBe('b');
    }
  });

  test('n=3 excludes one, picks uniformly among the other two', () => {
    const items = [
      item('a', { lastUsedAt: new Date('2026-07-20T12:00:00Z') }),
      item('b', { lastUsedAt: new Date('2026-07-20T11:00:00Z') }),
      item('c', { lastUsedAt: new Date('2026-07-20T10:00:00Z') }),
    ];
    expect(pickItem(items, ALL_VARS, seq(0))?.id).toBe('b');
    expect(pickItem(items, ALL_VARS, seq(0.99))?.id).toBe('c');
    for (const r of [0, 0.4, 0.6, 0.99]) {
      expect(pickItem(items, ALL_VARS, seq(r))?.id).not.toBe('a');
    }
  });

  test('n=6 excludes the three most recent, never-used sort as oldest', () => {
    const items = [
      item('i1', { lastUsedAt: new Date('2026-07-20T15:00:00Z') }),
      item('i2', { lastUsedAt: new Date('2026-07-20T14:00:00Z') }),
      item('i3', { lastUsedAt: new Date('2026-07-20T13:00:00Z') }),
      item('i4', { lastUsedAt: new Date('2026-07-20T12:00:00Z') }),
      item('i5', { lastUsedAt: new Date('2026-07-20T11:00:00Z') }),
      item('i6'),
    ];
    expect(pickItem(items, ALL_VARS, seq(0))?.id).toBe('i4');
    expect(pickItem(items, ALL_VARS, seq(0.5))?.id).toBe('i5');
    expect(pickItem(items, ALL_VARS, seq(0.99))?.id).toBe('i6');
  });

  test('disabled items never surface', () => {
    const items = [item('a', { enabled: false }), item('b'), item('c', { enabled: false })];
    expect(pickItem(items, ALL_VARS, seq(0))?.id).toBe('b');
  });

  test('items needing an unavailable var are deprioritized', () => {
    const items = [
      item('needs', { text: 'Thanks {name}!' }),
      item('plain', { lastUsedAt: new Date('2026-07-20T10:00:00Z') }),
    ];
    // Deprioritization outranks recency: the var-free item is the only usable
    // one, so it repeats rather than blocking the use.
    for (const r of [0, 0.5, 0.99]) {
      expect(pickItem(items, NO_VARS, seq(r))?.id).toBe('plain');
    }
    // With the var available both are in the pool, and recency excludes 'plain'.
    expect(pickItem(items, ALL_VARS, seq(0))?.id).toBe('needs');
  });

  test('falls back to var-needing items rather than blocking the use', () => {
    const items = [item('a', { text: 'hi {name}' }), item('b', { text: 'yo {name}' })];
    expect(pickItem(items, NO_VARS, seq(0))?.id).toBe('b');
  });
});

describe('humanize', () => {
  const BODY = 'Thanks for the thoughtful writeup.';

  test('draw count is fixed whether or not steps fire', () => {
    const a = counted(seq(0, 0, 0, 0, 0, 0, 0, 0, 0, 0));
    humanize(BODY, ALWAYS, a.rng);
    expect(a.calls()).toBe(HUMANIZE_DRAWS);

    const b = counted(seq());
    humanize(BODY, DEFAULT_HUMANIZER, b.rng);
    expect(b.calls()).toBe(HUMANIZE_DRAWS);
  });

  test('nothing fires on high draws', () => {
    const r = humanize(BODY, DEFAULT_HUMANIZER, seq());
    expect(r.text).toBe(BODY);
    expect(r.applied).toEqual([]);
  });

  test('steps compose in a fixed order', () => {
    const r = humanize(BODY, cfg({ suffixChance: 0 }), seq(0, 0, 0, 0, 0, 0, 0, 0, 0, 0));
    expect(r.applied).toEqual(['prefix', 'lowercase', 'drop_period', 'typo:drop']);
    expect(r.text).toBe('hnestly, thanks for the thoughtful writeup');
  });

  test('a chance is a strict threshold', () => {
    const only = cfg({ suffixChance: 0, lowercaseChance: 0, dropPeriodChance: 0, typoChance: 0 });
    expect(humanize(BODY, { ...only, prefixChance: 0.25 }, seq(0.24, 0)).applied).toEqual([
      'prefix',
    ]);
    expect(humanize(BODY, { ...only, prefixChance: 0.25 }, seq(0.25, 0)).applied).toEqual([]);
    expect(humanize(BODY, { ...only, prefixChance: 0 }, seq(0, 0)).applied).toEqual([]);
  });

  test('the suffix joins with a comma when the text has no terminal punctuation', () => {
    const only = cfg({ prefixChance: 0, lowercaseChance: 0, dropPeriodChance: 0, typoChance: 0 });
    expect(humanize('great thread', only, seq(0, 0, 0, 0)).text).toBe('great thread, well said');
    expect(humanize('great thread!', only, seq(0, 0, 0, 0)).text).toBe('great thread! well said');
  });

  test('an overflowing suffix is skipped, never truncated', () => {
    const only = cfg({ prefixChance: 0, lowercaseChance: 0, dropPeriodChance: 0, typoChance: 0 });
    const long = 'a'.repeat(MAX_REPLY_LENGTH - 5);
    const skipped = humanize(long, only, seq(0, 0, 0, 0));
    expect(skipped.applied).toEqual([]);
    expect(skipped.text).toBe(long);

    const short = humanize('a'.repeat(100), only, seq(0, 0, 0, 0));
    expect(short.applied).toEqual(['suffix']);
    expect(short.text.length).toBeLessThanOrEqual(MAX_REPLY_LENGTH);
  });

  test('an ellipsis survives the drop-period roll', () => {
    const only = cfg({ prefixChance: 0, suffixChance: 0, lowercaseChance: 0, typoChance: 0 });
    expect(humanize('wait...', only, seq(0, 0, 0, 0, 0, 0)).applied).toEqual([]);
    expect(humanize('wait.', only, seq(0, 0, 0, 0, 0, 0)).text).toBe('wait');
  });

  test('lowercase never touches a protected first word', () => {
    const only = cfg({ prefixChance: 0, suffixChance: 0, dropPeriodChance: 0, typoChance: 0 });
    const draws = [0, 0, 0, 0, 0, 0] as const;
    expect(humanize('Narcis, spot on', only, seq(...draws), ['Narcis Brindusescu']).text).toBe(
      'Narcis, spot on',
    );
    expect(humanize('Solid point', only, seq(...draws)).text).toBe('solid point');
  });

  test('a typo needs an eligible word — short tokens, mentions and links are skipped', () => {
    const only = cfg({ prefixChance: 0, suffixChance: 0, lowercaseChance: 0, dropPeriodChance: 0 });
    expect(humanize('ok @narcis thx yes', only, seq(0, 0, 0, 0, 0, 0, 0, 0, 0, 0)).applied).toEqual(
      [],
    );

    const rng = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const out = humanize('check stratus.dev now please', only, rng);
      expect(out.text).toContain('stratus.dev');
      expect(out.text).not.toContain('@');
    }
  });

  test('each typo mutation is reachable and stays inside the word', () => {
    const only = cfg({ prefixChance: 0, suffixChance: 0, lowercaseChance: 0, dropPeriodChance: 0 });
    const kinds = new Set<string>();
    for (const kindDraw of [0, 0.3, 0.6, 0.9]) {
      const r = humanize('thanks friend', only, seq(0, 0, 0, 0, 0, 0, 0, 0, kindDraw, 0.5));
      for (const a of r.applied) kinds.add(a);
      expect(r.text.length).toBeLessThanOrEqual(MAX_REPLY_LENGTH);
    }
    expect([...kinds].every((k) => k.startsWith('typo:'))).toBe(true);
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });

  test('200 seeded runs never mutate a protected span', () => {
    const only = cfg({ prefixChance: 0, suffixChance: 0, lowercaseChance: 0, dropPeriodChance: 0 });
    const rng = mulberry32(42);
    let typos = 0;
    for (let i = 0; i < 200; i++) {
      const out = humanize('Narcis appreciate the thoughtful writeup about scheduling', only, rng, [
        'Narcis Brindusescu',
        'narcis13',
      ]);
      expect(out.text).toContain('Narcis');
      if (out.applied.some((a) => a.startsWith('typo:'))) typos++;
    }
    // typoChance is 1 here; the only misses are mutations that would be no-ops.
    expect(typos).toBeGreaterThanOrEqual(180);
  });

  test('the typo rate tracks the configured chance', () => {
    const text = 'thanks for the thoughtful writeup about scheduling';
    const rate = (chance: number, seed: number): number => {
      const rng = mulberry32(seed);
      let n = 0;
      for (let i = 0; i < 200; i++) {
        if (
          humanize(
            text,
            cfg({
              typoChance: chance,
              prefixChance: 0,
              suffixChance: 0,
              lowercaseChance: 0,
              dropPeriodChance: 0,
            }),
            rng,
          ).applied.length > 0
        ) {
          n++;
        }
      }
      return n;
    };
    expect(rate(0, 11)).toBe(0);
    // ~5% of 200 ≈ 10; a wide band still rules out "never" and "always".
    const observed = rate(DEFAULT_HUMANIZER.typoChance, 11);
    expect(observed).toBeGreaterThan(1);
    expect(observed).toBeLessThan(26);
  });
});

describe('composeReply', () => {
  test('renders then humanizes, protecting the target name', () => {
    const only = cfg({ prefixChance: 0, suffixChance: 0, lowercaseChance: 0, dropPeriodChance: 0 });
    const rng = mulberry32(3);
    for (let i = 0; i < 100; i++) {
      const r = composeReply(
        'Thanks for the early read, {name}!',
        { name: 'Narcis Brindusescu' },
        only,
        rng,
      );
      expect(r.text).toContain('Narcis Brindusescu');
      expect(r.missingVars).toEqual([]);
    }
  });

  test('reports missing vars and still composes', () => {
    const r = composeReply('cc {handle} — thanks!', { name: 'Narcis' }, OFF, seq());
    expect(r.text).toBe('cc — thanks!');
    expect(r.missingVars).toEqual(['handle']);
    expect(r.applied).toEqual([]);
  });
});

describe('parseHumanizerConfig', () => {
  test('null on anything that is not an object', () => {
    for (const bad of [null, undefined, 'x', 3, [], true]) {
      expect(parseHumanizerConfig(bad)).toBeNull();
    }
  });

  test('an empty object is all defaults', () => {
    expect(parseHumanizerConfig({})).toEqual(DEFAULT_HUMANIZER);
  });

  test('bad fields fall back one by one', () => {
    const parsed = parseHumanizerConfig({
      prefixes: 'nope',
      suffixes: ['  hi  ', '', 3],
      prefixChance: 'x',
      typoChance: 5,
      lowercaseChance: 0.4,
      unknown: true,
    });
    expect(parsed?.prefixes).toEqual(DEFAULT_HUMANIZER.prefixes);
    expect(parsed?.suffixes).toEqual(['hi']);
    expect(parsed?.prefixChance).toBe(DEFAULT_HUMANIZER.prefixChance);
    expect(parsed?.typoChance).toBe(DEFAULT_HUMANIZER.typoChance);
    expect(parsed?.lowercaseChance).toBe(0.4);
  });

  test('an explicitly empty pool is honored, 0 and 1 are valid chances', () => {
    const parsed = parseHumanizerConfig({ prefixes: [], typoChance: 0, suffixChance: 1 });
    expect(parsed?.prefixes).toEqual([]);
    expect(parsed?.typoChance).toBe(0);
    expect(parsed?.suffixChance).toBe(1);
  });

  test('an empty pool means that step can never fire', () => {
    const r = humanize('great thread', cfg({ prefixes: [], suffixes: [] }), seq(0, 0, 0, 0));
    expect(r.applied).not.toContain('prefix');
    expect(r.applied).not.toContain('suffix');
  });

  test('resolveHumanizer falls back to the engine defaults', () => {
    expect(resolveHumanizer(null)).toEqual(DEFAULT_HUMANIZER);
    expect(resolveHumanizer({ typoChance: 0 }).typoChance).toBe(0);
  });
});
