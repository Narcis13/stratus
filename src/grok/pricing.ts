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
