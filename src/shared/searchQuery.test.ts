import { describe, expect, test } from 'bun:test';
import {
  type CompileResult,
  FAVES_LADDER,
  MAX_QUERY_LENGTH,
  MAX_TERMS_PER_FIELD,
  MAX_TERM_LENGTH,
  type SearchQuery,
  compileSearchQuery,
  nextRung,
  parseSearchQuery,
  prevRung,
  searchUrl,
} from './searchQuery.ts';

const errorFields = (r: CompileResult): string[] =>
  r.problems.filter((p) => p.level === 'error').map((p) => p.field);
const warnFields = (r: CompileResult): string[] =>
  r.problems.filter((p) => p.level === 'warn').map((p) => p.field);
const hasError = (r: CompileResult): boolean => r.problems.some((p) => p.level === 'error');

/** Every field at once. The golden case — if the compiled string below ever
 *  changes, either a clause moved (which breaks saved-search diffs) or an
 *  operator did (which silently widens every hunt). */
const FULL: SearchQuery = {
  all: ['bun'],
  any: ['sqlite', 'drizzle'],
  phrases: ['build in public'],
  none: ['crypto'],
  from: 'levelsio',
  to: 'dhh',
  mentions: ['vercel'],
  hashtags: ['buildinpublic'],
  minFaves: 400,
  minRetweets: 20,
  minReplies: 5,
  replies: 'exclude',
  media: 'images',
  hasLinks: true,
  noRetweets: true,
  lang: 'en',
  since: '2026-07-01',
  until: '2026-08-01',
  sort: 'top',
};

const FULL_QUERY =
  'bun (sqlite OR drizzle) "build in public" from:levelsio to:dhh @vercel #buildinpublic ' +
  '-crypto min_faves:400 min_retweets:20 min_replies:5 -filter:replies filter:images ' +
  'filter:links -filter:nativeretweets lang:en since:2026-07-01 until:2026-08-01';

describe('compileSearchQuery — the golden string', () => {
  test('every field compiles in the fixed clause order, byte for byte', () => {
    const r = compileSearchQuery(FULL);
    expect(r.query).toBe(FULL_QUERY);
    expect(r.length).toBe(245);
    expect(r.length).toBe(r.query.length);
    expect(r.overLimit).toBe(false);
    expect(r.problems).toEqual([]);
  });

  test('the same params always produce the same string', () => {
    expect(compileSearchQuery(FULL).query).toBe(compileSearchQuery(FULL).query);
  });
});

describe('compileSearchQuery — the OR group', () => {
  test('a group of one is still parenthesized', () => {
    expect(compileSearchQuery({ any: ['sqlite'] }).query).toBe('(sqlite)');
  });

  test('AND terms precede the group and the group stays bracketed', () => {
    const r = compileSearchQuery({ all: ['bun'], any: ['sqlite', 'drizzle'] });
    expect(r.query).toBe('bun (sqlite OR drizzle)');
    expect(hasError(r)).toBe(false);
  });

  test('OR is uppercase — lowercase would match the literal word', () => {
    const q = compileSearchQuery({ any: ['a', 'b'] }).query;
    expect(q).toContain(' OR ');
    expect(q).not.toContain(' or ');
  });

  test('a multi-word OR member warns but still compiles', () => {
    const r = compileSearchQuery({ any: ['build in public', 'sqlite'] });
    expect(r.query).toBe('(build in public OR sqlite)');
    expect(warnFields(r)).toEqual(['any']);
    expect(hasError(r)).toBe(false);
  });
});

describe('compileSearchQuery — phrases and quotes', () => {
  test('phrases are quoted', () => {
    expect(compileSearchQuery({ phrases: ['build in public'] }).query).toBe('"build in public"');
  });

  test('an inner quote is an error, not a silent strip', () => {
    const r = compileSearchQuery({ phrases: ['he said "no"'] });
    expect(errorFields(r)).toEqual(['phrases']);
    expect(r.query).not.toContain('he said');
  });

  test('a quote inside a bare keyword is an error too', () => {
    const r = compileSearchQuery({ all: ['bun', 'we"ird'] });
    expect(errorFields(r)).toEqual(['all']);
    expect(r.query).toBe('bun');
  });
});

