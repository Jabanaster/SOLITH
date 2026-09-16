/**
 * Real wrapper around groupCatalogEntriesByEdition (edition-signal.ts) over
 * the actual catalog — a callable diagnostic/reconciliation capability
 * (analogous to install-discovery/reconcile-duplicate-executables.ts),
 * intended for a future catalog-maintenance UI/report rather than an
 * automatic mutation of catalog data.
 */
import { getFullCatalogForMatching } from './store.js';
import { groupCatalogEntriesByEdition, type EditionGroup } from './edition-signal.js';

export function findCatalogEditionGroups(): EditionGroup[] {
  const entries = getFullCatalogForMatching().map((entry) => ({
    catalogGameId: entry.catalogGameId,
    displayName: entry.displayName,
  }));
  return groupCatalogEntriesByEdition(entries);
}
