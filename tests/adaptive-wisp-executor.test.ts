import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeWispAction,
  createExplicitGameIdentityBridge,
  WISP_PROFILE_SCHEMA_VERSION,
  type WispActionDefinition,
  type WispActionExecutionRequest,
  type WispBoundEntryDescriptor,
  type WispCanonicalWriteOutcome,
  type WispRuntimeBinding,
  type WispRuntimeContext,
  type WispTrainerEntryLookup,
  type WispTrainerEntryState,
  type WispTrainerExecutionAdapter,
} from '../src/core/adaptive-wisp/index.ts';

function fixtureLookup(entries: Record<string, WispBoundEntryDescriptor>): WispTrainerEntryLookup {
  return { resolveEntry: (gameId, entryId) => entries[`${gameId}:${entryId}`] ?? null };
}

function entryDescriptor(id: string, enabled = true): WispBoundEntryDescriptor {
  return { id, label: id, dataType: 'int32', enabled };
}

interface FakeAdapterOptions {
  states?: Record<string, WispTrainerEntryState>;
  proposeWrite?: (gameId: string, entryId: string, value: unknown) => { proposalId: string } | null;
  confirmWrite?: (proposalId: string, token: string) => WispCanonicalWriteOutcome;
  proposeFreeze?: (gameId: string, entryId: string, value: unknown, intervalMs?: number) => { proposalId: string } | null;
  confirmFreeze?: (proposalId: string, token: string) => WispCanonicalWriteOutcome;
  stopFreeze?: (gameId: string, entryId: string) => WispCanonicalWriteOutcome;
}

function fakeAdapter(options: FakeAdapterOptions = {}) {
  const calls = { proposeWrite: 0, confirmWrite: 0, proposeFreeze: 0, confirmFreeze: 0, stopFreeze: 0 };
  const states = options.states ?? {};
  const adapter: WispTrainerExecutionAdapter = {
    getCurrentState: (gameId, entryId) => states[`${gameId}:${entryId}`] ?? null,
    proposeWrite: (gameId, entryId, value) => {
      calls.proposeWrite++;
      return options.proposeWrite ? options.proposeWrite(gameId, entryId, value) : { proposalId: 'proposal-1' };
    },
    confirmWrite: async (proposalId, token) => {
      calls.confirmWrite++;
      return options.confirmWrite ? options.confirmWrite(proposalId, token) : { ok: true, status: 'applied' };
    },
    proposeFreeze: (gameId, entryId, value, intervalMs) => {
      calls.proposeFreeze++;
      return options.proposeFreeze ? options.proposeFreeze(gameId, entryId, value, intervalMs) : { proposalId: 'freeze-proposal-1' };
    },
    confirmFreeze: async (proposalId, token) => {
      calls.confirmFreeze++;
      return options.confirmFreeze ? options.confirmFreeze(proposalId, token) : { ok: true, status: 'frozen' };
    },
    stopFreeze: (gameId, entryId) => {
      calls.stopFreeze++;
      return options.stopFreeze ? options.stopFreeze(gameId, entryId) : { ok: true, status: 'unfrozen' };
    },
  };
  return { adapter, calls };
}

function alphaBinding(overrides: Partial<WispRuntimeBinding> = {}): WispRuntimeBinding {
  return { actionId: 'a-health', entryId: 'health', gameId: 'game-alpha', sessionId: 'alpha-session', sessionGeneration: 10, availability: 'available', boundAt: '2026-01-01T00:00:00.000Z', ...overrides };
}

function alphaContext(overrides: Partial<WispRuntimeContext> = {}): WispRuntimeContext {
  return { gameId: 'game-alpha', sessionId: 'alpha-session', sessionGeneration: 10, ...overrides };
}

function actionDef(overrides: Partial<WispActionDefinition> = {}): WispActionDefinition {
  return { id: 'a-health', entryId: 'health', label: 'Health', controlType: 'set', ...overrides };
}

const bridge = createExplicitGameIdentityBridge({ 'game-alpha': 'cheat-alpha', 'game-beta': 'cheat-beta' });
const lookup = fixtureLookup({ 'game-alpha:health': entryDescriptor('health'), 'game-beta:health': entryDescriptor('health') });

function deps(adapter: WispTrainerExecutionAdapter) {
  return { entryLookup: lookup, identityBridge: bridge, trainerAdapter: adapter };
}

