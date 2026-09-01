import db from '../database/index.js';
import { getCatalogUpdateHistoryEntry, getCatalogUpdateState, markCatalogUpdateHistoryRolledBack, updateCatalogUpdateState } from './store.js';
import { upsertCatalogEntry } from '../trainer-catalog/store.js';
import type { TrainerCatalogEntry } from '../trainer-catalog/types.js';

export interface RollbackResult {
  success: boolean;
  restoredCount: number;
  error?: string;
}

/**
 * ROADMAP §5.5 "rollback bad update". Restores every catalog row an already-
 * applied update touched to its exact pre-update state (or deletes it, if
 * the row did not exist before that update), then marks the history entry
 * 'rolled-back'. Only an 'applied' entry may be rolled back — a 'rejected'
 * entry never touched the catalog, and a row already 'rolled-back' is not
 * rolled back twice.
 */
export function rollbackCatalogUpdate(historyId: number): RollbackResult {
  const found = getCatalogUpdateHistoryEntry(historyId);
  if (!found) return { success: false, restoredCount: 0, error: 'no such catalog update history entry' };
  if (found.entry.status !== 'applied') {
    return { success: false, restoredCount: 0, error: `history entry is '${found.entry.status}', not 'applied' — nothing to roll back` };
  }
  const state = getCatalogUpdateState();
  if (found.entry.version !== state.currentVersion) {
    // Rolling back a superseded (non-latest) update out of order would leave
    // currentVersion pointing at a version whose changes were never undone —
    // only the most recently applied update may be rolled back.
    return {
      success: false,
      restoredCount: 0,
      error: `only the most recently applied update (version ${state.currentVersion}) may be rolled back — this entry is version ${found.entry.version}`,
    };
  }

  try {
    db.run('BEGIN TRANSACTION');
    for (const snapshot of found.rollback) {
      if (snapshot.previousEntryJson) {
        const previous = JSON.parse(snapshot.previousEntryJson) as TrainerCatalogEntry;
        upsertCatalogEntry(previous);
      } else {
        db.prepare('DELETE FROM trainer_catalog_games WHERE catalogGameId = ?').run(snapshot.catalogGameId);
      }
    }
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    return { success: false, restoredCount: 0, error: error instanceof Error ? error.message : String(error) };
  }

  markCatalogUpdateHistoryRolledBack(historyId);
  // The catalog is now back at the version this update replaced.
  const priorVersion = Math.max(0, found.entry.version - 1);
  updateCatalogUpdateState({ currentVersion: priorVersion });

  return { success: true, restoredCount: found.rollback.length };
}
