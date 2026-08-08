// The Playbook tab (CIRCLES-PLAN C4): the measured feedback loop as a page.
// Every stat renders with its n; below the min-sample gate a cell says
// "insufficient data (n=7/20)" instead of pretending — and since UI.15 that
// second number is the gate itself, editable from the ⚙ in this tab's header
// (`x.gates.minCellN`, the same key the drafting guidance and the MCP tools
// read). The guidance section shows exactly what the drafter/reply prompts
// inject right now (or that they stay silent). One $0 GET; the only spend is the
// one-time own-winner template extraction button (~$0.005/post, bounded ≤20).

import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { JUDGE_VERDICT_LABEL } from '../judge.ts';
import { COACH_BAND_LABEL } from '../postCoach.ts';
import { FORMAT_LABELS } from '../postFormat.ts';
import { ANGLE_VOCABULARY_WIDENED_AT } from '../replyMode.ts';
import { SettingsGear } from './SettingsGear.tsx';
import {
  ApiError,
  type OwnReplyCell,
  type OwnReplyContamination,
  type OwnReplyPerformance,
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

// Every top-level slice of the response, in render order. Only used to NAME what
// an out-of-date server left out — the per-section `slice()` guard is what
// actually keeps the tab alive.
const SLICE_KEYS: ReadonlyArray<keyof Playbook> = [
  'guidance',
  'angleEffectiveness',
  'bandCalibration',
  'batchVsSingle',
  'relationshipLift',
  'meEffectiveness',
  'mediaEffectiveness',
  'formatEffectiveness',
  'coachScoreEffectiveness',
  'judgeEffectiveness',
  'ideaEffectiveness',
  'latencyEffectiveness',
  'ownReplyPerformance',
  'modelEffectiveness',
  'timelineFunnel',
  'rosterCoverage',
  'pillarRegister',
  'structures',
];

// Long enough that the editor's own debounced PATCH has landed before we re-read
// (see the reload effect for why a bounded retry, not a poll).
const GATE_RELOAD_MS = PATCH_DEBOUNCE_MS + 300;
// The PATCH only STARTS at the debounce mark, so a slow round-trip can lose the
// race with the first re-read and hand back the old gate. Retry (with a growing
// delay) instead of trusting one shot — but bounded, so a genuine disagreement
// can never become an endless $0-but-noisy poll.
const GATE_RELOAD_MAX_ATTEMPTS = 3;

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

  // Named once at the top so the cause is obvious without scrolling past a dozen
  // placeholder sections.
  const missingSlices =
    data === null ? [] : SLICE_KEYS.filter((k) => data[k] === undefined || data[k] === null);
  const gateReload = useRef<{ gate: number; attempts: number } | null>(null);

  // Moving the gate only changes this page after the SERVER re-gates it: every
  // `sufficient` flag in the response was computed with `minN`. The editor's
  // value goes optimistic instantly and its PATCH only STARTS one debounce
  // later, so a re-read can overtake a slow PATCH and come back with the old
  // gate — `data.minN` matching the gear is the only real confirmation. Retry
  // up to GATE_RELOAD_MAX_ATTEMPTS per distinct value, delay growing per
  // attempt. The cap is what keeps a value the server refuses (the registry
  // bounds are the money guard) from turning a disagreement into an endless
  // poll: the editor re-reads on refusal, which snaps the gear back and settles
  // this the other way. `GET /x/playbook` is $0 and writes nothing.
  useEffect(() => {
    if (gearGate === null || data === null) return;
    if (gearGate === data.minN) {
      gateReload.current = null;
      return;
    }
    const attempts = gateReload.current?.gate === gearGate ? gateReload.current.attempts : 0;
    if (attempts >= GATE_RELOAD_MAX_ATTEMPTS) return;
    const t = setTimeout(
      () => {
        gateReload.current = { gate: gearGate, attempts: attempts + 1 };
        void load();
      },
      GATE_RELOAD_MS * (attempts + 1),
    );
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
          {missingSlices.length > 0 && (
            <div className="error">
              This server is older than the extension build — {missingSlices.length} section
              {missingSlices.length === 1 ? '' : 's'} missing ({missingSlices.join(', ')}). Redeploy
              stratus to fill them in.
            </div>
          )}

          {slice(data.guidance, 'What the prompts inject right now', () => (
            <Section title="What the prompts inject right now">
              <div className="pb-guidance">
                <div>
                  <span className="pb-guidance-label">replies</span>
                  {data.guidance.reply ?? (
                    <span className="pb-gated">
                      silent — no angle cell clears n≥{data.minN} yet
                    </span>
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
          ))}

          {slice(data.angleEffectiveness, 'Reply angles', () => (
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
              {/* RC.4 — the boundary marker. Rendered here rather than buried in
                  a comment because the discontinuity is invisible in the numbers:
                  a young `observation` cell looks like a losing angle when it is
                  only a new one. */}
              <div className="muted pb-note">
                <strong>Hard boundary at {ANGLE_VOCABULARY_WIDENED_AT}:</strong> the angle set went
                from three to five (observation, question added). Replies drafted before that date
                could not carry the new angles, so they are recorded as extends — these cells mix
                two populations. Compare within a side of the boundary, never across it, and read a
                thin observation/question cell as young, not as losing.
              </div>
            </Section>
          ))}

          {slice(data.bandCalibration, 'Band calibration', () => (
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
                    hit = ≥{fmtN(data.bandCalibration.hitThresholdViews)} views (my p75) ·
                    actionable {data.bandCalibration.actionable.n} (med{' '}
                    {fmtN(data.bandCalibration.actionable.medianViews)}) vs passed{' '}
                    {data.bandCalibration.passed.n} (med{' '}
                    {fmtN(data.bandCalibration.passed.medianViews)})
                  </div>
                  <div className="status-line">
                    bait{' '}
                    <ResultCell
                      cell={baitAsCell(data.bandCalibration.bait?.bait)}
                      minN={data.minN}
                    />{' '}
                    · non-bait{' '}
                    <ResultCell
                      cell={baitAsCell(data.bandCalibration.bait?.nonBait)}
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
          ))}

          {slice(data.batchVsSingle, 'Batch vs single drafts', () => (
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
                rows are matched on the text a list actually rendered. A reply that is both counts
                as the draft, never twice. {data.batchVsSingle.unattributed} published replies
                unattributed (hand-written or pre-tooling).
              </div>
            </Section>
          ))}

          {slice(data.relationshipLift, 'Relationship lift (C3 block on vs off)', () => (
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
                      <ResultCell
                        cell={data.relationshipLift.withoutRelationship}
                        minN={data.minN}
                      />
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
          ))}

          {slice(data.meEffectiveness, 'Personal context', () => (
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
          ))}

          {slice(data.mediaEffectiveness, 'Media vs text-only', () => (
            <Section
              title={`Media vs text-only (${data.mediaEffectiveness.totalMeasured} measured)`}
            >
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
                  {(data.mediaEffectiveness.unknown?.posted ?? 0) > 0 && (
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
                  lift stays silent until both sides clear n≥{data.minN} — the text-only baseline
                  the studio's images will be judged against.
                </div>
              )}
            </Section>
          ))}

          {slice(data.formatEffectiveness, 'Post format', () => (
            <FormatEffectivenessSection fe={data.formatEffectiveness} minN={data.minN} />
          ))}

          {slice(data.coachScoreEffectiveness, 'Does the coach score predict anything?', () => (
            <CoachScoreSection cs={data.coachScoreEffectiveness} minN={data.minN} />
          ))}

          {slice(data.judgeEffectiveness, 'Does the judge predict anything?', () => (
            <JudgeEffectivenessSection je={data.judgeEffectiveness} minN={data.minN} />
          ))}

          {slice(data.ideaEffectiveness, 'Idea Inbox payoff', () => (
            <IdeaEffectivenessSection idea={data.ideaEffectiveness} minN={data.minN} />
          ))}

          {slice(data.latencyEffectiveness, 'Reply latency', () => (
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
                  grade stays silent until both &lt;15m and 1h+ clear n≥{data.minN} — the number
                  that would justify (or retire) the Radar/Launch-Room push to reply fast.
                </div>
              )}
            </Section>
          ))}

          {slice(data.ownReplyPerformance, 'My replies — harvested', () => (
            <OwnReplySection p={data.ownReplyPerformance} minN={data.minN} />
          ))}

          {slice(data.modelEffectiveness, 'Model effectiveness', () => (
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
          ))}

          {slice(data.timelineFunnel, 'Timeline funnel', () => (
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
                banded at first sighting, 30-day window. A cell stays silent until n≥{data.minN}{' '}
                seen; "unknown" means the tweet's time never rendered, not a verdict.
              </div>
            </Section>
          ))}

          {slice(data.rosterCoverage, 'Roster coverage — last 7 days', () => (
            <RosterCoverageSection rc={data.rosterCoverage} minN={data.minN} />
          ))}

          {slice(data.pillarRegister, 'Pillar × register', () => (
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
          ))}

          {slice(data.structures, 'My winning structures', () => (
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
          ))}
        </>
      )}
    </div>
  );
}