describe('executeWispAction — toggle', () => {
  test('OFF -> ON calls proposeWrite with true, then confirms as enabled', async () => {
    const { adapter, calls } = fakeAdapter({
      states: { 'game-alpha:health': { enabled: false, dataType: 'bool', supportsControls: ['toggle'] } },
      confirmWrite: () => ({ ok: true, status: 'enabled' }),
    });
    const request: WispActionExecutionRequest = { control: 'toggle', actionId: 'a-health', profileId: 'p1', consentToken: 'tok' };
    const result = await executeWispAction(request, actionDef(), alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.ok, true);
    assert.equal(result.status, 'enabled');
    assert.equal(calls.proposeWrite, 1);
  });

  test('ON -> OFF calls proposeWrite with false, then confirms as disabled', async () => {
    const { adapter } = fakeAdapter({
      states: { 'game-alpha:health': { enabled: true, dataType: 'bool', supportsControls: ['toggle'] } },
      proposeWrite: (_g, _e, value) => {
        assert.equal(value, false);
        return { proposalId: 'p1' };
      },
      confirmWrite: () => ({ ok: true, status: 'disabled' }),
    });
    const request: WispActionExecutionRequest = { control: 'toggle', actionId: 'a-health', profileId: 'p1', consentToken: 'tok' };
    const result = await executeWispAction(request, actionDef(), alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.status, 'disabled');
  });

  test('an entry that does not support toggle is rejected as unsupported — no raw writer called', async () => {
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:health': { enabled: false, dataType: 'bool', supportsControls: ['set'] } } });
    const request: WispActionExecutionRequest = { control: 'toggle', actionId: 'a-health', profileId: 'p1' };
    const result = await executeWispAction(request, actionDef(), alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.status, 'unavailable');
    assert.equal(result.diagnostic?.code, 'WISP_EXECUTION_CONTROL_UNSUPPORTED');
    assert.equal(calls.proposeWrite, 0);
  });
});

describe('executeWispAction — set (Section 43)', () => {
  const supports = { 'game-alpha:health': { dataType: 'int32', currentValue: 50, supportsControls: ['set'] } };

  test('a valid integer reaches canonical execution', async () => {
    const { adapter, calls } = fakeAdapter({ states: supports, confirmWrite: () => ({ ok: true, status: 'applied', currentValue: 100 }) });
    const request: WispActionExecutionRequest = { control: 'set', actionId: 'a-health', profileId: 'p1', value: 100, consentToken: 'tok' };
    const result = await executeWispAction(request, actionDef(), alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.ok, true);
    assert.equal(calls.proposeWrite, 1);
  });

  test('NaN is rejected before reaching canonical execution', async () => {
    const { adapter, calls } = fakeAdapter({ states: supports });
    const request: WispActionExecutionRequest = { control: 'set', actionId: 'a-health', profileId: 'p1', value: NaN, consentToken: 'tok' };
    const result = await executeWispAction(request, actionDef(), alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.status, 'rejected');
    assert.equal(result.diagnostic?.code, 'WISP_EXECUTION_INVALID_VALUE');
    assert.equal(calls.proposeWrite, 0);
  });

  test('a value out of int32 range is rejected', async () => {
    const { adapter, calls } = fakeAdapter({ states: supports });
    const request: WispActionExecutionRequest = { control: 'set', actionId: 'a-health', profileId: 'p1', value: 99999999999, consentToken: 'tok' };
    const result = await executeWispAction(request, actionDef(), alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.status, 'rejected');
    assert.equal(calls.proposeWrite, 0);
  });

  test('a wrong-type value (string for an int32 entry) is rejected', async () => {
    const { adapter, calls } = fakeAdapter({ states: supports });
    const request: WispActionExecutionRequest = { control: 'set', actionId: 'a-health', profileId: 'p1', value: 'not-a-number', consentToken: 'tok' };
    const result = await executeWispAction(request, actionDef(), alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.status, 'rejected');
    assert.equal(calls.proposeWrite, 0);
  });

  test('a boolean value is valid for a bool-typed entry', async () => {
    const { adapter } = fakeAdapter({ states: { 'game-alpha:health': { dataType: 'bool', supportsControls: ['set'] } }, confirmWrite: () => ({ ok: true, status: 'applied' }) });
    const request: WispActionExecutionRequest = { control: 'set', actionId: 'a-health', profileId: 'p1', value: true, consentToken: 'tok' };
    const result = await executeWispAction(request, actionDef(), alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.ok, true);
  });
});

