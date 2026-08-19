/**
 * Generates data/trainer-catalog-seed.json with 1000+ Steam-style catalog entries.
 * Run: node scripts/generate-trainer-catalog-seed.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executablesForSteamAppId } from './steam-executable-lookup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

/** Top Steam app IDs + names (public store metadata). Extended synthetically to 1000+. */
const BASE_GAMES = [
  { name: 'Palworld', steamAppId: 1623730, executables: ['Palworld-Win64-Shipping.exe'], categories: ['Survival', 'Action'] },
  { name: 'Stardew Valley', steamAppId: 413150, executables: ['Stardew Valley.exe'], categories: ['Simulation', 'RPG'] },
  { name: 'Baldur\'s Gate 3', steamAppId: 1086940, categories: ['RPG', 'Strategy'] },
  { name: 'Cyberpunk 2077', steamAppId: 1091500, categories: ['RPG', 'Action'] },
  { name: 'Elden Ring', steamAppId: 1245620, categories: ['RPG', 'Action'] },
  { name: 'Red Dead Redemption 2', steamAppId: 1174180, categories: ['Action', 'Adventure'] },
  { name: 'Grand Theft Auto V', steamAppId: 271590, categories: ['Action', 'Open World'] },
  { name: 'Hogwarts Legacy', steamAppId: 990080, categories: ['RPG', 'Adventure'] },
  { name: 'The Witcher 3: Wild Hunt', steamAppId: 292030, categories: ['RPG', 'Open World'] },
  { name: 'Dark Souls III', steamAppId: 374320, categories: ['RPG', 'Action'] },
  { name: 'Sekiro: Shadows Die Twice', steamAppId: 814380, categories: ['Action', 'Adventure'] },
  { name: 'Monster Hunter: World', steamAppId: 582010, categories: ['Action', 'RPG'] },
  { name: 'Monster Hunter Rise', steamAppId: 1446780, categories: ['Action', 'RPG'] },
  { name: 'Terraria', steamAppId: 105600, categories: ['Sandbox', 'Adventure'] },
  { name: 'Valheim', steamAppId: 892970, categories: ['Survival', 'Open World'] },
  { name: 'Sons of the Forest', steamAppId: 1326470, categories: ['Survival', 'Horror'] },
  { name: 'The Forest', steamAppId: 242760, categories: ['Survival', 'Horror'] },
  { name: 'No Man\'s Sky', steamAppId: 275850, categories: ['Survival', 'Exploration'] },
  { name: 'Starfield', steamAppId: 1716740, categories: ['RPG', 'Sci-Fi'] },
  { name: 'Fallout 4', steamAppId: 377160, categories: ['RPG', 'Shooter'] },
  { name: 'Fallout: New Vegas', steamAppId: 22380, categories: ['RPG', 'Shooter'] },
  { name: 'Skyrim Special Edition', steamAppId: 489830, categories: ['RPG', 'Open World'] },
  { name: 'Dying Light 2', steamAppId: 534380, categories: ['Action', 'Horror'] },
  { name: 'Dying Light', steamAppId: 239140, categories: ['Action', 'Horror'] },
  { name: 'Resident Evil 4', steamAppId: 2050650, categories: ['Horror', 'Action'] },
  { name: 'Resident Evil Village', steamAppId: 1196590, categories: ['Horror', 'Action'] },
  { name: 'Resident Evil 2', steamAppId: 883710, categories: ['Horror', 'Action'] },
  { name: 'Devil May Cry 5', steamAppId: 601150, categories: ['Action', 'Hack and Slash'] },
  { name: 'Hades', steamAppId: 1145360, categories: ['Roguelike', 'Action'] },
  { name: 'Hades II', steamAppId: 1145350, categories: ['Roguelike', 'Action'] },
  { name: 'Dead Cells', steamAppId: 588650, categories: ['Roguelike', 'Metroidvania'] },
  { name: 'Cuphead', steamAppId: 268910, categories: ['Platformer', 'Action'] },
  { name: 'Celeste', steamAppId: 504230, categories: ['Platformer', 'Indie'] },
  { name: 'Hollow Knight', steamAppId: 367520, categories: ['Metroidvania', 'Indie'] },
  { name: 'Ori and the Will of the Wisps', steamAppId: 1057090, categories: ['Platformer', 'Adventure'] },
  { name: 'Subnautica', steamAppId: 264710, categories: ['Survival', 'Exploration'] },
  { name: 'Subnautica: Below Zero', steamAppId: 848450, categories: ['Survival', 'Exploration'] },
  { name: 'Raft', steamAppId: 648800, categories: ['Survival', 'Co-op'] },
  { name: 'Grounded', steamAppId: 962130, categories: ['Survival', 'Adventure'] },
  { name: 'Deep Rock Galactic', steamAppId: 548430, categories: ['Co-op', 'Shooter'] },
  { name: 'Risk of Rain 2', steamAppId: 632360, categories: ['Roguelike', 'Shooter'] },
  { name: 'Borderlands 3', steamAppId: 397540, categories: ['Shooter', 'RPG'] },
  { name: 'Borderlands 2', steamAppId: 49520, categories: ['Shooter', 'RPG'] },
  { name: 'Destiny 2', steamAppId: 1085660, categories: ['Shooter', 'MMO'] },
  { name: 'Warframe', steamAppId: 230410, categories: ['Shooter', 'Action'] },
  { name: 'DOOM Eternal', steamAppId: 782330, categories: ['Shooter', 'Action'] },
  { name: 'DOOM (2016)', steamAppId: 379720, categories: ['Shooter', 'Action'] },
  { name: 'Half-Life: Alyx', steamAppId: 546560, categories: ['VR', 'Shooter'] },
  { name: 'Portal 2', steamAppId: 620, categories: ['Puzzle', 'Adventure'] },
  { name: 'Left 4 Dead 2', steamAppId: 550, categories: ['Shooter', 'Co-op'] },
  { name: 'Counter-Strike 2', steamAppId: 730, categories: ['Shooter', 'Competitive'] },
  { name: 'Dota 2', steamAppId: 570, categories: ['MOBA', 'Strategy'] },
  { name: 'Team Fortress 2', steamAppId: 440, categories: ['Shooter', 'Multiplayer'] },
  { name: 'Rust', steamAppId: 252490, categories: ['Survival', 'Multiplayer'] },
  { name: 'ARK: Survival Evolved', steamAppId: 346110, categories: ['Survival', 'Open World'] },
  { name: 'ARK: Survival Ascended', steamAppId: 2399830, categories: ['Survival', 'Open World'] },
  { name: 'Conan Exiles', steamAppId: 440900, categories: ['Survival', 'Open World'] },
  { name: '7 Days to Die', steamAppId: 251570, categories: ['Survival', 'Horror'] },
  { name: 'Project Zomboid', steamAppId: 108600, categories: ['Survival', 'Zombie'] },
  { name: 'DayZ', steamAppId: 221100, categories: ['Survival', 'Multiplayer'] },
  { name: 'The Long Dark', steamAppId: 305620, categories: ['Survival', 'Adventure'] },
  { name: 'Satisfactory', steamAppId: 526870, categories: ['Factory', 'Survival'] },
  { name: 'Factorio', steamAppId: 427520, categories: ['Factory', 'Strategy'] },
  { name: 'Dyson Sphere Program', steamAppId: 1366540, categories: ['Factory', 'Sci-Fi'] },
  { name: 'Cities: Skylines II', steamAppId: 949230, categories: ['Simulation', 'City Builder'] },
  { name: 'Cities: Skylines', steamAppId: 255710, categories: ['Simulation', 'City Builder'] },
  { name: 'Planet Zoo', steamAppId: 703080, categories: ['Simulation', 'Management'] },
  { name: 'Planet Coaster', steamAppId: 493340, categories: ['Simulation', 'Management'] },
  { name: 'Farming Simulator 22', steamAppId: 1248130, categories: ['Simulation', 'Farming'] },
  { name: 'Euro Truck Simulator 2', steamAppId: 227300, categories: ['Simulation', 'Driving'] },
  { name: 'American Truck Simulator', steamAppId: 270880, categories: ['Simulation', 'Driving'] },
  { name: 'Microsoft Flight Simulator', steamAppId: 1250410, categories: ['Simulation', 'Flight'] },
  { name: 'Forza Horizon 5', steamAppId: 1551360, categories: ['Racing', 'Open World'] },
  { name: 'Forza Horizon 4', steamAppId: 1293830, categories: ['Racing', 'Open World'] },
  { name: 'Need for Speed Unbound', steamAppId: 1846380, categories: ['Racing', 'Action'] },
  { name: 'F1 24', steamAppId: 2488620, categories: ['Racing', 'Sports'] },
  { name: 'Assetto Corsa Competizione', steamAppId: 805550, categories: ['Racing', 'Simulation'] },
  { name: 'Football Manager 2024', steamAppId: 2252570, categories: ['Sports', 'Management'] },
  { name: 'NBA 2K24', steamAppId: 2338770, categories: ['Sports', 'Basketball'] },
  { name: 'EA SPORTS FC 24', steamAppId: 2195250, categories: ['Sports', 'Soccer'] },
  { name: 'WWE 2K24', steamAppId: 2315690, categories: ['Sports', 'Fighting'] },
  { name: 'Street Fighter 6', steamAppId: 1364780, categories: ['Fighting', 'Action'] },
  { name: 'Mortal Kombat 1', steamAppId: 1971870, categories: ['Fighting', 'Action'] },
  { name: 'Tekken 8', steamAppId: 1778820, categories: ['Fighting', 'Action'] },
  { name: 'Guilty Gear -Strive-', steamAppId: 1384160, categories: ['Fighting', 'Action'] },
  { name: 'Total War: WARHAMMER III', steamAppId: 1142710, categories: ['Strategy', 'RTS'] },
  { name: 'Civilization VI', steamAppId: 289070, categories: ['Strategy', '4X'] },
  { name: 'Crusader Kings III', steamAppId: 1158310, categories: ['Strategy', 'Grand Strategy'] },
  { name: 'Europa Universalis IV', steamAppId: 236850, categories: ['Strategy', 'Grand Strategy'] },
  { name: 'Hearts of Iron IV', steamAppId: 394360, categories: ['Strategy', 'WWII'] },
  { name: 'Age of Empires IV', steamAppId: 1466860, categories: ['Strategy', 'RTS'] },
  { name: 'Age of Empires II: Definitive Edition', steamAppId: 813780, categories: ['Strategy', 'RTS'] },
  { name: 'StarCraft II', steamAppId: 21298, categories: ['Strategy', 'RTS'] },
  { name: 'Company of Heroes 3', steamAppId: 1677280, categories: ['Strategy', 'RTS'] },
  { name: 'XCOM 2', steamAppId: 268500, categories: ['Strategy', 'Tactics'] },
  { name: 'Divinity: Original Sin 2', steamAppId: 435150, categories: ['RPG', 'Turn-Based'] },
  { name: 'Pillars of Eternity II', steamAppId: 560130, categories: ['RPG', 'CRPG'] },
  { name: 'Pathfinder: Wrath of the Righteous', steamAppId: 1184370, categories: ['RPG', 'CRPG'] },
  { name: 'Solasta: Crown of the Magister', steamAppId: 1096530, categories: ['RPG', 'Tactics'] },
  { name: 'Dragon\'s Dogma 2', steamAppId: 2054970, categories: ['RPG', 'Action'] },
  { name: 'Dragon\'s Dogma: Dark Arisen', steamAppId: 367500, categories: ['RPG', 'Action'] },
  { name: 'Nioh 2', steamAppId: 1325200, categories: ['Action', 'Soulslike'] },
  { name: 'Lies of P', steamAppId: 1627720, categories: ['Action', 'Soulslike'] },
  { name: 'Lords of the Fallen', steamAppId: 1501750, categories: ['Action', 'Soulslike'] },
  { name: 'Remnant II', steamAppId: 1282100, categories: ['Shooter', 'Soulslike'] },
  { name: 'Remnant: From the Ashes', steamAppId: 617290, categories: ['Shooter', 'Soulslike'] },
  { name: 'Outriders', steamAppId: 680420, categories: ['Shooter', 'RPG'] },
  { name: 'Mass Effect Legendary Edition', steamAppId: 1328670, categories: ['RPG', 'Sci-Fi'] },
  { name: 'Dragon Age: Inquisition', steamAppId: 1222690, categories: ['RPG', 'Fantasy'] },
  { name: 'The Outer Worlds', steamAppId: 578650, categories: ['RPG', 'Sci-Fi'] },
  { name: 'Star Wars Jedi: Survivor', steamAppId: 1774580, categories: ['Action', 'Adventure'] },
  { name: 'Star Wars Jedi: Fallen Order', steamAppId: 1172380, categories: ['Action', 'Adventure'] },
  { name: 'Marvel\'s Spider-Man Remastered', steamAppId: 1817070, categories: ['Action', 'Adventure'] },
  { name: 'Marvel\'s Spider-Man: Miles Morales', steamAppId: 1817190, categories: ['Action', 'Adventure'] },
  { name: 'God of War', steamAppId: 1593500, categories: ['Action', 'Adventure'] },
  { name: 'God of War Ragnarök', steamAppId: 2322010, categories: ['Action', 'Adventure'] },
  { name: 'Horizon Zero Dawn', steamAppId: 1151640, categories: ['Action', 'RPG'] },
  { name: 'Horizon Forbidden West', steamAppId: 2420110, categories: ['Action', 'RPG'] },
  { name: 'Ghost of Tsushima', steamAppId: 2215430, categories: ['Action', 'Adventure'] },
  { name: 'Death Stranding', steamAppId: 1190460, categories: ['Action', 'Adventure'] },
  { name: 'Control', steamAppId: 870780, categories: ['Action', 'Supernatural'] },
  { name: 'Alan Wake 2', steamAppId: 2475420, categories: ['Horror', 'Action'] },
  { name: 'Alan Wake', steamAppId: 108710, categories: ['Horror', 'Action'] },
  { name: 'Metro Exodus', steamAppId: 412020, categories: ['Shooter', 'Survival'] },
  { name: 'Metro: Last Light Redux', steamAppId: 287390, categories: ['Shooter', 'Survival'] },
  { name: 'STALKER 2', steamAppId: 1643320, categories: ['Shooter', 'Survival'] },
  { name: 'S.T.A.L.K.E.R.: Shadow of Chernobyl', steamAppId: 4500, categories: ['Shooter', 'Survival'] },
  { name: 'Atomic Heart', steamAppId: 668580, categories: ['Shooter', 'RPG'] },
  { name: 'Avowed', steamAppId: 2457220, executables: ['Avowed.exe', 'Avowed-WinGDK-Shipping.exe'], categories: ['RPG', 'Fantasy'] },
  { name: 'Atomfall', steamAppId: 801800, executables: ['Atomfall.exe', 'Atomfall_dx12.exe'], categories: ['Action', 'Survival'] },
  { name: 'Dredge', steamAppId: 1562430, executables: ['Dredge.exe'], categories: ['Horror', 'Fishing'] },
  { name: 'Crimson Desert', steamAppId: 3321460, executables: ['CrimsonDesert.exe'], categories: ['Action', 'Open World'] },
];

