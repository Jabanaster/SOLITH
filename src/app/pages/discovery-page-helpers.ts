/**
 * Pure, CSS-free helpers extracted from DiscoveryPage.tsx for direct
 * unit-testability — mirrors this codebase's established convention (see
 * game-card-status.ts's header) since a component file that imports a CSS
 * module cannot be imported by the plain `tsx --test` runner used here.
 */
import type { GameCardData } from '../components/game-card-status.js';
import type { DiscoveryCatalogEntry } from '../../core/discovery-catalog/types.js';

export const MIN_RELEASE_YEAR = 1970;
export const MAX_RELEASE_YEAR = 2100;

/** Parses a year-input string into a valid year or undefined — never NaN/out-of-range reaches the query. */
export function parseYear(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const year = Number(value);
  if (!Number.isInteger(year) || year < MIN_RELEASE_YEAR || year > MAX_RELEASE_YEAR) return undefined;
  return year;
}

/**
 * Converts a Discovery catalog entry to GameCardData. Deliberately never
 * sets artworkUrl (Discovery Master Pass section 7/20 — no bulk artwork for
 * non-personal games); trainerAvailability caps at 'COMMUNITY' since
 * Discovery's boolean signal cannot evidence SOLITH curation.
 */
export function toGameCardData(entry: DiscoveryCatalogEntry, favorite: boolean): GameCardData {
  return {
    gameId: entry.solithGameId,
    title: entry.title,
    running: false,
    installed: false,
    owned: 'unknown',
    favorite,
    launchers: [],
    trainerAvailability: entry.trainerAvailable ? 'COMMUNITY' : 'NONE',
    trainerAccuracy: entry.trainerAvailable ? 'VERSION_UNKNOWN' : 'NONE',
  };
}
