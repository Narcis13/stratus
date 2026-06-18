import { type JSX, useCallback, useEffect, useState } from 'react';
import { ApiError, type ContentPillar, api } from './api.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
}

const ERR: Record<string, string> = {
  last_active_pillar: "Can't remove the last active pillar — keep at least one.",
  slug_exists: 'A pillar with that slug already exists.',
  invalid_slug: 'Slug must be lowercase letters, numbers and hyphens (2–41 chars).',
  invalid_label_or_body: 'Label and body are both required.',
  grok_not_configured: 'AI drafting is unavailable (server has no XAI_API_KEY).',
  not_found: 'Pillar not found.',
};

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return ERR[e.code] ?? `${e.code} (${e.status})`;
  return fallback;
}

export function PillarsPanel({ settings }: Props): JSX.Element {
  const [pillars, setPillars] = useState<ContentPillar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPillars(await api.pillars.list(settings));
    } catch (e) {
      setError(errMsg(e, 'Failed to load pillars'));
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = pillars.filter((p) => p.active).length;

  const onSaved = (updated: ContentPillar): void => {
    setPillars((prev) => prev.map((p) => (p.slug === updated.slug ? updated : p)));
  };
  const onDeleted = (slug: string): void => {
    setPillars((prev) => prev.filter((p) => p.slug !== slug));
  };
  const onCreated = (created: ContentPillar): void => {
    setPillars((prev) =>
      [...prev, created].sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug)),
    );
  };

  return (
    <div className="voice-pillars">
      <div className="row voice-pillars-head">
        <p className="muted">
          The post drafter writes against these. Edits change how Grok drafts — saved to the server.
        </p>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {loading && pillars.length === 0 ? (
        <p className="muted">Loading pillars…</p>
      ) : (
        <ul className="pillar-list">
          {pillars.map((p) => (
            <li key={p.slug}>
              <PillarCard
                pillar={p}
                settings={settings}
                isLastActive={p.active && activeCount <= 1}
                onSaved={onSaved}
                onDeleted={onDeleted}
              />
            </li>
          ))}
        </ul>
      )}

      <AddPillar settings={settings} onCreated={onCreated} />
    </div>
  );
}

interface CardProps {
  pillar: ContentPillar;
  settings: Settings;
  isLastActive: boolean;
  onSaved: (p: ContentPillar) => void;
  onDeleted: (slug: string) => void;
}

