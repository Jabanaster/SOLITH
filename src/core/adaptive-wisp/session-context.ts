import type { CanonicalGameId } from './types.js';
import type { WispRuntimeContext } from './runtime-types.js';

/**
 * Adaptive Wisp session-context adapter (Increment 3, Sections 11-13, 30).
 *
 * SOLITH's SessionMonitorService (src/core/v2/session-monitor.ts) tracks an
 * internal generation counter, but it is private and never exposed on
 * MonitorStatus/getStatus() — there is no public generation or subscribe API
 * to reuse directly (confirmed by audit). Rather than invent a second
 * session-identity concept, this adapter derives a local, monotonic
 * "attach generation" purely from the same (pid, processStartTime) pair the
 * rest of the codebase already treats as authoritative process identity
 * (ProcessIdentity in v2/lifecycle/types.ts, LiveProcessTarget in
 * live-memory/types.ts) — PID alone is insufficient due to reuse (Section 13).
 *
 * Pure/stateful, no I/O — a real adapter wires this to SessionMonitorService's
 * public getStatus() polling (see session-monitor-context-provider.ts);
 * tests drive it directly with synthetic identity samples.
 */
export interface WispRawAttachIdentity {
  gameId: CanonicalGameId | null;
  trainerId?: string;
  tableId?: string;
  tableVersion?: string;
  /** Process identity evidence — both required together, or the sample is treated as detached (fail closed, Section 32). */
  pid?: number;
  processStartTime?: string;
}

export interface WispSessionContextProvider {
  getCurrentContext(): WispRuntimeContext | null;
}

export interface WispSessionGenerationTracker {
  /** Feed the latest raw identity sample; returns the current runtime context, or null when detached/unprovable. */
  observe(raw: WispRawAttachIdentity): WispRuntimeContext | null;
}

export function createWispSessionGenerationTracker(): WispSessionGenerationTracker {
  let lastKey: string | null = null;
  let sessionId: string | null = null;
  let generation = 0;

  return {
    observe(raw: WispRawAttachIdentity): WispRuntimeContext | null {
      if (!raw.gameId || raw.pid === undefined || !raw.processStartTime) {
        lastKey = null;
        sessionId = null;
        return null;
      }

      const key = `${raw.gameId}:${raw.pid}:${raw.processStartTime}`;
      if (key !== lastKey) {
        generation += 1;
        sessionId = `wisp-session:${generation}`;
        lastKey = key;
      }

      return {
        gameId: raw.gameId,
        trainerId: raw.trainerId,
        tableId: raw.tableId,
        tableVersion: raw.tableVersion,
        sessionId: sessionId as string,
        sessionGeneration: generation,
      };
    },
  };
}
