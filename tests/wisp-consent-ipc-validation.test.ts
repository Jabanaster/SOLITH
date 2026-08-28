import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { WispConsentProposalIdSchema, WispConsentEmptyPayloadSchema } from '../electron/ipc-validation.ts';

describe('WispConsentProposalIdSchema', () => {
  test('accepts a valid proposalId', () => {
    const parsed = WispConsentProposalIdSchema.parse({ proposalId: 'a-real-uuid' });
    assert.equal(parsed.proposalId, 'a-real-uuid');
  });

  test('rejects a missing proposalId', () => {
    assert.throws(() => WispConsentProposalIdSchema.parse({}));
  });

  test('rejects an empty-string proposalId', () => {
    assert.throws(() => WispConsentProposalIdSchema.parse({ proposalId: '' }));
  });

  test('rejects a non-string proposalId', () => {
    assert.throws(() => WispConsentProposalIdSchema.parse({ proposalId: 12345 }));
  });

  test('rejects an oversized proposalId', () => {
    assert.throws(() => WispConsentProposalIdSchema.parse({ proposalId: 'x'.repeat(500) }));
  });

  test('rejects an unknown field alongside a valid proposalId (strict — no address/value/game/action override)', () => {
    assert.throws(() => WispConsentProposalIdSchema.parse({ proposalId: 'ok', address: '0x1000' }));
    assert.throws(() => WispConsentProposalIdSchema.parse({ proposalId: 'ok', requestedValue: 999 }));
    assert.throws(() => WispConsentProposalIdSchema.parse({ proposalId: 'ok', gameId: 'atomfall' }));
    assert.throws(() => WispConsentProposalIdSchema.parse({ proposalId: 'ok', actionId: 'other-action' }));
  });

  test('a prototype-pollution payload never survives parsing (zod ignores an own "__proto__" key rather than treating it as real schema data)', () => {
    const malicious = JSON.parse('{"proposalId":"ok","__proto__":{"polluted":true}}');
    const parsed = WispConsentProposalIdSchema.parse(malicious);
    assert.deepEqual(Object.keys(parsed), ['proposalId'], 'the parsed result must carry only proposalId — no polluted key');
    assert.equal((parsed as Record<string, unknown>).polluted, undefined);
  });
});

describe('WispConsentEmptyPayloadSchema', () => {
  test('accepts an empty object', () => {
    assert.doesNotThrow(() => WispConsentEmptyPayloadSchema.parse({}));
  });

  test('rejects any field at all', () => {
    assert.throws(() => WispConsentEmptyPayloadSchema.parse({ proposalId: 'x' }));
  });
});