function PillarCard({
  pillar,
  settings,
  isLastActive,
  onSaved,
  onDeleted,
}: CardProps): JSX.Element {
  const [label, setLabel] = useState(pillar.label);
  const [body, setBody] = useState(pillar.body);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [tweakOpen, setTweakOpen] = useState(false);
  const [instruction, setInstruction] = useState('');

  // Re-sync local drafts when the row is replaced by a server response.
  useEffect(() => {
    setLabel(pillar.label);
    setBody(pillar.body);
  }, [pillar.label, pillar.body]);

  const dirty = label !== pillar.label || body !== pillar.body;

  const save = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      onSaved(
        await api.pillars.update(settings, pillar.slug, { label: label.trim(), body: body.trim() }),
      );
    } catch (e) {
      setErr(errMsg(e, 'Save failed'));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      onSaved(await api.pillars.update(settings, pillar.slug, { active: !pillar.active }));
    } catch (e) {
      setErr(errMsg(e, 'Update failed'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      await api.pillars.remove(settings, pillar.slug);
      onDeleted(pillar.slug);
    } catch (e) {
      setErr(errMsg(e, 'Delete failed'));
      setBusy(false);
      setConfirming(false);
    }
  };

  const aiTweak = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.pillars.draft(settings, {
        mode: 'tweak',
        slug: pillar.slug,
        ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
      });
      setLabel(res.proposal.label);
      setBody(res.proposal.body);
      setTweakOpen(false);
      setInstruction('');
    } catch (e) {
      setErr(errMsg(e, 'AI tweak failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`pillar-card${pillar.active ? '' : ' pillar-inactive'}`}>
      <div className="pillar-card-head">
        <code className="pillar-slug">{pillar.slug}</code>
        {!pillar.active && <span className="badge badge-paused">inactive</span>}
        {dirty && <span className="badge badge-auto">unsaved</span>}
      </div>

      <label className="field">
        <span>Label</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} spellCheck={false} />
      </label>

      <label className="field">
        <span>Body (guidance the drafter reads)</span>
        <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>

      {err && <div className="error">{err}</div>}

      {tweakOpen && (
        <div className="pillar-tweak">
          <input
            placeholder="How should AI change it? (optional, Romanian OK)"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <div className="row">
            <button type="button" onClick={() => void aiTweak()} disabled={busy}>
              {busy ? '…' : 'Draft revision'}
            </button>
            <button type="button" onClick={() => setTweakOpen(false)} disabled={busy}>
              cancel
            </button>
          </div>
        </div>
      )}

      <div className="pillar-card-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void save()}
          disabled={busy || !dirty}
        >
          {busy ? '…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => {
            setLabel(pillar.label);
            setBody(pillar.body);
          }}
          disabled={busy || !dirty}
        >
          Reset
        </button>
        <button type="button" onClick={() => setTweakOpen((v) => !v)} disabled={busy}>
          AI tweak
        </button>
        <button type="button" onClick={() => void toggleActive()} disabled={busy || isLastActive}>
          {pillar.active ? 'Deactivate' : 'Activate'}
        </button>
        {confirming ? (
          <>
            <button type="button" className="danger" onClick={() => void remove()} disabled={busy}>
              {busy ? '…' : 'Confirm'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy}>
              cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="danger"
            onClick={() => setConfirming(true)}
            disabled={busy || isLastActive}
            title={isLastActive ? 'Keep at least one active pillar' : 'Delete pillar'}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

interface AddProps {
  settings: Settings;
  onCreated: (p: ContentPillar) => void;
}

function AddPillar({ settings, onCreated }: AddProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [label, setLabel] = useState('');
  const [body, setBody] = useState('');
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = (): void => {
    setSlug('');
    setLabel('');
    setBody('');
    setIdea('');
    setErr(null);
  };

  const draftWithAi = async (): Promise<void> => {
    setAiBusy(true);
    setErr(null);
    try {
      const res = await api.pillars.draft(settings, {
        mode: 'new',
        ...(idea.trim() ? { idea: idea.trim() } : {}),
      });
      setSlug(res.proposal.slug);
      setLabel(res.proposal.label);
      setBody(res.proposal.body);
    } catch (e) {
      setErr(errMsg(e, 'AI draft failed'));
    } finally {
      setAiBusy(false);
    }
  };

  const create = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const created = await api.pillars.create(settings, {
        slug: slug.trim().toLowerCase(),
        label: label.trim(),
        body: body.trim(),
      });
      onCreated(created);
      reset();
      setOpen(false);
    } catch (e) {
      setErr(errMsg(e, 'Create failed'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="pillar-add-bar">
        <button type="button" onClick={() => setOpen(true)}>
          + Add pillar
        </button>
      </div>
    );
  }

  return (
    <div className="pillar-card pillar-add">
      <div className="pillar-card-head">
        <strong>New pillar</strong>
      </div>

      <div className="pillar-ai-row">
        <input
          placeholder="Idea for the AI to draft a new pillar (optional, Romanian OK)"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
        />
        <button type="button" onClick={() => void draftWithAi()} disabled={aiBusy}>
          {aiBusy ? 'Drafting…' : 'Draft with AI'}
        </button>
      </div>

      <label className="field">
        <span>Slug</span>
        <input
          placeholder="e.g. ai-craft"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span>Label</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} spellCheck={false} />
      </label>
      <label className="field">
        <span>Body</span>
        <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>

      {err && <div className="error">{err}</div>}

      <div className="pillar-card-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void create()}
          disabled={busy || !slug.trim() || !label.trim() || !body.trim()}
        >
          {busy ? '…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
