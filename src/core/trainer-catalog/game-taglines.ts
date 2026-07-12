import type { TrainerCatalogEntry } from './types.js';

/** Curated one-line descriptions for real Steam catalog rows (offline, no store API). */
export const CURATED_GAME_TAGLINES: Record<string, string> = {
  palworld: 'Open-world survival crafting with creature companions.',
  'stardew-valley': 'Farming life sim with mines, relationships, and seasons.',
  'baldurs-gate-3': 'Party-based CRPG with tactical turn-based combat.',
  'cyberpunk-2077': 'Open-world RPG in Night City.',
  'elden-ring': 'Open-world action RPG from FromSoftware.',
  'red-dead-redemption-2': 'Western open-world story and exploration.',
  'grand-theft-auto-v': 'Open-world crime action in Los Santos.',
  'hogwarts-legacy': 'Open-world action RPG set at Hogwarts.',
  'the-witcher-3-wild-hunt': 'Open-world fantasy RPG as Geralt of Rivia.',
  avowed: 'First-person fantasy RPG from Obsidian.',
  atomfall: 'Survival action in a nuclear disaster zone.',
  dredge: 'Lovecraftian fishing adventure.',
  'crimson-desert': 'Open-world action adventure.',
  'alan-wake-2': 'Survival horror narrative sequel.',
  'alan-wake': 'Psychological thriller action game.',
  satisfactory: 'First-person factory building on an alien planet.',
  factorio: 'Automation factory sim with logistics and combat.',
  terraria: '2D sandbox adventure with crafting and bosses.',
  valheim: 'Viking survival crafting with procedural worlds.',
  hades: 'Roguelike action through the underworld.',
  'hollow-knight': 'Metroidvania exploration in a fallen kingdom.',
};

export function getCatalogTagline(entry: TrainerCatalogEntry): string {
  const curated = CURATED_GAME_TAGLINES[entry.catalogGameId];
  if (curated) return curated;

  if (entry.steamAppId && entry.steamAppId >= 1_000_000) {
    return `${entry.categories.slice(0, 2).join(' · ')} — catalog metadata`;
  }

  if (entry.categories.length >= 2) {
    return `${entry.categories[0]} · ${entry.categories[1]} single-player title`;
  }

  return entry.categories[0] ?? 'Single-player catalog entry';
}
