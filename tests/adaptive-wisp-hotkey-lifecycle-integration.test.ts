import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  buildTrainerHotkeyRegistrationPlan,
  registerTrainerHotkeyEntries,
  resetTrainerHotkeysForTests,
  unregisterTrainerHotkeyEntries,
  type TrainerShortcutApi,
} from '../src/core/cheat-system/trainer-hotkey-registration.ts';
import type { TrainerHotkeyAction } from '../src/core/cheat-system/trainer-hotkey-bindings.ts';

/**
 * Increment 5 closeout, Phase C — lifecycle integration tests that drive the
 * REAL composed production behavior electron/trainer-hotkeys.ts's
 * registerTrainerHotkeys()/unregisterTrainerHotkeys()/refreshTrainerHotkeys()
 * implement, not just their individual pure pieces in isolation.
 *
 * electron/trainer-hotkeys.ts itself cannot be imported directly in this
 * suite — it imports the real 'electron' module (globalShortcut, BrowserWindow,
 * ipcMain), which is unavailable outside a running Electron process (the
 * same reason buildTrainerHotkeyRegistrationPlan was extracted as a pure,
 * electron-free function during the prior review remediation). The three
 * production functions in that file are thin, ordering-only wrappers around
 * buildTrainerHotkeyRegistrationPlan + registerTrainerHotkeyEntries +
 * unregisterTrainerHotkeyEntries — every one of those is exercised here in
 * the EXACT sequence and with the EXACT arguments the real wrappers use
 * (verified by reading electron/trainer-hotkeys.ts source), substituting
 * only a fake TrainerShortcutApi in place of the real globalShortcut. This
 * is "as directly as the architecture safely allows" without introducing a
 * privileged test-only production bypass. Real globalShortcut registration
 * itself remains covered only by the Playwright electron-consent-boundary
 * smoke test (main-process-boot level, not wisp_slot-specific — see the
 * Increment 5 review's Packaged/Real-OS Boundary section).
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

/** Mirrors electron/trainer-hotkeys.ts's registerTrainerHotkeys() body exactly, minus the real globalShortcut/flag-lookup I/O. */
function driveRegister(api: TrainerShortcutApi, logger: ReturnType<typeof createLogger>['logger'], bindings: Record<string, string>, wispEnabled: boolean) {
  const plan = buildTrainerHotkeyRegistrationPlan(bindings, { wispEnabled });
  return registerTrainerHotkeyEntries(plan, api, noopCallback, logger);
}

/** Mirrors electron/trainer-hotkeys.ts's unregisterTrainerHotkeys() body exactly. */
function driveUnregister(api: TrainerShortcutApi, logger: ReturnType<typeof createLogger>['logger']) {
  return unregisterTrainerHotkeyEntries(api, logger);
}

/** Mirrors electron/trainer-hotkeys.ts's refreshTrainerHotkeys() body exactly: full unregister, then register. */
function driveRefresh(api: TrainerShortcutApi, logger: ReturnType<typeof createLogger>['logger'], bindings: Record<string, string>, wispEnabled: boolean) {
  driveUnregister(api, logger);
  return driveRegister(api, logger, bindings, wispEnabled);
}

describe('Increment 5 closeout, Phase C — disable and re-enable', () => {
  afterEach(() => resetTrainerHotkeysForTests());

  test('full disable -> refresh -> re-enable -> refresh cycle', () => {
    const bindings = { toggle_overlay: 'Control+Shift+O', hide_overlay: 'Control+Shift+\\', wisp_slot_1: 'Numpad1', wisp_slot_2: 'Numpad2' };
    const { api, registered } = createShortcutApi();
    const { logger } = createLogger();

    const enabled = driveRegister(api, logger, bindings, true);
    assert.equal(enabled.registered.filter((e) => e.action.startsWith('wisp_slot_')).length, 2);
    assert.ok(registered.has('Numpad1') && registered.has('Numpad2'));
    assert.ok(registered.has('Control+Shift+O'), 'unrelated trainer shortcuts must be present');

    const disabled = driveRefresh(api, logger, bindings, false);
    assert.equal(disabled.registered.filter((e) => e.action.startsWith('wisp_slot_')).length, 0, 'disabling must remove every Wisp registration');
    assert.ok(!registered.has('Numpad1') && !registered.has('Numpad2'), 'Wisp registrations must actually be gone from the shortcut API');
    assert.ok(registered.has('Control+Shift+O'), 'unrelated trainer shortcuts must remain correct after disabling Wisp');

    const reEnabled = driveRefresh(api, logger, bindings, true);
    assert.equal(reEnabled.registered.filter((e) => e.action === 'wisp_slot_1').length, 1);
    assert.equal(reEnabled.registered.filter((e) => e.action === 'wisp_slot_2').length, 1);
    assert.ok(registered.has('Numpad1') && registered.has('Numpad2'), 'exactly one registration per valid accelerator after re-enabling');
  });
});

