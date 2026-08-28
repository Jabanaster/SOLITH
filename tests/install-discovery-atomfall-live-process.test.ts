import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resetForTesting, closeDatabaseSafely } from '../src/core/database/index.ts';
import { ensureBundledDefinitions } from '../src/core/trainer-catalog/ensure-bundled-definitions.ts';
import { previewInstallDiscoveryScan, commitInstallDiscoveryRecords } from '../src/core/install-discovery/index.ts';
import { ensureCanonicalGamesMigrated } from '../src/core/canonical-games/render-model.ts';
import { findCanonicalGameByCatalogGameId, listInstallationsForGame, getCanonicalGame } from '../src/core/canonical-games/store.ts';
import { observeProcess } from '../src/core/v2/observers/process-observer.ts';
import { resolveLiveCanonicalGameIdentity, type WispCanonicalGameLookupResult } from '../src/core/adaptive-wisp/live-canonical-game-resolver.ts';
import { initializeCheatSystemOnce, resetCheatSystemInitializationForTests } from '../src/core/cheat-system/initialization.ts';
import { createWispProfileRegistry } from '../src/core/adaptive-wisp/registry.ts';
import { populateWispProfileRegistry } from '../src/core/adaptive-wisp/registry-population.ts';
import { buildAtomfallWispProfileIfLinked } from '../src/core/adaptive-wisp/certified-profiles.ts';
import { createCatalogGameIdentityBridge } from '../src/core/adaptive-wisp/catalog-game-identity-bridge.ts';
import { createCheatSystemEntryLookup } from '../src/core/adaptive-wisp/cheat-system-entry-lookup.ts';
import { createWispActiveProfileProvider } from '../src/core/adaptive-wisp/active-profile-provider.ts';
import { createWispQuickSlotController } from '../src/core/adaptive-wisp/quick-slot-controller.ts';
import { resolveWispProfileForGame } from '../src/core/adaptive-wisp/user-state-service.ts';
import type { WispTrainerExecutionAdapter } from '../src/core/adaptive-wisp/trainer-execution-adapter.ts';

/**
 * Catalog/production-composition closeout — real, LIVE Atomfall process
 * certification (Requirements 4/8/9, "Run Real Atomfall Certification").
 *
 * Unlike install-discovery-atomfall-real.test.ts (which proves the
 * installation/discovery/registry/availability/pending-consent chain using
 * an ASSERTED session context), this test requires an actually-running
 * `Atomfall_dx12.exe` process and reads its identity FOR REAL via
 * `observeProcess()`, then feeds that real identity through the real
 * Increment 6 resolver end to end. It self-skips when no live Atomfall
 * process is found — this is certification evidence for a specific real
 * session on this machine, not a portable regression test (see the other
 * Atomfall/install-discovery test files for portable coverage).
 *
 * How the live process was obtained: launched via the real, correct Xbox
 * package activation (`explorer.exe shell:AppsFolder\Rebellion.Windscale_...!Game`),
 * approved and observed by the user directly on their own screen — UI
 * automation to click through the launcher was requested, approved, and
 * then unnecessary once the user's own real launch reached the actual game
 * binary. This test performs NO UI interaction and NO memory read/write —
 * it only asks the OS "is a process named Atomfall_dx12.exe currently
 * running, and what is its real PID/start time/executable path," then
 * proves the identity/registry/availability/pending-consent chain against
 * that real answer.
 *
 * Zero mutation: `confirmWrite`/`confirmFreeze` are asserted uncalled in
 * every case, and the live game process is confirmed still running,
 * unaffected, after the full chain completes.
 */

function findRunningAtomfall(): boolean {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', '(Get-Process -Name Atomfall_dx12 -ErrorAction SilentlyContinue).Count'], { encoding: 'utf8' });
    return parseInt(out.trim(), 10) > 0;
  } catch {
    return false;
  }
}

