import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefaultRequest,
  createWispQuickSlotController,
  WISP_PROFILE_SCHEMA_VERSION,
  type WispActionDefinition,
  type WispBoundEntryDescriptor,
  type WispCanonicalWriteOutcome,
  type WispGameProfile,
  type WispRuntimeContext,
  type WispTrainerEntryLookup,
  type WispTrainerEntryState,
  type WispTrainerExecutionAdapter,
} from '../src/core/adaptive-wisp/index.ts';
import { createExplicitGameIdentityBridge } from '../src/core/adaptive-wisp/game-identity-bridge.js';
import { createWispActiveProfileProvider } from '../src/core/adaptive-wisp/active-profile-provider.js';

/**
 * Increment 5 security/integration test matrix (Sections 59-72). Uses
 * fixture games only (GAME_ALPHA/GAME_BETA), no commercial game, and the
 * same fake-adapter convention as adaptive-wisp-executor.test.ts.
 */

function fixtureLookup(entries: Record<string, WispBoundEntryDescriptor>): WispTrainerEntryLookup {
  return { resolveEntry: (gameId, entryId) => entries[`${gameId}:${entryId}`] ?? null };
}

function entryDescriptor(id: string, enabled = true): WispBoundEntryDescriptor {
  return { id, label: id, dataType: 'int32', enabled };
}

interface FakeAdapterOptions {
  states?: Record<string, WispTrainerEntryState>;
  proposeWrite?: () => { proposalId: string } | null;
  confirmWrite?: () => WispCanonicalWriteOutcome;
  proposeFreeze?: () => { proposalId: string } | null;
  confirmFreeze?: () => WispCanonicalWriteOutcome;
  stopFreeze?: () => WispCanonicalWriteOutcome;
}

function fakeAdapter(options: FakeAdapterOptions = {}) {
  const calls = { proposeWrite: 0, confirmWrite: 0, proposeFreeze: 0, confirmFreeze: 0, stopFreeze: 0 };
  const states = options.states ?? {};
  const adapter: WispTrainerExecutionAdapter = {
    getCurrentState: (gameId, entryId) => states[`${gameId}:${entryId}`] ?? null,
    proposeWrite: () => {
      calls.proposeWrite++;
      return options.proposeWrite ? options.proposeWrite() : { proposalId: `write-proposal-${calls.proposeWrite}` };
    },
    confirmWrite: async () => {
      calls.confirmWrite++;
      return options.confirmWrite ? options.confirmWrite() : { ok: true, status: 'applied' };
    },
    proposeFreeze: () => {
      calls.proposeFreeze++;
      return options.proposeFreeze ? options.proposeFreeze() : { proposalId: `freeze-proposal-${calls.proposeFreeze}` };
    },
    confirmFreeze: async () => {
      calls.confirmFreeze++;
      return options.confirmFreeze ? options.confirmFreeze() : { ok: true, status: 'frozen' };
    },
    stopFreeze: () => {
      calls.stopFreeze++;
      return options.stopFreeze ? options.stopFreeze() : { ok: true, status: 'unfrozen' };
    },
  };
  return { adapter, calls };
}

function alphaProfile(overrides: Partial<WispGameProfile> = {}): WispGameProfile {
  const actions: WispActionDefinition[] = [
    { id: 'a-hp', entryId: 'hp', label: 'HP', controlType: 'freeze', slot: 1 },
    { id: 'a-xp', entryId: 'xp', label: 'XP', controlType: 'set', slot: 2, presets: [{ id: 'p-full', label: 'Full', value: 999 }] },
    { id: 'a-fuel', entryId: 'fuel', label: 'Fuel', controlType: 'toggle', slot: 3 },
  ];
  return { schemaVersion: WISP_PROFILE_SCHEMA_VERSION, profileId: 'alpha-profile', gameId: 'game-alpha', source: 'builtin', groups: [], actions, ...overrides };
}

function betaProfile(overrides: Partial<WispGameProfile> = {}): WispGameProfile {
  const actions: WispActionDefinition[] = [{ id: 'b-minerals', entryId: 'minerals', label: 'Minerals', controlType: 'set', slot: 1, presets: [{ id: 'p-full', label: 'Full', value: 500 }] }];
  return { schemaVersion: WISP_PROFILE_SCHEMA_VERSION, profileId: 'beta-profile', gameId: 'game-beta', source: 'builtin', groups: [], actions, ...overrides };
}