describe('Increment 5 closeout, Phase C — remap and refresh', () => {
  afterEach(() => resetTrainerHotkeysForTests());

  test('remap across multiple refresh cycles never accumulates callbacks or leaves the old accelerator registered', () => {
    const { api, registered, calls } = createShortcutApi();
    const { logger } = createLogger();
    let bindings = { toggle_overlay: 'Control+Shift+O', hide_overlay: 'Control+Shift+\\', wisp_slot_1: 'F7' };

    driveRegister(api, logger, bindings, true);
    assert.ok(registered.has('F7'));

    bindings = { ...bindings, wisp_slot_1: 'F8' };
    driveRefresh(api, logger, bindings, true);
    assert.ok(!registered.has('F7'), 'old accelerator must be unregistered after remap');
    assert.ok(registered.has('F8'));

    bindings = { ...bindings, wisp_slot_1: 'F9' };
    driveRefresh(api, logger, bindings, true);
    assert.ok(!registered.has('F8'));
    assert.ok(registered.has('F9'));

    // Repeat the SAME refresh with unchanged bindings multiple times.
    driveRefresh(api, logger, bindings, true);
    driveRefresh(api, logger, bindings, true);
    assert.equal(calls.register.filter((a) => a === 'F9').length, 3, 'each refresh re-registers exactly once — no accumulation');
    assert.equal(calls.unregister.filter((a) => a === 'F9').length, 2, 'F9 is unregistered once per refresh cycle after its own initial registration, never leaked');
  });
});

describe('Increment 5 closeout, Phase C — shutdown', () => {
  afterEach(() => resetTrainerHotkeysForTests());

  test('shutdown unregisters every owned shortcut, is idempotent, and never proposes/confirms/writes/freezes/attaches', () => {
    const bindings = { toggle_overlay: 'Control+Shift+O', hide_overlay: 'Control+Shift+\\', wisp_slot_1: 'Numpad5', wisp_slot_2: 'Numpad6' };
    const { api, registered } = createShortcutApi();
    const { logger } = createLogger();

    driveRegister(api, logger, bindings, true);
    assert.ok(registered.has('Numpad5') && registered.has('Numpad6') && registered.has('Control+Shift+O'));

    const firstShutdown = driveUnregister(api, logger);
    assert.equal(registered.size, 0, 'every owned shortcut must be unregistered on shutdown');
    assert.ok(firstShutdown.includes('Numpad5') && firstShutdown.includes('Numpad6'));

    // Shutdown may execute more than once safely.
    const secondShutdown = driveUnregister(api, logger);
    assert.deepEqual(secondShutdown, [], 'a second shutdown call with nothing owned must be a harmless no-op');

    // No callback remains active: re-registering after shutdown must not
    // find any accelerator already "owned" from before (i.e. shutdown truly
    // cleared internal ownership, not just the fake shortcut API's set).
    const afterShutdownRegister = driveRegister(api, logger, bindings, true);
    assert.equal(afterShutdownRegister.registered.filter((e) => e.action.startsWith('wisp_slot_')).length, 2, 'registration after shutdown must behave identically to a fresh start, proving no stale ownership survived');

    // driveUnregister/driveRegister here only ever call
    // register/unregister/isRegistered on the shortcut API — this test's
    // fake TrainerShortcutApi has no propose/confirm/write/freeze/attach
    // method at all, so calling any such operation during shutdown is
    // structurally impossible, not merely unobserved.
  });
});

describe('Increment 5 closeout, Phase C — real composed three-way conflict', () => {
  afterEach(() => resetTrainerHotkeysForTests());

  test('a real production batch with a three-way collision excludes all three, registers the rest, independent of input order', () => {
    const makeBindings = (order: string[]) => {
      const bindings: Record<string, string> = { toggle_overlay: 'Control+Shift+O', hide_overlay: 'Control+Shift+\\' };
      for (const slot of order) bindings[slot] = 'F10';
      bindings.wisp_slot_4 = 'Numpad4';
      return bindings;
    };

    for (const order of [['wisp_slot_1', 'wisp_slot_2', 'wisp_slot_3'], ['wisp_slot_3', 'wisp_slot_2', 'wisp_slot_1']]) {
      const { api } = createShortcutApi();
      const { logger } = createLogger();
      const result = driveRegister(api, logger, makeBindings(order), true);
      assert.equal(result.registered.filter((e) => e.accelerator === 'F10').length, 0, `three-way collision must fully exclude regardless of order: ${order.join(',')}`);
      assert.equal(result.registered.filter((e) => e.action === 'wisp_slot_4').length, 1, 'the unrelated valid shortcut must still register');
      resetTrainerHotkeysForTests();
    }
  });
});

describe('Increment 5 closeout, Phase C — whitespace accelerators in the real composed plan', () => {
  afterEach(() => resetTrainerHotkeysForTests());

  test('blank/whitespace-only Wisp bindings never reach the shortcut API and are not reported active', () => {
    const bindings = { toggle_overlay: 'Control+Shift+O', hide_overlay: 'Control+Shift+\\', wisp_slot_1: '   ', wisp_slot_2: '', wisp_slot_3: 'Numpad3' };
    const { api, calls, registered } = createShortcutApi();
    const { logger } = createLogger();
    const result = driveRegister(api, logger, bindings, true);
    assert.ok(!calls.register.includes('') && !calls.register.some((a) => a.trim().length === 0), 'no blank accelerator may ever reach the shortcut API');
    assert.equal(result.registered.filter((e) => e.action === 'wisp_slot_3').length, 1);
    assert.ok(registered.has('Numpad3'));
    assert.ok(!result.registered.some((e) => e.action === 'wisp_slot_1' || e.action === 'wisp_slot_2'), 'blank/whitespace bindings must not be reported as active registrations');
  });
});