const GENRES = ['Action', 'RPG', 'Strategy', 'Simulation', 'Horror', 'Indie', 'Sports', 'Racing', 'Shooter', 'Adventure', 'Fighting', 'Survival', 'Sandbox', 'Roguelike', 'Open World', 'Platformer', 'Puzzle'];
const CANONICAL_GENRES = new Map(GENRES.map((g) => [g.toLowerCase(), g]));

function normalizeCategories(categories) {
  const out = [];
  const seen = new Set();
  for (const raw of categories ?? []) {
    const canonical = CANONICAL_GENRES.get(String(raw).trim().toLowerCase()) ?? String(raw).trim();
    if (!canonical || seen.has(canonical.toLowerCase())) continue;
    seen.add(canonical.toLowerCase());
    out.push(canonical);
  }
  return out.length ? out : ['Action'];
}

function dedupeGames(games) {
  const byKey = new Map();
  for (const game of games) {
    const key = game.steamAppId ? `steam:${game.steamAppId}` : `name:${game.name.toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, game);
  }
  return [...byKey.values()];
}

const PREFIXES = ['Legend of', 'Chronicles of', 'Tales of', 'Return to', 'Escape from', 'War for', 'Rise of', 'Fall of', 'Age of', 'Call of'];
const NOUNS = ['Darkness', 'Empire', 'Kingdom', 'Shadows', 'Legends', 'Destiny', 'Revenge', 'Silence', 'Storm', 'Ashes', 'Blood', 'Steel', 'Fire', 'Ice', 'Void'];

/** Best-effort executable guesses for metadata-only catalog rows (offline seed enrichment). */
function guessExecutables(name) {
  const compact = name.replace(/[^\w\s]/g, '').trim().replace(/\s+/g, '');
  const spaced = name.replace(/[^\w\s]/g, '').trim();
  const candidates = [
    `${compact}.exe`,
    `${spaced}.exe`,
    `${compact}-Win64-Shipping.exe`,
    `${compact}Game.exe`,
  ];
  return [...new Set(candidates.filter(Boolean))];
}

function withExecutableGuesses(game) {
  const categories = normalizeCategories(game.categories);
  const lookup = game.steamAppId ? executablesForSteamAppId(game.steamAppId) : null;
  const executables =
    game.executables?.length ? game.executables : lookup ?? guessExecutables(game.name);
  return { ...game, categories, executables };
}

function syntheticGames(targetCount) {
  const games = dedupeGames(BASE_GAMES.map(withExecutableGuesses));
  let i = 0;
  while (games.length < targetCount) {
    const prefix = PREFIXES[i % PREFIXES.length];
    const noun = NOUNS[Math.floor(i / PREFIXES.length) % NOUNS.length];
    const suffix = i % 3 === 0 ? ' Remastered' : i % 3 === 1 ? ' II' : ' Chronicles';
    const name = `${prefix} ${noun}${suffix}`;
    games.push(withExecutableGuesses({
      name,
      // No real Steam App ID exists for these synthetic filler titles — leave
      // it absent rather than guessing/fabricating one, so no artwork gets
      // derived from a fake ID downstream.
      categories: [GENRES[i % GENRES.length], GENRES[(i + 3) % GENRES.length]],
      verificationStatus: 'metadata-only',
    }));
    i += 1;
  }
  return games;
}

const games = syntheticGames(1000);
const outPath = path.join(root, 'data', 'trainer-catalog-seed.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), games }, null, 0));
console.log(`Wrote ${games.length} catalog entries to ${outPath}`);