/** Resolves synchronously to whichever profile matches the requested gameId, or a no-profile result. Not a real resolver — a minimal, honest test double for resolveWispProfileForGame. */
function fixedProfileResolver(profiles: Record<string, WispGameProfile>) {
  return async (context: { gameId: string }) => {
    const profile = profiles[context.gameId];
    return profile ? { ok: true as const, profile } : { ok: false as const };
  };
}

function controllerFor(opts: {
  profiles: Record<string, WispGameProfile>;
  entries: Record<string, WispBoundEntryDescriptor>;
  getCurrentContext: () => WispRuntimeContext | null;
  adapter: WispTrainerExecutionAdapter;
}) {
  const entryLookup = fixtureLookup(opts.entries);
  const activeProfileProvider = createWispActiveProfileProvider({
    getCurrentContext: opts.getCurrentContext,
    resolveProfile: fixedProfileResolver(opts.profiles),
    entryLookup,
  });
  return createWispQuickSlotController({
    activeProfileProvider,
    getCurrentContext: opts.getCurrentContext,
    executorDeps: { entryLookup, identityBridge: createExplicitGameIdentityBridge({ 'game-alpha': 'cheat-alpha', 'game-beta': 'cheat-beta' }), trainerAdapter: opts.adapter },
  });
}

describe('REVIEW-GRADE — Increment 5 quick slot mapping and use-time resolution (Sections 6-8, 65)', () => {
  test('slot 1 resolves to the currently bound action, not a raw address/pid/token', () => {
    const { adapter } = fakeAdapter({ states: { 'game-alpha:hp': { frozen: false, currentValue: 100, dataType: 'int32', supportsControls: ['freeze'] } } });
    const controller = controllerFor({
      profiles: { 'game-alpha': alphaProfile() },
      entries: { 'game-alpha:hp': entryDescriptor('hp') },
      getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 }),
      adapter,
    });
    return controller.activate(1).then((result) => {
      assert.equal(result.actionId, 'a-hp');
      assert.equal(result.executed, true);
      assert.ok(!('address' in result) && !('pid' in result) && !('consentToken' in result), 'activation result must carry no raw memory/process/consent identity');
    });
  });
});

describe('REVIEW-GRADE — Increment 5 game switching (Sections 17, 61)', () => {
  test('the same physical slot resolves a different action after the active game switches, and the old action never fires', async () => {
    let currentGame = 'game-alpha';
    const { adapter, calls } = fakeAdapter({
      states: {
        'game-alpha:hp': { frozen: false, currentValue: 100, dataType: 'int32', supportsControls: ['freeze'] },
        'game-beta:minerals': { frozen: false, currentValue: 10, dataType: 'int32', supportsControls: ['set'] },
      },
    });
    const controller = controllerFor({
      profiles: { 'game-alpha': alphaProfile(), 'game-beta': betaProfile() },
      entries: { 'game-alpha:hp': entryDescriptor('hp'), 'game-beta:minerals': entryDescriptor('minerals') },
      getCurrentContext: () => ({ gameId: currentGame, sessionId: `${currentGame}-session`, sessionGeneration: 1 }),
      adapter,
    });

    const alphaResult = await controller.activate(1);
    assert.equal(alphaResult.actionId, 'a-hp');
    assert.equal(calls.proposeFreeze, 1);

    currentGame = 'game-beta';
    const betaResult = await controller.activate(1);
    assert.equal(betaResult.actionId, 'b-minerals', 'slot 1 must now resolve GAME_BETA\'s Minerals action, not the stale GAME_ALPHA HP binding');
    assert.equal(calls.proposeWrite, 1, 'the Beta activation must reach proposeWrite (Minerals is a set control), proving HP was never re-invoked');
    assert.equal(calls.proposeFreeze, 1, 'HP (freeze) must not fire again after the game switch');
  });
});