describe('executeWispAction — increment (Section 44)', () => {
  const def = actionDef({ presets: [{ id: 'plus-ten', label: '+10', value: 10 }] });
  const supports = { 'game-alpha:health': { dataType: 'int32', currentValue: 100, supportsControls: ['increment'] } };

  test('current 100 + preset +10 = 110 through the canonical path', async () => {
    const { adapter } = fakeAdapter({
      states: supports,
      proposeWrite: (_g, _e, value) => {
        assert.equal(value, 110);
        return { proposalId: 'p1' };
      },
      confirmWrite: () => ({ ok: true, status: 'applied', currentValue: 110 }),
    });
    const request: WispActionExecutionRequest = { control: 'increment', actionId: 'a-health', profileId: 'p1', presetId: 'plus-ten', consentToken: 'tok' };
    const result = await executeWispAction(request, def, alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.ok, true);
  });

  test('an increment that would overflow int32 range is rejected', async () => {
    const overflowDef = actionDef({ presets: [{ id: 'huge', label: 'huge', value: 2147483647 }] });
    const { adapter, calls } = fakeAdapter({ states: supports });
    const request: WispActionExecutionRequest = { control: 'increment', actionId: 'a-health', profileId: 'p1', presetId: 'huge', consentToken: 'tok' };
    const result = await executeWispAction(request, overflowDef, alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.status, 'rejected');
    assert.equal(result.diagnostic?.code, 'WISP_EXECUTION_INVALID_VALUE');
    assert.equal(calls.proposeWrite, 0);
  });

  test('an unknown presetId is rejected as an invalid preset', async () => {
    const { adapter, calls } = fakeAdapter({ states: supports });
    const request: WispActionExecutionRequest = { control: 'increment', actionId: 'a-health', profileId: 'p1', presetId: 'does-not-exist', consentToken: 'tok' };
    const result = await executeWispAction(request, def, alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.diagnostic?.code, 'WISP_EXECUTION_INVALID_PRESET');
    assert.equal(calls.proposeWrite, 0);
  });

  test('a stale session yields zero canonical execution calls', async () => {
    const { adapter, calls } = fakeAdapter({ states: supports });
    const request: WispActionExecutionRequest = { control: 'increment', actionId: 'a-health', profileId: 'p1', presetId: 'plus-ten', consentToken: 'tok' };
    const result = await executeWispAction(request, def, alphaBinding({ sessionGeneration: 10 }), alphaContext({ sessionGeneration: 11 }), deps(adapter));
    assert.equal(result.status, 'stale');
    assert.equal(calls.proposeWrite, 0);
    assert.equal(calls.confirmWrite, 0);
  });
});

describe('executeWispAction — multiplier (Section 45)', () => {
  const def = actionDef({ presets: [{ id: 'x2', label: '2x', value: 2 }] });
  const supports = { 'game-alpha:health': { dataType: 'int32', currentValue: 50, supportsControls: ['multiplier'] } };

  test('an allowed preset routes through the canonical path', async () => {
    const { adapter } = fakeAdapter({
      states: supports,
      proposeWrite: (_g, _e, value) => {
        assert.equal(value, 100);
        return { proposalId: 'p1' };
      },
    });
    const request: WispActionExecutionRequest = { control: 'multiplier', actionId: 'a-health', profileId: 'p1', presetId: 'x2', consentToken: 'tok' };
    const result = await executeWispAction(request, def, alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.ok, true);
  });

  test('an unknown preset is rejected', async () => {
    const { adapter, calls } = fakeAdapter({ states: supports });
    const request: WispActionExecutionRequest = { control: 'multiplier', actionId: 'a-health', profileId: 'p1', presetId: 'x99', consentToken: 'tok' };
    const result = await executeWispAction(request, def, alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.diagnostic?.code, 'WISP_EXECUTION_INVALID_PRESET');
    assert.equal(calls.proposeWrite, 0);
  });

  test('a structurally valid preset that the current entry does not support multiplier for is rejected before any preset lookup', async () => {
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:health': { dataType: 'int32', currentValue: 50, supportsControls: ['set'] } } });
    const request: WispActionExecutionRequest = { control: 'multiplier', actionId: 'a-health', profileId: 'p1', presetId: 'x2', consentToken: 'tok' };
    const result = await executeWispAction(request, def, alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.diagnostic?.code, 'WISP_EXECUTION_CONTROL_UNSUPPORTED');
    assert.equal(calls.proposeWrite, 0);
  });
});

