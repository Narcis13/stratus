// The Today tab (OVERHAUL-PLAN §6.4): the growth-coach surface. One GET
// /x/brief render — follower trend, today's slots + gaps, reply quota,
// yesterday's numbers, and spend, so opening the panel answers "what do I
// do next" without clicking around. Plus the Radar (§7.2): the session's
// hot/warm reply opportunities, fed by the content script, $0.

import { type JSX, useCallback, useEffect, useState } from 'react';
import { InboxSection } from './Inbox.tsx';
import { RadarSection } from './Radar.tsx';
import { TargetsSection } from './Targets.tsx';
import { ApiError, type Brief, type BriefTweet, api } from './api.ts';
import { formatTime } from './datetime.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
}

export function TodayPanel({ settings }: Props): JSX.Element {
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

      {/* Mention inbox (§7.5) — the 75x chain: people who replied to me. */}
      <InboxSection settings={settings} />

      {/* Session-local (chrome.storage.session), independent of the brief fetch. */}
      <RadarSection />

      {/* The 2–10x reply-target roster (§7.4) — its own $0 fetch. */}
      <TargetsSection settings={settings} />

      {brief && (
        <>
          <FollowersCard brief={brief} />
          <TodayPlan brief={brief} />
          <ReplyQuota brief={brief} />
          <Yesterday brief={brief} />
          <Leaders settings={settings} tweets={brief.yesterday.profileClickLeaders} />
          <SpendLine brief={brief} />
        </>
      )}
    </div>
  );
}

function FollowersCard({ brief }: { brief: Brief }): JSX.Element {
  const { followers, delta7d, sparkline } = brief.account;
  return (
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
              <span className="post-text">{p.text}</span>
            </li>
          ))}
        </ul>
      )}
      {gaps.length > 0 ? (
        <div className="warn">No post slotted for {gaps.map(fmtHour).join(', ')}.</div>
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
}: {
  settings: Settings;
  tweets: BriefTweet[];
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

function fmtHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}
