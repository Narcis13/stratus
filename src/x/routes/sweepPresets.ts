// Named sweep-preset routes (SP.1). Always mounted, bearer-guarded, every route
// $0: pure SQL over one `app_settings` row plus, on load, the same
// `setSettings` the Settings tab already calls. Nothing here can reach xFetch or
// askLLM. Static paths only — never add a `:param` under /sweep (§7.20), which
// is why delete and load take the name in a BODY rather than in the path.
//
//   GET    /x/sweep/presets              → { presets }
//   POST   /x/sweep/presets  { name }    → snapshot the LIVE sweep config under
//                                          `name` (overwrites an existing one)
//   POST   /x/sweep/presets/load {name}  → apply it: one validated PATCH of the
//                                          eleven x.sweep.* keys
//   DELETE /x/sweep/presets  { name }    → 404 when the name isn't there
//
// The client never sends VALUES. A preset is always a snapshot of what the
// registry currently holds, so a saved preset can only contain numbers the
// registry already accepted — and loading one re-enters that validation anyway,
// so a row edited by hand in the explorer refuses instead of landing.

import { Hono } from 'hono';
import { SettingsError, setSettings } from '../settings/registry.ts';
import { sweepConfigFromSettings, sweepSettingsPatch } from '../settings/sweepConfig.ts';
import {
  deleteSweepPreset,
  findSweepPreset,
  listSweepPresets,
  parsePresetName,
  saveSweepPreset,
} from '../settings/sweepPresets.ts';

export const sweepPresetsRouter = new Hono();

/** The one body shape all three writes take: `{name}`. Pure — the route awaits
 *  `c.req.json()` itself and hands the result here, so this stays testable and
 *  the Hono context type never has to be spelled out. */
function readName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'invalid_body' };
  }
  const parsed = parsePresetName((raw as Record<string, unknown>).name);
  if (!parsed.ok) return { ok: false, error: 'invalid_name' };
  return { ok: true, name: parsed.name };
}

sweepPresetsRouter.get('/sweep/presets', (c) => {
  return c.json({ presets: listSweepPresets() });
});

sweepPresetsRouter.post('/sweep/presets', async (c) => {
  const name = readName(await c.req.json().catch(() => null));
  if (!name.ok) return c.json({ error: name.error }, 400);

  const saved = saveSweepPreset(name.name, sweepConfigFromSettings());
  if (!saved.ok) return c.json({ error: saved.error }, 400);
  return c.json({ presets: saved.presets, saved: name.name });
});

sweepPresetsRouter.post('/sweep/presets/load', async (c) => {
  const name = readName(await c.req.json().catch(() => null));
  if (!name.ok) return c.json({ error: name.error }, 400);

  const preset = findSweepPreset(name.name);
  if (!preset) return c.json({ error: 'unknown_preset' }, 404);

  try {
    // All-or-nothing against the registry: a preset saved before a floor moved
    // refuses whole rather than half-applying, which would leave the gear showing
    // a config that belongs to no preset at all.
    setSettings(sweepSettingsPatch(preset.values));
  } catch (err) {
    if (err instanceof SettingsError) {
      return c.json(
        { error: err.code, key: err.key, ...(err.reason ? { reason: err.reason } : {}) },
        400,
      );
    }
    throw err;
  }
  return c.json({ loaded: preset.name, values: preset.values });
});

sweepPresetsRouter.delete('/sweep/presets', async (c) => {
  const name = readName(await c.req.json().catch(() => null));
  if (!name.ok) return c.json({ error: name.error }, 400);

  const result = deleteSweepPreset(name.name);
  if (!result.deleted) return c.json({ error: 'unknown_preset' }, 404);
  return c.json({ presets: result.presets });
});
