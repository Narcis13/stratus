// Re-export shim — the canonical module lives at src/shared/channelSuggest.ts
// (CIRCLES-PLAN C8) so the server and the extension score keyword suggestions
// identically. Vite inlines the shared file; same arrangement as replyBand.ts.
export * from '../../src/shared/channelSuggest.ts';
