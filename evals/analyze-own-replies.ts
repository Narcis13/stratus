// First-party recalibration data for the reply-band model (OVERHAUL-PLAN §6.2).
//
// Same crosstab as analyze-santoshstack.ts, but over MY posted replies:
// `GET /x/replies/outcomes` joins reply_drafts (status posted) →
// posts_published → metrics_snapshots, so each row carries the band verdict
// stamped at capture time AND the measured outcome (views, likes, replies,
// user_profile_clicks — the follow-precursor the santoshstack set never had).
//
// Drafts created before signal-stamping landed get their signals DERIVED from
// contextSnapshot.metrics + (draft createdAt − sourcePostedAt); derived ageMin
// uses draft-creation time as the reply moment, so it slightly undershoots for
// drafts that sat before pasting. Stamped rows are exact.
//
// Recalibrate the BAND constants from this once ≥100 measured replies
// accumulate — below that the script prints the crosstab but tells you not to
// touch the thresholds.
//
// run: bun run evals/analyze-own-replies.ts
// env: STRATUS_BASE_URL + API_TOKEN (Bun auto-loads .env from the repo root)

import { type Band, type TweetSignals, classifyBand } from '../src/shared/replyBand.ts';

// ------------------------------------------------------------------ fetch

const base = process.env.STRATUS_BASE_URL?.replace(/\/$/, '');
const token = process.env.API_TOKEN;
if (!base || !token) {
  console.error('STRATUS_BASE_URL and API_TOKEN are required (set in .env)');
  process.exit(1);
}

interface OutcomeRow {
  draftId: string;
  sourceTweetId: string;
  sourceAuthorUsername: string;
  sourceText: string;
  sourceUrl: string;
  sourcePostedAt: string | null;
  replyText: string;
  signals: {
    band: Band;
    views: number;
    replies: number;
    ageMin: number;
    vpm: number;
    bait: boolean;
  } | null;
  sourceMetrics: { views: number; replies: number; reposts: number; likes: number } | null;
  draftCreatedAt: string;
  postedTweetId: string | null;
  postedAt: string | null;
  retired: boolean | null;
  measuredAt: string | null;
  outcome: {
    views: number | null;
    likes: number | null;
    replies: number | null;
    retweets: number | null;
    quotes: number | null;
    bookmarks: number | null;
    profileVisits: number | null;
  } | null;
}

