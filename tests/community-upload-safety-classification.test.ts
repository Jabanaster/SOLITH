import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTrainerContentSafety } from '../src/core/community-upload/safety-classification.ts';

describe('classifyTrainerContentSafety', () => {
  test('a clean native-resolver/pointer/aob submission does not require manual review', () => {
    const result = classifyTrainerContentSafety(['native-resolver', 'pointer', 'aob']);
    assert.equal(result.requiresManualReview, false);
    assert.deepEqual(result.reasons, []);
    assert.deepEqual(result.contentTypes, ['native-resolver', 'pointer', 'aob']);
  });

  test('save-backed, registry-backed, module-offset, and file-backed content never require manual review', () => {
    const result = classifyTrainerContentSafety(['save-backed', 'registry-backed', 'module-offset', 'file-backed']);
    assert.equal(result.requiresManualReview, false);
    assert.deepEqual(result.reasons, []);
  });

  test('autoassembler content always requires manual review', () => {
    const result = classifyTrainerContentSafety(['native-resolver', 'autoassembler']);
    assert.equal(result.requiresManualReview, true);
    assert.equal(result.reasons.length, 1);
    assert.match(result.reasons[0], /AutoAssembler/);
  });

  test('lua content always requires manual review', () => {
    const result = classifyTrainerContentSafety(['lua']);
    assert.equal(result.requiresManualReview, true);
    assert.match(result.reasons[0], /Lua/);
  });

  test('other-script content always requires manual review', () => {
    const result = classifyTrainerContentSafety(['other-script']);
    assert.equal(result.requiresManualReview, true);
    assert.match(result.reasons[0], /unclassified script/);
  });

  test('mixed content types accumulate one reason per flagged type', () => {
    const result = classifyTrainerContentSafety(['autoassembler', 'lua', 'pointer']);
    assert.equal(result.requiresManualReview, true);
    assert.equal(result.reasons.length, 2);
  });

  test('empty content type list does not require manual review', () => {
    const result = classifyTrainerContentSafety([]);
    assert.equal(result.requiresManualReview, false);
    assert.deepEqual(result.reasons, []);
  });
});
