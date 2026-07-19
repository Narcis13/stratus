// AI.10 — pure mapping between the Settings → AI form (all strings, so a blank
// field is representable) and the typed /llm/settings PATCH body. Extracted here
// so the blank-means-null + numeric-parse rules are unit-tested independently of
// the React panel. The server re-validates every field (400 per field); this is
// just the client-side shape + instant "that's not a number" feedback.

import type { AiSettings, AiSettingsPatchBody, LlmProvider, LlmReasoningEffort } from './types.ts';

export interface AiFormFields {
  provider: LlmProvider;
  openrouterModel: string;
  /** Raw input text. '' → null (use the surface default). */
  temperature: string;
  /** Raw input text. '' → null (use the surface default). */
  maxOutputTokens: string;
  /** '' → null (use the surface default). */
  reasoningEffort: LlmReasoningEffort | '';
}

export type AiFormToPatchResult =
  | { ok: true; patch: AiSettingsPatchBody }
  | { ok: false; error: string };

/** Populate the form from the server's typed settings — null numeric/effort
 *  fields render as blank inputs meaning "use the surface default". */
export function aiSettingsToForm(s: AiSettings): AiFormFields {
  return {
    provider: s.provider,
    openrouterModel: s.openrouterModel,
    temperature: s.temperature === null ? '' : String(s.temperature),
    maxOutputTokens: s.maxOutputTokens === null ? '' : String(s.maxOutputTokens),
    reasoningEffort: s.reasoningEffort ?? '',
  };
}

/** Map the form to a PATCH body. Blank numeric/effort fields become an explicit
 *  null (clears the override); a non-numeric temperature or non-integer token
 *  count is rejected client-side with the same error code the server would use. */
export function aiFormToPatch(f: AiFormFields): AiFormToPatchResult {
  const patch: AiSettingsPatchBody = {
    provider: f.provider,
    openrouterModel: f.openrouterModel.trim(),
  };

  const t = f.temperature.trim();
  if (t === '') {
    patch.temperature = null;
  } else {
    const n = Number(t);
    if (!Number.isFinite(n)) return { ok: false, error: 'invalid_temperature' };
    patch.temperature = n;
  }

  const m = f.maxOutputTokens.trim();
  if (m === '') {
    patch.maxOutputTokens = null;
  } else {
    const n = Number(m);
    if (!Number.isInteger(n)) return { ok: false, error: 'invalid_max_output_tokens' };
    patch.maxOutputTokens = n;
  }

  patch.reasoningEffort = f.reasoningEffort === '' ? null : f.reasoningEffort;

  return { ok: true, patch };
}

/** Format an OpenRouter per-token USD price string as $/1M tokens for the model
 *  picker labels. Returns null when the price is absent or unparseable. */
export function pricePerMillion(perToken: string | null): string | null {
  if (perToken === null) return null;
  const n = Number(perToken);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return 'free';
  const perM = n * 1_000_000;
  return `$${perM >= 100 ? perM.toFixed(0) : perM.toFixed(2)}/1M`;
}
