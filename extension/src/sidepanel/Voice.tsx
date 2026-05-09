import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  type VoiceAuthor,
  type VoiceTweet,
  type VoiceTweetsOpts,
  api,
} from './api.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
}

const SEARCH_DEBOUNCE_MS = 250;
const TWEET_LIMIT = 100;

export function VoicePanel({ settings }: Props): JSX.Element {
  const [authors, setAuthors] = useState<VoiceAuthor[]>([]);
  const [tweets, setTweets] = useState<VoiceTweet[]>([]);
  const [authorFilter, setAuthorFilter] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [includeReplies, setIncludeReplies] = useState(false);
  const [loadingAuthors, setLoadingAuthors] = useState(true);
  const [loadingTweets, setLoadingTweets] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAuthor, setBusyAuthor] = useState<string | null>(null);

  // Debounce the search box so we don't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadAuthors = useCallback(async () => {
    setLoadingAuthors(true);
    try {
      const rows = await api.voice.listAuthors(settings);
      setAuthors(rows);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load authors');
    } finally {
      setLoadingAuthors(false);
    }
  }, [settings]);

  const loadTweets = useCallback(async () => {
    setLoadingTweets(true);
    setError(null);
    try {
      const opts: VoiceTweetsOpts = { includeReplies, limit: TWEET_LIMIT };
      if (authorFilter) opts.author = authorFilter;
      if (search) opts.q = search;
      const rows = await api.voice.listTweets(settings, opts);
      setTweets(rows);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load tweets');
    } finally {
      setLoadingTweets(false);
    }
  }, [settings, authorFilter, search, includeReplies]);

  useEffect(() => {
    void loadAuthors();
  }, [loadAuthors]);

  useEffect(() => {
    void loadTweets();
  }, [loadTweets]);

  const filteredAuthor = useMemo(
    () => (authorFilter ? authors.find((a) => a.username === authorFilter) ?? null : null),
    [authors, authorFilter],
  );

  const promote = async (author: VoiceAuthor): Promise<void> => {
    setBusyAuthor(author.username);
    setError(null);
    try {
      const updated = await api.voice.patchAuthor(settings, author.username, {
        source: 'manual',
        pullEnabled: true,
        metricsPollingEnabled: true,
      });
      setAuthors((prev) =>
        prev.map((a) => (a.xUserId === updated.xUserId ? { ...a, ...updated } : a)),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Promote failed');
    } finally {
      setBusyAuthor(null);
    }
  };

  const demote = async (author: VoiceAuthor): Promise<void> => {
    setBusyAuthor(author.username);
    setError(null);
    try {
      // Soft-disable: keeps the row + history, just stops the paid pulls/polls.
      await api.voice.untrack(settings, author.username);
      setAuthors((prev) =>
        prev.map((a) =>
          a.xUserId === author.xUserId
            ? { ...a, pullEnabled: false, metricsPollingEnabled: false }
            : a,
        ),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Untrack failed');
    } finally {
      setBusyAuthor(null);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Voice</h2>
        <button
          type="button"
          onClick={() => {
            void loadAuthors();
            void loadTweets();
          }}
          disabled={loadingAuthors || loadingTweets}
        >
          {loadingAuthors || loadingTweets ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="voice-controls">
        <label className="field">
          <span>Search</span>
          <input
            type="search"
            placeholder="text contains…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            spellCheck={false}
          />
        </label>

        <label className="field">
          <span>Author</span>
          <select
            value={authorFilter}
            onChange={(e) => setAuthorFilter(e.target.value)}
            disabled={loadingAuthors}
          >
            <option value="">All authors ({authors.length})</option>
            {authors.map((a) => (
              <option key={a.xUserId} value={a.username}>
                @{a.username} · {a.tweetCount} · {labelForSource(a)}
              </option>
            ))}
          </select>
        </label>

        <label className="row voice-toggle">
          <input
            type="checkbox"
            checked={includeReplies}
            onChange={(e) => setIncludeReplies(e.target.checked)}
          />
          <span>Include replies</span>
        </label>
      </div>

      {filteredAuthor && (
        <AuthorCard
          author={filteredAuthor}
          busy={busyAuthor === filteredAuthor.username}
          onPromote={() => void promote(filteredAuthor)}
          onDemote={() => void demote(filteredAuthor)}
        />
      )}

      {!filteredAuthor && hasAutoAuthors(authors) && (
        <details className="voice-auto-list">
          <summary>
            {countAutoAuthors(authors)} auto-added author(s) — promote to actively track
          </summary>
          <ul className="author-list">
            {authors
              .filter((a) => a.source === 'auto_from_scrape')
              .map((a) => (
                <li key={a.xUserId}>
                  <AuthorCard
                    author={a}
                    busy={busyAuthor === a.username}
                    onPromote={() => void promote(a)}
                    onDemote={() => void demote(a)}
                  />
                </li>
              ))}
          </ul>
        </details>
      )}

      {loadingTweets && tweets.length === 0 ? (
        <p className="muted">Loading tweets…</p>
      ) : tweets.length === 0 ? (
        <p className="muted">No tweets match these filters.</p>
      ) : (
        <ul className="voice-tweet-list">
          {tweets.map((t) => (
            <li key={t.tweetId}>
              <TweetRow tweet={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface AuthorCardProps {
  author: VoiceAuthor;
  busy: boolean;
  onPromote: () => void;
  onDemote: () => void;
}

function AuthorCard({ author, busy, onPromote, onDemote }: AuthorCardProps): JSX.Element {
  const isAuto = author.source === 'auto_from_scrape';
  const actively = author.pullEnabled && author.metricsPollingEnabled;

  return (
    <div className="author-card">
      <div className="author-head">
        <span className="author-name">@{author.username}</span>
        <span className={`badge ${isAuto ? 'badge-auto' : 'badge-manual'}`}>{author.source}</span>
        <span className={`badge ${actively ? 'badge-tracked' : 'badge-paused'}`}>
          {actively ? 'tracked' : 'paused'}
        </span>
      </div>
      <div className="author-meta">
        {author.tweetCount} tweets · cap {author.maxPolledTweets}
        {author.lastPulledAt
          ? ` · last pulled ${new Date(author.lastPulledAt).toLocaleString()}`
          : ' · never pulled'}
      </div>
      <div className="row">
        {!actively ? (
          <button
            type="button"
            className="primary"
            onClick={onPromote}
            disabled={busy}
            title={isAuto ? 'Enable pulls + metrics polling for this author' : 'Re-enable tracking'}
          >
            {busy ? 'Promoting…' : isAuto ? 'Promote to tracked' : 'Resume tracking'}
          </button>
        ) : (
          <button
            type="button"
            className="danger"
            onClick={onDemote}
            disabled={busy}
            title="Pause pulls and metrics polling — history is kept"
          >
            {busy ? 'Pausing…' : 'Pause tracking'}
          </button>
        )}
      </div>
    </div>
  );
}

function TweetRow({ tweet }: { tweet: VoiceTweet }): JSX.Element {
  const likes = tweet.latestPublicMetrics?.like_count ?? null;
  const replies = tweet.latestPublicMetrics?.reply_count ?? null;
  const reposts = tweet.latestPublicMetrics?.retweet_count ?? null;
  const url = `https://x.com/${tweet.authorUsername}/status/${tweet.tweetId}`;
  return (
    <a className="voice-tweet" href={url} target="_blank" rel="noreferrer">
      <div className="voice-tweet-head">
        <span className="voice-tweet-author">@{tweet.authorUsername}</span>
        {tweet.isReply && <span className="badge badge-draft">reply</span>}
        <span className="voice-tweet-time">
          {new Date(tweet.createdAt).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })}
        </span>
      </div>
      <div className="voice-tweet-text">{tweet.text || <em className="muted">(no text)</em>}</div>
      {(likes !== null || replies !== null || reposts !== null) && (
        <div className="voice-tweet-metrics">
          {likes !== null && <span>♥ {likes}</span>}
          {replies !== null && <span>↩ {replies}</span>}
          {reposts !== null && <span>↻ {reposts}</span>}
        </div>
      )}
    </a>
  );
}

function labelForSource(a: VoiceAuthor): string {
  if (a.source === 'auto_from_scrape') return 'auto';
  return a.pullEnabled ? 'manual' : 'paused';
}

function hasAutoAuthors(authors: VoiceAuthor[]): boolean {
  return authors.some((a) => a.source === 'auto_from_scrape');
}

function countAutoAuthors(authors: VoiceAuthor[]): number {
  return authors.reduce((n, a) => n + (a.source === 'auto_from_scrape' ? 1 : 0), 0);
}
