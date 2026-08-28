import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetForTesting, closeDatabaseSafely } from '../src/core/database/index.ts';
import { previewInstallDiscoveryScan } from '../src/core/install-discovery/index.ts';

/**
 * Catalog/production-composition closeout — regression coverage for the
 * bounded-depth executable search fix.
 *
 * Root cause fixed: `scanShallowRoot`'s per-game executable lookup only
 * checked the immediate top level of each game folder, missing Xbox/
 * Microsoft Store-style layouts that nest the real binary under
 * `Content/bin/` (discovered against a real installed title —
 * see install-discovery-atomfall-real.test.ts). The fix added a
 * bounded-depth recursive search (`findGameExecutable`), but an initial
 * version of that fix applied the SAME deep search to the library-root
 * -itself check too, which then walked across sibling game folders and
 * mis-attributed one game's real binary to the whole library root —
 * corrupting deduplication (the spurious root-level record and the
 * correct per-child record shared the same `canonicalExecutablePath` and
 * the root-level one, appearing first, won). Both defects are covered
 * here with controlled, portable fixtures — no dependency on any specific
 * machine's drive layout.
 */

function makeGameFolder(root: string, name: string, relativeExePath: string[]): string {
  const gameDir = path.join(root, name);
  const exeDir = path.join(gameDir, ...relativeExePath.slice(0, -1));
  fs.mkdirSync(exeDir, { recursive: true });
  fs.writeFileSync(path.join(exeDir, relativeExePath[relativeExePath.length - 1]), Buffer.alloc(1024, 'x'));
  // A game_data_directory-style marker so the evidence scorer accepts the
  // candidate without needing catalog matching in this isolated test.
  fs.mkdirSync(path.join(gameDir, 'Content'), { recursive: true });
  return gameDir;
}

describe('install-discovery nested executable — bounded-depth scan fix', () => {
  let tempDir: string;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-nested-exe-fixture-'));
    await resetForTesting(':memory:');
  });

  after(async () => {
    await closeDatabaseSafely();
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('a game whose real executable is nested two levels deep (Xbox/Game-Pass-style layout) is discovered', () => {
    makeGameFolder(tempDir, 'NestedGameOne', ['Content', 'bin', 'NestedGameOne_dx12.exe']);
    const result = previewInstallDiscoveryScan({ offlineRootsOnly: true, userSelectedRoots: [tempDir] });
    const found = [...result.records, ...result.unsupported].find((r) => r.installPath.includes('NestedGameOne'));
    assert.ok(found, 'a game with its real binary nested under Content/bin must be discovered, not missed by a shallow single-level scan');
    assert.ok(found!.executablePath?.endsWith(path.join('Content', 'bin', 'NestedGameOne_dx12.exe')));
  });

  test('two sibling nested games under the same library root are each attributed to their OWN folder, never to the library root or to each other', () => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });
    makeGameFolder(tempDir, 'AlphaGame', ['Content', 'bin', 'AlphaGame_dx12.exe']);
    makeGameFolder(tempDir, 'BetaGame', ['Content', 'bin', 'BetaGame_dx12.exe']);

    const result = previewInstallDiscoveryScan({ offlineRootsOnly: true, userSelectedRoots: [tempDir] });
    const all = [...result.records, ...result.unsupported];

    const alpha = all.find((r) => r.installPath.endsWith('AlphaGame'));
    const beta = all.find((r) => r.installPath.endsWith('BetaGame'));
    assert.ok(alpha, 'AlphaGame must be discovered under its own install path');
    assert.ok(beta, 'BetaGame must be discovered under its own install path');
    assert.ok(alpha!.executablePath?.includes('AlphaGame'), 'AlphaGame\'s record must point at ITS OWN executable, not a sibling\'s');
    assert.ok(beta!.executablePath?.includes('BetaGame'), 'BetaGame\'s record must point at ITS OWN executable, not a sibling\'s');

    // The library root ITSELF must never appear as a spurious third "game"
    // pointing at either sibling's executable — the exact defect this
    // fix closed (a deep root-level scan previously picked up whichever
    // sibling's binary it found first and mis-attributed it to the root).
    const rootAsGame = all.find((r) => path.resolve(r.installPath) === path.resolve(tempDir));
    assert.equal(rootAsGame, undefined, 'the library root itself must never be reported as a game');
  });

  test('a single-game root (root itself IS the game folder) still resolves via the shallow single-level check', () => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    const soloRoot = path.join(os.tmpdir(), 'SoloGame');
    fs.mkdirSync(soloRoot, { recursive: true });
    fs.writeFileSync(path.join(soloRoot, 'SoloGame.exe'), Buffer.alloc(1024, 'x'));
    // A game-data-directory marker so the evidence scorer accepts the
    // candidate deterministically, independent of catalog matching.
    fs.mkdirSync(path.join(soloRoot, 'Data'), { recursive: true });

    try {
      const result = previewInstallDiscoveryScan({ offlineRootsOnly: true, userSelectedRoots: [soloRoot] });
      const all = [...result.records, ...result.unsupported];
      const found = all.find((r) => path.resolve(r.installPath) === path.resolve(soloRoot));
      assert.ok(found, `a root that IS itself a single game folder (executable at the top level) must still resolve. rejected=${JSON.stringify(result.rejected)}`);
      assert.ok(found!.executablePath?.endsWith('SoloGame.exe'));
    } finally {
      fs.rmSync(soloRoot, { recursive: true, force: true });
    }
  });
});
