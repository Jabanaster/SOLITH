/**
 * Adaptive Wisp Increment 5/6 — production quick-slot hotkey composition.
 *
 * One well-defined construction point for the real WispQuickSlotController,
 * mirroring adaptive-wisp-execution-composition.ts's pattern: not registered
 * with ipcMain, imported by no preload script, reachable from no renderer.
 * The only caller is electron/trainer-hotkeys.ts's wisp_slot_N callback.
 *
 * Increment 6 Tasks 1-4 independent review (Finding 1/2, fixed here):
 * `getActiveGameContext()` now cross-verifies the OBSERVED attached process
 * against the claimed game's OWN registered installations
 * (listInstallationsForGame, unchanged) and against LiveMemorySession's own
 * actually-attached PID (getActiveLiveMemorySessionBundle, unchanged) — a
 * renderer-supplied gameId that merely exists in the canonical registry is
 * no longer sufficient on its own. See live-canonical-game-resolver.ts's
 * doc comment for the full defect trace and fix rationale.
 *
 * Registry population (Task 4): `populateWispProfileRegistry` is called
 * with a real, non-fabricated Atomfall profile (Atomfall's schema.v1
 * memory-feature id `atomfall-current-weapon-ammo`, sourced from the
 * existing reviewed bundled definition — see
 * buildAtomfallWispProfileIfLinked's own doc comment) WHEN, and only when,
 * a real canonical game row has already been linked to catalogGameId
 * `'atomfall'` by the existing, unchanged install-discovery/migration
 * pipeline. In a fresh database with no real Atomfall installation ever
 * detected, that linkage does not exist yet and population is correctly
 * empty — this is real dynamic production wiring, not a placeholder.
 *
 * Documented, unresolved gap (NOT fabricated around — see this closeout's
 * report): even with a real profile and a verified game identity, this
 * specific action will resolve to `availability: 'missing-entry'`, not
 * `'available'`, because cheat-system's CheatDefinition catalog
 * (games.ts's atomfallCheats) and schema.v1's memoryFeatures catalog use
 * completely disjoint entry-id namespaces for Atomfall — no id exists in
 * both. This is a pre-existing gap between two catalogs neither owned by
 * nor safely reconcilable within this directive (closing it either means
 * inventing an unreviewed CheatDefinition, which the standing
 * anti-fabrication instruction forbids, or merging two catalog schemas,
 * which is a separate, much larger, separately-authorized task).
 */
import { getSessionMonitor } from '../src/core/v2/session-monitor.js';
import { getCanonicalGame, findCanonicalGameByCatalogGameId, listInstallationsForGame } from '../src/core/canonical-games/store.js';
import type { CanonicalGameId } from '../src/core/adaptive-wisp/types.js';
import { createSessionMonitorContextProvider } from '../src/core/adaptive-wisp/session-monitor-context-provider.js';
import { createCatalogGameIdentityBridge } from '../src/core/adaptive-wisp/catalog-game-identity-bridge.js';
import { createCheatSystemEntryLookup } from '../src/core/adaptive-wisp/cheat-system-entry-lookup.js';
import { createWispActiveProfileProvider } from '../src/core/adaptive-wisp/active-profile-provider.js';
import { createWispQuickSlotController, type WispQuickSlotController } from '../src/core/adaptive-wisp/quick-slot-controller.js';
import { createWispProfileRegistry } from '../src/core/adaptive-wisp/registry.js';
import { populateWispProfileRegistry } from '../src/core/adaptive-wisp/registry-population.js';
import { buildAtomfallWispProfileIfLinked } from '../src/core/adaptive-wisp/certified-profiles.js';
import { resolveLiveCanonicalGameIdentity, type WispCanonicalGameLookupResult } from '../src/core/adaptive-wisp/live-canonical-game-resolver.js';
import { resolveWispProfileForGame } from '../src/core/adaptive-wisp/user-state-service.js';
import { getAdaptiveWispExecutionAdapter } from './adaptive-wisp-execution-composition.js';
import { getActiveLiveMemorySessionBundle } from './live-memory-ipc.js';
import { app } from 'electron';

/**
 * Exact, non-fuzzy lookup against the real canonical-games store (SQLite
 * primary-key query), extended in this closeout to also return that game's
 * own registered installation data so the resolver can verify the OBSERVED
 * process actually belongs to it, not merely that the id exists.
 */
function lookupCanonicalGame(candidateId: string): WispCanonicalGameLookupResult | null {
  const game = getCanonicalGame(candidateId);
  if (!game) return null;
  const installations = listInstallationsForGame(game.id);
  return {
    canonicalGameId: game.id as CanonicalGameId,
    registeredExecutables: installations.map((installation) => ({
      executablePath: installation.executablePath,
      processNames: installation.processNames,
    })),
  };
}

/**
 * Increment 6 — real attached-process -> canonical-game resolution. Reads
 * the V2 Session Monitor's current status (read-only; never start()/stop()
 * from here, per Section 50 of Increment 3) and LiveMemorySession's own
 * actually-attached pid (read-only accessor, never used to attach/detach
 * anything from here), and hands both to the pure resolver along with the
 * exact canonical-games lookup above. Returns "no active game" on every
 * failure/ambiguity/mismatch path — the whole reviewed hotkey chain already
 * treats that as the safe, harmless "no active session" case.
 */
function getActiveGameContext(): { gameId: CanonicalGameId | null } {
  const status = getSessionMonitor().getStatus();
  const liveMemoryAttachedPid = getActiveLiveMemorySessionBundle()?.session.getAttachedPid() ?? null;
  const resolved = resolveLiveCanonicalGameIdentity(status.snapshot, status.config, lookupCanonicalGame, liveMemoryAttachedPid);
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

/**
 * Builds today's real, non-fabricated production candidate list: exactly
 * one profile if (and only if) install-discovery has already linked a real
 * canonical game to catalogGameId 'atomfall'; otherwise empty. See this
 * file's top-of-file comment and certified-profiles.ts's own doc comment.
 */
function buildProductionProfileCandidates(): unknown[] {
  const atomfallCanonical = findCanonicalGameByCatalogGameId('atomfall');
  if (!atomfallCanonical) return [];
  const profile = buildAtomfallWispProfileIfLinked(atomfallCanonical.id as CanonicalGameId);
  return profile ? [profile] : [];
}

/** Returns the single production Adaptive Wisp quick-slot hotkey controller instance. */
export function getAdaptiveWispQuickSlotController(): WispQuickSlotController {
  if (!cached) {
    const registry = createWispProfileRegistry();
    populateWispProfileRegistry(registry, buildProductionProfileCandidates());
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
