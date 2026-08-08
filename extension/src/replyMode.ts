// Re-export shim — the canonical module is src/shared/replyMode.ts (§7.27), so
// the panel and the server agree on the angle vocabulary, on how much of the
// persona a room allows and on what KIND of room a post is. `language.ts`'s
// twin, and the same mechanics: Vite inlines the shared file into both build
// passes, and the module has no runtime imports, so it survives the content
// IIFE.
export * from '../../src/shared/replyMode.ts';
