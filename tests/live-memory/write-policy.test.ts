import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  WritePolicyGate,
  defaultTrainerWritePolicyContext,
  researchProbeWritePolicyContext,
} from '../../src/core/live-memory/write-policy.js';

describe('WritePolicyGate', () => {
  const gate = new WritePolicyGate();

  test('trainer default context allows writes without researchWriteMode', () => {
    const decision = gate.evaluate(defaultTrainerWritePolicyContext());
    assert.equal(decision.allow, true);
    if (decision.allow) {
      assert.ok(decision.reasons.some((r) => /passed/i.test(r)));
    }
  });

  test('trainer path ignores researchWriteMode and backup flags', () => {
    const decision = gate.evaluate(
      defaultTrainerWritePolicyContext({
        researchWriteModeEnabled: false,
        hasBackupSnapshot: false,
      }),
    );
    assert.equal(decision.allow, true);
  });

  test('denies when read-only mode is enabled', () => {
    const decision = gate.evaluate(
      defaultTrainerWritePolicyContext({ readOnlyMode: true }),
    );
    assert.equal(decision.allow, false);
    if (!decision.allow) {
      assert.equal(decision.code, 'READONLY_MODE');
    }
  });

  test('denies when online / offline confirm failed', () => {
    const decision = gate.evaluate(
      defaultTrainerWritePolicyContext({ isOffline: false }),
    );
    assert.equal(decision.allow, false);
    if (!decision.allow) {
      assert.equal(decision.code, 'ONLINE');
    }
  });

  test('denies when user approval is missing', () => {
    const decision = gate.evaluate(
      defaultTrainerWritePolicyContext({ userApproved: false }),
    );
    assert.equal(decision.allow, false);
    if (!decision.allow) {
      assert.equal(decision.code, 'NO_APPROVAL');
    }
  });

  test('research_probe denies when Research Write Mode is off (default)', () => {
    const decision = gate.evaluate(researchProbeWritePolicyContext());
    assert.equal(decision.allow, false);
    if (!decision.allow) {
      assert.equal(decision.code, 'RESEARCH_MODE_OFF');
    }
  });

  test('research_probe denies when mode on but no backup snapshot', () => {
    const decision = gate.evaluate(
      researchProbeWritePolicyContext({
        researchWriteModeEnabled: true,
        hasBackupSnapshot: false,
      }),
    );
    assert.equal(decision.allow, false);
    if (!decision.allow) {
      assert.equal(decision.code, 'NO_BACKUP');
    }
  });

  test('research_probe allows when mode on, backup present, offline, approved', () => {
    const decision = gate.evaluate(
      researchProbeWritePolicyContext({
        researchWriteModeEnabled: true,
        hasBackupSnapshot: true,
        isOffline: true,
        userApproved: true,
      }),
    );
    assert.equal(decision.allow, true);
  });

  test('fail-closed order: readOnly wins before online', () => {
    const decision = gate.evaluate(
      defaultTrainerWritePolicyContext({
        readOnlyMode: true,
        isOffline: false,
        userApproved: false,
      }),
    );
    assert.equal(decision.allow, false);
    if (!decision.allow) {
      assert.equal(decision.code, 'READONLY_MODE');
    }
  });
});
