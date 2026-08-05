// Re-export shim — the canonical module is src/shared/language.ts (§7.27), so the
// page and the server agree on how long a Japanese reply may be and on what
// script a tweet is written in. Vite inlines the shared file into both build
// passes; the module has no runtime imports, so it survives the content IIFE.
export * from '../../src/shared/language.ts';
