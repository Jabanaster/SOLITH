import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  getTrainerHotkeyEntries,
  registerTrainerHotkeyEntries,
  resetTrainerHotkeysForTests,
  unregisterTrainerHotkeyEntries,
  type TrainerShortcutApi,
} from '../src/core/cheat-system/trainer-hotkey-registration.ts';
import type { TrainerHotkeyAction } from '../src/core/cheat-system/trainer-hotkey-bindings.ts';

function createShortcutApi(options: { preRegistered?: string[]; reject?: string[] } = {}) {
  const registered = new Set(options.preRegistered ?? []);
  const calls = {
    register: [] as string[],
    unregister: [] as string[],
  };
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
  return {
    logger: {
      info: (message: string) => info.push(message),
      warn: (message: string) => warn.push(message),
    },
    info,
    warn,
  };
}

const noopCallback = (_action: TrainerHotkeyAction) => () => undefined;

describe('trainer hotkey registration', () => {
  afterEach(() => {
    resetTrainerHotkeysForTests();
  });

  test('builds typed entries from centralized bindings', () => {
    const entries = getTrainerHotkeyEntries({
      toggle_overlay: 'Control+Shift+O',
      hide_overlay: 'Control+Shift+\\',
      cheat_slot_1: 'F1',
      cheat_slot_2: '',
    });

    assert.deepEqual(entries.map((entry) => entry.action), ['toggle_overlay', 'hide_overlay', 'cheat_slot_1']);
    assert.equal(entries[0].description, 'toggle trainer overlay');
  });

  test('one shortcut failure does not block remaining registrations', () => {
    const { api, registered } = createShortcutApi({ preRegistered: ['F2'] });
    const { logger, info, warn } = createLogger();

    const result = registerTrainerHotkeyEntries([
      { action: 'cheat_slot_1', accelerator: 'F1', description: 'trigger trainer slot 1' },
      { action: 'cheat_slot_2', accelerator: 'F2', description: 'trigger trainer slot 2' },
      { action: 'cheat_slot_3', accelerator: 'F3', description: 'trigger trainer slot 3' },
    ], api, noopCallback, logger);

    assert.deepEqual(result.registered.map((entry) => entry.accelerator), ['F1', 'F3']);
    assert.deepEqual(result.failed.map((entry) => entry.accelerator), ['F2']);
    assert.equal(registered.has('F1'), true);
    assert.equal(registered.has('F3'), true);
    assert.match(warn[0], /\[trainer-hotkeys\] failed F2 -> trigger trainer slot 2: shortcut already registered/);
    assert.match(info[0], /\[trainer-hotkeys\] registered F1 -> trigger trainer slot 1/);
  });

  test('owned shortcuts are refreshed without unregistering unrelated accelerators', () => {
    const { api, registered, calls } = createShortcutApi({ preRegistered: ['Control+Alt+X'] });
    const { logger } = createLogger();

    registerTrainerHotkeyEntries([
      { action: 'cheat_slot_1', accelerator: 'F1', description: 'trigger trainer slot 1' },
    ], api, noopCallback, logger);
    registerTrainerHotkeyEntries([
      { action: 'cheat_slot_1', accelerator: 'F1', description: 'trigger trainer slot 1' },
      { action: 'cheat_slot_2', accelerator: 'F2', description: 'trigger trainer slot 2' },
    ], api, noopCallback, logger);

    assert.deepEqual(calls.unregister, ['F1']);
    assert.equal(registered.has('Control+Alt+X'), true);
    assert.equal(registered.has('F1'), true);
    assert.equal(registered.has('F2'), true);
  });

  test('shutdown cleanup unregisters only trainer-owned shortcuts', () => {
    const { api, registered, calls } = createShortcutApi({ preRegistered: ['Alt+Space'] });
    const { logger } = createLogger();

    registerTrainerHotkeyEntries([
      { action: 'cheat_slot_1', accelerator: 'F1', description: 'trigger trainer slot 1' },
      { action: 'cheat_slot_2', accelerator: 'F2', description: 'trigger trainer slot 2' },
    ], api, noopCallback, logger);

    const unregistered = unregisterTrainerHotkeyEntries(api, logger);

    assert.deepEqual(unregistered, ['F1', 'F2']);
    assert.deepEqual(calls.unregister, ['F1', 'F2']);
    assert.equal(registered.has('Alt+Space'), true);
  });
});