describe('executeWispAction — cycle (Section 46)', () => {
  const def = actionDef({ presets: [{ id: 'normal', label: 'Normal', value: 1 }, { id: 'fast', label: 'Fast', value: 2 }, { id: 'very-fast', label: 'Very Fast', value: 5 }] });

  test('current 1x -> 2x, current 2x -> 5x, current 5x wraps to 1x (documented wrap policy)', async () => {
    let seen: unknown;
    const { adapter: a1 } = fakeAdapter({
      states: { 'game-alpha:health': { dataType: 'int32', currentValue: 1, supportsControls: ['cycle'] } },
      proposeWrite: (_g, _e, v) => {
        seen = v;
        return { proposalId: 'p' };
      },
    });
    await executeWispAction({ control: 'cycle', actionId: 'a-health', profileId: 'p1' }, def, alphaBinding(), alphaContext(), deps(a1));
    assert.equal(seen, 2);

    const { adapter: a2 } = fakeAdapter({
      states: { 'game-alpha:health': { dataType: 'int32', currentValue: 2, supportsControls: ['cycle'] } },
      proposeWrite: (_g, _e, v) => {
        seen = v;
        return { proposalId: 'p' };
      },
    });
    await executeWispAction({ control: 'cycle', actionId: 'a-health', profileId: 'p1' }, def, alphaBinding(), alphaContext(), deps(a2));
    assert.equal(seen, 5);

    const { adapter: a3 } = fakeAdapter({
      states: { 'game-alpha:health': { dataType: 'int32', currentValue: 5, supportsControls: ['cycle'] } },
      proposeWrite: (_g, _e, v) => {
        seen = v;
        return { proposalId: 'p' };
      },
    });
    await executeWispAction({ control: 'cycle', actionId: 'a-health', profileId: 'p1' }, def, alphaBinding(), alphaContext(), deps(a3));
    assert.equal(seen, 1);
  });
});

describe('executeWispAction — momentary (Section 47)', () => {
  test('a momentary action with a valid preset invokes the canonical write path', async () => {
    const def = actionDef({ presets: [{ id: 'heal', label: 'Heal', value: 100 }] });
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:health': { dataType: 'int32', supportsControls: ['momentary'] } } });
    const request: WispActionExecutionRequest = { control: 'momentary', actionId: 'a-health', profileId: 'p1', presetId: 'heal', consentToken: 'tok' };
    const result = await executeWispAction(request, def, alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.ok, true);
    assert.equal(calls.proposeWrite, 1);
  });

  test('momentary without a presetId is rejected — it cannot become a generic execute-callback field', async () => {
    const def = actionDef({ presets: [{ id: 'heal', label: 'Heal', value: 100 }] });
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:health': { dataType: 'int32', supportsControls: ['momentary'] } } });
    const request: WispActionExecutionRequest = { control: 'momentary', actionId: 'a-health', profileId: 'p1' };
    const result = await executeWispAction(request, def, alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.diagnostic?.code, 'WISP_EXECUTION_INVALID_PRESET');
    assert.equal(calls.proposeWrite, 0);
  });

  test('an entry with no canonical momentary support reports unsupported rather than inventing a privileged implementation (Section 66)', async () => {
    const def = actionDef({ presets: [{ id: 'heal', label: 'Heal', value: 100 }] });
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:health': { dataType: 'int32', supportsControls: ['set'] } } });
    const request: WispActionExecutionRequest = { control: 'momentary', actionId: 'a-health', profileId: 'p1', presetId: 'heal' };
    const result = await executeWispAction(request, def, alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.status, 'unavailable');
    assert.equal(calls.proposeWrite, 0);
  });
});

