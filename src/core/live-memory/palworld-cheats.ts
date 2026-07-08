import type { LiveValueType } from './types.js';

export interface CheatDefinition {
  id: string;
  name: string;
  description: string;
  category: 'Player' | 'Inventory' | 'Stats' | 'Weapons' | 'Enemies' | 'Game' | 'Physics' | 'Maps' | 'Video' | 'Voice';
  valueType: LiveValueType;
  infiniteValue: number;
  normalValues?: { min: number; max: number };
  requiresDiscovery: boolean; // false = we have a known address pattern, true = user must scan
}

export const PALWORLD_CHEATS: CheatDefinition[] = [
  // Player
  {
    id: 'infinite-player-health',
    name: 'Infinite Player Health',
    description: 'Set your health to maximum and keep it there',
    category: 'Player',
    valueType: 'int32',
    infiniteValue: 9999,
    requiresDiscovery: true,
  },
  {
    id: 'infinite-pal-health',
    name: 'Infinite Pal Health',
    description: 'Active Pal takes no damage',
    category: 'Player',
    valueType: 'int32',
    infiniteValue: 9999,
    requiresDiscovery: true,
  },
  {
    id: 'infinite-stamina',
    name: 'Infinite Stamina',
    description: 'Unlimited sprinting and actions',
    category: 'Player',
    valueType: 'int32',
    infiniteValue: 9999,
    requiresDiscovery: true,
  },
  {
    id: 'infinite-satiety',
    name: 'Infinite Satiety',
    description: 'Never get hungry',
    category: 'Player',
    valueType: 'int32',
    infiniteValue: 100,
    requiresDiscovery: true,
  },
  {
    id: 'temperature-normal',
    name: 'Temperature Always Normal',
    description: 'Never affected by environmental temperature',
    category: 'Player',
    valueType: 'int32',
    infiniteValue: 0,
    requiresDiscovery: true,
  },

  // Inventory
  {
    id: 'no-item-weight',
    name: 'No Item Weight Limit',
    description: 'Carry unlimited weight in inventory',
    category: 'Inventory',
    valueType: 'int32',
    infiniteValue: 0,
    requiresDiscovery: true,
  },

  // Stats
  {
    id: 'infinite-sanity',
    name: 'Infinite Sanity',
    description: 'Sanity never decreases',
    category: 'Stats',
    valueType: 'int32',
    infiniteValue: 100,
    requiresDiscovery: true,
  },

  // Weapons
  {
    id: 'infinite-weapon-durability',
    name: 'Infinite Weapon Durability',
    description: 'Weapons never break or degrade',
    category: 'Weapons',
    valueType: 'int32',
    infiniteValue: 9999,
    requiresDiscovery: true,
  },

  // Game
  {
    id: 'instant-capture',
    name: '100% Capture Chance',
    description: 'Guaranteed capture on thrown ball',
    category: 'Game',
    valueType: 'int32',
    infiniteValue: 100,
    requiresDiscovery: true,
  },
  {
    id: 'all-pals-rare',
    name: 'All Pals Are Rare',
    description: 'Encounter rare Pals at normal spawn rates',
    category: 'Game',
    valueType: 'int32',
    infiniteValue: 1,
    requiresDiscovery: true,
  },
  {
    id: 'instant-work-progress',
    name: 'Instant Work Progress',
    description: 'Palbox and workbench tasks complete instantly',
    category: 'Game',
    valueType: 'int32',
    infiniteValue: 100,
    requiresDiscovery: true,
  },
  {
    id: 'no-crafting-requirements',
    name: 'No Crafting Requirements',
    description: 'Craft without materials',
    category: 'Game',
    valueType: 'int32',
    infiniteValue: 1,
    requiresDiscovery: true,
  },
  {
    id: 'no-building-requirements',
    name: 'No Building Requirements',
    description: 'Build structures without materials',
    category: 'Game',
    valueType: 'int32',
    infiniteValue: 1,
    requiresDiscovery: true,
  },

  // Gold (from your discovery)
  {
    id: 'gold-amount',
    name: 'Gold',
    description: 'Modify current gold amount',
    category: 'Inventory',
    valueType: 'int32',
    infiniteValue: 999999,
    normalValues: { min: 0, max: 999999 },
    requiresDiscovery: false, // You already found stable addresses
  },
];

export function getCheatById(id: string): CheatDefinition | undefined {
  return PALWORLD_CHEATS.find((c) => c.id === id);
}

export function getCheatsByCategory(category: CheatDefinition['category']): CheatDefinition[] {
  return PALWORLD_CHEATS.filter((c) => c.category === category);
}

export function getAllCategories(): CheatDefinition['category'][] {
  const categories = new Set(PALWORLD_CHEATS.map((c) => c.category));
  return Array.from(categories) as CheatDefinition['category'][];
}
