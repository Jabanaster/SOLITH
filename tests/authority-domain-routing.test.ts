import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluate,
  issueGrant,
  consumeGrant,
  clearGrantStore,
  type AuthorityRequest,
  type GrantBinding,
} from '../src/core/authority/index.js';
import {
  setAuthorityReadOnlyMode,
  getAuthorityReadOnlyMode,
  setAuthorityEmergencyStop,
  getAuthorityEmergencyStop,
  evaluateAuthority,
} from '../electron/authority-bridge.js';

describe('SOL-1 Authority Domain Routing & Grant Integration', () => {
  beforeEach(() => {
    clearGrantStore();
    setAuthorityReadOnlyMode(false);
    setAuthorityEmergencyStop(false);
  });

  describe('Grant Token Lifecycle & Binding Invariants', () => {
    it('issues and consumes a valid single-use grant', () => {
      const binding: GrantBinding = {
        capability: 'process.attach',
        targetIdentifier: 'pid:1234',
        sessionKey: 'session-alpha',
      };
      const grant = issueGrant(binding, { ttlMs: 60_000 });
      assert.ok(grant.grantId);
      assert.equal(grant.capability, 'process.attach');
      assert.equal(grant.targetIdentifier, 'pid:1234');

      const res1 = consumeGrant(grant.grantId, binding);
      assert.equal(res1.ok, true);

      // Single-use guarantee
      const res2 = consumeGrant(grant.grantId, binding);
      assert.equal(res2.ok, false);
      if (!res2.ok) {
        assert.match(res2.reason, /consumed|used|Unknown/i);
      }
    });

    it('rejects expired grants', () => {
      const binding: GrantBinding = {
        capability: 'process.kill',
        targetIdentifier: 'pid:5678',
        sessionKey: 'session-beta',
      };
      const grant = issueGrant(binding, { ttlMs: 100, nowMs: 1000 });
      const res = consumeGrant(grant.grantId, binding, { nowMs: 2000 });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.match(res.reason, /expired/i);
      }
    });

    it('rejects grants with mismatched capability, target, or sessionKey', () => {
      const binding: GrantBinding = {
        capability: 'process.attach',
        targetIdentifier: 'pid:100',
        sessionKey: 'sess-1',
      };
      const grant = issueGrant(binding);

      const wrongCap = consumeGrant(grant.grantId, { ...binding, capability: 'process.kill' });
      assert.equal(wrongCap.ok, false);

      const wrongTarget = consumeGrant(grant.grantId, { ...binding, targetIdentifier: 'pid:999' });
      assert.equal(wrongTarget.ok, false);

      const wrongSession = consumeGrant(grant.grantId, { ...binding, sessionKey: 'sess-2' });
      assert.equal(wrongSession.ok, false);
    });
  });

  describe('Emergency Stop & Read-Only State Wiring', () => {
    it('denies mutating capabilities when readOnlyMode is active', () => {
      setAuthorityReadOnlyMode(true);
      assert.equal(getAuthorityReadOnlyMode(), true);

      const request: AuthorityRequest = {
        identity: { kind: 'internal_subsystem', subsystem: 'test' },
        capability: 'filesystem.write',
        target: { kind: 'path', identifier: 'C:\\test.txt' },
        risk: 'HIGH',
        context: {
          isPackaged: false,
          isTestBuild: true,
          freezeActive: false,
          emergencyStopActive: false,
          operationOrigin: 'internal',
          readOnlyMode: true,
        },
      };
      const res = evaluateAuthority(request);
      assert.equal(res.decision.outcome, 'DENY');
      assert.equal(res.decision.policyId, 'readonly-kill-switch');
    });

    it('denies mutating capabilities when emergencyStopActive is true', () => {
      setAuthorityEmergencyStop(true);
      assert.equal(getAuthorityEmergencyStop(), true);

      const request: AuthorityRequest = {
        identity: { kind: 'internal_subsystem', subsystem: 'test' },
        capability: 'memory.write',
        target: { kind: 'process', identifier: '123' },
        risk: 'HIGH',
        context: {
          isPackaged: false,
          isTestBuild: true,
          freezeActive: false,
          emergencyStopActive: true,
          operationOrigin: 'internal',
          readOnlyMode: false,
        },
      };
      const res = evaluateAuthority(request);
      assert.equal(res.decision.outcome, 'DENY');
      assert.equal(res.decision.policyId, 'emergency-stop');
    });
  });

  describe('Domain Call Site Routing Verification', () => {
    it('network.request allows known internal subsystems and denies arbitrary callers', () => {
      const allowedReq: AuthorityRequest = {
        identity: { kind: 'internal_subsystem', subsystem: 'trainer-catalog-sync' },
        capability: 'network.request',
        target: { kind: 'network_destination', identifier: 'https://flingtrainer.com' },
        risk: 'MODERATE',
        context: {
          isPackaged: false,
          isTestBuild: true,
          freezeActive: false,
          emergencyStopActive: false,
          operationOrigin: 'internal',
          readOnlyMode: false,
        },
      };
      assert.equal(evaluate(allowedReq).decision.outcome, 'ALLOW');

      const deniedReq: AuthorityRequest = {
        identity: { kind: 'internal_subsystem', subsystem: 'arbitrary-module' },
        capability: 'network.request',
        target: { kind: 'network_destination', identifier: 'https://example.com' },
        risk: 'HIGH',
        context: {
          isPackaged: false,
          isTestBuild: true,
          freezeActive: false,
          emergencyStopActive: false,
          operationOrigin: 'internal',
          readOnlyMode: false,
        },
      };
      assert.equal(evaluate(deniedReq).decision.outcome, 'DENY');
    });

    it('registry.read allows install-discovery subsystem and denies unauthorized callers', () => {
      const allowedReq: AuthorityRequest = {
        identity: { kind: 'internal_subsystem', subsystem: 'install-discovery' },
        capability: 'registry.read',
        target: { kind: 'none', identifier: 'HKLM\\SOFTWARE\\Valve\\Steam' },
        risk: 'LOW',
        context: {
          isPackaged: false,
          isTestBuild: true,
          freezeActive: false,
          emergencyStopActive: false,
          operationOrigin: 'internal',
          readOnlyMode: false,
        },
      };
      assert.equal(evaluate(allowedReq).decision.outcome, 'ALLOW');

      const deniedReq: AuthorityRequest = {
        identity: { kind: 'internal_subsystem', subsystem: 'random-caller' },
        capability: 'registry.read',
        target: { kind: 'none', identifier: 'HKLM\\SOFTWARE\\Valve\\Steam' },
        risk: 'LOW',
        context: {
          isPackaged: false,
          isTestBuild: true,
          freezeActive: false,
          emergencyStopActive: false,
          operationOrigin: 'internal',
          readOnlyMode: false,
        },
      };
      assert.equal(evaluate(deniedReq).decision.outcome, 'DENY');
    });
  });
});