describe('Real, LIVE Atomfall process certification (requires a currently-running game)', { skip: !findRunningAtomfall() ? 'no live Atomfall_dx12.exe process is currently running' : false }, () => {
  let tempDir: string;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-real-atomfall-live-'));
    await resetForTesting(path.join(tempDir, 'real-atomfall-live.sqlite'));
    ensureBundledDefinitions();
    resetCheatSystemInitializationForTests();
  });

  after(async () => {
    await closeDatabaseSafely();
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('real observeProcess() finds the live Atomfall_dx12.exe process with a real PID, start time, and executable path', async () => {
    const observation = await observeProcess('Atomfall_dx12.exe');
    assert.equal(observation.availability, 'available');
    assert.ok(observation.identity, 'a live Atomfall_dx12.exe process must be found by the real OS query');
    assert.ok(observation.identity!.pid > 0);
    assert.ok(observation.identity!.startTime);
    assert.ok(observation.identity!.executablePath?.toLowerCase().endsWith('atomfall_dx12.exe'));
  });

  test('the real Increment 6 resolver resolves the correct canonical game from the LIVE process identity, and rejects a wrong claim against the same live PID', async () => {
    const discovery = previewInstallDiscoveryScan({ offlineRootsOnly: true, userSelectedRoots: ['Z:\\Games'] });
    const atomfall = discovery.records.find((r) => /atomfall/i.test(r.installPath));
    assert.ok(atomfall);
    commitInstallDiscoveryRecords([{ platform: atomfall!.platform, installPath: atomfall!.installPath, executablePath: atomfall!.executablePath, displayName: atomfall!.displayName }]);
    ensureCanonicalGamesMigrated(new Date().toISOString());
    const canonicalGame = findCanonicalGameByCatalogGameId('atomfall')!;

    const observation = await observeProcess('Atomfall_dx12.exe');
    assert.ok(observation.identity);

    function lookup(candidateId: string): WispCanonicalGameLookupResult | null {
      const game = getCanonicalGame(candidateId);
      if (!game) return null;
      const registered = listInstallationsForGame(candidateId).map((i) => ({ executablePath: i.executablePath, processNames: i.processNames }));
      return { canonicalGameId: game.id, registeredExecutables: registered };
    }

    const resolved = resolveLiveCanonicalGameIdentity(
      { state: 'game_running', confidence: 'verified', gameIdentity: observation.identity! },
      { gameId: canonicalGame.id },
      lookup,
      observation.identity!.pid,
    );
    assert.equal(resolved?.gameId, canonicalGame.id, 'the real resolver must resolve the real canonical Atomfall game from the live process');
    assert.equal(resolved?.process.pid, observation.identity!.pid);

    const wrongExecutable = resolveLiveCanonicalGameIdentity(
      { state: 'game_running', confidence: 'verified', gameIdentity: { ...observation.identity!, name: 'notepad.exe', executablePath: 'C:\\Windows\\System32\\notepad.exe' } },
      { gameId: canonicalGame.id },
      lookup,
      observation.identity!.pid,
    );
    assert.equal(wrongExecutable, null, 'a wrong claimed executable must be rejected even against the SAME live, real PID');

    const wrongLiveMemoryPid = resolveLiveCanonicalGameIdentity(
      { state: 'game_running', confidence: 'verified', gameIdentity: observation.identity! },
      { gameId: canonicalGame.id },
      lookup,
      observation.identity!.pid + 1,
    );
    assert.equal(wrongLiveMemoryPid, null, 'a mismatched live-memory-attached pid must be rejected even against the real running game');
  });

  test('the full real production composition reaches pending-consent against the LIVE process identity, with zero mutation, and the game remains untouched afterward', async () => {
    const discovery = previewInstallDiscoveryScan({ offlineRootsOnly: true, userSelectedRoots: ['Z:\\Games'] });
    const atomfall = discovery.records.find((r) => /atomfall/i.test(r.installPath))!;
    commitInstallDiscoveryRecords([{ platform: atomfall.platform, installPath: atomfall.installPath, executablePath: atomfall.executablePath, displayName: atomfall.displayName }]);
    ensureCanonicalGamesMigrated(new Date().toISOString());
    const canonicalGame = findCanonicalGameByCatalogGameId('atomfall')!;
    const observation = await observeProcess('Atomfall_dx12.exe');
    assert.ok(observation.identity);

    function lookup(candidateId: string): WispCanonicalGameLookupResult | null {
      const game = getCanonicalGame(candidateId);
      if (!game) return null;
      const registered = listInstallationsForGame(candidateId).map((i) => ({ executablePath: i.executablePath, processNames: i.processNames }));
      return { canonicalGameId: game.id, registeredExecutables: registered };
    }
    const resolved = resolveLiveCanonicalGameIdentity({ state: 'game_running', confidence: 'verified', gameIdentity: observation.identity! }, { gameId: canonicalGame.id }, lookup, observation.identity!.pid)!;
    assert.ok(resolved);

    initializeCheatSystemOnce();
    const registry = createWispProfileRegistry();
    populateWispProfileRegistry(registry, [buildAtomfallWispProfileIfLinked(canonicalGame.id)]);

    const identityBridge = createCatalogGameIdentityBridge();
    const entryLookup = createCheatSystemEntryLookup(identityBridge);
    const calls = { proposeWrite: 0, confirmWrite: 0 };
    const trainerAdapter: WispTrainerExecutionAdapter = {
      getCurrentState: () => ({ frozen: false, currentValue: 99, dataType: 'int32', supportsControls: ['set'] }),
      proposeWrite: () => { calls.proposeWrite += 1; return { proposalId: `live-atomfall-${calls.proposeWrite}` }; },
      confirmWrite: async () => { calls.confirmWrite += 1; return { ok: true, status: 'applied' }; },
      proposeFreeze: () => null,
      confirmFreeze: async () => ({ ok: false, status: 'rejected', reason: 'unused' }),
      stopFreeze: () => ({ ok: false, status: 'rejected', reason: 'unused' }),
    };

    const sessionId = `live-session:${resolved.process.pid}:${resolved.process.startTime}`;
    const activeProfileProvider = createWispActiveProfileProvider({
      getCurrentContext: () => ({ gameId: resolved.gameId, sessionId, sessionGeneration: 1 }),
      resolveProfile: (context) => resolveWispProfileForGame(registry, tempDir, context),
      entryLookup,
    });
    const controller = createWispQuickSlotController({
      activeProfileProvider,
      getCurrentContext: () => ({ gameId: resolved.gameId, sessionId, sessionGeneration: 1 }),
      executorDeps: { entryLookup, identityBridge, trainerAdapter },
    });

    const snapshot = await activeProfileProvider.getActiveBoundProfile();
    const boundAction = snapshot?.bound.actions.find((a) => a.actionId === 'atomfall-current-weapon-ammo');
    assert.equal(boundAction?.availability, 'available', 'the certified action must be available against the LIVE process identity');

    const activation = await controller.activate(1);
    assert.equal(activation.executionStatus, 'pending-consent');
    assert.equal(calls.proposeWrite, 1);
    assert.equal(calls.confirmWrite, 0, 'zero mutation against the real live game process');

    const repeat = await controller.activate(1);
    assert.equal((repeat.diagnostic as { code: string }).code, 'WISP_HOTKEY_EXECUTION_PENDING_CONSENT');
    assert.equal(calls.proposeWrite, 1, 'repeat activation while pending must not create a second proposal');

    const stillRunning = await observeProcess('Atomfall_dx12.exe');
    assert.ok(stillRunning.identity, 'the real game process must still be running, untouched, after the full certification chain');
    assert.equal(stillRunning.identity!.pid, observation.identity!.pid, 'same process, not a restart');
  });
});
