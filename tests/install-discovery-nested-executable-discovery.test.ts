import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  discoverGameExecutables,
  resolvePrimaryExecutable,
} from '../src/core/install-discovery/nested-executable-discovery.ts';

let tmpRoot: string;

function makeInstall(name: string, files: string[]): string {
  const root = path.join(tmpRoot, name);
  for (const relative of files) {
    const filePath = path.join(root, relative);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'MZ');
  }
  return root;
}

describe('discoverGameExecutables / resolvePrimaryExecutable', () => {
  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-nested-exe-'));
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('finds a nested primary executable (Binaries/Win64-style structure), not just root-level files', () => {
    const root = makeInstall('nested-primary', ['Binaries/Win64/Game-Win64-Shipping.exe']);
    const primary = resolvePrimaryExecutable(root);
    assert.ok(primary);
    assert.equal(primary?.relativePath, 'Binaries/Win64/Game-Win64-Shipping.exe');
    assert.equal(primary?.role, 'PRIMARY_GAME');
  });

  test('finds executables across multiple different depths in the same install', () => {
    const root = makeInstall('multi-depth', [
      'Launcher.exe',
      'bin/x64/Game.exe',
      'bin/x64/tools/deep/GameConfigTool.exe',
    ]);
    const all = discoverGameExecutables(root);
    assert.equal(all.length, 3);
    assert.deepEqual(
      all.map((e) => e.relativePath),
      ['Launcher.exe', 'bin/x64/Game.exe', 'bin/x64/tools/deep/GameConfigTool.exe'],
      'must be sorted by depth ascending, not filesystem enumeration order',
    );
    assert.equal(all[0].role, 'LAUNCHER');
    assert.equal(all[1].role, 'PRIMARY_GAME');
    assert.equal(all[2].role, 'TOOL');
  });

  test('a launcher named after the game itself is classified by its containing directory, not left ambiguous with the real engine binary (Atomfall evidence)', () => {
    // Real, evidenced GDK/Xbox packaging shape: the launcher/bootstrap binary
    // shares the game's own name and contains no role keyword in its
    // filename at all — only its parent directory ("Launcher") signals its
    // role. Before this fix, both files classified as bare GAME_CANDIDATEs
    // (2 unrelated game-like candidates, no catalog evidence) and the whole
    // install failed closed to UNKNOWN/no-primary. Generic: any title with
    // this folder convention resolves correctly now, not just Atomfall.
    const root = makeInstall('launcher-named-like-game', [
      'Launcher/Atomfall.exe',
      'bin/Atomfall_dx12.exe',
    ]);
    const all = discoverGameExecutables(root);
    const launcher = all.find((e) => e.relativePath === 'Launcher/Atomfall.exe');
    const engine = all.find((e) => e.relativePath === 'bin/Atomfall_dx12.exe');
    assert.equal(launcher?.role, 'LAUNCHER', 'the folder name alone must be enough to classify the launcher');
    assert.equal(engine?.role, 'PRIMARY_GAME', 'the real engine binary must resolve as the sole game candidate');

    const primary = resolvePrimaryExecutable(root);
    assert.equal(primary?.relativePath, 'bin/Atomfall_dx12.exe');
  });

  test('unrelated helper executables (crash reporter, updater) never become the resolved primary', () => {
    const root = makeInstall('with-helpers', [
      'GameCrashReporter.exe',
      'GameUpdater.exe',
      'client/Game.exe',
    ]);
    const primary = resolvePrimaryExecutable(root);
    assert.equal(primary?.relativePath, 'client/Game.exe');
  });

  test('deterministic selection: repeated calls on the same install produce the identical result', () => {
    const root = makeInstall('deterministic', ['a/Game.exe', 'a/Launcher.exe', 'a/b/Tool.exe']);
    const first = discoverGameExecutables(root);
    const second = discoverGameExecutables(root);
    assert.deepEqual(first, second);
  });

  test('no executable found returns an empty list and no primary, not a throw', () => {
    const root = makeInstall('no-exe', ['readme.txt', 'data/config.json']);
    assert.deepEqual(discoverGameExecutables(root), []);
    assert.equal(resolvePrimaryExecutable(root), undefined);
  });

  test('multiple valid game executables (no catalog evidence) fail closed on primary, but both are still reported', () => {
    const root = makeInstall('multi-valid', ['x86/Game32.exe', 'x64/Game64.exe']);
    const all = discoverGameExecutables(root);
    assert.equal(all.length, 2);
    assert.ok(all.every((e) => e.role === 'UNKNOWN'));
    assert.equal(resolvePrimaryExecutable(root), undefined);
  });

  test('multiple valid game executables ARE resolved when catalog knows both (both PRIMARY_GAME, no false single-primary)', () => {
    const root = makeInstall('multi-valid-known', ['x86/Game32.exe', 'x64/Game64.exe']);
    const all = discoverGameExecutables(root, { knownCatalogExecutables: ['Game32.exe', 'Game64.exe'] });
    assert.ok(all.every((e) => e.role === 'PRIMARY_GAME'));
    // Genuinely 2 primaries, neither an Unreal Shipping binary, and the
    // caller has NOT opted into trustDeclaredExecutableOrder (this fixture's
    // array order carries no verified meaning) — no evidence to break the
    // tie, so resolvePrimaryExecutable still fails closed rather than
    // arbitrarily picking one.
    assert.equal(resolvePrimaryExecutable(root, { knownCatalogExecutables: ['Game32.exe', 'Game64.exe'] }), undefined);
  });

  test('declared-order tie-break is opt-in only: an unopted-in caller still fails closed even with a hand-ordered list', () => {
    const root = makeInstall('multi-valid-known-no-opt-in', ['x86/Game32.exe', 'x64/Game64.exe']);
    assert.equal(
      resolvePrimaryExecutable(root, {
        knownCatalogExecutables: ['Game32.exe', 'Game64.exe'],
        trustDeclaredExecutableOrder: false,
      }),
      undefined,
    );
  });

  // Real-game regression (Baldur's Gate 3, Steam appid 1086940 — one of the
  // ROADMAP.md Phase 3 Exit Gate's 7 curated titles): the real install ships
  // TWO fully independent, equally-real, independently-launchable game
  // binaries at bin/bg3.exe (Vulkan, default) and bin/bg3_dx11.exe (DX11
  // fallback) — unlike Palworld, neither name carries an engine-level
  // naming convention to prefer one. steam-executable-lookup.ts's
  // hand-authored ['bg3.exe', 'bg3_dx11.exe'] is the only real evidence
  // available, so a caller who has verified that source (steam.ts) may opt
  // into trusting its declared order.
  test('declared executable order resolves the primary when opted in (Baldur\'s Gate 3 real-install shape)', () => {
    const root = makeInstall('bg3-declared-order', ['bin/bg3.exe', 'bin/bg3_dx11.exe']);
    const primary = resolvePrimaryExecutable(root, {
      knownCatalogExecutables: ['bg3.exe', 'bg3_dx11.exe'],
      trustDeclaredExecutableOrder: true,
    });
    assert.equal(primary?.relativePath, 'bin/bg3.exe');
  });

  test('declared-order tie-break still fails closed when the declared name matches none of the real candidates', () => {
    const root = makeInstall('bg3-declared-order-no-match', ['bin/other1.exe', 'bin/other2.exe']);
    assert.equal(
      resolvePrimaryExecutable(root, {
        knownCatalogExecutables: ['bg3.exe', 'other1.exe', 'other2.exe'],
        trustDeclaredExecutableOrder: true,
      }),
      undefined,
      'declared name "bg3.exe" matches none of the real candidates — must not fall back to guessing',
    );
  });

  // Real-game regression (Palworld, Steam appid 1623730 — one of the
  // ROADMAP.md Phase 3 Exit Gate's 7 curated titles): the actual install
  // ships BOTH a root-level wrapper (Palworld.exe) and the nested Unreal
  // Engine cooked binary (Pal/Binaries/Win64/Palworld-Win64-Shipping.exe).
  // The catalog legitimately lists both names as valid executables for the
  // same game, so both classify PRIMARY_GAME — resolvePrimaryExecutable
  // must not fail closed here the way it correctly does for genuinely
  // unrelated candidates (the test above): the Shipping-suffixed binary is
  // the real, evidence-backed choice.
  test('Unreal Engine Shipping binary is preferred over a same-name root wrapper when catalog knows both (Palworld real-install shape)', () => {
    const root = makeInstall('ue-shipping-preference', [
      'Palworld.exe',
      'Pal/Binaries/Win64/Palworld-Win64-Shipping.exe',
      'Engine/Binaries/Win64/EpicWebHelper.exe',
    ]);
    const primary = resolvePrimaryExecutable(root, {
      knownCatalogExecutables: ['Palworld-Win64-Shipping.exe', 'Palworld.exe'],
    });
    assert.equal(primary?.relativePath, 'Pal/Binaries/Win64/Palworld-Win64-Shipping.exe');
  });

  test('maxDepth: 0 restricts discovery to the root directory itself, never a nested sibling install', () => {
    // Exact shape of a "library root containing multiple game folders" scan:
    // a root-level check must never reach into a sibling game's nested exe
    // and misreport it as installed at the library root.
    const root = makeInstall('library-root', ['SomeGame/bin/x64/Game.exe']);
    assert.deepEqual(discoverGameExecutables(root, { maxDepth: 0 }), []);
    assert.equal(resolvePrimaryExecutable(root, { maxDepth: 0 }), undefined);
  });

  test('a directory tree deeper than maxDepth is not descended into', () => {
    const root = makeInstall('too-deep', ['a/b/c/d/e/f/g/TooDeep.exe']);
    const all = discoverGameExecutables(root, { maxDepth: 3 });
    assert.deepEqual(all, []);
  });

  test('ignored directories (e.g. bundled redistributable installers) are pruned, not scanned', () => {
    const root = makeInstall('with-redist', ['_CommonRedist/vcredist/VC_redist.x64.exe', 'Game.exe']);
    const all = discoverGameExecutables(root);
    assert.equal(all.length, 1);
    assert.equal(all[0].relativePath, 'Game.exe');
  });

  test('an unreadable/missing install path returns an empty list rather than throwing', () => {
    assert.deepEqual(discoverGameExecutables(path.join(tmpRoot, 'does-not-exist')), []);
  });
});