describe('compileSearchQuery — handles and hashtags', () => {
  test('a normalized handle compiles as from:', () => {
    expect(compileSearchQuery({ from: 'levelsio' }).query).toBe('from:levelsio');
  });

  test('parse strips one leading @ before the compiler ever sees it', () => {
    expect(parseSearchQuery({ from: ' @levelsio ' })?.from).toBe('levelsio');
    expect(parseSearchQuery({ mentions: ['@vercel'] })?.mentions).toEqual(['vercel']);
  });

  test('a 16-char handle is an error', () => {
    const r = compileSearchQuery({ from: 'a'.repeat(16) });
    expect(errorFields(r)).toEqual(['from']);
    expect(r.query).toBe('');
  });

  test('a handle with a dot is an error', () => {
    expect(errorFields(compileSearchQuery({ to: 'some.one' }))).toContain('to');
    expect(errorFields(compileSearchQuery({ mentions: ['some.one'] }))).toContain('mentions');
  });

  test('parse strips one leading # and the compiler puts it back', () => {
    const q = parseSearchQuery({ hashtags: ['#buildinpublic'] });
    expect(q?.hashtags).toEqual(['buildinpublic']);
    expect(compileSearchQuery({ hashtags: ['buildinpublic'] }).query).toBe('#buildinpublic');
  });

  test('a hashtag starting with a digit warns rather than erroring', () => {
    const r = compileSearchQuery({ hashtags: ['100daysofcode'] });
    expect(r.query).toBe('#100daysofcode');
    expect(warnFields(r)).toEqual(['hashtags']);
    expect(hasError(r)).toBe(false);
  });

  test('a hashtag with punctuation is an error', () => {
    expect(errorFields(compileSearchQuery({ hashtags: ['build-in-public'] }))).toContain(
      'hashtags',
    );
  });
});

describe('compileSearchQuery — negations', () => {
  test('each excluded term gets its own leading dash', () => {
    expect(compileSearchQuery({ all: ['bun'], none: ['crypto', 'nft'] }).query).toBe(
      'bun -crypto -nft',
    );
  });

  test('parse strips a leading dash the user typed themselves', () => {
    expect(parseSearchQuery({ none: ['-crypto'] })?.none).toEqual(['crypto']);
  });

  test('a multi-word exclusion warns — only the first word is actually excluded', () => {
    const r = compileSearchQuery({ all: ['bun'], none: ['build in public'] });
    expect(r.query).toBe('bun -build in public');
    expect(warnFields(r)).toEqual(['none']);
    expect(r.problems.map((p) => p.message).join()).toContain('"build"');
  });
});

describe('compileSearchQuery — filters', () => {
  test('replies is an enum, and only one arm can fire', () => {
    expect(compileSearchQuery({ all: ['bun'], replies: 'exclude' }).query).toBe(
      'bun -filter:replies',
    );
    expect(compileSearchQuery({ all: ['bun'], replies: 'only' }).query).toBe('bun filter:replies');
    const anyArm = compileSearchQuery({ all: ['bun'], replies: 'any' }).query;
    expect(anyArm).toBe('bun');
    expect(anyArm).not.toContain('filter:replies');
  });

  test('each media member compiles to its own operator', () => {
    expect(compileSearchQuery({ all: ['x'], media: 'media' }).query).toBe('x filter:media');
    expect(compileSearchQuery({ all: ['x'], media: 'images' }).query).toBe('x filter:images');
    expect(compileSearchQuery({ all: ['x'], media: 'videos' }).query).toBe('x filter:videos');
    expect(compileSearchQuery({ all: ['x'], media: 'native_video' }).query).toBe(
      'x filter:native_video',
    );
    expect(compileSearchQuery({ all: ['x'], media: 'any' }).query).toBe('x');
  });

  test('hasLinks has both arms; noRetweets only has the negative one', () => {
    expect(compileSearchQuery({ all: ['x'], hasLinks: true }).query).toBe('x filter:links');
    expect(compileSearchQuery({ all: ['x'], hasLinks: false }).query).toBe('x -filter:links');
    expect(compileSearchQuery({ all: ['x'], noRetweets: true }).query).toBe(
      'x -filter:nativeretweets',
    );
    expect(compileSearchQuery({ all: ['x'], noRetweets: false }).query).toBe('x');
  });
});

