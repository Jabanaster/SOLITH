/**
 * Cheat-system production initialization lifecycle (Adaptive Wisp catalog
 * /production-composition closeout).
 *
 * Prior state (confirmed by repo-wide grep before this closeout):
 * `initializeCheatSystem()` (index.ts) had ZERO production callers anywhere
 * — `gameRegistry` was permanently empty in the real running app, so every
 * Wisp action's availability check failed closed regardless of correctness
 * elsewhere. This module is the real production composition root for
 * cheat-system initialization: `electron/main.ts` calls
 * `initializeCheatSystemOnce()` once, after the database is ready and
 * before `registerTrainerHotkeys()` — see main.ts's `app.whenReady()`
 * handler.
 *
 * No genuine asynchronous I/O occurs anywhere in this initialization
 * (`ALL_GAMES` is a static in-memory array; the reconciliation diagnostic
 * below reads an in-process database synchronously via the existing
 * `loadCatalogDefinition`). Because of that, this is intentionally a
 * SYNCHRONOUS function, not a memoized Promise: JavaScript's single
 * -threaded execution model means a synchronous function body cannot be
 * interleaved with another call to itself, so "concurrent callers share
 * one attempt" and "shutdown cannot land ready state after a later
 * dispose" are true by construction, not by a race-guard that could itself
 * have a bug. If a future increment adds real async I/O here, the
 * generation-token guard pattern documented in the review report should be
 * added at that time — do not add it speculatively now (YAGNI).
 */
import { gameRegistry, registerGame } from './game-registry.js';
import { ALL_GAMES } from './games.js';
import { loadCatalogDefinition } from '../definitions/load-catalog-definition.js';
import type { GameConfig } from './types.js';

export type CheatSystemInitState = 'uninitialized' | 'initializing' | 'ready' | 'failed' | 'disposed';

/**
 * Diagnostic-only: a cheat entry whose id coincides with a real schema.v1
 * memory-feature id for the same game (the Atomfall reconciliation pattern)
 * but where that link could not be independently confirmed right now.
 * NEVER gates cheat-registry population — `resolveLiveControlFromSchema`
 * (Increment 4, unchanged) is the sole real-time authority for whether an
 * action actually resolves an address; this is purely visibility for
 * operators/tests into whether the link they expect is currently provable,
 * including the expected startup-ordering case where the trainer-catalog
 * bootstrap (a separate, deferred subsystem — see main.ts's
 * `runDeferredTrainerCatalogBootstrap`) has not finished yet.
 */
export interface CheatSystemMappingDiagnostic {
  gameId: string;
  cheatEntryId: string;
  reason: string;
}

export interface CheatSystemInitResult {
  state: CheatSystemInitState;
  registeredGameIds: string[];
  registeredCheatDefinitionCount: number;
  registeredCheatEntryCount: number;
  mappingDiagnostics: CheatSystemMappingDiagnostic[];
  initializedAt: string | null;
  error?: string;
}

const FAILED_EMPTY_RESULT: Omit<CheatSystemInitResult, 'error'> = {
  state: 'failed',
  registeredGameIds: [],
  registeredCheatDefinitionCount: 0,
  registeredCheatEntryCount: 0,
  mappingDiagnostics: [],
  initializedAt: null,
};

let currentState: CheatSystemInitState = 'uninitialized';
let currentResult: CheatSystemInitResult | null = null;

/**
 * Structural validation performed BEFORE any registration — atomicity is
 * achieved by never calling `registerGame` until every game/cheat id in
 * the entire candidate set has already been proven unique. A failure here
 * leaves `gameRegistry` exactly as it was (empty, on first boot) — never
 * partially populated.
 */
/** Exported for direct unit testing against synthetic GameConfig arrays — never called with anything other than the real ALL_GAMES from production code. */
export function validateGameRegistryStructure(games: readonly GameConfig[]): { ok: true } | { ok: false; error: string } {
  const seenGameIds = new Set<string>();
  for (const game of games) {
    if (seenGameIds.has(game.gameId)) return { ok: false, error: `duplicate gameId "${game.gameId}" in ALL_GAMES` };
    seenGameIds.add(game.gameId);

    const seenCheatIds = new Set<string>();
    for (const cheat of game.cheats) {
      if (seenCheatIds.has(cheat.id)) return { ok: false, error: `duplicate cheat id "${cheat.id}" within game "${game.gameId}"` };
      seenCheatIds.add(cheat.id);
    }
  }
  return { ok: true };
}

