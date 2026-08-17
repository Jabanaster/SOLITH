import { getEnabledSyncSources } from './sources.js';
import {
  remoteTrainerToCatalogEntry,
  remoteTrainerToModPack,
  syncTrainerSource,
} from './remote-sync.js';
import {
  logTrainerSync,
  pruneInvalidCommunityCatalogTitles,
  upsertCatalogEntryWithIdentityReview,
  upsertModPack,
} from '../store.js';

export interface TrainerCatalogSyncReport {
  totalImported: number;
  providers: Array<{ provider: string; imported: number; errors: string[] }>;
  prunedInvalidTitles: number;
  deferredForIdentityReview: number;
}

export async function syncAllTrainerSources(): Promise<TrainerCatalogSyncReport> {
  const providers: TrainerCatalogSyncReport['providers'] = [];
  let totalImported = 0;
  let deferredForIdentityReview = 0;

  for (const source of getEnabledSyncSources()) {
    const result = await syncTrainerSource(source);
    let imported = 0;

    for (const trainer of result.trainers) {
      const entry = remoteTrainerToCatalogEntry(trainer, source.id);
      const pack = remoteTrainerToModPack(trainer, source.id);
      const withPackInfo = { ...entry, hasModPack: true, modPackId: pack.packId, cheatCount: pack.cheats.length };

      const write = upsertCatalogEntryWithIdentityReview({
        entry: withPackInfo,
        provider: source.id,
        sourceUrl: trainer.sourceUrl,
      });

      if (write.deferred) {
        deferredForIdentityReview += 1;
        continue;
      }

      const writtenCatalogGameId = write.writtenCatalogGameId ?? pack.catalogGameId;
      upsertModPack({
        ...pack,
        catalogGameId: writtenCatalogGameId,
        packId: writtenCatalogGameId === entry.catalogGameId ? pack.packId : `${source.id}-${writtenCatalogGameId}`,
      });
      imported += 1;
    }

    totalImported += imported;
    logTrainerSync(source.id, result.errors.length ? 'partial' : 'success', result.errors.join('; ') || 'ok', imported);
    providers.push({ provider: source.id, imported, errors: result.errors });
  }

  const prunedInvalidTitles = pruneInvalidCommunityCatalogTitles().length;

  return { totalImported, providers, prunedInvalidTitles, deferredForIdentityReview };
}
