// Builds the `onCost` callback that every platform's xFetch fires after a call
// completes. Looks up the platform's price table, computes USD, inserts a row
// into `cost_events`. Stays platform-agnostic — adding LinkedIn later just
// means importing its `priceFor` and registering it in `priceTables`.
//
// Insert is fire-and-forget on purpose: cost logging must never block or fail
// the X call that produced it. A missed row shows up as a gap in the dashboard,
// not a thrown publish.

import { db } from '../db/client.ts';
import { costEvents } from '../db/shared-schema.ts';
import type { CostInfo } from '../x/client.ts';
import { priceFor as xPriceFor } from '../x/pricing.ts';

type PriceFn = (endpoint: string, method: string, status: number, items: number | null) => number;

const priceTables: Record<string, PriceFn> = {
  x: xPriceFor,
  // linkedin: linkedinPriceFor,  // when src/linkedin/pricing.ts lands
};

export function makeOnCost(platform: string): (info: CostInfo) => void {
  const price = priceTables[platform];
  if (!price) throw new Error(`costTracker: no price table for platform '${platform}'`);

  return (info) => {
    // `info.items` is the result count xFetch read off the response body, so
    // per-result endpoints (search, own-timeline, batch lookup) bill by what X
    // actually returned — not as one item. See `pricing.ts`.
    const usd = price(info.endpoint, info.method, info.status, info.items);

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
      .catch((err) => {
        console.error('costTracker: insert failed:', err instanceof Error ? err.message : err);
      });
  };
}