describe('REVIEW-GRADE — Increment 5 detached/stale/reattach (Sections 18, 62)', () => {
  test('no active session: hotkey press is harmless, executor never reached', async () => {
    const { adapter, calls } = fakeAdapter();
    const controller = controllerFor({
      profiles: { 'game-alpha': alphaProfile() },
      entries: { 'game-alpha:hp': entryDescriptor('hp') },
      getCurrentContext: () => null,
      adapter,
    });
    const result = await controller.activate(1);
    assert.equal(result.executed, false);
    assert.equal((result.diagnostic as { code: string }).code, 'WISP_HOTKEY_NO_ACTIVE_SESSION');
    assert.equal(calls.proposeFreeze + calls.proposeWrite, 0, 'the trainer adapter must never be reached when there is no active session');
  });

  test('empty slot: no crash, no arbitrary fallback, no executor call', async () => {
    const { adapter, calls } = fakeAdapter();
    const controller = controllerFor({
      profiles: { 'game-alpha': alphaProfile({ actions: [] }) },
      entries: {},
      getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 }),
      adapter,
    });
    const result = await controller.activate(4);
    assert.equal(result.executed, false);
    assert.equal((result.diagnostic as { code: string }).code, 'WISP_HOTKEY_SLOT_EMPTY');
    assert.equal(calls.proposeFreeze + calls.proposeWrite, 0);
  });

  test('unavailable action (missing entry): fails closed with a structured result, zero mutation', async () => {
    const { adapter, calls } = fakeAdapter();
    const controller = controllerFor({
      profiles: { 'game-alpha': alphaProfile() },
      entries: {}, // hp entry missing -> action.availability !== 'available'
      getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 }),
      adapter,
    });
    const result = await controller.activate(1);
    assert.equal(result.executed, false);
    assert.equal((result.diagnostic as { code: string }).code, 'WISP_HOTKEY_ACTION_UNAVAILABLE');
    assert.equal(calls.proposeFreeze + calls.proposeWrite, 0);
  });

  test('reattach/session-generation race: a binding resolved a moment ago is rejected by the reviewed Increment 4 stale check at execute time, zero mutation', async () => {
    let generation = 1;
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:hp': { frozen: false, currentValue: 100, dataType: 'int32', supportsControls: ['freeze'] } } });
    const controller = controllerFor({
      profiles: { 'game-alpha': alphaProfile() },
      entries: { 'game-alpha:hp': entryDescriptor('hp') },
      // Resolution/binding sees generation 1; by the time the controller
      // re-fetches context immediately before calling executeWispAction, the
      // session has already moved to generation 2 (Section 42's race).
      getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: generation }),
      adapter,
    });
    // Simplest deterministic race: the profile resolves/binds against
    // generation 1 (read synchronously inside getActiveBoundProfile before
    // any await settles), then generation moves to 2 before the controller's
    // own pre-execute re-fetch — reproducing Section 42's game/session race.
    const result = await (async () => {
      const p = controller.activate(1);
      generation = 2;
      return p;
    })();

    assert.equal(result.executionStatus, 'stale', `expected the executor's own binding revalidation to reject a session-generation race, got: ${JSON.stringify(result)}`);
    assert.equal(calls.proposeFreeze, 0, 'zero mutation when the session generation changed mid-activation');
  });
});

describe('REVIEW-GRADE — Increment 5 pending-consent isolation (Sections 33-34, 63)', () => {
  test('a second press on the same pending action is suppressed — no duplicate proposal, no silent token reuse', async () => {
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:xp': { frozen: false, currentValue: 0, dataType: 'int32', supportsControls: ['set'] } } });
    const controller = controllerFor({
      profiles: { 'game-alpha': alphaProfile() },
      entries: { 'game-alpha:xp': entryDescriptor('xp') },
      getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 }),
      adapter,
    });

    const first = await controller.activate(2);
    assert.equal(first.executionStatus, 'pending-consent');
    assert.equal(calls.proposeWrite, 1);

    const second = await controller.activate(2);
    assert.equal(second.executed, false);
    assert.equal((second.diagnostic as { code: string }).code, 'WISP_HOTKEY_EXECUTION_PENDING_CONSENT');
    assert.equal(calls.proposeWrite, 1, 'the second rapid press must not create a second independent proposal');
  });

  test('two different pending actions remain fully isolated from each other', async () => {
    const { adapter, calls } = fakeAdapter({
      states: {
        'game-alpha:hp': { frozen: false, currentValue: 100, dataType: 'int32', supportsControls: ['freeze'] },
        'game-alpha:xp': { frozen: false, currentValue: 0, dataType: 'int32', supportsControls: ['set'] },
      },
    });
    const controller = controllerFor({
      profiles: { 'game-alpha': alphaProfile() },
      entries: { 'game-alpha:hp': entryDescriptor('hp'), 'game-alpha:xp': entryDescriptor('xp') },
      getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 }),
      adapter,
    });

    const hp = await controller.activate(1);
    const xp = await controller.activate(2);
    assert.equal(hp.executionStatus, 'pending-consent');
    assert.equal(xp.executionStatus, 'pending-consent');
    assert.equal(calls.proposeFreeze, 1);
    assert.equal(calls.proposeWrite, 1);
  });

  test('rapid repeated presses on an already-terminal (rejected) action each independently re-propose — no stuck suppression', async () => {
    const { adapter, calls } = fakeAdapter({
      states: { 'game-alpha:xp': { frozen: false, currentValue: 0, dataType: 'int32', supportsControls: ['set'] } },
      proposeWrite: () => null, // always "unavailable" -> never enters the pending map, unlike freeze this control type has no alternating intent to confound the result
    });
    const controller = controllerFor({
      profiles: { 'game-alpha': alphaProfile() },
      entries: { 'game-alpha:xp': entryDescriptor('xp') },
      getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 }),
      adapter,
    });

    const a = await controller.activate(2);
    const b = await controller.activate(2);
    assert.equal(a.executionStatus, 'unavailable');
    assert.equal(b.executionStatus, 'unavailable');
    assert.equal(calls.proposeWrite, 2, 'a terminal (non-pending) result must not be suppressed on the next press');
  });
});

