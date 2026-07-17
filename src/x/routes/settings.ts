// The settings platform routes (UI.1) — always mounted under /x, bearer-guarded,
// $0. The UI renders entirely from GET /x/settings (it never imports the
// registry); the extension mirror reads GET /x/settings/values?scope=mirrored.
// Only routes consult the store — pure modules stay pure (Decision 6).
//
//   GET   /settings                    → { groups: [{ id, label, settings: [{ …def, value, isDefault }] }] }
//   GET   /settings/values?scope=…     → flat { key: value } (scope=mirrored for the extension)
//   PATCH /settings   { [key]: value } → per-key validated, all-or-nothing, returns updated entries
//   POST  /settings/reset { keys?, group? } → drop override rows back to defaults
//
// Validation is registry-driven: unknown key → 400 unknown_setting, type/range
// violation → 400 invalid_setting_value. The floors/ceilings in the registry are
// the money/policy guard (Decision 5) — an agent editing via MCP hits the same wall.

import { Hono } from 'hono';
import {
  SettingsError,
  getAllValues,
  resetSettings,
  resolveSetting,
  setSettings,
  settingsByGroup,
} from '../settings/registry.ts';

export const settingsRouter = new Hono();

settingsRouter.get('/settings', (c) => {
  const groups = settingsByGroup().map((g) => ({
    id: g.id,
    label: g.label,
    settings: g.defs.map((def) => {
      const { value, isDefault } = resolveSetting(def.key);
      return { ...def, value, isDefault };
    }),
  }));
  return c.json({ groups });
});

settingsRouter.get('/settings/values', (c) => {
  const scope = c.req.query('scope');
  if (scope !== undefined && scope !== 'mirrored' && scope !== 'server') {
    return c.json({ error: 'invalid_scope' }, 400);
  }
  return c.json(getAllValues(scope));
});

settingsRouter.patch('/settings', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const patch = raw as Record<string, unknown>;
  if (Object.keys(patch).length === 0) return c.json({ error: 'empty_patch' }, 400);

  try {
    const updated = setSettings(patch);
    return c.json({ updated });
  } catch (err) {
    if (err instanceof SettingsError) {
      return c.json(
        { error: err.code, key: err.key, ...(err.reason ? { reason: err.reason } : {}) },
        400,
      );
    }
    throw err;
  }
});

settingsRouter.post('/settings/reset', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  const opts: { keys?: string[]; group?: string } = {};
  if (body.keys !== undefined) {
    if (!Array.isArray(body.keys) || body.keys.some((k) => typeof k !== 'string')) {
      return c.json({ error: 'invalid_keys' }, 400);
    }
    opts.keys = body.keys as string[];
  }
  if (body.group !== undefined) {
    if (typeof body.group !== 'string') return c.json({ error: 'invalid_group' }, 400);
    opts.group = body.group;
  }
  if (opts.keys === undefined && opts.group === undefined) {
    return c.json({ error: 'nothing_to_reset' }, 400);
  }

  return c.json(resetSettings(opts));
});
