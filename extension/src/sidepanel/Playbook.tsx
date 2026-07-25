// The Playbook tab (CIRCLES-PLAN C4): the measured feedback loop as a page.
// Every stat renders with its n; below the min-sample gate a cell says
// "insufficient data (n=7/20)" instead of pretending — and since UI.15 that
// second number is the gate itself, editable from the ⚙ in this tab's header
// (`x.gates.minCellN`, the same key the drafting guidance and the MCP tools
// read). The guidance section shows exactly what the drafter/reply prompts
// inject right now (or that they stay silent). One $0 GET; the only spend is the
// one-time own-winner template extraction button (~$0.005/post, bounded ≤20).

import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { SettingsGear } from './SettingsGear.tsx';
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
import { entriesForKeys } from './settingsClient.ts';
import { PATCH_DEBOUNCE_MS, useSettingsEditor } from './settingsEditor.ts';
import type { Settings } from './storage.ts';
import { EmptyState } from './ui/EmptyState.tsx';
import { Section } from './ui/Section.tsx';

// The one knob this tab owns. `server`-scoped on purpose: it re-gates the whole
// response, and the same number decides whether the measured guidance lines are
// allowed to speak — so it can never be a panel-local lookalike.
const PLAYBOOK_SETTING_KEYS = ['x.gates.minCellN'];

const GATE_NOTE =
  'The gate re-reads this page and also decides whether the two measured guidance lines above may speak. Band thresholds are NOT here — those move by hand at ≥100 measured replies (Settings → Tuning → band).';

// Long enough that the editor's own debounced PATCH has landed before we re-read
// (see the reload effect for why one re-read, not a poll).
const GATE_RELOAD_MS = PATCH_DEBOUNCE_MS + 300;

