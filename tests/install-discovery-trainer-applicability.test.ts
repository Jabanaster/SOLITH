import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkExecutableRoleApplicability } from '../src/core/install-discovery/trainer-applicability.ts';

describe('checkExecutableRoleApplicability', () => {
  test('a normal game executable is applicable', () => {
    const result = checkExecutableRoleApplicability('C:/Games/Foo/Game-Win64-Shipping.exe');
    assert.equal(result.applicable, true);
    assert.equal(result.role, 'PRIMARY_GAME');
  });

  test('a launcher is rejected as a trainer target, even with a full path', () => {
    const result = checkExecutableRoleApplicability('C:/Games/Foo/GameLauncher.exe');
    assert.equal(result.applicable, false);
    assert.equal(result.role, 'LAUNCHER');
    assert.equal(result.reason, 'wrong_executable_role');
  });

  test('an updater is rejected as a trainer target', () => {
    const result = checkExecutableRoleApplicability('GameUpdater.exe');
    assert.equal(result.applicable, false);
    assert.equal(result.role, 'UPDATER');
  });

  test('a dedicated server binary is rejected as a trainer target', () => {
    const result = checkExecutableRoleApplicability('Game_DedicatedServer.exe');
    assert.equal(result.applicable, false);
    assert.equal(result.role, 'SERVER');
  });

  test('an anti-cheat bootstrap is rejected as a trainer target', () => {
    const result = checkExecutableRoleApplicability('EasyAntiCheat.exe');
    assert.equal(result.applicable, false);
    assert.equal(result.role, 'ANTI_CHEAT_BOOTSTRAP');
  });
});
