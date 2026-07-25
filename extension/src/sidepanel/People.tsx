// People tab (CIRCLES-PLAN C1): the Circles CRM. Stage-grouped roster with
// search, and the dossier — the one screen that answers "what's my history
// with this person?": timeline, notes, my replies to them with measured
// outcomes, their mentions of me, their saved tweets. Every handle elsewhere
// in the panel click-throughs to here via App's onOpenPerson.

import { type JSX, useCallback, useEffect, useState } from 'react';
import { ChannelTagPicker } from './ChannelTags.tsx';
import { IcebreakerBox } from './Icebreakers.tsx';
import { SettingsGear } from './SettingsGear.tsx';
import {
  ApiError,
  type DmDraft,
  type DmDraftResult,
  type FollowingPatchBody,
  type FollowingQueueResponse,
  type FollowingRow,
  type FollowingStatus,
  type PersonAngleCell,
  type PersonDossier,
  type PersonEvent,
  type PersonListItem,
  type PersonStage,
  type TimelineAffinityAuthor,
  api,
} from './api.ts';
import { dmChip, followingChip, stageChip } from './chips.ts';
import { useServerSettings } from './serverSettingsHook.ts';
import { type SettingsEditor, useSettingsEditor } from './settingsEditor.ts';
import type { Settings } from './storage.ts';
import { EmptyState } from './ui/EmptyState.tsx';
import { Section } from './ui/Section.tsx';
import { type SubTab, SubTabs } from './ui/SubTabs.tsx';

const STAGES: PersonStage[] = ['ally', 'mutual', 'responded', 'engaged', 'noticed', 'stranger'];

/** The one knob the dossier's gear tunes — it caps three lists at once, which
 *  is why the gear sits in the dossier header rather than on any one of them. */
const DOSSIER_SETTING_KEYS = ['x.display.dossierListLen'];

// Text glyphs, not emoji (UI.14): emoji render at a different weight and
// baseline than the panel's type in every theme, and a timeline is a column of
// twelve of them. Each one is a direction or an object, and the `title` carries
// the event type for anything ambiguous.
const EVENT_ICONS: Record<PersonEvent['type'], string> = {
  saved_tweet: '❑',
  saved_author: '❐',
  my_reply: '↗',
  their_mention: '↘',
  their_reply_to_me: '⇄',
  hover_sighting: '◔',
  harvest_seen: '≋',
  note: '✎',
  manual_dm_logged: '✉',
  their_like: '♥',
  their_repost: '⟳',
  their_follow: '✚',
};

interface Props {
  settings: Settings;
  /** Handle to open directly (click-through from another panel). */
  openHandle: string | null;
  onClearOpen: () => void;
}

// C6 first-run note (open question 3): passive capture ships ON, so say so
// once, visibly, where the captured people appear. Dismiss persists.
const PASSIVE_NOTE_DISMISSED_KEY = 'c6:passiveNoteDismissed';

function PassiveCaptureNote(): JSX.Element | null {
  const [show, setShow] = useState(false);

  useEffect(() => {
    chrome.storage.local
      .get(PASSIVE_NOTE_DISMISSED_KEY)
      .then((out) => setShow(out[PASSIVE_NOTE_DISMISSED_KEY] !== true))
      .catch(() => {
        /* keep hidden */
      });
  }, []);

  if (!show) return null;
  return (
    <div className="status-line">
      ◔ Passive capture is <strong>on</strong>: hover cards you see while browsing X grow this
      roster automatically. Turn it off in Settings.{' '}
      <button
        type="button"
        onClick={() => {
          setShow(false);
          void chrome.storage.local.set({ [PASSIVE_NOTE_DISMISSED_KEY]: true });
        }}
      >
        Got it
      </button>
    </div>
  );
}

type PeopleView = 'roster' | 'following';

const PEOPLE_SUBTABS: SubTab<PeopleView>[] = [
  { id: 'roster', label: 'Roster' },
  { id: 'following', label: 'Following' },
];

