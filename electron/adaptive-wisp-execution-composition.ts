/**
 * Adaptive Wisp Increment 4B — production adapter factory (Section 36).
 *
 * One well-defined construction point for the real WispTrainerExecutionAdapter,
 * so no future caller creates its own competing instance. NOT registered with
 * ipcMain, imported by no preload script, and reachable from no renderer —
 * this file exists purely so the composition already has a single home before
 * a real caller (hotkey/IPC — a later, separately-authorized increment) needs
 * one.
 */
import { getActiveLiveMemorySessionBundle } from './live-memory-ipc.js';
import {
  createLiveMemoryWispTrainerExecutionAdapter,
  type LiveMemoryWispSessionBundle,
} from '../src/core/live-memory/adaptive-wisp-live-adapter.js';
import { createCatalogGameIdentityBridge } from '../src/core/adaptive-wisp/catalog-game-identity-bridge.js';
import type { WispTrainerExecutionAdapter } from '../src/core/adaptive-wisp/trainer-execution-adapter.js';

let cached: WispTrainerExecutionAdapter | null = null;

/** Returns the single production Adaptive Wisp execution adapter instance. */
export function getAdaptiveWispExecutionAdapter(): WispTrainerExecutionAdapter {
  if (!cached) {
    cached = createLiveMemoryWispTrainerExecutionAdapter(
      (): LiveMemoryWispSessionBundle | null => getActiveLiveMemorySessionBundle(),
      createCatalogGameIdentityBridge(),
    );
  }
  return cached;
}
