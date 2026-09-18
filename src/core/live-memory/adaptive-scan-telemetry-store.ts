import type { ScanTelemetry } from './adaptive-scan-planner.js';

/**
 * P2-10 — bounded telemetry history for the adaptive scan planner.
 *
 * Scope note (§16, process/session identity): this store is meant to live as
 * an instance field on `LiveMemorySession`, and `LiveMemorySession` itself is
 * already constructed fresh per attach (`electron/live-memory-ipc.ts` does
 * `new LiveMemorySession(...)` inside the attach handler, never reused across
 * detach/re-attach). That existing "one session instance per attach"
 * invariant already gives this store the isolation §16 asks for — a restart
 * or a fresh attach means a brand-new `LiveMemorySession` and therefore a
 * brand-new, empty store. No separate PID/start-time keying is needed here;
 * it would duplicate an isolation guarantee the architecture already
 * provides. (`getAttachedIdentity()`/`verifyAttachedProcessIdentity()` remain
 * the fail-closed re-check before any destructive op, unchanged by this.)
 */
const DEFAULT_MAX_HISTORY = 20;

export class AdaptiveScanTelemetryStore {
  private readonly entries: ScanTelemetry[] = [];

  constructor(private readonly maxHistory: number = DEFAULT_MAX_HISTORY) {}

  record(entry: ScanTelemetry): void {
    this.entries.push(entry);
    while (this.entries.length > this.maxHistory) {
      this.entries.shift();
    }
  }

  /** Oldest-first, bounded, defensive copy — callers must not be able to mutate recorded history. */
  list(): ScanTelemetry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.length = 0;
  }
}
