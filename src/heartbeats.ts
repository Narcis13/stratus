// In-process worker heartbeat registry, surfaced by /healthz. Platform-agnostic:
// workers call beat(name); whoever starts them registers the name with a
// staleness threshold. A worker that stops beating flips /healthz to 503 so the
// deploy health check (and any uptime probe) pages instead of failing silently.

interface Heartbeat {
  staleAfterMs: number;
  lastBeatAt: Date;
}

const registry = new Map<string, Heartbeat>();

/** Registration stamps lastBeatAt = now so a fresh boot is never flagged stale. */
export function registerHeartbeat(name: string, staleAfterMs: number): void {
  registry.set(name, { staleAfterMs, lastBeatAt: new Date() });
}

export function beat(name: string): void {
  const hb = registry.get(name);
  if (hb) hb.lastBeatAt = new Date();
}

/** For graceful worker shutdown (and tests) — a stopped worker isn't stale. */
export function unregisterHeartbeat(name: string): void {
  registry.delete(name);
}

export interface HeartbeatStatus {
  name: string;
  lastBeatAt: Date;
  staleAfterMs: number;
  stale: boolean;
}

export function heartbeatStatus(now: Date = new Date()): HeartbeatStatus[] {
  return Array.from(registry.entries(), ([name, hb]) => ({
    name,
    lastBeatAt: hb.lastBeatAt,
    staleAfterMs: hb.staleAfterMs,
    stale: now.getTime() - hb.lastBeatAt.getTime() > hb.staleAfterMs,
  }));
}
