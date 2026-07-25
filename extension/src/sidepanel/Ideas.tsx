// Idea Inbox (CIRCLES-PLAN C6): quick-add capture + the lifecycle view. Ideas
// arrive here from this quick-add or the "Send selection to stratus ideas"
// context menu; they get consumed by the Composer drafter or Reply Master (the
// server stamps status + backlink), and a consumed idea reopens in one click.

import { type FormEvent, type JSX, useCallback, useEffect, useState } from 'react';
import { ChannelTagPicker } from './ChannelTags.tsx';
import { ApiError, type Idea, type IdeaProposal, type IdeaStatus, api } from './api.ts';
import { ideaChip } from './chips.ts';
import type { Settings } from './storage.ts';
import { EmptyState } from './ui/EmptyState.tsx';
import { Section } from './ui/Section.tsx';
import { type SubTab, SubTabs } from './ui/SubTabs.tsx';

interface Props {
  settings: Settings;
}

// The lifecycle IS the filter, so it reads as a segmented control rather than a
// labelled <select> tucked under the generator.
const FILTERS: SubTab<IdeaStatus | 'all'>[] = [
  { id: 'open', label: 'Open' },
  { id: 'consumed', label: 'Consumed' },
  { id: 'discarded', label: 'Discarded' },
  { id: 'all', label: 'All' },
];

const CONSUMER_LABEL: Record<string, string> = {
  reply_drafts: 'a reply draft',
  scheduled_posts: 'a post draft',
};

