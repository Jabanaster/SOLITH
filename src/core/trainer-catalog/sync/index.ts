import { modPackToSolithDefinition } from '../../definitions/mod-pack-adapter.js';
import { persistTrainerDefinition } from '../../trainer-storage/repository.js';
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
    const errors: string[] = [...result.errors];

    for (const trainer of result.trainers) {
      const entry = remoteTrainerToCatalogEntry(trainer, source.id);
      // remoteTrainerToModPack() stays the scrape-to-transport-shape step —
      // it is never persisted directly any more (P4-4 §5/§12): the write path
      // now compiles it through the existing ModPack->schema.v1 adapter and
      // the canonical repository, so a community-sync row gets the same
      // validate/transaction/verify-read-back/source-suffixed-packId
      // guarantees every other write source already has, instead of a raw
      // JSON.stringify(ModPack) row that only became canonical lazily on read.
      const pack = remoteTrainerToModPack(trainer, source.id);
      const withPackInfo = { ...entry, hasModPack: true, modPackId: `${entry.catalogGameId}-pack-${source.id}`, cheatCount: pack.cheats.length };

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
      const definition = modPackToSolithDefinition({ ...pack, catalogGameId: writtenCatalogGameId });
      const persisted = persistTrainerDefinition(definition, {
        sourceProvider: source.id,
        sourceId: trainer.sourceUrl,
      });
      if (persisted.success === false) {
        errors.push(`${writtenCatalogGameId}: ${persisted.error.message}`);
        continue;
      }
      imported += 1;
    }

    totalImported += imported;
    logTrainerSync(source.id, errors.length ? 'partial' : 'success', errors.join('; ') || 'ok', imported);
    providers.push({ provider: source.id, imported, errors });
  }

  const prunedInvalidTitles = pruneInvalidCommunityCatalogTitles().length;

  return { totalImported, providers, prunedInvalidTitles, deferredForIdentityReview };
}
