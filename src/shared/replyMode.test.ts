import { describe, expect, test } from 'bun:test';
import {
  GENERAL_MODE,
  OPENING_BANS,
  REPLY_ANGLES,
  REPLY_MODES,
  type ReplyModeId,
  containsLaneNoun,
  detectReplyMode,
  resolveModeId,
} from './replyMode.ts';

/**
 * Real parents, `harvest_rows.orig_text`, pulled 2026-08-08 over the $0 explorer.
 *
 * Deliberately the ACTUAL distribution rather than sentences written to pass:
 * @hiiragi2280 / @yoshi_majime / @dokuneee post raw Japanese since the harvester
 * stopped translating, @zerohedge posts headline fragments with no verb, and
 * @chiamakaafc posts four-word football bait. A hand-written corpus would have
 * none of those shapes and the heuristic would look far better than it is.
 *
 * `null` rows are the point of the file, not its failures: an honest UNKNOWN
 * falls through to the roster pin and then to `general` (§7.11), and every one
 * below is a post where a keyword vote genuinely cannot separate the rooms.
 */
const CORPUS: readonly (readonly [ReplyModeId | null, string, string])[] = [
  // ---- expertise: the §8 Arm B lane, the only room where the persona is on
  [
    'expertise',
    'i_mika_el',
    'CLI agents already won. the IDE is a legacy interface — most devs just haven’t noticed yet.',
  ],
  [
    'expertise',
    'aryanlabde',
    'Vibe coders, are you making more from your SaaS than you’re spending on claude?',
  ],
  [
    'expertise',
    'marclou',
    'Top marketing channels for startups on @trust_mrr : SEO — $10.3M Content marketing — $8M Instagram — $7.6M Facebook — $6M Word of mouth — $5.7M Blog — $5M',
  ],
  [
    'expertise',
    'stevbuilds',
    'why is Germany so behind in AI they gave us best cars medical revolutions first small cameras and the MP3-Format and yet barely show up in the AI race what actually happened?',
  ],
  [
    'expertise',
    'rauchg',
    'The big lesson from AI is that everything is code. A slide deck is code. Design is code. That cool promo video? Code. Excel automation? Code.',
  ],
  [
    'expertise',
    'pmitu',
    'Startup idea for 2027: - rehab for vibe coders (no internet, no models, no tokens)',
  ],
  [
    'expertise',
    'kuberdenis',
    'guys how do i explain to him saas is dead, software is solved, distribution is pay-to-win, and the only valid long term individual bet is becoming a mediocre youtube videos creator',
  ],
  [
    'expertise',
    'jonbuildshq',
    'Small win: I found a few sentences on the PageGains homepage that were confusing. Deleted them. Landing pages can improve more from deleting than adding!',
  ],
  [
    'expertise',
    'lauriewired',
    'This is gonna make Rust programmers angry. Reflection is one of the most powerful concepts in Computer Science. Unfortunately, not every programming language is blessed enough to have it.',
  ],
  [
    'expertise',
    'elonmusk',
    'SpaceX’s massive corpus of world-class engineering data (excluding material blocked by ITAR) will be added during supplemental training of the 2T run. This will dramatically improve Grok’s engineering capabilities.',
  ],
  [
    'expertise',
    'officiallogank',
    'We have started our most ambitious pre-training run yet, for Gemini 4, and are excited by the progress : )',
  ],
  [
    'expertise',
    'theo',
    'My theory: Opus 5(.1) was meant to replace Fable 5 for most dev work. It would be cheaper and bench nearly as well.',
  ],
  ['expertise', 'jonbuildshq', 'How much MRR would make you quit your job today?'],
  [
    'expertise',
    'favedevv',
    'If I had 6 months to become an AI Agent Engineer, this is the roadmap I’d follow : Month 1 : Learn the Basics • Python • APIs • JSON • Async programming • FastAPI',
  ],
  // A lane post that opens with an opinion marker still resolves to the lane —
  // `expertise` outscores `hot-take` because the nouns are all mine.
  [
    'expertise',
    'yashhq_22',
    'hot take: the solo founder who posts daily will outlast the funded startup. distribution compounds.',
  ],

  // ---- news: reported events. `stance`, never a biography.
  [
    'news',
    'reuters',
    'Senate confirms Trump pick to oversee TSA as administration pushes private airport security http://reut.rs/4c4er0Q',
  ],
  [
    'news',
    'reuters',
    'Spain plans burials, seeks identities of those killed in Ceuta migrant rush http://reut.rs/4wKiBDn',
  ],
  ['news', 'watcherguru', 'JUST IN: $65,000 Bitcoin'],
  ['news', 'watcherguru', 'JUST IN: Trump Media terminates planned crypto deals with Crypto․com'],
  [
    'news',
    'zerohedge',
    'The BofA Bull & Bear Indicator rises to 9.7 from 9.4, the highest since 2021 and in “sell signal” territory',
  ],
  ['news', 'zerohedge', 'Indian Refiners Continue West Africa Crude Buying Spree'],
  [
    'news',
    'zerohedge',
    "Peace Plans & Payrolls Plunge Trounce Rate-Hike Odds, Spark Gold's Best Week In 7 Months",
  ],

  // ---- hot-take: the room that produced the 19,088-view reply
  [
    'hot-take',
    'ayesha_diaries1',
    'What men call “romance” vs what women actually want as romance Man’s version: • Buying flowers once a year • Planning a fancy dinner on her birthday',
  ],
  [
    'hot-take',
    'sxhealth101',
    "If you're 33 years old, it's unfair to be with a 28-year-old woman. She's too old for you. She's being predatory. Men and women live lives on different cycles.",
  ],
  [
    'hot-take',
    'sxhealth101',
    'Want to naturally improve your libido? Start here: • Lose excess body fat. • Lift heavy. • Sleep before midnight. • Get morning sunlight.',
  ],
  ['hot-take', 'latinacasanova', 'Advice for those under 30: Date every type of woman'],
  [
    'hot-take',
    'latinacasanova',
    'The birthday test and vacation test reveal everything in a relationship',
  ],
  [
    'hot-take',
    'mindmatter28',
    'You are bored because you are not doing side quests. Life is not just work and lying in bed doing nothing. Here are 50 side quests every man should complete:',
  ],
  [
    'hot-take',
    'yuruazabu',
    'People who drag it out all day over just a light criticism—anyone like that around you? That’s not a lack of confidence; it’s just that their hidden self-esteem is sky-high.',
  ],

  // ---- wholesome: animals, kids, grief, art. Half of it is raw Japanese.
  ['wholesome', 'ponko008', 'The result of having the child write their name (0/3)'],
  ['wholesome', 'j4gkb', 'Dad and Mom\'s Student Days. "Memories" (1/2)'],
  ['wholesome', 'j4gkb', 'Sibling love, taken to the extreme. (1/2)'],
  [
    'wholesome',
    'hiiragi2280',
    '祖父の葬儀で、 受付に立った。 一人だけ、 封筒に金額が書いてなかった。 中を見たら、3千円。 祖母がその封筒だけ、 別にしまってた。',
  ],
  [
    'wholesome',
    'yoshi_majime',
    '適応障害を克服した、同期が言ってた。 克服したのって、 ストレスの原因をどうにかしたからじゃないらしい。 配置転換とか、環境が変わったとか、そういう話でもないらしくて。',
  ],
  [
    'wholesome',
    'yoshi_majime',
    "I'll tell you something harsh. Adjustment disorder doesn't come from being weak. It comes from trying too hard to adapt to an environment that doesn't fit.",
  ],
  [
    'wholesome',
    'dokuneee',
    '海で拾った瓶の中に、20年前の手紙が入っていた。 夏の日。 子どもと海へ行った。 砂浜に流れ着いた古い瓶。 中には、 黄ばんだ手紙。 差出人は、 知らない女性。',
  ],
  ['wholesome', '677djf', 'これやばい、ほっぺた落ちる、ブリュレチーズ餅が美味しすぎてまじ横転、。'],
  [
    'wholesome',
    'worcus',
    'Chiikawa Movie Impressions Momonga’s hate-magnet pull was insane lol #ちいかわファンアート',
  ],
  [
    'wholesome',
    'hiiragi2280',
    'The siblings who returned to their family home were talking about the bankbook. Brother: "I\'m covering Mom\'s hospital bills for now."',
  ],
  [
    'wholesome',
    'yoshi_majime',
    'The Reality of "Masked Depression" in the Reiwa Era At the Office ・Always smiling ・Tells the boss, "I\'m fine" ・Chats casually with colleagues',
  ],

  // ---- banter: football and no-context
  ['banter', 'afc_rexzzy', "The Art of Arsenal's counter-attack"],
  [
    'banter',
    'chiamakaafc',
    'Name ONE player who has WON all Four of these trophies just give up you can’t',
  ],
  [
    'banter',
    'chiamakaafc',
    'can you guess the player that scored this goal? impossible, no one has been able to',
  ],
  [
    'banter',
    'chiamakaafc',
    '| Pyramid of the Greatest Goalkeepers of all time. Thoughts or any changes ?',
  ],
  ['banter', 'kyoutojin_bot', "Me when I take a mount in Kyoto's street guide"],

  // ---- honest nulls. Each of these is a post a keyword vote cannot call, and
  // each has a camped handle behind it, which is exactly what the roster pin is
  // for. A heuristic that guessed here would be worse than one that abstains.
  [null, 'nonno_kaba', 'Instant Image Change 1/2'],
  [null, 'j4gkb', 'On the rooftop. (1/2)'],
  [null, 'kyouen2', '女騎士'],
  [null, 'chiamakaafc', 'can you guess the player impossible'],
  [
    null,
    'latinacasanova',
    'Unbroken eye contact for 3+ seconds is her submissive way of saying "approach me"',
  ],
  [null, 'thetweetofgod', 'This, too, shall pass. By "this" I mean the human race.'],
  [null, 'kyoutojin_bot', "Now it's not hot... Monday Man."],
  [null, 'thegbreaker', "My dream job is deleting LinkedIn from everyone's mind forever."],
  [
    null,
    'kevinszabo14',
    'I’m 24, my life is boring. But the boring life is the best. Lift heavy, eat well, work hard, no parties.',
  ],
  // A dev question carrying exactly one lane marker. `general`/`stance` is a
  // safe register for it; `expertise` would need a lead this post never gives.
  [
    null,
    'kentcdodds',
    "My agent wants to use Temporal. Any idea when that'll be available in Workers @CloudflareDev ?",
  ],
  [
    null,
    'watcherguru',
    'Hey @grok which causes the least long term damage to the lungs? Cannabis joint, Vape, Cigarette, or Cigar?',
  ],
  [
    null,
    'sama',
    'so excited for this. very close to models that will significantly accelerate scientific discovery; the best way to do this is for us to empower scientists.',
  ],
];

