// xAI Grok price table (May 2026, USD per token).
// Source: https://docs.x.ai/developers/models/grok-4.3
//
// Tiered pricing kicks in over 200K context window — we don't model that yet,
// so the cost row reads the base rate when the bill was actually tiered. Add
// a `costHint` opt or detect via prompt tokens before relying on this for
// long-context pricing.

interface TokenPrice {
  input: number;
  cachedInput: number;
  output: number;
}

const PER_MILLION = 1_000_000;

const PRICES: Record<string, TokenPrice> = {
  'grok-4.3': {
    input: 1.25 / PER_MILLION,
    cachedInput: 0.2 / PER_MILLION,
    output: 2.5 / PER_MILLION,
  },
};

const ALIASES: Record<string, string> = {
  'grok-4.3-latest': 'grok-4.3',
  'grok-latest': 'grok-4.3',
};

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export function priceFor(model: string, usage: TokenUsage): number {
  const key = ALIASES[model] ?? model;
  const p = PRICES[key];
  if (!p) return 0;
  // xAI returns total input_tokens including cached portion; subtract so the
  // cached half is billed at the cache rate, the rest at the full rate.
  const billableInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return (
    billableInput * p.input +
    usage.cachedInputTokens * p.cachedInput +
    usage.outputTokens * p.output
  );
}

export function isKnownModel(model: string): boolean {
  const key = ALIASES[model] ?? model;
  return key in PRICES;
}

// ---------------------------------------------------------------- image models
//
// Image generation (SURFACES S4) is billed per image at a flat rate, NOT per
// token — a different endpoint (/v1/images/generations) and a different meter.
// Kept in the same xAI price module so there's one place spend is priced; the
// image route logs a cost_events row under platform 'xai' (isolated from the
// token-priced 'grok' text spend) so the daily image budget guard reads exactly
// this bucket. This table is now only a FALLBACK — the generations response
// reports the exact billed amount via `usage.cost_in_usd_ticks`, which the
// image path prefers (see generateImages). Kept accurate anyway so a response
// without usage still prices correctly and isKnownImageModel stays meaningful.
//
// xAI retired the grok-2-image family; the current Grok Imagine models (verified
// live Jul 2026): grok-imagine-image $0.02/image, grok-imagine-image-quality
// $0.05/image.

const IMAGE_PRICES: Record<string, number> = {
  'grok-imagine-image': 0.02,
  'grok-imagine-image-quality': 0.05,
};

/** USD for generating `n` images with `model`; 0 for an unmapped model (the
 *  route shouts, same discipline as the token path's isKnownModel warning). */
export function priceForImage(model: string, n: number): number {
  const per = IMAGE_PRICES[model] ?? 0;
  return per * Math.max(0, Math.trunc(n));
}

export function isKnownImageModel(model: string): boolean {
  return model in IMAGE_PRICES;
}
