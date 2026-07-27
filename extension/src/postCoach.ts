// Re-export shim — the canonical module is src/shared/postCoach.ts (§7.3), so
// the Composer's live score, SC.4's reply chips and the server all grade a
// draft with one engine. Vite inlines the shared file into both build passes;
// extension import paths stay unchanged.
export * from '../../src/shared/postCoach.ts';
