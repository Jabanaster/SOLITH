import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cheatsForHotkeySlots, parseCheatHotkeySlot } from '../src/core/cheat-system/cheat-hotkey-slots.js';
import { PALWORLD_CONFIG } from '../src/core/cheat-system/games.js';

test('parseCheatHotkeySlot maps F-keys to zero-based slots', () => {
  assert.equal(parseCheatHotkeySlot('cheat_slot_1'), 0);
  assert.equal(parseCheatHotkeySlot('cheat_slot_12'), 11);
  assert.equal(parseCheatHotkeySlot('toggle_overlay'), null);
});

test('cheatsForHotkeySlots prefers pinned cheats', () => {
  const slots = cheatsForHotkeySlots(PALWORLD_CONFIG);
  assert.equal(slots.length, 3);
  assert.deepEqual(
    slots.map((c) => c.id),
    ['infinite-player-health', 'infinite-stamina', 'instant-capture'],
  );
});
