import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/core/authority/authority-service.js';
import { CAPABILITIES } from '../src/core/authority/capabilities.js';
import { request } from './helpers/authority-request-fixtures.js';

describe('AuthorityService.evaluate — determinism and purity', () => {
  test('same request produces the same outcome/reason/policyId across calls', () => {
    const req = request('filesystem.read');
    const a = evaluate(req, 1_000);
    const b = evaluate(req, 1_000);
    assert.equal(a.decision.outcome, b.decision.outcome);
    assert.equal(a.decision.reason, b.decision.reason);
    assert.equal(a.decision.policyId, b.decision.policyId);
  });

  test('evaluate() has no execution side effects — request object is not mutated', () => {
    const req = request('memory.write');
    const snapshot = JSON.parse(JSON.stringify(req));
    evaluate(req);
    assert.deepEqual(req, snapshot);
  });

  test('every declared capability has a reachable decision (no throw, no undefined outcome)', () => {
    for (const capability of CAPABILITIES) {
      const result = evaluate(request(capability));
      assert.ok(['ALLOW', 'DENY', 'REQUIRE_APPROVAL'].includes(result.decision.outcome), capability);
    }
  });

  test('unknown capability fails closed to DENY', () => {
    // @ts-expect-error deliberately passing an invalid capability to prove the runtime fail-closed path
    const result = evaluate(request('capability.not.real'));
    assert.equal(result.decision.outcome, 'DENY');
    assert.match(result.decision.reason, /unknown capability/i);
  });

  test('each evaluation produces a unique correlationId', () => {
    const a = evaluate(request('filesystem.read'));
    const b = evaluate(request('filesystem.read'));
    assert.notEqual(a.decision.correlationId, b.decision.correlationId);
  });

  test('decision evidence carries no secret-shaped fields, only identifiers', () => {
    const result = evaluate(request('memory.write', { target: { kind: 'process', identifier: 'game.exe', detail: { pid: 1234 } } }));
    const keys = Object.keys(result.evidence);
    for (const forbidden of ['credential', 'password', 'token', 'secret', 'raw']) {
      assert.ok(!keys.some((k) => k.toLowerCase().includes(forbidden)), forbidden);
    }
  });
});

describe('AuthorityService.evaluate — DENY cannot be overridden downstream, ALLOW does not bypass preconditions', () => {
  test('ALLOW for filesystem.read carries no implicit grant for any other capability', () => {
    const result = evaluate(request('filesystem.read'));
    assert.equal(result.decision.outcome, 'ALLOW');
    assert.equal(result.decision.capability, 'filesystem.read');
  });

  test('REQUIRE_APPROVAL does not itself execute — evaluate() returns only a decision object', () => {
    const result = evaluate(request('destructive.delete'));
    assert.equal(result.decision.outcome, 'REQUIRE_APPROVAL');
    assert.equal(typeof result.decision, 'object');
    assert.ok(!('execute' in result.decision));
  });
});
