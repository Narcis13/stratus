import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_HARVEST_FORM,
  HARVEST_FORM_KEY,
  type HarvestEvent,
  type HarvestForm,
  type HarvestIngest,
  type HarvestMode,
  type HarvestOptions,
  type HarvestPace,
  type HarvestScope,
  parseHarvestForm,
  passiveRowsToday,
} from '../shared/harvest.ts';
import { api } from './api.ts';
import {
  type ActiveContext,
  type HarvestController,
  readActiveContext,
  startHarvest,
} from './harvestClient.ts';
import type { Settings } from './storage.ts';

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

const MODES: { id: HarvestMode; label: string }[] = [
  { id: 'posts', label: 'Posts' },
  { id: 'replies', label: 'Replies' },
  { id: 'following', label: 'Following' },
];

// What a run of each mode collects, for the "nothing found" line.
const MODE_NOUN: Record<HarvestMode, string> = {
  posts: 'posts',
  replies: 'replies',
  following: 'accounts',
};

const SCOPES: { id: HarvestScope; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  // §9.4 — incremental: only items newer than the last completed run for this
  // handle+mode. First run scrapes like All, then each run picks up where the
  // previous one ended.
  { id: 'since-last', label: 'Since last' },
];

const PACES: HarvestPace[] = ['slow', 'human', 'fast'];

interface Progress {
  rows: number;
  oldest: string | null;
  steps: number;
}

interface Result {
  rows: number;
  filename: string;
  firstTime: string | null;
  lastTime: string | null;
  cancelled: boolean;
  ingest: HarvestIngest | null;
}

// Persisted so the choice survives panel close; default stays on. Predates the
// HV.3 `harvestForm` blob and keeps its own key — other surfaces read it.
const SEND_TO_STRATUS_KEY = 'harvestSendToStratus';

// Enough to reach today's passive run past a busy day of hand harvests; the
// route's own default is the same number.
const RUNS_LOOKBACK = 20;

const ERROR_TEXT: Record<string, string> = {
  no_handle: "Couldn't read a profile handle from that page.",
  already_running: 'A harvest is already running in that tab — wait for it to finish.',
  content_not_ready: "The X page didn't finish loading. Try again.",
  disconnected: 'Lost the connection to the page (did the tab navigate or close?).',
  crashed: 'The harvest crashed — check the page console for details.',
  tab_create_failed: "Couldn't open an X tab to harvest.",
  not_own_following:
    "That's someone else's following list — the ledger only tracks who you follow. Open your own.",
};

function errorText(code: string): string {
  return ERROR_TEXT[code] ?? `Harvest failed: ${code}`;
}

function startLabel(mode: HarvestMode, targetHandle: string | null): string {
  if (targetHandle === null) {
    return mode === 'following' ? 'Open a following page' : 'Enter a handle';
  }
  return mode === 'following' ? `Harvest @${targetHandle}'s following` : `Harvest @${targetHandle}`;
}

function detectionText(ctx: ActiveContext | null): string {
  if (!ctx?.onX) return 'The active tab isn’t X — a new X tab will open when you harvest.';
  if (ctx.onFollowing && ctx.handle) return `On @${ctx.handle}’s following list in the active tab.`;
  if (ctx.handle) return `On profile @${ctx.handle} in the active tab.`;
  return 'The active X tab isn’t a profile — enter a handle to harvest.';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '?';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '?' : d.toLocaleString();
}

