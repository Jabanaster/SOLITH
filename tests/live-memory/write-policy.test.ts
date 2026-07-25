import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  WritePolicyGate,
  defaultTrainerWritePolicyContext,
  researchProbeWritePolicyContext,
} from '../../src/core/live-memory/write-policy.js';

describe('WritePolicyGate', () => {
  const gate = new WritePolicyGate();

  test('trainer default context denies until waiver and approval are set', () => {
    const decision = gate.evaluate(defaultTrainerWritePolicyContext());
    assert.equal(decision.allow, false);
    if (!decision.allow) {
      assert.equal(decision.code, 'NO_CONSENT');
    }
  });

  test('trainer path allows when waiver + approval are explicit', () => {
    const decision = gate.evaluate(
      defaultTrainerWritePolicyContext({
        singlePlayerWaiverAccepted: true,
        userApproved: true,
        researchWriteModeEnabled: false,
        hasBackupSnapshot: false,
      }),
    );
    assert.equal(decision.allow, true);
  });

  test('denies when read-only mode is enabled', () => {
    const decision = gate.evaluate(
      defaultTrainerWritePolicyContext({
        readOnlyMode: true,
        singlePlayerWaiverAccepted: true,
        userApproved: true,
      }),
    );
    assert.equal(decision.allow, false);
    if (!decision.allow) {
      assert.equal(decision.code, 'READONLY_MODE');
    }
  });

  test('denies when single-player waiver not accepted', () => {
    const decision = gate.evaluate(
      defaultTrainerWritePolicyContext({
        singlePlayerWaiverAccepted: false,
        userApproved: true,
      }),
    );
    assert.equal(decision.allow, false);
    if (!decision.allow) {
      assert.equal(decision.code, 'NO_CONSENT');
    }
  });

  test('legacy isOffline:false maps to NO_CONSENT', () => {
    const decision = gate.evaluate(
      defaultTrainerWritePolicyContext({ isOffline: false, userApproved: true }),
    );
    assert.equal(decision.allow, false);
    if (!decision.allow) {
      assert.equal(decision.code, 'NO_CONSENT');
    }
  });

  test('denies when user approval is missing', () => {
    const decision = gate.evaluate(
      defaultTrainerWritePolicyContext({
        singlePlayerWaiverAccepted: true,
        userApproved: false,
      }),
    );
    assert.equal(decision.allow, false);
    if (!decision.allow) {
      assert.equal(decision.code, 'NO_APPROVAL');
    }
  });

  test('research_probe denies when Research Write Mode is off (default)', () => {
    const decision = gate.evaluate(
      researchProbeWritePolicyContext({
        singlePlayerWaiverAccepted: true,
        userApproved: true,
      }),
    );
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
        singlePlayerWaiverAccepted: true,
        userApproved: true,
      }),
    );
    assert.equal(decision.allow, false);
    if (!decision.allow) {
      assert.equal(decision.code, 'NO_BACKUP');
    }
  });

  test('research_probe allows when mode on, backup present, waiver, approved', () => {
    const decision = gate.evaluate(
      researchProbeWritePolicyContext({
        researchWriteModeEnabled: true,
        hasBackupSnapshot: true,
        singlePlayerWaiverAccepted: true,
        userApproved: true,
      }),
    );
    assert.equal(decision.allow, true);
  });

  test('fail-closed order: readOnly wins before consent', () => {
    const decision = gate.evaluate(
      defaultTrainerWritePolicyContext({
        readOnlyMode: true,
        singlePlayerWaiverAccepted: false,
        userApproved: false,
      }),
    );
    assert.equal(decision.allow, false);
    if (!decision.allow) {
      assert.equal(decision.code, 'READONLY_MODE');
    }
  });
});
