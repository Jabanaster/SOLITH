import db from '../database/index.js';
import { SignedCatalogUpdatePackageSchema } from './manifest-schema.js';
import { verifySignedCatalogUpdate } from './signing.js';
import { isAcceptableUpdateVersion } from './version-gate.js';
import { getCatalogUpdateState, updateCatalogUpdateState, recordCatalogUpdateHistory, type RollbackSnapshotRow } from './store.js';
import { getCatalogEntry, upsertCatalogEntryWithIdentityReview } from '../trainer-catalog/store.js';
import { buildSearchableText } from '../trainer-catalog/types.js';
import type { TrainerCatalogEntry } from '../trainer-catalog/types.js';
import type { ApplyCatalogUpdateResult, CatalogUpdateRecord, SignedCatalogUpdatePackage } from './types.js';

function buildMergedEntry(
  catalogGameId: string,
  existing: TrainerCatalogEntry | null,
  patch: Partial<TrainerCatalogEntry> | undefined,
): TrainerCatalogEntry | null {
  if (!existing && !patch?.displayName) {
    // A brand-new catalogGameId has no prior row to fall back on and no
    // displayName was supplied — refuse rather than inventing a placeholder title.
    return null;
  }
  const base: TrainerCatalogEntry = existing ?? {
    catalogGameId,
    displayName: patch!.displayName!,
    executables: [],
    categories: [],
    verificationStatus: 'community',
    sources: [],
    hasModPack: false,
    cheatCount: 0,
    searchableText: '',
  };
  const merged: TrainerCatalogEntry = { ...base, ...patch, catalogGameId };
  merged.searchableText = buildSearchableText(merged);
  return merged;
}

/**
 * ROADMAP §5.5/§5.8 signed-catalog-update pipeline: validate transport
 * constraints (schema) → validate signature → validate version/sequence →
 * stage every record's merged result and rollback snapshot *before* writing
 * anything → commit atomically → record history. Any failure at any stage
 * returns a 'rejected' result and leaves the current catalog completely
 * unchanged — this function never partially applies a manifest.
 */
export function applySignedCatalogUpdate(pkg: unknown, options: { nowIso?: string } = {}): ApplyCatalogUpdateResult {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const state = getCatalogUpdateState();

  const reject = (reason: string, version = 0, recordCount = 0): ApplyCatalogUpdateResult => {
    recordCatalogUpdateHistory({ version, appliedAt: nowIso, recordCount, notice: '', status: 'rejected', rejectReason: reason });
    return { status: 'rejected', version, recordCount, rejectReason: reason };
  };

  if (state.bundledSnapshotOnly) {
    return reject('bundled-snapshot-only mode is enabled — signed updates are not applied');
  }

  const parsedSchema = SignedCatalogUpdatePackageSchema.safeParse(pkg);
  if (!parsedSchema.success) {
    return reject(`malformed manifest: ${parsedSchema.error.issues[0]?.message ?? 'schema validation failed'}`);
  }
  const signedPkg = parsedSchema.data as SignedCatalogUpdatePackage;
  const { version, records, notice } = signedPkg.manifest;

  if (!verifySignedCatalogUpdate(signedPkg)) {
    return reject('signature verification failed', version, records.length);
  }

  if (!isAcceptableUpdateVersion(version, state.currentVersion)) {
    const reason =
      version === state.currentVersion
        ? 'replayed update rejected — this version was already applied'
        : 'downgrade rejected — version is not newer than the currently applied catalog version';
    return reject(reason, version, records.length);
  }

  // Stage every record before writing anything — one unsupported record
  // fails the whole manifest rather than silently skipping it.
  const rollback: RollbackSnapshotRow[] = [];
  const staged: Array<{ record: CatalogUpdateRecord; mergedEntry: TrainerCatalogEntry }> = [];
  for (const record of records) {
    if (record.kind === 'merge-alias') {
      // Honest scope limit for this pass: full canonical-identity merging
      // (re-pointing every reference to the merged-away id) is a larger
      // change than this pipeline covers yet. Reject rather than silently
      // no-op, per the "no silent unsupported-feature loss" discipline.
      return reject(`record for "${record.catalogGameId}" uses kind='merge-alias', which this apply pipeline does not yet support`, version, records.length);
    }
    const existing = getCatalogEntry(record.catalogGameId);
    rollback.push({ catalogGameId: record.catalogGameId, previousEntryJson: existing ? JSON.stringify(existing) : null });
    const mergedEntry = buildMergedEntry(record.catalogGameId, existing, record.patch);
    if (!mergedEntry) {
      return reject(`record for "${record.catalogGameId}" (kind=${record.kind}) is missing required fields for a new entry`, version, records.length);
    }
    staged.push({ record, mergedEntry });
  }

  try {
    db.run('BEGIN TRANSACTION');
    for (const { record, mergedEntry } of staged) {
      const result = upsertCatalogEntryWithIdentityReview({ entry: mergedEntry, provider: 'solith-signed-catalog' });
      if (result.deferred) {
        // The identity-review gate found a genuine collision candidate (e.g.
        // this record's displayName no longer matches the existing entry's
        // fingerprint) and correctly refused to write directly. A signed
        // manifest must not silently apply everything else while this one
        // record quietly does nothing — reject the whole update instead, so
        // the caller sees an honest failure rather than a false success.
        throw new Error(`record for "${record.catalogGameId}" requires manual identity review (reviewId=${result.reviewId}) — it was not applied`);
      }
    }
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    return reject(`apply failed, no changes committed: ${error instanceof Error ? error.message : String(error)}`, version, records.length);
  }

  updateCatalogUpdateState({ currentVersion: version, lastSuccessAt: nowIso, lastCheckAt: nowIso });
  recordCatalogUpdateHistory({ version, appliedAt: nowIso, recordCount: records.length, notice, status: 'applied', rollback });

  return { status: 'applied', version, recordCount: records.length };
}