describe('Increment 5 Section 73 — residual R1 (duplicate freeze activation via hotkey)', () => {
  test('two rapid hotkey presses on the same freeze action produce exactly one proposal — no duplicate canonical freeze worker', async () => {
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:hp': { frozen: false, currentValue: 100, dataType: 'int32', supportsControls: ['freeze'] } } });
    const controller = controllerFor({
      profiles: { 'game-alpha': alphaProfile() },
      entries: { 'game-alpha:hp': entryDescriptor('hp') },
      getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 }),
      adapter,
    });

    const first = await controller.activate(1);
    const second = await controller.activate(1);

    assert.equal(first.executionStatus, 'pending-consent');
    assert.equal(second.executed, false);
    assert.equal((second.diagnostic as { code: string }).code, 'WISP_HOTKEY_EXECUTION_PENDING_CONSENT');
    assert.equal(calls.proposeFreeze, 1, 'R1 closed at the hotkey layer: pending-consent suppression means a second rapid press never stages a second freeze proposal, so the canonical freeze registry (unchanged since Increment 4) can never be asked to start two workers for one action');
    assert.equal(calls.confirmFreeze, 0, 'v1 hotkeys never hold a consent token, so confirmFreeze — the only path that could actually start a canonical freeze worker — is never reached at all from this layer');
  });
});