describe('compileSearchQuery — engagement floors', () => {
  test('floors compile in faves/retweets/replies order', () => {
    expect(
      compileSearchQuery({ all: ['x'], minFaves: 400, minRetweets: 20, minReplies: 5 }).query,
    ).toBe('x min_faves:400 min_retweets:20 min_replies:5');
  });

  test('0 and negative floors omit the clause entirely', () => {
    expect(compileSearchQuery({ all: ['x'], minFaves: 0 }).query).toBe('x');
    expect(compileSearchQuery({ all: ['x'], minFaves: -3 }).query).toBe('x');
    expect(parseSearchQuery({ all: ['x'], minFaves: 0 })).toEqual({ all: ['x'] });
    expect(parseSearchQuery({ all: ['x'], minFaves: -3 })).toEqual({ all: ['x'] });
  });
});

describe('compileSearchQuery — dates', () => {
  test('valid dates compile as since:/until:', () => {
    expect(compileSearchQuery({ all: ['x'], since: '2026-07-01', until: '2026-08-01' }).query).toBe(
      'x since:2026-07-01 until:2026-08-01',
    );
  });

  test('until before since is an error', () => {
    const r = compileSearchQuery({ all: ['x'], since: '2026-08-01', until: '2026-07-01' });
    expect(errorFields(r)).toEqual(['until']);
  });

  test('an impossible calendar date is an error', () => {
    expect(errorFields(compileSearchQuery({ all: ['x'], since: '2026-02-31' }))).toEqual(['since']);
  });

  test('an unpadded date is an error', () => {
    expect(errorFields(compileSearchQuery({ all: ['x'], since: '2026-7-1' }))).toEqual(['since']);
  });

  test('a leap day is fine in a leap year and not otherwise', () => {
    expect(hasError(compileSearchQuery({ all: ['x'], since: '2028-02-29' }))).toBe(false);
    expect(hasError(compileSearchQuery({ all: ['x'], since: '2026-02-29' }))).toBe(true);
  });
});

describe('compileSearchQuery — lang', () => {
  test('an allowlisted code compiles', () => {
    expect(compileSearchQuery({ all: ['x'], lang: 'ro' }).query).toBe('x lang:ro');
    expect(compileSearchQuery({ all: ['x'], lang: 'en' }).query).toBe('x lang:en');
  });

  test('an unknown code is an error — on X it silently returns nothing', () => {
    const r = compileSearchQuery({ all: ['x'], lang: 'zz' });
    expect(errorFields(r)).toEqual(['lang']);
    expect(r.query).toBe('x');
  });
});

describe('compileSearchQuery — a search needs something to match', () => {
  test('an entirely empty query is an error', () => {
    const r = compileSearchQuery({});
    expect(errorFields(r)).toEqual(['query']);
    expect(r.problems.map((p) => p.message).join()).toContain('Empty search');
  });

  test('only negations, filters and floors is the same mistake', () => {
    const r = compileSearchQuery({ none: ['crypto'], replies: 'exclude', minFaves: 400 });
    expect(errorFields(r)).toEqual(['query']);
    expect(r.problems.map((p) => p.message).join()).toContain("don't find one");
  });

  test('a bare from: IS a matcher — a profile outlier hunt is legitimate', () => {
    const r = compileSearchQuery({ from: 'levelsio', minFaves: 400 });
    expect(r.query).toBe('from:levelsio min_faves:400');
    expect(hasError(r)).toBe(false);
  });

  test('an attempted-but-invalid matcher does not also raise the empty error', () => {
    const r = compileSearchQuery({ all: ['we"ird'] });
    expect(errorFields(r)).toEqual(['all']);
  });
});