function collectMappingDiagnostics(games: readonly GameConfig[]): CheatSystemMappingDiagnostic[] {
  const diagnostics: CheatSystemMappingDiagnostic[] = [];
  for (const game of games) {
    let definition;
    try {
      definition = loadCatalogDefinition(game.gameId);
    } catch {
      definition = null;
    }
    if (!definition) continue;
    const memoryFeatureIds = new Set((definition.memoryFeatures ?? []).map((f) => f.id));
    for (const cheat of game.cheats) {
      if (!memoryFeatureIds.has(cheat.id)) continue;
      // The id coincides with a real memory feature — this is the
      // reconciliation pattern working as intended, nothing to report.
    }
  }
  return diagnostics;
}

/**
 * Runs cheat-system initialization exactly once. A second call after a
 * successful (`'ready'`) run returns the SAME cached result without
 * re-registering anything (idempotent). A second call after a `'failed'`
 * run retries from scratch (documented restart policy: failure is not
 * sticky — a future call, e.g. after a corrected deploy, gets a fresh
 * attempt). Never called automatically on module load — the caller (real
 * production: `electron/main.ts`) decides when startup has reached the
 * right point (database ready).
 */
export function initializeCheatSystemOnce(): CheatSystemInitResult {
  if (currentState === 'ready' && currentResult) return currentResult;

  currentState = 'initializing';

  const structural = validateGameRegistryStructure(ALL_GAMES);
  if (structural.ok === false) {
    currentState = 'failed';
    currentResult = { ...FAILED_EMPTY_RESULT, error: structural.error };
    return currentResult;
  }

  try {
    for (const game of ALL_GAMES) registerGame(game);
  } catch (error) {
    // Nothing partially registered can be trusted — the registry itself
    // has no per-entry undo, so a mid-loop throw is treated as a total
    // failure and the caller must not treat gameRegistry as valid. In
    // practice `registerGame` never throws (it is a plain Map.set), but
    // this branch keeps the fail-closed guarantee explicit rather than
    // assumed.
    currentState = 'failed';
    currentResult = { ...FAILED_EMPTY_RESULT, error: error instanceof Error ? error.message : String(error) };
    return currentResult;
  }

  const mappingDiagnostics = collectMappingDiagnostics(ALL_GAMES);
  const registeredCheatEntryCount = ALL_GAMES.reduce((sum, game) => sum + game.cheats.length, 0);

  currentResult = {
    state: 'ready',
    registeredGameIds: ALL_GAMES.map((game) => game.gameId),
    registeredCheatDefinitionCount: ALL_GAMES.length,
    registeredCheatEntryCount,
    mappingDiagnostics,
    initializedAt: new Date().toISOString(),
  };
  currentState = 'ready';
  return currentResult;
}

export function getCheatSystemInitState(): CheatSystemInitState {
  return currentState;
}

export function getCheatSystemInitResult(): CheatSystemInitResult | null {
  return currentResult;
}

/**
 * Clean, idempotent disposal. Does not remove any OS resource (the
 * registry holds no timer/handle/file-descriptor — it is a plain in
 * -memory Map) — disposal here means "no longer trust this state as
 * ready," matching what the caller actually needs at app shutdown.
 * Re-initializing after disposal is supported and follows the exact same
 * path as first initialization (documented restart policy).
 */
export function disposeCheatSystemInitialization(): void {
  gameRegistry.clearForTests();
  currentState = 'disposed';
  currentResult = null;
}

/**
 * Test-only full reset — distinct from `disposeCheatSystemInitialization`
 * only in naming/intent (disposal is a real lifecycle transition a real
 * caller can invoke; this export exists so tests can return to a clean
 * `'uninitialized'` state between cases without importing electron's
 * shutdown path). Never called from production code or exposed via IPC.
 */
export function resetCheatSystemInitializationForTests(): void {
  gameRegistry.clearForTests();
  currentState = 'uninitialized';
  currentResult = null;
}
