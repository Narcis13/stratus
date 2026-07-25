// Follower milestone ladder + pure detection of the latest one crossed
// (SURFACES S5.5). Auto-detection runs client-side over the account series the
// system already stores — no new server aggregation (§7.12: read-time
// computation beats derived state). The rung values are opening guesses (same
// spirit as the C1 stage thresholds); revisit if milestones feel too
// sparse/dense at the account's real size.

export const MILESTONES = [
  50, 100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000,
] as const;

/** The highest ladder rung the follower series has reached, and the date of the
 *  first snapshot at/above it. `null` when no rung is crossed yet. Tolerates
 *  unordered input; an exact-equal count counts as crossed (>=). Uses the series
 *  peak, so a temporary dip never un-crosses an earned milestone. */
export function latestCrossed(
  series: Array<{ date: string; followers: number }>,
): { milestone: number; crossedOn: string } | null {
  if (series.length === 0) return null;

  const peak = Math.max(...series.map((s) => s.followers));
  let milestone = 0;
  for (const m of MILESTONES) {
    if (peak >= m) milestone = m;
  }
  if (milestone === 0) return null;

  // The earliest snapshot that reached the crossed rung is when it happened.
  const crossing = [...series]
    .sort((a, b) => a.date.localeCompare(b.date))
    .find((s) => s.followers >= milestone);
  // peak >= milestone guarantees a crossing exists; the guard satisfies TS.
  if (!crossing) return null;
  return { milestone, crossedOn: crossing.date };
}
