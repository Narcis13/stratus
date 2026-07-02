#!/usr/bin/env bun
// md_to_schedule.ts — convert a markdown file of blockquote tweets into the JSON
// shape that schedule_week.sh consumes.
//
// Usage:
//   bun run md_to_schedule.ts <md-file> <timezone> <start-date> <slots/day>
//
// Args (all positional, all required):
//   md-file      Path to a markdown file. Each tweet is a contiguous run of `> ` lines.
//                Frontmatter (`---` block at the top) and non-blockquote content are ignored.
//   timezone     IANA timezone for the cadence anchors, e.g. Europe/Bucharest.
//   start-date   YYYY-MM-DD — Day 1 of the 7-day window in the target timezone.
//   slots/day    3 or 4.
//
// Cadence anchors:
//   3/day: 09, 13, 18 local
//   4/day: 08, 12, 16, 20 local
//
// Output:
//   stdout — JSON array of {text, scheduledFor} ready to redirect to a file.
//   stderr — short summary + any warnings.
//
// Behavior:
//   - Refuses on URL hits (Rule 1: publisher silently fails URL-bearing posts).
//   - Refuses on text >280 chars; warns at >270.
//   - Refuses if tweet count != slotsPerDay * 7.
//   - Minutes jittered uniformly in [5,35] excluding 30. Each slot column's 7 days
//     get distinct minutes; cross-column collisions are fine.
//   - Tweets fill in file order: tweet[0] → day1/slot1, tweet[1] → day1/slot2, …
//
// Pipe to the bulk submitter:
//   bun run md_to_schedule.ts week.md Europe/Bucharest 2026-05-14 4 > /tmp/week.json
//   bash schedule_week.sh /tmp/week.json

type Tweet = { text: string; line: number };

const DAYS = 7;
const ANCHORS_BY_SLOTS: Record<number, number[]> = {
  3: [9, 13, 18],
  4: [8, 12, 16, 20],
};

function die(msg: string, code = 2): never {
  console.error(`md_to_schedule: ${msg}`);
  process.exit(code);
}

const args = process.argv.slice(2);
if (args.length !== 4) {
  die('usage: bun run md_to_schedule.ts <md-file> <timezone> <YYYY-MM-DD> <3|4>');
}
const [mdPath, tz, startDate, slotsStr] = args;
const slotsPerDay = Number(slotsStr);

if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) die(`start-date must be YYYY-MM-DD, got: ${startDate}`);
if (!ANCHORS_BY_SLOTS[slotsPerDay]) die(`slots/day must be 3 or 4, got: ${slotsStr}`);
try {
  new Intl.DateTimeFormat('en-US', { timeZone: tz });
} catch {
  die(`unknown IANA timezone: ${tz}`);
}

const anchors = ANCHORS_BY_SLOTS[slotsPerDay];

// --- Parse markdown ---
const raw = await Bun.file(mdPath)
  .text()
  .catch(() => die(`cannot read ${mdPath}`));
const lines = raw.split('\n');

// Skip leading YAML frontmatter (--- ... ---) if present
let startLine = 0;
if (lines[0]?.trim() === '---') {
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      startLine = i + 1;
      break;
    }
  }
}

// A tweet is a contiguous run of `> ` lines. `>` alone counts as a blank line inside the tweet.
const tweets: Tweet[] = [];
let cur: string[] = [];
let curStart = -1;
const flush = () => {
  if (cur.length > 0) {
    tweets.push({ text: cur.join('\n').trim(), line: curStart });
    cur = [];
    curStart = -1;
  }
};
for (let i = startLine; i < lines.length; i++) {
  const ln = lines[i];
  if (ln.startsWith('> ')) {
    if (curStart < 0) curStart = i + 1;
    cur.push(ln.slice(2));
  } else if (ln === '>') {
    if (curStart < 0) curStart = i + 1;
    cur.push('');
  } else {
    flush();
  }
}
flush();

