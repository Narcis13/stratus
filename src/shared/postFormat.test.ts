import { describe, expect, test } from 'bun:test';
import { FORMAT_LABELS, POST_FORMATS, type PostFormat, classifyFormat } from './postFormat.ts';

// Fixtures are hand-labelled REAL rows of posts_published (pulled 2026-07-27,
// 136 originals reviewed; distribution: substance 43%, cta 15%, list 13%,
// story 13%, other 0.7%). Formats the account hasn't posted yet
// (would_you_rather, extra poll/binary/confession cases) use hand-written
// drafts in the same voice. A classifier that disagrees with the human label
// on our own corpus is wrong, not the corpus.
const FIXTURES: Record<PostFormat, string[]> = {
  would_you_rather: [
    'Would you rather ship something ugly today or something perfect never?',
    '$2M exit tomorrow\n\nor\n\nbet it all on a shot at $50M',
    'Would you rather have 100 users who love it or 10,000 who shrug?',
  ],
  poll_list: [
    // real: the vibe-check poll
    "👀 Quick vibe check for everyone who sees this...\n\nAre you:\n🧑‍💻 Software Developer \n📝 Content Creator \n⚡ Both \n🌍 Other\n\nIf you're building or creating (or both), let's connect. 🤝",
    'Which stack would you pick:\n- Bun\n- Node\n- Deno\n- Rust, and cry',
    'Auth in 2026 — vote:\nClerk\nAuth0\nRoll your own',
  ],
  binary_choice: [
    // real: the lion-style poll
    '👀 Fellow builders:\n\nDo you prefer:\nA) Steady daily work — consistent but a bit boring\nB) Intense bursts with real rest in between (lion style) 🦁\nWhich one actually works better for you long-term?\n\nReply with A or B + why\nLet’s connect — real talk only.',
    'A) Deep work all morning, meetings never\nB) Sprints with real breaks between them\n\nWhich one is actually sustainable?',
    'Two ways to launch. Reply with A or B and defend it.',
  ],
  hot_take: [
    // real ×3
    'Unpopular opinion:\n\nAI didn’t kill your moat.\n\nShipping faster than everyone still arguing about models is the moat now.',
    'Hot take: AI made junior devs faster and senior devs dangerous.\n\nSpeed was never the senior skill.\n\nKnowing what not to build is.',
    'Unpopular opinion:\n\n"Building in public" with zero numbers is just marketing with extra steps.\n\nShow the ugly dashboard, the churn, the week nothing worked.\n\nOr call it what it is: ads.',
  ],
  confession: [
    // real (truncated in the DB, kept as stored)
    'Founder confession:\n\nI can build a web app.\n\nI can configure servers, databases, and APIs.\n\nBut the moment I need to film and publish it, my brain turns into a 14-person committee that approves absolutely nothing.',
    "I'll admit it: I've rebuilt the landing page five times and shipped zero features this month.",
    'Confession: I check the follower count more often than the error logs.',
  ],
  milestone: [
    // real ×3
    '571 followers. Not 500. Not "almost 600." Five hundred and seventy-one.\n\nNo round-number party here. I\'d hate to be predictable.',
    "664 followers. Almost the devil's number — not staying here.  \n\nGoal: 1,000 until end of July.    \n\nSolo dev, no ads, no follow-back games. \n\nJust posts, replies, follow/follow back and building in public.  \n\nScoreboard every few days. \n\nDay 1 starts now.",
    'Just hit 1,000 followers.🎉🍾\n\nThank you to the Build in Public community for helping turn 100 into four digits.',
  ],
  audience_cta: [
    // real ×4
    'Builders grinding 👊\n\nWhat are you caring about or working toward right now? \n\nDrop your current focus or thoughts below 👇',
    'What did you ship last week?\n\nNot planned. Not researched. Not "almost done".\n\nShipped.\n\nReply with it — I\'ll read every one.',
    'Ship check.\n\nDrop one line: what did you push today?\n\nCode, copy, cold DM — anything counts.\n\nI read every reply.',
    'describe your tech stack in 1 word\n\ni go first: boring',
  ],
  question: [
    // real ×2 + one in-voice
    '"Learn to code" was the advice of the 2010s.  \n\nWhat\'s the equivalent advice for the 2030s?',
    '"Learn English" — the 2000s.\n"Learn to code" — the 2010s.\n"Learn AI" — the 2020s.\n\nFollow the pattern. What\'s the 2030s?',
    'How long did your last "quick fix" actually take?',
  ],
  data_comparison: [
    // real: the week-1 scoreboard
    'Week 1 of my 14-day experiment. Honest numbers:\n\nReplies I wrote: 461\nPeople who replied back: 260\nCame back more than once: 85\nFollowers: 1,062 → 1,155\n\nLast week a post did 1.7M. My best this week: 7.8k.\n\nThe spike was luck. The 461 replies are the job.',
    'Free tier vs paid tier after 30 days:\n\nsignups: 412 vs 38\nchurn: 71% vs 9%\nrevenue: $0 vs $1,140',
    'Landing page A -> 2.1% conversion.\nLanding page B -> 4.7%.\n\nSame product. Different first sentence.',
  ],
  story: [
    // real ×3: age opener, first-person past, dropped-subject past opener
    "I'm 51. I code after my day job, 2–4 hours a night.\n\nWhat starting \"late\" gets you:\n\nYou've watched hype cycles die. You don't panic anymore.\n\nYou solve real problems, not imaginary startup ideas.\n\nJuniors have energy. You have judgment.\n\nJudgment compounds faster.",
    "I ran a hospital accounting office for 10 years before IT. It taught me more than any tutorial:\n\nDeadlines don't move for elegant code.\n\nUsers don't read manuals. Ever.\n\nBoring and reliable beats clever and fragile.\n\nThe person doing the work knows the spec.",
    'Started on a 386 with Turbo Pascal.\n\nNow I review code written by an AI while I make coffee.\n\nSame job the whole time: turning fuzzy human wants into working systems.\n\nThe typing was never the job.',
  ],
  list: [
    // real ×3
    'How I actually use AI to ship faster:\n\nDraft the boring parts, never the thinking.\n\nLet it argue against my plan before I build.\n\nUse it to start, not to decide.\n\nThe leverage is in the edit, not the prompt.',
    'Signs you\'re procrastinating with "productive" work:\n\nRefactoring code nobody complained about.\n\nRedesigning a landing page with no traffic.\n\nReading about marketing instead of posting.\n\nThe busy feeling is the tell. Ship the scary thing.',
    "Boring niches with real money, straight from my wife's bookkeeping clients:\n\nSmall-firm accounting. Equipment rental. Waste pickup routing. Driving schools.\n\nNone of them are on X. All of them pay for saved hours.\n\nSexy is crowded. Boring is open.",
  ],
  one_liner: [
    // real ×2 (as stored: escaped entities + trailing t.co) + one in-voice
    "So let's recap: Opus 5 &gt; Fable 5 &lt; Mythos 5",
    'If you delete the word "fail" from your grammar then you will be fine.. https://t.co/RXGwP45PW9',
    'Shipping beats planning every single week.',
  ],
  substance: [
    // real ×3
    "You don't need to go viral.\n\nYou need to be useful in public.\n\nShip one small thing every day and the right people quietly start showing up.",
    "You don't have a traffic problem.\n\nYou have a trust problem.\n\nNobody buys from a builder they've never watched work.",
    "AI writes the code now.\n\nSo why aren't you shipping 10x more?\n\nBecause the bottleneck was never typing.\n\nIt was deciding. It still is.",
  ],
  other: [
    // real: a retweet is someone else's structure
    'RT @13_narcissus: "Learn to code" was the advice of the 2010s.  \n\nWhat\'s the equivalent advice for the 2030s?',
    'gm',
    'https://t.co/iK9y2Y1MuX',
  ],
};

