/**
 * Mission 10 — narrow, purpose-built IPC for Favorites + Support Requests.
 * No generic SQL, no generic filesystem, no generic database mutation:
 * each handler does exactly one thing against the dedicated store module.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { validateIpcSender } from './sender-validation.js';
import { isFavorite, addFavorite, removeFavorite, listFavoriteIds } from '../src/core/favorites/store.js';
import {
  requestSupport,
  getSupportRequestForGame,
  listSupportRequests,
} from '../src/core/support-requests/store.js';
import { getCatalogEntry } from '../src/core/trainer-catalog/store.js';
import { getDiscoveryCatalogEntry } from '../src/core/discovery-catalog/store.js';
import { getCanonicalGame } from '../src/core/canonical-games/store.js';

/**
 * Hostile-review follow-up (Mission 16): a renderer-controlled
 * canonicalGameId reached these stores unverified — low blast radius (no
 * memory/process access, only local favorite/support-request rows), but
 * still lets a compromised renderer write rows for game ids that don't
 * exist in the catalog at all. Support requests for a real but currently
 * UNSUPPORTED game must still succeed (that's the entire point of Mission
 * 6/7) — this only rejects ids absent from the catalog outright.
 *
 * Discovery Master Pass, Stage 1: originally checked ONLY the legacy
 * trainer-catalog table, which meant favoriting a pure Discovery-sourced
 * game (one with a discovery_catalog_entries row but no legacy
 * trainer-catalog row — the normal case for a game the user does not yet
 * have a trainer for) was unconditionally rejected as
 * 'unknown_catalog_game_id', breaking Discovery's favorite flow entirely.
 * A game id is "known" here if it exists in ANY of the three id spaces a
 * canonicalGameId can legitimately come from: the legacy trainer catalog,
 * the Discovery catalog, or canonical_games (covers custom/standalone games
 * created with no store/launcher id at all).
 */
function requireKnownCatalogGameId(canonicalGameId: string): { ok: true } | { ok: false; error: string } {
  const known =
    Boolean(getCatalogEntry(canonicalGameId)) ||
    Boolean(getDiscoveryCatalogEntry(canonicalGameId)) ||
    Boolean(getCanonicalGame(canonicalGameId));
  if (!known) {
    return { ok: false, error: 'unknown_catalog_game_id' };
  }
  return { ok: true };
}

function requireTrustedSender(event: IpcMainInvokeEvent): { ok: true } | { ok: false; reason: string } {
  const result = validateIpcSender(event, ['main']);
  if (!result.ok) return { ok: false, reason: result.reason ?? 'unknown' };
  return { ok: true };
}

function sanitize(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function guardedHandle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any): void {
  ipcMain.handle(channel, async (event, ...args) => {
    const senderCheck = requireTrustedSender(event);
    if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
    try {
      return await listener(event, ...args);
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });
}

// Bounded, purpose-shaped inputs only — no arbitrary key/value, no free-form ids beyond a normal catalog game id string.
const GameIdSchema = z.object({ canonicalGameId: z.string().min(1).max(200) }).strict();
const RequestSupportSchema = z
  .object({
    canonicalGameId: z.string().min(1).max(200),
    gameTitle: z.string().min(1).max(300),
    platforms: z.array(z.string().min(1).max(50)).max(10),
    launcherGameIds: z.record(z.string().max(50), z.string().max(200)).optional(),
    versionHint: z.string().max(200).optional(),
  })
  .strict();

export function registerPersonalLibraryIpc(): void {
  guardedHandle('favorite-game', (_event, payload: unknown) => {
    const parsed = GameIdSchema.parse(payload);
    const known = requireKnownCatalogGameId(parsed.canonicalGameId);
    if (!known.ok) return { success: false, error: known.error };
    addFavorite(parsed.canonicalGameId);
    return { success: true, isFavorite: true };
  });

  guardedHandle('unfavorite-game', (_event, payload: unknown) => {
    const parsed = GameIdSchema.parse(payload);
    removeFavorite(parsed.canonicalGameId);
    return { success: true, isFavorite: false };
  });

  guardedHandle('list-favorites', () => {
    return { success: true, favoriteIds: listFavoriteIds() };
  });

  guardedHandle('is-favorite-game', (_event, payload: unknown) => {
    const parsed = GameIdSchema.parse(payload);
    return { success: true, isFavorite: isFavorite(parsed.canonicalGameId) };
  });

  guardedHandle('request-game-support', (_event, payload: unknown) => {
    const parsed = RequestSupportSchema.parse(payload);
    const known = requireKnownCatalogGameId(parsed.canonicalGameId);
    if (!known.ok) return { success: false, error: known.error };
    const request = requestSupport(parsed);
    return { success: true, request };
  });

  guardedHandle('get-support-request-status', (_event, payload: unknown) => {
    const parsed = GameIdSchema.parse(payload);
    const request = getSupportRequestForGame(parsed.canonicalGameId);
    return { success: true, request };
  });

  guardedHandle('list-support-requests', () => {
    return { success: true, requests: listSupportRequests() };
  });
}
