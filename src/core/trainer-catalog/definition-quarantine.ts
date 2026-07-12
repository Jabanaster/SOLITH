import db from '../database/index.js';
import type { VerificationStatus } from './types.js';
import { getCatalogEntry, upsertCatalogEntry } from './store.js';
import { getDefinitionPayload, upsertDefinitionPayload } from './store.js';
import type { SolithDefinitionV1 } from '../definitions/schema.v1.js';

export interface DefinitionUpdateQueueRow {
  id: number;
  catalogGameId: string;
  reason: string;
  previousVerificationStatus: string | null;
  queuedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

/** Queue a definition for re-verification after executable drift or patch detection. */
export function quarantineDefinition(catalogGameId: string, reason: string): void {
  const entry = getCatalogEntry(catalogGameId);
  const previousStatus = entry?.verificationStatus ?? null;

  db.prepare(
    `INSERT INTO definition_update_queue (catalogGameId, reason, previousVerificationStatus, queuedAt)
     VALUES (?, ?, ?, datetime('now'))`,
  ).run(catalogGameId, reason, previousStatus);

  const definition = getDefinitionPayload(catalogGameId);
  if (definition) {
    downgradeDefinitionVerification(definition, 'community');
  } else if (entry && entry.verificationStatus === 'verified') {
    upsertCatalogEntry({ ...entry, verificationStatus: 'community' });
  }
}

function downgradeDefinitionVerification(definition: SolithDefinitionV1, status: VerificationStatus): void {
  const updated: SolithDefinitionV1 = {
    ...definition,
    safety: { ...definition.safety, verificationStatus: status },
    memoryFeatures: definition.memoryFeatures?.map((f) => ({
      ...f,
      certificationLevel: 'L0',
    })),
  };
  const payloadJson = JSON.stringify(updated);
  upsertDefinitionPayload(
    `${definition.id}-pack`,
    definition.id,
    payloadJson,
    status,
    'drift-quarantine',
    new Date().toISOString(),
  );

  const entry = getCatalogEntry(definition.id);
  if (entry) {
    upsertCatalogEntry({ ...entry, verificationStatus: status });
  }
}

export function listPendingDefinitionUpdates(limit = 50): DefinitionUpdateQueueRow[] {
  return db
    .prepare(
      `SELECT id, catalogGameId, reason, previousVerificationStatus, queuedAt, resolvedAt, resolvedBy
       FROM definition_update_queue WHERE resolvedAt IS NULL ORDER BY queuedAt DESC LIMIT ?`,
    )
    .all(limit) as DefinitionUpdateQueueRow[];
}

export function resolveDefinitionUpdate(id: number, resolvedBy = 'operator'): void {
  db.prepare(
    `UPDATE definition_update_queue SET resolvedAt = datetime('now'), resolvedBy = ? WHERE id = ?`,
  ).run(resolvedBy, id);
}

export function isDefinitionQuarantined(catalogGameId: string): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) as c FROM definition_update_queue
       WHERE catalogGameId = ? AND resolvedAt IS NULL`,
    )
    .get(catalogGameId) as { c: number };
  return row.c > 0;
}
