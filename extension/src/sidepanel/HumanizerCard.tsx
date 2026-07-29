// HM.4 — Settings → General "Reply humanizer": the editor for the PROJECT-level
// jitter config (`GET/PATCH/DELETE /x/humanizer`, all $0). The Radar tab's
// "Humanize picks" checkbox flips the same `enabled` flag; this card owns the
// prefix/suffix pools and the five chances behind it.
//
// NOT a settings-registry group (HM.2/D1): the humanizer is a raw `app_settings`
// row, so `GET /x/settings`, the mirrored blob and `useSettingsEditor` all skip
// it by construction and a `SettingsGear` over this card would render nothing.
// Everything here goes through `api.humanizer.{get,patch,reset}` directly.
//
// The form contract is ReplyLists' RL.9-hardened `HumanizerEditor`: pools are
// one-per-line textareas (never comma-split — a shipped default prefix is
// `'honestly,'`), Save is gated on `dirty`, and the re-seed effect is keyed on
// the stored config's VALUE rather than its identity so an unrelated reload
// can't wipe half-typed text.

import { type JSX, useEffect, useState } from 'react';
import { type HumanizerConfig, jitterOdds } from '../humanize.ts';
import type { HumanizerSettings } from '../shared/types.ts';
import { ApiError, api } from './api.ts';
import type { Settings } from './storage.ts';
import { Section } from './ui/Section.tsx';

/** Mirrors `src/x/settings/humanizer.ts`'s pool bounds. The extension cannot
 *  import that module (§5 build isolation — only `src/shared/` is shimmed), so
 *  these two numbers are a hand-synced mirror like the settings types: they
 *  exist to turn a refusal into a message under the field instead of a bare
 *  400, and the server stays the authority either way. */
const MAX_POOL_ENTRIES = 25;
const MAX_POOL_ENTRY_CHARS = 60;

const CHANCE_FIELDS: { key: keyof HumanizerConfig; label: string; code: string }[] = [
  { key: 'prefixChance', label: 'Prefix', code: 'invalid_prefix_chance' },
  { key: 'suffixChance', label: 'Suffix', code: 'invalid_suffix_chance' },
  { key: 'lowercaseChance', label: 'Lowercase start', code: 'invalid_lowercase_chance' },
  { key: 'dropPeriodChance', label: 'Drop final period', code: 'invalid_drop_period_chance' },
  { key: 'typoChance', label: 'Typo', code: 'invalid_typo_chance' },
];

// The route's 400 codes, spelled out. Shown both when the client guard fires
// before Save and when a PATCH comes back refused, so one wrong value reads the
// same either way.
const ERR: Record<string, string> = {
  invalid_body: 'The server could not read that. Reload the panel.',
  empty_patch: 'Nothing changed, so nothing was sent.',
  invalid_enabled: 'The on/off switch was refused.',
  invalid_prefixes: `At most ${MAX_POOL_ENTRIES} lines, ${MAX_POOL_ENTRY_CHARS} characters each.`,
  invalid_suffixes: `At most ${MAX_POOL_ENTRIES} lines, ${MAX_POOL_ENTRY_CHARS} characters each.`,
  invalid_prefix_chance: 'Must be a number between 0 and 1.',
  invalid_suffix_chance: 'Must be a number between 0 and 1.',
  invalid_lowercase_chance: 'Must be a number between 0 and 1.',
  invalid_drop_period_chance: 'Must be a number between 0 and 1.',
  invalid_typo_chance: 'Must be a number between 0 and 1.',
};

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return ERR[e.code] ?? `${e.code} (${e.status})`;
  return fallback;
}

function splitLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

/** A chance is kept as the typed STRING, not a number: `Number('0.')` is NaN and
 *  a numeric state would eat the keystroke mid-decimal. Empty, unparseable and
 *  out-of-range all fail here — the same range the route enforces. */
function parseChanceInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

