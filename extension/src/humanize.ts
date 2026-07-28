// Re-export shim — the canonical module is src/shared/humanize.ts (HM.1), so
// the Radar's pick-time jitter, the Lists subtab's odds line and the server's
// canned-reply engine all roughen a reply with one engine. Vite inlines the
// shared file into the sidepanel build; extension import paths stay unchanged.
export * from '../../src/shared/humanize.ts';
