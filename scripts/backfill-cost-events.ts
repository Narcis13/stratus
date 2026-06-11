// One-off data fix for the cost_events mispricing that predated the 2026-06-05
// pricing change (see src/x/pricing.ts / costTracker.ts).
//
//   - metricsPoll's owned single-tweet reads (GET /2/tweets/:id) were logged at
//     OTHER_READ ($0.005) but are owned reads ($0.001) — a 5x over-report.
//     metricsPoll was the only caller of that path and only ever read OWN
//     tweets, so this is precisely correctable: each row is exactly one owned
//     read worth $0.001.
//   - ownReconcile's GET /2/users/:id/tweets had no price branch and was logged
//     at $0.00. The true cost was $0.001 x results-returned, but the result
//     count was never recorded (items was null) — NOT reconstructable, so we
//     report it and leave it.
//
// Dry-run by default. Pass --apply to perform the UPDATE inside a transaction.
//
//   bun run scripts/backfill-cost-events.ts            # report only
//   bun run scripts/backfill-cost-events.ts --apply    # apply the correction

import { pool } from '../src/db/client.ts';

const APPLY = process.argv.includes('--apply');

const OWNED_SINGLE_READ_RE = '^/2/tweets/[0-9]+$';
const USER_TWEETS_RE = '^/2/users/[0-9]+/tweets$';
const OVER_REPORTED = '0.005'; // numeric(10,5) literal for the mispriced reads
const CORRECTED = '0.001';

function usd(n: unknown): string {
  return `$${Number(n).toFixed(5)}`;
}

async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

// Aggregate queries always return exactly one row; make that explicit for
// noUncheckedIndexedAccess.
function one<T>(rows: T[]): T {
  const r = rows[0];
  if (r === undefined) throw new Error('expected one row, got none');
  return r;
}

async function main() {
  console.log(`\n=== cost_events backfill (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  const totals = one(
    await q<{ n: string; sum: string }>(
      'SELECT count(*) n, coalesce(sum(cost_usd),0) sum FROM cost_events',
    ),
  );
  console.log(`Total rows: ${totals.n}, total logged: ${usd(totals.sum)}\n`);

  console.log('Breakdown by platform / normalized endpoint / unit cost:');
  const breakdown = await q<{
    platform: string;
    ep: string;
    cost_usd: string;
    n: string;
    sum: string;
  }>(
    `SELECT platform,
            CASE
              WHEN endpoint ~ $1 THEN '/2/tweets/:id'
              WHEN endpoint ~ $2 THEN '/2/users/:id/tweets'
              ELSE endpoint
            END AS ep,
            cost_usd,
            count(*) n,
            coalesce(sum(cost_usd),0) sum
     FROM cost_events
     GROUP BY platform, ep, cost_usd
     ORDER BY sum DESC
     LIMIT 40`,
    [OWNED_SINGLE_READ_RE, USER_TWEETS_RE],
  );
  for (const r of breakdown) {
    console.log(
      `  ${r.platform.padEnd(6)} ${String(r.ep).padEnd(26)} @ ${usd(r.cost_usd).padStart(9)} x ${String(r.n).padStart(6)} = ${usd(r.sum)}`,
    );
  }

  // --- A: over-reported owned single-tweet reads -----------------------------
  const a = one(
    await q<{ n: string; cur_sum: string }>(
      `SELECT count(*) n, coalesce(sum(cost_usd),0) cur_sum
     FROM cost_events
     WHERE platform='x' AND endpoint ~ $1 AND cost_usd = $2`,
      [OWNED_SINGLE_READ_RE, OVER_REPORTED],
    ),
  );
  const aN = Number(a.n);
  const aCur = Number(a.cur_sum);
  const aNew = aN * Number(CORRECTED);

  // Ownership confirmation: does each read's tweet-id exist in posts_published?
  const own = one(
    await q<{ owned: string; not_owned: string }>(
      `SELECT count(*) FILTER (WHERE pp.tweet_id IS NOT NULL) AS owned,
            count(*) FILTER (WHERE pp.tweet_id IS NULL)     AS not_owned
     FROM cost_events ce
     LEFT JOIN posts_published pp
       ON pp.tweet_id = substring(ce.endpoint from $1)
     WHERE ce.platform='x' AND ce.endpoint ~ $2 AND ce.cost_usd = $3`,
      ['^/2/tweets/([0-9]+)$', OWNED_SINGLE_READ_RE, OVER_REPORTED],
    ),
  );

  console.log('\n--- A. Over-reported owned single-tweet reads (5x) ---');
  console.log(`  rows:        ${aN}`);
  console.log(`  currently:   ${usd(aCur)}  (@ ${usd(OVER_REPORTED)} each)`);
  console.log(`  corrected:   ${usd(aNew)}  (@ ${usd(CORRECTED)} each)`);
  console.log(`  reduces dashboard by: ${usd(aCur - aNew)}`);
  console.log(`  ownership:   ${own.owned} match posts_published, ${own.not_owned} not found`);

  // --- B: under-reported reconcile reads (not reconstructable) ---------------
  const b = one(
    await q<{ n: string; sum: string; with_items: string }>(
      `SELECT count(*) n, coalesce(sum(cost_usd),0) sum,
            count(*) FILTER (WHERE items IS NOT NULL) AS with_items
     FROM cost_events
     WHERE platform='x' AND endpoint ~ $1`,
      [USER_TWEETS_RE],
    ),
  );
  console.log('\n--- B. Under-reported reconcile reads (GET /2/users/:id/tweets) ---');
  console.log(`  rows:        ${b.n}`);
  console.log(`  currently:   ${usd(b.sum)}`);
  console.log(`  rows with a recorded item count: ${b.with_items}`);
  console.log('  -> true cost = $0.001 x results-returned, but item counts were');
  console.log('     never recorded. Left as-is (not fabricating). See note below.');

  if (!APPLY) {
    console.log('\nDRY RUN — no changes written. Re-run with --apply to correct group A.\n');
    return;
  }

  console.log('\nApplying group A correction in a transaction...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `UPDATE cost_events SET cost_usd = $1
       WHERE platform='x' AND endpoint ~ $2 AND cost_usd = $3`,
      [CORRECTED, OWNED_SINGLE_READ_RE, OVER_REPORTED],
    );
    // Verify within the txn before committing.
    const verify = await client.query(
      `SELECT count(*) n FROM cost_events
       WHERE platform='x' AND endpoint ~ $1 AND cost_usd = $2`,
      [OWNED_SINGLE_READ_RE, OVER_REPORTED],
    );
    const remaining = Number(verify.rows[0].n);
    if (remaining !== 0) {
      throw new Error(
        `expected 0 over-reported rows after update, found ${remaining} — rolling back`,
      );
    }
    await client.query('COMMIT');
    console.log(`  updated ${res.rowCount} row(s); 0 over-reported rows remain. COMMIT.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('  ROLLBACK:', err instanceof Error ? err.message : err);
    throw err;
  } finally {
    client.release();
  }

  const after = one(
    await q<{ n: string; sum: string }>(
      'SELECT count(*) n, coalesce(sum(cost_usd),0) sum FROM cost_events',
    ),
  );
  console.log(`\nNew total logged: ${usd(after.sum)} across ${after.n} rows.\n`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
