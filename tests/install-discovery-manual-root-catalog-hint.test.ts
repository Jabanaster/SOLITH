import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabaseSafely, initDatabase, resetForTesting } from '../src/core/database/index.ts';
import { previewInstallDiscoveryScan } from '../src/core/install-discovery/index.ts';
import { upsertCatalogEntry } from '../src/core/trainer-catalog/store.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

// Regression coverage for the non-Steam automatic-discovery gap documented
// in Docs/phase3/008 §4/§6a: a manually-scanned folder (Xbox/GDK PC Game
// Pass installs, or any other non-Steam library the user adds) previously
// got zero catalog hint at executable-resolution time, so any real install
// with 2+ unclassified candidate executables failed closed even when the
// catalog already had the answer. These fixtures reproduce that documented
// shape generically (never referencing the specific Atomfall title/paths).

function makeEntry(catalogGameId: string, displayName: string, executables: string[]): TrainerCatalogEntry {
  return {
    catalogGameId,
    displayName,
    executables,
    categories: ['Action'],
    verificationStatus: 'community',
    sources: [{ provider: 'mrantifun', url: `https://mrantifun.net/${catalogGameId}` }],
    hasModPack: false,
    cheatCount: 0,
    searchableText: displayName.toLowerCase(),
  };
}

describe('install-discovery manual-root catalog hint (non-Steam automatic discovery)', () => {
  let tempRoot = '';

  before(async () => {
    await initDatabase();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-manual-root-hint-'));
  });

  after(() => {
    if (tempRoot && path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()))) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('a single catalog-known nested executable resolves via the folder-name hint, where it previously failed closed', () => {
    upsertCatalogEntry(makeEntry('hint-single-exe-title', 'Hint Single Exe Title', ['HintSingleExeTitle.exe']));

    const gameDir = path.join(tempRoot, 'Hint Single Exe Title');
    // A real non-Steam packaged-game shape: an unclassified bootstrapper at
    // root (not caught by any launcher/tool/etc pattern) plus the real,
    // catalog-known binary nested — exactly the documented reproduction
    // shape, without referencing any specific real title.
    fs.mkdirSync(path.join(gameDir, 'Content', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'unclassifiedbootstrap.exe'), 'MZ');
    fs.writeFileSync(path.join(gameDir, 'Content', 'bin', 'HintSingleExeTitle.exe'), 'MZ');

    const preview = previewInstallDiscoveryScan({
      offlineRootsOnly: true,
      steamInstallPath: path.join(tempRoot, 'missing-steam'),
      userSelectedRoots: [tempRoot],
    });

    const record = preview.records.find((r) => r.installPath === path.resolve(gameDir));
    assert.ok(record, 'the install must be discovered at all (previously failed closed with no catalog hint)');
    assert.ok(
      record!.executablePath?.replace(/\\/g, '/').endsWith('Content/bin/HintSingleExeTitle.exe'),
      `expected the nested catalog-known binary, got: ${record!.executablePath}`,
    );
    assert.equal(record!.catalogGameId, 'hint-single-exe-title');
  });

  test('duplicate normalized display name is ambiguous even when BOTH duplicates carry executable metadata — NO HINT', () => {
    upsertCatalogEntry(makeEntry('hint-conflict-a', 'Hint Conflict Title', ['ConflictA.exe']));
    upsertCatalogEntry(makeEntry('hint-conflict-b', 'Hint Conflict Title', ['ConflictB.exe']));

    const gameDir = path.join(tempRoot, 'Hint Conflict Title');
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'RealGame.exe'), 'MZ');
    fs.writeFileSync(path.join(gameDir, 'OtherUnclassified.exe'), 'MZ');

    const preview = previewInstallDiscoveryScan({
      offlineRootsOnly: true,
      steamInstallPath: path.join(tempRoot, 'missing-steam'),
      userSelectedRoots: [tempRoot],
    });

    assert.equal(
      preview.records.some((r) => r.installPath === path.resolve(gameDir)),
      false,
      'a conflicting/ambiguous hint must never be used to force a resolution — the install must still fail closed exactly as it did with no hint at all',
    );
  });

  test('duplicate normalized display name is ambiguous even when only ONE duplicate carries executable metadata — NO HINT (not a tiebreak in its favor)', () => {
    // Entry A "looks more complete" (has real executable metadata); entry B
    // has none. The ambiguity check must never treat A as the "obvious"
    // winner just because it has data and B does not.
    upsertCatalogEntry(makeEntry('hint-asymmetric-a', 'Hint Asymmetric Title', ['AsymmetricReal.exe']));
    upsertCatalogEntry(makeEntry('hint-asymmetric-b', 'Hint Asymmetric Title', []));

    const gameDir = path.join(tempRoot, 'Hint Asymmetric Title');
    fs.mkdirSync(gameDir, { recursive: true });
    // The folder even contains the exact file entry A names — if the
    // ambiguity check incorrectly preferred "the duplicate that looks
    // launchable," this would wrongly resolve and match hint-asymmetric-a.
    fs.writeFileSync(path.join(gameDir, 'AsymmetricReal.exe'), 'MZ');
    fs.writeFileSync(path.join(gameDir, 'OtherUnclassified.exe'), 'MZ');

    const preview = previewInstallDiscoveryScan({
      offlineRootsOnly: true,
      steamInstallPath: path.join(tempRoot, 'missing-steam'),
      userSelectedRoots: [tempRoot],
    });

    assert.equal(
      preview.records.some((r) => r.installPath === path.resolve(gameDir)),
      false,
      'one duplicate having executable metadata (and the other having none) must not break the tie — still NO HINT, still fail closed',
    );
  });

  test('2+ catalog-known executables with no engine naming convention still fail closed (hints never override multi-candidate ambiguity)', () => {
    upsertCatalogEntry(makeEntry('hint-multi-known', 'Hint Multi Known Title', ['VariantOne.exe', 'VariantTwo.exe']));

    const gameDir = path.join(tempRoot, 'Hint Multi Known Title');
    fs.mkdirSync(path.join(gameDir, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'bin', 'VariantOne.exe'), 'MZ');
    fs.writeFileSync(path.join(gameDir, 'bin', 'VariantTwo.exe'), 'MZ');

    const preview = previewInstallDiscoveryScan({
      offlineRootsOnly: true,
      steamInstallPath: path.join(tempRoot, 'missing-steam'),
      userSelectedRoots: [tempRoot],
    });

    assert.equal(
      preview.records.some((r) => r.installPath === path.resolve(gameDir)),
      false,
      'the DB catalog\'s executables order is not verified curator-intentional (unlike steam.ts\'s hand-authored lookup table) — this must stay fail-closed, never picking by position or filename order',
    );
  });

  test('an unrelated real game folder elsewhere is unaffected by the hint mechanism', () => {
    const gameDir = path.join(tempRoot, 'Totally Unrelated Game');
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'TotallyUnrelatedGame.exe'), 'MZ');
    fs.mkdirSync(path.join(gameDir, 'Content', 'Paks'), { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'Content', 'Paks', 'Data.pak'), 'pak');

    const preview = previewInstallDiscoveryScan({
      offlineRootsOnly: true,
      steamInstallPath: path.join(tempRoot, 'missing-steam'),
      userSelectedRoots: [tempRoot],
    });

    const record = preview.records.find((r) => r.installPath === path.resolve(gameDir));
    assert.ok(record, 'a plain single-executable install with no catalog entry at all must still resolve exactly as before (no hint available, sole-candidate elimination unchanged)');
    assert.equal(record!.catalogGameId, undefined);
  });

  test('a hint naming a launcher-pattern executable is still rejected by executable-role validation — the hint assists discovery, it does not become identity evidence', () => {
    // The catalog (uniquely, unambiguously) says this folder's known
    // executable is "HintLeakLauncher.exe" — but that literal name matches
    // executable-role.ts's LAUNCHER_RE. classifySingleExecutable checks role
    // patterns UNCONDITIONALLY, before the "is this name catalog-known"
    // promotion ever applies (executable-role.ts), so a hint can never turn
    // a real launcher into an accepted PRIMARY_GAME/ALTERNATE_GAME. If the
    // hint mechanism ever leaked into identity/role authority, this would
    // wrongly resolve; instead the install must remain unresolved.
    upsertCatalogEntry(makeEntry('hint-leak-launcher', 'Hint Leak Launcher Title', ['HintLeakLauncher.exe']));

    const gameDir = path.join(tempRoot, 'Hint Leak Launcher Title');
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'HintLeakLauncher.exe'), 'MZ');

    const preview = previewInstallDiscoveryScan({
      offlineRootsOnly: true,
      steamInstallPath: path.join(tempRoot, 'missing-steam'),
      userSelectedRoots: [tempRoot],
    });

    assert.equal(
      preview.records.some((r) => r.installPath === path.resolve(gameDir)),
      false,
      'a catalog hint must never override the independent, authoritative executable-role check — a real launcher stays rejected even when the catalog names it as "known"',
    );
  });

  test('an empty catalog does not break plain (non-catalog) manual discovery — catalog failure/emptiness is not a new fatal path for unrelated installs', async () => {
    await resetForTesting();
    try {
      const gameDir = path.join(tempRoot, 'Empty Catalog Plain Game');
      // Matches the same supporting-evidence shape as the "unrelated real
      // game folder" fixture above — a bare .exe alone is correctly
      // rejected as insufficient game evidence regardless of catalog state
      // (see "tools and arbitrary executables..." in
      // trainer-library-preview-gates.test.ts); this test is about catalog
      // emptiness, not that unrelated gate.
      fs.mkdirSync(path.join(gameDir, 'Content', 'Paks'), { recursive: true });
      fs.writeFileSync(path.join(gameDir, 'EmptyCatalogPlainGame.exe'), 'MZ');
      fs.writeFileSync(path.join(gameDir, 'Content', 'Paks', 'Data.pak'), 'pak');

      const preview = previewInstallDiscoveryScan({
        offlineRootsOnly: true,
        steamInstallPath: path.join(tempRoot, 'missing-steam'),
        userSelectedRoots: [tempRoot],
      });

      const record = preview.records.find((r) => r.installPath === path.resolve(gameDir));
      assert.ok(record, 'discovery of a plain, catalog-less install must succeed identically whether the catalog has zero rows or thousands');
      assert.equal(record!.catalogGameId, undefined);
    } finally {
      await initDatabase();
    }
  });

  test('a catalog read failure propagates as a clean exception rather than silently corrupting or partially returning results (unchanged from before this hint was wired in — matchInstalledToCatalog always required the catalog to succeed)', async () => {
    await closeDatabaseSafely();
    try {
      assert.throws(
        () =>
          previewInstallDiscoveryScan({
            offlineRootsOnly: true,
            steamInstallPath: path.join(tempRoot, 'missing-steam'),
            userSelectedRoots: [tempRoot],
          }),
        /not initialized/i,
        'the catalog read is not newly wrapped in a swallow-and-continue path — it must still fail loudly, exactly as matchInstalledToCatalog\'s own (pre-existing, unmoved) catalog dependency always did',
      );
    } finally {
      await initDatabase();
    }
  });
});
