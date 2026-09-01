import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/core/authority/authority-service.js';
import { request, ipcIdentity, internalIdentity, baseContext, target } from './helpers/authority-request-fixtures.js';

function isDenyOrRequireApproval(outcome: string): boolean {
  return outcome === 'DENY' || outcome === 'REQUIRE_APPROVAL';
}

describe('SOL-1 STEP 20 — negative / hostile test matrix (all must fail closed)', () => {
  describe('identity', () => {
    test('missing/empty subsystem name on internal identity denies network.request', () => {
      const result = evaluate(request('network.request', { identity: internalIdentity(''), context: baseContext({ operationOrigin: 'internal' }) }));
      assert.equal(result.decision.outcome, 'DENY');
    });

    test('malformed identity kind still fails closed for consequential capability', () => {
      // @ts-expect-error deliberately malformed identity.kind
      const result = evaluate(request('memory.write', { identity: { kind: 'bogus' } }));
      assert.ok(isDenyOrRequireApproval(result.decision.outcome));
    });
  });

  describe('capability', () => {
    test('unknown capability denies', () => {
      // @ts-expect-error deliberately unknown capability
      const result = evaluate(request('capability.made.up'));
      assert.equal(result.decision.outcome, 'DENY');
    });

    test('capability escalation attempt: requesting destructive.delete via a memory.write-shaped context still requires approval', () => {
      const result = evaluate(request('destructive.delete', { context: baseContext({ consentTokenId: 'valid-looking-token' }) }));
      assert.equal(result.decision.outcome, 'REQUIRE_APPROVAL');
    });
  });

  describe('target', () => {
    test('protected process target denies process.attach', () => {
      const result = evaluate(request('process.attach', { target: target({ kind: 'process', identifier: 'vgc.exe' }), context: baseContext({ protectedTargetState: 'blocked' }) }));
      assert.equal(result.decision.outcome, 'DENY');
    });

    test('unsupported/unknown network destination denies network.request', () => {
      const result = evaluate(request('network.request', { identity: ipcIdentity(), target: target({ kind: 'network_destination', identifier: 'https://evil.example.com' }) }));
      assert.equal(result.decision.outcome, 'DENY');
    });

    test('registry target outside allowed scope denies registry.read', () => {
      const result = evaluate(request('registry.read', { identity: ipcIdentity(), target: target({ kind: 'registry_path', identifier: 'HKLM\\Software\\Random' }) }));
      assert.equal(result.decision.outcome, 'DENY');
    });
  });

  describe('context', () => {
    test('emergency stop active denies memory.write even with a consent token present', () => {
      const result = evaluate(request('memory.write', { context: baseContext({ emergencyStopActive: true, consentTokenId: 'tok' }) }));
      assert.equal(result.decision.outcome, 'DENY');
    });

    test('read-only mode active denies savefile.modify', () => {
      const result = evaluate(request('savefile.modify', { context: baseContext({ readOnlyMode: true }) }));
      assert.equal(result.decision.outcome, 'DENY');
    });

    test('packaged production with a test-build override still requires approval for a consent-gated write', () => {
      const result = evaluate(request('memory.write', { context: baseContext({ isPackaged: true, isTestBuild: true }) }));
      assert.equal(result.decision.outcome, 'REQUIRE_APPROVAL');
    });
  });

  describe('destructive', () => {
    test('generic filesystem.write authority cannot authorize destructive.delete', () => {
      const write = evaluate(request('filesystem.write', { context: baseContext({ consentTokenId: 'tok' }) }));
      assert.equal(write.decision.outcome, 'ALLOW');
      const del = evaluate(request('destructive.delete', { context: baseContext({ consentTokenId: 'tok' }) }));
      assert.equal(del.decision.outcome, 'REQUIRE_APPROVAL');
    });

    test('memory-write authority cannot authorize filesystem destructive.delete', () => {
      const mem = evaluate(request('memory.write', { context: baseContext({ consentTokenId: 'tok' }) }));
      assert.equal(mem.decision.outcome, 'ALLOW');
      const del = evaluate(request('destructive.delete', { target: target({ kind: 'filesystem_path', identifier: 'C:\\Games\\save.dat' }), context: baseContext({ consentTokenId: 'tok' }) }));
      assert.equal(del.decision.outcome, 'REQUIRE_APPROVAL');
    });

    test('approval evidenced for one target identifier cannot silently authorize a different target (evaluate() is per-request, not cached)', () => {
      const first = evaluate(request('process.attach', { target: target({ kind: 'process', identifier: 'gameA.exe' }) }));
      const second = evaluate(request('process.attach', { target: target({ kind: 'process', identifier: 'gameB.exe' }) }));
      assert.equal(first.decision.target.identifier, 'gameA.exe');
      assert.equal(second.decision.target.identifier, 'gameB.exe');
      assert.notEqual(first.decision.correlationId, second.decision.correlationId);
    });
  });

  describe('failure behavior', () => {
    test('missing policy registry entry (simulated via unknown capability) fails closed, does not throw', () => {
      assert.doesNotThrow(() => {
        // @ts-expect-error deliberately unregistered capability
        evaluate(request('nonexistent.capability'));
      });
    });
  });
});

