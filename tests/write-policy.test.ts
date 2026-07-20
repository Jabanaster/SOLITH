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
      userExplicitlyActivated: false,
      originalValueCaptured: false,
    });

    assert.equal(result.allowed, false);
    assert.match(result.blockers.join('\n'), /explicitly activate/);
    assert.match(result.blockers.join('\n'), /Original value/);
    assert.match(result.blockers.join('\n'), /Ambiguous AOB/);
  });
});