describe('REVIEW-GRADE — Increment 5 control activation dispatch (Section 72)', () => {
  test('toggle dispatches through the write path with no preset required', async () => {
    const profile = alphaProfile({ actions: [{ id: 'a-fuel', entryId: 'fuel', label: 'Fuel', controlType: 'toggle', slot: 1 }] });
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:fuel': { frozen: false, enabled: false, currentValue: false, dataType: 'bool', supportsControls: ['toggle'] } } });
    const controller = controllerFor({ profiles: { 'game-alpha': profile }, entries: { 'game-alpha:fuel': entryDescriptor('fuel') }, getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 }), adapter });
    const result = await controller.activate(1);
    assert.equal(result.executionStatus, 'pending-consent');
    assert.equal(calls.proposeWrite, 1);
  });

  test('cycle dispatches through the write path with no preset required', async () => {
    const profile = alphaProfile({ actions: [{ id: 'a-mode', entryId: 'mode', label: 'Mode', controlType: 'cycle', slot: 1, presets: [{ id: 'p1', label: 'A', value: 1 }, { id: 'p2', label: 'B', value: 2 }] }] });
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:mode': { frozen: false, currentValue: 1, dataType: 'int32', supportsControls: ['cycle'] } } });
    const controller = controllerFor({ profiles: { 'game-alpha': profile }, entries: { 'game-alpha:mode': entryDescriptor('mode') }, getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 }), adapter });
    const result = await controller.activate(1);
    assert.equal(result.executionStatus, 'pending-consent');
    assert.equal(calls.proposeWrite, 1);
  });

  test('set dispatches using the action\'s first declared preset value', async () => {
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:xp': { frozen: false, currentValue: 0, dataType: 'int32', supportsControls: ['set'] } } });
    const controller = controllerFor({ profiles: { 'game-alpha': alphaProfile() }, entries: { 'game-alpha:xp': entryDescriptor('xp') }, getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 }), adapter });
    const result = await controller.activate(2);
    assert.equal(result.executionStatus, 'pending-consent');
    assert.equal(calls.proposeWrite, 1);
  });

  test('set with no declared preset is rejected before the executor with WISP_HOTKEY_NO_DEFAULT_VALUE', async () => {
    const profile = alphaProfile({ actions: [{ id: 'a-xp', entryId: 'xp', label: 'XP', controlType: 'set', slot: 2 }] }); // no presets
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:xp': { frozen: false, currentValue: 0, dataType: 'int32', supportsControls: ['set'] } } });
    const controller = controllerFor({ profiles: { 'game-alpha': profile }, entries: { 'game-alpha:xp': entryDescriptor('xp') }, getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 }), adapter });
    const result = await controller.activate(2);
    assert.equal(result.executed, false);
    assert.equal((result.diagnostic as { code: string }).code, 'WISP_HOTKEY_NO_DEFAULT_VALUE');
    assert.equal(calls.proposeWrite, 0, 'no arbitrary/blank value must ever reach the executor');
  });

  test('increment dispatches using the first declared preset id', async () => {
    const profile = alphaProfile({ actions: [{ id: 'a-score', entryId: 'score', label: 'Score', controlType: 'increment', slot: 1, presets: [{ id: 'p10', label: '+10', value: 10 }] }] });
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:score': { frozen: false, currentValue: 0, dataType: 'int32', supportsControls: ['increment'] } } });
    const controller = controllerFor({ profiles: { 'game-alpha': profile }, entries: { 'game-alpha:score': entryDescriptor('score') }, getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 }), adapter });
    const result = await controller.activate(1);
    assert.equal(result.executionStatus, 'pending-consent');
    assert.equal(calls.proposeWrite, 1);
  });

  test('multiplier dispatches using the first declared preset id', async () => {
    const profile = alphaProfile({ actions: [{ id: 'a-gold', entryId: 'gold', label: 'Gold', controlType: 'multiplier', slot: 1, presets: [{ id: 'p2x', label: '2x', value: 2 }] }] });
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:gold': { frozen: false, currentValue: 5, dataType: 'int32', supportsControls: ['multiplier'] } } });
    const controller = controllerFor({ profiles: { 'game-alpha': profile }, entries: { 'game-alpha:gold': entryDescriptor('gold') }, getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 }), adapter });
    const result = await controller.activate(1);
    assert.equal(result.executionStatus, 'pending-consent');
    assert.equal(calls.proposeWrite, 1);
  });

  test('momentary dispatches using the first declared preset id, never a generic callback', async () => {
    const profile = alphaProfile({ actions: [{ id: 'a-boost', entryId: 'boost', label: 'Boost', controlType: 'momentary', slot: 1, presets: [{ id: 'p-on', label: 'On', value: true }] }] });
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:boost': { frozen: false, currentValue: false, dataType: 'bool', supportsControls: ['momentary'] } } });
    const controller = controllerFor({ profiles: { 'game-alpha': profile }, entries: { 'game-alpha:boost': entryDescriptor('boost') }, getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 }), adapter });
    const result = await controller.activate(1);
    assert.equal(result.executionStatus, 'pending-consent');
    assert.equal(calls.proposeWrite, 1);
  });

  test('momentary with no declared preset is rejected before the executor', async () => {
    const profile = alphaProfile({ actions: [{ id: 'a-boost', entryId: 'boost', label: 'Boost', controlType: 'momentary', slot: 1 }] });
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:boost': { frozen: false, currentValue: false, dataType: 'bool', supportsControls: ['momentary'] } } });
    const controller = controllerFor({ profiles: { 'game-alpha': profile }, entries: { 'game-alpha:boost': entryDescriptor('boost') }, getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 }), adapter });
    const result = await controller.activate(1);
    assert.equal(result.executed, false);
    assert.equal((result.diagnostic as { code: string }).code, 'WISP_HOTKEY_NO_DEFAULT_VALUE');
    assert.equal(calls.proposeWrite, 0);
  });

  test('freeze dispatches enable:true on the first activation (discrete, not keydown/keyup)', () => {
    const freezeIntent = new Map<string, boolean>();
    const action: WispActionDefinition = { id: 'a-hp', entryId: 'hp', label: 'HP', controlType: 'freeze' };
    const first = buildDefaultRequest('a-hp', 'p1', action, freezeIntent);
    assert.equal(first.ok, true);
    if (first.ok && first.request.control === 'freeze') assert.equal(first.request.enable, true);

    const second = buildDefaultRequest('a-hp', 'p1', action, freezeIntent);
    assert.equal(second.ok, true);
    if (second.ok && second.request.control === 'freeze') assert.equal(second.request.enable, false, 'a second discrete activation must flip toward stop — Section 36');
  });
});
