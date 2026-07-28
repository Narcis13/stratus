// Project-level humanizer settings routes (HM.2). Always mounted, every route
// $0: pure SQL over one `app_settings` row (nothing here can reach xFetch or
// askLLM). Static paths only — never add a `:param` under /humanizer (§7.20).
//
//   GET    /x/humanizer        → the full HumanizerSettings (missing row = defaults)
//   PATCH  /x/humanizer  {…}   → validated partial merged over current; 400 per field
//   DELETE /x/humanizer        → deletes the row, returns the defaults
//
// PATCH is strict per field (the parseAiPatch idiom): a typo'd value 400s rather
// than falling back, because the lenient parse exists for READING stored rows.

import { Hono } from 'hono';
import {
  getHumanizerSettings,
  parseHumanizerPatch,
  resetHumanizerSettings,
  saveHumanizerSettings,
} from '../settings/humanizer.ts';

export const humanizerRouter = new Hono();

humanizerRouter.get('/humanizer', (c) => {
  return c.json(getHumanizerSettings());
});

humanizerRouter.patch('/humanizer', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const parsed = parseHumanizerPatch(raw as Record<string, unknown>);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  // Merge over the CURRENT settings before writing — the row is always whole,
  // so a reader never has to know which fields a past PATCH happened to touch.
  return c.json(saveHumanizerSettings({ ...getHumanizerSettings(), ...parsed.patch }));
});

humanizerRouter.delete('/humanizer', (c) => {
  return c.json(resetHumanizerSettings());
});
