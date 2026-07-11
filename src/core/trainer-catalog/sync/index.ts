import { getEnabledSyncSources } from './sources.js';
import {
  remoteTrainerToCatalogEntry,
  remoteTrainerToModPack,
  syncTrainerSource,
} from './remote-sync.js';
import { logTrainerSync, upsertCatalogEntry, upsertModPack } from '../store.js';

export interface TrainerCatalogSyncReport {
  totalImported: number;
  providers: Array<{ provider: string; imported: number; errors: string[] }>;
}

export async function syncAllTrainerSources(): Promise<TrainerCatalogSyncReport> {
  const providers: TrainerCatalogSyncReport['providers'] = [];
  let totalImported = 0;

  for (const source of getEnabledSyncSources()) {
    const result = await syncTrainerSource(source);
    let imported = 0;

    for (const trainer of result.trainers) {
      const entry = remoteTrainerToCatalogEntry(trainer, source.id);
      const pack = remoteTrainerToModPack(trainer, source.id);
      upsertCatalogEntry({ ...entry, hasModPack: true, modPackId: pack.packId, cheatCount: pack.cheats.length });
      upsertModPack(pack);
      imported += 1;
    }

    totalImported += imported;
    logTrainerSync(source.id, result.errors.length ? 'partial' : 'success', result.errors.join('; ') || 'ok', imported);
    providers.push({ provider: source.id, imported, errors: result.errors });
  }

  return { totalImported, providers };
}
