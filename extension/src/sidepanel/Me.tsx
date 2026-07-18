// Me / My Profile (M1): the dynamic personal-context layer. Three sections —
// goals (with auto/manual progress), a quick-log composer for entries, and the
// entry library grouped by kind — plus a collapsible "What the AI sees" preview
// that shows the exact block a post/reply draft would receive. Everything reads
// and writes the always-mounted $0 /x/me routes; the `inWindow` freshness flag
// is server-computed (never re-derived here — §7.27).

import { type FormEvent, type JSX, useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  type GoalKind,
  type GoalStatus,
  type MeContextResponse,
  type MeEntry,
  type MeGoal,
  type MeKind,
  api,
} from './api.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
}

const ENTRY_KINDS: { value: MeKind; label: string }[] = [
  { value: 'fact', label: 'Fact' },
  { value: 'event', label: 'Event' },
  { value: 'emotion', label: 'Emotion' },
  { value: 'note', label: 'Note' },
];

const GOAL_KIND_LABEL: Record<GoalKind, string> = {
  followers: 'Followers',
  mrr: 'MRR',
  custom: 'Custom',
};

const ERR: Record<string, string> = {
  invalid_kind: 'Pick a valid kind.',
  invalid_text: 'Text is required (max 1000 chars).',
  invalid_happened_at: 'That date is invalid.',
  invalid_label: 'A label is required.',
  invalid_target: 'Target must be a positive number.',
  invalid_current_value: 'Current value must be a number.',
  invalid_deadline: 'That deadline is invalid.',
  invalid_status: 'Invalid status.',
  not_found: 'Not found — it may have been deleted elsewhere.',
};

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return ERR[e.code] ?? `${e.code} (${e.status})`;
  return fallback;
}

export function MePanel({ settings }: Props): JSX.Element {
  const [entries, setEntries] = useState<MeEntry[]>([]);
  const [goals, setGoals] = useState<MeGoal[]>([]);
  const [postBlock, setPostBlock] = useState<string | null>(null);
  const [replyBlock, setReplyBlock] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [me, post, reply] = await Promise.all([
        api.me.get(settings),
        api.me.context(settings, 'post'),
        api.me.context(settings, 'reply'),
      ]);
      setEntries(me.entries);
      setGoals(me.goals);
      setPostBlock(post.block);
      setReplyBlock(reply.block);
    } catch (e) {
      setError(errMsg(e, 'Failed to load your profile'));
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="panel me-panel">
      <div className="panel-header">
        <h2>Me</h2>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <p className="muted me-intro">
        Your living profile — goals, what's happening this week, how you feel. The drafters read a
        fresh slice at draft time so posts sound like this specific week, not a frozen bio.
      </p>

      {error && <div className="error">{error}</div>}

      <GoalsSection settings={settings} goals={goals} onChanged={load} setError={setError} />

      <QuickLog settings={settings} onAdded={load} setError={setError} />

      <EntriesSection settings={settings} entries={entries} onChanged={load} setError={setError} />

      <AiPreview
        open={previewOpen}
        onToggle={() => setPreviewOpen((v) => !v)}
        postBlock={postBlock}
        replyBlock={replyBlock}
      />
    </div>
  );
}

// -------------------------------------------------------------------- goals

interface GoalsProps {
  settings: Settings;
  goals: MeGoal[];
  onChanged: () => Promise<void>;
  setError: (e: string | null) => void;
}

function GoalsSection({ settings, goals, onChanged, setError }: GoalsProps): JSX.Element {
  const active = goals.filter((g) => g.status === 'active');
  const closed = goals.filter((g) => g.status !== 'active');
  return (
    <section className="me-section">
      <h3>Goals</h3>
      {goals.length === 0 ? (
        <p className="muted">
          No goals yet. A <code>followers</code> goal tracks itself from your daily snapshot; an{' '}
          <code>mrr</code> or <code>custom</code> goal takes a value you set.
        </p>
      ) : (
        <ul className="me-goal-list">
          {[...active, ...closed].map((g) => (
            <li key={g.id}>
              <GoalCard settings={settings} goal={g} onChanged={onChanged} setError={setError} />
            </li>
          ))}
        </ul>
      )}
      <AddGoal settings={settings} onAdded={onChanged} setError={setError} />
    </section>
  );
}

