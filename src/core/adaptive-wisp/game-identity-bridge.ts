import type { CanonicalGameId } from './types.js';

/**
 * Canonical-game-identity ↔ cheat-system-GameId bridge (Increment 4, Section 3-4).
 *
 * Audit finding: no authoritative mapping between `canonical-games`'
 * `CanonicalGameId` (`canonical:<hash>`) and `cheat-system`'s `GameId`
 * (hand-authored literals like `'palworld'`) exists anywhere in the
 * codebase today — `CanonicalGame.catalogGameId` bridges to
 * `trainer_catalog_games`, a third, unrelated namespace. Per the spec's
 * explicit prohibition, this is NOT solved with display-name matching,
 * fuzzy matching, executable-name substring matching, or an unproven cast
 * — any of those could silently defeat cross-game isolation (Increment 3,
 * Section 9).
 *
 * Instead this is a narrow, explicit, deterministic mapping: exact lookup
 * only, unknown → null, never a fallback/nearest-match. Real population of
 * this mapping (wiring canonical-game registration to record its
 * cheat-system GameId) is a follow-up integration task outside this
 * increment's scope — this module provides the bridge contract and a
 * correct, tested implementation of it; it does not itself decide what the
 * real production mapping data is.
 */
export interface WispGameIdentityBridge {
  resolveCheatSystemGameId(canonicalGameId: CanonicalGameId): string | null;
}

export function createExplicitGameIdentityBridge(mapping: Readonly<Record<string, string>>): WispGameIdentityBridge {
  return {
    resolveCheatSystemGameId(canonicalGameId: CanonicalGameId): string | null {
      return Object.prototype.hasOwnProperty.call(mapping, canonicalGameId) ? mapping[canonicalGameId] : null;
    },
  };
}
