import db from '../database/index.js';
import { hashFile } from '../profiles/fingerprint.js';
import { verifyDefinitionFingerprint } from '../definitions/fingerprint-verify.js';
import { loadCatalogDefinition } from '../definitions/load-catalog-definition.js';
import { getCatalogEntry } from '../trainer-catalog/store.js';
import { isDefinitionQuarantined } from '../trainer-catalog/definition-quarantine.js';
import { listInstalledGames } from '../install-discovery/store.js';
import { validateSolithDefinitionV1 } from '../definitions/schema.v1.js';

export type TrainerHealthStatus =
  | 'working'
  | 'stale'
  | 'unknown'
  | 'metadata_only'
  | 'quarantined';

export interface TrainerHealthRecord {
  catalogGameId: string;
  status: TrainerHealthStatus;
  staleReason?: string;
  executableHash?: string;
  checkedAt: string;
}

export interface OfflineCertifyResult {
  success: boolean;
  schemaValid: boolean;
  resolutionOk: boolean;
  backupPathOk: boolean;
  errors: string[];
}

function installedExecutableForCatalog(catalogGameId: string): string | undefined {
  const row = listInstalledGames().find((g) => g.catalogGameId === catalogGameId);
  return row?.executablePath;
}

export function computeTrainerHealth(catalogGameId: string): TrainerHealthRecord {
  const checkedAt = new Date().toISOString();
  const entry = getCatalogEntry(catalogGameId);
  const definition = loadCatalogDefinition(catalogGameId);

  if (!entry?.hasModPack && !definition) {
    return { catalogGameId, status: 'metadata_only', checkedAt };
  }

  if (isDefinitionQuarantined(catalogGameId)) {
    return {
      catalogGameId,
      status: 'quarantined',
      staleReason: 'quarantined',
      checkedAt,
    };
  }

  if (!definition) {
    return { catalogGameId, status: 'unknown', staleReason: 'no_definition', checkedAt };
  }

  const exePath = installedExecutableForCatalog(catalogGameId);
  const prefixes = definition.executableHashPrefixes ?? [];

  if (!exePath) {
    return {
      catalogGameId,
      status: prefixes.length > 0 ? 'unknown' : 'working',
      staleReason: prefixes.length > 0 ? 'no_installed_executable' : undefined,
      checkedAt,
    };
  }

  const executableHash = hashFile(exePath);
  const verify = verifyDefinitionFingerprint({
    executableHashSHA256: executableHash,
    executableHashPrefixes: prefixes,
    targetSHA256: definition.targetSHA256,
  });

  if (verify.status === 'mismatch') {
    return {
      catalogGameId,
      status: 'stale',
      staleReason: 'executable_mismatch',
      executableHash,
      checkedAt,
    };
  }

  return {
    catalogGameId,
    status: 'working',
    executableHash,
    checkedAt,
  };
}

export function upsertTrainerHealth(record: TrainerHealthRecord): void {
  db.prepare(
    `INSERT INTO trainer_health (
      catalog_game_id, status, stale_reason, executable_hash, checked_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(catalog_game_id) DO UPDATE SET
      status = excluded.status,
      stale_reason = excluded.stale_reason,
      executable_hash = excluded.executable_hash,
      checked_at = excluded.checked_at`,
  ).run(
    record.catalogGameId,
    record.status,
    record.staleReason ?? null,
    record.executableHash ?? null,
    record.checkedAt,
  );
}

export function runTrainerHealthCheck(catalogGameId?: string): TrainerHealthRecord[] {
  if (catalogGameId) {
    const record = computeTrainerHealth(catalogGameId);
    upsertTrainerHealth(record);
    return [record];
  }

  const installed = listInstalledGames();
  const ids = new Set<string>();
  for (const row of installed) {
    if (row.catalogGameId) ids.add(row.catalogGameId);
  }

  const records: TrainerHealthRecord[] = [];
  for (const id of ids) {
    const record = computeTrainerHealth(id);
    upsertTrainerHealth(record);
    records.push(record);
  }
  return records;
}

export function listTrainerHealthRecords(): TrainerHealthRecord[] {
  const rows = db.prepare(
    `SELECT catalog_game_id AS catalogGameId, status, stale_reason AS staleReason,
            executable_hash AS executableHash, checked_at AS checkedAt
     FROM trainer_health`,
  ).all() as TrainerHealthRecord[];
  return rows;
}

export function getTrainerHealthMap(): Record<string, TrainerHealthRecord> {
  const map: Record<string, TrainerHealthRecord> = {};
  for (const row of listTrainerHealthRecords()) {
    map[row.catalogGameId] = row;
  }
  return map;
}

export function runOfflineCertify(catalogGameId: string): OfflineCertifyResult {
  const definition = loadCatalogDefinition(catalogGameId);
  if (!definition) {
    return {
      success: false,
      schemaValid: false,
      resolutionOk: false,
      backupPathOk: false,
      errors: ['no_definition'],
    };
  }

  const schemaErrors = validateSolithDefinitionV1(definition);
  const schemaValid = schemaErrors.length === 0;

  const features = definition.memoryFeatures ?? [];
  const resolutionOk =
    features.length === 0 ||
    features.every((f) => {
      const r = f.resolution ?? {};
      if (f.type === 'scan_unknown' || f.type === 'scan_first') return true;
      return (
        Boolean(r.moduleName) &&
        (Boolean(r.baseOffset) || Boolean(r.signature) || (r.pointerChain?.length ?? 0) > 0)
      );
    });

  const dir = definition.saveEditor?.defaultDirectory ?? '';
  const backupPathOk = !definition.saveEditor || (Boolean(dir) && !dir.includes('..'));

  const errors: string[] = [];
  if (!schemaValid) errors.push(...schemaErrors);
  if (!resolutionOk) errors.push('resolution_incomplete');
  if (!backupPathOk) errors.push('backup_path_invalid');

  return {
    success: schemaValid && resolutionOk && backupPathOk,
    schemaValid,
    resolutionOk,
    backupPathOk,
    errors,
  };
}
