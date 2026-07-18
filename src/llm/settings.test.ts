// AI settings store — defaults on an empty DB, round-trip, defensive sanitize of
// a garbage row, and the pure parseAiPatch validation. Cleans up its 'ai' row
// (shared in-memory DB — no other suite reads it, but keep the discipline).

import { afterEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { appSettings } from '../db/shared-schema.ts';
import { DEFAULT_AI_SETTINGS, getAiSettings, parseAiPatch, saveAiSettings } from './settings.ts';

function deleteAiRow(): void {
  db.delete(appSettings).where(eq(appSettings.key, 'ai')).run();
}

afterEach(() => {
  deleteAiRow();
});

describe('getAiSettings', () => {
  test('returns defaults when no row exists', () => {
    expect(getAiSettings()).toEqual(DEFAULT_AI_SETTINGS);
  });

  test('defaults are provider=grok, sonnet openrouter model, everything else null', () => {
    expect(DEFAULT_AI_SETTINGS).toEqual({
      provider: 'grok',
      openrouterModel: 'anthropic/claude-sonnet-4.5',
      temperature: null,
      maxOutputTokens: null,
      reasoningEffort: null,
    });
  });

  test('sanitizes a garbage row field-by-field back to defaults', () => {
    // A schema-drifted / hand-edited row: bad provider, non-string model,
    // out-of-range temperature, string tokens, unknown effort.
    db.insert(appSettings)
      .values({
        key: 'ai',
        value: {
          provider: 'bogus',
          openrouterModel: 42,
          temperature: 9,
          maxOutputTokens: 'lots',
          reasoningEffort: 'ludicrous',
        },
        updatedAt: new Date(),
      })
      .run();
    expect(getAiSettings()).toEqual(DEFAULT_AI_SETTINGS);
  });

  test('a non-object stored value degrades to defaults', () => {
    db.insert(appSettings)
      .values({ key: 'ai', value: 'not-an-object', updatedAt: new Date() })
      .run();
    expect(getAiSettings()).toEqual(DEFAULT_AI_SETTINGS);
  });
});

describe('saveAiSettings', () => {
  test('round-trips a partial patch, leaving untouched fields at their defaults', () => {
    const next = saveAiSettings({ provider: 'openrouter', temperature: 0.7 });
    expect(next.provider).toBe('openrouter');
    expect(next.temperature).toBe(0.7);
    expect(next.openrouterModel).toBe('anthropic/claude-sonnet-4.5');
    expect(getAiSettings()).toEqual(next);
  });

  test('merges successive patches (later keys win, earlier keys persist)', () => {
    saveAiSettings({ provider: 'openrouter', openrouterModel: 'x/y', maxOutputTokens: 500 });
    const after = saveAiSettings({ temperature: 1.2 });
    expect(after).toEqual({
      provider: 'openrouter',
      openrouterModel: 'x/y',
      temperature: 1.2,
      maxOutputTokens: 500,
      reasoningEffort: null,
    });
  });

  test('null clears a numeric field back to the surface default', () => {
    saveAiSettings({ temperature: 1.5, maxOutputTokens: 800, reasoningEffort: 'high' });
    const cleared = saveAiSettings({
      temperature: null,
      maxOutputTokens: null,
      reasoningEffort: null,
    });
    expect(cleared.temperature).toBeNull();
    expect(cleared.maxOutputTokens).toBeNull();
    expect(cleared.reasoningEffort).toBeNull();
  });
});

describe('parseAiPatch', () => {
  test('accepts a full valid patch', () => {
    const r = parseAiPatch({
      provider: 'openrouter',
      openrouterModel: '  openai/gpt-5  ',
      temperature: 0,
      maxOutputTokens: 16000,
      reasoningEffort: 'medium',
    });
    expect(r).toEqual({
      ok: true,
      patch: {
        provider: 'openrouter',
        openrouterModel: 'openai/gpt-5', // trimmed
        temperature: 0,
        maxOutputTokens: 16000,
        reasoningEffort: 'medium',
      },
    });
  });

  test('an empty body is a valid no-op patch', () => {
    expect(parseAiPatch({})).toEqual({ ok: true, patch: {} });
  });

  test('accepts null to clear temperature / maxOutputTokens / reasoningEffort', () => {
    const r = parseAiPatch({ temperature: null, maxOutputTokens: null, reasoningEffort: null });
    expect(r).toEqual({
      ok: true,
      patch: { temperature: null, maxOutputTokens: null, reasoningEffort: null },
    });
  });

  test.each([
    [{ provider: 'gemini' }, 'invalid_provider'],
    [{ provider: 3 }, 'invalid_provider'],
    [{ openrouterModel: '' }, 'invalid_openrouter_model'],
    [{ openrouterModel: 12 }, 'invalid_openrouter_model'],
    [{ temperature: 2.1 }, 'invalid_temperature'],
    [{ temperature: -0.1 }, 'invalid_temperature'],
    [{ temperature: 'hot' }, 'invalid_temperature'],
    [{ maxOutputTokens: 0 }, 'invalid_max_output_tokens'],
    [{ maxOutputTokens: 16001 }, 'invalid_max_output_tokens'],
    [{ maxOutputTokens: 1.5 }, 'invalid_max_output_tokens'],
    [{ reasoningEffort: 'ultra' }, 'invalid_reasoning_effort'],
  ])('rejects %o with %s', (body, code) => {
    expect(parseAiPatch(body as Record<string, unknown>)).toEqual({ ok: false, error: code });
  });
});
