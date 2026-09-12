/**
 * Mission 2 bridge — one-shot READ ONLY value read for an already-promoted
 * Trainer Deck card. Never writes, never freezes: only ever calls
 * runReadPreflight (which itself only ever calls probe.readValue, never
 * anything write-shaped).
 *
 * CT Library entry -> Add to Trainer Deck -> promoted trainer mapping
 * -> LiveToggleCard -> [this module] -> selected active game session
 * -> read preflight -> resolve address -> one-shot typed read -> result.
 */
import type { LiveMemorySession } from './live-memory-session.js';
import type { LiveToggleCard } from './ct-promote.js';
import { runReadPreflight, type ReadPreflightBlockCode } from './read-preflight.js';
import { createLiveMemorySessionProbe } from './read-preflight-production-adapter.js';
import { promoteCtLibraryEntry, type CtLibraryCheat } from '../ct-library/promote-bridge.js';

/**
 * Pre-read authorization gates (Mission 6/7) — distinct from
 * ReadPreflightBlockCode, which only covers gates INSIDE the actual
 * resolve+read attempt. These fire before a card is even constructed.
 */
export type TrainerDeckAuthorizationBlockCode =
  | 'MALFORMED_REQUEST'
  | 'SESSION_NOT_GAME_BOUND'
  | 'WRONG_GAME_SESSION'
  | 'UNKNOWN_GAME'
  | 'UNKNOWN_ENTRY'
  | 'NOT_PROMOTABLE';

export type TrainerDeckReadState =
  | { status: 'not_attached' }
  | { status: 'value'; value: number; address: string }
  | { status: 'blocked'; code: ReadPreflightBlockCode | TrainerDeckAuthorizationBlockCode; reason: string };

/**
 * Reads one Trainer Deck card's current value against whatever session is
 * currently attached. "Session belongs to the wrong game" and "module
 * missing" collapse to the same BLOCKED(MODULE_NOT_LOADED) outcome by
 * design — from the runtime's perspective those are the same fact (the
 * card's required module isn't present in the attached process), so this
 * does not duplicate that check separately.
 */
export function readTrainerDeckCard(card: LiveToggleCard, session: LiveMemorySession): TrainerDeckReadState {
  if (!session.isAttached()) {
    return { status: 'not_attached' };
  }
  const pid = session.getAttachedPid();
  const executableName = session.getAttachedExecutableName();
  if (pid === null || executableName === null) {
    return { status: 'not_attached' };
  }

  const probe = createLiveMemorySessionProbe(session);
  const result = runReadPreflight(
    {
      moduleName: card.moduleName,
      baseOffset: card.baseOffset,
      pointerChain: card.pointerChain,
      dataType: card.dataType,
    },
    { pid, executableName },
    probe,
  );

  if (result.status === 'READY_FOR_READ') {
    return { status: 'value', value: result.value, address: result.address };
  }
  return { status: 'blocked', code: result.code, reason: result.reason };
}

export interface TrainerDeckLibraryLookup {
  gameId: string;
  sourceSha256: string;
  cheatId: string;
}

/** Format: "<gameId>:<sourceSha256>:<cheatId>" — matches CtLibrarySearchResult.id exactly. */
export function parseLibraryEntryId(id: string): TrainerDeckLibraryLookup | null {
  const parts = id.split(':');
  if (parts.length !== 3) return null;
  const [gameId, sourceSha256, cheatId] = parts;
  if (!gameId || !sourceSha256 || !cheatId) return null;
  return { gameId, sourceSha256, cheatId };
}

export interface TrainerDeckGameDetailLike {
  available: boolean;
  game?: { displayName: string };
  tables: Array<{ tableName: string; archivePath: string; sourceSha256: string; cheats: CtLibraryCheat[] }>;
}

/**
 * The full pre-read authorization chain (Mission 3/6/7), extracted as a pure
 * function so every security gate is directly unit-testable without an
 * Electron/IPC harness. The real IPC handler (electron/live-memory-ipc.ts)
 * is a thin wrapper: sender validation + session lookup + fetching
 * `gameDetail` from disk, then this function decides everything else.
 *
 * Renderer never supplies moduleName/baseOffset/pointerChain/PID — only the
 * opaque `libraryEntryId`. Every other field is re-derived here from trusted
 * `gameDetail` (already loaded from the on-disk CT library shard) and the
 * trusted `session` object, never from caller-supplied data.
 */
export function authorizeTrainerDeckRead(
  libraryEntryId: string,
  sessionCatalogGameId: string | null,
  gameDetail: TrainerDeckGameDetailLike | null,
  session: LiveMemorySession,
): TrainerDeckReadState {
  // Fail closed on no session before touching CT library data at all —
  // cheapest, most defensive check first.
  if (!session.isAttached()) {
    return { status: 'not_attached' };
  }

  const lookup = parseLibraryEntryId(libraryEntryId);
  if (!lookup) {
    return { status: 'blocked', code: 'MALFORMED_REQUEST', reason: 'malformed_library_entry_id' };
  }

  // Session/game binding (Mission 6) — fail closed before touching CT
  // library data at all.
  //
  // P1 fix (Mission 17 hostile review): the naive version of this check only
  // fired when sessionCatalogGameId was already set and disagreed. But the
  // app's actual attach flow (LiveMemoryTrainerPage.tsx's process picker)
  // NEVER sets a catalogGameId — every real attach today leaves it null. A
  // null-skips-the-check design would have made this the ONLY real gate a
  // no-catalog-binding attach could rely on, and the remaining protection
  // (isModuleLoaded inside runReadPreflight) is insufficient on its own:
  // many different games share identically-named modules (e.g. multiple
  // Source-engine titles all ship "server.dll" with different offsets) —
  // attaching to the WRONG game with the SAME module name would have let a
  // read "succeed" and return garbage misrepresented as the target game's
  // value. Fail closed instead: no catalog binding means we cannot verify
  // canonical-game identity at all, so no Trainer Deck card read proceeds.
  if (!sessionCatalogGameId) {
    return { status: 'blocked', code: 'SESSION_NOT_GAME_BOUND', reason: 'session_not_game_bound' };
  }
  if (sessionCatalogGameId !== lookup.gameId) {
    return { status: 'blocked', code: 'WRONG_GAME_SESSION', reason: 'wrong_game_session' };
  }

  if (!gameDetail || !gameDetail.available || !gameDetail.game) {
    return { status: 'blocked', code: 'UNKNOWN_GAME', reason: 'unknown_game' };
  }

  const table = gameDetail.tables.find((t) => t.sourceSha256 === lookup.sourceSha256);
  const cheat = table?.cheats.find((c) => c.id === lookup.cheatId);
  if (!table || !cheat) {
    return { status: 'blocked', code: 'UNKNOWN_ENTRY', reason: 'unknown_library_entry' };
  }

  const attempt = promoteCtLibraryEntry(
    { gameId: lookup.gameId, displayName: gameDetail.game.displayName },
    { tableName: table.tableName, archivePath: table.archivePath, sourceSha256: table.sourceSha256 },
    cheat,
  );
  if (!attempt.eligible) {
    return { status: 'blocked', code: 'NOT_PROMOTABLE', reason: attempt.reason };
  }

  return readTrainerDeckCard(attempt.result.card, session);
}
