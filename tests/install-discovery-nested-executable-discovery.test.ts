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
    // Genuinely 2 primaries — resolvePrimaryExecutable still fails closed
    // rather than arbitrarily picking one, since "single primary" cannot be
    // asserted here; callers needing one specific build must use catalog
    // executable order or another explicit signal, not this function.
    assert.equal(resolvePrimaryExecutable(root, { knownCatalogExecutables: ['Game32.exe', 'Game64.exe'] }), undefined);
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
