import { getGameConfig } from '../cheat-system/game-registry.js';
import type { CanonicalGameId, CanonicalTrainerEntryId } from './types.js';
import type { WispTrainerEntryLookup } from './entry-lookup.js';
import type { WispGameIdentityBridge } from './game-identity-bridge.js';
import type { WispBoundEntryDescriptor } from './runtime-types.js';

/**
 * Real WispTrainerEntryLookup adapter over the existing cheat-system catalog
 * (Increment 3, Section 7-8; bridge closed in Increment 4, Section 3).
 * Read-only — never mutates GameConfig/CheatDefinition, never a second
 * trainer registry.
 *
 * cheat-system's `GameId` and canonical-games' `CanonicalGameId` are two
 * separate identity spaces — this adapter never assumes they're equal,
 * routing every lookup through the explicit `WispGameIdentityBridge`
 * instead (see game-identity-bridge.ts).
 */
export function createCheatSystemEntryLookup(bridge: WispGameIdentityBridge): WispTrainerEntryLookup {
  return {
    resolveEntry(gameId: CanonicalGameId, entryId: CanonicalTrainerEntryId): WispBoundEntryDescriptor | null {
      const catalogGameId = bridge.resolveCheatSystemGameId(gameId);
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
