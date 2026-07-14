// Per-angle outcome crosstab over one person's posted replies (CIRCLES-PLAN
// C1 dossier, consumed by C3's relationship-aware drafting). Pure — moved out
// of routes/people.ts so people/store.ts can build cells without importing a
// route module (routes/people.ts re-exports for its existing callers).

/** The subset of a reply's measured outcome the crosstab actually reads.
 *  ReplyOutcome['outcome'] (routes/replies.ts) is structurally assignable. */
export interface AngleOutcome {
  views: number | null;
  profileVisits: number | null;
  replies: number | null;
}

export interface AngleCell {
  angle: string | null;
  posted: number;
  measured: number;
  medianViews: number | null;
  medianProfileVisits: number | null;
  medianReplies: number | null;
}

// Per-angle outcome mini-crosstab over one person's posted replies (feeds C3's
// relationship-aware drafting; C3 applies its own ≥3-measured gate before
// letting a preference influence a prompt).
export function buildAngleCrosstab(
  rows: Array<{ angle: string | null; outcome: AngleOutcome | null }>,
): AngleCell[] {
  const byAngle = new Map<string | null, Array<AngleOutcome | null>>();
  for (const r of rows) {
    const list = byAngle.get(r.angle) ?? [];
    list.push(r.outcome);
    byAngle.set(r.angle, list);
  }
  const cells: AngleCell[] = [];
  for (const [angle, outcomes] of byAngle) {
    const measured = outcomes.filter((o) => o !== null);
    cells.push({
      angle,
      posted: outcomes.length,
      measured: measured.length,
      medianViews: median(measured.map((o) => o?.views ?? null)),
      medianProfileVisits: median(measured.map((o) => o?.profileVisits ?? null)),
      medianReplies: median(measured.map((o) => o?.replies ?? null)),
    });
  }
  return cells.sort((a, b) => b.posted - a.posted);
}

function median(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 1
    ? (nums[mid] as number)
    : ((nums[mid - 1] as number) + (nums[mid] as number)) / 2;
}