interface GoalCardProps {
  settings: Settings;
  goal: MeGoal;
  onChanged: () => Promise<void>;
  setError: (e: string | null) => void;
}

function GoalCard({ settings, goal, onChanged, setError }: GoalCardProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState(goal.currentValue == null ? '' : String(goal.currentValue));

  useEffect(() => {
    setValue(goal.currentValue == null ? '' : String(goal.currentValue));
  }, [goal.currentValue]);

  const patch = async (body: Parameters<typeof api.me.patchGoal>[2]): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.me.patchGoal(settings, goal.id, body);
      await onChanged();
    } catch (e) {
      setError(errMsg(e, 'Update failed'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!confirm(`Delete the goal "${goal.label}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.me.deleteGoal(settings, goal.id);
      await onChanged();
    } catch (e) {
      setError(errMsg(e, 'Delete failed'));
    } finally {
      setBusy(false);
    }
  };

  const saveValue = async (): Promise<void> => {
    const trimmed = value.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if (next !== null && !Number.isFinite(next)) {
      setError('Current value must be a number.');
      setValue(goal.currentValue == null ? '' : String(goal.currentValue));
      return;
    }
    if (next === goal.currentValue) return;
    await patch({ currentValue: next });
  };

  const p = goal.progress;
  const unit = goal.unit ? ` ${goal.unit}` : '';
  return (
    <div className={`me-goal${goal.status !== 'active' ? ' me-goal-closed' : ''}`}>
      <div className="me-goal-head">
        <span className="me-goal-label">{goal.label}</span>
        <span className="badge badge-auto">{GOAL_KIND_LABEL[goal.kind]}</span>
        {goal.status !== 'active' && <span className="badge badge-paused">{goal.status}</span>}
      </div>

      <div className="me-progress-track" aria-hidden="true">
        <div className="me-progress-fill" style={{ width: `${p ? p.pct : 0}%` }} />
      </div>

      <div className="me-goal-meta">
        {p ? (
          <span>
            {fmtNum(p.current)}
            {unit} / {fmtNum(goal.target)}
            {unit} ({p.pct}%)
          </span>
        ) : (
          <span className="muted">
            no data yet — target {fmtNum(goal.target)}
            {unit}
          </span>
        )}
        {p?.daysLeft != null && (
          <span className={p.daysLeft < 0 ? 'me-overdue' : 'muted'}>
            {p.daysLeft >= 0 ? `${p.daysLeft}d left` : `${-p.daysLeft}d overdue`}
          </span>
        )}
      </div>

      {goal.kind === 'followers' ? (
        <small className="muted">auto · from daily snapshot</small>
      ) : (
        <label className="field me-goal-value">
          <span>Current value</span>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => void saveValue()}
            disabled={busy}
            placeholder="set current…"
          />
        </label>
      )}

      <div className="row me-goal-actions">
        {goal.status === 'active' ? (
          <>
            <button
              type="button"
              onClick={() => void patch({ status: 'achieved' })}
              disabled={busy}
            >
              Mark achieved
            </button>
            <button type="button" onClick={() => void patch({ status: 'dropped' })} disabled={busy}>
              Drop
            </button>
          </>
        ) : (
          <button type="button" onClick={() => void patch({ status: 'active' })} disabled={busy}>
            Reactivate
          </button>
        )}
        <button type="button" className="danger" onClick={() => void remove()} disabled={busy}>
          Delete
        </button>
      </div>
    </div>
  );
}

interface AddGoalProps {
  settings: Settings;
  onAdded: () => Promise<void>;
  setError: (e: string | null) => void;
}

function AddGoal({ settings, onAdded, setError }: AddGoalProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<GoalKind>('followers');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = (): void => {
    setLabel('');
    setKind('followers');
    setTarget('');
    setUnit('');
    setDeadline('');
  };

  const create = async (): Promise<void> => {
    const t = Number(target.trim());
    if (label.trim() === '' || !Number.isFinite(t) || t <= 0) {
      setError('A label and a positive target are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.me.addGoal(settings, {
        label: label.trim(),
        kind,
        target: t,
        ...(unit.trim() ? { unit: unit.trim() } : {}),
        ...(deadline ? { deadline: new Date(deadline).toISOString() } : {}),
      });
      reset();
      setOpen(false);
      await onAdded();
    } catch (e) {
      setError(errMsg(e, 'Create failed'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="me-add-bar">
        <button type="button" onClick={() => setOpen(true)}>
          + Add goal
        </button>
      </div>
    );
  }

  return (
    <div className="me-goal me-add">
      <label className="field">
        <span>Label</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. 10K followers"
        />
      </label>
      <div className="row">
        <label className="field">
          <span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as GoalKind)}>
            {(Object.keys(GOAL_KIND_LABEL) as GoalKind[]).map((k) => (
              <option key={k} value={k}>
                {GOAL_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Target</span>
          <input type="number" value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
      </div>
      <div className="row">
        <label className="field">
          <span>Unit (optional)</span>
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="$, followers…"
          />
        </label>
        <label className="field">
          <span>Deadline (optional)</span>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
      </div>
      {kind === 'followers' && (
        <small className="muted">Followers progress tracks itself from the daily snapshot.</small>
      )}
      <div className="row">
        <button type="button" className="primary" onClick={() => void create()} disabled={busy}>
          {busy ? '…' : 'Create goal'}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- quick log

interface QuickLogProps {
  settings: Settings;
  onAdded: () => Promise<void>;
  setError: (e: string | null) => void;
}

function QuickLog({ settings, onAdded, setError }: QuickLogProps): JSX.Element {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<MeKind>('event');
  const [date, setDate] = useState('');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);

  const add = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const trimmed = text.trim();
    if (trimmed === '') return;
    setBusy(true);
    setError(null);
    try {
      await api.me.addEntry(settings, {
        kind,
        text: trimmed,
        pinned,
        ...(date ? { happenedAt: new Date(date).toISOString() } : {}),
      });
      setText('');
      setDate('');
      setPinned(false);
      await onAdded();
    } catch (err) {
      setError(errMsg(err, 'Add failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="me-section">
      <h3>Quick log</h3>
      <form onSubmit={add}>
        <label className="field">
          <span>What's true right now? (Romanian welcome)</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="shipped the studio · frustrated with the ANAF portal · I build in public"
          />
        </label>
        <div className="me-chip-row">
          {ENTRY_KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              className={`me-chip${kind === k.value ? ' me-chip-on' : ''}`}
              onClick={() => setKind(k.value)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="row me-log-opts">
          <label className="field me-date-field">
            <span>Date (optional — else today)</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="me-pin-check">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            <span>Pin (always injected)</span>
          </label>
        </div>
        <div className="row">
          <button type="submit" className="primary" disabled={busy || text.trim() === ''}>
            {busy ? 'Adding…' : 'Log it'}
          </button>
          <small className="muted">
            Emotions fade after 7 days, events after 30; facts &amp; notes stay. Pinned overrides.
          </small>
        </div>
      </form>
    </section>
  );
}

// ----------------------------------------------------------------- entries

interface EntriesProps {
  settings: Settings;
  entries: MeEntry[];
  onChanged: () => Promise<void>;
  setError: (e: string | null) => void;
}

function EntriesSection({ settings, entries, onChanged, setError }: EntriesProps): JSX.Element {
  return (
    <section className="me-section">
      <h3>Entries</h3>
      {entries.length === 0 ? (
        <p className="muted">Nothing logged yet. Use Quick log above.</p>
      ) : (
        ENTRY_KINDS.map((k) => {
          const group = entries.filter((e) => e.kind === k.value);
          if (group.length === 0) return null;
          return (
            <div key={k.value} className="me-entry-group">
              <h4 className="me-entry-group-title">
                {k.label}
                <span className="muted"> · {group.length}</span>
              </h4>
              <ul className="me-entry-list">
                {group.map((e) => (
                  <li key={e.id}>
                    <EntryRow
                      settings={settings}
                      entry={e}
                      onChanged={onChanged}
                      setError={setError}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}

interface EntryRowProps {
  settings: Settings;
  entry: MeEntry;
  onChanged: () => Promise<void>;
  setError: (e: string | null) => void;
}

function EntryRow({ settings, entry, onChanged, setError }: EntryRowProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.text);

  useEffect(() => {
    setDraft(entry.text);
  }, [entry.text]);

  const patch = async (body: Parameters<typeof api.me.patchEntry>[2]): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.me.patchEntry(settings, entry.id, body);
      await onChanged();
    } catch (e) {
      setError(errMsg(e, 'Update failed'));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (): Promise<void> => {
    const trimmed = draft.trim();
    if (trimmed === '' || trimmed === entry.text) {
      setEditing(false);
      setDraft(entry.text);
      return;
    }
    await patch({ text: trimmed });
    setEditing(false);
  };

  const remove = async (): Promise<void> => {
    if (!confirm('Delete this entry permanently?')) return;
    setBusy(true);
    setError(null);
    try {
      await api.me.deleteEntry(settings, entry.id);
      await onChanged();
    } catch (e) {
      setError(errMsg(e, 'Delete failed'));
    } finally {
      setBusy(false);
    }
  };

  // inWindow is only about freshness; an inactive entry is retired regardless.
  const stale = entry.active && !entry.inWindow;
  return (
    <div
      className={`me-entry${entry.active ? '' : ' me-entry-retired'}${stale ? ' me-entry-stale' : ''}`}
    >
      <div className="me-entry-head">
        <button
          type="button"
          className={`me-star${entry.pinned ? ' me-star-on' : ''}`}
          title={entry.pinned ? 'Unpin' : 'Pin (always injected)'}
          onClick={() => void patch({ pinned: !entry.pinned })}
          disabled={busy}
        >
          {entry.pinned ? '★' : '☆'}
        </button>
        <span className="me-entry-time">{whenLabel(entry)}</span>
        {!entry.active && <span className="badge badge-cancelled">retired</span>}
        {stale && <span className="badge badge-paused">not injected anymore</span>}
      </div>

      {editing ? (
        <textarea
          className="me-entry-edit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          maxLength={1000}
        />
      ) : (
        <div className="me-entry-text">{entry.text}</div>
      )}

      <div className="row me-entry-actions">
        {editing ? (
          <>
            <button
              type="button"
              className="primary"
              onClick={() => void saveEdit()}
              disabled={busy}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(entry.text);
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setEditing(true)} disabled={busy}>
              Edit
            </button>
            <button
              type="button"
              onClick={() => void patch({ active: !entry.active })}
              disabled={busy}
            >
              {entry.active ? 'Retire' : 'Restore'}
            </button>
            <button type="button" className="danger" onClick={() => void remove()} disabled={busy}>
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- ai preview

interface PreviewProps {
  open: boolean;
  onToggle: () => void;
  postBlock: string | null;
  replyBlock: string | null;
}

function AiPreview({ open, onToggle, postBlock, replyBlock }: PreviewProps): JSX.Element {
  return (
    <section className="me-section me-preview">
      <button type="button" className="me-preview-toggle" onClick={onToggle}>
        {open ? '▾' : '▸'} What the AI sees
      </button>
      {open && (
        <div className="me-preview-body">
          <div className="me-preview-block">
            <h4>Post drafts</h4>
            {postBlock ? (
              <pre className="me-preview-pre">{postBlock}</pre>
            ) : (
              <p className="muted">Empty — nothing is injected into post drafts right now.</p>
            )}
          </div>
          <div className="me-preview-block">
            <h4>Reply drafts (brief)</h4>
            {replyBlock ? (
              <pre className="me-preview-pre">{replyBlock}</pre>
            ) : (
              <p className="muted">Empty — nothing is injected into reply drafts right now.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// -------------------------------------------------------------------- utils

function fmtNum(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1);
}

function whenLabel(e: MeEntry): string {
  const iso = e.happenedAt ?? e.createdAt;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
