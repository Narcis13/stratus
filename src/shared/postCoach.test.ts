import { describe, expect, test } from 'bun:test';
import { type CoachCheck, type CoachResult, DEFAULT_LEXICON, scoreDraft } from './postCoach.ts';

function getCheck(result: CoachResult, id: string): CoachCheck {
  const check = result.checks.find((c) => c.id === id);
  if (!check) throw new Error(`check ${id} missing from result`);
  return check;
}

function status(text: string, id: string, opts?: Parameters<typeof scoreDraft>[1]): string {
  return getCheck(scoreDraft(text, opts), id).status;
}

// The plan's done-when fixture: em-dash + "thoughts?" + 15 raw lines, clean on
// everything else. 8 content lines (28 words) separated by 7 blanks = 15 raw.
const THREE_FIRING = [
  'I cut editing time by 70%.',
  '',
  'Not more tools — one checklist.',
  '',
  'Built it after 40 bad drafts.',
  '',
  'Steal it.',
  '',
  'Then measure.',
  '',
  'Keep what works.',
  '',
  'Cut the rest.',
  '',
  'thoughts?',
].join('\n');

describe('scoreDraft — aggregate behavior', () => {
  test('empty draft scores 0 without throwing', () => {
    const r = scoreDraft('');
    expect(r.score).toBe(0);
    expect(r.band).toBe('rework');
    expect(r.checks).toEqual([]);
    expect(r.counts).toEqual({ pass: 0, nudge: 0, fix: 0 });
    expect(scoreDraft('   \n  ').score).toBe(0);
  });

  test('the done-when fixture fires exactly em_dash, show_more, weak_closer', () => {
    const r = scoreDraft(THREE_FIRING);
    const nonPass = r.checks
      .filter((c) => c.status !== 'pass')
      .map((c) => c.id)
      .sort();
    expect(nonPass).toEqual(['em_dash', 'show_more', 'weak_closer']);
    expect(r.counts).toEqual({ pass: 26, nudge: 2, fix: 1 });
  });

  test('aggregation formula: min(standard, quality) over the returned checks', () => {
    const r = scoreDraft(THREE_FIRING);
    // standard: 20 hygiene+craft checks — 17 pass + 2 nudge + 1 fix = 18/20 = 90
    // quality: all 9 signal checks pass = 40 + 60 = 100; min = 90, no caps at 28 words
    expect(r.score).toBe(90);
    expect(r.band).toBe('top');
    const standardChecks = r.checks.filter((c) => c.group !== 'signal');
    const signalChecks = r.checks.filter((c) => c.group === 'signal');
    expect(standardChecks).toHaveLength(20);
    expect(signalChecks).toHaveLength(9);
  });

  test('a 3-word draft never exceeds 25 (short cap)', () => {
    expect(scoreDraft('Shipped 40 features').score).toBeLessThanOrEqual(25);
    // char arm: >=4 words but under 15 chars
    expect(scoreDraft('go do it ok').score).toBeLessThanOrEqual(25);
  });

  test('a thin draft never exceeds 65 (thin cap, both arms)', () => {
    // 6 words (>=4, <7), 31 chars
    expect(scoreDraft('Shipped the whole thing today folks').score).toBeLessThanOrEqual(65);
    // 7 words but under 30 chars
    expect(scoreDraft('go do it now ok yes mate').score).toBeLessThanOrEqual(65);
  });
});

