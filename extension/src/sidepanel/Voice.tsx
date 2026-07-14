import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { ChannelTagPicker } from './ChannelTags.tsx';
import { PillarsPanel } from './Pillars.tsx';
import { ApiError, type VoiceAuthor, type VoiceTweet, type VoiceTweetsOpts, api } from './api.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
  /** §8.3 Remix: send a saved tweet's structure to the Composer drafter. */
  onRemix: (tweetId: string) => void;
  /** C1: open a handle's dossier in the People tab. */
  onOpenPerson: (handle: string) => void;
}

const SEARCH_DEBOUNCE_MS = 250;
const TWEET_LIMIT = 100;

export function VoicePanel({ settings, onRemix, onOpenPerson }: Props): JSX.Element {
  const [view, setView] = useState<'tweets' | 'pillars'>('tweets');
  const [authors, setAuthors] = useState<VoiceAuthor[]>([]);
  const [tweets, setTweets] = useState<VoiceTweet[]>([]);
  const [authorFilter, setAuthorFilter] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [hookInput, setHookInput] = useState<string>('');
  const [hook, setHook] = useState<string>('');
  const [extractedFilter, setExtractedFilter] = useState<'' | 'true' | 'false'>('');
  const [showRetired, setShowRetired] = useState(false);
  const [renderHtml, setRenderHtml] = useState(false);
  const [loadingAuthors, setLoadingAuthors] = useState(true);
  const [loadingTweets, setLoadingTweets] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const t = setTimeout(() => setHook(hookInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [hookInput]);

  const loadAuthors = useCallback(async () => {
    setLoadingAuthors(true);
    try {
      const rows = await api.voice.listAuthors(settings, { retired: showRetired });
      setAuthors(rows);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load authors');
    } finally {
      setLoadingAuthors(false);
    }
  }, [settings, showRetired]);

  const loadTweets = useCallback(async () => {
    setLoadingTweets(true);
    setError(null);
    try {
      const opts: VoiceTweetsOpts = { limit: TWEET_LIMIT, retired: showRetired };
      if (authorFilter) opts.author = authorFilter;
      if (search) opts.q = search;
      if (hook) opts.hook = hook;
      if (extractedFilter !== '') opts.extracted = extractedFilter === 'true';
      const rows = await api.voice.listTweets(settings, opts);
      setTweets(rows);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load tweets');
    } finally {
      setLoadingTweets(false);
    }
  }, [settings, authorFilter, search, hook, extractedFilter, showRetired]);

  useEffect(() => {
    void loadAuthors();
  }, [loadAuthors]);

  useEffect(() => {
    void loadTweets();
  }, [loadTweets]);

  const selectedAuthor = useMemo(
    () => (authorFilter ? (authors.find((a) => a.handle === authorFilter) ?? null) : null),
    [authors, authorFilter],
  );

  const refresh = (): void => {
    void loadAuthors();
    void loadTweets();
  };

  const toggleAuthorRetired = async (author: VoiceAuthor): Promise<void> => {
    setBusy(`author:${author.handle}`);
    setError(null);
    try {
      const updated = await api.voice.retireAuthor(settings, author.handle, !author.retired);
      setAuthors((prev) =>
        showRetired
          ? prev.map((a) => (a.handle === updated.handle ? { ...a, ...updated } : a))
          : prev.filter((a) => a.handle !== updated.handle || !updated.retired),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Update failed');
    } finally {
      setBusy(null);
    }
  };

  const removeAuthor = async (author: VoiceAuthor): Promise<void> => {
    setBusy(`author:${author.handle}`);
    setError(null);
    try {
      await api.voice.deleteAuthor(settings, author.handle);
      setAuthors((prev) => prev.filter((a) => a.handle !== author.handle));
      if (authorFilter === author.handle) setAuthorFilter('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Delete failed');
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  const toggleTweetRetired = async (tweet: VoiceTweet): Promise<void> => {
    setBusy(`tweet:${tweet.tweetId}`);
    setError(null);
    try {
      const updated = await api.voice.retireTweet(settings, tweet.tweetId, !tweet.retired);
      setTweets((prev) =>
        showRetired
          ? prev.map((t) => (t.tweetId === updated.tweetId ? { ...t, ...updated } : t))
          : prev.filter((t) => t.tweetId !== updated.tweetId || !updated.retired),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Update failed');
    } finally {
      setBusy(null);
    }
  };

  const removeTweet = async (tweet: VoiceTweet): Promise<void> => {
    setBusy(`tweet:${tweet.tweetId}`);
    setError(null);
    try {
      await api.voice.deleteTweet(settings, tweet.tweetId);
      setTweets((prev) => prev.filter((t) => t.tweetId !== tweet.tweetId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Delete failed');
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  // C8 — channel tags on a saved tweet (the picker owns suggest/toggle UX).
  const saveTweetTags = async (tweet: VoiceTweet, tags: string[]): Promise<void> => {
    const updated = await api.voice.setTweetTags(settings, tweet.tweetId, tags);
    setTweets((prev) =>
      prev.map((t) => (t.tweetId === updated.tweetId ? { ...t, ...updated } : t)),
    );
  };

  // §8.3 — one Grok pass distilling the tweet's structure (~$0.005).
  const extractTweet = async (tweet: VoiceTweet): Promise<void> => {
    setBusy(`extract:${tweet.tweetId}`);
    setError(null);
    try {
      const res = await api.voice.extractTemplate(settings, tweet.tweetId);
      setTweets((prev) => prev.map((t) => (t.tweetId === res.tweet.tweetId ? res.tweet : t)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Extract failed');
    } finally {
      setBusy(null);
    }
  };

  const extractBatch = async (): Promise<void> => {
    setBatchRunning(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.voice.extractBatch(settings);
      setNotice(
        `Extracted ${res.extracted}/${res.requested} ($${res.costUsd.toFixed(4)}); ` +
          `${res.remaining ?? '?'} still un-extracted.`,
      );
      void loadTweets();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Batch extract failed');
    } finally {
      setBatchRunning(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Voice</h2>
        {view === 'tweets' && (
          <button type="button" onClick={refresh} disabled={loadingAuthors || loadingTweets}>
            {loadingAuthors || loadingTweets ? 'Loading…' : 'Refresh'}
          </button>
        )}
      </div>

      <div className="radar-tabs">
        <button
          type="button"
          className={`radar-tab${view === 'tweets' ? ' active' : ''}`}
          onClick={() => setView('tweets')}
        >
          Tweets
        </button>
        <button
          type="button"
          className={`radar-tab${view === 'pillars' ? ' active' : ''}`}
          onClick={() => setView('pillars')}
        >
          Pillars
        </button>
      </div>

      {view === 'pillars' ? (
        <PillarsPanel settings={settings} />
      ) : (
        <>
          {error && <div className="error">{error}</div>}
          {notice && <div className="ok">{notice}</div>}

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
              <span>Hook type</span>
              <input
                type="search"
                placeholder="e.g. stat, contrast…"
                value={hookInput}
                onChange={(e) => setHookInput(e.target.value)}
                spellCheck={false}
              />
            </label>

            <label className="field">
              <span>Template</span>
              <select
                value={extractedFilter}
                onChange={(e) => setExtractedFilter(e.target.value as '' | 'true' | 'false')}
              >
                <option value="">all</option>
                <option value="true">extracted</option>
                <option value="false">not extracted</option>
              </select>
            </label>

            <button type="button" onClick={() => void extractBatch()} disabled={batchRunning}>
              {batchRunning ? 'Extracting…' : 'Extract templates (~$0.005/tweet)'}
            </button>

            <label className="field">
              <span>Author</span>
              <select
                value={authorFilter}
                onChange={(e) => setAuthorFilter(e.target.value)}
                disabled={loadingAuthors}
              >
                <option value="">All authors ({authors.length})</option>
                {authors.map((a) => (
                  <option key={a.handle} value={a.handle}>
                    @{a.handle} · {a.tweetCount}
                    {a.retired ? ' · retired' : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="row voice-toggles">
              <label className="row voice-toggle">
                <input
                  type="checkbox"
                  checked={renderHtml}
                  onChange={(e) => setRenderHtml(e.target.checked)}
                />
                <span>Render HTML</span>
              </label>
              <label className="row voice-toggle">
                <input
                  type="checkbox"
                  checked={showRetired}
                  onChange={(e) => setShowRetired(e.target.checked)}
                />
                <span>Show retired</span>
              </label>
            </div>
          </div>

          {selectedAuthor && (
            <AuthorCard
              author={selectedAuthor}
              onOpenPerson={onOpenPerson}
              busy={busy === `author:${selectedAuthor.handle}`}
              confirmingDelete={confirming === `author:${selectedAuthor.handle}`}
              onToggleRetired={() => void toggleAuthorRetired(selectedAuthor)}
              onRequestDelete={() => setConfirming(`author:${selectedAuthor.handle}`)}
              onCancelDelete={() => setConfirming(null)}
              onConfirmDelete={() => void removeAuthor(selectedAuthor)}
            />
          )}

          {loadingTweets && tweets.length === 0 ? (
            <p className="muted">Loading tweets…</p>
          ) : tweets.length === 0 ? (
            <p className="muted">No saved tweets match these filters.</p>
          ) : (
            <ul className="voice-tweet-list">
              {tweets.map((t) => (
                <li key={t.tweetId}>
                  <TweetRow
                    tweet={t}
                    settings={settings}
                    onSaveTags={(tags) => saveTweetTags(t, tags)}
                    renderHtml={renderHtml}
                    busy={busy === `tweet:${t.tweetId}`}
                    extractBusy={busy === `extract:${t.tweetId}`}
                    confirmingDelete={confirming === `tweet:${t.tweetId}`}
                    onToggleRetired={() => void toggleTweetRetired(t)}
                    onRequestDelete={() => setConfirming(`tweet:${t.tweetId}`)}
                    onCancelDelete={() => setConfirming(null)}
                    onConfirmDelete={() => void removeTweet(t)}
                    onExtract={() => void extractTweet(t)}
                    onRemix={() => onRemix(t.tweetId)}
                    onOpenPerson={onOpenPerson}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

interface AuthorCardProps {
  author: VoiceAuthor;
  onOpenPerson: (handle: string) => void;
  busy: boolean;
  confirmingDelete: boolean;
  onToggleRetired: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function AuthorCard({
  author,
  onOpenPerson,
  busy,
  confirmingDelete,
  onToggleRetired,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: AuthorCardProps): JSX.Element {
  return (
    <div className="author-card">
      <div className="author-head">
        <span className="author-name">{author.displayName || `@${author.handle}`}</span>
        <button
          type="button"
          className="author-handle person-link"
          title="Open dossier"
          onClick={() => onOpenPerson(author.handle)}
        >
          @{author.handle}
        </button>
        <a
          className="author-handle"
          href={`https://x.com/${author.handle}`}
          target="_blank"
          rel="noreferrer"
          title="Open profile on X"
        >
          ↗
        </a>
        {author.enrichedAt ? (
          <span className="badge badge-tracked">enriched</span>
        ) : (
          <span className="badge badge-auto">tweet-only</span>
        )}
        {author.retired && <span className="badge badge-paused">retired</span>}
      </div>

      <div className="author-meta">
        {fmtCount(author.followersCount)} followers · {fmtCount(author.followingCount)} following ·{' '}
        {author.tweetCount} saved
      </div>

      {author.bio && <div className="author-bio">{author.bio}</div>}

      {author.pinnedTweetText && <div className="author-pinned">📌 {author.pinnedTweetText}</div>}

      <div className="row">
        <button type="button" onClick={onToggleRetired} disabled={busy}>
          {busy ? '…' : author.retired ? 'Unretire' : 'Retire'}
        </button>
        {confirmingDelete ? (
          <>
            <button type="button" className="danger" onClick={onConfirmDelete} disabled={busy}>
              {busy ? 'Deleting…' : 'Confirm delete'}
            </button>
            <button type="button" onClick={onCancelDelete} disabled={busy}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="danger"
            onClick={onRequestDelete}
            disabled={busy}
            title="Delete author (only works once their saved tweets are gone)"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

interface TweetRowProps {
  tweet: VoiceTweet;
  settings: Settings;
  onSaveTags: (tags: string[]) => Promise<void>;
  onOpenPerson: (handle: string) => void;
  renderHtml: boolean;
  busy: boolean;
  extractBusy: boolean;
  confirmingDelete: boolean;
  onToggleRetired: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onExtract: () => void;
  onRemix: () => void;
}

function TweetRow({
  tweet,
  settings,
  onSaveTags,
  onOpenPerson,
  renderHtml,
  busy,
  extractBusy,
  confirmingDelete,
  onToggleRetired,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onExtract,
  onRemix,
}: TweetRowProps): JSX.Element {
  const url = tweet.url ?? `https://x.com/${tweet.authorHandle}/status/${tweet.tweetId}`;
  const hasHtml = renderHtml && tweet.scrapedHtml;

  return (
    <div className={`voice-tweet${tweet.retired ? ' voice-tweet-retired' : ''}`}>
      <div className="voice-tweet-head">
        <button
          type="button"
          className="voice-tweet-author person-link"
          title="Open dossier"
          onClick={() => onOpenPerson(tweet.authorHandle)}
        >
          {tweet.authorDisplayName ? `${tweet.authorDisplayName} ` : ''}@{tweet.authorHandle}
        </button>
        <span className="voice-tweet-time">
          {new Date(tweet.createdAt).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </span>
      </div>

      {hasHtml ? (
        // Captured from x.com — the user's own swipe file, rendered to preserve
        // emoji and formatting exactly as X showed it.
        <div
          className="voice-tweet-text"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, user-captured x.com markup
          dangerouslySetInnerHTML={{ __html: tweet.scrapedHtml as string }}
        />
      ) : (
        <div className="voice-tweet-text">{tweet.text || <em className="muted">(no text)</em>}</div>
      )}

      {tweet.templateExtractedAt && (
        <div className="voice-tweet-template muted">
          {[
            tweet.hookType,
            tweet.skeleton,
            tweet.lineBreakPattern,
            tweet.templateLength,
            tweet.device,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      )}

      <ChannelTagPicker
        settings={settings}
        tags={tweet.tags}
        onSave={onSaveTags}
        suggestFrom={tweet.text}
      />

      <div className="voice-tweet-actions">
        <a href={url} target="_blank" rel="noreferrer">
          open ↗
        </a>
        <button type="button" onClick={onRemix} title="Send this structure to the Composer drafter">
          remix
        </button>
        <button type="button" onClick={onExtract} disabled={extractBusy}>
          {extractBusy ? '…' : tweet.templateExtractedAt ? 're-extract' : 'extract'}
        </button>
        <button type="button" onClick={onToggleRetired} disabled={busy}>
          {busy ? '…' : tweet.retired ? 'unretire' : 'retire'}
        </button>
        {confirmingDelete ? (
          <>
            <button type="button" className="danger" onClick={onConfirmDelete} disabled={busy}>
              {busy ? 'deleting…' : 'confirm'}
            </button>
            <button type="button" onClick={onCancelDelete} disabled={busy}>
              cancel
            </button>
          </>
        ) : (
          <button type="button" className="danger" onClick={onRequestDelete} disabled={busy}>
            delete
          </button>
        )}
      </div>
    </div>
  );
}

function fmtCount(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
