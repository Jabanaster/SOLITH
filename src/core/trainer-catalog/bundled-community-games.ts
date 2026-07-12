/**
 * Community-tier bundled catalog games (metadata + scan-first mod packs).
 * Complements the seven fully curated games in cheat-system/games.ts.
 */
import { slugifyGameId } from './types.js';

export interface BundledCommunityGame {
  name: string;
  steamAppId: number;
  executables: string[];
  categories: string[];
  platform?: 'steam' | 'epic' | 'xbox-game-pass' | 'standalone';
}

const CURATED_IDS = new Set([
  'palworld',
  'stardew-valley',
  'avowed',
  'atomfall',
  'dredge',
  'crimson-desert',
  'undisputed',
]);

/** Forty-three additional single-player titles → 50 bundled mod packs with the seven curated games. */
export const BUNDLED_COMMUNITY_GAMES: BundledCommunityGame[] = [
  { name: "Baldur's Gate 3", steamAppId: 1086940, executables: ['bg3.exe', 'bg3_dx11.exe'], categories: ['RPG', 'Strategy'] },
  { name: 'Cyberpunk 2077', steamAppId: 1091500, executables: ['Cyberpunk2077.exe'], categories: ['RPG', 'Action'] },
  { name: 'Elden Ring', steamAppId: 1245620, executables: ['eldenring.exe'], categories: ['RPG', 'Action'] },
  { name: 'Red Dead Redemption 2', steamAppId: 1174180, executables: ['RDR2.exe'], categories: ['Action', 'Open World'] },
  { name: 'Grand Theft Auto V', steamAppId: 271590, executables: ['GTA5.exe'], categories: ['Action', 'Open World'] },
  { name: 'Hogwarts Legacy', steamAppId: 990080, executables: ['HogwartsLegacy.exe'], categories: ['RPG', 'Adventure'] },
  { name: 'The Witcher 3: Wild Hunt', steamAppId: 292030, executables: ['witcher3.exe'], categories: ['RPG', 'Open World'] },
  { name: 'Dark Souls III', steamAppId: 374320, executables: ['DarkSoulsIII.exe'], categories: ['RPG', 'Action'] },
  { name: 'Sekiro: Shadows Die Twice', steamAppId: 814380, executables: ['sekiro.exe'], categories: ['Action', 'Adventure'] },
  { name: 'Monster Hunter: World', steamAppId: 582010, executables: ['MonsterHunterWorld.exe'], categories: ['Action', 'RPG'] },
  { name: 'Terraria', steamAppId: 105600, executables: ['Terraria.exe'], categories: ['Sandbox', 'Adventure'] },
  { name: 'Valheim', steamAppId: 892970, executables: ['valheim.exe'], categories: ['Survival', 'Open World'] },
  { name: 'Sons of the Forest', steamAppId: 1326470, executables: ['SonsOfTheForest.exe'], categories: ['Survival', 'Horror'] },
  { name: 'No Man\'s Sky', steamAppId: 275850, executables: ['NMS.exe'], categories: ['Survival', 'Adventure'] },
  { name: 'Starfield', steamAppId: 1716740, executables: ['Starfield.exe'], categories: ['RPG', 'Adventure'] },
  { name: 'Fallout 4', steamAppId: 377160, executables: ['Fallout4.exe'], categories: ['RPG', 'Shooter'] },
  { name: 'Skyrim Special Edition', steamAppId: 489830, executables: ['SkyrimSE.exe'], categories: ['RPG', 'Open World'] },
  { name: 'Resident Evil 4', steamAppId: 2050650, executables: ['re4.exe'], categories: ['Horror', 'Action'] },
  { name: 'Hades', steamAppId: 1145360, executables: ['Hades.exe'], categories: ['Roguelike', 'Action'] },
  { name: 'Hollow Knight', steamAppId: 367520, executables: ['hollow_knight.exe'], categories: ['Adventure', 'Indie'] },
  { name: 'Subnautica', steamAppId: 264710, executables: ['Subnautica.exe'], categories: ['Survival', 'Adventure'] },
  { name: 'Deep Rock Galactic', steamAppId: 548430, executables: ['FSD-Win64-Shipping.exe'], categories: ['Shooter', 'Action'] },
  { name: 'Risk of Rain 2', steamAppId: 632360, executables: ['Risk of Rain 2.exe'], categories: ['Roguelike', 'Shooter'] },
  { name: 'DOOM Eternal', steamAppId: 782330, executables: ['DOOMEternal.exe'], categories: ['Shooter', 'Action'] },
  { name: 'Project Zomboid', steamAppId: 108600, executables: ['ProjectZomboid64.exe'], categories: ['Survival', 'Horror'] },
  { name: 'Satisfactory', steamAppId: 526870, executables: ['FactoryGame-Win64-Shipping.exe'], categories: ['Simulation', 'Survival'] },
  { name: 'Factorio', steamAppId: 427520, executables: ['factorio.exe'], categories: ['Strategy', 'Simulation'] },
  { name: 'Cities: Skylines II', steamAppId: 949230, executables: ['Cities2.exe'], categories: ['Simulation', 'Strategy'] },
  { name: 'Forza Horizon 5', steamAppId: 1551360, executables: ['ForzaHorizon5.exe'], categories: ['Racing', 'Open World'] },
  { name: 'Street Fighter 6', steamAppId: 1364780, executables: ['StreetFighter6.exe'], categories: ['Fighting', 'Action'] },
  { name: 'Tekken 8', steamAppId: 1778820, executables: ['Polaris-Win64-Shipping.exe'], categories: ['Fighting', 'Action'] },
  { name: 'Civilization VI', steamAppId: 289070, executables: ['CivilizationVI.exe'], categories: ['Strategy', 'Simulation'] },
  { name: 'Crusader Kings III', steamAppId: 1158310, executables: ['ck3.exe'], categories: ['Strategy', 'Simulation'] },
  { name: 'Dragon\'s Dogma 2', steamAppId: 2054970, executables: ['DD2-Win64-Shipping.exe'], categories: ['RPG', 'Action'] },
  { name: 'Lies of P', steamAppId: 1627720, executables: ['LiesOfP-Win64-Shipping.exe'], categories: ['Action', 'RPG'] },
  { name: 'Remnant II', steamAppId: 1282100, executables: ['Remnant2-Win64-Shipping.exe'], categories: ['Shooter', 'Action'] },
  { name: 'God of War', steamAppId: 1593500, executables: ['GoW.exe'], categories: ['Action', 'Adventure'] },
  { name: 'Horizon Zero Dawn', steamAppId: 1151640, executables: ['HorizonZeroDawn.exe'], categories: ['Action', 'RPG'] },
  { name: 'Alan Wake 2', steamAppId: 2475420, executables: ['AlanWake2.exe'], categories: ['Horror', 'Action'] },
  { name: 'Metro Exodus', steamAppId: 412020, executables: ['MetroExodus.exe'], categories: ['Shooter', 'Survival'] },
  { name: 'Atomic Heart', steamAppId: 668580, executables: ['AtomicHeart-Win64-Shipping.exe'], categories: ['Shooter', 'RPG'] },
  { name: 'Mass Effect Legendary Edition', steamAppId: 1328670, executables: ['MassEffectLegendaryEdition.exe'], categories: ['RPG', 'Adventure'] },
  { name: 'The Outer Worlds', steamAppId: 578650, executables: ['Indiana-Win64-Shipping.exe'], categories: ['RPG', 'Adventure'] },
];

export function communityGameId(game: BundledCommunityGame): string {
  return slugifyGameId(game.name);
}

export function isCuratedBundledGameId(id: string): boolean {
  return CURATED_IDS.has(id);
}

export const BUNDLED_COMMUNITY_GAME_COUNT = BUNDLED_COMMUNITY_GAMES.length;