function chanceMap(cfg: HumanizerConfig | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of CHANCE_FIELDS) {
    const v = cfg?.[f.key];
    out[f.key] = String(typeof v === 'number' ? v : 0);
  }
  return out;
}

/** The stored settings' config half, in the form's field order, so a JSON
 *  compare of the two is a real value compare. `enabled` is deliberately absent:
 *  it saves on click (below), so folding it in here would make the toggle bump
 *  `storedKey` and re-seed the form out from under half-typed pools. */
function configOf(s: HumanizerSettings): HumanizerConfig {
  return {
    prefixes: s.prefixes,
    suffixes: s.suffixes,
    prefixChance: s.prefixChance,
    suffixChance: s.suffixChance,
    lowercaseChance: s.lowercaseChance,
    dropPeriodChance: s.dropPeriodChance,
    typoChance: s.typoChance,
  };
}

export function HumanizerCard({ settings }: { settings: Settings }): JSX.Element {
  const [stored, setStored] = useState<HumanizerSettings | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [prefixes, setPrefixes] = useState('');
  const [suffixes, setSuffixes] = useState('');
  const [chances, setChances] = useState<Record<string, string>>(() => chanceMap(null));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // One $0 read per mount. A missing row is not an error — the route hands back
  // the engine defaults — so the only failure here is an unreachable server.
  useEffect(() => {
    let alive = true;
    api.humanizer
      .get(settings)
      .then((cfg) => {
        if (!alive) return;
        setStored(cfg);
        setLoadErr(null);
      })
      .catch((e) => {
        if (alive) setLoadErr(errMsg(e, 'Could not load the humanizer config.'));
      });
    return () => {
      alive = false;
    };
  }, [settings]);

  // Keyed on the stored config's VALUE (RL.9): `stored` is a fresh object after
  // every PATCH, including the `enabled` toggle, and an identity dep would throw
  // away half-typed pools each time.
  const storedKey = stored === null ? '' : JSON.stringify(configOf(stored));
  // biome-ignore lint/correctness/useExhaustiveDependencies: storedKey IS the serialized config half.
  useEffect(() => {
    if (stored === null) return;
    setPrefixes(stored.prefixes.join('\n'));
    setSuffixes(stored.suffixes.join('\n'));
    setChances(chanceMap(stored));
  }, [storedKey]);

  const prefixLines = splitLines(prefixes);
  const suffixLines = splitLines(suffixes);
  const poolErr = (lines: string[], code: string): string | null =>
    lines.length > MAX_POOL_ENTRIES || lines.some((l) => l.length > MAX_POOL_ENTRY_CHARS)
      ? code
      : null;
  const prefixErr = poolErr(prefixLines, 'invalid_prefixes');
  const suffixErr = poolErr(suffixLines, 'invalid_suffixes');

  const chanceErrs: Record<string, string> = {};
  const chanceValues: Record<string, number> = {};
  for (const f of CHANCE_FIELDS) {
    const n = parseChanceInput(chances[f.key] ?? '');
    if (n === null) chanceErrs[f.key] = f.code;
    else chanceValues[f.key] = n;
  }
  const invalid = prefixErr !== null || suffixErr !== null || Object.keys(chanceErrs).length > 0;

  // Built unconditionally so the odds line always has something to describe; the
  // `?? 0` legs are only reachable while `invalid` is true, and Save is shut off
  // in exactly that state.
  const form: HumanizerConfig = {
    prefixes: prefixLines,
    suffixes: suffixLines,
    prefixChance: chanceValues.prefixChance ?? 0,
    suffixChance: chanceValues.suffixChance ?? 0,
    lowercaseChance: chanceValues.lowercaseChance ?? 0,
    dropPeriodChance: chanceValues.dropPeriodChance ?? 0,
    typoChance: chanceValues.typoChance ?? 0,
  };
  const dirty = stored !== null && JSON.stringify(form) !== JSON.stringify(configOf(stored));

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await fn();
      setSaved(true);
    } catch (e) {
      setErr(errMsg(e, 'Update failed'));
      // The guards above mirror every documented 400, so a refusal that still
      // gets through means this panel's picture of the contract is wrong — put
      // the server's truth back rather than leave a rejected value on screen.
      // The typed text survives: a failed PATCH wrote nothing, so `storedKey` is
      // unchanged and the re-seed effect does not fire.
      await api.humanizer
        .get(settings)
        .then(setStored)
        .catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  // `enabled` saves on click, like the four toggles in "Behavior & privacy"
  // directly above and like the Radar checkbox it shares. Optimistic: flip
  // locally, PATCH, put the old value back on a refusal.
  const toggleEnabled = (next: boolean): void => {
    if (stored === null) return;
    const prev = stored;
    setStored({ ...stored, enabled: next });
    setErr(null);
    setSaved(false);
    void api.humanizer
      .patch(settings, { enabled: next })
      .then(setStored)
      .catch((e) => {
        setStored(prev);
        setErr(errMsg(e, 'Could not change that.'));
      });
  };

  if (stored === null) {
    return (
      <div className="panel">
        <Section title="Reply humanizer">
          {loadErr === null ? (
            <p className="muted">Loading…</p>
          ) : (
            <div className="error">{loadErr}</div>
          )}
        </Section>
      </div>
    );
  }

  return (
    <div className="panel">
      <Section title="Reply humanizer">
        <p className="muted">
          Applies to Radar picks when that tab's <strong>Humanize picks</strong> checkbox is on;
          each canned reply list still has its own override. The jitter is decided when you click an
          angle — the stored drafts are never rewritten.
        </p>

        <label className="row voice-toggle">
          <input
            type="checkbox"
            checked={stored.enabled}
            disabled={busy}
            onChange={(e) => toggleEnabled(e.target.checked)}
          />
          <span>Humanize Radar picks (default off) — the same switch as the Radar checkbox</span>
        </label>

        <label className="field">
          <span>
            Prefixes <small>one per line</small>
          </span>
          <textarea rows={3} value={prefixes} onChange={(e) => setPrefixes(e.target.value)} />
        </label>
        {prefixErr !== null && <small className="hz-invalid">{ERR[prefixErr]}</small>}

        <label className="field">
          <span>
            Suffixes <small>one per line</small>
          </span>
          <textarea rows={3} value={suffixes} onChange={(e) => setSuffixes(e.target.value)} />
        </label>
        {suffixErr !== null && <small className="hz-invalid">{ERR[suffixErr]}</small>}

        <div className="rl-chances hz-chances">
          {CHANCE_FIELDS.map((f) => (
            <label className="field rl-chance" key={f.key}>
              <span>{f.label}</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={chances[f.key] ?? ''}
                onChange={(e) => setChances((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
              {chanceErrs[f.key] !== undefined && (
                <small className="hz-invalid">{ERR[f.code]}</small>
              )}
            </label>
          ))}
        </div>

        <p className="status-line">
          Roughly <strong>{Math.round(jitterOdds(form) * 100)}%</strong> of picks come out changed
          at these numbers. An empty pool means that roll can never fire.
        </p>

        {err !== null && <div className="error">{err}</div>}
        {saved && !dirty && err === null && <div className="status-line">Saved ✓</div>}

        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={busy || !dirty || invalid}
            title={
              invalid
                ? 'Fix the highlighted fields first'
                : dirty
                  ? undefined
                  : 'Nothing changed since the last save'
            }
            onClick={() =>
              void run(async () => {
                setStored(await api.humanizer.patch(settings, form));
              })
            }
          >
            {busy ? '…' : dirty ? 'Save' : 'Saved'}
          </button>
          <button
            type="button"
            disabled={busy}
            title="Delete the stored row — the engine defaults come back"
            onClick={() => {
              if (!confirm('Reset the humanizer to the engine defaults? Radar picks turn off too.'))
                return;
              void run(async () => {
                setStored(await api.humanizer.reset(settings));
              });
            }}
          >
            Reset to defaults
          </button>
        </div>
      </Section>
    </div>
  );
}
