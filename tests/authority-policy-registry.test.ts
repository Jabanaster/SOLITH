import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/core/authority/authority-service.js';
import { POLICY_REGISTRY } from '../src/core/authority/policy-registry.js';
import { CAPABILITIES } from '../src/core/authority/capabilities.js';
import { request, ipcIdentity, internalIdentity, baseContext } from './helpers/authority-request-fixtures.js';

describe('policy registry completeness', () => {
  test('every capability has a registry entry', () => {
    for (const capability of CAPABILITIES) {
      assert.ok(POLICY_REGISTRY[capability], `missing policy for ${capability}`);
    }
  });
});

describe('destructive.delete never inherits generic mutation authority', () => {
  test('destructive.delete always REQUIRE_APPROVAL regardless of consent token presence', () => {
    const withToken = evaluate(request('destructive.delete', { context: baseContext({ consentTokenId: 'tok-123' }) }));
    assert.equal(withToken.decision.outcome, 'REQUIRE_APPROVAL');
    const withoutToken = evaluate(request('destructive.delete'));
    assert.equal(withoutToken.decision.outcome, 'REQUIRE_APPROVAL');
  });

  test('filesystem.write ALLOW does not imply destructive.delete ALLOW', () => {
    const write = evaluate(request('filesystem.write', { context: baseContext({ consentTokenId: 'tok-123' }) }));
    assert.equal(write.decision.outcome, 'ALLOW');
    const del = evaluate(request('destructive.delete', { context: baseContext({ consentTokenId: 'tok-123' }) }));
    assert.equal(del.decision.outcome, 'REQUIRE_APPROVAL');
  });

  test('memory.write authority does not imply destructive.delete authority', () => {
    const mem = evaluate(request('memory.write', { context: baseContext({ consentTokenId: 'tok-123' }) }));
    assert.equal(mem.decision.outcome, 'ALLOW');
    const del = evaluate(request('destructive.delete', { context: baseContext({ consentTokenId: 'tok-123' }) }));
    assert.equal(del.decision.outcome, 'REQUIRE_APPROVAL');
  });
});

describe('read-only global kill switch (SOL-0 G7)', () => {
  test('mutating capability denied when readOnlyMode is true', () => {
    const result = evaluate(request('memory.write', { context: baseContext({ readOnlyMode: true, consentTokenId: 'tok' }) }));
    assert.equal(result.decision.outcome, 'DENY');
    assert.match(result.decision.reason, /read-only/i);
  });

  test('read-only capability still allowed when readOnlyMode is true', () => {
    const result = evaluate(request('filesystem.read', { context: baseContext({ readOnlyMode: true }) }));
    assert.equal(result.decision.outcome, 'ALLOW');
  });
});

describe('emergency/freeze stop (SOL-0 G8)', () => {
  test('mutating capability denied when emergencyStopActive is true', () => {
    const result = evaluate(request('memory.write', { context: baseContext({ emergencyStopActive: true, consentTokenId: 'tok' }) }));
    assert.equal(result.decision.outcome, 'DENY');
    assert.match(result.decision.reason, /emergency stop/i);
  });

  test('observation capability remains available during emergency stop', () => {
    const result = evaluate(request('process.observe', { context: baseContext({ emergencyStopActive: true }) }));
    assert.equal(result.decision.outcome, 'ALLOW');
  });
});

describe('protected-target fail-closed', () => {
  test('process target blocked when protectedTargetState is blocked', () => {
    const result = evaluate(request('process.attach', {
      target: { kind: 'process', identifier: 'BEService.exe' },
      context: baseContext({ protectedTargetState: 'blocked' }),
    }));
    assert.equal(result.decision.outcome, 'DENY');
    assert.match(result.decision.reason, /protected/i);
  });
});

describe('consent requirement for consequential IPC writes', () => {
  test('memory.write from IPC without consent token requires approval', () => {
    const result = evaluate(request('memory.write', { identity: ipcIdentity() }));
    assert.equal(result.decision.outcome, 'REQUIRE_APPROVAL');
  });

  test('memory.write from IPC with consent token is allowed (downstream still validates the token)', () => {
    const result = evaluate(request('memory.write', { identity: ipcIdentity(), context: baseContext({ consentTokenId: 'tok-abc' }) }));
    assert.equal(result.decision.outcome, 'ALLOW');
  });

  test('memory.write from an internal subsystem (not IPC) is not consent-gated by AuthorityService', () => {
    const result = evaluate(request('memory.write', { identity: internalIdentity('crash-recovery'), context: baseContext({ operationOrigin: 'internal' }) }));
    assert.equal(result.decision.outcome, 'ALLOW');
  });
});

describe('bounded network access (SOL-1 STEP 13 — no arbitrary network capability)', () => {
  test('unknown identity denied network.request by default', () => {
    const result = evaluate(request('network.request', { identity: ipcIdentity() }));
    assert.equal(result.decision.outcome, 'DENY');
  });

  test('known internal subsystem allowed bounded network.request', () => {
    const result = evaluate(request('network.request', { identity: internalIdentity('artwork-cache'), context: baseContext({ operationOrigin: 'internal' }) }));
    assert.equal(result.decision.outcome, 'ALLOW');
  });

  test('unrecognized internal subsystem name still denied — no free-form allow-list growth', () => {
    const result = evaluate(request('network.request', { identity: internalIdentity('totally-made-up-subsystem'), context: baseContext({ operationOrigin: 'internal' }) }));
    assert.equal(result.decision.outcome, 'DENY');
  });
});

describe('capabilities with no executor stay denied by design', () => {
  for (const capability of ['registry.write', 'system.settings', 'credential.use', 'browser.navigate', 'browser.submit'] as const) {
    test(`${capability} is DENY regardless of context`, () => {
      const result = evaluate(request(capability, { context: baseContext({ consentTokenId: 'tok', readOnlyMode: false }) }));
      assert.equal(result.decision.outcome, 'DENY');
    });
  }
});

describe('no packaged-production ALLOW_ALL escape hatch exists', () => {
  test('packaged + test-build context does not itself change any decision (defers to normal policy)', () => {
    const packagedProd = evaluate(request('memory.write', { context: baseContext({ isPackaged: true, isTestBuild: false }) }));
    const packagedTest = evaluate(request('memory.write', { context: baseContext({ isPackaged: true, isTestBuild: true }) }));
    // Neither packaging flag alone flips a REQUIRE_APPROVAL outcome to ALLOW — consent token is still required.
    assert.equal(packagedProd.decision.outcome, 'REQUIRE_APPROVAL');
    assert.equal(packagedTest.decision.outcome, 'REQUIRE_APPROVAL');
  });
});
