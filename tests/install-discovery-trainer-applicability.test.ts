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

  // Regression (Docs/phase3/008 §6b): checkExecutableRoleApplicability
  // previously classified a single unrecognized executable name via
  // classifyExecutableRoles' "sole candidate, no evidence -> primary by
  // elimination" rule, which is only sound when there truly are no other
  // real candidates to compare against — but this function is called on
  // one path with no visibility into whether that's actually true. Fixed by
  // giving the specific real, evidenced GDK bootstrap binary its own
  // classification (executable-role.ts's SDK_HELPER_RE), not by changing
  // the elimination default itself (which remains correct for genuinely
  // single-executable real games — see the two tests below).
  test('a real non-game executable is rejected even when it is the sole candidate given to this check', () => {
    const result = checkExecutableRoleApplicability('Z:/Games/SomeGdkTitle/Content/gamelaunchhelper.exe');
    assert.equal(result.applicable, false);
    assert.equal(result.role, 'TOOL');
    assert.equal(result.reason, 'wrong_executable_role');
  });

  test('a legitimate single-executable game still succeeds as the sole candidate (elimination default unchanged)', () => {
    const result = checkExecutableRoleApplicability('Z:/Games/SomeTitle/DREDGE.exe');
    assert.equal(result.applicable, true);
    assert.equal(result.role, 'PRIMARY_GAME');
  });
});
