/**
 * Public trainer-site metadata (option names + hotkeys only).
 * No binaries, pointer paths, or proprietary trainer code are imported.
 *
 * Sources:
 * - FLiNG Trainer listings (https://flingtrainer.com/)
 * - MrAntiFun forum index (https://mrantifun.net/forums/game-trainers.20/)
 */

export interface TrainerReferenceOption {
  hotkey: string;
  name: string;
}

export interface TrainerReferencePage {
  provider: 'fling' | 'mrantifun';
  url: string;
  optionCount: number;
  versionLabel?: string;
  soloOnly?: boolean;
  lastChecked: string;
  options: TrainerReferenceOption[];
}

export const FLING_TRAINER_PAGES: Record<string, TrainerReferencePage> = {
  palworld: {
    provider: 'fling',
    url: 'https://flingtrainer.com/trainer/palworld-trainer/',
    optionCount: 48,
    versionLabel: 'v1.0+',
    soloOnly: true,
    lastChecked: '2026-07-13',
    options: [
      { hotkey: 'Num 1', name: 'God Mode/Ignore Hits' },
      { hotkey: 'Num 2', name: 'Lock Health' },
      { hotkey: 'Num 3', name: 'Infinite Shield' },
      { hotkey: 'Num 4', name: 'Max Food' },
      { hotkey: 'Num 5', name: 'Infinite Stamina' },
      { hotkey: 'Num 6', name: 'Stealth Mode' },
      { hotkey: 'Num 7', name: 'Perfect Body Temperature' },
      { hotkey: 'Num 8', name: '100% Pal Capture Rate' },
      { hotkey: 'Num 9', name: '100% Rare Pal Spawn Rate' },
      { hotkey: 'Num 0', name: '100% Drop Rate' },
      { hotkey: 'Num .', name: 'Drop Item Multiplier' },
      { hotkey: 'Num *', name: 'Super Damage/One Hit Kills' },
      { hotkey: 'Num +', name: 'Damage Multiplier' },
      { hotkey: 'Num -', name: 'Defense Multiplier' },
      { hotkey: 'Ctrl+Num 1', name: 'Edit Money' },
      { hotkey: 'Ctrl+Num 2', name: 'Edit Items Amount' },
      { hotkey: 'Ctrl+Num 3', name: 'Zero Weight' },
      { hotkey: 'Ctrl+Num 4', name: 'Infinite Equipment Durability' },
      { hotkey: 'Ctrl+Num 5', name: "Food Won't Spoil" },
      { hotkey: 'Ctrl+Num 6', name: 'No Crafting Material Requirements' },
      { hotkey: 'Ctrl+Num 7', name: 'No Building Material Requirements' },
      { hotkey: 'Ctrl+Num 8', name: 'Fast Crafting & Building' },
      { hotkey: 'Ctrl+Num 9', name: 'Freeze Daytime' },
      { hotkey: 'Ctrl+Num 0', name: 'Time Pass Speed' },
      { hotkey: 'Ctrl+Num.', name: 'Set Game Speed' },
      { hotkey: 'Alt+Num 1', name: 'Pal: Lock Health' },
      { hotkey: 'Alt+Num 2', name: 'Pal: Max Food' },
      { hotkey: 'Alt+Num 3', name: 'Pal: Max San' },
      { hotkey: 'Alt+Num 4', name: 'Pal: Infinite Stamina' },
      { hotkey: 'Alt+Num 5', name: 'Pal: Instant Skill Cooldown' },
      { hotkey: 'Alt+Num 6', name: 'Infinite Ammo/No Reload' },
      { hotkey: 'Alt+Num 7', name: 'Instant Weapon Cooldown' },
      { hotkey: 'Alt+Num 8', name: 'Infinite Exp' },
      { hotkey: 'Alt+Num 9', name: 'Exp Multiplier' },
      { hotkey: 'Alt+Num 0', name: 'Edit Stat Points' },
      { hotkey: 'Alt+Num .', name: 'Edit Technology Points' },
      { hotkey: 'Alt+Num +', name: 'Edit Ancient Technology Points' },
      { hotkey: 'Alt+Num -', name: 'Set Player Speed' },
      { hotkey: 'Alt+Num /', name: 'Set AI Speed' },
      { hotkey: 'Alt+Num *', name: 'Set Movement Speed' },
      { hotkey: 'Alt+Insert', name: 'Set Jump Height' },
      { hotkey: 'Alt+Delete', name: 'Infinite Jumps' },
      { hotkey: 'Shift+F1', name: 'Edit Max Health' },
      { hotkey: 'Shift+F2', name: 'Edit Max Shield' },
      { hotkey: 'Shift+F3', name: 'Edit Max Food' },
      { hotkey: 'Shift+F4', name: 'Edit Max Stamina' },
      { hotkey: 'Shift+F5', name: 'Edit Work Speed' },
      { hotkey: 'Shift+F6', name: 'Edit Max Weight' },
    ],
  },
  dredge: {
    provider: 'fling',
    url: 'https://flingtrainer.com/trainer/dredge-trainer/',
    optionCount: 15,
    versionLabel: 'v1.0-v1.5.3+',
    lastChecked: '2026-07-13',
    options: [
      { hotkey: 'Num 1', name: 'God Mode' },
      { hotkey: 'Num 2', name: 'Infinite Money' },
      { hotkey: 'Num 3', name: 'Item Sell Price Multiplier' },
      { hotkey: 'Num 4', name: 'Ignore Equipment Requirements' },
      { hotkey: 'Num 5', name: 'Instant Harvest' },
      { hotkey: 'Num 6', name: "Fish Won't Spoil" },
      { hotkey: 'Num 7', name: "Fish Won't Be Infected" },
      { hotkey: 'Num 8', name: 'Infinite Nets Durability' },
      { hotkey: 'Num 9', name: 'Infinite Pots Durability' },
      { hotkey: 'Num 0', name: 'Infinite Research Parts' },
      { hotkey: 'Num .', name: 'Ignore Upgrade Requirements' },
      { hotkey: 'Ctrl+Num 1', name: 'Set Movement Speed' },
      { hotkey: 'Ctrl+Num 2', name: 'Set Game Speed' },
      { hotkey: 'Ctrl+Num 3', name: 'Freeze Time' },
      { hotkey: 'Ctrl+Num 4', name: 'Time Pass Speed' },
    ],
  },
};

export function getFlingReference(gameId: string): TrainerReferencePage | undefined {
  return FLING_TRAINER_PAGES[gameId];
}
