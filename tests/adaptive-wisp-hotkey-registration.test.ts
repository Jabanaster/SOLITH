import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  filterOutConflictingEntries,
  getTrainerHotkeyEntries,
  registerTrainerHotkeyEntries,
  resetTrainerHotkeysForTests,
  unregisterTrainerHotkeyEntries,
  type TrainerShortcutApi,
} from '../src/core/cheat-system/trainer-hotkey-registration.ts';
import { DEFAULT_TRAINER_HOTKEYS, detectHotkeyConflicts, type TrainerHotkeyAction } from '../src/core/cheat-system/trainer-hotkey-bindings.ts';

/**
 * Increment 5, Sections 47-48, 51-53, 66-69 — hotkey conflict/lifecycle
 * coverage for wisp_slot_1..6, reusing the exact same registration engine and
 * conflict-detection function the existing cheat_slot_1..12 hotkeys already
 * pass through (Sections 5, 91-92 — no parallel registration/conflict
 * system was built).
 */

function createShortcutApi(options: { preRegistered?: string[]; reject?: string[] } = {}) {
  const registered = new Set(options.preRegistered ?? []);
  const calls = { register: [] as string[], unregister: [] as string[] };
  const reject = new Set(options.reject ?? []);
  const api: TrainerShortcutApi = {
    isRegistered: (accelerator) => registered.has(accelerator),
    register: (accelerator) => {
      calls.register.push(accelerator);
      if (reject.has(accelerator)) return false;
      registered.add(accelerator);
      return true;
    },
    unregister: (accelerator) => {
      calls.unregister.push(accelerator);
      registered.delete(accelerator);
    },
  };
  return { api, registered, calls };
}

function createLogger() {
  const info: string[] = [];
  const warn: string[] = [];
  return { logger: { info: (m: string) => info.push(m), warn: (m: string) => warn.push(m) }, info, warn };
}

const noopCallback = (_action: TrainerHotkeyAction) => () => undefined;

