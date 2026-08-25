import type { CanonicalGameId } from './types.js';
import type { WispGameIdentityBridge } from './game-identity-bridge.js';
import { getCanonicalGame } from '../canonical-games/store.js';

/**
 * Increment 4B — the real authoritative identity bridge.
 *
 * Audit finding: cheat-system's GameConfig (game-registry.ts) has no field
 * linking it to a canonical game, and no catalog row currently exists for
 * any of its 7 statically-registered games either — there genuinely is no
 * mapping from a CanonicalGameId to that specific namespace today (this
 * matches the prior Increment 4 finding and remains unresolved).
 *
 * However, CanonicalGame already carries an authoritative, already-populated
 * field for a DIFFERENT — and, for real writes, the CORRECT — namespace:
 * `catalogGameId` (canonical-games/types.ts), which bridges to
 * trainer_catalog_games. That is the same catalogGameId that
 * resolveLiveControlFromSchema (src/core/live-memory/dual-read-controls.ts)
 * actually uses to resolve a trainer entry to a real memory address — the
 * cheat-system CheatDefinition catalog has no address data at all, so it can
 * never back a real write regardless of any bridge. Using catalogGameId here
 * is therefore Option A from the Increment 4B spec ("canonical game records
 * already store the exact ... catalog ID — use it directly"): exact lookup
 * by primary key, zero fuzzy/display-name matching, fail-closed when absent.
 */
export function createCatalogGameIdentityBridge(): WispGameIdentityBridge {
  return {
    resolveCheatSystemGameId(canonicalGameId: CanonicalGameId): string | null {
      const game = getCanonicalGame(canonicalGameId);
      if (!game) return null;
      return game.catalogGameId ?? null;
    },
  };
}
