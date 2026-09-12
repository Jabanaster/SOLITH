import fs from 'node:fs';
import path from 'node:path';
import type { ModPack, TrainerCatalogEntry } from './types.js';
import { buildSearchableText, slugifyGameId, steamCdnImages, validateModPack } from './types.js';
import { backfillMissingCatalogArtwork, countCatalogEntries, upsertCatalogEntry } from './store.js';

export interface SeedGameRecord {
  name: string;
  steamAppId?: number;
  executables?: string[];
  categories?: string[];
  verificationStatus?: TrainerCatalogEntry['verificationStatus'];
}

export function seedRecordToEntry(record: SeedGameRecord): TrainerCatalogEntry {
  const catalogGameId = slugifyGameId(record.name);
  const executables = record.executables?.length
    ? record.executables
    : [`${record.name.replace(/[^a-zA-Z0-9]/g, '')}.exe`];
  const categories = record.categories ?? ['Action'];
  const images = record.steamAppId ? steamCdnImages(record.steamAppId) : {};
  const entry: TrainerCatalogEntry = {
    catalogGameId,
    displayName: record.name,
    steamAppId: record.steamAppId,
    executables,
    categories,
    ...images,
    verificationStatus: record.verificationStatus ?? 'metadata-only',
    sources: [{ provider: 'bundled', url: 'bundled://trainer-catalog-seed' }],
    hasModPack: false,
    cheatCount: 0,
    searchableText: '',
  };
  entry.searchableText = buildSearchableText(entry);
  return entry;
}

export function loadSeedFile(seedPath: string): SeedGameRecord[] {
  const raw = fs.readFileSync(seedPath, 'utf8');
  const parsed = JSON.parse(raw) as { games: SeedGameRecord[] };
  if (!Array.isArray(parsed.games)) {
    throw new Error('Seed file must contain { games: [] }');
  }
  return parsed.games;
}

export function importSeedRecords(records: SeedGameRecord[]): number {
  let imported = 0;
  for (const record of records) {
    upsertCatalogEntry(seedRecordToEntry(record));
    imported += 1;
  }
  return imported;
}

/**
 * Reconcile the curated seed's authoritative Steam artwork onto catalog rows
 * that are missing it. The full seed is only imported when the catalog is under
 * the entry threshold; once remote-sync has populated the catalog past it, the
 * curated seed (the only source of Steam app ids / cover art for popular
 * titles) is otherwise never applied, leaving those rows with the synthetic
 * monogram fallback. This fills ONLY empty artwork — it never re-imports rows,
 * never downgrades verification/cheat/mode data, and is idempotent. Returns the
 * number of rows whose artwork was filled.
 */
export function reconcileSeedArtwork(records: SeedGameRecord[]): number {
  let filled = 0;
  for (const record of records) {
    if (!record.steamAppId || record.steamAppId <= 0) continue;
    const images = steamCdnImages(record.steamAppId);
    const updated = backfillMissingCatalogArtwork(slugifyGameId(record.name), {
      steamAppId: record.steamAppId,
      coverUrl: images.coverUrl,
      headerUrl: images.headerUrl,
      iconUrl: images.iconUrl,
    });
    if (updated) filled += 1;
  }
  return filled;
}

export function ensureCatalogSeeded(seedPath: string, minEntries = 1000): number {
  const existing = countCatalogEntries();
  if (existing >= minEntries) {
    // Catalog already populated (typically by remote-sync). A full re-seed is
    // skipped for perf, but remote-sync rows carry no Steam app ids, so the
    // curated seed's artwork must still be reconciled onto the popular titles
    // it covers — otherwise every installed-game card falls back to a monogram.
    if (fs.existsSync(seedPath)) {
      reconcileSeedArtwork(loadSeedFile(seedPath));
    }
    return existing;
  }
  if (!fs.existsSync(seedPath)) {
    throw new Error(`Trainer catalog seed not found: ${seedPath}`);
  }
  const records = loadSeedFile(seedPath);
  return importSeedRecords(records);
}

export function resolveSeedPath(projectRoot: string): string {
  return path.join(projectRoot, 'data', 'trainer-catalog-seed.json');
}
