// Re-export shim — the canonical module is src/shared/radarSweep.ts (§7.27), so
// the capture arm on the page, the panel's Start/Stop control and the settings
// registry all decide with one copy of the sweep rule. Vite inlines the shared
// file into both build passes.
export * from '../../src/shared/radarSweep.ts';
