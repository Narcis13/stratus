// Builds the `onCost` callback that every platform's xFetch fires after a call
// completes. Looks up the platform's price table, computes USD, inserts a row
// into `cost_events`. Stays platform-agnostic — adding LinkedIn later just
// means importing its `priceFor` and registering it in `priceTables`.
//
// Insert is fire-and-forget on purpose: cost logging must never block or fail
// the X call that produced it. A missed row shows up as a gap in the dashboard,
// not a thrown publish.

import { sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { costEvents } from '../db/shared-schema.ts';
import type { CostInfo } from '../x/client.ts';
import { priceFor as xPriceFor } from '../x/pricing.ts';

type PriceFn = (endpoint: string, method: string, status: number, items: number | null) => number;

const priceTables: Record<string, PriceFn> = {
  x: xPriceFor,
  // linkedin: linkedinPriceFor,  // when src/linkedin/pricing.ts lands
};

// Soft daily budgets by platform, registered via makeOnCost opts. Soft = log
// loudly and flag in /cost responses; never block a call (one wallet, one user
// — the dashboard is the cap).
const dailyBudgets = new Map<string, number>();

export function getDailyBudgetUsd(platform: string): number | null {
  return dailyBudgets.get(platform) ?? null;
}

export interface OnCostOptions {
  /** Soft daily (UTC) budget in USD — crossing it logs loudly, never blocks. */
  dailyBudgetUsd?: number;
}

export function makeOnCost(platform: string, opts: OnCostOptions = {}): (info: CostInfo) => void {
  const price = priceTables[platform];
  if (!price) throw new Error(`costTracker: no price table for platform '${platform}'`);

  const budget = opts.dailyBudgetUsd;
  if (budget != null && budget > 0) dailyBudgets.set(platform, budget);

  return (info) => {
    // `info.items` is the result count xFetch read off the response body, so
    // per-result endpoints (search, own-timeline, batch lookup) bill by what X
    // actually returned — not as one item. See `pricing.ts`. A call-site
    // `costHint` wins on billed (2xx) calls — the call site knows about URL
    // surcharges and owned-vs-other reads that the path alone can't reveal.
    const usd =
      info.status < 400 && info.costHint != null
        ? info.costHint
        : price(info.endpoint, info.method, info.status, info.items);

    // A billed call pricing to $0 means the price table has a hole — the
    // dashboard silently undercounts until someone greps for this (§9.1).
    if (info.status < 400 && usd === 0) {
      console.warn(
        `costTracker: '${platform}' ${info.method} ${info.endpoint} returned ${info.status} but priced to $0 — unmapped endpoint? Add a branch to its pricing table.`,
      );
    }

    db.insert(costEvents)
      .values({
        platform,
        endpoint: info.endpoint,
        status: info.status,
        items: info.items,
        costUsd: usd.toFixed(5),
        durationMs: Math.round(info.durationMs),
        attempts: info.attempts,
        requestId: null,
      })
      .execute()
      .then(() => checkBudget(platform))
      .catch((err) => {
        console.error('costTracker: insert failed:', err instanceof Error ? err.message : err);
      });
  };
}

async function checkBudget(platform: string): Promise<void> {
  const budget = dailyBudgets.get(platform);
  if (budget == null) return;

  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${costEvents.costUsd}), 0)` })
    .from(costEvents)
    .where(sql`${costEvents.platform} = ${platform} and ${costEvents.ts} >= ${from}`);

  const total = Number(row?.total ?? 0);
  if (total >= budget) {
    console.error(
      `BUDGET WATCHDOG: '${platform}' spend today is $${total.toFixed(5)} — over the ` +
        `$${budget.toFixed(2)}/day soft budget. See GET /cost/today for the breakdown.`,
    );
  }
}
