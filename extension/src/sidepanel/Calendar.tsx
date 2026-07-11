import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, type ScheduledPost, api } from './api.ts';
import {
  addDays,
  formatDayLabel,
  formatTime,
  isSameLocalDay,
  startOfLocalDay,
} from './datetime.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
  onEdit: (id: string) => void;
}

export function CalendarPanel({ settings, onEdit }: Props): JSX.Element {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => {
    const today = startOfLocalDay(new Date());
    return Array.from({ length: 7 }, (_, i) => addDays(today, i));
  }, []);

  const [drafts, setDrafts] = useState<ScheduledPost[]>([]);

  const load = useCallback(async () => {
    const first = days[0];
    const last = days[6];
    if (!first || !last) return;
    setLoading(true);
    setError(null);
    try {
      const from = first.toISOString();
      const to = addDays(last, 1).toISOString();
      const [rows, draftRows] = await Promise.all([
        api.list(settings, { from, to }),
        // Unscheduled drafts (incl. §8.1 drafter output) have no scheduled_for,
        // so the day-window query above never returns them.
        api.list(settings, { status: 'draft' }),
      ]);
      setPosts(rows);
      setDrafts(draftRows.filter((d) => !d.scheduledFor));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [settings, days]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Calendar</h2>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="day-list">
        {days.map((day) => {
          const dayPosts = posts
            .filter((p) => p.scheduledFor && isSameLocalDay(new Date(p.scheduledFor), day))
            .sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''));
          const isToday = isSameLocalDay(day, new Date());
          return (
            <div key={day.toISOString()} className={`day-card${isToday ? ' day-today' : ''}`}>
              <div className="day-header">
                <span className="day-label">{formatDayLabel(day)}</span>
                <span className="day-count">{dayPosts.length}</span>
              </div>
              {dayPosts.length === 0 ? (
                <div className="day-empty">—</div>
              ) : (
                <ul className="post-list">
                  {dayPosts.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={`post-row status-${p.status}`}
                        onClick={() => onEdit(p.id)}
                      >
                        <span className="post-time">{formatTime(p.scheduledFor)}</span>
                        <span className={`badge badge-${p.status}`}>{p.status}</span>
                        {p.threadId && <span className="badge">🧵</span>}
                        {p.quoteTweetId && <span className="badge">re-up</span>}
                        {p.mediaNote && (
                          <span
                            className="badge badge-media"
                            title={`${p.mediaNote} — post manually with its visual (the API can't attach images)`}
                          >
                            visual
                          </span>
                        )}
                        {p.pillar && <span className="badge badge-pillar">{p.pillar}</span>}
                        <span className="post-text">{p.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {drafts.length > 0 && (
        <div className="day-card">
          <div className="day-header">
            <span className="day-label">Drafts (unscheduled)</span>
            <span className="day-count">{drafts.length}</span>
          </div>
          <ul className="post-list">
            {drafts.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`post-row status-${p.status}`}
                  onClick={() => onEdit(p.id)}
                >
                  <span className={`badge badge-${p.status}`}>{p.status}</span>
                  {p.threadId && <span className="badge">🧵</span>}
                  {p.quoteTweetId && <span className="badge">re-up</span>}
                  {p.mediaNote && (
                    <span
                      className="badge badge-media"
                      title={`${p.mediaNote} — post manually with its visual (the API can't attach images)`}
                    >
                      visual
                    </span>
                  )}
                  {p.pillar && <span className="badge badge-pillar">{p.pillar}</span>}
                  <span className="post-text">{p.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
