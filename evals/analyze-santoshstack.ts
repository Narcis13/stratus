// Validates the deployed reply-band model against a 371-row outcome dataset.
//
// Unlike the first eval (which only had original-post signals), this set
// carries the OUTCOME of each reply santoshstack actually sent: reply views,
// likes, comments. So we can ask the real question: does the band the model
// would have shown predict whether the reply got seen?
//
// run: bun run evals/analyze-santoshstack.ts
//      bun run evals/analyze-santoshstack.ts <path-to-harvested.csv> [@self-handle]
//
// Any harvested replies CSV (extension Harvest tab, replies mode) shares this
// exact 11-column shape, so point arg 1 at one to validate the model against a
// different creator's outcomes. Arg 2 is that creator's @handle, excluded as
// self-replies (defaults to the most frequent handle in the file).

import { type TweetSignals, classifyBand } from '../src/shared/replyBand.ts';

// ---------------------------------------------------------------- CSV parsing

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // strip BOM
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const num = (s: string) => {
  const n = Number((s ?? '').replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// Same bait heuristic the content script uses, applied to original post text.
const BAIT_PHRASES =
  /\b(agree or disagree|what'?s your|which one|be honest|your take|hot take|thoughts\??|am i wrong|change my mind|guess the)\b/i;
function looksLikeBait(text: string): boolean {
  const t = text.trim();
  return /\?\s*$/.test(t) || BAIT_PHRASES.test(t);
}

// ---------------------------------------------------------------------- load

interface Row {
  postText: string;
  origReplies: number;
  origLikes: number;
  origViews: number;
  postedAt: number;
  handle: string;
  replyText: string;
  replyComments: number;
  replyLikes: number;
  replyViews: number;
  repliedAt: number;
}

const csvArg = process.argv[2];
const csvSource = csvArg
  ? Bun.file(csvArg)
  : Bun.file(new URL('./santoshstack_replies.csv', import.meta.url));
console.log(`Reading ${csvArg ?? 'evals/santoshstack_replies.csv'}`);
const raw = await csvSource.text();
const cells = parseCsv(raw);
const header = cells[0];
const allRows: Row[] = cells
  .slice(1)
  .filter((r) => r.length >= 11)
  .map((r) => ({
    postText: r[0],
    origReplies: num(r[1]),
    origLikes: num(r[2]),
    origViews: num(r[3]),
    postedAt: Date.parse(r[4]),
    handle: r[5],
    replyText: r[6],
    replyComments: num(r[7]),
    replyLikes: num(r[8]),
    replyViews: num(r[9]),
    repliedAt: Date.parse(r[10]),
  }))
  .filter((r) => Number.isFinite(r.postedAt) && Number.isFinite(r.repliedAt));

// Drop self-replies/self-threads: the original handle is santoshstack's own.
// The band model decides which OTHER people's posts to reply to; self-replies
// always work (CLAUDE.md invariant #2) and aren't a targeting decision. They
// also carry tiny "original" views with huge reply views and skew every bucket.
// Arg 2 overrides; otherwise assume the most frequent original-post handle is
// the harvested creator's own self-replies.
function mostFrequentHandle(rs: Row[]): string {
  const counts = new Map<string, number>();
  for (const r of rs) {
    const h = r.handle.toLowerCase();
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  let best = '';
  let bestN = 0;
  for (const [h, n] of counts) {
    if (n > bestN) {
      best = h;
      bestN = n;
    }
  }
  return best;
}
const selfArg = process.argv[3];
const SELF = (selfArg ?? (csvArg ? mostFrequentHandle(allRows) : '@santoshstack')).toLowerCase();
const selfRows = allRows.filter((r) => r.handle.toLowerCase() === SELF.toLowerCase());
const rows = allRows.filter((r) => r.handle.toLowerCase() !== SELF.toLowerCase());
console.log(
  `\nExcluded ${selfRows.length} self-replies (handle ${SELF}); ${rows.length} reply-target rows remain`,
);

// ----------------------------------------------------------- derive + classify

interface Scored extends Row {
  ageMin: number;
  vpm: number;
  bait: boolean;
  band: ReturnType<typeof classifyBand>;
}

const scored: Scored[] = rows.map((r) => {
  const ageMin = Math.max(0, (r.repliedAt - r.postedAt) / 60000);
  const sig: TweetSignals = {
    views: r.origViews,
    replies: r.origReplies,
    ageMin,
    vpm: r.origViews / Math.max(ageMin, 1),
    bait: looksLikeBait(r.postText),
  };
  return { ...r, ageMin, vpm: sig.vpm, bait: sig.bait, band: classifyBand(sig) };
});

// -------------------------------------------------------------------- helpers

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toString());

console.log(`\nLoaded ${rows.length} replies by @santoshstack`);
console.log(`header cols: ${header.length}`);

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
console.log(
  `mean reply views ${fmt(mean(allReplyViews))}  |  mean reply likes ${mean(scored.map((s) => s.replyLikes)).toFixed(2)}`,
);

// Define a "hit": a reply that actually got seen. Use the dataset's own p75 as
// the bar so it's calibrated to this account, not a guess.
const HIT = pct(allReplyViews, 75);
console.log(`\n"hit" = reply views >= p75 = ${fmt(HIT)} (top quartile of outcomes)`);

// ---------------------------------------------------- band -> outcome crosstab

const bands = ['hot', 'warm', 'skip', null] as const;
const LIKED = scored.filter((s) => s.replyLikes >= 1).length / scored.length; // base rate of any-like
console.log('\n=== BAND the model would have shown  ->  actual reply outcome ===');
console.log('band   n     %ofset   medianRViews  meanRViews  hit-rate  medRLikes  %got>=1like');
for (const b of bands) {
  const g = scored.filter((s) => s.band === b);
  if (!g.length) {
    console.log(`${String(b).padEnd(6)} 0`);
    continue;
  }
  const rv = g.map((s) => s.replyViews);
  const hitRate = g.filter((s) => s.replyViews >= HIT).length / g.length;
  const likeRate = g.filter((s) => s.replyLikes >= 1).length / g.length;
  console.log(
    `${String(b).padEnd(6)} ${String(g.length).padEnd(5)} ${((g.length / scored.length) * 100)
      .toFixed(1)
      .padStart(5)}%   ${fmt(median(rv)).padStart(10)}   ${fmt(mean(rv)).padStart(9)}   ${(
      hitRate * 100
    )
      .toFixed(0)
      .padStart(6)}%   ${median(g.map((s) => s.replyLikes))
      .toFixed(1)
      .padStart(7)}   ${(likeRate * 100).toFixed(0).padStart(8)}%`,
  );
}
console.log(
  `(base rate: ${(LIKED * 100).toFixed(0)}% of all reply-target replies got at least 1 like)`,
);

// ------------------------------------------------- does the model rank-order?

// If the band is meaningful, hot should beat warm should beat null/skip on the
// outcome. Compare median reply views actionable(hot+warm) vs not(null+skip).
const actionable = scored.filter((s) => s.band === 'hot' || s.band === 'warm');
const passed = scored.filter((s) => s.band === null || s.band === 'skip');
console.log('\n=== ACTIONABLE (hot+warm) vs PASSED (null+skip) ===');
console.log(
  `actionable n=${actionable.length}  median reply views ${fmt(
    median(actionable.map((s) => s.replyViews)),
  )}  hit-rate ${((actionable.filter((s) => s.replyViews >= HIT).length / actionable.length) * 100).toFixed(0)}%`,
);
console.log(
  `passed     n=${passed.length}  median reply views ${fmt(
    median(passed.map((s) => s.replyViews)),
  )}  hit-rate ${((passed.filter((s) => s.replyViews >= HIT).length / passed.length) * 100).toFixed(0)}%`,
);

// ------------------------------------------------ where the model is most wrong

// Misses: model said null/skip but the reply actually hit big. These are the
// posts the band would have hidden/dimmed that were worth replying to.
const misses = passed
  .filter((s) => s.replyViews >= HIT)
  .sort((a, b) => b.replyViews - a.replyViews)
  .slice(0, 12);
console.log(
  `\n=== TOP MISSES: model passed, reply hit anyway (${passed.filter((s) => s.replyViews >= HIT).length} total) ===`,
);
console.log('band  origV   origR  age   vpm    replyV  rLikes  handle');
for (const s of misses) {
  console.log(
    `${String(s.band).padEnd(5)} ${fmt(s.origViews).padStart(6)} ${String(s.origReplies).padStart(5)} ${(
      s.ageMin < 60 ? `${Math.round(s.ageMin)}m` : `${(s.ageMin / 60).toFixed(1)}h`
    ).padStart(
      5,
    )} ${s.vpm.toFixed(0).padStart(5)} ${fmt(s.replyViews).padStart(7)} ${String(s.replyLikes).padStart(6)}  ${s.handle}`,
  );
}

// False alarms: model said hot but the reply flopped (bottom quartile).
const LOW = pct(allReplyViews, 25);
const falseAlarms = scored
  .filter((s) => s.band === 'hot' && s.replyViews <= LOW)
  .sort((a, b) => a.replyViews - b.replyViews)
  .slice(0, 12);
console.log(
  `\n=== TOP FALSE ALARMS: model said HOT, reply flopped (<= p25 = ${fmt(LOW)} views) ===`,
);
console.log(
  `(${scored.filter((s) => s.band === 'hot' && s.replyViews <= LOW).length} of ${scored.filter((s) => s.band === 'hot').length} hot replies flopped)`,
);
console.log('origV   origR  age    vpm   bait  replyV  handle');
for (const s of falseAlarms) {
  console.log(
    `${fmt(s.origViews).padStart(6)} ${String(s.origReplies).padStart(5)} ${(
      s.ageMin < 60 ? `${Math.round(s.ageMin)}m` : `${(s.ageMin / 60).toFixed(1)}h`
    ).padStart(
      6,
    )} ${s.vpm.toFixed(0).padStart(5)} ${String(s.bait).padStart(5)} ${fmt(s.replyViews).padStart(7)}  ${s.handle}`,
  );
}

// --------------------------------------------- what actually drives reply views

// Bucket by original-post size and by age-at-reply to see the real signal,
// independent of the current thresholds.
console.log('\n=== REPLY VIEWS by ORIGINAL-POST VIEW bucket ===');
const viewBuckets: [string, (v: number) => boolean][] = [
  ['<300', (v) => v < 300],
  ['300-1k', (v) => v >= 300 && v < 1000],
  ['1k-5k', (v) => v >= 1000 && v < 5000],
  ['5k-20k', (v) => v >= 5000 && v < 20000],
  ['20k-100k', (v) => v >= 20000 && v < 100000],
  ['100k+', (v) => v >= 100000],
];
console.log('origViews   n    medianRViews  meanRViews  meanRLikes');
for (const [label, f] of viewBuckets) {
  const g = scored.filter((s) => f(s.origViews));
  if (!g.length) continue;
  console.log(
    `${label.padEnd(10)} ${String(g.length).padStart(3)}   ${fmt(median(g.map((s) => s.replyViews))).padStart(10)}  ${fmt(
      mean(g.map((s) => s.replyViews)),
    ).padStart(9)}  ${mean(g.map((s) => s.replyLikes))
      .toFixed(2)
      .padStart(9)}`,
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
  const g = scored.filter((s) => f(s.ageMin));
  if (!g.length) continue;
  console.log(
    `${label.padEnd(10)} ${String(g.length).padStart(3)}   ${fmt(median(g.map((s) => s.replyViews))).padStart(10)}  ${fmt(
      mean(g.map((s) => s.replyViews)),
    ).padStart(9)}`,
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
  const g = scored.filter((s) => f(s.origReplies));
  if (!g.length) continue;
  console.log(
    `${label.padEnd(10)} ${String(g.length).padStart(3)}   ${fmt(median(g.map((s) => s.replyViews))).padStart(10)}  ${fmt(
      mean(g.map((s) => s.replyViews)),
    ).padStart(9)}`,
  );
}

// ------------------------------------------------------------------ bait check
const baitG = scored.filter((s) => s.bait);
const noBaitG = scored.filter((s) => !s.bait);
console.log('\n=== BAIT vs NON-BAIT original posts ===');
console.log(
  `bait     n=${baitG.length}  median reply views ${fmt(median(baitG.map((s) => s.replyViews)))}  mean rLikes ${mean(
    baitG.map((s) => s.replyLikes),
  ).toFixed(2)}`,
);
console.log(
  `non-bait n=${noBaitG.length}  median reply views ${fmt(median(noBaitG.map((s) => s.replyViews)))}  mean rLikes ${mean(
    noBaitG.map((s) => s.replyLikes),
  ).toFixed(2)}`,
);
