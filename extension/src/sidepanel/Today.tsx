// The Today tab (OVERHAUL-PLAN §6.4): the growth-coach surface. One GET
// /x/brief render — follower trend, today's slots + gaps, reply quota,
// yesterday's numbers, and spend, so opening the panel answers "what do I
// do next" without clicking around. Plus the Radar (§7.2): the session's
// hot/warm reply opportunities, fed by the content script, $0.

import { type JSX, useCallback, useEffect, useState } from 'react';
import { ConversationsSection } from './Conversations.tsx';
import { DigestSection } from './Digest.tsx';
import { DoNextSection } from './DoNext.tsx';
import { FansSection } from './Fans.tsx';
import { LaunchRoomSection } from './LaunchRoom.tsx';
import { RadarSection } from './Radar.tsx';
import { TargetsSection } from './Targets.tsx';
import {
  ApiError,
  type Brief,
  type BriefQuests,
  type BriefTweet,
  type ConversionWindow,
  api,
} from './api.ts';
import { formatTime } from './datetime.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
  /** C1: open a handle's dossier in the People tab. */
  onOpenPerson: (handle: string) => void;
  /** S3: open the Studio's quote card seeded with this text. */
  onMakeVisual: (text: string) => void;
}

export function TodayPanel({ settings, onOpenPerson, onMakeVisual }: Props): JSX.Element {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBrief(await api.brief(settings));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load brief');
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Today</h2>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {/* Launch Room (C7) — takes the top slot for 30 min after a scheduled
          post fires; renders nothing outside that window. */}
      <LaunchRoomSection settings={settings} onOpenPerson={onOpenPerson} />

      {/* Today's quests + streak (C9) — gentle checkmarks, never guilt. */}
      {brief?.quests && <QuestsSection quests={brief.quests} />}

      {/* The follow-up queue (C5), capped at 5 — who do I owe, who to
          nurture, who's heating up. */}
      <DoNextSection settings={settings} onOpenPerson={onOpenPerson} />

      {/* Threaded inbox (C2) — conversations with open loops and chains first.
          Supersedes the flat §7.5 mention list. */}
      <ConversationsSection settings={settings} onOpenPerson={onOpenPerson} />

      {/* Session-local (chrome.storage.session), independent of the brief fetch. */}
      <RadarSection settings={settings} onOpenPerson={onOpenPerson} />

      {/* The 2–10x reply-target roster (§7.4) — its own $0 fetch. */}
      <TargetsSection settings={settings} onOpenPerson={onOpenPerson} />

      {/* Top Fans (C5) — people who already notice you. */}
      <FansSection settings={settings} onOpenPerson={onOpenPerson} />

      {brief && (
        <>
          <FollowersCard brief={brief} />
          <PinnedWatchCard brief={brief} />
          <TodayPlan brief={brief} />
          <ReplyQuota brief={brief} />
          <Yesterday brief={brief} />
          <Leaders
            settings={settings}
            tweets={brief.yesterday.profileClickLeaders}
            onMakeVisual={onMakeVisual}
          />
          <SpendLine brief={brief} />
        </>
      )}

      {/* Sunday Digest (C9) — auto on Sundays, on demand the rest of the week. */}
      <DigestSection settings={settings} />
    </div>
  );
}

function QuestsSection({ quests }: { quests: BriefQuests }): JSX.Element {
  const hit = quests.items.filter((q) => q.done).length;
  return (
    <section className="brief-section">
      <h3>
        Today's quests
        <span className="quest-streak">
          {quests.streak.current > 0
            ? ` · ${quests.streak.current}-day streak`
            : hit === quests.items.length
              ? ' · streak starts today'
              : ''}
        </span>
      </h3>
      <ul className="quest-list">
        {quests.items.map((q) => (
          <li key={q.key} className={`quest-row${q.done ? ' quest-done' : ''}`}>
            <span className="quest-mark">{q.done ? '✓' : '○'}</span>
            <span className="quest-label">{q.label}</span>
            <span className="quest-progress muted">
              {q.note ?? (q.target > 0 ? `${q.n}/${q.target}` : '')}
            </span>
          </li>
        ))}
      </ul>
      {hit === quests.items.length && (
        <div className="ok">All done — the rest of the day is yours.</div>
      )}
    </section>
  );
}

function FollowersCard({ brief }: { brief: Brief }): JSX.Element {
  const { followers, delta7d, sparkline, conversion } = brief.account;
  return (
    <>
      <div className="brief-kpi">
        <div>
          <div className="brief-followers">{followers === null ? '—' : fmtNum(followers)}</div>
          <div className="brief-kpi-label">
            followers
            {delta7d !== null && (
              <span className={`brief-delta ${delta7d >= 0 ? 'up' : 'down'}`}>
                {delta7d >= 0 ? '+' : ''}
                {delta7d} / 7d
              </span>
            )}
          </div>
        </div>
        <Sparkline points={sparkline.map((p) => p.followers)} />
      </div>
      <ConversionLine conversion={conversion} />
    </>
  );
}