// --- Validate ---
const expected = slotsPerDay * DAYS;
if (tweets.length !== expected) {
  die(
    `expected ${expected} tweets (${slotsPerDay}/day × ${DAYS} days), parsed ${tweets.length}`,
    3,
  );
}

const urlHits = tweets.flatMap((t, i) => (/(^|\s)https?:\/\//i.test(t.text) ? [{ i, t }] : []));
if (urlHits.length > 0) {
  console.error(
    `md_to_schedule: refusing — ${urlHits.length} tweet(s) contain a URL (publisher would silently fail, see SKILL.md Rule 1):`,
  );
  for (const { i, t } of urlHits)
    console.error(`  #${i + 1} (md line ~${t.line}): ${t.text.slice(0, 80)}…`);
  process.exit(4);
}

const tooLong = tweets.flatMap((t, i) =>
  t.text.length > 280 ? [{ i, t, len: t.text.length }] : [],
);
if (tooLong.length > 0) {
  console.error(`md_to_schedule: refusing — ${tooLong.length} tweet(s) exceed 280 chars:`);
  for (const { i, t, len } of tooLong)
    console.error(`  #${i + 1} (${len} chars, md line ~${t.line}): ${t.text.slice(0, 80)}…`);
  process.exit(4);
}

const longish = tweets.flatMap((t, i) =>
  t.text.length > 270 && t.text.length <= 280 ? [{ i, t, len: t.text.length }] : [],
);
if (longish.length > 0) {
  console.error(
    `md_to_schedule: warning — ${longish.length} tweet(s) exceed 270 chars (cap is 280, leave slack):`,
  );
  for (const { i, t, len } of longish)
    console.error(`  #${i + 1} (${len} chars): ${t.text.slice(0, 60)}…`);
}

// --- Jittered minutes: per slot column, distinct values in [5,35]\{30} ---
// Pool of 30 candidate minutes; sample DAYS without replacement per slot.
const POOL = Array.from({ length: 31 }, (_, i) => 5 + i).filter((m) => m !== 30);
function pickUnique(n: number): number[] {
  const pool = [...POOL];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}
const minutesBySlot = anchors.map(() => pickUnique(DAYS));

// --- Local-wall-time → UTC for an arbitrary IANA timezone (DST-safe) ---
function zonedTimeToUtc(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  timeZone: string,
): Date {
  const utcGuess = new Date(Date.UTC(y, m - 1, d, h, mi, 0));
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const x of dtf.formatToParts(utcGuess)) if (x.type !== 'literal') p[x.type] = x.value;
  const asTzReadAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offset = asTzReadAsUtc - utcGuess.getTime();
  return new Date(utcGuess.getTime() - offset);
}

// --- Build schedule ---
const [sy, sm, sd] = startDate.split('-').map(Number);
const rows: { text: string; scheduledFor: string }[] = [];
let cursor = 0;
for (let d = 0; d < DAYS; d++) {
  // Use midday UTC to step the date forward without DST edge effects on the date itself.
  const base = new Date(Date.UTC(sy, sm - 1, sd + d, 12, 0, 0));
  const y = base.getUTCFullYear();
  const mo = base.getUTCMonth() + 1;
  const day = base.getUTCDate();
  for (let s = 0; s < slotsPerDay; s++) {
    const utc = zonedTimeToUtc(y, mo, day, anchors[s], minutesBySlot[s][d], tz);
    const iso = utc.toISOString().replace(/\.\d{3}Z$/, 'Z');
    rows.push({ text: tweets[cursor].text, scheduledFor: iso });
    cursor++;
  }
}

// --- Output ---
console.log(JSON.stringify(rows, null, 2));
console.error(
  `md_to_schedule: emitted ${rows.length} rows | tz=${tz} | startLocal=${startDate} | slots/day=${slotsPerDay} | anchors=${anchors.join(',')}`,
);
