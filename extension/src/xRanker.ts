// Re-export shim — the canonical module is src/shared/xRanker.ts (XR.1), the
// weight layer: X's 26 published For You head weights and a direct port of
// `ranking_scorer.rs` arithmetic. A copy here would be a copy of somebody
// else's published constants, which is the one kind of duplicate that can go
// silently wrong — the numbers look plausible whatever they are (§7.27).
// Vite inlines the shared file into the side-panel and content builds;
// extension import paths stay unchanged.
export * from '../../src/shared/xRanker.ts';
