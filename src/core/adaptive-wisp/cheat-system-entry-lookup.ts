import { getGameConfig } from '../cheat-system/game-registry.js';
import type { GameId } from '../cheat-system/types.js';
import type { CanonicalGameId, CanonicalTrainerEntryId } from './types.js';
import type { WispTrainerEntryLookup } from './entry-lookup.js';
import type { WispBoundEntryDescriptor } from './runtime-types.js';

/**
 * Real WispTrainerEntryLookup adapter over the existing cheat-system catalog
 * (Increment 3, Section 7-8). Read-only — never mutates GameConfig/
 * CheatDefinition, never a second trainer registry.
 *
 * IMPORTANT bridging note: cheat-system's `GameId` and canonical-games'
 * `CanonicalGameId` are two separate identity spaces in the current
 * codebase — there is no existing authoritative mapping between them (see
 * Docs/Architecture/ADAPTIVE_WISP_PLATFORM.md Section on Increment 3
 * limitations). This adapter therefore takes the mapping as an explicit
 * injected function rather than assuming the two ever happen to be equal —
 * getting this wrong would silently defeat the cross-game isolation
 * guarantee (Section 9), so it must never be guessed.
 */
export function createCheatSystemEntryLookup(mapCanonicalGameIdToGameId: (gameId: CanonicalGameId) => GameId | undefined): WispTrainerEntryLookup {
  return {
    resolveEntry(gameId: CanonicalGameId, entryId: CanonicalTrainerEntryId): WispBoundEntryDescriptor | null {
      const catalogGameId = mapCanonicalGameIdToGameId(gameId);
      if (!catalogGameId) return null;

      const config = getGameConfig(catalogGameId);
      if (!config) return null;

      const cheat = config.cheats.find((c) => c.id === entryId);
      if (!cheat) return null;

      return {
        id: cheat.id,
        label: cheat.name,
        dataType: cheat.valueType,
        compatibility: cheat.certificationLevel,
        enabled: true,
      };
    },
  };
}
