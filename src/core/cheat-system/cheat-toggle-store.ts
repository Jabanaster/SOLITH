import db from '../database/index.js';

/**
 * Persisted cheat toggle state — survives a ResourceForge restart (not a
 * game restart; see PersistedCheatState.confirmedAddress doc below for why
 * that distinction matters). Main-process only: this module reaches through
 * to src/core/database, which uses Node's fs/path/crypto directly. Never
 * import this from src/app — see useGameCheatSession.ts's module-level
 * comment for why that crashes the sandboxed renderer.
 */
export interface PersistedCheatState {
  gameId: string;
  cheatId: string;
  enabled: boolean;
  /**
   * Last confirmed address for this cheat, if discovery completed. Only
   * valid to reuse on restart if the target game process itself never
   * restarted (same PID, same ASLR layout) — the caller is responsible for
   * verifying the address still reads sanely before trusting it; this store
   * just remembers what to try.
   */
  confirmedAddress: string | null;
  dataType: string | null;
}

export function getPersistedCheatStates(gameId: string): PersistedCheatState[] {
  const rows = db
    .prepare('SELECT gameId, cheatId, enabled, confirmedAddress, dataType FROM cheat_toggle_state WHERE gameId = ?')
    .all(gameId) as Array<{
    gameId: string;
    cheatId: string;
    enabled: number;
    confirmedAddress: string | null;
    dataType: string | null;
  }>;

  return rows.map((row) => ({
    gameId: row.gameId,
    cheatId: row.cheatId,
    enabled: row.enabled === 1,
    confirmedAddress: row.confirmedAddress,
    dataType: row.dataType,
  }));
}

export function setPersistedCheatState(
  gameId: string,
  cheatId: string,
  patch: { enabled: boolean; confirmedAddress?: string | null; dataType?: string | null },
): void {
  db.prepare(
    `INSERT INTO cheat_toggle_state (gameId, cheatId, enabled, confirmedAddress, dataType, updatedAt)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(gameId, cheatId) DO UPDATE SET
       enabled = excluded.enabled,
       confirmedAddress = excluded.confirmedAddress,
       dataType = excluded.dataType,
       updatedAt = excluded.updatedAt`,
  ).run(gameId, cheatId, patch.enabled ? 1 : 0, patch.confirmedAddress ?? null, patch.dataType ?? null);
}

export function clearPersistedCheatState(gameId: string, cheatId: string): void {
  db.prepare('DELETE FROM cheat_toggle_state WHERE gameId = ? AND cheatId = ?').run(gameId, cheatId);
}