describe('executeWispAction — freeze (Section 42)', () => {
  const supports = { 'game-alpha:health': { dataType: 'int32', currentValue: 100, frozen: false, supportsControls: ['freeze'] } };

  test('freeze enable invokes the existing freeze adapter exactly once', async () => {
    const { adapter, calls } = fakeAdapter({ states: supports });
    const request: WispActionExecutionRequest = { control: 'freeze', actionId: 'a-health', profileId: 'p1', enable: true, consentToken: 'tok' };
    const result = await executeWispAction(request, actionDef(), alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.ok, true);
    assert.equal(result.status, 'frozen');
    assert.equal(calls.proposeFreeze, 1);
    assert.equal(calls.confirmFreeze, 1);
  });

  test('freeze disable routes through the canonical unfreeze path, no consent phase', async () => {
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:health': { dataType: 'int32', currentValue: 100, frozen: true, supportsControls: ['freeze'] } } });
    const request: WispActionExecutionRequest = { control: 'freeze', actionId: 'a-health', profileId: 'p1', enable: false };
    const result = await executeWispAction(request, actionDef(), alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.status, 'unfrozen');
    assert.equal(calls.stopFreeze, 1);
    assert.equal(calls.proposeFreeze, 0);
  });

  test('a stale binding results in zero freeze calls', async () => {
    const { adapter, calls } = fakeAdapter({ states: supports });
    const request: WispActionExecutionRequest = { control: 'freeze', actionId: 'a-health', profileId: 'p1', enable: true, consentToken: 'tok' };
    const result = await executeWispAction(request, actionDef(), alphaBinding({ sessionGeneration: 10 }), alphaContext({ sessionGeneration: 11 }), deps(adapter));
    assert.equal(result.status, 'stale');
    assert.equal(calls.proposeFreeze, 0);
    assert.equal(calls.confirmFreeze, 0);
    assert.equal(calls.stopFreeze, 0);
  });
});

describe('executeWispAction — consent (Section 54)', () => {
  const supports = { 'game-alpha:health': { dataType: 'int32', currentValue: 50, supportsControls: ['set'] } };

  test('a write requiring consent does not write before approval — result is pending-consent, confirmWrite never called', async () => {
    const { adapter, calls } = fakeAdapter({ states: supports });
    const request: WispActionExecutionRequest = { control: 'set', actionId: 'a-health', profileId: 'p1', value: 99 };
    const result = await executeWispAction(request, actionDef(), alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.status, 'pending-consent');
    assert.equal(result.diagnostic?.code, 'WISP_EXECUTION_CONSENT_REQUIRED');
    assert.equal(calls.proposeWrite, 1);
    assert.equal(calls.confirmWrite, 0);
  });

  test('a rejected consent produces no write and a rejected status', async () => {
    const { adapter } = fakeAdapter({ states: supports, confirmWrite: () => ({ ok: false, status: 'rejected', reason: 'user declined' }) });
    const request: WispActionExecutionRequest = { control: 'set', actionId: 'a-health', profileId: 'p1', value: 99, consentToken: 'tok' };
    const result = await executeWispAction(request, actionDef(), alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.ok, false);
    assert.equal(result.status, 'rejected');
    assert.equal(result.diagnostic?.code, 'WISP_EXECUTION_CONSENT_REJECTED');
  });

  test('an expired consent token (adapter reports rejected) produces no write', async () => {
    const { adapter } = fakeAdapter({ states: supports, confirmWrite: () => ({ ok: false, status: 'rejected', reason: 'consent token expired' }) });
    const request: WispActionExecutionRequest = { control: 'set', actionId: 'a-health', profileId: 'p1', value: 99, consentToken: 'stale-tok' };
    const result = await executeWispAction(request, actionDef(), alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.status, 'rejected');
  });

  test('a replayed consent token (adapter reports rejected) produces no write', async () => {
    const { adapter } = fakeAdapter({ states: supports, confirmWrite: () => ({ ok: false, status: 'rejected', reason: 'consent token already consumed' }) });
    const request: WispActionExecutionRequest = { control: 'set', actionId: 'a-health', profileId: 'p1', value: 99, consentToken: 'used-tok' };
    const result = await executeWispAction(request, actionDef(), alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.status, 'rejected');
  });

  test('a session change while consent is pending is rejected before the executor ever calls confirmWrite (Section 23, 36)', async () => {
    const { adapter, calls } = fakeAdapter({ states: supports });
    const request: WispActionExecutionRequest = { control: 'set', actionId: 'a-health', profileId: 'p1', value: 99, consentToken: 'tok-from-generation-10' };
    const result = await executeWispAction(request, actionDef(), alphaBinding({ sessionGeneration: 10 }), alphaContext({ sessionGeneration: 11 }), deps(adapter));
    assert.equal(result.status, 'stale');
    assert.equal(calls.proposeWrite, 0);
    assert.equal(calls.confirmWrite, 0);
  });
});