describe('classifyFormat fixtures', () => {
  for (const format of POST_FORMATS) {
    const drafts = FIXTURES[format];
    test(`${format}: ${drafts.length} fixtures`, () => {
      expect(drafts.length).toBeGreaterThanOrEqual(3);
      for (const draft of drafts) {
        expect(classifyFormat(draft)).toBe(format);
      }
    });
  }
});

describe('ordering regressions — a draft matching two branches lands on the earlier one', () => {
  test('hot_take beats question (declared frame over closing "?")', () => {
    expect(classifyFormat('Hot take: nobody reads your pinned tweet.\n\nAm I wrong?')).toBe(
      'hot_take',
    );
  });

  test('would_you_rather beats question', () => {
    expect(classifyFormat('Would you rather have 100 true fans or 100k followers?')).toBe(
      'would_you_rather',
    );
  });

  test('poll_list beats binary_choice when A)/B) markers carry 3+ options', () => {
    expect(classifyFormat('Which one are you:\nA) builder\nB) marketer\nC) both\nD) lurker')).toBe(
      'poll_list',
    );
  });

  test('milestone beats audience_cta (the announcement is the structure)', () => {
    expect(
      classifyFormat("Just hit 2,000 followers.\n\nDrop your handle below and I'll follow back 👇"),
    ).toBe('milestone');
  });

  test('audience_cta beats question (a question engineered for replies is a CTA)', () => {
    expect(classifyFormat('What did you ship today?\n\nReply with one line 👇')).toBe(
      'audience_cta',
    );
  });

  test('data_comparison beats story (the numbers outrank the narrator)', () => {
    expect(
      classifyFormat(
        'I ran the same ad twice.\n\nMonday: 1,200 clicks -> 3 sales.\nFriday: 300 clicks -> 11 sales.\n\nTiming beats budget.',
      ),
    ).toBe('data_comparison');
  });

  test('story beats list (a biography opener owns its colon-list body)', () => {
    expect(
      classifyFormat(
        "I'm 51 and started coding on a 386. What three decades taught me:\n\nTools change.\n\nProblems don't.\n\nJudgment compounds.",
      ),
    ).toBe('story');
  });

  test('RT prefix beats everything, even a would-you-rather', () => {
    expect(classifyFormat('RT @someone: would you rather ship daily or launch big?')).toBe('other');
  });
});

