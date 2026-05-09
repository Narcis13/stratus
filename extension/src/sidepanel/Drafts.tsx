import { type JSX, useCallback, useEffect, useState } from 'react';
import { ApiError, type ScheduledPost, api } from './api.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
  onEdit: (id: string) => void;
}

export function DraftsPanel({ settings, onEdit }: Props): JSX.Element {
  const [drafts, setDrafts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.list(settings, { status: 'draft' });
      setDrafts(rows);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load');
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
        <h2>Drafts</h2>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {drafts.length === 0 && !loading ? (
        <p className="muted">No drafts. Compose one and leave the time empty to save it here.</p>
      ) : (
        <ul className="draft-list">
          {drafts.map((d) => (
            <li key={d.id}>
              <button type="button" className="draft-row" onClick={() => onEdit(d.id)}>
                <span className="draft-text">{d.text}</span>
                <span className="draft-meta">
                  updated {new Date(d.updatedAt).toLocaleString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
