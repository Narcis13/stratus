// Re-export shim — the canonical module is src/shared/judge.ts (§7.3), so the
// judge panel's band, its dimension copy and its quote-to-selection offsets come
// from the same engine the server derives the stored verdict with. Vite inlines
// the shared file into both build passes; extension import paths stay unchanged.
export * from '../../src/shared/judge.ts';
