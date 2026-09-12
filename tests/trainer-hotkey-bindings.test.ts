import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TRAINER_HOTKEYS,
  detectHotkeyConflicts,
  detectOsHotkeyWarnings,
  getTrainerHotkeyBindings,
  setTrainerHotkeyBindings,
} from '../src/core/cheat-system/trainer-hotkey-bindings.ts';
import { initDatabase } from '../src/core/database/index.ts';

describe('trainer-hotkey-bindings', () => {
  test('defaults include overlay and F1–F11 cheat slots plus a non-F12 slot 12', async () => {
    await initDatabase();
    const bindings = getTrainerHotkeyBindings();
    assert.equal(bindings.toggle_overlay, DEFAULT_TRAINER_HOTKEYS.toggle_overlay);
    assert.equal(bindings.cheat_slot_1, 'F1');
    assert.equal(bindings.cheat_slot_11, 'F11');
    assert.equal(bindings.cheat_slot_12, 'CommandOrControl+Shift+F12');
    assert.notEqual(bindings.cheat_slot_12, 'F12');
  });

  test('default binding set has no duplicate accelerators', async () => {
    await initDatabase();
    const bindings = getTrainerHotkeyBindings();
    const conflicts = detectHotkeyConflicts(bindings);
    assert.deepEqual(conflicts, []);
  });

  test('default slot 12 accelerator is not flagged as an OS-reserved warning', () => {
    const warnings = detectOsHotkeyWarnings({ cheat_slot_12: DEFAULT_TRAINER_HOTKEYS.cheat_slot_12 });
    assert.deepEqual(warnings, []);
  });

  test('setTrainerHotkeyBindings merges and detects conflicts', async () => {
    await initDatabase();
    const merged = setTrainerHotkeyBindings({ cheat_slot_1: 'F5', cheat_slot_2: 'F5' });
    assert.equal(merged.cheat_slot_1, 'F5');
    const conflicts = detectHotkeyConflicts(merged);
    assert.ok(conflicts.some((c) => c.accelerator === 'F5'));
    setTrainerHotkeyBindings(DEFAULT_TRAINER_HOTKEYS);
  });

  test('detectOsHotkeyWarnings flags Alt+Tab and Alt+F4', () => {
    const warnings = detectOsHotkeyWarnings({ toggle_overlay: 'Alt+Tab', cheat_slot_1: 'Alt+F4' });
    assert.ok(warnings.length >= 2);
  });

  test('a legacy stored bare-F12 binding self-heals to the working accelerator on read', async () => {
    await initDatabase();
    const merged = setTrainerHotkeyBindings({ cheat_slot_12: 'F12' });
    assert.equal(merged.cheat_slot_12, 'F12');
    const reread = getTrainerHotkeyBindings();
    assert.equal(reread.cheat_slot_12, DEFAULT_TRAINER_HOTKEYS.cheat_slot_12);
    assert.notEqual(reread.cheat_slot_12, 'F12');
    assert.equal(reread.cheat_slot_1, 'F1');
    setTrainerHotkeyBindings(DEFAULT_TRAINER_HOTKEYS);
  });

  test('the self-heal persists so it does not re-trigger on every subsequent read', async () => {
    await initDatabase();
    setTrainerHotkeyBindings({ cheat_slot_12: 'F12' });
    getTrainerHotkeyBindings();
    const secondRead = getTrainerHotkeyBindings();
    assert.equal(secondRead.cheat_slot_12, DEFAULT_TRAINER_HOTKEYS.cheat_slot_12);
    setTrainerHotkeyBindings(DEFAULT_TRAINER_HOTKEYS);
  });

  test('a non-legacy custom cheat_slot_12 override is left untouched', async () => {
    await initDatabase();
    const merged = setTrainerHotkeyBindings({ cheat_slot_12: 'Control+Shift+F12' });
    assert.equal(merged.cheat_slot_12, 'Control+Shift+F12');
    const reread = getTrainerHotkeyBindings();
    assert.equal(reread.cheat_slot_12, 'Control+Shift+F12');
    setTrainerHotkeyBindings(DEFAULT_TRAINER_HOTKEYS);
  });
});
