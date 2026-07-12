import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TRAINER_HOTKEYS,
  detectHotkeyConflicts,
  getTrainerHotkeyBindings,
  setTrainerHotkeyBindings,
} from '../src/core/cheat-system/trainer-hotkey-bindings.ts';
import { initDatabase } from '../src/core/database/index.ts';

describe('trainer-hotkey-bindings', () => {
  test('defaults include overlay and F1–F12 cheat slots', async () => {
    await initDatabase();
    const bindings = getTrainerHotkeyBindings();
    assert.equal(bindings.toggle_overlay, DEFAULT_TRAINER_HOTKEYS.toggle_overlay);
    assert.equal(bindings.cheat_slot_1, 'F1');
    assert.equal(bindings.cheat_slot_12, 'F12');
  });

  test('setTrainerHotkeyBindings merges and detects conflicts', async () => {
    await initDatabase();
    const merged = setTrainerHotkeyBindings({ cheat_slot_1: 'F5', cheat_slot_2: 'F5' });
    assert.equal(merged.cheat_slot_1, 'F5');
    const conflicts = detectHotkeyConflicts(merged);
    assert.ok(conflicts.some((c) => c.accelerator === 'F5'));
    setTrainerHotkeyBindings(DEFAULT_TRAINER_HOTKEYS);
  });
});
