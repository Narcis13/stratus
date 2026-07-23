// The Playbook tab (CIRCLES-PLAN C4): the measured feedback loop as a page.
// Every stat renders with its n; below the min-sample gate a cell says
// "insufficient data (n=7)" instead of pretending. The guidance section shows
// exactly what the drafter/reply prompts inject right now (or that they stay
// silent). One $0 GET; the only spend is the one-time own-winner template
// extraction button (~$0.005/post, bounded ≤20/call).

import { type JSX, useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  type Playbook,
  type PlaybookAngleCell,
  type PlaybookCell,
  type PlaybookExtractResult,
  type PlaybookIdeaSurface,
  type PlaybookRosterCoverage,
  api,
} from './api.ts';
import type { Settings } from './storage.ts';

export function PlaybookPanel({ settings }: { settings: Settings }): JSX.Element {
  const [data, setData] = useState<Playbook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.playbook.get(settings));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load playbook');
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    void load();
  }, [load]);

  const extractWinners = async () => {
    setExtracting(true);
    setExtractMsg(null);
    try {
      const r: PlaybookExtractResult = await api.playbook.extractWinners(settings);
      setExtractMsg(
        `Extracted ${r.extracted}/${r.requested} (${r.failures.length} failed, ` +
          `$${r.costUsd.toFixed(4)}, ${r.remaining} more candidates)`,
      );
      await load();
    } catch (e) {
      setExtractMsg(
        e instanceof ApiError && e.status === 503
          ? 'Grok not configured on the server (XAI_API_KEY missing).'
          : e instanceof ApiError
            ? e.message
            : 'Extraction failed',
      );
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Your measured playbook</h2>
        <div className="row">
          {data && <span className="status-line">gate: n≥{data.minN} per cell</span>}
          <button type="button" onClick={() => void load()} disabled={loading}>
            {loading ? '…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {!data && !error && <div className="muted">Loading…</div>}

      {data && (
        <>
          <section className="brief-section">
            <h3>What the prompts inject right now</h3>
            <div className="pb-guidance">
              <div>
                <span className="pb-guidance-label">replies</span>
                {data.guidance.reply ?? (
                  <span className="muted">silent — no angle cell clears the gate yet</span>
                )}
              </div>
              <div>
                <span className="pb-guidance-label">posts</span>
                {data.guidance.post ?? (
                  <span className="muted">silent — no structure cell clears the gate yet</span>
                )}
              </div>
            </div>
          </section>

          <section className="brief-section">
            <h3>Reply angles ({data.angleEffectiveness.totalMeasured} measured)</h3>
            <AngleTable cells={data.angleEffectiveness.overall} minN={data.minN} />
            {data.angleEffectiveness.byAuthorSize.map((b) => (
              <details key={b.bucket} className="pb-bucket">
                <summary>
                  authors {b.bucket} ({b.cells.reduce((s, c) => s + c.n, 0)} measured)
                </summary>
                <AngleTable cells={b.cells} minN={data.minN} />
              </details>
            ))}
          </section>

          <section className="brief-section">
            <h3>Band calibration ({data.bandCalibration.totalMeasured} measured)</h3>
            {data.bandCalibration.totalMeasured === 0 ? (
              <div className="muted">No measured replies yet.</div>
            ) : (
              <>
                <table className="pb-table">
                  <thead>
                    <tr>
                      <th>band</th>
                      <th>n</th>
                      <th>med views</th>
                      <th>hit-rate</th>
                      <th>≥1 like</th>
                      <th>clicks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bandCalibration.bands.map((b) => (
                      <tr key={String(b.band)} className={b.sufficient ? '' : 'pb-thin'}>
                        <td>{b.band ?? 'null'}</td>
                        <td>{b.n}</td>
                        <td>{fmtN(b.medianViews)}</td>
                        <td>{fmtPct(b.hitRate)}</td>
                        <td>{fmtPct(b.likeRate)}</td>
                        <td>{b.meanProfileClicks ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="status-line">
                  hit = ≥{fmtN(data.bandCalibration.hitThresholdViews)} views (my p75) · actionable{' '}
                  {data.bandCalibration.actionable.n} (med{' '}
                  {fmtN(data.bandCalibration.actionable.medianViews)}) vs passed{' '}
                  {data.bandCalibration.passed.n} (med{' '}
                  {fmtN(data.bandCalibration.passed.medianViews)})
                </div>
                <div className="status-line">
                  bait {cellSummary(baitAsCell(data.bandCalibration.bait.bait), data.minN)} ·
                  non-bait {cellSummary(baitAsCell(data.bandCalibration.bait.nonBait), data.minN)}
                </div>
                <div className="muted pb-note">
                  BAND thresholds move only by hand at ≥100 measured — this table is the evidence,
                  not the trigger.
                </div>
              </>
            )}
          </section>

          <section className="brief-section">
            <h3>Batch vs single drafts</h3>
            <table className="pb-table">
              <thead>
                <tr>
                  <th>surface</th>
                  <th>result</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Reply Master (single)</td>
                  <td>{cellSummary(data.batchVsSingle.single, data.minN)}</td>
                </tr>
                <tr>
                  <td>Radar (batch)</td>
                  <td>{cellSummary(data.batchVsSingle.radar, data.minN)}</td>
                </tr>
                <tr>
                  <td>Canned (reply lists)</td>
                  <td>{cellSummary(data.batchVsSingle.canned, data.minN)}</td>
                </tr>
              </tbody>
            </table>
            <div className="status-line">
              Radar rows are confirmed drafts (attributed by reply source, not text match); canned
              rows are matched on the text a list actually rendered. A reply that is both counts as
              the draft, never twice. {data.batchVsSingle.unattributed} published replies
              unattributed (hand-written or pre-tooling).
            </div>
          </section>

          <section className="brief-section">
            <h3>Relationship lift (C3 block on vs off)</h3>
            <table className="pb-table">
              <tbody>
                <tr>
                  <td>with relationship block</td>
                  <td>{cellSummary(data.relationshipLift.withRelationship, data.minN)}</td>
                </tr>
                <tr>
                  <td>cold</td>
                  <td>{cellSummary(data.relationshipLift.withoutRelationship, data.minN)}</td>
                </tr>
              </tbody>
            </table>
            {data.relationshipLift.viewsLift !== null && (
              <div className="status-line">
                lift: {data.relationshipLift.viewsLift}x views
                {data.relationshipLift.profileVisitsLift !== null &&
                  ` · ${data.relationshipLift.profileVisitsLift}x profile clicks`}
              </div>
            )}
          </section>

          <section className="brief-section">
            <h3>Personal context ({data.meEffectiveness.totalMeasured} measured)</h3>
            <table className="pb-table">
              <tbody>
                <tr>
                  <td>with me-brief</td>
                  <td>{cellSummary(data.meEffectiveness.withMe, data.minN)}</td>
                </tr>
                <tr>
                  <td>cold</td>
                  <td>{cellSummary(data.meEffectiveness.withoutMe, data.minN)}</td>
                </tr>
              </tbody>
            </table>
            {data.meEffectiveness.viewsLift !== null ? (
              <div className="status-line">
                lift: {data.meEffectiveness.viewsLift}x views
                {data.meEffectiveness.profileVisitsLift !== null &&
                  ` · ${data.meEffectiveness.profileVisitsLift}x profile clicks`}
              </div>
            ) : (
              <div className="muted pb-note">
                lift stays silent until both sides clear n≥{data.minN} — whether the Me/profile
                brief makes replies land better.
              </div>
            )}
          </section>

          <section className="brief-section">
            <h3>Media vs text-only ({data.mediaEffectiveness.totalMeasured} measured)</h3>
            <table className="pb-table">
              <tbody>
                <tr>
                  <td>with media</td>
                  <td>{cellSummary(data.mediaEffectiveness.media, data.minN)}</td>
                </tr>
                <tr>
                  <td>text-only</td>
                  <td>{cellSummary(data.mediaEffectiveness.textOnly, data.minN)}</td>
                </tr>
                {data.mediaEffectiveness.unknown.posted > 0 && (
                  <tr className="pb-thin">
                    <td>unknown (pre-baseline)</td>
                    <td>{cellSummary(data.mediaEffectiveness.unknown, data.minN)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {data.mediaEffectiveness.viewsLift !== null ? (
              <div className="status-line">
                image lift: {data.mediaEffectiveness.viewsLift}x views
                {data.mediaEffectiveness.profileVisitsLift !== null &&
                  ` · ${data.mediaEffectiveness.profileVisitsLift}x profile clicks`}
              </div>
            ) : (
              <div className="muted pb-note">
                lift stays silent until both sides clear n≥{data.minN} — the text-only baseline the
                studio's images will be judged against.
              </div>
            )}
          </section>

          <IdeaEffectivenessSection idea={data.ideaEffectiveness} minN={data.minN} />

          <section className="brief-section">
            <h3>Reply latency ({data.latencyEffectiveness.totalMeasured} measured)</h3>
            {data.latencyEffectiveness.cells.length === 0 ? (
              <div className="muted">No posted replies yet.</div>
            ) : (
              <table className="pb-table">
                <thead>
                  <tr>
                    <th>age at draft</th>
                    <th>posted</th>
                    <th>result</th>
                  </tr>
                </thead>
                <tbody>
                  {data.latencyEffectiveness.cells.map((c) => (
                    <tr key={c.bucket} className={c.bucket === 'unknown' ? 'pb-thin' : ''}>
                      <td>{c.bucket}</td>
                      <td>{c.posted}</td>
                      <td>{cellSummary(c, data.minN)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {data.latencyEffectiveness.viewsLift !== null ? (
              <div className="status-line">
                early-reply lift: {data.latencyEffectiveness.viewsLift}x views (&lt;15m vs 1h+)
                {data.latencyEffectiveness.profileVisitsLift !== null &&
                  ` · ${data.latencyEffectiveness.profileVisitsLift}x profile clicks`}
              </div>
            ) : (
              <div className="muted pb-note">
                grade stays silent until both &lt;15m and 1h+ clear n≥{data.minN} — the number that
                would justify (or retire) the Radar/Launch-Room push to reply fast.
              </div>
            )}
          </section>

          <section className="brief-section">
            <h3>Model effectiveness ({data.modelEffectiveness.totalMeasured} measured)</h3>
            {data.modelEffectiveness.cells.length === 0 ? (
              <div className="muted">No posted replies yet.</div>
            ) : (
              <table className="pb-table">
                <thead>
                  <tr>
                    <th>model</th>
                    <th>posted</th>
                    <th>result</th>
                  </tr>
                </thead>
                <tbody>
                  {data.modelEffectiveness.cells.map((c) => (
                    <tr key={c.model}>
                      <td>{c.model}</td>
                      <td>{c.posted}</td>
                      <td>{cellSummary(c, data.minN)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="muted pb-note">
              which model drafts the replies that land — the judge of the OpenRouter experiment. A
              bucket stays silent until it reaches n≥{data.minN}.
            </div>
          </section>

          <RosterCoverageSection rc={data.rosterCoverage} minN={data.minN} />

          <section className="brief-section">
            <h3>Pillar × register ({data.pillarRegister.totalMeasured} measured)</h3>
            {data.pillarRegister.cells.length === 0 ? (
              <div className="muted">No published drafter posts yet.</div>
            ) : (
              <table className="pb-table">
                <thead>
                  <tr>
                    <th>pillar</th>
                    <th>register</th>
                    <th>result</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pillarRegister.cells.map((c) => (
                    <tr key={`${c.pillar}|${c.register}`}>
                      <td>{c.pillar ?? '—'}</td>
                      <td>{c.register ?? '—'}</td>
                      <td>{cellSummary(c, data.minN)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="brief-section">
            <h3>My winning structures ({data.structures.totalMeasured} measured)</h3>
            <div className="row">
              <button type="button" onClick={() => void extractWinners()} disabled={extracting}>
                {extracting ? 'Extracting…' : 'Extract winner templates'}
              </button>
              <span className="status-line">≤20 top posts, ~$0.005 each, one-time</span>
            </div>
            {extractMsg && <div className="status-line">{extractMsg}</div>}
            {data.structures.hooks.length > 0 && (
              <StructureTable title="hooks" cells={data.structures.hooks} minN={data.minN} />
            )}
            {data.structures.devices.length > 0 && (
              <StructureTable title="devices" cells={data.structures.devices} minN={data.minN} />
            )}
            {data.structures.hooks.length === 0 && (
              <div className="muted">No templates extracted from my posts yet.</div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// §S0.8 — does the Idea Inbox pay? Seeded (a captured idea seeded this draft)
// vs unseeded medians, per surface. The lift is the payoff number; it stays
// silent until both sides clear the gate. posts and replies are shown apart
// because their view distributions differ — the pooled headline is dominated by
// whichever surface has more volume.
const IDEA_SURFACES: Array<{ key: 'posts' | 'replies'; label: string }> = [
  { key: 'posts', label: 'posts' },
  { key: 'replies', label: 'replies' },
];

function IdeaEffectivenessSection({
  idea,
  minN,
}: {
  idea: PlaybookIdeaSurface & {
    posts: PlaybookIdeaSurface;
    replies: PlaybookIdeaSurface;
    totalSeeded: number;
    totalMeasured: number;
  };
  minN: number;
}): JSX.Element {
  return (
    <section className="brief-section">
      <h3>
        Idea Inbox payoff ({idea.totalSeeded} seeded / {idea.totalMeasured} measured)
      </h3>
      {idea.totalMeasured === 0 ? (
        <div className="muted">No measured published drafts yet.</div>
      ) : (
        <>
          <table className="pb-table">
            <thead>
              <tr>
                <th>surface</th>
                <th>seeded</th>
                <th>unseeded</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>all (pooled)</td>
                <td>{cellSummary(idea.seeded, minN)}</td>
                <td>{cellSummary(idea.unseeded, minN)}</td>
              </tr>
              {IDEA_SURFACES.map((s) => (
                <tr key={s.key} className="pb-thin">
                  <td>{s.label}</td>
                  <td>{cellSummary(idea[s.key].seeded, minN)}</td>
                  <td>{cellSummary(idea[s.key].unseeded, minN)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {idea.viewsLift !== null ? (
            <div className="status-line">
              idea lift: {idea.viewsLift}x views
              {idea.profileVisitsLift !== null && ` · ${idea.profileVisitsLift}x profile clicks`}
              {idea.viewsLift >= 1 ? ' — the Idea Inbox pays' : ' — seeded drafts underperform'}
            </div>
          ) : (
            <div className="muted pb-note">
              payoff stays silent until both seeded and unseeded clear n≥{minN} — whether captured
              ideas beat off-the-cuff drafts.
            </div>
          )}
        </>
      )}
    </section>
  );
}

const ROSTER_ROWS: Array<{ key: keyof PlaybookRosterCoverage['counts']; label: string }> = [
  { key: 'in_band', label: 'in-band (2–10x)' },
  { key: 'above_band', label: 'above band (>10x)' },
  { key: 'below_band', label: 'below band (<2x)' },
  { key: 'unknown', label: 'unknown size' },
];

// §S0.7 — where the last 7 days' replies went vs my 2–10x target band. The
// verdict speaks only over KNOWN-size replies once they clear the gate; the
// unknown bucket is the roster gap, shown but never faulted.
function RosterCoverageSection({
  rc,
  minN,
}: {
  rc: PlaybookRosterCoverage;
  minN: number;
}): JSX.Element {
  return (
    <section className="brief-section">
      <h3>Roster coverage — last 7 days ({rc.total} replies)</h3>
      {rc.total === 0 ? (
        <div className="muted">No posted replies in the last 7 days.</div>
      ) : (
        <>
          <table className="pb-table">
            <thead>
              <tr>
                <th>author size</th>
                <th>replies</th>
                <th>share</th>
              </tr>
            </thead>
            <tbody>
              {ROSTER_ROWS.map((r) => (
                <tr key={r.key} className={r.key === 'unknown' ? 'pb-thin' : ''}>
                  <td>{r.label}</td>
                  <td>{rc.counts[r.key]}</td>
                  <td>{fmtPct2(rc.pct[r.key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rc.band === null ? (
            <div className="muted pb-note">
              waiting for the daily account snapshot to set your 2–10x band — until then every
              author reads as unknown size.
            </div>
          ) : rc.majorityInBand === null ? (
            <div className="muted pb-note">
              doctrine verdict stays silent until n≥{minN} replies to known-size authors ({rc.known}{' '}
              so far).
            </div>
          ) : rc.majorityInBand ? (
            <div className="status-line">
              on doctrine: {rc.inBandPctOfKnown}% of known-size replies are in-band (majority)
            </div>
          ) : (
            <div className="status-line">
              off doctrine: only {rc.inBandPctOfKnown}% of known-size replies are in-band — aim the
              70% at 2–10x accounts
            </div>
          )}
        </>
      )}
    </section>
  );
}

function AngleTable({
  cells,
  minN,
}: {
  cells: PlaybookAngleCell[];
  minN: number;
}): JSX.Element {
  if (cells.length === 0) return <div className="muted">No posted replies yet.</div>;
  return (
    <table className="pb-table">
      <thead>
        <tr>
          <th>angle</th>
          <th>posted</th>
          <th>result</th>
        </tr>
      </thead>
      <tbody>
        {cells.map((c) => (
          <tr key={String(c.angle)}>
            <td>{c.angle ?? 'unknown'}</td>
            <td>{c.posted}</td>
            <td>{cellSummary(c, minN)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StructureTable({
  title,
  cells,
  minN,
}: {
  title: string;
  cells: Array<PlaybookCell & { key: string }>;
  minN: number;
}): JSX.Element {
  return (
    <table className="pb-table">
      <thead>
        <tr>
          <th>{title}</th>
          <th>posted</th>
          <th>result</th>
        </tr>
      </thead>
      <tbody>
        {cells.map((c) => (
          <tr key={c.key}>
            <td>{c.key}</td>
            <td>{c.posted}</td>
            <td>{cellSummary(c, minN)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// The plan's contract: below the gate a cell says so instead of quoting a
// median built on nothing.
function cellSummary(c: PlaybookCell, _minN: number): string {
  if (!c.sufficient) return `insufficient data (n=${c.n})`;
  const parts = [`med ${fmtN(c.medianViews)} views`];
  if (c.medianProfileVisits !== null) parts.push(`${c.medianProfileVisits} clicks`);
  return `${parts.join(' · ')} (n=${c.n})`;
}

function baitAsCell(b: {
  n: number;
  medianViews: number | null;
  sufficient: boolean;
}): PlaybookCell {
  return {
    posted: b.n,
    n: b.n,
    medianViews: b.medianViews,
    medianProfileVisits: null,
    sufficient: b.sufficient,
  };
}

function fmtN(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n * 10) / 10);
}

function fmtPct(r: number | null): string {
  return r === null ? '—' : `${Math.round(r * 100)}%`;
}

// Already an integer percentage (0–100), unlike fmtPct's 0–1 ratio input.
function fmtPct2(p: number | null): string {
  return p === null ? '—' : `${p}%`;
}