/** A slice and the section that reads it ship in the SAME commit, so a server
 *  older than this build simply has no key for it — and one `undefined.foo` took
 *  the whole tab down with it (SC.5's `formatEffectiveness` did exactly that
 *  against a server 20 commits behind). Every slice is presence-checked at its
 *  call site; a missing one degrades to a named placeholder that names the real
 *  cause, because nothing here is fixable in the extension — only by redeploying
 *  the server. Slice-level only: a field added to an EXISTING slice still
 *  arrives as `undefined`, which is why `ResultCell` guards its own cell too. */
function slice(value: unknown, title: string, render: () => JSX.Element): JSX.Element {
  if (value !== undefined && value !== null) return render();
  return (
    <Section title={title}>
      <div className="muted pb-note">
        Missing from the server's response — the deployed server is older than this extension build.
        Redeploy stratus to fill this section in.
      </div>
    </Section>
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

// SC.5 — the fourth axis. pillar = topic, register = tone, angle = reply
// stance, FORMAT = structure. The one Playbook table with real n on day one:
// it is classified from the post text at read time, so it covers the whole
// published history without a backfill (and re-labels itself when the
// classifier improves). No lift line — 14 buckets have no baseline pair.
function FormatEffectivenessSection({
  fe,
  minN,
}: {
  fe: Playbook['formatEffectiveness'];
  minN: number;
}): JSX.Element {
  return (
    <Section title={`Post format (${fe.totalPosted} originals, ${fe.totalMeasured} measured)`}>
      {fe.cells.length === 0 ? (
        <EmptyState
          line="No published originals yet."
          hint="This one fills itself the moment you have posts — the label is read off the text, so nothing needs to be tagged by hand."
        />
      ) : (
        <table className="pb-table">
          <thead>
            <tr>
              <th>format</th>
              <th>posted</th>
              <th>result</th>
            </tr>
          </thead>
          <tbody>
            {fe.cells.map((c) => (
              <tr key={c.format} className={c.format === 'other' ? 'pb-thin' : ''}>
                <td>{FORMAT_LABELS[c.format]}</td>
                <td>{c.posted}</td>
                <td>
                  <ResultCell cell={c} minN={minN} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="muted pb-note">
        structure, not topic — which SHAPE of post lands, independent of pillar and register. Read
        off the text at post time, never stored. A cell stays silent until n≥{minN}; "Substance" and
        "One-liner" are the fallbacks for a post that matched no declared shape.
      </div>
    </Section>
  );
}

// SC.5 — the coach grading itself, shipped in the same commit as the cell it
// judges. Two questions, because the band alone cannot answer the second: does
// a higher score reach further (bands), and did the coach's FIX rows matter
// (clean vs flagged — a 90-scoring draft can still carry one).
const COACH_FIX_ROWS: Array<{ key: 'clean' | 'flagged'; label: string }> = [
  { key: 'clean', label: 'no fixes flagged' },
  { key: 'flagged', label: '1+ fix flagged' },
];

function CoachScoreSection({
  cs,
  minN,
}: {
  cs: Playbook['coachScoreEffectiveness'];
  minN: number;
}): JSX.Element {
  return (
    <Section title={`Does the coach score predict anything? (${cs.totalMeasured} measured)`}>
      {cs.totalPosted === 0 ? (
        <EmptyState
          line="No published originals yet."
          hint="This is the section that can tell you the score is worthless — it grades the coach against your own reach."
        />
      ) : (
        <>
          <table className="pb-table">
            <thead>
              <tr>
                <th>score band</th>
                <th>posted</th>
                <th>result</th>
              </tr>
            </thead>
            <tbody>
              {cs.cells.map((c) => (
                <tr key={c.band}>
                  <td>{COACH_BAND_LABEL[c.band]}</td>
                  <td>{c.posted}</td>
                  <td>
                    <ResultCell cell={c} minN={minN} />
                  </td>
                </tr>
              ))}
              {COACH_FIX_ROWS.map((r) => (
                <tr key={r.key} className="pb-thin">
                  <td>{r.label}</td>
                  <td>{cs[r.key].posted}</td>
                  <td>
                    <ResultCell cell={cs[r.key]} minN={minN} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cs.spread !== null && cs.spreadBands !== null ? (
            <div className="status-line">
              score spread: {cs.spread}x views ({COACH_BAND_LABEL[cs.spreadBands.high]} vs{' '}
              {COACH_BAND_LABEL[cs.spreadBands.low]})
              {cs.profileVisitsSpread !== null && ` · ${cs.profileVisitsSpread}x profile clicks`}
              {cs.spread > 1
                ? ' — higher-scoring posts reach further'
                : ' — higher-scoring posts do not reach further'}
            </div>
          ) : (
            <div className="muted pb-note">
              no measurable spread at n={cs.totalMeasured} — the score is a floor, not a lift. Two
              bands have to clear n≥{minN} before this can compare them.
            </div>
          )}
          {cs.fixSpread !== null ? (
            <div className="status-line">
              fix rows: {cs.fixSpread}x views for posts the coach flagged nothing on
              {cs.fixSpread >= 1
                ? ' — clearing the fixes pays'
                : ' — flagged posts reached further; clearing fixes buys nothing here'}
            </div>
          ) : (
            <div className="muted pb-note">
              the fix-row comparison stays silent until both sides clear n≥{minN} — it is the "did
              the advice help" question the band alone can't answer.
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// JD.7 — the paid judge grading itself, the sibling of the section above and
// shipped in the same phase as the tool. Two splits for the same reason: four
// bands are sparse on a corpus where the judge is on-demand, `approved` vs
// `rejected` is the same rows at half the sample. `unjudged` is its own row and
// is expected to dwarf the rest — a big one means posts are being edited after
// judging (the hash link is deliberately exact), not that the cell is broken.
const JUDGE_APPROVAL_ROWS: Array<{ key: 'approved' | 'rejected'; label: string }> = [
  { key: 'approved', label: 'judge approved (post it / slight)' },
  { key: 'rejected', label: 'judge rejected (major / do not post)' },
];

function JudgeEffectivenessSection({
  je,
  minN,
}: {
  je: Playbook['judgeEffectiveness'];
  minN: number;
}): JSX.Element {
  const judged = je.cells.reduce((sum, c) => sum + c.posted, 0);
  return (
    <Section title={`Does the judge predict anything? (${judged} judged of ${je.totalPosted})`}>
      {je.totalPosted === 0 ? (
        <EmptyState
          line="No published originals yet."
          hint="This is the section that can tell you the judge is worthless — it grades its verdicts against your own reach."
        />
      ) : (
        <>
          <table className="pb-table">
            <thead>
              <tr>
                <th>verdict</th>
                <th>posted</th>
                <th>result</th>
              </tr>
            </thead>
            <tbody>
              {je.cells.map((c) => (
                <tr key={c.band}>
                  <td>{JUDGE_VERDICT_LABEL[c.band]}</td>
                  <td>{c.posted}</td>
                  <td>
                    <ResultCell cell={c} minN={minN} />
                  </td>
                </tr>
              ))}
              {JUDGE_APPROVAL_ROWS.map((r) => (
                <tr key={r.key} className="pb-thin">
                  <td>{r.label}</td>
                  <td>{je[r.key].posted}</td>
                  <td>
                    <ResultCell cell={je[r.key]} minN={minN} />
                  </td>
                </tr>
              ))}
              <tr className="pb-thin">
                <td>never judged (or edited after)</td>
                <td>{je.unjudged.posted}</td>
                <td>
                  <ResultCell cell={je.unjudged} minN={minN} />
                </td>
              </tr>
            </tbody>
          </table>
          {je.spread !== null && je.spreadBands !== null ? (
            <div className="status-line">
              verdict spread: {je.spread}x views ({JUDGE_VERDICT_LABEL[je.spreadBands.high]} vs{' '}
              {JUDGE_VERDICT_LABEL[je.spreadBands.low]})
              {je.profileVisitsSpread !== null && ` · ${je.profileVisitsSpread}x profile clicks`}
              {je.spread > 1 ? ' — the judge picks winners' : ' — the judge does not pick winners'}
            </div>
          ) : (
            <div className="muted pb-note">
              no measurable spread at n={je.totalMeasured} — the judge is a second opinion, not a
              forecast. Two verdict bands have to clear n≥{minN} before this can compare them.
            </div>
          )}
          {je.approvedSpread !== null ? (
            <div className="status-line">
              approved vs rejected: {je.approvedSpread}x views
              {je.approvedSpread >= 1
                ? ' — posts it approved reached further'
                : ' — posts it rejected reached further'}
            </div>
          ) : (
            <div className="muted pb-note">
              the approved/rejected comparison stays silent until both sides clear n≥{minN} — it is
              the same question at half the sample the four bands need.
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

// §2.2–§2.4 — my own replies as the harvest scraped them, which is a different
// corpus from every drafts-based section above: it covers replies I hand-typed
// on x.com, and its clock runs from when the PARENT was posted, not from when a
// draft was opened. The title says "harvested" for exactly that reason — the
// "Reply latency" section directly above measures age-at-draft over
// `reply_drafts` and the two must never be read as one number.
//
// The headline is `viewsPerReply` because that is the single number the §8
// two-week test tracks daily; it renders `—` under the gate rather than a
// figure built on a handful of replies.
function OwnReplySection({ p, minN }: { p: OwnReplyPerformance; minN: number }): JSX.Element {
  return (
    <Section title={`My replies — harvested (${p.totalMeasured} measured)`}>
      {p.totalMeasured === 0 ? (
        <EmptyState
          line="No harvested replies yet."
          hint="Harvest your own replies from the Harvest tab (your handle, mode: replies) — it's a $0 DOM scrape. It also needs your handle in Settings → Identity, without which the server has no way to know which rows are yours."
        />
      ) : (
        <>
          <div className="status-line">
            {p.viewsPerReply === null ? (
              <span className="pb-gated">
                — views/reply (n={p.totalMeasured}/{minN})
              </span>
            ) : (
              `${fmtN(p.viewsPerReply)} views/reply`
            )}
            {` · ${p.totalMeasured} replies · ${fmtN(p.totalViews)} views, last 14 days`}
          </div>
          <OwnReplyTable
            label="parent size"
            cells={p.bands.map((c) => ({ ...c, key: c.band }))}
            minN={minN}
          />
          <OwnReplyTable
            label="age at post"
            cells={p.latency.map((c) => ({ ...c, key: c.bucket }))}
            minN={minN}
          />
          <OwnReplyTable
            label="replies already there"
            cells={p.crowding.map((c) => ({ ...c, key: c.bucket }))}
            minN={minN}
          />
          <OwnReplyTable
            label="experiment arm"
            cells={p.arms.map((c) => ({ ...c, key: c.arm }))}
            minN={minN}
          />
          {/* RC.9's three axes rode into an EXISTING slice, so `slice()` above
              cannot see them missing: against a server older than this build
              they arrive as `undefined`, and an empty table beats taking the
              tab down (the same defence `ResultCell` documents). */}
          <OwnReplyTable
            label="room"
            cells={(p.modes ?? []).map((c) => ({ ...c, key: c.mode }))}
            minN={minN}
          />
          <OwnReplyTable
            label="opening"
            cells={(p.openings ?? []).map((c) => ({ ...c, key: c.opening }))}
            minN={minN}
          />
          <OwnReplyTable
            label="opening × room"
            cells={(p.openingsByMode ?? []).map((c) => ({ ...c, key: `${c.mode} · ${c.opening}` }))}
            minN={minN}
          />
          <ContaminationLine c={p.contamination} minN={minN} />
          <div className="muted pb-note">
            Averages, not medians — these read against the §2.2 reference corpus, which is quoted as
            means. A cell keeps its counts but stops quoting an average below n≥{minN}. "unknown"
            means the scrape missed the parent, never "small": a jump in its share is a scraper
            regression, not a change in your behaviour.
          </div>
          <div className="muted pb-note">
            "capture" is basis points of the parent's views — read it BESIDE views/reply, never
            instead of it. Raw yield rewards a row for the parents it happened to land under: the
            stance-marker opening class led on yield by 20× purely because its parents averaged 8×
            the corpus, and on capture the opening classes did not separate at all. The room is
            attributed at read time from the Cannon pin first, then keyword detection — pin a handle
            in Radar → Cannon and this table re-reads history; "unknown" means neither answered, and
            those rows are deliberately outside the contamination rate.
          </div>
          <div className="muted pb-note">
            The roster arms only fill for handles camped in Radar → Cannon, so "roster-ja" stays
            empty until Japanese targets are on the roster. Foreign-language rows captured before
            the un-translation fix stored X's machine translation, so their script read can be wrong
            — they age out of the 14-day window on their own.
          </div>
        </>
      )}
    </Section>
  );
}

/** One own-reply axis. Five columns, and an insufficient cell is MARKED rather
 *  than dropped — a missing row reads as "no data", a different claim from "not
 *  enough yet". Its own component rather than `ResultCell` because this family
 *  averages: rendering `avgYield` through a cell labelled "med" would mislabel
 *  the number. */
function OwnReplyTable({
  label,
  cells,
  minN,
}: {
  label: string;
  cells: Array<OwnReplyCell & { key: string }>;
  minN: number;
}): JSX.Element {
  return (
    <table className="pb-table">
      <thead>
        <tr>
          <th>{label}</th>
          <th>replies</th>
          <th>share</th>
          <th>views/reply</th>
          <th>capture</th>
          <th>parent</th>
        </tr>
      </thead>
      <tbody>
        {cells.map((c) => (
          <tr key={c.key} className={c.key.includes('unknown') ? 'pb-thin' : ''}>
            <td>{c.key}</td>
            <td>{c.n}</td>
            <td>{fmtPct2(c.sharePct)}</td>
            <td>
              {c.avgYield === null ? (
                <span className="pb-gated">
                  insufficient data (n={c.n}/{minN})
                </span>
              ) : (
                fmtN(c.avgYield)
              )}
            </td>
            {/* `undefined` here is an older server, `null` is the gate. */}
            <td>
              {c.captureBp === null || c.captureBp === undefined ? '—' : `${fmtN(c.captureBp)} bp`}
            </td>
            <td>{fmtN(c.avgParentViews)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** RC.9's headline: how often an off-lane reply bridged back to the lane. One
 *  line rather than a table — it is a single rate, and the comparison that
 *  matters (contaminated vs clean yield) fits beside it. */
function ContaminationLine({
  c,
  minN,
}: {
  c: OwnReplyContamination | undefined;
  minN: number;
}): JSX.Element {
  if (c === undefined || c === null) return <div className="status-line pb-gated">—</div>;
  return (
    <div className="status-line">
      {c.pct === null ? (
        <span className="pb-gated">
          — lane contamination (n={c.n}/{minN})
        </span>
      ) : (
        `${fmtPct2(c.pct)} lane contamination · ${c.contaminated}/${c.n} off-lane replies reached for the lane`
      )}
      {c.avgYieldContaminated !== null || c.avgYieldClean !== null
        ? ` · ${c.avgYieldContaminated === null ? '—' : fmtN(c.avgYieldContaminated)} views when it did, ${
            c.avgYieldClean === null ? '—' : fmtN(c.avgYieldClean)
          } when it didn't`
        : ''}
    </div>
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
 *  about the very number the user is watching themselves change.
 *
 *  The nullish guard is the second half of the `slice()` defence: a field added
 *  to an EXISTING slice (rather than a whole new one) survives the slice check
 *  and lands here as `undefined`. One dash beats taking the tab down. */
function ResultCell({ cell, minN }: { cell: PlaybookCell | undefined; minN: number }): JSX.Element {
  if (cell === undefined || cell === null) return <span className="pb-gated">—</span>;
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

function baitAsCell(
  b:
    | {
        n: number;
        medianViews: number | null;
        sufficient: boolean;
      }
    | undefined,
): PlaybookCell | undefined {
  if (b === undefined) return undefined;
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
