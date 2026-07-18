// AI settings store (AI.2) — the single typed JSON blob under `app_settings`
// key 'ai' that Settings → AI edits. It REUSES UI.1's `app_settings` table (D1);
// key 'ai' is NOT a registry key, so the platform-agnostic settings store
// (src/settings/store.ts) never touches it (that store only reads/deletes keys
// present in its SettingsRegistry). Read-through, NO cache: a PATCH shows on the
// next getAiSettings — the same discipline as loadDoctrine (a live-serving read
// must reflect an edit immediately, and there's no cache to invalidate).
//
// API KEYS NEVER LIVE HERE. `app_settings` is explorer/MCP-visible by
// construction (the S1 whitelist derives from schema exports, so `x_query` can
// read it) — a key stored here would leak. Provider keys stay in env
// (OPENROUTER_API_KEY / XAI_API_KEY). §7.16, Decision 5.

import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { appSettings } from '../db/shared-schema.ts';

export type LlmProvider = 'grok' | 'openrouter';
export type LlmReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export interface AiSettings {
  provider: LlmProvider;
  openrouterModel: string;
  /** null = each call site's own house default wins (the merge in askLLM). */
  temperature: number | null;
  maxOutputTokens: number | null;
  reasoningEffort: LlmReasoningEffort | null;
}

const AI_SETTINGS_KEY = 'ai';

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'grok',
  openrouterModel: 'anthropic/claude-sonnet-4.5',
  temperature: null,
  maxOutputTokens: null,
  reasoningEffort: null,
};

const EFFORTS: readonly LlmReasoningEffort[] = ['none', 'low', 'medium', 'high'];

function isEffort(v: unknown): v is LlmReasoningEffort {
  return typeof v === 'string' && (EFFORTS as readonly string[]).includes(v);
}

function validTemperature(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 2;
}

function validMaxTokens(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 16000;
}

function validModel(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
}

// Field-by-field sanitize so a schema-drifted or hand-edited row can never
// produce an invalid runtime setting — a bad field silently falls back to its
// default rather than steering a live draft with garbage.
function sanitize(value: unknown): AiSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_AI_SETTINGS };
  }
  const v = value as Record<string, unknown>;
  return {
    provider: v.provider === 'openrouter' ? 'openrouter' : 'grok',
    openrouterModel: validModel(v.openrouterModel)
      ? (v.openrouterModel as string)
      : DEFAULT_AI_SETTINGS.openrouterModel,
    temperature: validTemperature(v.temperature) ? v.temperature : null,
    maxOutputTokens: validMaxTokens(v.maxOutputTokens) ? v.maxOutputTokens : null,
    reasoningEffort: isEffort(v.reasoningEffort) ? v.reasoningEffort : null,
  };
}

export function getAiSettings(): AiSettings {
  try {
    const row = db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, AI_SETTINGS_KEY))
      .get();
    if (!row) return { ...DEFAULT_AI_SETTINGS };
    return sanitize(row.value);
  } catch (err) {
    console.error(
      `llm settings: failed to read the 'ai' row, using defaults — ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ...DEFAULT_AI_SETTINGS };
  }
}

/** Validate a raw PATCH body into a typed partial, or return an error CODE the
 *  route maps to a 400. Only keys PRESENT in the body are validated/applied
 *  (partial patch); an explicit `null` clears temperature/maxOutputTokens/
 *  reasoningEffort back to the surface default. Pure + env-free — the
 *  openrouter-without-key 409 is decided in the route, not here. */
export function parseAiPatch(
  raw: Record<string, unknown>,
): { ok: true; patch: Partial<AiSettings> } | { ok: false; error: string } {
  const patch: Partial<AiSettings> = {};
  if ('provider' in raw) {
    const p = raw.provider;
    if (p !== 'grok' && p !== 'openrouter') return { ok: false, error: 'invalid_provider' };
    patch.provider = p;
  }
  if ('openrouterModel' in raw) {
    if (!validModel(raw.openrouterModel)) return { ok: false, error: 'invalid_openrouter_model' };
    patch.openrouterModel = (raw.openrouterModel as string).trim();
  }
  if ('temperature' in raw) {
    if (raw.temperature !== null && !validTemperature(raw.temperature))
      return { ok: false, error: 'invalid_temperature' };
    patch.temperature = raw.temperature as number | null;
  }
  if ('maxOutputTokens' in raw) {
    if (raw.maxOutputTokens !== null && !validMaxTokens(raw.maxOutputTokens))
      return { ok: false, error: 'invalid_max_output_tokens' };
    patch.maxOutputTokens = raw.maxOutputTokens as number | null;
  }
  if ('reasoningEffort' in raw) {
    if (raw.reasoningEffort !== null && !isEffort(raw.reasoningEffort))
      return { ok: false, error: 'invalid_reasoning_effort' };
    patch.reasoningEffort = raw.reasoningEffort as LlmReasoningEffort | null;
  }
  return { ok: true, patch };
}

/** Merge a validated partial over the current settings and persist (one sync
 *  upsert — §7.13, no await inside a txn). Returns the full merged object. */
export function saveAiSettings(patch: Partial<AiSettings>): AiSettings {
  const next: AiSettings = { ...getAiSettings(), ...patch };
  const now = new Date();
  db.insert(appSettings)
    .values({ key: AI_SETTINGS_KEY, value: next, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: now } })
    .run();
  return next;
}
