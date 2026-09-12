/**
 * Discovery Master Pass, Stage 1 — narrow, read-only IPC for the local
 * Discovery catalog (src/core/discovery-catalog/). No generic SQL exposed:
 * every handler is a bounded, purpose-shaped query against the existing
 * `queryDiscoveryCatalog` / `getDiscoveryCatalogEntry` store functions,
 * mirroring the guarded-handle pattern used by electron/trainer-catalog-ipc.ts
 * and electron/personal-library-ipc.ts.
 *
 * This is a LOCAL-ONLY read path — it never makes a network call itself.
 * Populating discovery_catalog_entries (provider sync, backend ingest) is a
 * separate concern; Online Services OFF has no effect on this file's
 * behavior since it only ever reads the local SQLite table (see Discovery
 * Master Pass section 41: the offline snapshot must remain searchable).
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { validateIpcSender } from './sender-validation.js';
import { queryDiscoveryCatalog } from '../src/core/discovery-catalog/query.js';
import { getDiscoveryCatalogEntry } from '../src/core/discovery-catalog/store.js';

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

// Mirrors queryDiscoveryCatalog's own MAX_LIMIT ceiling at the IPC boundary too —
// a compromised/buggy renderer can never request more than the store itself allows.
const SearchSchema = z
  .object({
    text: z.string().max(200).optional(),
    provider: z.string().max(50).optional(),
    providers: z.array(z.string().max(50)).max(20).optional(),
    trainerAvailable: z.boolean().optional(),
    favoriteOrPersonalOnly: z.boolean().optional(),
    releaseYear: z.number().int().min(1970).max(2100).optional(),
    releaseYearMin: z.number().int().min(1970).max(2100).optional(),
    releaseYearMax: z.number().int().min(1970).max(2100).optional(),
    genre: z.string().max(100).optional(),
    sort: z.enum(['title-asc', 'title-desc', 'release-desc', 'release-asc']).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict();

const GetSchema = z.object({ solithGameId: z.string().min(1).max(200) }).strict();

export function registerDiscoveryCatalogIpc(): void {
  guardedHandle('discovery-catalog-search', (_event, payload: unknown) => {
    const parsed = SearchSchema.parse(payload ?? {});
    const entries = queryDiscoveryCatalog(parsed as any);
    return { success: true, entries };
  });

  guardedHandle('discovery-catalog-get', (_event, payload: unknown) => {
    const parsed = GetSchema.parse(payload);
    const entry = getDiscoveryCatalogEntry(parsed.solithGameId);
    if (!entry) return { success: false, error: 'not_found' };
    return { success: true, entry };
  });
}
