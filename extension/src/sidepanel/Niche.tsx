import { type JSX, useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  type Niche,
  type NicheActive,
  type NicheChannelProposal,
  type NicheDoctrine,
  type NichePatchBody,
  type NichePillarProposal,
  type NicheProposal,
  api,
} from './api.ts';
import { type Settings, getSettings } from './storage.ts';

// N0.7 — the Settings Niche card. The active niche grounds every post/reply
// draft and owns which pillars/channels are live; edits persist to the server
// (no deploy), exactly like §8.6 made pillars editable. Reuses pillar-card CSS.

const ERR: Record<string, string> = {
  slug_exists: 'A niche with that slug already exists.',
  invalid_slug: 'Slug must be lowercase letters, numbers and hyphens (2–41 chars).',
  invalid_label: 'Label is required.',
  invalid_persona: 'Persona is required.',
  invalid_beliefs: 'Beliefs are required.',
  invalid_reply_persona: 'Reply persona is required.',
  invalid_description: 'Description is too long.',
  invalid_doctrine: 'Doctrine values must be positive numbers.',
  last_active_niche: "Can't deactivate the only active niche — activate another first.",
  niche_active: "Can't delete the active niche — activate another first.",
  not_found: 'Niche not found.',
  grok_not_configured: 'The AI wizard needs XAI_API_KEY set on the server.',
  grok_parse_error: "The AI didn't return a usable niche — try again.",
  grok_upstream_error: 'The AI service is unavailable right now — try again.',
  draft_failed: 'The AI wizard failed — try again.',
};

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return ERR[e.code] ?? `${e.code} (${e.status})`;
  return fallback;
}

const DOCTRINE_FIELDS: { key: keyof NicheDoctrine; label: string }[] = [
  { key: 'replyTargetMin', label: 'Daily replies · min' },
  { key: 'replyTargetMax', label: 'Daily replies · max' },
  { key: 'weekReplyTargetPct', label: 'Weekly reply %' },
  { key: 'targetBandMinX', label: 'Target band · min ×' },
  { key: 'targetBandMaxX', label: 'Target band · max ×' },
];

type DoctrineStrings = Record<keyof NicheDoctrine, string>;

function doctrineToStrings(d: NicheDoctrine): DoctrineStrings {
  return {
    replyTargetMin: String(d.replyTargetMin),
    replyTargetMax: String(d.replyTargetMax),
    weekReplyTargetPct: String(d.weekReplyTargetPct),
    targetBandMinX: String(d.targetBandMinX),
    targetBandMaxX: String(d.targetBandMaxX),
  };
}

// Parse all 5 knobs; every one must be a finite positive number (the server's
// own acceptance rule). Returns the full object so a save sends all 5 (D27c —
// PATCH doctrine is replace, not merge).
function parseDoctrine(d: DoctrineStrings): NicheDoctrine | null {
  const out = {} as NicheDoctrine;
  for (const f of DOCTRINE_FIELDS) {
    const v = Number(d[f.key]);
    if (!Number.isFinite(v) || v <= 0) return null;
    out[f.key] = v;
  }
  return out;
}

