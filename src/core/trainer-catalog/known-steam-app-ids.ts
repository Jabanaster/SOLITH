/**
 * Explicit, hand-verified `catalogGameId` -> Steam AppID associations for
 * community-scraped trainer/catalog listings whose slugified title is known,
 * ahead of time and independently of the scrape itself, to correspond to a
 * specific real Steam listing.
 *
 * This is never derived from fuzzy title matching, substring search, title
 * similarity, or an automated lookup against the Steam store API — only a
 * reviewed, one-entry-per-authorization table, the same evidentiary bar as
 * `STEAM_EXECUTABLE_LOOKUP` (./steam-executable-lookup.ts) and
 * `CATALOG_ORPHAN_RECONCILIATIONS` (../database/index.ts). Adding an entry
 * requires independently confirming the exact AppID (e.g. against a real
 * installed copy's Steam manifest), never guessing one from the title text.
 *
 * Root cause this closes: `remoteTrainerToCatalogEntry`/`remoteTrainerToModPack`
 * (./sync/remote-sync.ts) previously had no way to know a scraped title's real
 * Steam identity, so every community-sourced catalog row was minted with
 * `steamAppId: undefined` (the already-exported `applySteamAppId` helper had
 * no caller at all) and its executable name was always the naive
 * `guessExecutable()` title-compaction — correct only when the real binary
 * name happens to match the display title exactly. For "Crimson Desert
 * Enhanced" (plitch's current listing title for Steam appid 3321460) that
 * guess produced `CrimsonDesertEnhanced.exe`, a filename that does not exist
 * on any real installed copy — the real, unchanged binary is
 * `CrimsonDesert.exe` (see `STEAM_EXECUTABLE_LOOKUP`, appid 3321460).
 */
export const KNOWN_CATALOG_STEAM_APP_IDS: Readonly<Record<string, number>> = {
  // Pearl Abyss's Crimson Desert (Steam appid 3321460). The community catalog
  // scrapes this same real release under two different display names —
  // FLiNG's older "Crimson Desert" and plitch's current "Crimson Desert
  // Enhanced" — but only the current listing title is associated with the
  // verified appid here. Confirmed against a real installed copy
  // (bin64/CrimsonDesert.exe) during Phase 3 real-game validation
  // (Docs/phase3/004-p3-4-real-game-exit-gate-validation.md).
  'crimson-desert-enhanced': 3321460,
};

/**
 * Returns the verified Steam AppID for a catalogGameId, when one has been
 * explicitly authorized above. Returns undefined for every other id — never
 * falls back to a title-similarity guess.
 */
export function knownSteamAppIdForCatalogGameId(catalogGameId: string): number | undefined {
  return KNOWN_CATALOG_STEAM_APP_IDS[catalogGameId];
}