// The two filter rows are single-select segmented controls, so they are the
// SubTabs primitive with an `all` sentinel rather than two hand-rolled pill
// rows. Clearing is "pick All"; the old click-the-active-one-to-clear is gone.
const STAGE_FILTER_TABS: SubTab<PersonStage | 'all'>[] = [
  { id: 'all', label: 'All' },
  ...STAGES.map((s) => ({ id: s, label: s })),
];

const LEDGER_FILTER_TABS: SubTab<FollowingStatus | 'all'>[] = [
  { id: 'all', label: 'All' },
  ...(['active', 'queued', 'done', 'confirmed', 'gone'] as FollowingStatus[]).map((s) => ({
    id: s,
    label: s,
  })),
];

export function PeoplePanel({ settings, openHandle, onClearOpen }: Props): JSX.Element {
  const [selected, setSelected] = useState<string | null>(openHandle);
  const [view, setView] = useState<PeopleView>('roster');
  // ONE editor for the whole tab (D135d) — the dossier gear is its only
  // consumer today, but a second gear takes this same instance as a prop.
  const editor = useSettingsEditor(settings);

  useEffect(() => {
    if (openHandle) setSelected(openHandle);
  }, [openHandle]);

  const back = (): void => {
    setSelected(null);
    onClearOpen();
  };

  return (
    <div className="panel">
      {selected ? (
        <DossierView settings={settings} handle={selected} onBack={back} editor={editor} />
      ) : (
        <>
          <SubTabs tabs={PEOPLE_SUBTABS} active={view} onSelect={setView} />
          {view === 'roster' ? (
            <>
              <PassiveCaptureNote />
              <PeopleList settings={settings} onOpen={setSelected} />
              <TimelineAffinity settings={settings} onOpen={setSelected} />
            </>
          ) : (
            <FollowingView settings={settings} onOpen={setSelected} />
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- list

function PeopleList({
  settings,
  onOpen,
}: {
  settings: Settings;
  onOpen: (handle: string) => void;
}): JSX.Element {
  const [rows, setRows] = useState<PersonListItem[]>([]);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState<PersonStage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.people.list(settings, {
        ...(q.trim() ? { q: q.trim() } : {}),
        ...(stage ? { stage } : {}),
        limit: 300,
      });
      setRows(res.people);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load people');
    } finally {
      setLoading(false);
    }
  }, [settings, q, stage]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [load, q]);

  const groups = STAGES.map((s) => ({ stage: s, rows: rows.filter((r) => r.stage === s) })).filter(
    (g) => g.rows.length > 0,
  );

  return (
    <>
      <div className="panel-header">
        <h2>People{rows.length > 0 && ` (${rows.length})`}</h2>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <input
        className="people-search"
        type="search"
        placeholder="Search handle or name…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <SubTabs
        tabs={STAGE_FILTER_TABS}
        active={stage ?? 'all'}
        onSelect={(id) => setStage(id === 'all' ? null : id)}
      />

      {error && <div className="error">{error}</div>}

      {!loading && rows.length === 0 && !error && (
        <EmptyState
          line={q.trim() || stage ? 'Nobody matches that filter.' : 'Nobody in the roster yet.'}
          hint={
            q.trim() || stage
              ? 'Clear the search or pick All — the roster is grouped by stage, so a filter can hide a whole tier.'
              : 'People appear as you reply, save tweets and pull mentions. To seed from history, run scripts/backfill-people.ts.'
          }
        />
      )}

      {/* The list is already grouped BY stage and the eyebrow names it, so the
          stage chip that used to sit here would have repeated the heading. */}
      {groups.map((g) => (
        <Section key={g.stage} title={`${g.stage} (${g.rows.length})`}>
          <ul className="people-list">
            {g.rows.map((p) => (
              <li key={p.handle} className="people-row">
                <button type="button" className="people-row-main" onClick={() => onOpen(p.handle)}>
                  <span className="people-name">
                    {p.displayName ? `${p.displayName} ` : ''}
                    <span className="people-handle">@{p.handle}</span>
                  </span>
                  <span className="people-counts">
                    ↗{p.outboundCount} ↘{p.inboundCount}
                    {p.lastSeenAt && <span className="people-ago"> · {fmtAgo(p.lastSeenAt)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </>
  );
}

// ------------------------------------------------------------- affinity

// HV.4: the people the algorithm keeps feeding the home timeline, out of the
// passive harvest corpus. Collapsed and unfetched until asked — the roster above
// is what the tab is for; this is the "who am I not tracking yet?" drawer.
// Everything here is $0 read-time SQL, so a refresh costs nothing but a request.
function TimelineAffinity({
  settings,
  onOpen,
}: {
  settings: Settings;
  onOpen: (handle: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [authors, setAuthors] = useState<TimelineAffinityAuthor[] | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.harvest.affinity(settings);
      setAuthors(res.authors);
      setDays(res.days);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load affinity');
    } finally {
      setLoading(false);
    }
  }, [settings]);

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    if (next && authors === null && !loading) void load();
  };

  return (
    <Section
      title="Timeline affinity"
      actions={
        <>
          {open && (
            <button type="button" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          )}
          <button type="button" onClick={toggle}>
            {open ? 'Hide' : 'Show'}
          </button>
        </>
      }
    >
      {open && (
        <>
          {error && <div className="error">{error}</div>}

          {authors !== null && authors.length === 0 && !error && (
            <EmptyState
              line="Nobody has shown up often enough yet."
              hint={`Authors need at least 3 separate days in the last ${days} — keep scrolling x.com/home with passive capture on.`}
            />
          )}

          {authors !== null && authors.length > 0 && (
            <ul className="people-list">
              {authors.map((a) => (
                <li key={a.handle} className="people-row">
                  <button
                    type="button"
                    className="people-row-main"
                    onClick={() => onOpen(a.handle)}
                  >
                    <span className="people-name">
                      <span className="people-handle">@{a.handle}</span>{' '}
                      {a.stage ? (
                        <span className={stageChip(a.stage)}>{a.stage}</span>
                      ) : (
                        !a.inRoster && <span className="people-ago">Start their file →</span>
                      )}
                    </span>
                    <span className="people-counts">
                      {a.distinctDays}d · {a.sightings}× · {a.avgViews.toLocaleString()} views
                      <span className="people-ago"> · {fmtAgo(a.lastSeenAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}

// -------------------------------------------------------------- following

// GR.4 — the curation half of the people layer. Everything here is $0 and
// nothing here unfollows anybody: the batch is a nudge list, the user unfollows
// in the X app, ticks the row, and the next complete /following scrape confirms
// it. The caps (15–18 per 6h, 40/day) are enforced server-side; this view only
// reports them, so there is no client-side clamp to keep in sync.
//
// Worth knowing before touching the reload logic: GET /following/queue is what
// RELEASES rows into the batch, so every load is also a write. It is idempotent
// (tops the batch up to the budget rather than stacking), which is why reloading
// after each PATCH is the whole state management here.
const STALE_SYNC_MS = 7 * 24 * 60 * 60 * 1000;

const LEDGER_LIMIT = 200;

function FollowingView({
  settings,
  onOpen,
}: {
  settings: Settings;
  onOpen: (handle: string) => void;
}): JSX.Element {
  const [queue, setQueue] = useState<FollowingQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setQueue(await api.following.queue(settings));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load the unfollow queue');
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (handle: string, body: FollowingPatchBody): Promise<void> => {
      setBusy(handle);
      setError(null);
      try {
        await api.following.patch(settings, handle, body);
        await load();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Update failed');
      } finally {
        setBusy(null);
      }
    },
    [settings, load],
  );

  const lastSync = queue?.lastCompleteRunAt ?? null;
  const stale = lastSync === null || Date.now() - Date.parse(lastSync) > STALE_SYNC_MS;

  return (
    <>
      <div className="panel-header">
        <h2>Unfollow queue{queue && queue.batch.length > 0 && ` (${queue.batch.length})`}</h2>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {queue && (
        <>
          <div className={stale ? 'warn' : 'status-line'}>
            {lastSync === null
              ? 'No complete following sync yet.'
              : `Last complete sync ${fmtAgo(lastSync)}.`}
            {stale && (
              <>
                {' '}
                Open your own <code>x.com/&lt;you&gt;/following</code> page and run a Following
                harvest from the Harvest tab — this list is only as good as the last full scroll.
              </>
            )}
          </div>

          <div className="status-line">
            Unfollowed{' '}
            <strong>
              {queue.windowUsed}/{queue.windowCap}
            </strong>{' '}
            this 6h window ·{' '}
            <strong>
              {queue.dailyUsed}/{queue.dailyCeiling}
            </strong>{' '}
            today · {queue.eligibleTotal} eligible in total
          </div>

          {queue.batch.length === 0 ? (
            <EmptyState
              line={
                queue.eligibleTotal > 0
                  ? `Cap reached — ${queue.eligibleTotal} still waiting.`
                  : 'Nobody to unfollow right now.'
              }
              hint={
                queue.eligibleTotal > 0
                  ? 'Releases are capped at 15–18 per 6 hours and 40 a day so the churn never looks automated. Come back later.'
                  : 'Everyone you follow either follows back, is a mutual/ally/target, is kept, or was first seen less than 7 days ago.'
              }
            />
          ) : (
            <ul className="following-list">
              {queue.batch.map((r) => (
                <li key={r.handle} className="following-row">
                  <a
                    className="following-handle"
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    title="Open their profile on X — unfollow there, then tick the row"
                  >
                    @{r.handle} ↗
                  </a>
                  {r.displayName && <span className="muted">{r.displayName}</span>}
                  <button
                    type="button"
                    className="person-link"
                    title="Open their dossier"
                    onClick={() => onOpen(r.handle)}
                  >
                    file
                  </button>
                  <span className="following-meta">first seen {fmtAgo(r.firstSeenAt)}</span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void patch(r.handle, { status: 'done' })}
                  >
                    unfollowed ✓
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    title="Pin them — never suggest this person again"
                    onClick={() => void patch(r.handle, { keep: true })}
                  >
                    keep
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <FollowingLedger settings={settings} onOpen={onOpen} onChanged={() => void load()} />
    </>
  );
}

// The whole ledger, searchable — including the rows the queue will never offer
// (mutuals, kept pins, already-gone accounts). Collapsed and unfetched until
// asked: the batch above is what the tab is for. This is also the only way back
// from a `keep` pin, so the toggle is two-way here.
function FollowingLedger({
  settings,
  onOpen,
  onChanged,
}: {
  settings: Settings;
  onOpen: (handle: string) => void;
  onChanged: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<FollowingRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<FollowingStatus | ''>('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.following.list(settings, {
        ...(q.trim() ? { q: q.trim() } : {}),
        ...(status ? { status } : {}),
        limit: LEDGER_LIMIT,
      });
      setRows(res.following);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load the ledger');
    } finally {
      setLoading(false);
    }
  }, [settings, q, status]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => void load(), q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [open, load, q]);

  const toggleKeep = async (row: FollowingRow): Promise<void> => {
    setBusy(row.handle);
    setError(null);
    try {
      await api.following.patch(settings, row.handle, { keep: !row.keep });
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Update failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Ledger"
      actions={
        <>
          {open && (
            <button type="button" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          )}
          <button type="button" onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Show'}
          </button>
        </>
      }
    >
      {open && (
        <>
          <input
            className="people-search"
            type="search"
            placeholder="Search handle or name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <SubTabs
            tabs={LEDGER_FILTER_TABS}
            active={status === '' ? 'all' : status}
            onSelect={(id) => setStatus(id === 'all' ? '' : id)}
          />

          {error && <div className="error">{error}</div>}

          {rows !== null && rows.length === 0 && !error && (
            <EmptyState
              line="No rows match."
              hint="The ledger fills from a Following harvest — nothing is read from the X API."
            />
          )}

          {rows !== null && rows.length > 0 && (
            <>
              <ul className="following-list">
                {rows.map((r) => (
                  <li key={r.handle} className="following-row">
                    <button
                      type="button"
                      className="person-link"
                      title="Open their dossier"
                      onClick={() => onOpen(r.handle)}
                    >
                      @{r.handle}
                    </button>
                    <span className={followingChip(r.status)}>{r.status}</span>
                    {r.followsBack && <span className="following-mutual">follows back</span>}
                    <span className="following-meta">first seen {fmtAgo(r.firstSeenAt)}</span>
                    <button
                      type="button"
                      disabled={busy !== null}
                      title={r.keep ? 'Stop pinning — they can be queued again' : 'Never suggest'}
                      onClick={() => void toggleKeep(r)}
                    >
                      {r.keep ? 'kept ✓' : 'keep'}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="status-line">
                {rows.length} of {total} rows
                {rows.length < total && ' — narrow the search to see the rest'}
              </div>
            </>
          )}
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- dossier

function DossierView({
  settings,
  handle,
  onBack,
  editor,
}: {
  settings: Settings;
  handle: string;
  onBack: () => void;
  editor: SettingsEditor;
}): JSX.Element {
  const [dossier, setDossier] = useState<PersonDossier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setNotFound(false);
    try {
      setDossier(await api.people.dossier(settings, handle));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(e instanceof ApiError ? e.message : 'Failed to load dossier');
    }
  }, [settings, handle]);

  useEffect(() => {
    setDossier(null);
    void load();
  }, [load]);

  return (
    <>
      {/* The gear lives on the dossier's own header because the knob it holds
          caps three of the lists below at once — hanging it off any one of them
          would understate its reach, and two of the three are conditional. */}
      <div className="panel-header">
        <button type="button" onClick={onBack}>
          ← People
        </button>
        <div className="row">
          <a href={`https://x.com/${handle}`} target="_blank" rel="noreferrer">
            open on X ↗
          </a>
          <SettingsGear
            editor={editor}
            keys={DOSSIER_SETTING_KEYS}
            label="Configure how many rows each dossier list shows"
            note="Caps my replies, their mentions and their saved tweets. The timeline below is never capped — the whole history is the point."
          />
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {notFound && (
        <NotYetKnown settings={settings} handle={handle} onCreated={() => void load()} />
      )}
      {!dossier && !error && !notFound && <div className="muted">Loading…</div>}
      {dossier && <Dossier settings={settings} dossier={dossier} onChanged={() => void load()} />}
    </>
  );
}

// A handle clicked somewhere before the system has a row for them: offer to
// start the file (manual-add path — POST /events creates the person).
function NotYetKnown({
  settings,
  handle,
  onCreated,
}: {
  settings: Settings;
  handle: string;
  onCreated: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.people.addEvent(settings, handle, {
        type: 'note',
        summary: 'added manually from the panel',
      });
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {error && <div className="error">{error}</div>}
      <EmptyState
        line={`No file on @${handle} yet.`}
        hint="Starting one logs a note event — from then on every reply, mention and saved tweet lands on their timeline."
        action={
          <button type="button" disabled={busy} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Start their file'}
          </button>
        }
      />
    </>
  );
}

function Dossier({
  settings,
  dossier,
  onChanged,
}: {
  settings: Settings;
  dossier: PersonDossier;
  onChanged: () => void;
}): JSX.Element {
  const { person, voiceAuthor, events, replies, angles, mentions, savedTweets, followerSeries } =
    dossier;
  const listLen = useServerSettings().dossierListLen;
  const followers =
    person.followersCount ??
    voiceAuthor?.followersCount ??
    followerSeries.at(-1)?.followersCount ??
    null;
  const bio = person.bio ?? voiceAuthor?.bio ?? null;

  return (
    <>
      <section className="brief-section people-head">
        <div className="people-head-name">
          <strong>{person.displayName ?? `@${person.handle}`}</strong>{' '}
          <span className="people-handle">@{person.handle}</span>
        </div>
        {/* The ladder gets its own row: six chips plus the meta spans on one
            wrapping line interleave into an unreadable jumble. */}
        <StagePicker
          settings={settings}
          handle={person.handle}
          stage={person.stage}
          onChanged={onChanged}
        />
        <div className="people-head-meta">
          {followers !== null && <span>{fmtNum(followers)} followers</span>}
          {person.lastInboundAt && <span>last inbound {fmtAgo(person.lastInboundAt)}</span>}
          {person.lastOutboundAt && <span>last reply {fmtAgo(person.lastOutboundAt)}</span>}
        </div>
        {bio && <div className="people-bio">{bio}</div>}
        <ChannelTagPicker
          settings={settings}
          tags={person.tags}
          onSave={async (tags) => {
            await api.people.patch(settings, person.handle, { tags });
            onChanged();
          }}
          suggestFrom={bio ?? undefined}
        />
      </section>

      <NotesEditor settings={settings} handle={person.handle} initial={person.notes} />
      <QuickLog settings={settings} handle={person.handle} onLogged={onChanged} />

      {/* C9 — two Grok-drafted conversation starters, grounded strictly on
          this dossier. Sending stays manual. */}
      <Section title="Openers">
        <IcebreakerBox settings={settings} handle={person.handle} />
      </Section>

      {/* A3.10 — a grounded outbound DM, same grounding + refusal ladder as
          Openers. Sending stays manual; "Mark sent" logs the timeline event, so
          the dossier reload (onChanged) surfaces it below. */}
      <Section title="Draft DM">
        <DmBox settings={settings} handle={person.handle} onSent={onChanged} />
      </Section>

      {replies.count > 0 && (
        <Section title={`My replies to them (${replies.count}, ${replies.measured} measured)`}>
          {angles.filter((a) => a.angle !== null).length > 0 && <AngleChips angles={angles} />}
          <ul className="brief-tweets">
            {replies.outcomes.slice(0, listLen).map((o) => (
              <li key={o.draftId} className="brief-tweet">
                <div className="brief-tweet-text">{o.replyText}</div>
                <div className="brief-tweet-metrics">
                  {o.outcome ? (
                    <>
                      <span>{fmtNum(o.outcome.views ?? 0)} views</span>
                      <span>{o.outcome.replies ?? 0} replies</span>
                      <span>{o.outcome.profileVisits ?? 0} profile visits</span>
                    </>
                  ) : (
                    <span className="muted">not measured yet</span>
                  )}
                  <span className="muted">{fmtAgo(o.draftCreatedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
          <MoreLine shown={listLen} total={replies.outcomes.length} />
        </Section>
      )}

      {mentions.length > 0 && (
        <Section title={`Their mentions of me (${mentions.length})`}>
          <ul className="brief-tweets">
            {mentions.slice(0, listLen).map((m) => (
              <li key={m.tweetId} className="brief-tweet">
                <div className="brief-tweet-text">{m.text}</div>
                <div className="brief-tweet-metrics muted">
                  {m.status} · {fmtAgo(m.postedAt)}
                </div>
              </li>
            ))}
          </ul>
          <MoreLine shown={listLen} total={mentions.length} />
        </Section>
      )}

      {savedTweets.length > 0 && (
        <Section title={`Their saved tweets (${savedTweets.length})`}>
          <ul className="brief-tweets">
            {savedTweets.slice(0, listLen).map((t) => (
              <li key={t.tweetId} className="brief-tweet">
                <div className="brief-tweet-text">{t.text}</div>
                <div className="brief-tweet-metrics muted">saved {fmtAgo(t.savedAt)}</div>
              </li>
            ))}
          </ul>
          <MoreLine shown={listLen} total={savedTweets.length} />
        </Section>
      )}

      {/* Deliberately uncapped — the three lists above are summaries, this is
          the answer to "what is my history with this person?" */}
      <Section title={`Timeline (${events.length})`}>
        {events.length === 0 ? (
          <EmptyState
            line="No interactions logged yet."
            hint="Replies, mentions, saved tweets and hover sightings land here on their own; Quick log above adds the ones that happen off-platform."
          />
        ) : (
          <ul className="people-timeline">
            {events.map((e) => (
              <li key={e.id} className="people-event">
                <span className="people-event-icon" title={e.type}>
                  {EVENT_ICONS[e.type] ?? '·'}
                </span>
                <span className="people-event-summary">{e.summary ?? e.type}</span>
                <span className="people-ago">{fmtAgo(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

/** The overflow line under a capped list — the same "+N more" contract the Today
 *  strip uses: everything past the cap still counts, it just isn't drawn. */
function MoreLine({ shown, total }: { shown: number; total: number }): JSX.Element | null {
  if (total <= shown) return null;
  return <div className="status-line">+{total - shown} more — raise the row cap with ⚙ above.</div>;
}

// A3.10 — draft a grounded outbound DM from the dossier. One explicit-button
// Grok call (~$0.005) behind the icebreaker refusal ladder; the draft persists
// (dm_drafts) so history survives. Sending stays manual: Copy → paste in X →
// "Mark sent" logs manual_dm_logged (onSent reloads the dossier so it shows).
function DmBox({
  settings,
  handle,
  onSent,
}: {
  settings: Settings;
  handle: string;
  onSent: () => void;
}): JSX.Element {
  const [idea, setIdea] = useState('');
  const [draft, setDraft] = useState<DmDraftResult | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGrounding, setShowGrounding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [prior, setPrior] = useState<DmDraft[]>([]);

  const loadPrior = useCallback(async () => {
    try {
      setPrior(await api.dms.list(settings, handle));
    } catch {
      /* prior history is best-effort — drafting still works without it */
    }
  }, [settings, handle]);

  useEffect(() => {
    void loadPrior();
  }, [loadPrior]);

  const generate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setShowGrounding(false);
    try {
      const res = await api.dms.draft(settings, handle, idea.trim() || undefined);
      setDraft(res);
      setText(res.text);
    } catch (e) {
      setError(dmError(e));
    } finally {
      setBusy(false);
    }
  };

  // "Mark sent" persists the (possibly edited) text first so the logged timeline
  // line matches what I actually pasted, then flips status. "Discard" just closes
  // the draft out. Both reload the prior list; sent also reloads the dossier.
  const finish = async (status: 'sent' | 'discarded'): Promise<void> => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const edited = text.trim();
      if (status === 'sent' && edited !== '' && edited !== draft.text) {
        await api.dms.patch(settings, draft.id, { text: edited });
      }
      await api.dms.patch(settings, draft.id, { status });
      setDraft(null);
      setText('');
      setIdea('');
      await loadPrior();
      if (status === 'sent') onSent();
    } catch (e) {
      setError(dmError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dm-box">
      {!draft && (
        <div className="dm-compose">
          <input
            type="text"
            className="dm-idea"
            placeholder="idea — any language, DM comes out in English (optional)"
            value={idea}
            disabled={busy}
            onChange={(e) => setIdea(e.target.value)}
          />
          <button type="button" disabled={busy} onClick={() => void generate()}>
            {busy ? 'Drafting…' : 'Draft DM'}
          </button>
        </div>
      )}
      {error && <div className="muted">{error}</div>}
      {draft && (
        <>
          <textarea
            className="dm-text"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="dm-foot">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(text).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" disabled={busy} onClick={() => void finish('sent')}>
              Mark sent
            </button>
            <button type="button" disabled={busy} onClick={() => void finish('discarded')}>
              Discard
            </button>
            <button type="button" onClick={() => setShowGrounding((v) => !v)}>
              {showGrounding ? 'Hide grounding' : 'What it knew'}
            </button>
            <span className="muted">${draft.costUsd.toFixed(4)}</span>
          </div>
          {showGrounding && <pre className="dm-grounding">{draft.grounding}</pre>}
        </>
      )}
      {prior.length > 0 && (
        <ul className="dm-prior">
          {prior.map((d) => (
            <li key={d.id} className="dm-prior-row">
              <span className={dmChip(d.status)}>{d.status}</span>
              <span className="dm-prior-text">{d.text}</span>
              <span className="people-ago">{fmtAgo(d.sentAt ?? d.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Same friendly mapping as the Openers box: a thin dossier refuses at 422
// before any spend, Grok-off is 503.
function dmError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 422) {
      return 'No shared context yet — save their tweets or exchange replies first.';
    }
    if (e.status === 503) return 'Grok is not configured on the server.';
    return `DM draft failed: ${e.message}`;
  }
  return 'DM draft failed';
}

function StagePicker({
  settings,
  handle,
  stage,
  onChanged,
}: {
  settings: Settings;
  handle: string;
  stage: PersonStage;
  onChanged: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const change = async (next: PersonStage): Promise<void> => {
    if (next === stage) return;
    setBusy(true);
    try {
      await api.people.patch(settings, handle, { stage: next });
      onChanged();
    } catch (err) {
      console.warn('[stratus] stage change failed', err);
    } finally {
      setBusy(false);
    }
  };
  // A row of chips rather than a <select>: the ladder is six rungs and the
  // whole point of the dossier head is seeing at a glance where someone sits on
  // it. The current rung is `aria-pressed`, which is also what tints it.
  return (
    <div
      className="chip-row"
      title="Stage auto-advances from events; setting it by hand overrides (may demote)"
    >
      {[...STAGES].reverse().map((s) => (
        <button
          key={s}
          type="button"
          className={stageChip(s)}
          aria-pressed={s === stage}
          disabled={busy}
          onClick={() => void change(s)}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function NotesEditor({
  settings,
  handle,
  initial,
}: {
  settings: Settings;
  handle: string;
  initial: string | null;
}): JSX.Element {
  const [notes, setNotes] = useState(initial ?? '');
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNotes(initial ?? '');
    setSaved(true);
  }, [initial]);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.people.patch(settings, handle, { notes: notes.trim() === '' ? null : notes });
      setSaved(true);
    } catch (err) {
      console.warn('[stratus] notes save failed', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Notes">
      <textarea
        className="people-notes"
        rows={3}
        placeholder="Free-form CRM notes — context the machine can't know…"
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
      />
      <button type="button" disabled={busy || saved} onClick={() => void save()}>
        {busy ? 'Saving…' : saved ? 'Saved' : 'Save notes'}
      </button>
    </Section>
  );
}

function QuickLog({
  settings,
  handle,
  onLogged,
}: {
  settings: Settings;
  handle: string;
  onLogged: () => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const log = async (type: 'note' | 'manual_dm_logged'): Promise<void> => {
    const summary = text.trim();
    if (summary === '') return;
    setBusy(true);
    try {
      await api.people.addEvent(settings, handle, { type, summary });
      setText('');
      onLogged();
    } catch (err) {
      console.warn('[stratus] event log failed', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="brief-section people-quicklog">
      <input
        type="text"
        placeholder="Log something — a note, a DM you sent…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="button" disabled={busy || text.trim() === ''} onClick={() => void log('note')}>
        Note
      </button>
      <button
        type="button"
        disabled={busy || text.trim() === ''}
        onClick={() => void log('manual_dm_logged')}
        title="Log a DM you sent manually in X — keeps the timeline complete"
      >
        DM sent
      </button>
    </section>
  );
}

function AngleChips({ angles }: { angles: PersonAngleCell[] }): JSX.Element {
  return (
    <div className="people-angles">
      {angles
        .filter((a) => a.angle !== null)
        .map((a) => (
          <span key={a.angle} className="people-angle-chip" title={`${a.measured} measured`}>
            {a.angle}: {a.posted}×
            {a.medianProfileVisits !== null && ` · ~${a.medianProfileVisits} visits`}
          </span>
        ))}
    </div>
  );
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function fmtAgo(iso: string): string {
  const min = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
  if (min < 60) return `${Math.round(min)}m ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}
