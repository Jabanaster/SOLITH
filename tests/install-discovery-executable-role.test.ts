import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyExecutableRoles } from '../src/core/install-discovery/executable-role.ts';

describe('classifyExecutableRoles', () => {
  test('launcher + actual game: the launcher is not mistaken for the game', () => {
    const roles = classifyExecutableRoles(['GameLauncher.exe', 'Game-Win64-Shipping.exe']);
    assert.equal(roles.get('GameLauncher.exe'), 'LAUNCHER');
    assert.equal(roles.get('Game-Win64-Shipping.exe'), 'PRIMARY_GAME');
  });

  test('client + dedicated server: both classified distinctly, neither treated as equivalent', () => {
    const roles = classifyExecutableRoles(['GameClient.exe', 'Game_DedicatedServer.exe']);
    assert.equal(roles.get('GameClient.exe'), 'PRIMARY_GAME');
    assert.equal(roles.get('Game_DedicatedServer.exe'), 'SERVER');
  });

  test('benchmark + primary game are distinguished', () => {
    const roles = classifyExecutableRoles(['Game.exe', 'GameBenchmark.exe']);
    assert.equal(roles.get('Game.exe'), 'PRIMARY_GAME');
    assert.equal(roles.get('GameBenchmark.exe'), 'BENCHMARK');
  });

  test('alternate game binary (DX11/DX12 sibling) resolved via catalog-known executable', () => {
    const roles = classifyExecutableRoles(['Game.exe', 'Game_DX12.exe'], {
      knownCatalogExecutables: ['Game.exe'],
    });
    assert.equal(roles.get('Game.exe'), 'PRIMARY_GAME');
    assert.equal(roles.get('Game_DX12.exe'), 'ALTERNATE_GAME');
  });

  test('unknown executable role: two game-like candidates with no catalog evidence fail closed, not guessed', () => {
    const roles = classifyExecutableRoles(['Foo.exe', 'Bar.exe']);
    assert.equal(roles.get('Foo.exe'), 'UNKNOWN');
    assert.equal(roles.get('Bar.exe'), 'UNKNOWN');
  });

  test('updater, tool, and anti-cheat bootstrap are each classified correctly, not lumped into one bucket', () => {
    const roles = classifyExecutableRoles([
      'Game.exe',
      'GameUpdater.exe',
      'GameConfigTool.exe',
      'EasyAntiCheat.exe',
    ]);
    assert.equal(roles.get('Game.exe'), 'PRIMARY_GAME');
    assert.equal(roles.get('GameUpdater.exe'), 'UPDATER');
    assert.equal(roles.get('GameConfigTool.exe'), 'TOOL');
    assert.equal(roles.get('EasyAntiCheat.exe'), 'ANTI_CHEAT_BOOTSTRAP');
  });

  test('crash reporter is classified as TOOL, not confused with the game itself', () => {
    const roles = classifyExecutableRoles(['Game.exe', 'Game_CrashReporter.exe']);
    assert.equal(roles.get('Game_CrashReporter.exe'), 'TOOL');
  });

  test('a single executable with no special pattern is the primary game by elimination', () => {
    const roles = classifyExecutableRoles(['MyStrangelyNamedBinary.exe']);
    assert.equal(roles.get('MyStrangelyNamedBinary.exe'), 'PRIMARY_GAME');
  });

  test('every input executable appears exactly once in the result — none silently dropped', () => {
    const inputs = ['A.exe', 'ALauncher.exe', 'AUpdater.exe', 'ABenchmark.exe', 'AServer.exe', 'Unrelated.exe'];
    const roles = classifyExecutableRoles(inputs);
    assert.equal(roles.size, inputs.length);
    for (const name of inputs) assert.ok(roles.has(name), `missing classification for ${name}`);
  });

  test('multiple catalog-known executables are all PRIMARY_GAME (e.g. 32-bit and 64-bit both shipped)', () => {
    const roles = classifyExecutableRoles(['Game32.exe', 'Game64.exe', 'GameOther.exe'], {
      knownCatalogExecutables: ['Game32.exe', 'Game64.exe'],
    });
    assert.equal(roles.get('Game32.exe'), 'PRIMARY_GAME');
    assert.equal(roles.get('Game64.exe'), 'PRIMARY_GAME');
    assert.equal(roles.get('GameOther.exe'), 'ALTERNATE_GAME');
  });
});
