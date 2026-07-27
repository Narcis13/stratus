// Re-export shim — the canonical module is src/shared/postFormat.ts (§7.3), so
// the Playbook's format table, SC.6's cooldown chip and the server's cells all
// derive the label from one cascade. Vite inlines the shared file into both
// build passes; extension import paths stay unchanged.
export * from '../../src/shared/postFormat.ts';
