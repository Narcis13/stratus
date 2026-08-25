// Re-export shim — the canonical module is src/shared/searchQuery.ts (OU.1), so
// the string this panel previews on every keystroke and the string the server
// stores through POST /x/searches are compiled by the same code (§7.27). A copy
// here would drift the moment an operator changes, and the preview is the one
// place that divergence would be invisible. Vite inlines the shared file into
// the side-panel build; extension import paths stay unchanged.
export * from '../../src/shared/searchQuery.ts';
