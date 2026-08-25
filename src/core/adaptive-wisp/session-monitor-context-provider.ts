import { getSessionMonitor } from '../v2/session-monitor.js';
import type { CanonicalGameId } from './types.js';
import { createWispSessionGenerationTracker, type WispSessionContextProvider } from './session-context.js';
import type { WispRuntimeContext } from './runtime-types.js';

/**
 * Real WispSessionContextProvider wired to SessionMonitorService (Increment 3,
 * Section 30). Read-only — calls getStatus() only, never start()/stop(); does
 * NOT attach to any process (Section 50). SessionMonitorService does not
 * expose gameId/trainer/table identity (that comes from the catalog/UI
 * layer, not from process-lifecycle tracking), so those are supplied by the
 * caller via getActiveGameContext() rather than assumed here.
 */
export function createSessionMonitorContextProvider(
  getActiveGameContext: () => { gameId: CanonicalGameId | null; trainerId?: string; tableId?: string; tableVersion?: string },
): WispSessionContextProvider {
  const tracker = createWispSessionGenerationTracker();

  return {
    getCurrentContext(): WispRuntimeContext | null {
      const status = getSessionMonitor().getStatus();
      const identity = status.snapshot?.gameIdentity ?? null;
      const active = getActiveGameContext();

      return tracker.observe({
        gameId: active.gameId,
        trainerId: active.trainerId,
        tableId: active.tableId,
        tableVersion: active.tableVersion,
        pid: identity?.pid,
        processStartTime: identity?.startTime,
      });
    },
  };
}
