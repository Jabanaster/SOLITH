#!/usr/bin/env node
/**
 * CLI: scan installed games and print JSON summary.
 * Usage: npm run scan:installed-games
 */
import { initDatabase } from '../src/core/database/index.ts';
import { runInstallDiscoveryScan, listInstalledGamesWithCatalog } from '../src/core/install-discovery/index.ts';

await initDatabase();
const result = runInstallDiscoveryScan({ offlineRootsOnly: false });
const installed = listInstalledGamesWithCatalog();

console.log(
  JSON.stringify(
    {
      discovered: result.discovered,
      matched: result.matched,
      platforms: result.platforms,
      scannedAt: result.scannedAt,
      installed,
    },
    null,
    2,
  ),
);