describe('compileSearchQuery — the 512-char cap', () => {
  test('overflow sets overLimit, raises an error, and blocks the url', () => {
    const long: SearchQuery = {
      all: Array.from({ length: 20 }, (_, i) => `${'x'.repeat(30)}${i}`),
    };
    const r = compileSearchQuery(long);
    expect(r.length).toBeGreaterThan(MAX_QUERY_LENGTH);
    expect(r.overLimit).toBe(true);
    expect(errorFields(r)).toEqual(['query']);
    expect(searchUrl(long)).toBeNull();
  });

  test('a query exactly at the cap is fine', () => {
    const r = compileSearchQuery({ all: ['a'.repeat(MAX_QUERY_LENGTH)] });
    expect(r.length).toBe(MAX_QUERY_LENGTH);
    expect(r.overLimit).toBe(false);
    expect(hasError(r)).toBe(false);
  });
});

describe('compileSearchQuery — operator-shaped keywords', () => {
  test('a keyword containing ":" warns and still compiles', () => {
    const r = compileSearchQuery({ all: ['min_faves:50'] });
    expect(r.query).toBe('min_faves:50');
    expect(warnFields(r)).toEqual(['all']);
    expect(hasError(r)).toBe(false);
  });

  test('entity-shaped keywords are left exactly alone', () => {
    const r = compileSearchQuery({ all: ['#tag', '@user', '$TICK'] });
    expect(r.query).toBe('#tag @user $TICK');
    expect(r.problems).toEqual([]);
  });
});

describe('compileSearchQuery — never throws', () => {
  test('a table of junk inputs all return a result', () => {
    const junk: unknown[] = [
      {},
      { all: 'not an array' },
      { all: [null, 1, {}, 'ok'] },
      { any: [] },
      { from: 42 },
      { to: null },
      { mentions: 'nope' },
      { hashtags: [Symbol.iterator] },
      { minFaves: Number.NaN },
      { minFaves: Number.POSITIVE_INFINITY },
      { minRetweets: '400' },
      { replies: 'sideways' },
      { media: 7 },
      { hasLinks: 'yes' },
      { lang: 12 },
      { since: {} },
      { until: [] },
      { sort: 'sideways' },
      { all: ['ok'], phrases: [undefined] },
    ];
    for (const input of junk) {
      const q = input as SearchQuery;
      expect(() => compileSearchQuery(q)).not.toThrow();
      expect(() => searchUrl(q)).not.toThrow();
      expect(typeof compileSearchQuery(q).query).toBe('string');
    }
  });
});

describe('searchUrl', () => {
  test('the q param round-trips to the exact compiled string', () => {
    const url = searchUrl(FULL);
    expect(url).not.toBeNull();
    const q = new URL(url ?? '').searchParams.get('q');
    expect(q).toBe(FULL_QUERY);
    expect(decodeURIComponent(encodeURIComponent(FULL_QUERY))).toBe(FULL_QUERY);
  });

  test('sort picks the results tab', () => {
    expect(searchUrl({ all: ['bun'], sort: 'top' })).toBe('https://x.com/search?q=bun&f=top');
    expect(searchUrl({ all: ['bun'], sort: 'live' })).toBe('https://x.com/search?q=bun&f=live');
    expect(searchUrl({ all: ['bun'] })).toBe('https://x.com/search?q=bun&f=live');
  });

  test('opts.sort overrides the query without editing it', () => {
    expect(searchUrl({ all: ['bun'], sort: 'live' }, { sort: 'top' })).toBe(
      'https://x.com/search?q=bun&f=top',
    );
  });

  test('null iff the compile has an error — a warning still runs', () => {
    expect(searchUrl({ lang: 'zz' })).toBeNull();
    expect(searchUrl({})).toBeNull();
    expect(searchUrl({ all: ['min_faves:50'] })).toBe(
      'https://x.com/search?q=min_faves%3A50&f=live',
    );
  });
});

