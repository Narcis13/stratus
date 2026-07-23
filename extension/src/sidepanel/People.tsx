// People tab (CIRCLES-PLAN C1): the Circles CRM. Stage-grouped roster with
// search, and the dossier — the one screen that answers "what's my history
// with this person?": timeline, notes, my replies to them with measured
// outcomes, their mentions of me, their saved tweets. Every handle elsewhere
// in the panel click-throughs to here via App's onOpenPerson.

import { type JSX, useCallback, useEffect, useState } from 'react';
import { ChannelTagPicker } from './ChannelTags.tsx';
import { IcebreakerBox } from './Icebreakers.tsx';
import {
  ApiError,
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
import type { Settings } from './storage.ts';
import { EmptyState } from './ui/EmptyState.tsx';
import { Section } from './ui/Section.tsx';
import { type SubTab, SubTabs } from './ui/SubTabs.tsx';

const STAGES: PersonStage[] = ['ally', 'mutual', 'responded', 'engaged', 'noticed', 'stranger'];

const EVENT_ICONS: Record<PersonEvent['type'], string> = {
  saved_tweet: '📌',
  saved_author: '📇',
  my_reply: '↗',
  their_mention: '↘',
  their_reply_to_me: '⚡',
  hover_sighting: '👀',
  harvest_seen: '🌾',
  note: '📝',
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
      👀 Passive capture is <strong>on</strong>: hover cards you see while browsing X grow this
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

export function PeoplePanel({ settings, openHandle, onClearOpen }: Props): JSX.Element {
  const [selected, setSelected] = useState<string | null>(openHandle);
  const [view, setView] = useState<PeopleView>('roster');

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
        <DossierView settings={settings} handle={selected} onBack={back} />
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

      <div className="radar-tabs people-stage-filter">
        <button
          type="button"
          className={`radar-tab${stage === null ? ' active' : ''}`}
          onClick={() => setStage(null)}
        >
          All
        </button>
        {STAGES.map((s) => (
          <button
            key={s}
            type="button"
            className={`radar-tab${stage === s ? ' active' : ''}`}
            onClick={() => setStage(stage === s ? null : s)}
          >
            {s}
          </button>
        ))}
      </div>

      {error && <div className="error">{error}</div>}

      {!loading && rows.length === 0 && !error && (
        <div className="muted">
          Nobody yet. People appear as you reply, save tweets, and pull mentions — or run{' '}
          <code>scripts/backfill-people.ts</code> to seed from history.
        </div>
      )}

      {groups.map((g) => (
        <section key={g.stage} className="brief-section">
          <h3>
            <span className={`stage-chip stage-${g.stage}`}>{g.stage}</span> ({g.rows.length})
          </h3>
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
        </section>
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
                        <span className={`stage-chip stage-${a.stage}`}>{a.stage}</span>
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

const LEDGER_STATUSES: FollowingStatus[] = ['active', 'queued', 'done', 'confirmed', 'gone'];
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

          <div className="radar-tabs people-stage-filter">
            <button
              type="button"
              className={`radar-tab${status === '' ? ' active' : ''}`}
              onClick={() => setStatus('')}
            >
              All
            </button>
            {LEDGER_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`radar-tab${status === s ? ' active' : ''}`}
                onClick={() => setStatus(status === s ? '' : s)}
              >
                {s}
              </button>
            ))}
          </div>

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
                    <span className="stage-chip">{r.status}</span>
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
}: {
  settings: Settings;
  handle: string;
  onBack: () => void;
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
      <div className="panel-header">
        <button type="button" onClick={onBack}>
          ← People
        </button>
        <a href={`https://x.com/${handle}`} target="_blank" rel="noreferrer">
          open on X ↗
        </a>
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
    <div className="brief-section">
      <div className="muted">No file on @{handle} yet.</div>
      {error && <div className="error">{error}</div>}
      <button type="button" disabled={busy} onClick={() => void create()}>
        {busy ? 'Creating…' : 'Start their file'}
      </button>
    </div>
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
        <div className="people-head-meta">
          <StagePicker
            settings={settings}
            handle={person.handle}
            stage={person.stage}
            onChanged={onChanged}
          />
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
      <section className="brief-section">
        <h3>Openers</h3>
        <IcebreakerBox settings={settings} handle={person.handle} />
      </section>

      {replies.count > 0 && (
        <section className="brief-section">
          <h3>
            My replies to them ({replies.count}, {replies.measured} measured)
          </h3>
          {angles.filter((a) => a.angle !== null).length > 0 && <AngleChips angles={angles} />}
          <ul className="brief-tweets">
            {replies.outcomes.slice(0, 5).map((o) => (
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
        </section>
      )}

      {mentions.length > 0 && (
        <section className="brief-section">
          <h3>Their mentions of me ({mentions.length})</h3>
          <ul className="brief-tweets">
            {mentions.slice(0, 5).map((m) => (
              <li key={m.tweetId} className="brief-tweet">
                <div className="brief-tweet-text">{m.text}</div>
                <div className="brief-tweet-metrics muted">
                  {m.status} · {fmtAgo(m.postedAt)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {savedTweets.length > 0 && (
        <section className="brief-section">
          <h3>Their saved tweets ({savedTweets.length})</h3>
          <ul className="brief-tweets">
            {savedTweets.slice(0, 5).map((t) => (
              <li key={t.tweetId} className="brief-tweet">
                <div className="brief-tweet-text">{t.text}</div>
                <div className="brief-tweet-metrics muted">saved {fmtAgo(t.savedAt)}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="brief-section">
        <h3>Timeline ({events.length})</h3>
        {events.length === 0 ? (
          <div className="muted">No interactions logged yet.</div>
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
      </section>
    </>
  );
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
  return (
    <select
      className={`stage-chip stage-${stage}`}
      value={stage}
      disabled={busy}
      onChange={(e) => void change(e.target.value as PersonStage)}
      title="Stage auto-advances from events; setting it by hand overrides (may demote)"
    >
      {[...STAGES].reverse().map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
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
    <section className="brief-section">
      <h3>Notes</h3>
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
    </section>
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
