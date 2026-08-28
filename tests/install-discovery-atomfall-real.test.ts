import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetForTesting, closeDatabaseSafely } from '../src/core/database/index.ts';
import { ensureBundledDefinitions } from '../src/core/trainer-catalog/ensure-bundled-definitions.ts';
import { previewInstallDiscoveryScan, commitInstallDiscoveryRecords } from '../src/core/install-discovery/index.ts';
import { ensureCanonicalGamesMigrated } from '../src/core/canonical-games/render-model.ts';
import { findCanonicalGameByCatalogGameId, listInstallationsForGame } from '../src/core/canonical-games/store.ts';
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
 * Catalog/production-composition closeout — real Atomfall correction.
 *
 * The prior closeout pass incorrectly concluded Atomfall was not installed
 * on this machine — that scan only checked default Steam library
 * locations. Atomfall IS installed, on a custom library root
 * (`Z:\Games\Atomfall`), as a Microsoft Store/Xbox package
 * (`appxmanifest.xml`/`MicrosoftGame.config` present; identity
 * `Rebellion.Windscale`, publisher Rebellion). This test proves the REAL
 * production discovery → commit → canonical-migration → cheat-registry →
 * Wisp-registry → availability → pending-consent chain against that real
 * installation — no `:memory:` database, no fixture standing in for
 * Atomfall.
 *
 * Root cause of the original miss (see index.ts's `findGameExecutable`/
 * `findImmediateExecutable` split and their doc comments): the shallow
 * per-game scan only checked the immediate top level of each game folder,
 * and this Xbox package nests its real binary two levels down
 * (`Content/bin/Atomfall_dx12.exe`). Fixed with a bounded-depth (5 levels,
 * 8,000-entry cap) search that also had to be kept OUT of the
 * library-root-itself check — an earlier version of this fix applied the
 * deep search there too and it walked across sibling game folders,
 * colliding with the per-child result during deduplication.
 *
 * This test is real-environment-dependent (skipped when `Z:\Games\Atomfall`
 * is absent, e.g. on a CI runner or a different machine) — it is
 * certification evidence for THIS machine's real installation, not a
 * portable regression test. `install-discovery-steam.test.ts` and friends
 * remain the portable, fixture-backed regression coverage for the scanner
 * logic itself.
 *
 * NOT covered here, and explicitly NOT claimed: a live, running
 * `Atomfall_dx12.exe` game process. Two real attempts were made during
 * this closeout — launching the binary directly (bypassing the Xbox
 * package activation context) exits near-instantly both times, and the
 * proper activation path (`explorer.exe shell:AppsFolder\...`) reaches a
 * real `Launcher\Atomfall.exe` process but requires manual EULA/menu
 * interaction to reach the actual game binary, which UI automation could
 * have driven — the user explicitly denied that access request. This is a
 * genuine, environment/consent-dependent limitation, not a technical
 * unwillingness: the identity-resolution and pending-consent chain below
 * is proven with the REAL Atomfall installation record standing in for
 * "verified attached process," using the SAME controlled-process pattern
 * `adaptive-wisp-process-backed-certification.test.ts` already established
 * for Increment 6's identity resolver.
 */

function isAtomfallInstalled(): boolean {
  return fs.existsSync('Z:\\Games\\Atomfall\\Content\\bin\\Atomfall_dx12.exe');
}

