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

  test('REGRESSION (review-discovered): a pending action in GAME_ALPHA does not falsely suppress an identically-named actionId in GAME_BETA', async () => {
    // Two different games' profiles coincidentally declare the SAME
    // actionId string ("a-shared") for two entirely unrelated actions.
    // actionId is only unique within one profile — nothing in the domain
    // model guarantees global uniqueness across different games' profiles.
    let currentGame = 'game-alpha';
    const alphaShared = { schemaVersion: WISP_PROFILE_SCHEMA_VERSION, profileId: 'alpha-profile', gameId: 'game-alpha', source: 'builtin' as const, groups: [], actions: [{ id: 'a-shared', entryId: 'hp', label: 'HP', controlType: 'set' as const, slot: 1, presets: [{ id: 'p1', label: 'Full', value: 999 }] }] };
    const betaShared = { schemaVersion: WISP_PROFILE_SCHEMA_VERSION, profileId: 'beta-profile', gameId: 'game-beta', source: 'builtin' as const, groups: [], actions: [{ id: 'a-shared', entryId: 'minerals', label: 'Minerals', controlType: 'set' as const, slot: 1, presets: [{ id: 'p1', label: 'Full', value: 500 }] }] };
    const { adapter, calls } = fakeAdapter({
      states: {
        'game-alpha:hp': { frozen: false, currentValue: 0, dataType: 'int32', supportsControls: ['set'] },
        'game-beta:minerals': { frozen: false, currentValue: 0, dataType: 'int32', supportsControls: ['set'] },
      },
    });
    const controller = controllerFor({
      profiles: { 'game-alpha': alphaShared, 'game-beta': betaShared },
      entries: { 'game-alpha:hp': entryDescriptor('hp'), 'game-beta:minerals': entryDescriptor('minerals') },
      getCurrentContext: () => ({ gameId: currentGame, sessionId: `${currentGame}-session`, sessionGeneration: 1 }),
      adapter,
    });

    // GAME_ALPHA's a-shared goes pending.
    const alphaResult = await controller.activate(1);
    assert.equal(alphaResult.executionStatus, 'pending-consent');
    assert.equal(calls.proposeWrite, 1);

    // Switch to GAME_BETA — its OWN a-shared (a different real action) must
    // NOT be suppressed as "already pending" just because Alpha's identically
    // -named actionId is pending.
    currentGame = 'game-beta';
    const betaResult = await controller.activate(1);
    assert.equal(betaResult.executionStatus, 'pending-consent', `GAME_BETA's a-shared must independently propose, not be suppressed by GAME_ALPHA's pending state: ${JSON.stringify(betaResult)}`);
    assert.equal(calls.proposeWrite, 2, 'GAME_BETA activation must reach proposeWrite independently of GAME_ALPHA\'s pending proposal');
  });

  test('REGRESSION (review-discovered): freeze enable/disable intent does not leak across games sharing an actionId', () => {
    const freezeIntent = new Map<string, boolean>();
    const alphaAction: WispActionDefinition = { id: 'a-shared', entryId: 'hp', label: 'HP', controlType: 'freeze' };
    const betaAction: WispActionDefinition = { id: 'a-shared', entryId: 'shield', label: 'Shield', controlType: 'freeze' };

    const alphaFirst = buildDefaultRequest('a-shared', 'game-alpha:a-shared', 'p1', alphaAction, freezeIntent);
    assert.equal(alphaFirst.ok, true);
    if (alphaFirst.ok && alphaFirst.request.control === 'freeze') assert.equal(alphaFirst.request.enable, true, 'GAME_ALPHA first press must be enable:true');

    // GAME_BETA's identically-named action must ALSO start at enable:true —
    // it must not inherit GAME_ALPHA's now-flipped (enable:false) intent.
    const betaFirst = buildDefaultRequest('a-shared', 'game-beta:a-shared', 'p1', betaAction, freezeIntent);
    assert.equal(betaFirst.ok, true);
    if (betaFirst.ok && betaFirst.request.control === 'freeze') assert.equal(betaFirst.request.enable, true, 'GAME_BETA must not inherit GAME_ALPHA\'s freeze intent for the same actionId string');
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

});

