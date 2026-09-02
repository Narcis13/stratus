// Re-export shim — the canonical module is src/shared/xRankerSignals.ts (XR.2),
// our estimator over XR.1's weight layer: the modifier table, the C score a
// draft gets in the Composer and the E score a measured post gets. It must be
// the same code the server scores with (XR.4's falsification cell, XR.7's
// stamped `ranker_e`), or the cell would be validating a different estimator
// than the one the panel shows (§7.27).
export * from '../../src/shared/xRankerSignals.ts';
