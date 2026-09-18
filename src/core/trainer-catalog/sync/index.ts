import { modPackConversionLosses, modPackToSolithDefinition } from '../../definitions/mod-pack-adapter.js';
import { persistTrainerDefinition } from '../../trainer-storage/repository.js';
import { getEnabledSyncSources } from './sources.js';
import {
  remoteTrainerToCatalogEntry,
  remoteTrainerToModPack,
  syncTrainerSource,
} from './remote-sync.js';
import {
  getCatalogEntry,
  logTrainerSync,
  pruneInvalidCommunityCatalogTitles,
  upsertCatalogEntry,
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
      // P4-13 §21: does NOT claim hasModPack:true here. `entry` (from
      // remoteTrainerToCatalogEntry) defaults hasModPack to true, but this
      // is only the identity-review write — persistTrainerDefinition
      // hasn't run yet, so no trainer_mod_packs row exists yet either. A
      // catalog row committed here with hasModPack:true and no matching
      // trainer_mod_packs row would read back with certLevel undefined
      // (getCatalogEntry/searchCatalog's correlated subquery finds
      // nothing) — exactly the hasModPack:true-with-no-certLevel condition
      // requiresCommunityExecutionApproval(undefined)'s fail-open default
      // would silently trust. hasModPack only becomes true on the
      // follow-up upsertCatalogEntry() call below, once persistence has
      // actually succeeded.
      // Best-effort snapshot of this catalog game's pre-sync state, so a failed
      // re-sync below can restore it instead of leaving a previously-working
      // entry downgraded to hasModPack:false (P4-13 review fix). Keyed by the
      // pre-identity-review candidate id — in the common case (no identity
      // merge) this is the same id the write below lands on; the rarer
      // identity-merge case is a pre-existing edge this fix does not attempt
      // to generalize further.
      const existingBefore = getCatalogEntry(entry.catalogGameId);

      const pendingEntry = { ...entry, hasModPack: false, modPackId: undefined, cheatCount: 0 };

      const write = upsertCatalogEntryWithIdentityReview({
        entry: pendingEntry,
        provider: source.id,
        sourceUrl: trainer.sourceUrl,
      });

      if (write.deferred) {
        deferredForIdentityReview += 1;
        continue;
      }

      const writtenCatalogGameId = write.writtenCatalogGameId ?? pack.catalogGameId;
      const packForConversion = { ...pack, catalogGameId: writtenCatalogGameId };
      const definition = modPackToSolithDefinition(packForConversion);
      // P4-13 §20: report the ModPack fields this conversion could not
      // represent (attached to this write's own returned provenance —
      // see SaveTrainerDefinitionInput.conversionWarnings for the
      // durability caveat on this specific call site).
      const conversionWarnings = modPackConversionLosses(packForConversion);
      const persisted = persistTrainerDefinition(definition, {
        sourceProvider: source.id,
        sourceId: trainer.sourceUrl,
        conversionWarnings,
      });
      if (persisted.success === false) {
        errors.push(`${writtenCatalogGameId}: ${persisted.error.message}`);
        // Restore the previously-good capability metadata this sync attempt just
        // cleared — a transient failure on a re-sync must not hide an existing,
        // still-valid trainer_mod_packs row from a prior successful sync.
        if (existingBefore?.hasModPack && existingBefore.catalogGameId === writtenCatalogGameId) {
          upsertCatalogEntry({
            ...entry,
            catalogGameId: writtenCatalogGameId,
            hasModPack: true,
            modPackId: existingBefore.modPackId,
            cheatCount: existingBefore.cheatCount,
          });
        }
        continue;
      }

      // Now that persistTrainerDefinition has actually written a
      // trainer_mod_packs row (with a real cert_level), it is safe to mark
      // this catalog entry as having a mod pack (P4-13 §21).
      upsertCatalogEntry({
        ...entry,
        catalogGameId: writtenCatalogGameId,
        hasModPack: true,
        modPackId: persisted.value.packId,
        cheatCount: pack.cheats.length,
      });
      imported += 1;
    }

    totalImported += imported;
    logTrainerSync(source.id, errors.length ? 'partial' : 'success', errors.join('; ') || 'ok', imported);
    providers.push({ provider: source.id, imported, errors });
  }

  const prunedInvalidTitles = pruneInvalidCommunityCatalogTitles().length;

  return { totalImported, providers, prunedInvalidTitles, deferredForIdentityReview };
}