export function PlaybookPanel({ settings }: { settings: Settings }): JSX.Element {
  const [data, setData] = useState<Playbook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState<string | null>(null);
  const editor = useSettingsEditor(settings);

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

  // The gate the ⚙ currently shows. `null` until the registry loads, or if the
  // server is unreachable — in which case the page simply keeps the gate the
  // response was built with.
  const gearGate = gateFromEditor(editor.groups);
  const reloadedForGate = useRef<number | null>(null);

  // Moving the gate only changes this page after the SERVER re-gates it: every
  // `sufficient` flag in the response was computed with `minN`. The editor's
  // value goes optimistic instantly and its PATCH lands one debounce later, so
  // wait past that and re-read ONCE per distinct value — `data.minN` coming back
  // is the confirmation. The ref is what keeps a value the server refuses (the
  // registry bounds are the money guard) from turning a disagreement into a
  // poll: the editor re-reads on refusal, which snaps the gear back and settles
  // this the other way. `GET /x/playbook` is $0 and writes nothing.
  useEffect(() => {
    if (gearGate === null || data === null) return;
    if (gearGate === data.minN) {
      reloadedForGate.current = null;
      return;
    }
    if (reloadedForGate.current === gearGate) return;
    const t = setTimeout(() => {
      reloadedForGate.current = gearGate;
      void load();
    }, GATE_RELOAD_MS);
    return () => clearTimeout(t);
  }, [gearGate, data, load]);

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
          <SettingsGear
            editor={editor}
            keys={PLAYBOOK_SETTING_KEYS}
            label="Configure the per-cell sample gate"
            note={GATE_NOTE}
          />
          <button type="button" onClick={() => void load()} disabled={loading}>
            {loading ? '…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {!data && !error && <div className="muted">Loading…</div>}

      {data && (
        <>
          <Section title="What the prompts inject right now">
            <div className="pb-guidance">
              <div>
                <span className="pb-guidance-label">replies</span>
                {data.guidance.reply ?? (
                  <span className="pb-gated">silent — no angle cell clears n≥{data.minN} yet</span>
                )}
              </div>
              <div>
                <span className="pb-guidance-label">posts</span>
                {data.guidance.post ?? (
                  <span className="pb-gated">
                    silent — no structure cell clears n≥{data.minN} yet
                  </span>
                )}
              </div>
            </div>
          </Section>

          <Section title={`Reply angles (${data.angleEffectiveness.totalMeasured} measured)`}>
            <AngleTable cells={data.angleEffectiveness.overall} minN={data.minN} />
            {data.angleEffectiveness.byAuthorSize.map((b) => (
              <details key={b.bucket} className="pb-bucket">
                <summary>
                  authors {b.bucket} ({b.cells.reduce((s, c) => s + c.n, 0)} measured)
                </summary>
                <AngleTable cells={b.cells} minN={data.minN} />
              </details>
            ))}
          </Section>

          <Section title={`Band calibration (${data.bandCalibration.totalMeasured} measured)`}>
            {data.bandCalibration.totalMeasured === 0 ? (
              <EmptyState
                line="No measured replies yet."
                hint="Mark a reply posted with its tweet link and the 03:00 UTC pass measures it — then this table can grade the hot/warm labels."
              />
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
                  bait{' '}
                  <ResultCell cell={baitAsCell(data.bandCalibration.bait.bait)} minN={data.minN} />{' '}
                  · non-bait{' '}
                  <ResultCell
                    cell={baitAsCell(data.bandCalibration.bait.nonBait)}
                    minN={data.minN}
                  />
                </div>
                <div className="muted pb-note">
                  BAND thresholds move only by hand at ≥100 measured — this table is the evidence,
                  not the trigger. (The ⚙ above moves the sample gate, never a threshold.)
                </div>
              </>
            )}
          </Section>

          <Section title="Batch vs single drafts">
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
                  <td>
                    <ResultCell cell={data.batchVsSingle.single} minN={data.minN} />
                  </td>
                </tr>
                <tr>
                  <td>Radar (batch)</td>
                  <td>
                    <ResultCell cell={data.batchVsSingle.radar} minN={data.minN} />
                  </td>
                </tr>
                <tr>
                  <td>Canned (reply lists)</td>
                  <td>
                    <ResultCell cell={data.batchVsSingle.canned} minN={data.minN} />
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="status-line">
              Radar rows are confirmed drafts (attributed by reply source, not text match); canned
              rows are matched on the text a list actually rendered. A reply that is both counts as
              the draft, never twice. {data.batchVsSingle.unattributed} published replies
              unattributed (hand-written or pre-tooling).
            </div>
          </Section>

          <Section title="Relationship lift (C3 block on vs off)">
            <table className="pb-table">
              <tbody>
                <tr>
                  <td>with relationship block</td>
                  <td>
                    <ResultCell cell={data.relationshipLift.withRelationship} minN={data.minN} />
                  </td>
                </tr>
                <tr>
                  <td>cold</td>
                  <td>
                    <ResultCell cell={data.relationshipLift.withoutRelationship} minN={data.minN} />
                  </td>
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
          </Section>

          <Section title={`Personal context (${data.meEffectiveness.totalMeasured} measured)`}>
            <table className="pb-table">
              <tbody>
                <tr>
                  <td>with me-brief</td>
                  <td>
                    <ResultCell cell={data.meEffectiveness.withMe} minN={data.minN} />
                  </td>
                </tr>
                <tr>
                  <td>cold</td>
                  <td>
                    <ResultCell cell={data.meEffectiveness.withoutMe} minN={data.minN} />
                  </td>
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
          </Section>

          <Section title={`Media vs text-only (${data.mediaEffectiveness.totalMeasured} measured)`}>
            <table className="pb-table">
              <tbody>
                <tr>
                  <td>with media</td>
                  <td>
                    <ResultCell cell={data.mediaEffectiveness.media} minN={data.minN} />
                  </td>
                </tr>
                <tr>
                  <td>text-only</td>
                  <td>
                    <ResultCell cell={data.mediaEffectiveness.textOnly} minN={data.minN} />
                  </td>
                </tr>
                {data.mediaEffectiveness.unknown.posted > 0 && (
                  <tr className="pb-thin">
                    <td>unknown (pre-baseline)</td>
                    <td>
                      <ResultCell cell={data.mediaEffectiveness.unknown} minN={data.minN} />
                    </td>
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
          </Section>

          <IdeaEffectivenessSection idea={data.ideaEffectiveness} minN={data.minN} />

          <Section title={`Reply latency (${data.latencyEffectiveness.totalMeasured} measured)`}>
            {data.latencyEffectiveness.cells.length === 0 ? (
              <EmptyState
                line="No posted replies yet."
                hint="This is the number that justifies (or retires) every push to reply fast — it needs both a <15m and a 1h+ cohort."
              />
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
                      <td>
                        <ResultCell cell={c} minN={data.minN} />
                      </td>
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
          </Section>

          <Section
            title={`Model effectiveness (${data.modelEffectiveness.totalMeasured} measured)`}
          >
            {data.modelEffectiveness.cells.length === 0 ? (
              <EmptyState
                line="No posted replies yet."
                hint="Switch provider in Settings → AI and keep drafting — each model gets its own row once it has measured replies."
              />
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
                      <td>
                        <ResultCell cell={c} minN={data.minN} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="muted pb-note">
              which model drafts the replies that land — the judge of the OpenRouter experiment. A
              bucket stays silent until it reaches n≥{data.minN}.
            </div>
          </Section>

          <Section
            title={`Timeline funnel (${data.timelineFunnel.totalReplied}/${data.timelineFunnel.totalSeen} replied)`}
          >
            {data.timelineFunnel.cells.length === 0 ? (
              <EmptyState
                line="Nothing captured yet — passive harvest fills this while you scroll x.com/home."
                hint="Check the passive-capture toggle in Settings, then browse normally: this needs days of scrolling, not minutes."
              />
            ) : (
              <table className="pb-table">
                <thead>
                  <tr>
                    <th>band when seen</th>
                    <th>seen</th>
                    <th>replied</th>
                    <th>capture</th>
                  </tr>
                </thead>
                <tbody>
                  {data.timelineFunnel.cells.map((c) => (
                    <tr
                      key={String(c.band)}
                      className={c.band === 'hot' || c.band === 'warm' ? '' : 'pb-thin'}
                    >
                      <td>{c.band === null ? 'no band' : c.band}</td>
                      <td>{c.seen}</td>
                      <td>{c.replied}</td>
                      <td>
                        {c.rate === null ? (
                          <span className="pb-gated">
                            insufficient data (n={c.seen}/{data.minN})
                          </span>
                        ) : (
                          fmtPct(c.rate)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="muted pb-note">
              of the tweets the algorithm actually put in front of you, how many you replied to —
              banded at first sighting, 30-day window. A cell stays silent until n≥{data.minN} seen;
              "unknown" means the tweet's time never rendered, not a verdict.
            </div>
          </Section>

          <RosterCoverageSection rc={data.rosterCoverage} minN={data.minN} />

          <Section title={`Pillar × register (${data.pillarRegister.totalMeasured} measured)`}>
            {data.pillarRegister.cells.length === 0 ? (
              <EmptyState
                line="No published drafter posts yet."
                hint="Only posts drafted in stratus carry a pillar and a register — hand-written ones can't fill this table."
              />
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
                      <td>
                        <ResultCell cell={c} minN={data.minN} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section
            title={`My winning structures (${data.structures.totalMeasured} measured)`}
            actions={
              <button type="button" onClick={() => void extractWinners()} disabled={extracting}>
                {extracting ? 'Extracting…' : 'Extract winner templates'}
              </button>
            }
          >
            <div className="status-line">≤20 top posts, ~$0.005 each, one-time</div>
            {extractMsg && <div className="status-line">{extractMsg}</div>}
            {data.structures.hooks.length > 0 && (
              <StructureTable title="hooks" cells={data.structures.hooks} minN={data.minN} />
            )}
            {data.structures.devices.length > 0 && (
              <StructureTable title="devices" cells={data.structures.devices} minN={data.minN} />
            )}
            {data.structures.hooks.length === 0 && (
              <EmptyState
                line="No templates extracted from my posts yet."
                hint="Extract winner templates above — it is what lets the measured 'posts' guidance line start steering your drafts."
              />
            )}
          </Section>
        </>
      )}
    </div>
  );
}

/** The gate the ⚙ is currently showing, or `null` while the registry is loading
 *  (or the server is down — in which case the page keeps whatever gate the
 *  response was built with, which is exactly right). */
function gateFromEditor(groups: ReturnType<typeof useSettingsEditor>['groups']): number | null {
  if (groups === null) return null;
  const v = entriesForKeys(groups, PLAYBOOK_SETTING_KEYS)[0]?.value;
  return typeof v === 'number' ? v : null;
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
    <Section
      title={`Idea Inbox payoff (${idea.totalSeeded} seeded / ${idea.totalMeasured} measured)`}
    >
      {idea.totalMeasured === 0 ? (
        <EmptyState
          line="No measured published drafts yet."
          hint="Seed a draft from the Ideas tab and mark it posted — this is the table that can tell you the Idea Inbox is not paying."
        />
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
                <td>
                  <ResultCell cell={idea.seeded} minN={minN} />
                </td>
                <td>
                  <ResultCell cell={idea.unseeded} minN={minN} />
                </td>
              </tr>
              {IDEA_SURFACES.map((s) => (
                <tr key={s.key} className="pb-thin">
                  <td>{s.label}</td>
                  <td>
                    <ResultCell cell={idea[s.key].seeded} minN={minN} />
                  </td>
                  <td>
                    <ResultCell cell={idea[s.key].unseeded} minN={minN} />
                  </td>
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
    </Section>
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
    <Section title={`Roster coverage — last 7 days (${rc.total} replies)`}>
      {rc.total === 0 ? (
        <EmptyState
          line="No posted replies in the last 7 days."
          hint="The doctrine is 70% of replies aimed at accounts 2–10x your size; this is the only place that checks whether you did it."
        />
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
    </Section>
  );
}

function AngleTable({
  cells,
  minN,
}: {
  cells: PlaybookAngleCell[];
  minN: number;
}): JSX.Element {
  if (cells.length === 0) {
    return (
      <EmptyState
        line="No posted replies yet."
        hint="Every AI-drafted reply carries its angle, so this fills itself once you start marking replies posted."
      />
    );
  }
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
            <td>
              <ResultCell cell={c} minN={minN} />
            </td>
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
            <td>
              <ResultCell cell={c} minN={minN} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One result cell. The plan's contract: below the gate it says so instead of
 *  quoting a median built on nothing.
 *
 *  UI.15 made it say so against the gate — `n=7/20`, not a bare `n=7`. The
 *  second number was ignored here for four phases (the param was literally
 *  `_minN`), which was survivable while 20 was baked; now that the ⚙ in this
 *  tab's header moves it, a cell that only said "insufficient" would be silent
 *  about the very number the user is watching themselves change. */
function ResultCell({ cell, minN }: { cell: PlaybookCell; minN: number }): JSX.Element {
  if (!cell.sufficient) {
    return (
      <span className="pb-gated">
        insufficient data (n={cell.n}/{minN})
      </span>
    );
  }
  const parts = [`med ${fmtN(cell.medianViews)} views`];
  if (cell.medianProfileVisits !== null) parts.push(`${cell.medianProfileVisits} clicks`);
  return <>{`${parts.join(' · ')} (n=${cell.n})`}</>;
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
