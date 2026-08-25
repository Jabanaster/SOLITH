import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WISP_PROFILE_SCHEMA_VERSION,
  bindResolvedProfile,
  createWispSessionGenerationTracker,
  validateWispBinding,
  type WispGameProfile,
  type WispTrainerEntryLookup,
  type WispBoundEntryDescriptor,
} from '../src/core/adaptive-wisp/index.ts';

function fixtureLookup(entries: Record<string, WispBoundEntryDescriptor>): WispTrainerEntryLookup {
  return { resolveEntry: (gameId, entryId) => entries[`${gameId}:${entryId}`] ?? null };
}

function entry(id: string): WispBoundEntryDescriptor {
  return { id, label: id, dataType: 'int32', enabled: true };
}

function healthProfile(gameId: string, extra: Partial<WispGameProfile> = {}): WispGameProfile {
  return {
    schemaVersion: WISP_PROFILE_SCHEMA_VERSION,
    profileId: `${gameId}-profile`,
    gameId,
    source: 'builtin',
    groups: [],
    actions: [{ id: 'a-health', entryId: 'health', label: 'Health', controlType: 'freeze' }],
    ...extra,
  };
}

describe('WispSessionGenerationTracker — Section 12, 40', () => {
  test('the same (gameId, pid, processStartTime) sample keeps the same sessionId/generation', () => {
    const tracker = createWispSessionGenerationTracker();
    const raw = { gameId: 'game-alpha', pid: 100, processStartTime: 't1' };
    const first = tracker.observe(raw);
    const second = tracker.observe(raw);
    assert.equal(first?.sessionId, second?.sessionId);
    assert.equal(first?.sessionGeneration, second?.sessionGeneration);
  });

  test('a detach (gameId null) reports no current context', () => {
    const tracker = createWispSessionGenerationTracker();
    tracker.observe({ gameId: 'game-alpha', pid: 100, processStartTime: 't1' });
    const detached = tracker.observe({ gameId: null });
    assert.equal(detached, null);
  });

  test('missing pid or processStartTime is treated as unprovable — fail closed (Section 32)', () => {
    const tracker = createWispSessionGenerationTracker();
    assert.equal(tracker.observe({ gameId: 'game-alpha' }), null);
    assert.equal(tracker.observe({ gameId: 'game-alpha', pid: 100 }), null);
  });

  test('reattaching the same game produces a new, higher generation', () => {
    const tracker = createWispSessionGenerationTracker();
    const first = tracker.observe({ gameId: 'game-alpha', pid: 100, processStartTime: 't1' });
    tracker.observe({ gameId: null });
    const second = tracker.observe({ gameId: 'game-alpha', pid: 101, processStartTime: 't2' });
    assert.ok(second!.sessionGeneration > first!.sessionGeneration);
    assert.notEqual(second!.sessionId, first!.sessionId);
  });

  test('PID reuse: identical pid but a different processStartTime is treated as a distinct session (Section 43)', () => {
    const tracker = createWispSessionGenerationTracker();
    const first = tracker.observe({ gameId: 'game-alpha', pid: 500, processStartTime: 't-generation-1' });
    tracker.observe({ gameId: null });
    const second = tracker.observe({ gameId: 'game-alpha', pid: 500, processStartTime: 't-generation-2' });
    assert.notEqual(first!.sessionId, second!.sessionId);
    assert.ok(second!.sessionGeneration > first!.sessionGeneration);
  });

  test('switching games mid-stream also advances the generation', () => {
    const tracker = createWispSessionGenerationTracker();
    const alpha = tracker.observe({ gameId: 'game-alpha', pid: 100, processStartTime: 't1' });
    const beta = tracker.observe({ gameId: 'game-beta', pid: 200, processStartTime: 't2' });
    assert.notEqual(alpha!.sessionId, beta!.sessionId);
    assert.ok(beta!.sessionGeneration > alpha!.sessionGeneration);
  });
});