describe('executeWispAction — security: stale/cross-game/table-trainer/detached (Section 48-51)', () => {
  const supports = { 'game-alpha:health': { dataType: 'int32', currentValue: 50, supportsControls: ['set', 'freeze', 'toggle'] } };

  test('cross-game binding cannot execute — current game is Beta, binding is Alpha', async () => {
    const { adapter, calls } = fakeAdapter({ states: supports });
    const request: WispActionExecutionRequest = { control: 'set', actionId: 'a-health', profileId: 'p1', value: 99, consentToken: 'tok' };
    const result = await executeWispAction(request, actionDef(), alphaBinding(), alphaContext({ gameId: 'game-beta' }), deps(adapter));
    assert.equal(result.status, 'stale');
    assert.equal(calls.proposeWrite, 0);
  });

  test('cross-table binding cannot execute', async () => {
    const { adapter, calls } = fakeAdapter({ states: supports });
    const request: WispActionExecutionRequest = { control: 'set', actionId: 'a-health', profileId: 'p1', value: 99, consentToken: 'tok' };
    const binding = alphaBinding({ tableId: 'table-a' });
    const result = await executeWispAction(request, actionDef(), binding, alphaContext({ tableId: 'table-b' }), deps(adapter));
    assert.equal(result.status, 'stale');
    assert.equal(calls.proposeWrite, 0);
  });

  test('a detached (null) context always rejects execution', async () => {
    const { adapter, calls } = fakeAdapter({ states: supports });
    const request: WispActionExecutionRequest = { control: 'set', actionId: 'a-health', profileId: 'p1', value: 99, consentToken: 'tok' };
    const result = await executeWispAction(request, actionDef(), alphaBinding(), null, deps(adapter));
    assert.equal(result.status, 'stale');
    assert.equal(calls.proposeWrite, 0);
  });

  test('a missing identity-bridge mapping rejects execution before entry lookup', async () => {
    const noBridge = createExplicitGameIdentityBridge({});
    const { adapter, calls } = fakeAdapter({ states: supports });
    const request: WispActionExecutionRequest = { control: 'set', actionId: 'a-health', profileId: 'p1', value: 99, consentToken: 'tok' };
    const result = await executeWispAction(request, actionDef(), alphaBinding(), alphaContext(), { entryLookup: lookup, identityBridge: noBridge, trainerAdapter: adapter });
    assert.equal(result.diagnostic?.code, 'WISP_EXECUTION_IDENTITY_MAPPING_MISSING');
    assert.equal(calls.proposeWrite, 0);
  });

  test('a raw address field on the request is rejected before any binding/entry work happens', async () => {
    const { adapter, calls } = fakeAdapter({ states: supports });
    const hostile = { control: 'set', actionId: 'a-health', profileId: 'p1', value: 99, consentToken: 'tok', address: '0x1234' } as unknown as WispActionExecutionRequest;
    const result = await executeWispAction(hostile, actionDef(), alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.diagnostic?.code, 'WISP_EXECUTION_REQUEST_SHAPE_REJECTED');
    assert.equal(calls.proposeWrite, 0);
  });

  test('a pid field on the request is rejected', async () => {
    const { adapter, calls } = fakeAdapter({ states: supports });
    const hostile = { control: 'toggle', actionId: 'a-health', profileId: 'p1', pid: 1234 } as unknown as WispActionExecutionRequest;
    const result = await executeWispAction(hostile, actionDef(), alphaBinding(), alphaContext(), deps(adapter));
    assert.equal(result.diagnostic?.code, 'WISP_EXECUTION_REQUEST_SHAPE_REJECTED');
    assert.equal(calls.proposeWrite, 0);
  });

  test('a missing/disabled entry is rejected as unavailable, not a crash', async () => {
    const disabledLookup = fixtureLookup({ 'game-alpha:health': entryDescriptor('health', false) });
    const { adapter, calls } = fakeAdapter({ states: supports });
    const request: WispActionExecutionRequest = { control: 'set', actionId: 'a-health', profileId: 'p1', value: 99, consentToken: 'tok' };
    const result = await executeWispAction(request, actionDef(), alphaBinding(), alphaContext(), { entryLookup: disabledLookup, identityBridge: bridge, trainerAdapter: adapter });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.diagnostic?.code, 'WISP_EXECUTION_ENTRY_DISABLED');
    assert.equal(calls.proposeWrite, 0);
  });
});