describe('Increment 5 closeout, Phase A — pending-state lifecycle', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  test('pending state clears on detach; reattach does not inherit it', async () => {
    let attached = true;
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:xp': { frozen: false, currentValue: 0, dataType: 'int32', supportsControls: ['set'] } } });
    const controller = controllerFor({
      profiles: { 'game-alpha': alphaProfile() },
      entries: { 'game-alpha:xp': entryDescriptor('xp') },
      getCurrentContext: () => (attached ? { gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 } : null),
      adapter,
    });

    const first = await controller.activate(2);
    assert.equal(first.executionStatus, 'pending-consent');
    assert.equal(calls.proposeWrite, 1);

    attached = false;
    const detachedResult = await controller.activate(2);
    assert.equal((detachedResult.diagnostic as { code: string }).code, 'WISP_HOTKEY_NO_ACTIVE_SESSION');

    attached = true;
    const afterReattach = await controller.activate(2);
    assert.equal(afterReattach.executionStatus, 'pending-consent', 'the pre-detach pending entry must not survive reattach');
    assert.equal(calls.proposeWrite, 2, 'reattach must independently re-propose, proving the old pending entry was cleared rather than shadowed');
  });

  test('freeze enable/disable intent clears on detach', async () => {
    let attached = true;
    const { adapter, calls } = fakeAdapter({
      states: { 'game-alpha:hp': { frozen: false, currentValue: 100, dataType: 'int32', supportsControls: ['freeze'] } },
      proposeFreeze: () => null, // always terminal/unavailable — never enters the pending map, so intent flips freely across repeated presses without pending-consent suppression masking the toggle
    });
    const controller = controllerFor({
      profiles: { 'game-alpha': alphaProfile() },
      entries: { 'game-alpha:hp': entryDescriptor('hp') },
      getCurrentContext: () => (attached ? { gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 } : null),
      adapter,
    });

    const first = await controller.activate(1);
    assert.equal(first.executionStatus, 'unavailable');
    assert.equal(calls.proposeFreeze, 1, 'first press must be enable:true, reaching proposeFreeze');
    assert.equal(calls.stopFreeze, 0);

    attached = false;
    await controller.activate(1);
    attached = true;

    const afterReattach = await controller.activate(1);
    assert.equal(afterReattach.executionStatus, 'unavailable');
    assert.equal(calls.proposeFreeze, 2, 'post-detach press must again be enable:true (proposeFreeze), not enable:false (stopFreeze) — the pre-detach intent must not survive');
    assert.equal(calls.stopFreeze, 0, 'if the intent had survived detach, this press would have flipped to enable:false and called stopFreeze instead');
  });

  test('repeated detach is idempotent and harmless', async () => {
    const { adapter, calls } = fakeAdapter();
    const controller = controllerFor({
      profiles: { 'game-alpha': alphaProfile() },
      entries: { 'game-alpha:hp': entryDescriptor('hp') },
      getCurrentContext: () => null,
      adapter,
    });
    const results = await Promise.all([controller.activate(1), controller.activate(1), controller.activate(1)]);
    for (const r of results) assert.equal((r.diagnostic as { code: string }).code, 'WISP_HOTKEY_NO_ACTIVE_SESSION');
    assert.equal(calls.proposeFreeze + calls.proposeWrite + calls.confirmFreeze + calls.confirmWrite + calls.stopFreeze, 0, 'repeated detach reads must never touch the trainer adapter');
  });

  test('unchanged context preserves legitimate pending state across repeated reads', async () => {
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
    assert.equal(hp.executionStatus, 'pending-consent');
    // Repeated reads of an UNCHANGED context (pressing an unrelated slot)
    // must not disturb HP's pending entry.
    await controller.activate(2);
    await controller.activate(2);
    const hpAgain = await controller.activate(1);
    assert.equal((hpAgain.diagnostic as { code: string }).code, 'WISP_HOTKEY_EXECUTION_PENDING_CONSENT', 'HP must still be suppressed as pending — unrelated reads of the same context must not have cleared it');
    assert.equal(calls.proposeFreeze, 1);
  });

  test('session ID change clears pending state even when gameId is unchanged', async () => {
    let sessionId = 's1';
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:xp': { frozen: false, currentValue: 0, dataType: 'int32', supportsControls: ['set'] } } });
    const controller = controllerFor({
      profiles: { 'game-alpha': alphaProfile() },
      entries: { 'game-alpha:xp': entryDescriptor('xp') },
      getCurrentContext: () => ({ gameId: 'game-alpha', sessionId, sessionGeneration: 1 }),
      adapter,
    });
    const first = await controller.activate(2);
    assert.equal(first.executionStatus, 'pending-consent');
    sessionId = 's2';
    const afterSessionChange = await controller.activate(2);
    assert.equal(afterSessionChange.executionStatus, 'pending-consent', 'a new sessionId must not inherit the old session\'s pending entry');
    assert.equal(calls.proposeWrite, 2);
  });

  test('session-generation change (reattach/PID replacement) clears pending state', async () => {
    let generation = 1;
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:xp': { frozen: false, currentValue: 0, dataType: 'int32', supportsControls: ['set'] } } });
    const controller = controllerFor({
      profiles: { 'game-alpha': alphaProfile() },
      entries: { 'game-alpha:xp': entryDescriptor('xp') },
      getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: generation }),
      adapter,
    });
    const first = await controller.activate(2);
    assert.equal(first.executionStatus, 'pending-consent');
    generation = 2;
    const afterGenerationChange = await controller.activate(2);
    assert.equal(afterGenerationChange.executionStatus, 'pending-consent', 'a session-generation bump (process replaced/PID reused) must not inherit the old generation\'s pending entry');
    assert.equal(calls.proposeWrite, 2);
  });

  test('game switch A -> B -> A does not restore old state', async () => {
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

    const alphaFirst = await controller.activate(1);
    assert.equal(alphaFirst.executionStatus, 'pending-consent');
    assert.equal(calls.proposeFreeze, 1);

    currentGame = 'game-beta';
    await controller.activate(1);

    currentGame = 'game-alpha';
    const alphaAgain = await controller.activate(1);
    assert.equal(alphaAgain.executionStatus, 'pending-consent', 'returning to GAME_ALPHA must not restore its pre-switch pending entry');
    assert.equal(calls.proposeFreeze, 2, 'the second GAME_ALPHA HP activation must independently re-propose');
  });

  test('profile replacement (same game/session, different profile identity) clears pending state', async () => {
    let useV2 = false;
    const v1Profile = alphaProfile({ profileId: 'alpha-profile-v1', actions: [{ id: 'a-x', entryId: 'xp', label: 'XP', controlType: 'set', slot: 2, presets: [{ id: 'p1', label: 'Full', value: 999 }] }] });
    const v2Profile = alphaProfile({ profileId: 'alpha-profile-v2', actions: [{ id: 'a-x', entryId: 'xp', label: 'XP', controlType: 'set', slot: 2, presets: [{ id: 'p1', label: 'Full', value: 999 }] }] });
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:xp': { frozen: false, currentValue: 0, dataType: 'int32', supportsControls: ['set'] } } });
    const entryLookup = fixtureLookup({ 'game-alpha:xp': entryDescriptor('xp') });
    const activeProfileProvider = createWispActiveProfileProvider({
      getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 }),
      resolveProfile: async () => ({ ok: true, profile: useV2 ? v2Profile : v1Profile }),
      entryLookup,
    });
    const controller = createWispQuickSlotController({
      activeProfileProvider,
      getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 }),
      executorDeps: { entryLookup, identityBridge: createExplicitGameIdentityBridge({ 'game-alpha': 'cheat-alpha' }), trainerAdapter: adapter },
    });

    const first = await controller.activate(2);
    assert.equal(first.executionStatus, 'pending-consent');
    assert.equal(calls.proposeWrite, 1);

    useV2 = true;
    const afterProfileSwap = await controller.activate(2);
    assert.equal(afterProfileSwap.executionStatus, 'pending-consent', 'a profile-identity change must not inherit the prior profile\'s pending entry for the same actionId');
    assert.equal(calls.proposeWrite, 2);
  });

  test('late completion from an old game cannot corrupt the newer game\'s state', async () => {
    let currentGame = 'game-alpha';
    const alphaGate = deferred<{ ok: true; profile: WispGameProfile }>();
    const { adapter, calls } = fakeAdapter({
      states: {
        'game-alpha:hp': { frozen: false, currentValue: 100, dataType: 'int32', supportsControls: ['freeze'] },
        'game-beta:minerals': { frozen: false, currentValue: 10, dataType: 'int32', supportsControls: ['set'] },
      },
    });
    const entryLookup = fixtureLookup({ 'game-alpha:hp': entryDescriptor('hp'), 'game-beta:minerals': entryDescriptor('minerals') });
    const activeProfileProvider = createWispActiveProfileProvider({
      getCurrentContext: () => ({ gameId: currentGame, sessionId: `${currentGame}-session`, sessionGeneration: 1 }),
      resolveProfile: async (context) => {
        if (context.gameId === 'game-alpha') return alphaGate.promise;
        return { ok: true as const, profile: betaProfile() };
      },
      entryLookup,
    });
    const controller = createWispQuickSlotController({
      activeProfileProvider,
      getCurrentContext: () => ({ gameId: currentGame, sessionId: `${currentGame}-session`, sessionGeneration: 1 }),
      executorDeps: { entryLookup, identityBridge: createExplicitGameIdentityBridge({ 'game-alpha': 'cheat-alpha', 'game-beta': 'cheat-beta' }), trainerAdapter: adapter },
    });

    // Slow GAME_ALPHA activation starts and suspends inside resolveProfile.
    const slowAlpha = controller.activate(1);

    // Before it resolves, the user switches to GAME_BETA and successfully
    // activates its own slot 1 — this must reset controller state for the
    // new context.
    currentGame = 'game-beta';
    const betaResult = await controller.activate(1);
    assert.equal(betaResult.actionId, 'b-minerals');
    assert.equal(calls.proposeWrite, 1);

    // Now let the stale GAME_ALPHA resolution complete. Its binding no
    // longer matches the current (GAME_BETA) context, so Increment 4's own
    // validateWispBinding rejects it as stale — but even independent of
    // that, this late completion must not be allowed to write a ghost
    // pending entry for GAME_ALPHA into the controller's maps.
    alphaGate.resolve({ ok: true, profile: alphaProfile() });
    const staleAlphaResult = await slowAlpha;
    assert.equal(staleAlphaResult.executionStatus, 'stale', `expected the late GAME_ALPHA completion to be rejected as stale by Increment 4\'s binding check: ${JSON.stringify(staleAlphaResult)}`);
    assert.equal(calls.proposeFreeze, 0, 'the late completion must never reach proposeFreeze once the context has moved on');

    // Switching back to GAME_ALPHA (fresh session, i.e. a real reattach)
    // must not find a ghost pending entry left behind by the late completion.
    currentGame = 'game-alpha';
    const freshAlpha = await controller.activate(1);
    assert.equal(freshAlpha.executionStatus, 'pending-consent', 'GAME_ALPHA must be able to propose independently — no ghost pending state from the stale completion');
    assert.equal(calls.proposeFreeze, 1);
  });

  test('dispose() clears pending and freeze-intent state without touching the trainer adapter (feature-disable / shutdown)', async () => {
    const { adapter, calls } = fakeAdapter({ states: { 'game-alpha:xp': { frozen: false, currentValue: 0, dataType: 'int32', supportsControls: ['set'] } } });
    const controller = controllerFor({
      profiles: { 'game-alpha': alphaProfile() },
      entries: { 'game-alpha:xp': entryDescriptor('xp') },
      getCurrentContext: () => ({ gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 }),
      adapter,
    });

    const first = await controller.activate(2);
    assert.equal(first.executionStatus, 'pending-consent');
    const callsBeforeDispose = calls.proposeWrite + calls.confirmWrite + calls.proposeFreeze + calls.confirmFreeze + calls.stopFreeze;

    controller.dispose();
    controller.dispose(); // idempotent — must not throw or double-mutate

    assert.equal(calls.proposeWrite + calls.confirmWrite + calls.proposeFreeze + calls.confirmFreeze + calls.stopFreeze, callsBeforeDispose, 'dispose() must never call the trainer adapter — no write, freeze, confirm, or stop');

    const afterDispose = await controller.activate(2);
    assert.equal(afterDispose.executionStatus, 'pending-consent', 'dispose() must clear the pending entry so the same action can be re-proposed');
    assert.equal(calls.proposeWrite, 2);
  });
});

describe('REVIEW-GRADE — Increment 5 control activation dispatch (Section 72), continued', () => {
  test('freeze dispatches enable:true on the first activation (discrete, not keydown/keyup)', () => {
    const freezeIntent = new Map<string, boolean>();
    const action: WispActionDefinition = { id: 'a-hp', entryId: 'hp', label: 'HP', controlType: 'freeze' };
    const first = buildDefaultRequest('a-hp', 'game-alpha:a-hp', 'p1', action, freezeIntent);
    assert.equal(first.ok, true);
    if (first.ok && first.request.control === 'freeze') assert.equal(first.request.enable, true);

    const second = buildDefaultRequest('a-hp', 'game-alpha:a-hp', 'p1', action, freezeIntent);
    assert.equal(second.ok, true);
    if (second.ok && second.request.control === 'freeze') assert.equal(second.request.enable, false, 'a second discrete activation must flip toward stop — Section 36');
  });
});
