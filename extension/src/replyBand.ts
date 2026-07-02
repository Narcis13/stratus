// Re-export shim — the canonical module moved to src/shared/replyBand.ts
// (OVERHAUL-PLAN §7.3) so the server-side band gate in /x/replies/generate and
// the on-page badge share one classifier. Vite inlines the shared file into
// both build passes; extension import paths stay unchanged.
export * from '../../src/shared/replyBand.ts';
