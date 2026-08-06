import type { TrainerCatalogEntry } from './types.js';

/** Curated one-line descriptions for real Steam catalog rows (offline, no store API). */
export const CURATED_GAME_TAGLINES: Record<string, string> = {
  palworld: 'Open-world survival crafting with creature companions.',
  'stardew-valley': 'Farming life sim with mines, relationships, and seasons.',
  'baldur-s-gate-3': 'Party-based CRPG with tactical turn-based combat.',
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
  'street-fighter-6': 'Competitive fighting with modern Drive System.',
  'tekken-8': '3D fighting tournament with heat mechanics.',
  'monster-hunter-world': 'Co-op action hunting gigantic monsters.',
  'outer-worlds': 'Sci-fi RPG from Obsidian with sharp dialogue.',
  'god-of-war': 'Action-adventure reimagining of Kratos and Atreus.',
  'horizon-zero-dawn': 'Open-world machine hunting as Aloy.',
  'metro-exodus': 'Post-apocalyptic FPS across changing seasons.',
  'atomic-heart': 'Soviet alt-history shooter RPG.',
  'mass-effect-legendary-edition': 'Remastered trilogy of Commander Shepard\'s saga.',
  'lies-of-p': 'Soulslike Pinocchio action RPG.',
  'remnant-ii': 'Co-op soulslike shooter sequel.',
  'deep-rock-galactic': 'Co-op dwarf mining and bug shooting.',
  'risk-of-rain-2': 'Roguelike third-person shooter escalation.',
  'doom-eternal': 'Fast-paced demon slayer FPS.',
  'civilization-vi': '4X turn-based empire builder.',
  'crusader-kings-iii': 'Grand strategy dynasty simulator.',
  'dragon-s-dogma-2': 'Capcom open-world action RPG.',
  'sons-of-the-forest': 'Survival horror sequel on a cannibal island.',
  'no-man-s-sky': 'Procedural space exploration and base building.',
  'starfield': 'Bethesda space RPG exploration.',
  'fallout-4': 'Post-apocalyptic open-world shooter RPG.',
  'the-elder-scrolls-v-skyrim-special-edition': 'Open-world fantasy RPG remaster.',
  'resident-evil-4': 'Survival horror action remake.',
  'subnautica': 'Underwater survival exploration.',
  'forza-horizon-5': 'Open-world Mexico racing festival.',
  'mortal-kombat-1': 'Fighting with timeline reboot chaos.',
  'guilty-gear-strive': 'Anime fighting with roman cancel system.',
};

/**
 * Curated tagline only — no synthesized fallback. The catalog's supporting
 * metadata line (categories + cheat count) already covers uncurated entries;
 * a synthesized tagline like "Action · Adventure single-player title" just
 * restated that line in different words, so cards for the ~5,900 games
 * without a curated blurb showed the same information twice.
 */
export function getCuratedTagline(entry: TrainerCatalogEntry): string | undefined {
  return CURATED_GAME_TAGLINES[entry.catalogGameId];
}

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