describe('detectReplyMode over the harvested corpus', () => {
  test('the corpus is big enough to mean something and spans every mode', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(30);
    const labelled = new Set(CORPUS.map(([id]) => id).filter((id) => id !== null));
    // `general` is deliberately absent — detection never returns it.
    expect([...labelled].sort()).toEqual(['banter', 'expertise', 'hot-take', 'news', 'wholesome']);
  });

  for (const [expected, handle, text] of CORPUS) {
    test(`@${handle}: ${text.slice(0, 56)}…`, () => {
      const got = detectReplyMode(text);
      if (expected === null) expect(got).toBeNull();
      else expect(got?.id).toBe(expected);
    });
  }

  test('every miss is an abstention, never a wrong room', () => {
    // The property that matters: a wrong mode ships the wrong register and the
    // wrong persona scope, a `null` just falls through to the resolver.
    for (const [expected, , text] of CORPUS) {
      const got = detectReplyMode(text);
      if (got !== null && expected !== null) expect(got.id).toBe(expected);
      else if (got !== null) throw new Error(`abstention expected, got ${got.id}`);
    }
  });
});

describe('detectReplyMode contract', () => {
  test('empty and marker-free text answer null, not general', () => {
    expect(detectReplyMode('')).toBeNull();
    expect(detectReplyMode('   ')).toBeNull();
    expect(detectReplyMode('123 !!! 😀')).toBeNull();
    expect(detectReplyMode('hm')).toBeNull();
  });

  test('a wire prefix beats the keyword vote even when the story is my lane', () => {
    // Without the override this would score `expertise` on saas/startup/funding
    // and draft a biography under a wire story.
    expect(detectReplyMode('JUST IN: OpenAI acquires a SaaS startup for $3 billion')?.id).toBe(
      'news',
    );
    expect(detectReplyMode('BREAKING: Postgres 20 ships with a new query planner')?.id).toBe(
      'news',
    );
    expect(detectReplyMode('Exclusive: the founder is stepping down')?.id).toBe('news');
  });

  test('a news-agency link beats the keyword vote — the Reuters failure mode', () => {
    expect(
      detectReplyMode('Senate pushes private airport security http://reut.rs/4c4er0Q')?.id,
    ).toBe('news');
    expect(detectReplyMode('Apple ships a new laptop https://9to5mac.com/x')?.id).toBe('news');
  });

  test('one strong marker clears the floor; one weak marker does not', () => {
    expect(detectReplyMode('the funeral was quiet')?.id).toBe('wholesome'); // strong
    expect(detectReplyMode('the family was quiet')).toBeNull(); // weak, alone
    expect(detectReplyMode('the family sat with my brother')?.id).toBe('wholesome'); // two weak
  });

  test('a tie answers null rather than picking a room', () => {
    // `dog` (wholesome, strong) against `arsenal` (banter, strong).
    expect(detectReplyMode('the dog watched Arsenal')).toBeNull();
  });

  test('distinct markers are counted, not occurrences', () => {
    // Twenty repeats of one weak marker must not outvote a genuine category.
    expect(detectReplyMode(`${'code '.repeat(20)}`)).toBeNull();
  });

  test('plurals and hyphens match — "goalkeepers" and "Rate-Hike"', () => {
    expect(detectReplyMode('Pyramid of the Greatest Goalkeepers of all time')?.id).toBe('banter');
    expect(detectReplyMode("Rate-Hike Odds Trounced, Gold's Best Week")?.id).toBe('news');
    expect(detectReplyMode('their hidden self-esteem is sky-high, no confidence at all')?.id).toBe(
      'hot-take',
    );
  });

  test('word boundaries hold — a substring is not a marker', () => {
    // `cat` must not fire on "category", `art` must not fire on "started".
    expect(detectReplyMode('the category started here')).toBeNull();
  });

  test('CJK markers match as substrings, since there is no boundary to anchor', () => {
    expect(detectReplyMode('祖母の葬儀')?.id).toBe('wholesome');
    expect(detectReplyMode('猫と家族')?.id).toBe('wholesome');
  });

  test('never returns `general` — unknown and neutral stay distinguishable', () => {
    for (const [, , text] of CORPUS) {
      expect(detectReplyMode(text)?.id).not.toBe('general');
    }
    expect(detectReplyMode('the noun the post is actually about')?.id).not.toBe('general');
  });
});

