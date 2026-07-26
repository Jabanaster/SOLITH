/**
 * Operation-bound write / injector consent artifact proofs.
 */
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearWriteConsentStore,
  consumeWriteConsent,
  hashConsentBinding,
  issueWriteConsent,
  type WriteConsentBinding,
} from '../src/core/consent/write-consent.ts';

function baseBinding(overrides: Partial<WriteConsentBinding> = {}): WriteConsentBinding {
  return {
    operation: 'live_memory_confirm_write',
    sessionKey: 'sender-1',
    proposalId: 'prop-1',
    attachedPid: 4242,
    attachedExecutableName: 'CrimsonDesert.exe',
    address: '4096',
    dataType: 'int32',
    requestedValue: 99,
    ...overrides,
  };
}

describe('write consent artifacts', () => {
  beforeEach(() => {
    clearWriteConsentStore();
  });

  test('issues and consumes a matching single-use token', () => {
    const binding = baseBinding();
    const artifact = issueWriteConsent(binding);
    assert.equal(artifact.bindingHash, hashConsentBinding(binding));
    assert.equal(consumeWriteConsent(artifact.tokenId, binding).ok, true);
    assert.equal(consumeWriteConsent(artifact.tokenId, binding).ok, false);
  });

  test('rejects binding mismatch (address / pid / session)', () => {
    const binding = baseBinding();
    const artifact = issueWriteConsent(binding);
    const mismatched = consumeWriteConsent(artifact.tokenId, baseBinding({ address: '8192' }));
    assert.equal(mismatched.ok, false);
    if (!mismatched.ok) assert.match(mismatched.reason, /binding mismatch/i);
  });

  test('rejects expired tokens', () => {
    const binding = baseBinding();
    const artifact = issueWriteConsent(binding, { ttlMs: 1, nowMs: Date.now() - 5_000 });
    const result = consumeWriteConsent(artifact.tokenId, binding);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /expired/i);
  });

  test('rejects unknown tokens', () => {
    const result = consumeWriteConsent('00000000-0000-4000-8000-000000000000', baseBinding());
    assert.equal(result.ok, false);
  });

  test('injector bindings include exe path and hash', () => {
    const binding = baseBinding({
      operation: 'injector_confirm_launch',
      address: undefined,
      dataType: undefined,
      requestedValue: undefined,
      exePath: 'C:\\Solith\\injector-helpers\\helper.exe',
      exeSha256: 'abc123',
    });
    const artifact = issueWriteConsent(binding);
    assert.equal(
      consumeWriteConsent(artifact.tokenId, {
        ...binding,
        exeSha256: 'different',
      }).ok,
      false,
    );
  });
});
