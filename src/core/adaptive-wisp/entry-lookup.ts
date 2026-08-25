import type { CanonicalGameId, CanonicalTrainerEntryId } from './types.js';
import type { WispBoundEntryDescriptor } from './runtime-types.js';

/**
 * Adaptive Wisp trainer-entry lookup abstraction (Increment 3, Section 7).
 *
 * The runtime binding layer never crawls trainer-catalog/cheat-system
 * structures directly — it depends on this one narrow interface instead, so
 * profile-binder.ts stays pure and unit-testable with fixture lookups. A
 * real adapter (cheat-system-entry-lookup.ts) implements this against the
 * existing GameConfig.cheats[] array; it is intentionally a thin read-only
 * wrapper, not a second trainer registry.
 *
 * Lookup is always scoped by gameId — Section 8/41 require this: two games
 * may each have an entry literally named "health" and must never collide.
 */
export interface WispTrainerEntryLookup {
  resolveEntry(gameId: CanonicalGameId, entryId: CanonicalTrainerEntryId): WispBoundEntryDescriptor | null;
}