export function IdeasPanel({ settings }: Props): JSX.Element {
  const [filter, setFilter] = useState<IdeaStatus | 'all'>('open');
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // AI.9 — the idea generator: an optional steer, the returned proposals, and a
  // per-row Save (existing POST /x/ideas, tagged 'ai'). Nothing persists until a
  // proposal is saved; skipping just drops it from the local list.
  const [steer, setSteer] = useState('');
  const [generating, setGenerating] = useState(false);
  const [proposals, setProposals] = useState<IdeaProposal[]>([]);
  const [genError, setGenError] = useState<string | null>(null);
  const [savingText, setSavingText] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setIdeas(await api.ideas.list(settings, { status: filter }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load ideas');
    } finally {
      setLoading(false);
    }
  }, [settings, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const onAdd = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const trimmed = text.trim();
    if (trimmed === '') return;
    setAdding(true);
    setError(null);
    try {
      await api.ideas.create(settings, { text: trimmed });
      setText('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Add failed');
    } finally {
      setAdding(false);
    }
  };

  const patchStatus = async (idea: Idea, status: IdeaStatus): Promise<void> => {
    setBusyId(idea.id);
    setError(null);
    try {
      await api.ideas.patch(settings, idea.id, { status });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  // C8 — channel tags; local update, no reload (tags don't change the filter).
  const saveTags = async (idea: Idea, tags: string[]): Promise<void> => {
    const updated = await api.ideas.patch(settings, idea.id, { tags });
    setIdeas((prev) => prev.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)));
  };

  const onGenerate = async (): Promise<void> => {
    setGenerating(true);
    setGenError(null);
    try {
      const trimmed = steer.trim();
      const res = await api.ideas.generate(settings, trimmed !== '' ? { steer: trimmed } : {});
      setProposals(res.ideas);
      if (res.ideas.length === 0) setGenError('No ideas came back — try a steer.');
    } catch (e) {
      setGenError(e instanceof ApiError ? e.message : 'Generate failed');
    } finally {
      setGenerating(false);
    }
  };

  const saveProposal = async (p: IdeaProposal): Promise<void> => {
    setSavingText(p.text);
    setGenError(null);
    try {
      await api.ideas.create(settings, { text: p.text, tags: ['ai'] });
      setProposals((prev) => prev.filter((x) => x !== p));
      await load();
    } catch (e) {
      setGenError(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setSavingText(null);
    }
  };

  const skipProposal = (p: IdeaProposal): void => {
    setProposals((prev) => prev.filter((x) => x !== p));
  };

  const onDelete = async (idea: Idea): Promise<void> => {
    if (!confirm('Delete this idea permanently?')) return;
    setBusyId(idea.id);
    setError(null);
    try {
      await api.ideas.remove(settings, idea.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Ideas</h2>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <Section title="Quick add">
        <form onSubmit={onAdd}>
          <label className="field">
            <span>Quick add (Romanian welcome)</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="A seed for a future post or reply — one idea per entry."
            />
          </label>
          <div className="row">
            <button type="submit" className="primary" disabled={adding || text.trim() === ''}>
              {adding ? 'Adding…' : 'Add idea'}
            </button>
            <small className="muted">
              Tip: select text on any page → right-click → "Send selection to stratus ideas".
            </small>
          </div>
        </form>
      </Section>

      {error && <div className="error">{error}</div>}

      <Section title="Generate with AI">
        <label className="field">
          <span>Generate ideas with AI (optional steer — Romanian welcome)</span>
          <textarea
            value={steer}
            onChange={(e) => setSteer(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Optional theme or angle. Leave empty for a spread across your pillars."
          />
        </label>
        <div className="row">
          <button type="button" onClick={() => void onGenerate()} disabled={generating}>
            {generating ? 'Generating…' : 'Generate ideas'}
          </button>
          <small className="muted">
            Grounds on your pillars + measured winners. Nothing saves until you pick.
          </small>
        </div>
        {genError && <div className="error">{genError}</div>}
        {proposals.length > 0 && (
          <ul className="voice-tweet-list">
            {proposals.map((p) => (
              <li key={`${p.angle}:${p.text}`} className="voice-tweet">
                <div className="voice-tweet-head">
                  {p.pillar && <span className="chip chip-accent">{p.pillar}</span>}
                  <span className="chip">{p.angle}</span>
                </div>
                <div className="voice-tweet-text">{p.text}</div>
                <div className="row">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void saveProposal(p)}
                    disabled={savingText === p.text}
                  >
                    {savingText === p.text ? 'Saving…' : 'Save to inbox'}
                  </button>
                  <button
                    type="button"
                    onClick={() => skipProposal(p)}
                    disabled={savingText === p.text}
                  >
                    Skip
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <SubTabs tabs={FILTERS} active={filter} onSelect={setFilter} />

      <Section title={`Inbox (${ideas.length})`}>
        {loading && ideas.length === 0 ? (
          <p className="muted">Loading…</p>
        ) : ideas.length === 0 ? (
          <EmptyState
            line={filter === 'open' ? 'No open ideas.' : 'Nothing in this state.'}
            hint={
              filter === 'open'
                ? 'Open ideas appear as dropdown seeds in the Composer and Reply Master — an empty inbox means nothing is waiting to be written.'
                : 'Pick another state above. An idea moves to consumed when a drafter uses it, and discarded is always reversible.'
            }
          />
        ) : (
          <ul className="voice-tweet-list">
            {ideas.map((idea) => (
              <li key={idea.id} className="voice-tweet">
                <div className="voice-tweet-head">
                  <span className={ideaChip(idea.status)}>{idea.status}</span>
                  <span className="voice-tweet-time">{relativeTime(idea.createdAt)}</span>
                </div>
                <div className="voice-tweet-text">{idea.text}</div>
                <ChannelTagPicker
                  settings={settings}
                  tags={idea.tags}
                  onSave={(tags) => saveTags(idea, tags)}
                  suggestFrom={idea.text}
                />
                <div className="voice-tweet-metrics">
                  {idea.sourceUrl && (
                    <a href={idea.sourceUrl} target="_blank" rel="noreferrer">
                      source →
                    </a>
                  )}
                  {idea.status === 'consumed' && idea.consumedByTable && (
                    <span className="muted">
                      seeded {CONSUMER_LABEL[idea.consumedByTable] ?? idea.consumedByTable}
                    </span>
                  )}
                </div>
                <div className="row">
                  {idea.status !== 'open' && (
                    <button
                      type="button"
                      onClick={() => void patchStatus(idea, 'open')}
                      disabled={busyId === idea.id}
                    >
                      Reopen
                    </button>
                  )}
                  {idea.status === 'open' && (
                    <button
                      type="button"
                      onClick={() => void patchStatus(idea, 'discarded')}
                      disabled={busyId === idea.id}
                    >
                      Discard
                    </button>
                  )}
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void onDelete(idea)}
                    disabled={busyId === idea.id}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}