describe('Real Atomfall installation certification (environment-dependent)', { skip: !isAtomfallInstalled() ? 'Z:\\Games\\Atomfall not present on this machine' : false }, () => {
  let tempDir: string;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-real-atomfall-'));
    await resetForTesting(path.join(tempDir, 'real-atomfall.sqlite'));
    ensureBundledDefinitions();
    resetCheatSystemInitializationForTests();
  });

  after(async () => {
    await closeDatabaseSafely();
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('real filesystem discovery finds the real Atomfall installation under the custom Z:\\Games library root', () => {
    const result = previewInstallDiscoveryScan({ offlineRootsOnly: true, userSelectedRoots: ['Z:\\Games'] });
    const atomfall = result.records.find((r) => /atomfall/i.test(r.installPath));
    assert.ok(atomfall, 'real discovery must find the real Atomfall installation');
    assert.equal(atomfall?.executablePath, 'Z:\\Games\\Atomfall\\Content\\bin\\Atomfall_dx12.exe', 'must identify the real game binary, not the launcher or launch helper');
    assert.equal(atomfall?.catalogGameId, 'atomfall', 'must match the real bundled catalog entry via the Atomfall_dx12.exe alias');
    assert.equal(atomfall?.classificationReason, 'catalog_match');
  });

  test('unrelated real installations on the same machine are not misidentified as Atomfall', () => {
    const result = previewInstallDiscoveryScan({ offlineRootsOnly: true, userSelectedRoots: ['Z:\\Games'] });
    const nonAtomfall = result.records.filter((r) => !/atomfall/i.test(r.installPath) && r.catalogGameId === 'atomfall');
    assert.deepEqual(nonAtomfall, [], 'no other real installation on this machine may be matched to the atomfall catalog entry');
  });

  test('real discovery -> commit -> canonical-games migration persists a real, queryable installation record', () => {
    const result = previewInstallDiscoveryScan({ offlineRootsOnly: true, userSelectedRoots: ['Z:\\Games'] });
    const atomfall = result.records.find((r) => /atomfall/i.test(r.installPath));
    assert.ok(atomfall);

    const commitResult = commitInstallDiscoveryRecords([{ platform: atomfall!.platform, installPath: atomfall!.installPath, executablePath: atomfall!.executablePath, displayName: atomfall!.displayName }]);
    assert.equal(commitResult.added, 1);

    ensureCanonicalGamesMigrated(new Date().toISOString());
    const canonicalGame = findCanonicalGameByCatalogGameId('atomfall');
    assert.ok(canonicalGame, 'the real on-disk canonical_games table must contain the migrated Atomfall row');

    const installations = listInstallationsForGame(canonicalGame!.id);
    assert.equal(installations.length, 1);
    assert.equal(installations[0].executablePath, 'Z:\\Games\\Atomfall\\Content\\bin\\Atomfall_dx12.exe');

    // Idempotency: repeating discovery + commit + migration must not duplicate the record.
    const secondScan = previewInstallDiscoveryScan({ offlineRootsOnly: true, userSelectedRoots: ['Z:\\Games'] });
    const secondAtomfall = secondScan.records.find((r) => /atomfall/i.test(r.installPath));
    commitInstallDiscoveryRecords([{ platform: secondAtomfall!.platform, installPath: secondAtomfall!.installPath, executablePath: secondAtomfall!.executablePath, displayName: secondAtomfall!.displayName }]);
    ensureCanonicalGamesMigrated(new Date().toISOString());
    assert.equal(listInstallationsForGame(canonicalGame!.id).length, 1, 'rerunning discovery/commit/migration must not duplicate the installation record');
  });

  test('full real composition (real registries + real Atomfall installation) reaches pending-consent for the certified action', async () => {
    const result = previewInstallDiscoveryScan({ offlineRootsOnly: true, userSelectedRoots: ['Z:\\Games'] });
    const atomfall = result.records.find((r) => /atomfall/i.test(r.installPath))!;
    commitInstallDiscoveryRecords([{ platform: atomfall.platform, installPath: atomfall.installPath, executablePath: atomfall.executablePath, displayName: atomfall.displayName }]);
    ensureCanonicalGamesMigrated(new Date().toISOString());
    const canonicalGame = findCanonicalGameByCatalogGameId('atomfall')!;

    initializeCheatSystemOnce();
    const registry = createWispProfileRegistry();
    const population = populateWispProfileRegistry(registry, [buildAtomfallWispProfileIfLinked(canonicalGame.id)]);
    assert.equal(population.registered.length, 1);

    const identityBridge = createCatalogGameIdentityBridge();
    const entryLookup = createCheatSystemEntryLookup(identityBridge);
    const calls = { proposeWrite: 0, confirmWrite: 0 };
    const trainerAdapter: WispTrainerExecutionAdapter = {
      getCurrentState: () => ({ frozen: false, currentValue: 99, dataType: 'int32', supportsControls: ['set'] }),
      proposeWrite: () => { calls.proposeWrite += 1; return { proposalId: `real-atomfall-${calls.proposeWrite}` }; },
      confirmWrite: async () => { calls.confirmWrite += 1; return { ok: true, status: 'applied' }; },
      proposeFreeze: () => null,
      confirmFreeze: async () => ({ ok: false, status: 'rejected', reason: 'unused in this test' }),
      stopFreeze: () => ({ ok: false, status: 'rejected', reason: 'unused in this test' }),
    };

    // NOTE: the "attached process" context below is asserted, not observed
    // from a live Atomfall_dx12.exe process — see this file's top comment
    // for why a live gameplay process could not be certified this pass.
    // This does not weaken what IS proven here: real installation data,
    // real registries, real cheat-entry reconciliation, real availability
    // computation, and real (non-mocked) executor routing to
    // pending-consent — only the "is a real game process currently
    // running" fact is asserted rather than independently observed in this
    // specific test.
    const activeProfileProvider = createWispActiveProfileProvider({
      getCurrentContext: () => ({ gameId: canonicalGame.id, sessionId: 'real-atomfall-cert', sessionGeneration: 1 }),
      resolveProfile: (context) => resolveWispProfileForGame(registry, tempDir, context),
      entryLookup,
    });
    const controller = createWispQuickSlotController({
      activeProfileProvider,
      getCurrentContext: () => ({ gameId: canonicalGame.id, sessionId: 'real-atomfall-cert', sessionGeneration: 1 }),
      executorDeps: { entryLookup, identityBridge, trainerAdapter },
    });

    const snapshot = await activeProfileProvider.getActiveBoundProfile();
    const boundAction = snapshot?.bound.actions.find((a) => a.actionId === 'atomfall-current-weapon-ammo');
    assert.equal(boundAction?.availability, 'available', 'the reconciled cheat entry must resolve as available using the REAL discovered/migrated Atomfall installation');

    const activation = await controller.activate(1);
    assert.equal(activation.executionStatus, 'pending-consent');
    assert.equal(calls.proposeWrite, 1);
    assert.equal(calls.confirmWrite, 0, 'no mutation — this closeout forbids confirming the proposal');
  });
});