const res = await fetch(`${base}/x/replies/outcomes?limit=1000`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!res.ok) {
  console.error(`GET /x/replies/outcomes failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const body = (await res.json()) as {
  count: number;
  measured: number;
  unlinked: number;
  outcomes: OutcomeRow[];
};

console.log(
  `\nPosted drafts: ${body.count}  |  measured (snapshotted): ${body.measured}  |  ` +
    `unlinked (no postedTweetId): ${body.unlinked}`,
);

// ----------------------------------------------------------- derive + classify

// Same bait heuristic the content script / santoshstack eval use.
const BAIT_PHRASES =
  /\b(agree or disagree|what'?s your|which one|be honest|your take|hot take|thoughts\??|am i wrong|change my mind|guess the)\b/i;
function looksLikeBait(text: string): boolean {
  const t = text.trim();
  return /\?\s*$/.test(t) || BAIT_PHRASES.test(t);
}

interface Scored {
  row: OutcomeRow;
  sig: TweetSignals;
  band: Band;
  stamped: boolean; // signals captured live vs derived after the fact
  replyViews: number;
  replyLikes: number;
  replyReplies: number;
  profileClicks: number; // -1 = not measured (snapshot past the 30d window etc.)
}

const measured = body.outcomes.filter((o) => o.outcome !== null && o.outcome.views !== null);
const skippedNoMetrics = body.outcomes.length - measured.length;
if (skippedNoMetrics > 0) {
  console.log(`Skipping ${skippedNoMetrics} rows without a usable snapshot yet`);
}

const scored: Scored[] = [];
for (const row of measured) {
  let sig: TweetSignals;
  let stamped: boolean;
  if (row.signals) {
    sig = {
      views: row.signals.views,
      replies: row.signals.replies,
      ageMin: row.signals.ageMin,
      vpm: row.signals.vpm,
      bait: row.signals.bait,
    };
    stamped = true;
  } else {
    if (!row.sourceMetrics || !row.sourcePostedAt) continue; // nothing to derive from
    const ageMin = Math.max(
      0,
      (Date.parse(row.draftCreatedAt) - Date.parse(row.sourcePostedAt)) / 60000,
    );
    sig = {
      views: row.sourceMetrics.views,
      replies: row.sourceMetrics.replies,
      ageMin,
      vpm: row.sourceMetrics.views / Math.max(ageMin, 1),
      bait: looksLikeBait(row.sourceText),
    };
    stamped = false;
  }
  const o = row.outcome;
  if (!o) continue;
  scored.push({
    row,
    sig,
    band: row.signals ? row.signals.band : classifyBand(sig),
    stamped,
    replyViews: o.views ?? 0,
    replyLikes: o.likes ?? 0,
    replyReplies: o.replies ?? 0,
    profileClicks: o.profileVisits ?? -1,
  });
}

const stampedN = scored.filter((s) => s.stamped).length;
console.log(
  `Analyzable: ${scored.length} (${stampedN} with capture-time signals, ` +
    `${scored.length - stampedN} derived from contextSnapshot)`,
);

if (scored.length === 0) {
  console.log('\nNo measured replies yet — post replies, let the 03:00 UTC pass snapshot them.');
  process.exit(0);
}

if (scored.length < 100) {
  console.log(
    `\n*** SAMPLE TOO SMALL: ${scored.length} < 100 measured replies — read the crosstab, but do NOT recalibrate BAND constants yet. ***`,
  );
}

// -------------------------------------------------------------------- helpers

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] as number;
};
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toString());

// ----------------------------------------------------------- outcome baseline

const allReplyViews = scored.map((s) => s.replyViews);
console.log('\n=== OUTCOME BASELINE (reply views) ===');
console.log(
  `min ${fmt(Math.min(...allReplyViews))}  p25 ${fmt(pct(allReplyViews, 25))}  median ${fmt(
    median(allReplyViews),
  )}  p75 ${fmt(pct(allReplyViews, 75))}  p90 ${fmt(pct(allReplyViews, 90))}  max ${fmt(
    Math.max(...allReplyViews),
  )}`,
);
const clicksMeasured = scored.filter((s) => s.profileClicks >= 0);
console.log(
  `mean reply views ${fmt(mean(allReplyViews))}  |  mean reply likes ${mean(
    scored.map((s) => s.replyLikes),
  ).toFixed(2)}  |  mean profile clicks ${mean(clicksMeasured.map((s) => s.profileClicks)).toFixed(
    2,
  )} (${clicksMeasured.length} measured)`,
);

// "hit" = top quartile of own outcomes — calibrated to this account, not a guess.
const HIT = pct(allReplyViews, 75);
console.log(`\n"hit" = reply views >= p75 = ${fmt(HIT)} (top quartile of outcomes)`);

// ---------------------------------------------------- band -> outcome crosstab

const bands = ['hot', 'warm', 'skip', null] as const;
const LIKED = scored.filter((s) => s.replyLikes >= 1).length / scored.length;
console.log('\n=== BAND at capture time  ->  actual reply outcome ===');
console.log(
  'band   n     %ofset   medianRViews  meanRViews  hit-rate  medRLikes  %got>=1like  meanPClicks  %got>=1click',
);
for (const b of bands) {
  const g = scored.filter((s) => s.band === b);
  if (!g.length) {
    console.log(`${String(b).padEnd(6)} 0`);
    continue;
  }
  const rv = g.map((s) => s.replyViews);
  const hitRate = g.filter((s) => s.replyViews >= HIT).length / g.length;
  const likeRate = g.filter((s) => s.replyLikes >= 1).length / g.length;
  const gClicks = g.filter((s) => s.profileClicks >= 0);
  const meanClicks = mean(gClicks.map((s) => s.profileClicks));
  const clickRate = gClicks.length
    ? gClicks.filter((s) => s.profileClicks >= 1).length / gClicks.length
    : 0;
  console.log(
    `${String(b).padEnd(6)} ${String(g.length).padEnd(5)} ${((g.length / scored.length) * 100)
      .toFixed(1)
      .padStart(5)}%   ${fmt(median(rv)).padStart(10)}   ${fmt(mean(rv)).padStart(9)}   ${(
      hitRate * 100
    )
      .toFixed(0)
      .padStart(6)}%   ${median(g.map((s) => s.replyLikes))
      .toFixed(1)
      .padStart(7)}   ${(likeRate * 100).toFixed(0).padStart(8)}%   ${meanClicks
      .toFixed(2)
      .padStart(9)}   ${(clickRate * 100).toFixed(0).padStart(9)}%`,
  );
}
console.log(`(base rate: ${(LIKED * 100).toFixed(0)}% of measured replies got at least 1 like)`);

// ------------------------------------------------- does the model rank-order?

const actionable = scored.filter((s) => s.band === 'hot' || s.band === 'warm');
const passed = scored.filter((s) => s.band === null || s.band === 'skip');
console.log('\n=== ACTIONABLE (hot+warm) vs PASSED (null+skip) ===');
for (const [label, g] of [
  ['actionable', actionable],
  ['passed    ', passed],
] as const) {
  if (!g.length) {
    console.log(`${label} n=0`);
    continue;
  }
  console.log(
    `${label} n=${g.length}  median reply views ${fmt(
      median(g.map((s) => s.replyViews)),
    )}  hit-rate ${((g.filter((s) => s.replyViews >= HIT).length / g.length) * 100).toFixed(
      0,
    )}%  mean profile clicks ${mean(
      g.filter((s) => s.profileClicks >= 0).map((s) => s.profileClicks),
    ).toFixed(2)}`,
  );
}

// ------------------------------------------------ where the model is most wrong

const misses = passed
  .filter((s) => s.replyViews >= HIT)
  .sort((a, b) => b.replyViews - a.replyViews)
  .slice(0, 12);
console.log(
  `\n=== TOP MISSES: model passed, reply hit anyway (${passed.filter((s) => s.replyViews >= HIT).length} total) ===`,
);
console.log('band  origV   origR  age   vpm    replyV  rLikes  pClicks  handle');
for (const s of misses) {
  console.log(
    `${String(s.band).padEnd(5)} ${fmt(s.sig.views).padStart(6)} ${String(s.sig.replies).padStart(
      5,
    )} ${(
      s.sig.ageMin < 60 ? `${Math.round(s.sig.ageMin)}m` : `${(s.sig.ageMin / 60).toFixed(1)}h`
    ).padStart(5)} ${s.sig.vpm.toFixed(0).padStart(5)} ${fmt(s.replyViews).padStart(7)} ${String(
      s.replyLikes,
    ).padStart(
      6,
    )} ${String(s.profileClicks >= 0 ? s.profileClicks : '?').padStart(8)}  @${s.row.sourceAuthorUsername}`,
  );
}

const LOW = pct(allReplyViews, 25);
const hotAll = scored.filter((s) => s.band === 'hot');
const falseAlarms = hotAll
  .filter((s) => s.replyViews <= LOW)
  .sort((a, b) => a.replyViews - b.replyViews)
  .slice(0, 12);
console.log(
  `\n=== TOP FALSE ALARMS: model said HOT, reply flopped (<= p25 = ${fmt(LOW)} views) ===`,
);
console.log(
  `(${hotAll.filter((s) => s.replyViews <= LOW).length} of ${hotAll.length} hot replies flopped)`,
);
console.log('origV   origR  age    vpm   bait  replyV  handle');
for (const s of falseAlarms) {
  console.log(
    `${fmt(s.sig.views).padStart(6)} ${String(s.sig.replies).padStart(5)} ${(
      s.sig.ageMin < 60 ? `${Math.round(s.sig.ageMin)}m` : `${(s.sig.ageMin / 60).toFixed(1)}h`
    ).padStart(6)} ${s.sig.vpm.toFixed(0).padStart(5)} ${String(s.sig.bait).padStart(5)} ${fmt(
      s.replyViews,
    ).padStart(7)}  @${s.row.sourceAuthorUsername}`,
  );
}

// --------------------------------------------- what actually drives reply views

console.log('\n=== REPLY VIEWS by ORIGINAL-POST VIEW bucket ===');
const viewBuckets: [string, (v: number) => boolean][] = [
  ['<300', (v) => v < 300],
  ['300-1k', (v) => v >= 300 && v < 1000],
  ['1k-5k', (v) => v >= 1000 && v < 5000],
  ['5k-20k', (v) => v >= 5000 && v < 20000],
  ['20k-100k', (v) => v >= 20000 && v < 100000],
  ['100k+', (v) => v >= 100000],
];
console.log('origViews   n    medianRViews  meanRViews  meanRLikes  meanPClicks');
for (const [label, f] of viewBuckets) {
  const g = scored.filter((s) => f(s.sig.views));
  if (!g.length) continue;
  console.log(
    `${label.padEnd(10)} ${String(g.length).padStart(3)}   ${fmt(
      median(g.map((s) => s.replyViews)),
    ).padStart(10)}  ${fmt(mean(g.map((s) => s.replyViews))).padStart(9)}  ${mean(
      g.map((s) => s.replyLikes),
    )
      .toFixed(2)
      .padStart(9)}  ${mean(g.filter((s) => s.profileClicks >= 0).map((s) => s.profileClicks))
      .toFixed(2)
      .padStart(10)}`,
  );
}

console.log('\n=== REPLY VIEWS by AGE-AT-REPLY bucket ===');
const ageBuckets: [string, (a: number) => boolean][] = [
  ['<5m', (a) => a < 5],
  ['5-15m', (a) => a >= 5 && a < 15],
  ['15-60m', (a) => a >= 15 && a < 60],
  ['1-3h', (a) => a >= 60 && a < 180],
  ['3-12h', (a) => a >= 180 && a < 720],
  ['12h+', (a) => a >= 720],
];
console.log('age         n    medianRViews  meanRViews');
for (const [label, f] of ageBuckets) {
  const g = scored.filter((s) => f(s.sig.ageMin));
  if (!g.length) continue;
  console.log(
    `${label.padEnd(10)} ${String(g.length).padStart(3)}   ${fmt(
      median(g.map((s) => s.replyViews)),
    ).padStart(10)}  ${fmt(mean(g.map((s) => s.replyViews))).padStart(9)}`,
  );
}

console.log('\n=== REPLY VIEWS by ORIGINAL-REPLY-COUNT bucket (how buried) ===');
const repBuckets: [string, (r: number) => boolean][] = [
  ['0-5', (r) => r <= 5],
  ['6-20', (r) => r > 5 && r <= 20],
  ['21-40', (r) => r > 20 && r <= 40],
  ['41-120', (r) => r > 40 && r <= 120],
  ['120+', (r) => r > 120],
];
console.log('origReplies  n    medianRViews  meanRViews');
for (const [label, f] of repBuckets) {
  const g = scored.filter((s) => f(s.sig.replies));
  if (!g.length) continue;
  console.log(
    `${label.padEnd(10)} ${String(g.length).padStart(3)}   ${fmt(
      median(g.map((s) => s.replyViews)),
    ).padStart(10)}  ${fmt(mean(g.map((s) => s.replyViews))).padStart(9)}`,
  );
}

// ------------------------------------------------------------------ bait check

const baitG = scored.filter((s) => s.sig.bait);
const noBaitG = scored.filter((s) => !s.sig.bait);
console.log('\n=== BAIT vs NON-BAIT original posts ===');
console.log(
  `bait     n=${baitG.length}  median reply views ${fmt(
    median(baitG.map((s) => s.replyViews)),
  )}  mean rLikes ${mean(baitG.map((s) => s.replyLikes)).toFixed(2)}`,
);
console.log(
  `non-bait n=${noBaitG.length}  median reply views ${fmt(
    median(noBaitG.map((s) => s.replyViews)),
  )}  mean rLikes ${mean(noBaitG.map((s) => s.replyLikes)).toFixed(2)}`,
);

// --------------------------------------------------------- profile-click leaders

// The metric the mission actually cares about: which replies sent people to the
// profile. user_profile_clicks comes free in non_public_metrics on owned reads.
const leaders = clicksMeasured
  .filter((s) => s.profileClicks > 0)
  .sort((a, b) => b.profileClicks - a.profileClicks)
  .slice(0, 10);
console.log(
  `\n=== PROFILE-CLICK LEADERS (${leaders.length ? `top ${leaders.length}` : 'none yet'}) ===`,
);
for (const s of leaders) {
  const snippet = s.row.replyText.replace(/\s+/g, ' ').slice(0, 70);
  console.log(
    `${String(s.profileClicks).padStart(3)} clicks  ${fmt(s.replyViews).padStart(6)} views  band=${String(
      s.band,
    ).padEnd(4)}  @${s.row.sourceAuthorUsername}: "${snippet}"`,
  );
}
