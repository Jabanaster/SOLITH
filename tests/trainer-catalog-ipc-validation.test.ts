import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DefinitionFeedbackSchema,
  ImportCtSchema,
  LiveMemoryPointerScanSchema,
} from '../electron/ipc-validation.ts';

describe('trainer catalog IPC validation', () => {
  test('DefinitionFeedbackSchema accepts valid rating', () => {
    const parsed = DefinitionFeedbackSchema.parse({
      catalogGameId: 'palworld',
      featureId: 'health',
      rating: 1,
      note: 'worked offline',
    });
    assert.equal(parsed.rating, 1);
  });

  test('DefinitionFeedbackSchema rejects invalid rating', () => {
    assert.throws(() =>
      DefinitionFeedbackSchema.parse({
        catalogGameId: 'palworld',
        featureId: 'health',
        rating: 5,
      }),
    );
  });

  test('ImportCtSchema accepts xml payload', () => {
    const parsed = ImportCtSchema.parse({
      xmlText: '<CheatTable></CheatTable>',
      title: 'Demo',
    });
    assert.equal(parsed.title, 'Demo');
  });

  test('ImportCtSchema rejects empty xml', () => {
    assert.throws(() => ImportCtSchema.parse({ xmlText: '' }));
  });

  test('LiveMemoryPointerScanSchema requires hex address', () => {
    const parsed = LiveMemoryPointerScanSchema.parse({ address: '0x1a2b3c' });
    assert.equal(parsed.address, '0x1a2b3c');
    assert.throws(() => LiveMemoryPointerScanSchema.parse({ address: '12345' }));
  });
});
