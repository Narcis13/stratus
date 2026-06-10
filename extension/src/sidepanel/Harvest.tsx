import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import type {
  HarvestEvent,
  HarvestIngest,
  HarvestMode,
  HarvestOptions,
  HarvestPace,
  HarvestScope,
} from '../shared/harvest.ts';
import {
  type ActiveContext,
  type HarvestController,
  readActiveContext,
  startHarvest,
} from './harvestClient.ts';

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

const MODES: { id: HarvestMode; label: string }[] = [
  { id: 'posts', label: 'Posts' },
  { id: 'replies', label: 'Replies' },
];

const SCOPES: { id: HarvestScope; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
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

// Persisted so the choice survives panel close; default stays on.
const SEND_TO_STRATUS_KEY = 'harvestSendToStratus';

const ERROR_TEXT: Record<string, string> = {
  no_handle: "Couldn't read a profile handle from that page.",
  already_running: 'A harvest is already running in that tab — wait for it to finish.',
  content_not_ready: "The X page didn't finish loading. Try again.",
  disconnected: 'Lost the connection to the page (did the tab navigate or close?).',
  crashed: 'The harvest crashed — check the page console for details.',
  tab_create_failed: "Couldn't open an X tab to harvest.",
};

function errorText(code: string): string {
  return ERROR_TEXT[code] ?? `Harvest failed: ${code}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '?';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '?' : d.toLocaleString();
}

export function HarvestPanel(): JSX.Element {
  const [ctx, setCtx] = useState<ActiveContext | null>(null);
  const [handle, setHandle] = useState('');
  const [touched, setTouched] = useState(false);
  const [mode, setMode] = useState<HarvestMode>('posts');
  const [scope, setScope] = useState<HarvestScope>('all');
  const [pace, setPace] = useState<HarvestPace>('human');
  const [maxStr, setMaxStr] = useState('');
  const [sendToStratus, setSendToStratus] = useState(true);

  useEffect(() => {
    void chrome.storage.local.get(SEND_TO_STRATUS_KEY).then((out) => {
      if (out[SEND_TO_STRATUS_KEY] === false) setSendToStratus(false);
    });
  }, []);

  const toggleSendToStratus = (next: boolean): void => {
    setSendToStratus(next);
    void chrome.storage.local.set({ [SEND_TO_STRATUS_KEY]: next });
  };

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
    if (!handleValid || running) return;
    setError(null);
    setResult(null);
    setProgress(null);
    setStatus('Opening the timeline…');
    setRunning(true);

    const max = Number.parseInt(maxStr, 10);
    const options: HarvestOptions = {
      mode,
      scope,
      pace,
      sendToStratus,
      ...(Number.isFinite(max) && max > 0 ? { max } : {}),
    };

    try {
      controllerRef.current = await startHarvest(cleanHandle, options, onEvent);
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

  const detection = ctx?.onX
    ? ctx.handle
      ? `On profile @${ctx.handle} in the active tab.`
      : 'The active X tab isn’t a profile — enter a handle to harvest.'
    : 'The active tab isn’t X — a new X tab will open when you harvest.';

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
          value={handle}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          disabled={running}
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
      </div>

      <label className="row harvest-toggle">
        <input
          type="checkbox"
          checked={sendToStratus}
          disabled={running}
          onChange={(e) => toggleSendToStratus(e.target.checked)}
        />
        <span>Send to stratus (alongside the CSV)</span>
      </label>

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
                <strong>{progress.rows}</strong> rows · oldest {fmtDate(progress.oldest)} ·{' '}
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
          disabled={!handleValid}
          onClick={() => void start()}
        >
          {handleValid ? `Harvest @${cleanHandle}` : 'Enter a handle'}
        </button>
      )}

      {result && (
        <div className={result.rows > 0 ? 'ok harvest-result' : 'warn'}>
          {result.rows > 0 ? (
            <>
              {result.cancelled ? 'Stopped — saved ' : 'Done — saved '}
              <strong>{result.rows}</strong> rows to <code>{result.filename}</code>.
              <br />
              Range {fmtDate(result.lastTime)} … {fmtDate(result.firstTime)}.
              {result.ingest?.sent && (
                <>
                  <br />
                  Sent <strong>{result.ingest.rows}</strong> rows to stratus
                  {result.ingest.matched > 0 && <> · {result.ingest.matched} matched drafts</>}
                  {result.ingest.backfilled > 0 && <> ({result.ingest.backfilled} backfilled)</>}.
                </>
              )}
            </>
          ) : (
            <>
              No matching {mode} found{scope === 'all' ? '' : ` for ${scope}`}.
            </>
          )}
        </div>
      )}

      {result?.ingest && !result.ingest.sent && (
        <div className="warn">
          Stratus ingest failed: <code>{result.ingest.error}</code> — the CSV was still saved.
        </div>
      )}
    </div>
  );
}