export function HarvestPanel({ settings }: { settings: Settings }): JSX.Element {
  const [ctx, setCtx] = useState<ActiveContext | null>(null);
  const [handle, setHandle] = useState('');
  const [touched, setTouched] = useState(false);
  const [mode, setMode] = useState<HarvestMode>(DEFAULT_HARVEST_FORM.mode);
  const [scope, setScope] = useState<HarvestScope>(DEFAULT_HARVEST_FORM.scope);
  const [pace, setPace] = useState<HarvestPace>(DEFAULT_HARVEST_FORM.pace);
  const [maxStr, setMaxStr] = useState(DEFAULT_HARVEST_FORM.maxStr);
  const [minViewsStr, setMinViewsStr] = useState(DEFAULT_HARVEST_FORM.minViewsStr);
  const [downloadCsv, setDownloadCsv] = useState(DEFAULT_HARVEST_FORM.downloadCsv);
  const [formLoaded, setFormLoaded] = useState(false);
  const [sendToStratus, setSendToStratus] = useState(true);

  useEffect(() => {
    void chrome.storage.local.get(SEND_TO_STRATUS_KEY).then((out) => {
      if (out[SEND_TO_STRATUS_KEY] === false) setSendToStratus(false);
    });
  }, []);

  // Restore the form, then mirror every later edit back. `formLoaded` is what
  // keeps the write effect from stamping the defaults over the stored value in
  // the render before the read resolves.
  useEffect(() => {
    void chrome.storage.local.get(HARVEST_FORM_KEY).then((out) => {
      const f = parseHarvestForm(out[HARVEST_FORM_KEY]);
      setMode(f.mode);
      setScope(f.scope);
      setPace(f.pace);
      setMaxStr(f.maxStr);
      setMinViewsStr(f.minViewsStr);
      setDownloadCsv(f.downloadCsv);
      setFormLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!formLoaded) return;
    const form: HarvestForm = { mode, scope, pace, maxStr, minViewsStr, downloadCsv };
    void chrome.storage.local.set({ [HARVEST_FORM_KEY]: form });
  }, [formLoaded, mode, scope, pace, maxStr, minViewsStr, downloadCsv]);

  const toggleSendToStratus = (next: boolean): void => {
    setSendToStratus(next);
    void chrome.storage.local.set({ [SEND_TO_STRATUS_KEY]: next });
  };

  // Today's ambient capture (HV.1/HV.2). null = not loaded or the read failed —
  // this is decoration on someone else's feature, so it stays silent rather
  // than claiming zero.
  const [passiveRows, setPassiveRows] = useState<number | null>(null);

  useEffect(() => {
    if (!settings.passiveHarvest) return;
    let alive = true;
    api.harvest
      .runs(settings, { limit: RUNS_LOOKBACK })
      .then((runs) => {
        if (alive) setPassiveRows(passiveRowsToday(runs, Date.now()));
      })
      .catch(() => {
        if (alive) setPassiveRows(null);
      });
    return () => {
      alive = false;
    };
  }, [settings]);

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const controllerRef = useRef<HarvestController | null>(null);

  // Prefill the handle from page detection until the user types their own (once
  // they've typed a non-empty value, leave it alone).
  const refreshContext = useCallback(async () => {
    const next = await readActiveContext();
    setCtx(next);
    setHandle((cur) => (touched && cur.trim() !== '' ? cur : (next.handle ?? cur)));
  }, [touched]);

  useEffect(() => {
    void refreshContext();
    const onActivated = (): void => void refreshContext();
    const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo): void => {
      if (info.status === 'complete' || info.url) void refreshContext();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [refreshContext]);

  const cleanHandle = handle.trim().replace(/^@/, '');
  const handleValid = HANDLE_RE.test(cleanHandle);
  // Both sinks off = a scrape that scrolls for minutes and saves nothing.
  const noOutput = !downloadCsv && !sendToStratus;

  // Following mode always targets the list page that is already open, never the
  // handle input: navigating to a handle typed for an earlier posts harvest
  // would scrape a stranger's followees into a ledger that means "who I follow".
  const following = mode === 'following';
  const followingHandle = ctx?.onFollowing ? ctx.handle : null;
  const targetHandle = following ? followingHandle : handleValid ? cleanHandle : null;

  const onEvent = useCallback((e: HarvestEvent) => {
    switch (e.type) {
      case 'started':
        setStatus(`Scrolling @${e.handle} — ${e.mode}${e.scope === 'all' ? '' : `, ${e.scope}`}…`);
        break;
      case 'progress':
        setProgress({ rows: e.rows, oldest: e.oldest, steps: e.steps });
        break;
      case 'sending':
        setStatus(`Sending ${e.rows} rows to stratus…`);
        break;
      case 'done':
        setRunning(false);
        setStatus(null);
        controllerRef.current = null;
        setResult({
          rows: e.rows,
          filename: e.filename,
          firstTime: e.firstTime,
          lastTime: e.lastTime,
          cancelled: e.cancelled,
          ingest: e.ingest ?? null,
        });
        break;
      case 'error':
        setRunning(false);
        setStatus(null);
        controllerRef.current = null;
        setError(errorText(e.code));
        break;
    }
  }, []);

  const start = async (): Promise<void> => {
    if (targetHandle === null || running || noOutput) return;
    setError(null);
    setResult(null);
    setProgress(null);
    setStatus('Opening the timeline…');
    setRunning(true);

    const max = Number.parseInt(maxStr, 10);
    const minViews = Number.parseInt(minViewsStr, 10);
    const options: HarvestOptions = {
      mode,
      // A list page has no date axis and no view counts — the engine forces the
      // same scope, this keeps the wire honest about what was asked for.
      scope: following ? 'all' : scope,
      pace,
      sendToStratus,
      downloadCsv,
      ...(Number.isFinite(max) && max > 0 ? { max } : {}),
      ...(!following && Number.isFinite(minViews) && minViews > 0 ? { minViews } : {}),
    };

    try {
      controllerRef.current = await startHarvest(targetHandle, options, onEvent);
    } catch (e) {
      setRunning(false);
      setStatus(null);
      setError(errorText(e instanceof Error ? e.message : 'setup_failed'));
    }
  };

  const stop = (): void => {
    controllerRef.current?.cancel();
    setStatus('Stopping — saving what was gathered…');
  };

  const detection = detectionText(ctx);

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Harvest</h2>
        <button type="button" onClick={() => void refreshContext()} disabled={running}>
          Re-detect
        </button>
      </div>

      <p className="status-line">{detection}</p>

      <label className="field">
        <span>Handle</span>
        <input
          type="text"
          placeholder="elonmusk"
          value={following ? (followingHandle ?? '') : handle}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          disabled={running || following}
          onChange={(e) => {
            setTouched(true);
            setHandle(e.target.value);
          }}
        />
      </label>

      <div className="seg-group">
        <span>Harvest</span>
        <div className="seg-row">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={mode === m.id ? 'primary' : ''}
              disabled={running}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {!following && (
        <div className="seg-group">
          <span>Date range</span>
          <div className="seg-row">
            {SCOPES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={scope === s.id ? 'primary' : ''}
                disabled={running}
                onClick={() => setScope(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="row harvest-tuning">
        <label className="field">
          <span>Pace</span>
          <select
            value={pace}
            disabled={running}
            onChange={(e) => setPace(e.target.value as HarvestPace)}
          >
            {PACES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Max rows</span>
          <input
            type="number"
            min={1}
            placeholder="∞"
            value={maxStr}
            disabled={running}
            onChange={(e) => setMaxStr(e.target.value)}
          />
        </label>
        {/* A list page carries no metrics — a view floor would silently drop
            everyone. */}
        {!following && (
          <label className="field">
            <span>Min views</span>
            <input
              type="number"
              min={1}
              placeholder="any"
              value={minViewsStr}
              disabled={running}
              onChange={(e) => setMinViewsStr(e.target.value)}
            />
          </label>
        )}
      </div>

      <label className="row harvest-toggle">
        <input
          type="checkbox"
          checked={downloadCsv}
          disabled={running}
          onChange={(e) => setDownloadCsv(e.target.checked)}
        />
        <span>Download CSV</span>
      </label>

      <label className="row harvest-toggle">
        <input
          type="checkbox"
          checked={sendToStratus}
          disabled={running}
          onChange={(e) => toggleSendToStratus(e.target.checked)}
        />
        <span>Send to stratus</span>
      </label>

      {noOutput && (
        <div className="warn">
          Turn on the CSV download or Send to stratus — with both off the harvest saves nothing.
        </div>
      )}

      {following && followingHandle === null && (
        <div className="warn">
          Open your own <code>x.com/&lt;you&gt;/following</code> page in the active tab, then start
          — following mode scrapes the list that's open, so it can only ever record who you follow.
        </div>
      )}

      {following && followingHandle !== null && (
        <p className="muted harvest-hint">
          A full scroll to the bottom is what lets stratus mark people you no longer follow — stop
          early and it only refreshes what it saw.
        </p>
      )}

      {error && <div className="error">{error}</div>}

      {running ? (
        <>
          <button type="button" className="danger" onClick={stop}>
            Stop
          </button>
          <div className="harvest-progress">
            <p className="status-line">{status ?? 'Working…'}</p>
            {progress && (
              <p className="status-line">
                <strong>{progress.rows}</strong> rows ·{' '}
                {/* A list page has no timestamps, so there is no "oldest" to show. */}
                {progress.oldest ? <>oldest {fmtDate(progress.oldest)} · </> : null}
                {progress.steps} scrolls
              </p>
            )}
            <p className="muted harvest-hint">
              Keep the X tab in the foreground — X stops loading more when it’s backgrounded.
            </p>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="primary"
          disabled={targetHandle === null || noOutput}
          onClick={() => void start()}
        >
          {startLabel(mode, targetHandle)}
        </button>
      )}

      {result && (
        <div className={result.rows > 0 ? 'ok harvest-result' : 'warn'}>
          {result.rows > 0 ? (
            <>
              {result.cancelled ? 'Stopped — saved ' : 'Done — saved '}
              <strong>{result.rows}</strong> rows{' '}
              {result.filename ? (
                <>
                  to <code>{result.filename}</code>.
                </>
              ) : (
                'to stratus only (no CSV).'
              )}
              {(result.firstTime || result.lastTime) && (
                <>
                  <br />
                  Range {fmtDate(result.lastTime)} … {fmtDate(result.firstTime)}.
                </>
              )}
              {result.ingest?.sent && (
                <>
                  <br />
                  Sent <strong>{result.ingest.rows}</strong> rows to stratus
                  {result.ingest.followsBack !== undefined && (
                    <> · {result.ingest.followsBack} follow you back</>
                  )}
                  {result.ingest.matched > 0 && <> · {result.ingest.matched} matched drafts</>}
                  {result.ingest.backfilled > 0 && <> ({result.ingest.backfilled} backfilled)</>}.
                  {result.ingest.complete === false && (
                    <>
                      <br />
                      Partial pass — the scroll never reached the end (stopped early, or the row
                      cap), so the ledger kept everyone it didn't see.
                    </>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              No matching {MODE_NOUN[mode]} found
              {mode === 'following' || scope === 'all' ? '' : ` for ${scope}`}.
            </>
          )}
        </div>
      )}

      {result?.ingest && !result.ingest.sent && (
        <div className="warn">
          Stratus ingest failed: <code>{result.ingest.error}</code>
          {result.filename
            ? ' — the CSV was still saved.'
            : ' — and the CSV was off, so nothing was kept.'}
        </div>
      )}

      {settings.passiveHarvest ? (
        passiveRows !== null && (
          <p className="muted harvest-hint">Passive: {passiveRows} rows today</p>
        )
      ) : (
        <p className="muted harvest-hint">Passive capture off</p>
      )}
    </div>
  );
}