describe('fallback ladder', () => {
  test('empty and whitespace-only → other', () => {
    expect(classifyFormat('')).toBe('other');
    expect(classifyFormat('   \n\n  ')).toBe('other');
  });

  test('single unmatched line ≥4 words → one_liner; <4 words → other', () => {
    expect(classifyFormat('Consistency is the whole trick.')).toBe('one_liner');
    expect(classifyFormat('gm builders')).toBe('other');
  });

  test('multi-line unmatched → substance', () => {
    expect(classifyFormat('Small is not a consolation prize.\n\nSmall is the plan.')).toBe(
      'substance',
    );
  });

  test('an opener question the post answers itself is not a question post', () => {
    expect(
      classifyFormat(
        'Running low on things to post?\n\nWhat you shipped last month is brand new to everyone who found you last week.\n\nSay it again for the new people.',
      ),
    ).toBe('substance');
  });

  test('bullet lines make a list without a colon header', () => {
    expect(
      classifyFormat(
        'The stack that survived a decade of rewrites and every migration since then:\n- boring database\n- boring framework, the one everyone mocks\n- one deploy script that has never once been clever',
      ),
    ).toBe('list');
  });
});

describe('taxonomy surface', () => {
  test('every format has a label and appears exactly once in the cascade order', () => {
    expect(POST_FORMATS.length).toBe(14);
    expect(new Set(POST_FORMATS).size).toBe(14);
    for (const f of POST_FORMATS) {
      expect(FORMAT_LABELS[f].length).toBeGreaterThan(0);
    }
  });
});