describe('FAVES_LADDER', () => {
  test('nextRung walks up and stops at the top', () => {
    const walked: number[] = [];
    let n = 0;
    for (let i = 0; i < FAVES_LADDER.length; i++) {
      n = nextRung(n);
      walked.push(n);
    }
    expect(walked).toEqual([...FAVES_LADDER]);
    expect(nextRung(5000)).toBe(5000);
    expect(nextRung(9999)).toBe(5000);
  });

  test('prevRung walks down and bottoms out at 0 — the "off" state', () => {
    const walked: number[] = [];
    let n = 5000;
    for (let i = 0; i < FAVES_LADDER.length; i++) {
      n = prevRung(n);
      walked.push(n);
    }
    expect(walked).toEqual([2000, 1200, 800, 500, 300, 200, 100, 50, 0]);
    expect(prevRung(50)).toBe(0);
    expect(prevRung(0)).toBe(0);
  });

  test('an off-ladder value snaps to the neighbouring rungs', () => {
    expect(nextRung(437)).toBe(500);
    expect(prevRung(437)).toBe(300);
  });

  test('non-finite input degrades instead of throwing', () => {
    expect(nextRung(Number.NaN)).toBe(50);
    expect(prevRung(Number.NaN)).toBe(0);
  });
});

describe('parseSearchQuery', () => {
  test('null only when the value is not an object', () => {
    expect(parseSearchQuery(null)).toBeNull();
    expect(parseSearchQuery(42)).toBeNull();
    expect(parseSearchQuery('x')).toBeNull();
    expect(parseSearchQuery(undefined)).toBeNull();
    expect(parseSearchQuery([])).toBeNull();
    expect(parseSearchQuery({})).toEqual({});
  });

  test('terms are trimmed, emptied and deduped case-insensitively, first seen wins', () => {
    expect(parseSearchQuery({ all: ['  a  ', '', 'A'] })).toEqual({ all: ['a'] });
    expect(parseSearchQuery({ all: ['Bun', 'bun', 'BUN', 'sqlite'] })).toEqual({
      all: ['Bun', 'sqlite'],
    });
  });

  test('unknown fields are ignored and bad ones degrade field by field', () => {
    const q = parseSearchQuery({ all: ['bun'], nonsense: true, from: 12, minFaves: 'lots' });
    expect(q).toEqual({ all: ['bun'] });
  });

  test('arrays cap at MAX_TERMS_PER_FIELD and terms at MAX_TERM_LENGTH', () => {
    const many = Array.from({ length: MAX_TERMS_PER_FIELD + 5 }, (_, i) => `t${i}`);
    expect(parseSearchQuery({ all: many })?.all).toHaveLength(MAX_TERMS_PER_FIELD);
    const over = 'x'.repeat(MAX_TERM_LENGTH + 1);
    expect(parseSearchQuery({ all: [over, 'keep'] })).toEqual({ all: ['keep'] });
  });

  test('an unknown replies/media coerces to its default, an unknown sort drops', () => {
    expect(parseSearchQuery({ replies: 'sideways' })?.replies).toBe('any');
    expect(parseSearchQuery({ media: 'gifs' })?.media).toBe('any');
    // D200: the sort default is the x.outliers.sort knob, which lives outside
    // this module — absent and unrecognized must mean the same thing.
    expect(parseSearchQuery({ sort: 'newest' })).toEqual({});
    expect(parseSearchQuery({ sort: 'top' })?.sort).toBe('top');
  });

  test('noRetweets:false normalizes away; hasLinks:false survives', () => {
    expect(parseSearchQuery({ noRetweets: false })).toEqual({});
    expect(parseSearchQuery({ hasLinks: false })).toEqual({ hasLinks: false });
  });

  test('a normalized query survives a JSON round trip unchanged', () => {
    const once = parseSearchQuery(FULL);
    const twice = parseSearchQuery(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  test('normalizing junk is idempotent too', () => {
    const messy = {
      all: [' bun ', 'BUN', ''],
      none: ['-crypto'],
      from: '@levelsio',
      hashtags: ['#tag'],
      minFaves: 400.7,
      replies: 'nope',
      sort: 'nope',
    };
    const once = parseSearchQuery(messy);
    expect(once).toEqual({
      all: ['bun'],
      none: ['crypto'],
      from: 'levelsio',
      hashtags: ['tag'],
      minFaves: 400,
      replies: 'any',
    });
    expect(parseSearchQuery(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  test('a normalized query compiles without shape problems', () => {
    const q = parseSearchQuery(FULL);
    expect(q).not.toBeNull();
    expect(compileSearchQuery(q ?? {}).query).toBe(FULL_QUERY);
  });
});
