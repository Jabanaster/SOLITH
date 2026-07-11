import type { CheatDefinition, GameConfig } from './types.js';

/** Up to 12 cheats bound to F1–F12 for the active game session. */
export function cheatsForHotkeySlots(game: GameConfig): CheatDefinition[] {
  if (game.pinnedCheatIds?.length) {
    const pinned = game.pinnedCheatIds
      .map((id) => game.cheats.find((c) => c.id === id))
      .filter((c): c is CheatDefinition => Boolean(c));
    if (pinned.length > 0) return pinned.slice(0, 12);
  }
  return game.cheats.slice(0, 12);
}

export function parseCheatHotkeySlot(action: string): number | null {
  const match = /^cheat_slot_(\d{1,2})$/.exec(action);
  if (!match) return null;
  const slot = Number(match[1]);
  if (!Number.isInteger(slot) || slot < 1 || slot > 12) return null;
  return slot - 1;
}