describe('End-to-end stale-binding rejection (Final Acceptance Example)', () => {
  test('detach then reattach: the old generation binding is rejected, the new one is valid', () => {
    const tracker = createWispSessionGenerationTracker();
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health') });

    const gen1 = tracker.observe({ gameId: 'game-alpha', pid: 100, processStartTime: 't1' })!;
    const bound1 = bindResolvedProfile(healthProfile('game-alpha'), gen1, lookup);
    assert.equal(bound1.ok, true);
    if (!bound1.ok) return;
    const binding1 = bound1.profile.actions[0].binding!;

    tracker.observe({ gameId: null }); // detach
    assert.equal(validateWispBinding(binding1, null).valid, false);

    const gen2 = tracker.observe({ gameId: 'game-alpha', pid: 101, processStartTime: 't2' })!; // reattach
    assert.equal(validateWispBinding(binding1, gen2).valid, false, 'the old generation-1 binding must remain invalid under generation 2');

    const bound2 = bindResolvedProfile(healthProfile('game-alpha'), gen2, lookup);
    assert.equal(bound2.ok, true);
    if (bound2.ok) assert.equal(validateWispBinding(bound2.profile.actions[0].binding!, gen2).valid, true);
  });

  test('switching to a different game invalidates the prior game bindings even with a colliding entryId', () => {
    const tracker = createWispSessionGenerationTracker();
    const lookup = fixtureLookup({ 'game-alpha:health': entry('alpha-health'), 'game-beta:health': entry('beta-health') });

    const alphaCtx = tracker.observe({ gameId: 'game-alpha', pid: 100, processStartTime: 't1' })!;
    const alphaBound = bindResolvedProfile(healthProfile('game-alpha'), alphaCtx, lookup);
    assert.equal(alphaBound.ok, true);
    if (!alphaBound.ok) return;
    const alphaBinding = alphaBound.profile.actions[0].binding!;

    const betaCtx = tracker.observe({ gameId: 'game-beta', pid: 200, processStartTime: 't2' })!;
    const result = validateWispBinding(alphaBinding, betaCtx);
    assert.equal(result.valid, false);
    assert.equal(result.diagnostics[0].code, 'WISP_BINDING_GAME_MISMATCH');
  });
});

describe('Cross-game entry-id collision security (Section 41)', () => {
  test('GAME_ALPHA "health" and GAME_BETA "health" resolve to distinct entries and never cross-bind', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('alpha-health'), 'game-beta:health': entry('beta-health') });
    assert.equal(lookup.resolveEntry('game-alpha', 'health')?.label, 'alpha-health');
    assert.equal(lookup.resolveEntry('game-beta', 'health')?.label, 'beta-health');
  });

  test('binding GAME_ALPHA then attempting to validate under GAME_BETA context always fails, regardless of matching entryId', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('alpha-health'), 'game-beta:health': entry('beta-health') });
    const alphaCtx = { gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 };
    const betaCtx = { gameId: 'game-beta', sessionId: 's2', sessionGeneration: 2 };

    const bound = bindResolvedProfile(healthProfile('game-alpha'), alphaCtx, lookup);
    assert.equal(bound.ok, true);
    if (!bound.ok) return;
    assert.equal(validateWispBinding(bound.profile.actions[0].binding!, betaCtx).valid, false);
  });
});

describe('Table/trainer collision security (Section 42)', () => {
  test('a binding created under Table A is rejected when the current context is Table B, even with the same entryId', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health') });
    const tableACtx = { gameId: 'game-alpha', trainerId: 'trainer-alpha', tableId: 'table-a', sessionId: 's1', sessionGeneration: 1 };
    const tableBCtx = { gameId: 'game-alpha', trainerId: 'trainer-alpha', tableId: 'table-b', sessionId: 's1', sessionGeneration: 1 };

    const bound = bindResolvedProfile(healthProfile('game-alpha'), tableACtx, lookup);
    assert.equal(bound.ok, true);
    if (!bound.ok) return;
    const result = validateWispBinding(bound.profile.actions[0].binding!, tableBCtx);
    assert.equal(result.valid, false);
    assert.equal(result.diagnostics[0].code, 'WISP_BINDING_TABLE_MISMATCH');
  });
});

describe('Context failure tests (Section 45) — fail closed', () => {
  test('a profile requiring a trainerId rejects binding when the runtime context has no trainerId', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health') });
    const profile = healthProfile('game-alpha', { trainerId: 'trainer-alpha' });
    const ctx = { gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 };
    const result = bindResolvedProfile(profile, ctx, lookup);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.diagnostics[0].code, 'WISP_BINDING_TRAINER_MISMATCH');
  });

  test('a profile requiring a tableId rejects binding when the runtime context has no tableId', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health') });
    const profile = healthProfile('game-alpha', { tableId: 'table-a' });
    const ctx = { gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 };
    const result = bindResolvedProfile(profile, ctx, lookup);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.diagnostics[0].code, 'WISP_BINDING_TABLE_MISMATCH');
  });

  test('a missing/null runtime context always fails closed', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health') });
    const result = bindResolvedProfile(healthProfile('game-alpha'), null, lookup);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.diagnostics[0].code, 'WISP_BINDING_SESSION_MISSING');
  });
});
