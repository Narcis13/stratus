// Re-export shim — the canonical module is src/shared/cannon.ts (§7.27), so the
// Cannon view on the page and the server's cannon routes score with one
// function. Vite inlines the shared file into both build passes.
export * from '../../src/shared/cannon.ts';
