/**
 * Adaptive Wisp Increment 5/6 — production quick-slot hotkey composition.
 *
 * One well-defined construction point for the real WispQuickSlotController,
 * mirroring adaptive-wisp-execution-composition.ts's pattern: not registered
 * with ipcMain, imported by no preload script, reachable from no renderer.
 * The only caller is electron/trainer-hotkeys.ts's wisp_slot_N callback.
 *
 * Increment 6 replaced the Increment 5 stub (`getActiveGameContext` always
 * returning `{gameId: null}`) with a real resolver — see getActiveGameContext
 * below. `createWispProfileRegistry()` is still populated with an EMPTY
 * candidate list (see populateWispProfileRegistry's own doc comment): this
 * repository has no bundled/authoritative Wisp profile data anywhere, and
 * inventing one to make this look more finished than it is would violate
 * this closeout's explicit anti-fabrication rule. The registry, resolver,
 * and hotkey layer are all real and fully wired; the app still has no real
 * profile to resolve into a bound action until a future increment supplies
 * one.
 */
import { getSessionMonitor } from '../src/core/v2/session-monitor.js';
import { getCanonicalGame } from '../src/core/canonical-games/store.js';
import type { CanonicalGameId } from '../src/core/adaptive-wisp/types.js';
import { createSessionMonitorContextProvider } from '../src/core/adaptive-wisp/session-monitor-context-provider.js';
import { createCatalogGameIdentityBridge } from '../src/core/adaptive-wisp/catalog-game-identity-bridge.js';
import { createCheatSystemEntryLookup } from '../src/core/adaptive-wisp/cheat-system-entry-lookup.js';
import { createWispActiveProfileProvider } from '../src/core/adaptive-wisp/active-profile-provider.js';
import { createWispQuickSlotController, type WispQuickSlotController } from '../src/core/adaptive-wisp/quick-slot-controller.js';
import { createWispProfileRegistry } from '../src/core/adaptive-wisp/registry.js';
import { populateWispProfileRegistry } from '../src/core/adaptive-wisp/registry-population.js';
import { resolveLiveCanonicalGameIdentity, type WispCanonicalGameLookupResult } from '../src/core/adaptive-wisp/live-canonical-game-resolver.js';
import { resolveWispProfileForGame } from '../src/core/adaptive-wisp/user-state-service.js';
import { getAdaptiveWispExecutionAdapter } from './adaptive-wisp-execution-composition.js';
import { app } from 'electron';

/**
 * Exact, non-fuzzy lookup against the real canonical-games store (SQLite
 * primary-key query — see canonical-games/store.ts's getCanonicalGame). The
 * pure resolver this feeds never sees the database itself, only this
 * injected function, so the resolver stays testable without a DB.
 */
function lookupCanonicalGame(candidateId: string): WispCanonicalGameLookupResult | null {
  const game = getCanonicalGame(candidateId);
  if (!game) return null;
  return { canonicalGameId: game.id as CanonicalGameId };
}

/**
 * Increment 6 — real attached-process -> canonical-game resolution. Reads
 * the V2 Session Monitor's current status (read-only; never start()/stop()
 * from here, per Section 50 of Increment 3) and hands it to the pure
 * resolver along with the exact canonical-games lookup above. Returns "no
 * active game" on every failure/ambiguity path (no monitor session running,
 * unattached lifecycle state, stale/contradictory evidence confidence, or a
 * candidate id that does not match any real canonical game) — the whole
 * reviewed hotkey chain already treats that as the safe, harmless "no
 * active session" case.
 */
function getActiveGameContext(): { gameId: CanonicalGameId | null } {
  const status = getSessionMonitor().getStatus();
  const resolved = resolveLiveCanonicalGameIdentity(status.snapshot, status.config, lookupCanonicalGame);
  return { gameId: resolved?.gameId ?? null };
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
    // See this file's top-of-file comment — no authoritative profile source
    // exists in this repository yet, so this is an honest empty population,
    // not a placeholder. populateWispProfileRegistry itself is real,
    // independently tested infrastructure.
    populateWispProfileRegistry(registry, []);
    const contextProvider = createSessionMonitorContextProvider(() => getActiveGameContext());
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
