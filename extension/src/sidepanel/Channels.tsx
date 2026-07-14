// Channels (CIRCLES-PLAN C8) — topics as places. A Discord-style rail of
// #channels on the left; opening one shows the room: tagged people (with
// stages), the swipe file slice, open ideas, recent radar drafts, and own-post
// performance in the channel's mapped pillar — one topic, one screen.
// Deliberately shallow: a channel is tags + this saved view, nothing forks.

import { type FormEvent, type JSX, useCallback, useEffect, useState } from 'react';
import { invalidateChannelsCache } from './ChannelTags.tsx';
import {
  ApiError,
  type Channel,
  type ChannelAggregate,
  type ChannelCreateBody,
  type ContentPillar,
  api,
} from './api.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
  onOpenPerson: (handle: string) => void;
}

export function ChannelsPanel({ settings, onOpenPerson }: Props): JSX.Element {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [aggregate, setAggregate] = useState<ChannelAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [roomLoading, setRoomLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<'new' | Channel | null>(null);

  const loadChannels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.channels.list(settings);
      setChannels(rows);
      setSelected((cur) => cur ?? rows.find((ch) => ch.active)?.slug ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load channels');
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  const loadRoom = useCallback(async () => {
    if (!selected) {
      setAggregate(null);
      return;
    }
    setRoomLoading(true);
    setError(null);
    try {
      setAggregate(await api.channels.aggregate(settings, selected));
    } catch (e) {
      setAggregate(null);
      setError(e instanceof ApiError ? e.message : 'Failed to load channel');
    } finally {
      setRoomLoading(false);
    }
  }, [settings, selected]);

  useEffect(() => {
    void loadRoom();
  }, [loadRoom]);

  const onSaved = async (slug: string): Promise<void> => {
    invalidateChannelsCache();
    setEditing(null);
    await loadChannels();
    setSelected(slug);
    await loadRoom();
  };

  const onDeleted = async (): Promise<void> => {
    invalidateChannelsCache();
    setEditing(null);
    setSelected(null);
    setAggregate(null);
    await loadChannels();
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Channels</h2>
        <button type="button" onClick={() => void loadRoom()} disabled={roomLoading}>
          {roomLoading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="channels-layout">
        <nav className="channel-rail">
          {channels.map((ch) => (
            <button
              key={ch.slug}
              type="button"
              className={`channel-rail-item${selected === ch.slug ? ' active' : ''}${ch.active ? '' : ' channel-rail-inactive'}`}
              onClick={() => {
                setEditing(null);
                setSelected(ch.slug);
              }}
            >
              <span
                className="channel-dot"
                style={ch.color ? { background: ch.color } : undefined}
              />
              #{ch.slug}
            </button>
          ))}
          <button
            type="button"
            className="channel-rail-item channel-rail-new"
            onClick={() => setEditing('new')}
          >
            + new channel
          </button>
        </nav>

        <div className="channel-room">
          {editing ? (
            <ChannelForm
              settings={settings}
              channel={editing === 'new' ? null : editing}
              onSaved={onSaved}
              onDeleted={onDeleted}
              onCancel={() => setEditing(null)}
            />
          ) : !selected ? (
            <p className="muted">
              {loading
                ? 'Loading…'
                : 'No channels yet. Create one — a channel is just tags plus this view.'}
            </p>
          ) : aggregate ? (
            <Room
              aggregate={aggregate}
              onOpenPerson={onOpenPerson}
              onEdit={() => setEditing(aggregate.channel)}
            />
          ) : (
            <p className="muted">{roomLoading ? 'Loading…' : 'Nothing here.'}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- room

function Room({
  aggregate,
  onOpenPerson,
  onEdit,
}: {
  aggregate: ChannelAggregate;
  onOpenPerson: (handle: string) => void;
  onEdit: () => void;
}): JSX.Element {
  const { channel, people, voiceTweets, ideas, radarDrafts, posts } = aggregate;
  return (
    <>
      <div className="channel-room-head">
        <strong>{channel.label}</strong>
        {channel.pillar && <span className="badge badge-auto">pillar: {channel.pillar}</span>}
        {!channel.active && <span className="badge badge-paused">inactive</span>}
        <button type="button" onClick={onEdit}>
          Edit
        </button>
      </div>
      {channel.keywords && channel.keywords.length > 0 && (
        <div className="muted channel-keywords">suggests on: {channel.keywords.join(', ')}</div>
      )}

      <section className="brief-section">
        <h3>People ({people.length})</h3>
        {people.length === 0 ? (
          <p className="muted">Nobody tagged yet — tag people from their dossier.</p>
        ) : (
          <ul className="people-list">
            {people.map((p) => (
              <li key={p.handle}>
                <button
                  type="button"
                  className="people-row-main"
                  onClick={() => onOpenPerson(p.handle)}
                >
                  <span>
                    {p.displayName ?? `@${p.handle}`}{' '}
                    <span className="people-handle">@{p.handle}</span>
                  </span>
                  <span className={`stage-chip stage-${p.stage}`}>{p.stage}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {posts && (
        <section className="brief-section">
          <h3>
            My posts in #{channel.pillar} ({posts.count}, {posts.measured} measured)
          </h3>
          {posts.measured > 0 && (
            <div className="status-line">
              median {fmtNum(posts.medianViews)} views · {fmtNum(posts.medianProfileVisits)} profile
              visits
            </div>
          )}
          {posts.items.length === 0 ? (
            <p className="muted">No posted tweets carry this pillar yet.</p>
          ) : (
            <ul className="brief-tweets">
              {posts.items.slice(0, 8).map((it) => (
                <li key={it.scheduledPostId} className="brief-tweet">
                  <div className="brief-tweet-text">{it.text}</div>
                  <div className="brief-tweet-metrics">
                    {it.outcome ? (
                      <>
                        <span>{fmtNum(it.outcome.views)} views</span>
                        <span>{fmtNum(it.outcome.likes)} likes</span>
                        <span>{fmtNum(it.outcome.profileVisits)} visits</span>
                      </>
                    ) : (
                      <span className="muted">not measured yet</span>
                    )}
                    {it.register && <span className="muted">{it.register}</span>}
                    {it.postedTweetId && (
                      <a
                        href={`https://x.com/i/web/status/${it.postedTweetId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        open ↗
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="brief-section">
        <h3>Swipe file ({voiceTweets.length})</h3>
        {voiceTweets.length === 0 ? (
          <p className="muted">
            No saved tweets tagged — tag them in the Voice tab or at save time.
          </p>
        ) : (
          <ul className="brief-tweets">
            {voiceTweets.map((t) => (
              <li key={t.tweetId} className="brief-tweet">
                <div className="brief-tweet-text">{t.text}</div>
                <div className="brief-tweet-metrics">
                  <button
                    type="button"
                    className="person-link"
                    onClick={() => onOpenPerson(t.authorHandle)}
                  >
                    @{t.authorHandle}
                  </button>
                  {t.hookType && <span className="muted">{t.hookType}</span>}
                  {t.url && (
                    <a href={t.url} target="_blank" rel="noreferrer">
                      open ↗
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="brief-section">
        <h3>Open ideas ({ideas.length})</h3>
        {ideas.length === 0 ? (
          <p className="muted">No open ideas tagged — tag them in the Ideas tab.</p>
        ) : (
          <ul className="brief-tweets">
            {ideas.map((i) => (
              <li key={i.id} className="brief-tweet">
                <div className="brief-tweet-text">{i.text}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {radarDrafts.length > 0 && (
        <section className="brief-section">
          <h3>Radar drafts ({radarDrafts.length})</h3>
          <ul className="brief-tweets">
            {radarDrafts.map((d) => (
              <li key={`${d.tweetId}`} className="brief-tweet">
                <div className="brief-tweet-text">{d.snippet}</div>
                <div className="brief-tweet-metrics">
                  <button
                    type="button"
                    className="person-link"
                    onClick={() => onOpenPerson(d.handle)}
                  >
                    @{d.handle}
                  </button>
                  {d.band && <span className={`radar-band radar-band-${d.band}`}>{d.band}</span>}
                  <span className="muted">{d.status}</span>
                  {d.url && (
                    <a href={d.url} target="_blank" rel="noreferrer">
                      open ↗
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// -------------------------------------------------------------------- form

function ChannelForm({
  settings,
  channel,
  onSaved,
  onDeleted,
  onCancel,
}: {
  settings: Settings;
  channel: Channel | null;
  onSaved: (slug: string) => Promise<void>;
  onDeleted: () => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [slug, setSlug] = useState(channel?.slug ?? '');
  const [label, setLabel] = useState(channel?.label ?? '');
  const [color, setColor] = useState(channel?.color ?? '');
  const [pillar, setPillar] = useState(channel?.pillar ?? '');
  const [keywords, setKeywords] = useState((channel?.keywords ?? []).join(', '));
  const [active, setActive] = useState(channel?.active ?? true);
  const [pillars, setPillars] = useState<ContentPillar[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.pillars
      .list(settings, { active: true })
      .then(setPillars)
      .catch(() => setPillars([]));
  }, [settings]);

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const kws = keywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const body: ChannelCreateBody = {
      slug: slug.trim().toLowerCase(),
      label: label.trim() || `#${slug.trim().toLowerCase()}`,
      color: color.trim() || null,
      pillar: pillar || null,
      keywords: kws.length > 0 ? kws : null,
      active,
    };
    try {
      if (channel) {
        const { slug: _slug, ...patch } = body;
        await api.channels.update(settings, channel.slug, patch);
        await onSaved(channel.slug);
      } else {
        const created = await api.channels.create(settings, body);
        await onSaved(created.slug);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (): Promise<void> => {
    if (!channel) return;
    setBusy(true);
    setError(null);
    try {
      await api.channels.remove(settings, channel.slug);
      await onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <h3>{channel ? `Edit #${channel.slug}` : 'New channel'}</h3>
      {error && <div className="error">{error}</div>}

      {!channel && (
        <label className="field">
          <span>Slug (the #name — lowercase, dashes)</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="ai-agents"
            spellCheck={false}
            required
          />
        </label>
      )}
      <label className="field">
        <span>Label</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="#ai-agents" />
      </label>
      <label className="field">
        <span>Color (optional, e.g. #7aa2f7)</span>
        <input value={color} onChange={(e) => setColor(e.target.value)} spellCheck={false} />
      </label>
      <label className="field">
        <span>Mapped pillar (pulls own-post performance into the room)</span>
        <select value={pillar} onChange={(e) => setPillar(e.target.value)}>
          <option value="">— none —</option>
          {pillars.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Keywords (comma-separated — auto-suggests this channel, you confirm)</span>
        <input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="agents, claude, mcp"
          spellCheck={false}
        />
      </label>
      <label className="row voice-toggle">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span>Active</span>
      </label>

      <div className="row" style={{ marginTop: 8 }}>
        <button type="submit" className="primary" disabled={busy || (!channel && !slug.trim())}>
          {busy ? 'Saving…' : channel ? 'Save' : 'Create'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {channel &&
          (confirmDelete ? (
            <>
              <button
                type="button"
                className="danger"
                onClick={() => void onDelete()}
                disabled={busy}
              >
                Confirm delete
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} disabled={busy}>
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              className="danger"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              title="Deletes the channel; tags on rows stay behind as plain strings"
            >
              Delete
            </button>
          ))}
      </div>
    </form>
  );
}

function fmtNum(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