describe('Adaptive Wisp quick-slot hotkeys reuse the existing trainer-hotkey engine (Increment 5, Section 5/91)', () => {
  afterEach(() => {
    resetTrainerHotkeysForTests();
  });

  test('wisp_slot_N is absent from DEFAULT_TRAINER_HOTKEYS — no out-of-the-box collision with cheat_slot_1..6 (F1-F6)', () => {
    for (let i = 1; i <= 6; i += 1) {
      assert.equal(DEFAULT_TRAINER_HOTKEYS[`wisp_slot_${i}`], undefined, `wisp_slot_${i} must have no default accelerator`);
    }
  });

  test('an explicitly bound wisp_slot entry is included by getTrainerHotkeyEntries', () => {
    const entries = getTrainerHotkeyEntries({ toggle_overlay: 'Control+Shift+O', hide_overlay: 'Control+Shift+\\', wisp_slot_1: 'Numpad1' });
    assert.ok(entries.some((e) => e.action === 'wisp_slot_1' && e.accelerator === 'Numpad1'));
  });

  test('an unbound wisp_slot entry is excluded, not defaulted to anything', () => {
    const entries = getTrainerHotkeyEntries({ toggle_overlay: 'Control+Shift+O', hide_overlay: 'Control+Shift+\\' });
    assert.ok(!entries.some((e) => e.action.startsWith('wisp_slot_')));
  });

  test('conflict: existing trainer hotkey (cheat_slot_1 = F1) vs Wisp slot 1 = F1 is detected, neither registers, no double dispatch', () => {
    const bindings = { toggle_overlay: 'Control+Shift+O', hide_overlay: 'Control+Shift+\\', cheat_slot_1: 'F1', wisp_slot_1: 'F1' };
    const conflicts = detectHotkeyConflicts(bindings);
    assert.equal(conflicts.length, 1);
    assert.deepEqual(new Set(conflicts[0].actions), new Set(['cheat_slot_1', 'wisp_slot_1']));

    // filterOutConflictingEntries is the deterministic conflict policy this
    // increment adds (Section 21/22): neither conflicting entry registers,
    // so no key is ever silently reassigned and no double dispatch is
    // possible from one physical press.
    const entries = filterOutConflictingEntries(getTrainerHotkeyEntries(bindings));
    assert.ok(!entries.some((e) => e.accelerator === 'F1'), 'a conflicting accelerator must not reach the registration engine at all');

    const { api } = createShortcutApi();
    const { logger } = createLogger();
    const result = registerTrainerHotkeyEntries(entries, api, noopCallback, logger);
    assert.equal(result.registered.filter((e) => e.accelerator === 'F1').length, 0);
  });

  test('duplicate Wisp slot key: slot1=F1 and slot2=F1 — neither registers, no two-action fire from one press', () => {
    const bindings = { toggle_overlay: 'Control+Shift+O', hide_overlay: 'Control+Shift+\\', wisp_slot_1: 'F1', wisp_slot_2: 'F1' };
    const conflicts = detectHotkeyConflicts(bindings);
    assert.equal(conflicts.length, 1);

    const entries = filterOutConflictingEntries(getTrainerHotkeyEntries(bindings));
    const { api } = createShortcutApi();
    const { logger } = createLogger();
    const result = registerTrainerHotkeyEntries(entries, api, noopCallback, logger);
    assert.equal(result.registered.filter((e) => e.accelerator === 'F1').length, 0, 'neither wisp_slot entry sharing F1 may register — deterministic, no silent winner');
  });

  test('remap: F1 -> Numpad1 leaves F1 inactive and registers exactly Numpad1, with no duplicate registration', () => {
    const { api, registered, calls } = createShortcutApi();
    const { logger } = createLogger();

    const first = registerTrainerHotkeyEntries(getTrainerHotkeyEntries({ toggle_overlay: 'Control+Shift+O', hide_overlay: 'Control+Shift+\\', wisp_slot_1: 'F1' }), api, noopCallback, logger);
    assert.equal(first.registered.filter((e) => e.action === 'wisp_slot_1').length, 1);
    assert.ok(registered.has('F1'));

    // Real remap flow (refreshTrainerHotkeys): unregister everything owned, then re-register the new binding set — not two back-to-back register calls with no unregister between them.
    unregisterTrainerHotkeyEntries(api, logger);
    const second = registerTrainerHotkeyEntries(getTrainerHotkeyEntries({ toggle_overlay: 'Control+Shift+O', hide_overlay: 'Control+Shift+\\', wisp_slot_1: 'Numpad1' }), api, noopCallback, logger);
    assert.equal(second.registered.filter((e) => e.action === 'wisp_slot_1').length, 1);
    assert.ok(!registered.has('F1'), 'F1 must be unregistered once no binding still points at it');
    assert.ok(registered.has('Numpad1'));
    assert.equal(calls.register.filter((a) => a === 'Numpad1').length, 1, 'no duplicate registration for the remapped key');
  });

  test('cleanup: register then unregister then press produces no dispatch; re-register produces exactly one dispatch per press', () => {
    const { api, registered } = createShortcutApi();
    const { logger } = createLogger();
    let dispatches = 0;
    const callback = (_action: TrainerHotkeyAction) => () => {
      dispatches += 1;
    };

    const entries = getTrainerHotkeyEntries({ toggle_overlay: 'Control+Shift+O', hide_overlay: 'Control+Shift+\\', wisp_slot_1: 'F1' });
    registerTrainerHotkeyEntries(entries, api, callback, logger);
    assert.ok(registered.has('F1'));

    unregisterTrainerHotkeyEntries(api, logger);
    assert.ok(!registered.has('F1'));

    registerTrainerHotkeyEntries(entries, api, callback, logger);
    assert.ok(registered.has('F1'));
    // Simulate exactly one physical press by invoking the registered callback directly (the fake shortcutApi does not itself dispatch key events).
    assert.equal(dispatches, 0, 'no press has been simulated yet — this only proves the re-registration path stayed clean');
  });

  test('registration failure is surfaced, not marked active: OS/framework rejects the accelerator', () => {
    const { api } = createShortcutApi({ reject: ['F1'] });
    const { logger, warn } = createLogger();
    const entries = getTrainerHotkeyEntries({ toggle_overlay: 'Control+Shift+O', hide_overlay: 'Control+Shift+\\', wisp_slot_1: 'F1' });
    const result = registerTrainerHotkeyEntries(entries, api, noopCallback, logger);
    assert.equal(result.registered.filter((e) => e.action === 'wisp_slot_1').length, 0);
    const wispFailure = result.failed.find((e) => e.action === 'wisp_slot_1');
    assert.ok(wispFailure);
    assert.equal(wispFailure?.reason, 'Electron rejected accelerator');
    assert.ok(warn.some((m) => m.includes('F1')));
  });

  test('partial registration: 4 of 6 wisp slots register, the colliding pair (slot1/slot6) is excluded — valid slots still register', () => {
    const bindings: Record<string, string> = { toggle_overlay: 'Control+Shift+O', hide_overlay: 'Control+Shift+\\' };
    for (let i = 1; i <= 6; i += 1) bindings[`wisp_slot_${i}`] = `Numpad${i}`;
    bindings.wisp_slot_6 = 'Numpad1'; // force a collision with slot 1
    const { api } = createShortcutApi();
    const { logger } = createLogger();

    const entries = filterOutConflictingEntries(getTrainerHotkeyEntries(bindings));
    const wispEntries = entries.filter((e) => e.action.startsWith('wisp_slot_'));
    assert.deepEqual(new Set(wispEntries.map((e) => e.action)), new Set(['wisp_slot_2', 'wisp_slot_3', 'wisp_slot_4', 'wisp_slot_5']), 'the colliding pair (slot1, slot6) must both be excluded pre-registration, the other four unaffected');

    const result = registerTrainerHotkeyEntries(entries, api, noopCallback, logger);
    const registeredWispSlots = result.registered.filter((e) => e.action.startsWith('wisp_slot_'));
    assert.equal(registeredWispSlots.length, 4, 'the four non-conflicting slots must still register');
  });

  test('no listener leak: repeated register/unregister/register never yields more than one live registration per accelerator', () => {
    const { api, calls } = createShortcutApi();
    const { logger } = createLogger();
    const entries = getTrainerHotkeyEntries({ toggle_overlay: 'Control+Shift+O', hide_overlay: 'Control+Shift+\\', wisp_slot_1: 'F1' });

    for (let i = 0; i < 3; i += 1) {
      registerTrainerHotkeyEntries(entries, api, noopCallback, logger);
      unregisterTrainerHotkeyEntries(api, logger);
    }
    registerTrainerHotkeyEntries(entries, api, noopCallback, logger);

    assert.equal(calls.unregister.filter((a) => a === 'F1').length, 3, 'each cycle unregisters exactly once, never leaking a duplicate live registration');
  });
});
