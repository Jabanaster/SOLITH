import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeFieldsFromByteDiff } from '../src/core/discovery/binary-field-proposal.ts';
import { createDefaultRfsaBuffer, writeRfsaFields } from '../src/core/saves/binary-formats/rfsa.ts';

describe('binary-field-proposal', () => {
  test('proposes high-confidence gold field at offset 16', () => {
    const before = createDefaultRfsaBuffer();
    const after = writeRfsaFields(before, { gold: 9999 });
    const proposals = proposeFieldsFromByteDiff(before, after);
    assert.ok(proposals.length > 0);
    const gold = proposals.find((p) => p.suggestedFieldId === 'gold');
    assert.ok(gold);
    assert.equal(gold?.offset, 16);
    assert.equal(gold?.confidence, 'high');
  });
});
