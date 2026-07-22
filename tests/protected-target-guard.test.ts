import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessProtectedTarget,
  assertProtectedTargetAllowed,
} from '../src/core/runtime/protected-target-guard.ts';

describe('protected target guard', () => {
  test('allows ordinary explicitly owned/offline process names and modules', () => {
    const assessment = assessProtectedTarget({
      process: { pid: 42, executableName: 'Avowed-WinGDK-Shipping.exe', selectedByUser: true },
      modules: [
        { name: 'Avowed-WinGDK-Shipping.exe', baseAddress: 0x1000n, size: 16 },
        { name: 'kernel32.dll', baseAddress: 0x2000n, size: 16 },
      ],
    });

    assert.equal(assessment.allowed, true);
    assert.equal(assessment.indicators.length, 0);
    assert.doesNotThrow(() =>
      assertProtectedTargetAllowed({
        process: { pid: 42, executableName: 'Avowed-WinGDK-Shipping.exe', selectedByUser: true },
        modules: [{ name: 'GameAssembly.dll', baseAddress: 0x1000n, size: 16 }],
      }),
    );
  });

  test('fails closed for known anti-cheat process indicators', () => {
    const assessment = assessProtectedTarget({
      process: { pid: 7, executableName: 'EasyAntiCheat_EOS.exe', selectedByUser: true },
    });

    assert.equal(assessment.allowed, false);
    assert.equal(assessment.indicators[0]?.category, 'anti_cheat');
    assert.match(assessment.reason, /fail closed/i);
  });

  test('fails closed for known anti-cheat module indicators', () => {
    const assessment = assessProtectedTarget({
      process: { pid: 9, executableName: 'OfflineGame.exe', selectedByUser: true },
      modules: [
        { name: 'OfflineGame.exe', baseAddress: 0x1000n, size: 16 },
        { name: 'BEService_x64.dll', baseAddress: 0x2000n, size: 16 },
      ],
    });

    assert.equal(assessment.allowed, false);
    assert.equal(assessment.indicators[0]?.vendor, 'BattlEye');
    assert.throws(
      () =>
        assertProtectedTargetAllowed({
          process: { pid: 9, executableName: 'OfflineGame.exe', selectedByUser: true },
          modules: [{ name: 'vgc.dll', baseAddress: 0x3000n, size: 16 }],
        }),
      /Protected target indicator/i,
    );
  });
});