describe('hygiene checks', () => {
  test('substance: <4 words is a fix, <7 a nudge, else pass', () => {
    expect(status('Big news.', 'substance')).toBe('fix');
    expect(status('Big news coming this week.', 'substance')).toBe('nudge');
    expect(status(THREE_FIRING, 'substance')).toBe('pass');
  });

  test('em_dash fires on em/en dash', () => {
    expect(status('Growth — the hard way.', 'em_dash')).toBe('nudge');
    expect(status('Growth, the hard way.', 'em_dash')).toBe('pass');
  });

  test('weak_closer fires on canned endings', () => {
    expect(status('Shipped the new build today. Agree?', 'weak_closer')).toBe('nudge');
    expect(status('Shipped the new build today.', 'weak_closer')).toBe('pass');
  });

  test('buzzwords fires on corporate speak', () => {
    expect(status('We need to leverage synergy here.', 'buzzwords')).toBe('nudge');
    expect(status('We need to use plain words here.', 'buzzwords')).toBe('pass');
  });

  test('ai_tells fires on LLM-flavored phrasing', () => {
    expect(status("Let's delve into the tapestry of growth.", 'ai_tells')).toBe('nudge');
    expect(status("Let's dig into how growth works.", 'ai_tells')).toBe('pass');
  });

  test('hashtags fires above 2', () => {
    expect(status('Shipping today #buildinpublic #indiehackers #startup', 'hashtags')).toBe(
      'nudge',
    );
    expect(status('Shipping today #buildinpublic #indiehackers', 'hashtags')).toBe('pass');
  });

  test('all_caps fires on shouting but allows acronyms', () => {
    expect(status('STOP DOING THIS to your drafts.', 'all_caps')).toBe('nudge');
    expect(status('Use the API and an LLM daily.', 'all_caps')).toBe('pass');
  });

  test('spammy_punct fires on stacked marks', () => {
    expect(status('This launch is huge!!!', 'spammy_punct')).toBe('nudge');
    expect(status('This launch is huge!', 'spammy_punct')).toBe('pass');
  });

  test('weak_opener fires on just/honestly/I think', () => {
    expect(status('Honestly, the feature is fine.', 'weak_opener')).toBe('nudge');
    expect(status('The feature is fine, honestly.', 'weak_opener')).toBe('pass');
  });

  test('one_breath fires on a single unbroken 25+ word line', () => {
    const wall = Array.from({ length: 26 }, (_, i) => `word${i}`).join(' ');
    expect(status(wall, 'one_breath')).toBe('nudge');
    expect(status(THREE_FIRING, 'one_breath')).toBe('pass');
  });

  test('show_more fires at 15 raw lines (blanks count), passes at 14', () => {
    expect(status(THREE_FIRING, 'show_more')).toBe('fix');
    const fourteen = THREE_FIRING.split('\n').slice(0, 13).join('\n');
    expect(status(fourteen, 'show_more')).toBe('pass');
  });

  test('word_count fires above 30 words', () => {
    const long = `${Array.from({ length: 16 }, (_, i) => `word${i}`).join(' ')}\n\n${Array.from(
      { length: 16 },
      (_, i) => `more${i}`,
    ).join(' ')}`;
    expect(status(long, 'word_count')).toBe('nudge');
    expect(status(THREE_FIRING, 'word_count')).toBe('pass');
  });

  test('hedges fires when stacked past 2', () => {
    expect(status('Maybe this might work, perhaps, probably.', 'hedges')).toBe('nudge');
    expect(status('Maybe this works. We will see today.', 'hedges')).toBe('pass');
  });
});

describe('craft checks', () => {
  test('hook_opener nudges a flat first line', () => {
    expect(status('The weather was nice yesterday evening.', 'hook_opener')).toBe('nudge');
    expect(status('I deleted half my drafts yesterday.', 'hook_opener')).toBe('pass');
  });

  test('tension nudges when there is no turn', () => {
    expect(status('Shipped a tiny feature today.', 'tension')).toBe('nudge');
    expect(status('Shipped a tiny feature today, but slowly.', 'tension')).toBe('pass');
  });

  test('concrete_detail nudges without numbers or anchors', () => {
    expect(status('Some thoughts about growing an audience online.', 'concrete_detail')).toBe(
      'nudge',
    );
    expect(status('Grew the audience by 40% in March.', 'concrete_detail')).toBe('pass');
  });

  test('quotable nudges when no line is screenshot-short', () => {
    const rambling =
      'The first line of this draft keeps going and going without a stop.\nAnd the final line also keeps going and going without ever stopping at all.';
    expect(status(rambling, 'quotable')).toBe('nudge');
    expect(status('Ship the ugly version first every time.', 'quotable')).toBe('pass');
  });

  test('value_signal nudges when nothing is taught, proven, or funny', () => {
    expect(status('The weather was nice yesterday evening in town.', 'value_signal')).toBe('nudge');
    expect(status('I learned more from 10 flops than any course.', 'value_signal')).toBe('pass');
  });

  test('breathing_room nudges adjacent non-empty lines', () => {
    expect(status('Line one here today\nLine two here today', 'breathing_room')).toBe('nudge');
    expect(status('Line one here today\n\nLine two here today', 'breathing_room')).toBe('pass');
  });

  test('ends_question nudges statement endings', () => {
    expect(status('Consistency beats intensity.', 'ends_question')).toBe('nudge');
    expect(status('What would you cut first?', 'ends_question')).toBe('pass');
  });
});