// S0.1: "is my profile leaking?" — earned visits → follows. Shows the 7d line
// when it clears the 20-click gate, with the 28d rate trailing when present.
function ConversionLine({
  conversion,
}: {
  conversion: { d7: ConversionWindow; d28: ConversionWindow } | undefined;
}): JSX.Element | null {
  // Absent when the server predates S0.1 — render nothing rather than crash.
  if (!conversion) return null;
  const { d7, d28 } = conversion;
  if (d7.rate === null && d28.rate === null) return null;
  const primary = d7.rate !== null ? d7 : d28;
  return (
    <div className="brief-conversion muted">
      {fmtNum(primary.profileClicks)} profile visits →{' '}
      <span
        className={`brief-delta ${primary.followerDelta !== null && primary.followerDelta < 0 ? 'down' : 'up'}`}
      >
        {(primary.followerDelta ?? 0) >= 0 ? '+' : ''}
        {primary.followerDelta} followers
      </span>{' '}
      · {fmtPct(primary.rate)}{' '}
      <span className="brief-conversion-window">{primary.windowDays}d</span>
      {primary === d7 && d28.rate !== null && <span> · {fmtPct(d28.rate)} 28d</span>}
    </div>
  );
}

// S0.9: profile visits land on the pinned tweet — warn when that first
// impression has gone stale (unchanged >21d) or been out-performed by a recent
// post. Nothing renders until there's an actual nudge to make. Pinning is
// manual in the X app, so both messages point at the tweet to re-pin.
function PinnedWatchCard({ brief }: { brief: Brief }): JSX.Element | null {
  const w = brief.pinnedWatch;
  if (!w || !w.pinnedTweetId || (!w.stale && !w.outperformer)) return null;
  const pinnedUrl = `https://x.com/i/web/status/${w.pinnedTweetId}`;
  return (
    <section className="brief-section">
      <h3>Pinned post</h3>
      <div className="warn">
        {w.stale && (
          <div>
            Your pin hasn't changed in <strong>{w.ageDays}</strong> days — profile visitors land
            here first.{' '}
            <a href={pinnedUrl} target="_blank" rel="noreferrer">
              See the pinned tweet
            </a>
            .
          </div>
        )}
        {w.outperformer && (
          <div className="brief-pin-outperformer">
            <div>
              Your best work isn't pinned — a recent post has{' '}
              <strong>{w.outperformer.ratio}×</strong> the pinned tweet's views (
              {fmtNum(w.outperformer.views)} vs {fmtNum(w.pinnedViews)}).
            </div>
            <div className="brief-tweet-text">{w.outperformer.text}</div>
            <a
              href={`https://x.com/i/web/status/${w.outperformer.tweetId}`}
              target="_blank"
              rel="noreferrer"
            >
              Open it, then pin it
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

function Sparkline({ points }: { points: number[] }): JSX.Element | null {
  if (points.length < 2) return null;
  const w = 120;
  const h = 32;
  const pad = 2;
  const min = Math.min(...points);
  const span = Math.max(...points) - min || 1;
  const coords = points
    .map((v, i) => {
      const x = pad + (i / (points.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((v - min) / span) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg className="brief-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img">
      <title>Follower trend, last {points.length} snapshots</title>
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function TodayPlan({ brief }: { brief: Brief }): JSX.Element {
  const { scheduled, gaps, anchors } = brief.today;
  return (
    <section className="brief-section">
      <h3>Today's plan</h3>
      {scheduled.length === 0 ? (
        <div className="muted">Nothing scheduled today.</div>
      ) : (
        <ul className="post-list brief-plan">
          {scheduled.map((p) => (
            <li key={p.id} className="post-row brief-plan-row">
              <span className="post-time">{formatTime(p.scheduledFor)}</span>
              <span className={`badge badge-${p.status}`}>{p.status}</span>
              {p.mediaNote && (
                <span
                  className="badge badge-media"
                  title={`${p.mediaNote} — the API can't attach images; paste the PNG when this posts`}
                >
                  visual
                </span>
              )}
              <span className="post-text">{p.text}</span>
            </li>
          ))}
        </ul>
      )}
      {gaps.length > 0 ? (
        <div className="warn brief-gaps-wrap">
          <div>
            {gaps.length === 1 ? 'Open slot' : `${gaps.length} open slots`} — highest-value first:
          </div>
          <ul className="brief-gaps">
            {gaps.map((g) => (
              <li key={g.hour} className="brief-gap-row">
                <span className="post-time">{fmtHour(g.hour)}</span>
                {g.sufficient ? (
                  <span className="brief-gap-score">
                    <strong>{fmtNum(g.avgViewsPerDay ?? g.avgViews)}</strong> avg views/day
                    <span className="muted"> · n={g.n}</span>
                  </span>
                ) : (
                  <span className="muted">no data (n={g.n})</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="ok">All {anchors.length} slots filled.</div>
      )}
    </section>
  );
}

function ReplyQuota({ brief }: { brief: Brief }): JSX.Element {
  const { postedToday, target } = brief.replyQuota;
  const { posts, replies, replyPct, targetReplyPct } = brief.week;
  const pct = Math.min(100, (postedToday / target.min) * 100);
  return (
    <section className="brief-section">
      <h3>Replies</h3>
      <div className="brief-quota">
        <div className="brief-quota-bar">
          <div
            className={`brief-quota-fill${postedToday >= target.min ? ' met' : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="brief-quota-label">
          {postedToday} / {target.min}–{target.max} today
        </span>
      </div>
      <div className="status-line">
        Week: <strong>{replies}</strong> replies · <strong>{posts}</strong> posts
        {replyPct !== null && ` — ${replyPct}% replies (target ${targetReplyPct}%)`}
      </div>
    </section>
  );
}

function Yesterday({ brief }: { brief: Brief }): JSX.Element {
  const { posts, replies } = brief.yesterday;
  return (
    <section className="brief-section">
      <h3>Yesterday</h3>
      {posts.length === 0 && replies.length === 0 ? (
        <div className="muted">Nothing published yesterday.</div>
      ) : (
        <>
          {posts.length > 0 && <TweetList label={`Posts (${posts.length})`} tweets={posts} />}
          {replies.length > 0 && (
            <TweetList label={`Replies (${replies.length})`} tweets={replies} />
          )}
        </>
      )}
    </section>
  );
}

function Leaders({
  settings,
  tweets,
  onMakeVisual,
}: {
  settings: Settings;
  tweets: BriefTweet[];
  onMakeVisual: (text: string) => void;
}): JSX.Element | null {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (tweets.length === 0) return null;

  // §8.5 — quote-tweet re-up of a proven winner, drafted by the §8.1 pipeline.
  // Drafts land in the calendar; nothing posts without a human scheduling one.
  const reup = async (tweetId: string): Promise<void> => {
    setBusyId(tweetId);
    setNote(null);
    try {
      const res = await api.drafts.reup(settings, { tweetId });
      setNote(`${res.drafts.length} quote drafts in the calendar ($${res.costUsd.toFixed(4)}).`);
    } catch (e) {
      setNote(e instanceof ApiError ? `Re-up failed: ${e.message}` : 'Re-up failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="brief-section">
      <h3>Profile click leaders (7d)</h3>
      {note && <div className="status-line">{note}</div>}
      <ul className="brief-tweets">
        {tweets.map((t) => (
          <li key={t.tweetId} className="brief-tweet">
            <div className="brief-tweet-text">{t.text}</div>
            <div className="brief-tweet-metrics">
              <strong>{fmtNum(t.metrics?.profileVisits ?? 0)} profile visits</strong>
              <span>{fmtNum(t.metrics?.views ?? null)} views</span>
              <span>{t.isReply ? 'reply' : 'post'}</span>
              {!t.isReply && (
                <button
                  type="button"
                  onClick={() => void reup(t.tweetId)}
                  disabled={busyId === t.tweetId}
                  title="Quote it with a new take — drafts land in the calendar"
                >
                  {busyId === t.tweetId ? '…' : 'quote re-up'}
                </button>
              )}
              {!t.isReply && (
                <button
                  type="button"
                  onClick={() => onMakeVisual(t.text)}
                  title="Frame the winner as a branded quote card — quote-tweet + card is the strongest re-up format"
                >
                  visual
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TweetList({ label, tweets }: { label: string; tweets: BriefTweet[] }): JSX.Element {
  return (
    <div className="brief-tweet-group">
      <div className="brief-tweet-group-label">{label}</div>
      <ul className="brief-tweets">
        {tweets.map((t) => (
          <li key={t.tweetId} className="brief-tweet">
            <div className="brief-tweet-text">{t.text}</div>
            {t.metrics ? (
              <div className="brief-tweet-metrics">
                <span>{fmtNum(t.metrics.views)} views</span>
                <span>{fmtNum(t.metrics.likes)} likes</span>
                <span>{fmtNum(t.metrics.replies)} replies</span>
                <span>{fmtNum(t.metrics.profileVisits)} profile visits</span>
              </div>
            ) : (
              <div className="brief-tweet-metrics muted">awaiting 03:00 UTC snapshot</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SpendLine({ brief }: { brief: Brief }): JSX.Element {
  const { xUsd, grokUsd, totalUsd } = brief.spend;
  return (
    <section className="brief-section">
      <h3>Spend today (UTC)</h3>
      <div className="brief-spend">
        X <strong>{fmtUsd(xUsd)}</strong> · Grok <strong>{fmtUsd(grokUsd)}</strong> · total{' '}
        <strong>{fmtUsd(totalUsd)}</strong>
      </div>
    </section>
  );
}

function fmtNum(n: number | null): string {
  if (n === null) return '–';
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function fmtPct(rate: number | null): string {
  if (rate === null) return '–';
  return `${(rate * 100).toFixed(1)}%`;
}

function fmtHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}
