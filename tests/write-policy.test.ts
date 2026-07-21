import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWriteFeatureDeclaration } from '../src/core/runtime/write-policy.ts';

const safeDeclaration = {
  id: 'health-write',
  type: 'value_write' as const,
  addressExpression: 'module+0x1234',
  dataType: 'float',
  originalValueCaptured: true,
  restoreAvailable: true,
  executableHashMatched: true,
  ambiguousAobMatches: false,
  explicitProcessSelected: true,
  offlineGuardPassed: true,
  userApprovalCaptured: true,
  certifiedOrGated: true,
  auditLogWritten: true,
  userExplicitlyActivated: true,
  enabledByDefault: false as const,
  backgroundAutoActivation: false as const,
  antiCheatBypass: false as const,
  protectedMultiplayerProcess: false as const,
};

describe('write-capable runtime policy declarations', () => {
  test('allows only fully gated explicit write declarations', () => {
    assert.equal(validateWriteFeatureDeclaration(safeDeclaration).allowed, true);
  });

  test('blocks ambiguous, automatic, or unsafe write declarations', () => {
    const result = validateWriteFeatureDeclaration({
      ...safeDeclaration,
      ambiguousAobMatches: true,
      explicitProcessSelected: false,
      offlineGuardPassed: false,
      userApprovalCaptured: false,
      certifiedOrGated: false,
      auditLogWritten: false,
      userExplicitlyActivated: false,
      originalValueCaptured: false,
    });

    assert.equal(result.allowed, false);
    assert.match(result.blockers.join('\n'), /explicitly activate/);
    assert.match(result.blockers.join('\n'), /Original value/);
    assert.match(result.blockers.join('\n'), /Ambiguous AOB/);
    assert.match(result.blockers.join('\n'), /explicitly selected/);
    assert.match(result.blockers.join('\n'), /Offline guard/);
    assert.match(result.blockers.join('\n'), /User approval/);
    assert.match(result.blockers.join('\n'), /certified or gated/);
    assert.match(result.blockers.join('\n'), /Audit log/);
  });
});