describe('signal checks', () => {
  test('answerable_question: 3+ stacked is a fix, 2 a nudge, 1 passes', () => {
    expect(status('What do you think? Why does it matter? Who wins?', 'answerable_question')).toBe(
      'fix',
    );
    expect(status('What do you think? Why does it matter?', 'answerable_question')).toBe('nudge');
    expect(status('What would you cut first?', 'answerable_question')).toBe('pass');
  });

  test('vague_curiosity is a fix without a concrete anchor', () => {
    expect(status("You won't believe what happened next.", 'vague_curiosity')).toBe('fix');
    expect(status("You won't believe it: 47 signups in one day.", 'vague_curiosity')).toBe('pass');
  });

  test('standalone_context nudges a bare this/that/it opener', () => {
    expect(status('This changed everything.', 'standalone_context')).toBe('nudge');
    expect(status('This 30-day sprint changed everything.', 'standalone_context')).toBe('pass');
  });

  test('sweeping_claim nudges absolutes without evidence', () => {
    expect(status('Everyone always fails at consistency.', 'sweeping_claim')).toBe('nudge');
    expect(status('Everyone fails at this: I measured 40 attempts.', 'sweeping_claim')).toBe(
      'pass',
    );
  });

  test('profile_click nudges generic advice, passes lived proof', () => {
    expect(status('You should post consistently to grow.', 'profile_click')).toBe('nudge');
    expect(status('I grew from 200 to 900 followers in 30 days.', 'profile_click')).toBe('pass');
  });

  test('one_idea nudges topic switches', () => {
    expect(status('Shipped the editor. Also, another thing: pricing changed.', 'one_idea')).toBe(
      'nudge',
    );
    expect(status('Shipped the editor today after two weeks.', 'one_idea')).toBe('pass');
  });

  test('dense_line nudges a 180+ char line', () => {
    const dense = `${'a'.repeat(60)}${' word '.repeat(25)}end of the very long line`;
    expect(dense.length).toBeGreaterThanOrEqual(180);
    expect(status(dense, 'dense_line')).toBe('nudge');
    expect(status(THREE_FIRING, 'dense_line')).toBe('pass');
  });

  test('url_cost is a fix in a standalone post, pass in a reply', () => {
    const withUrl = 'Full write-up here https://example.com for everyone interested.';
    expect(status(withUrl, 'url_cost')).toBe('fix');
    expect(getCheck(scoreDraft(withUrl), 'url_cost').label).toContain('$0.20');
    expect(status(withUrl, 'url_cost', { isReply: true })).toBe('pass');
    expect(status('No links in this one, promise.', 'url_cost')).toBe('pass');
  });

  test('mention_density nudges at 3+ mentions', () => {
    expect(status('@alice @bob @carol great shipping week, team.', 'mention_density')).toBe(
      'nudge',
    );
    expect(status('@alice @bob great shipping week, team.', 'mention_density')).toBe('pass');
  });
});

describe('options', () => {
  test('isReply drops hook_opener and breathing_room but keeps hygiene + signal', () => {
    const reply = scoreDraft('Line one here today\nLine two here today', { isReply: true });
    expect(reply.checks.find((c) => c.id === 'hook_opener')).toBeUndefined();
    expect(reply.checks.find((c) => c.id === 'breathing_room')).toBeUndefined();
    expect(getCheck(reply, 'em_dash')).toBeDefined();
    expect(getCheck(reply, 'profile_click')).toBeDefined();
    const post = scoreDraft('Line one here today\nLine two here today');
    expect(getCheck(post, 'hook_opener')).toBeDefined();
    expect(getCheck(post, 'breathing_room')).toBeDefined();
  });

  test('lexicon override: a specific term counts as concrete detail', () => {
    const text = 'Some thoughts about protein timing for recovery.';
    expect(status(text, 'concrete_detail')).toBe('nudge');
    expect(
      status(text, 'concrete_detail', {
        lexicon: { specificTerms: ['protein'], tribeTerms: [] },
      }),
    ).toBe('pass');
    expect(DEFAULT_LEXICON.specificTerms).toEqual([]);
  });
});