describe('resolveModeId', () => {
  test('id, alias, case, space and hyphen all resolve', () => {
    expect(resolveModeId('expertise')?.id).toBe('expertise');
    expect(resolveModeId('hot-take')?.id).toBe('hot-take');
    expect(resolveModeId('hot take')?.id).toBe('hot-take');
    expect(resolveModeId('hot_take')?.id).toBe('hot-take');
    expect(resolveModeId('  HOT-TAKE ')?.id).toBe('hot-take');
    expect(resolveModeId('football')?.id).toBe('banter');
    expect(resolveModeId('SaaS')?.id).toBe('expertise');
    expect(resolveModeId('general')?.id).toBe('general');
  });

  test('an unknown string is null — never coerced to a near miss', () => {
    expect(resolveModeId('klingon')).toBeNull();
    expect(resolveModeId('hot')).toBeNull();
    expect(resolveModeId('')).toBeNull();
    expect(resolveModeId(null)).toBeNull();
    expect(resolveModeId(undefined)).toBeNull();
  });

  test('every id and alias is unique across the table', () => {
    const keys = REPLY_MODES.flatMap((m) => [m.id, ...m.aliases]).map((k) =>
      k.toLowerCase().replace(/[\s\-_]+/g, ''),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('REPLY_MODES', () => {
  test('the table is exactly the six rooms, general last', () => {
    expect(REPLY_MODES.map((m) => m.id)).toEqual([
      'expertise',
      'hot-take',
      'news',
      'wholesome',
      'banter',
      'general',
    ]);
    expect(GENERAL_MODE.id).toBe('general');
    expect(REPLY_MODES).toContain(GENERAL_MODE);
  });

  test('expertise is the ONLY room where the persona is material', () => {
    // The whole plan in one assertion: 96.5% of reply impressions came from
    // posts that are not about my lane, and the persona bridging into them is
    // what earned 2 views on a 27k-view parent.
    const full = REPLY_MODES.filter((m) => m.personaUse === 'full').map((m) => m.id);
    expect(full).toEqual(['expertise']);
    // An unresolvable post gets a take, never a biography.
    expect(GENERAL_MODE.personaUse).toBe('stance');
  });

  test('every room carries a register note and an opening move', () => {
    for (const m of REPLY_MODES) {
      expect(m.registerNote.trim().length).toBeGreaterThan(0);
      expect(m.moves.trim().length).toBeGreaterThan(0);
    }
  });

  test('angles are ordered, non-empty, unique and drawn from the union', () => {
    for (const m of REPLY_MODES) {
      expect(m.angles.length).toBeGreaterThan(0);
      expect(new Set(m.angles).size).toBe(m.angles.length);
      for (const a of m.angles) expect(REPLY_ANGLES).toContain(a);
    }
  });

  test('no room off the lane is offered contrarian or debate as its PRIMARY angle except hot-take', () => {
    // `contrarian` under a funeral post is a report risk and forfeits the OP
    // reply, which is the strongest ranking signal available.
    for (const m of REPLY_MODES) {
      if (m.id === 'expertise' || m.id === 'hot-take') continue;
      expect(['observation', 'question', 'extends']).toContain(m.angles[0] ?? 'no angles at all');
    }
    expect(REPLY_MODES.find((m) => m.id === 'wholesome')?.angles).not.toContain('contrarian');
    expect(REPLY_MODES.find((m) => m.id === 'banter')?.angles).not.toContain('debate');
  });

  test('character budgets are ordered and sit inside the measured winner range', () => {
    for (const m of REPLY_MODES) {
      expect(m.minChars).toBeGreaterThan(0);
      expect(m.maxChars).toBeGreaterThan(m.minChars);
      // 140 is the template ceiling; expertise is the one room allowed past it.
      expect(m.maxChars).toBeLessThanOrEqual(m.id === 'expertise' ? 200 : 140);
    }
    // The winners run 34–110 characters, and the off-lane rooms are where they
    // came from — none of them may set a floor above the shortest winner.
    for (const m of REPLY_MODES) {
      if (m.personaUse === 'full') continue;
      expect(m.minChars).toBeLessThanOrEqual(60);
    }
  });

  test('the angle union is the five the overhaul settled on, story deliberately absent', () => {
    expect([...REPLY_ANGLES]).toEqual([
      'extends',
      'contrarian',
      'debate',
      'observation',
      'question',
    ]);
    expect(REPLY_ANGLES).not.toContain('story' as never);
  });

  test('the opening bans are prose, present, and cover the four measured classes', () => {
    expect(OPENING_BANS.length).toBe(4);
    for (const b of OPENING_BANS) expect(b.trim().length).toBeGreaterThan(0);
  });
});

describe('containsLaneNoun (RC.9 contamination)', () => {
  test('the eight nouns the persona-scope rule names, and their inflections', () => {
    expect(containsLaneNoun('still building something out of that')).toBe(true);
    expect(containsLaneNoun('shipped it on a Sunday')).toBe(true);
    expect(containsLaneNoun('Private airport security means more code for booking flows')).toBe(
      true,
    );
    expect(containsLaneNoun('every solopreneur says this')).toBe(true);
    expect(containsLaneNoun('SaaS pricing again')).toBe(true);
    expect(containsLaneNoun('a startup problem')).toBe(true);
    expect(containsLaneNoun('marketing is downstream of the product')).toBe(true);
  });

  test('the corpus’s second language counts too — AI stays ASCII inside it', () => {
    // The 116-view Japanese reply that bridged an adjustment-disorder post back
    // to the lane. Without the CJK entries the rate would read cleanest on the
    // rows most worth watching.
    expect(containsLaneNoun('治らなくてもいいやの開き直り。AIやマーケティングの継続にも')).toBe(
      true,
    );
    expect(containsLaneNoun('エンジニアの朝は早い')).toBe(true);
    expect(containsLaneNoun('猫のしっぽが好き')).toBe(false);
  });

  test('an off-lane reply is clean, and a lane noun inside a longer word is not a hit', () => {
    expect(containsLaneNoun('IMO buying flowers once still beats forgetting tha request')).toBe(
      false,
    );
    expect(containsLaneNoun('The ear twitch at 0:04')).toBe(false);
    expect(containsLaneNoun('')).toBe(false);
    // Word boundaries: `ai` must not fire on "again", `build` not on "rebuild".
    expect(containsLaneNoun('again and again')).toBe(false);
    expect(containsLaneNoun('the rebuilt stadium')).toBe(false);
  });
});