export function NicheCard(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [active, setActive] = useState<NicheActive | null>(null);
  const [list, setList] = useState<Niche[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);

  const load = useCallback(async (s: Settings) => {
    setLoading(true);
    setError(null);
    try {
      const [a, l] = await Promise.all([api.niche.get(s), api.niche.list(s)]);
      setActive(a);
      setList(l);
    } catch (e) {
      setError(errMsg(e, 'Failed to load niche'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (settings) void load(settings);
  }, [settings, load]);

  if (!settings) {
    return (
      <section className="panel">
        <h2>Niche</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }

  const refresh = (): void => {
    void load(settings);
  };

  return (
    <section className="panel">
      <h2>Niche</h2>
      <p className="muted">
        The active niche grounds every post and reply draft, and owns which pillars and channels are
        in play. Editing it changes drafting server-side — no deploy.
      </p>

      {error && <div className="error">{error}</div>}

      {active && <ActiveNicheEditor settings={settings} active={active} onSaved={refresh} />}

      <h3 style={{ marginTop: 20 }}>All niches</h3>
      {loading && list.length === 0 ? (
        <p className="muted">Loading niches…</p>
      ) : list.length === 0 ? (
        <p className="muted">No niches yet.</p>
      ) : (
        <ul className="pillar-list">
          {list.map((n) => (
            <li key={n.slug}>
              <NicheRow
                settings={settings}
                niche={n}
                isActive={n.slug === active?.niche.slug}
                onChanged={refresh}
              />
            </li>
          ))}
        </ul>
      )}

      <NicheWizard
        settings={settings}
        prevActiveSlug={active?.niche.slug ?? null}
        onDone={refresh}
      />

      <AddNiche settings={settings} onCreated={refresh} />
    </section>
  );
}

interface EditorProps {
  settings: Settings;
  active: NicheActive;
  onSaved: () => void;
}

function ActiveNicheEditor({ settings, active, onSaved }: EditorProps): JSX.Element {
  const n = active.niche;
  const [label, setLabel] = useState(n.label);
  const [description, setDescription] = useState(n.description ?? '');
  const [persona, setPersona] = useState(n.persona);
  const [beliefs, setBeliefs] = useState(n.beliefs);
  const [replyPersona, setReplyPersona] = useState(n.replyPersona);
  const [doctrine, setDoctrine] = useState<DoctrineStrings>(() =>
    doctrineToStrings(active.doctrine),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const resetLocal = useCallback((): void => {
    setLabel(n.label);
    setDescription(n.description ?? '');
    setPersona(n.persona);
    setBeliefs(n.beliefs);
    setReplyPersona(n.replyPersona);
    setDoctrine(doctrineToStrings(active.doctrine));
    setErr(null);
  }, [n, active.doctrine]);

  // Re-sync when the active niche is replaced by a server response (e.g. after
  // activating a different niche).
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetLocal captures n/doctrine
  useEffect(() => {
    resetLocal();
  }, [active]);

  const base = doctrineToStrings(active.doctrine);
  const doctrineDirty = DOCTRINE_FIELDS.some((f) => doctrine[f.key] !== base[f.key]);
  const dirty =
    label !== n.label ||
    description !== (n.description ?? '') ||
    persona !== n.persona ||
    beliefs !== n.beliefs ||
    replyPersona !== n.replyPersona ||
    doctrineDirty;

  const save = async (): Promise<void> => {
    const body: NichePatchBody = {};
    if (label.trim() !== n.label) body.label = label.trim();
    if (description !== (n.description ?? '')) {
      const d = description.trim();
      body.description = d === '' ? null : d;
    }
    if (persona.trim() !== n.persona) body.persona = persona.trim();
    if (beliefs.trim() !== n.beliefs) body.beliefs = beliefs.trim();
    if (replyPersona.trim() !== n.replyPersona) body.replyPersona = replyPersona.trim();
    if (doctrineDirty) {
      const parsed = parseDoctrine(doctrine);
      if (!parsed) {
        setErr('Doctrine values must be positive numbers.');
        return;
      }
      body.doctrine = parsed; // full 5-knob object — PATCH replaces, not merges
    }
    setBusy(true);
    setErr(null);
    try {
      await api.niche.update(settings, n.slug, body);
      onSaved();
    } catch (e) {
      setErr(errMsg(e, 'Save failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pillar-card">
      <div className="pillar-card-head">
        <code className="pillar-slug">{n.slug}</code>
        <span className="badge badge-auto">active</span>
        {dirty && <span className="badge badge-paused">unsaved</span>}
      </div>

      <label className="field">
        <span>Label</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} spellCheck={false} />
      </label>

      <label className="field">
        <span>Description (prose self-description, optional)</span>
        <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>

      <label className="field">
        <span>Persona (post prompt grounding — who I am)</span>
        <textarea rows={8} value={persona} onChange={(e) => setPersona(e.target.value)} />
      </label>

      <label className="field">
        <span>Beliefs (post prompt — what I believe)</span>
        <textarea rows={8} value={beliefs} onChange={(e) => setBeliefs(e.target.value)} />
      </label>

      <label className="field">
        <span>Reply persona (reply prompt — the short "who I am")</span>
        <textarea rows={4} value={replyPersona} onChange={(e) => setReplyPersona(e.target.value)} />
      </label>

      <div className="field">
        <span>Doctrine (the REPLY-GUIDE numbers)</span>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
          {DOCTRINE_FIELDS.map((f) => (
            <label key={f.key} className="field" style={{ flex: '1 0 90px' }}>
              <span className="muted">{f.label}</span>
              <input
                type="number"
                min={1}
                value={doctrine[f.key]}
                onChange={(e) => setDoctrine((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      </div>

      {err && <div className="error">{err}</div>}

      <div className="pillar-card-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void save()}
          disabled={busy || !dirty}
        >
          {busy ? '…' : 'Save'}
        </button>
        <button type="button" onClick={resetLocal} disabled={busy || !dirty}>
          Reset
        </button>
      </div>
    </div>
  );
}

interface RowProps {
  settings: Settings;
  niche: Niche;
  isActive: boolean;
  onChanged: () => void;
}

function NicheRow({ settings, niche, isActive, onChanged }: RowProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const activate = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      await api.niche.update(settings, niche.slug, { active: true });
      onChanged();
    } catch (e) {
      setErr(errMsg(e, 'Activate failed'));
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      await api.niche.remove(settings, niche.slug);
      onChanged();
    } catch (e) {
      setErr(errMsg(e, 'Delete failed'));
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className={`pillar-card${isActive ? '' : ' pillar-inactive'}`}>
      <div className="pillar-card-head">
        <code className="pillar-slug">{niche.slug}</code>
        <span className="niche-row-label">{niche.label}</span>
        {isActive && <span className="badge badge-auto">active</span>}
      </div>

      {err && <div className="error">{err}</div>}

      <div className="pillar-card-actions">
        {!isActive && (
          <button type="button" onClick={() => void activate()} disabled={busy}>
            {busy ? '…' : 'Activate'}
          </button>
        )}
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
            disabled={busy || isActive}
            title={isActive ? 'Activate another niche first' : 'Delete niche'}
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
  onCreated: () => void;
}

function AddNiche({ settings, onCreated }: AddProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [label, setLabel] = useState('');
  const [persona, setPersona] = useState('');
  const [beliefs, setBeliefs] = useState('');
  const [replyPersona, setReplyPersona] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = (): void => {
    setSlug('');
    setLabel('');
    setPersona('');
    setBeliefs('');
    setReplyPersona('');
    setErr(null);
  };

  const create = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      await api.niche.create(settings, {
        slug: slug.trim().toLowerCase(),
        label: label.trim(),
        persona: persona.trim(),
        beliefs: beliefs.trim(),
        replyPersona: replyPersona.trim(),
      });
      onCreated();
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
          + New niche
        </button>
      </div>
    );
  }

  const ready =
    slug.trim() !== '' &&
    label.trim() !== '' &&
    persona.trim() !== '' &&
    beliefs.trim() !== '' &&
    replyPersona.trim() !== '';

  return (
    <div className="pillar-card pillar-add">
      <div className="pillar-card-head">
        <strong>New niche</strong>
      </div>
      <p className="muted">
        Created inactive — Activate it below to switch. Persona, beliefs and reply persona are
        required (or use the AI wizard above to fill them).
      </p>

      <label className="field">
        <span>Slug</span>
        <input
          placeholder="e.g. nutrition"
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
        <span>Persona (post prompt — who I am)</span>
        <textarea rows={6} value={persona} onChange={(e) => setPersona(e.target.value)} />
      </label>
      <label className="field">
        <span>Beliefs (post prompt — what I believe)</span>
        <textarea rows={6} value={beliefs} onChange={(e) => setBeliefs(e.target.value)} />
      </label>
      <label className="field">
        <span>Reply persona (short "who I am")</span>
        <textarea rows={4} value={replyPersona} onChange={(e) => setReplyPersona(e.target.value)} />
      </label>

      {err && <div className="error">{err}</div>}

      <div className="pillar-card-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void create()}
          disabled={busy || !ready}
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

interface WizardProps {
  settings: Settings;
  prevActiveSlug: string | null;
  onDone: () => void;
}

// N0.8 — the AI wizard: paste a prose self-description → Grok proposes a full
// niche (persona/beliefs/replyPersona + 3 pillars + ≤5 channels) → review/edit →
// Create. Persisting order matters: create the niche, ACTIVATE it, THEN create
// the pillars/channels so their server-side stamps land on the new niche (the
// POST routes stamp whatever niche is active). We then offer to switch back to
// whatever was active before, since activating is a real app-wide side effect.
function NicheWizard({ settings, prevActiveSlug, onDone }: WizardProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [proposal, setProposal] = useState<NicheProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ slug: string; back: string | null } | null>(null);

  const reset = (): void => {
    setDescription('');
    setProposal(null);
    setErr(null);
    setDone(null);
  };

  const generate = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.niche.draft(settings, description.trim());
      setProposal(r.proposal);
    } catch (e) {
      setErr(errMsg(e, 'Generation failed'));
    } finally {
      setBusy(false);
    }
  };

  const setField = <K extends keyof NicheProposal>(key: K, val: NicheProposal[K]): void =>
    setProposal((p) => (p ? { ...p, [key]: val } : p));

  const setPillar = (i: number, patch: Partial<NichePillarProposal>): void =>
    setProposal((p) =>
      p ? { ...p, pillars: p.pillars.map((x, j) => (j === i ? { ...x, ...patch } : x)) } : p,
    );

  const setChannel = (i: number, patch: Partial<NicheChannelProposal>): void =>
    setProposal((p) =>
      p ? { ...p, channels: p.channels.map((x, j) => (j === i ? { ...x, ...patch } : x)) } : p,
    );

  const create = async (): Promise<void> => {
    if (!proposal) return;
    setBusy(true);
    setErr(null);
    try {
      await api.niche.create(settings, {
        slug: proposal.slug,
        label: proposal.label,
        persona: proposal.persona,
        beliefs: proposal.beliefs,
        replyPersona: proposal.replyPersona,
        ...(proposal.description.trim() !== '' ? { description: proposal.description.trim() } : {}),
      });
      // Activate FIRST so the pillar/channel creates below stamp the new niche.
      await api.niche.update(settings, proposal.slug, { active: true });
      for (const p of proposal.pillars) {
        await api.pillars.create(settings, { slug: p.slug, label: p.label, body: p.body });
      }
      for (const ch of proposal.channels) {
        await api.channels.create(settings, {
          slug: ch.slug,
          label: ch.label,
          ...(ch.keywords.length > 0 ? { keywords: ch.keywords } : {}),
        });
      }
      setDone({ slug: proposal.slug, back: prevActiveSlug });
      setProposal(null);
      onDone(); // refresh the card — the new niche is now active
    } catch (e) {
      setErr(errMsg(e, 'Create failed'));
    } finally {
      setBusy(false);
    }
  };

  const switchBack = async (): Promise<void> => {
    if (!done?.back) return;
    setBusy(true);
    setErr(null);
    try {
      await api.niche.update(settings, done.back, { active: true });
      reset();
      setOpen(false);
      onDone();
    } catch (e) {
      setErr(errMsg(e, 'Switch failed'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="pillar-add-bar">
        <button type="button" onClick={() => setOpen(true)}>
          AI wizard — describe your niche
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="pillar-card pillar-add">
        <div className="pillar-card-head">
          <strong>Niche created</strong>
          <span className="badge badge-auto">active</span>
        </div>
        <p className="muted">
          <code className="pillar-slug">{done.slug}</code> was created with its pillars and
          channels, and is now the active niche.
        </p>
        {err && <div className="error">{err}</div>}
        <div className="pillar-card-actions">
          {done.back && done.back !== done.slug && (
            <button type="button" onClick={() => void switchBack()} disabled={busy}>
              {busy ? '…' : `Switch back to ${done.back}`}
            </button>
          )}
          <button
            type="button"
            className="primary"
            onClick={() => {
              reset();
              setOpen(false);
            }}
            disabled={busy}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pillar-card pillar-add">
      <div className="pillar-card-head">
        <strong>AI niche wizard</strong>
      </div>

      {!proposal ? (
        <>
          <p className="muted">
            Paste who you are / what your niche is (Romanian OK). The AI drafts a full niche —
            persona, beliefs, 3 pillars and channels — for you to review before saving.
          </p>
          <label className="field">
            <span>Description</span>
            <textarea
              rows={8}
              value={description}
              placeholder="e.g. I'm a registered dietitian who ships evidence-based meal plans and debunks fad diets, building in public…"
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          {err && <div className="error">{err}</div>}
          <div className="pillar-card-actions">
            <button
              type="button"
              className="primary"
              onClick={() => void generate()}
              disabled={busy || description.trim() === ''}
            >
              {busy ? 'Generating…' : 'Generate'}
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
        </>
      ) : (
        <>
          <p className="muted">
            Review and edit, then Create. Creating activates this niche (you can switch back after).
          </p>
          <label className="field">
            <span>Slug</span>
            <input
              value={proposal.slug}
              onChange={(e) => setField('slug', e.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Label</span>
            <input value={proposal.label} onChange={(e) => setField('label', e.target.value)} />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea
              rows={4}
              value={proposal.description}
              onChange={(e) => setField('description', e.target.value)}
            />
          </label>
          <label className="field">
            <span>Persona</span>
            <textarea
              rows={8}
              value={proposal.persona}
              onChange={(e) => setField('persona', e.target.value)}
            />
          </label>
          <label className="field">
            <span>Beliefs</span>
            <textarea
              rows={8}
              value={proposal.beliefs}
              onChange={(e) => setField('beliefs', e.target.value)}
            />
          </label>
          <label className="field">
            <span>Reply persona</span>
            <textarea
              rows={4}
              value={proposal.replyPersona}
              onChange={(e) => setField('replyPersona', e.target.value)}
            />
          </label>

          <div className="field">
            <span>Pillars (3)</span>
            {proposal.pillars.map((p, i) => (
              <div key={p.slug || i} className="pillar-card" style={{ marginTop: 6 }}>
                <input
                  value={p.slug}
                  onChange={(e) => setPillar(i, { slug: e.target.value })}
                  spellCheck={false}
                  placeholder="slug"
                />
                <input
                  value={p.label}
                  onChange={(e) => setPillar(i, { label: e.target.value })}
                  placeholder="label"
                  style={{ marginTop: 4 }}
                />
                <textarea
                  rows={3}
                  value={p.body}
                  onChange={(e) => setPillar(i, { body: e.target.value })}
                  style={{ marginTop: 4 }}
                />
              </div>
            ))}
          </div>

          {proposal.channels.length > 0 && (
            <div className="field">
              <span>Channels</span>
              {proposal.channels.map((ch, i) => (
                <div key={ch.slug || i} className="row" style={{ gap: 6, marginTop: 4 }}>
                  <input
                    value={ch.slug}
                    onChange={(e) => setChannel(i, { slug: e.target.value })}
                    spellCheck={false}
                    placeholder="slug"
                    style={{ flex: '0 0 110px' }}
                  />
                  <input
                    value={ch.keywords.join(', ')}
                    onChange={(e) =>
                      setChannel(i, {
                        keywords: e.target.value
                          .split(',')
                          .map((k) => k.trim().toLowerCase())
                          .filter((k) => k !== ''),
                      })
                    }
                    placeholder="keywords, comma-separated"
                    style={{ flex: 1 }}
                  />
                </div>
              ))}
            </div>
          )}

          {err && <div className="error">{err}</div>}
          <div className="pillar-card-actions">
            <button type="button" className="primary" onClick={() => void create()} disabled={busy}>
              {busy ? 'Creating…' : 'Create niche'}
            </button>
            <button type="button" onClick={() => setProposal(null)} disabled={busy}>
              Back
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
        </>
      )}
    </div>
  );
}
