import fs from 'node:fs';
import path from 'node:path';
import type { ModPack, TrainerCatalogEntry } from './types.js';
import { buildSearchableText, slugifyGameId, steamCdnImages, validateModPack } from './types.js';
import { countCatalogEntries, upsertCatalogEntry } from './store.js';

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

export function ensureCatalogSeeded(seedPath: string, minEntries = 1000): number {
  const existing = countCatalogEntries();
  if (existing >= minEntries) return existing;
  if (!fs.existsSync(seedPath)) {
    throw new Error(`Trainer catalog seed not found: ${seedPath}`);
  }
  const records = loadSeedFile(seedPath);
  return importSeedRecords(records);
}

export function resolveSeedPath(projectRoot: string): string {
  return path.join(projectRoot, 'data', 'trainer-catalog-seed.json');
}
