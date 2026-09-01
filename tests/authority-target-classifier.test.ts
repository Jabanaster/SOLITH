import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyProcessTarget } from '../src/core/authority/target-classifier.js';
import { classifyPathTarget } from '../src/core/authority/path-target-classifier.js';
import type { RuntimeProcessSummary } from '../src/core/runtime/process-discovery.js';

function proc(overrides: Partial<RuntimeProcessSummary> = {}): RuntimeProcessSummary {
  return { pid: 5555, executableName: 'game.exe', executablePath: 'C:\\Games\\game.exe', ...overrides } as RuntimeProcessSummary;
}

describe('classifyProcessTarget', () => {
  test('self process classified self + blocked', () => {
    const result = classifyProcessTarget({ process: proc({ executableName: 'solith.exe' }), pid: process.pid });
    assert.equal(result.targetClass, 'self');
    assert.equal(result.protectedTargetState, 'blocked');
  });

  test('system process classified system + blocked', () => {
    const result = classifyProcessTarget({ process: proc({ executableName: 'lsass.exe' }), pid: 999 });
    assert.equal(result.targetClass, 'system');
    assert.equal(result.protectedTargetState, 'blocked');
  });

  test('anti-cheat process classified anti_cheat + blocked', () => {
    const result = classifyProcessTarget({ process: proc({ executableName: 'BEService.exe' }), pid: 4321 });
    assert.equal(result.targetClass, 'anti_cheat');
    assert.equal(result.protectedTargetState, 'blocked');
  });

  test('known catalog game classified supported_game + clear', () => {
    const result = classifyProcessTarget({ process: proc(), pid: 4321, isKnownCatalogGame: true });
    assert.equal(result.targetClass, 'supported_game');
    assert.equal(result.protectedTargetState, 'clear');
  });

  test('unrecognized-but-clean process classified unknown_process + clear (SOL-0 G3: not silently narrowed)', () => {
    const result = classifyProcessTarget({ process: proc({ executableName: 'notepad.exe' }), pid: 4321 });
    assert.equal(result.targetClass, 'unknown_process');
    assert.equal(result.protectedTargetState, 'clear');
  });

  test('target detail carries pid, not secrets', () => {
    const result = classifyProcessTarget({ process: proc(), pid: 4321 });
    assert.equal(result.target.detail?.pid, 4321);
  });
});

describe('classifyPathTarget', () => {
  test('rejects Windows system directory', () => {
    const result = classifyPathTarget('C:\\Windows\\System32\\evil.dll');
    assert.equal(result.safe, false);
  });

  test('rejects path outside approved roots when roots supplied', () => {
    const result = classifyPathTarget('C:\\Unrelated\\file.txt', ['C:\\Games\\MyGame']);
    assert.equal(result.safe, false);
  });

  test('target identifier echoes the requested path', () => {
    const result = classifyPathTarget('C:\\Games\\MyGame\\save.json', ['C:\\Games\\MyGame']);
    assert.equal(result.target.identifier, 'C:\\Games\\MyGame\\save.json');
    assert.equal(result.target.kind, 'filesystem_path');
  });
});