describe('SOL-1 STEP 21 — positive workflow smoke matrix (legitimate flows still function)', () => {
  test('supported safe filesystem mutation with consent token: allowed', () => {
    const result = evaluate(request('filesystem.write', { context: baseContext({ consentTokenId: 'tok' }) }));
    assert.equal(result.decision.outcome, 'ALLOW');
  });

  test('save modification with consent token: allowed', () => {
    const result = evaluate(request('savefile.modify', { context: baseContext({ consentTokenId: 'tok' }) }));
    assert.equal(result.decision.outcome, 'ALLOW');
  });

  test('permitted process observation: allowed with no approval needed', () => {
    const result = evaluate(request('process.observe'));
    assert.equal(result.decision.outcome, 'ALLOW');
  });

  test('process attach under normal rules: requires approval (not outright denied)', () => {
    const result = evaluate(request('process.attach', { target: target({ kind: 'process', identifier: 'game.exe' }) }));
    assert.equal(result.decision.outcome, 'REQUIRE_APPROVAL');
  });

  test('memory operation after valid scoped consent: allowed', () => {
    const result = evaluate(request('memory.write', { context: baseContext({ consentTokenId: 'tok' }) }));
    assert.equal(result.decision.outcome, 'ALLOW');
  });

  test('patch disable (risk-reducing): allowed without approval', () => {
    const result = evaluate(request('trainer.patch.disable'));
    assert.equal(result.decision.outcome, 'ALLOW');
  });

  test('bounded artwork network access from known subsystem: allowed', () => {
    const result = evaluate(request('artwork.cache.write', { identity: internalIdentity('artwork-cache'), context: baseContext({ operationOrigin: 'internal' }) }));
    assert.equal(result.decision.outcome, 'ALLOW');
  });

  test('bounded catalog sync network access from known subsystem: allowed', () => {
    const result = evaluate(request('catalog.update', { identity: internalIdentity('trainer-catalog-sync'), context: baseContext({ operationOrigin: 'internal' }) }));
    assert.equal(result.decision.outcome, 'ALLOW');
  });

  test('registry install-location discovery from known subsystem: allowed', () => {
    const result = evaluate(request('registry.read', { identity: internalIdentity('install-discovery'), context: baseContext({ operationOrigin: 'internal' }) }));
    assert.equal(result.decision.outcome, 'ALLOW');
  });

  test('normal packaged consent flow (packaged, no test override, consent token present): allowed', () => {
    const result = evaluate(request('memory.write', { context: baseContext({ isPackaged: true, isTestBuild: false, consentTokenId: 'tok' }) }));
    assert.equal(result.decision.outcome, 'ALLOW');
  });

  test('explicit test-build behavior where intended (packaged + SOLITH_TEST_BUILD): still consent-gated, not auto-allowed', () => {
    const result = evaluate(request('memory.write', { context: baseContext({ isPackaged: true, isTestBuild: true }) }));
    assert.equal(result.decision.outcome, 'REQUIRE_APPROVAL');
  });
});
