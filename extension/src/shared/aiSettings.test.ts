import { describe, expect, test } from 'bun:test';
import { aiFormToPatch, aiSettingsToForm, pricePerMillion } from './aiSettings.ts';
import type { AiSettings } from './types.ts';

describe('aiSettingsToForm', () => {
  test('null numeric/effort fields render as blank', () => {
    const s: AiSettings = {
      provider: 'grok',
      openrouterModel: 'anthropic/claude-sonnet-4.5',
      temperature: null,
      maxOutputTokens: null,
      reasoningEffort: null,
    };
    expect(aiSettingsToForm(s)).toEqual({
      provider: 'grok',
      openrouterModel: 'anthropic/claude-sonnet-4.5',
      temperature: '',
      maxOutputTokens: '',
      reasoningEffort: '',
    });
  });

  test('set values stringify', () => {
    const s: AiSettings = {
      provider: 'openrouter',
      openrouterModel: 'openai/gpt-5',
      temperature: 0.7,
      maxOutputTokens: 2000,
      reasoningEffort: 'high',
    };
    expect(aiSettingsToForm(s)).toEqual({
      provider: 'openrouter',
      openrouterModel: 'openai/gpt-5',
      temperature: '0.7',
      maxOutputTokens: '2000',
      reasoningEffort: 'high',
    });
  });
});

describe('aiFormToPatch', () => {
  test('blank numeric/effort fields become explicit null', () => {
    const r = aiFormToPatch({
      provider: 'grok',
      openrouterModel: '  anthropic/claude-sonnet-4.5  ',
      temperature: '',
      maxOutputTokens: '',
      reasoningEffort: '',
    });
    expect(r).toEqual({
      ok: true,
      patch: {
        provider: 'grok',
        openrouterModel: 'anthropic/claude-sonnet-4.5',
        temperature: null,
        maxOutputTokens: null,
        reasoningEffort: null,
      },
    });
  });

  test('parses valid numeric fields and passes effort through', () => {
    const r = aiFormToPatch({
      provider: 'openrouter',
      openrouterModel: 'openai/gpt-5',
      temperature: '0.9',
      maxOutputTokens: '1500',
      reasoningEffort: 'medium',
    });
    expect(r).toEqual({
      ok: true,
      patch: {
        provider: 'openrouter',
        openrouterModel: 'openai/gpt-5',
        temperature: 0.9,
        maxOutputTokens: 1500,
        reasoningEffort: 'medium',
      },
    });
  });

  test('rejects a non-numeric temperature', () => {
    const r = aiFormToPatch({
      provider: 'grok',
      openrouterModel: 'x',
      temperature: 'hot',
      maxOutputTokens: '',
      reasoningEffort: '',
    });
    expect(r).toEqual({ ok: false, error: 'invalid_temperature' });
  });

  test('rejects a non-integer max output tokens', () => {
    const r = aiFormToPatch({
      provider: 'grok',
      openrouterModel: 'x',
      temperature: '',
      maxOutputTokens: '12.5',
      reasoningEffort: '',
    });
    expect(r).toEqual({ ok: false, error: 'invalid_max_output_tokens' });
  });
});

describe('pricePerMillion', () => {
  test('null price → null', () => {
    expect(pricePerMillion(null)).toBeNull();
  });

  test('zero → free', () => {
    expect(pricePerMillion('0')).toBe('free');
  });

  test('per-token USD scales to per-1M with 2 decimals under $100', () => {
    // $0.000003/token → $3.00/1M
    expect(pricePerMillion('0.000003')).toBe('$3.00/1M');
  });

  test('large prices drop the decimals', () => {
    // $0.00015/token → $150/1M
    expect(pricePerMillion('0.00015')).toBe('$150/1M');
  });

  test('unparseable → null', () => {
    expect(pricePerMillion('abc')).toBeNull();
  });
});
