/**
 * Adaptive Wisp Increment 5 — production quick-slot hotkey composition.
 *
 * One well-defined construction point for the real WispQuickSlotController,
 * mirroring adaptive-wisp-execution-composition.ts's pattern: not registered
 * with ipcMain, imported by no preload script, reachable from no renderer.
 * The only caller is electron/trainer-hotkeys.ts's wisp_slot_N callback.
 *
 * Known limitation (documented, not silently worked around): resolving
 * "which canonical game is currently attached" from a live process has no
 * existing production implementation anywhere in the repository yet (audited
 * this increment — session-monitor-context-provider.ts's getActiveGameContext
 * callback has never had a real caller, and no other main-process module
 * tracks a "current canonical game" concept). Inventing that resolution here
 * would mean introducing new, unreviewed identity-mapping logic outside this
 * increment's scope — exactly what Increment 4's own review forbids doing
 * casually (no fuzzy/executable-substring/cast-based mapping). Until a future
 * increment supplies a real implementation, getActiveGameContext returns "no
 * active game," which the whole reviewed chain already treats as the safe,
 * harmless "no active session" case (Increment 5 spec, Section 18) — Wisp
 * quick-slot hotkeys are wired end-to-end and fully tested, but will no-op
 * in the running app until that gap is closed.
 */
import { getSessionMonitor } from '../src/core/v2/session-monitor.js';
import type { CanonicalGameId } from '../src/core/adaptive-wisp/types.js';
import { createSessionMonitorContextProvider } from '../src/core/adaptive-wisp/session-monitor-context-provider.js';
import { createCatalogGameIdentityBridge } from '../src/core/adaptive-wisp/catalog-game-identity-bridge.js';
import { createCheatSystemEntryLookup } from '../src/core/adaptive-wisp/cheat-system-entry-lookup.js';
import { createWispActiveProfileProvider } from '../src/core/adaptive-wisp/active-profile-provider.js';
import { createWispQuickSlotController, type WispQuickSlotController } from '../src/core/adaptive-wisp/quick-slot-controller.js';
import { createWispProfileRegistry } from '../src/core/adaptive-wisp/registry.js';
import { resolveWispProfileForGame } from '../src/core/adaptive-wisp/user-state-service.js';
import { getAdaptiveWispExecutionAdapter } from './adaptive-wisp-execution-composition.js';
import { app } from 'electron';

/**
 * See the known-limitation note above — always reports no active game until
 * a real attached-process -> canonical-game resolver exists.
 */
function getActiveGameContext(): { gameId: CanonicalGameId | null } {
  return { gameId: null };
}

let cached: WispQuickSlotController | null = null;

/**
 * Clears the production controller's pending-consent/freeze-intent state
 * (Increment 5 closeout, Phase A) without ever constructing the controller
 * if it does not exist yet — shutdown and feature-disable must not have the
 * side effect of lazily standing up Wisp hotkey infrastructure that was
 * never otherwise touched this session.
 */
export function disposeAdaptiveWispQuickSlotController(): void {
  if (cached) cached.dispose();
}

/** Returns the single production Adaptive Wisp quick-slot hotkey controller instance. */
export function getAdaptiveWispQuickSlotController(): WispQuickSlotController {
  if (!cached) {
    const registry = createWispProfileRegistry();
    const contextProvider = createSessionMonitorContextProvider(() => {
      // Read-only status check (Section 50 of Increment 3) — never start()/stop().
      getSessionMonitor().getStatus();
      return getActiveGameContext();
    });
    const identityBridge = createCatalogGameIdentityBridge();
    const entryLookup = createCheatSystemEntryLookup(identityBridge);
    const activeProfileProvider = createWispActiveProfileProvider({
      getCurrentContext: () => contextProvider.getCurrentContext(),
      resolveProfile: (context) => resolveWispProfileForGame(registry, app.getPath('userData'), context),
      entryLookup,
    });

    cached = createWispQuickSlotController({
      activeProfileProvider,
      getCurrentContext: () => contextProvider.getCurrentContext(),
      executorDeps: {
        entryLookup,
        identityBridge,
        trainerAdapter: getAdaptiveWispExecutionAdapter(),
      },
    });
  }
  return cached;
}
