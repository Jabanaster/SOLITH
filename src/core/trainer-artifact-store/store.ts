/**
 * ROADMAP §online-foundation Mission 8 — content-addressed trainer artifact store.
 *
 * Follows the artwork-cache store precedent (src/core/artwork-cache/store.ts)
 * for row-mapping conventions: a plain rowToArtifact() mapper, optional
 * fields only present when non-null, no throwing on a normal "not found".
 *
 * Design decision — dedup-by-hash semantics:
 * `registerTrainerArtifact` treats `artifactHash` as the sole identity key.
 * On a fresh hash it INSERTs a new row. On a hash that already exists, it
 * ONLY refreshes `lastReferencedAt` — it never overwrites `trainerId`,
 * `gameId`, `gameBuild`, `kind`, `sizeBytes`, `localPath`, or `rightsClass`
 * on the existing row. This is deliberate: identical bytes are, by
 * definition, the same artifact, and the row already correctly names the
 * context that first registered it. A second trainer/game legitimately
 * referencing the same blob (e.g. a shared engine DLL check reused across
 * two trainers) should not silently reassign the row's recorded trainerId
 * out from under the first registrant — that would make the table lie
 * about who first produced the content. Reassigning the table to support
 * "artifact belongs to many trainers" cleanly would require a many-to-many
 * junction table, which is out of scope for this schema (already fixed by
 * the owner) and not needed for Mission 8/12's requirements.
 *
 * Immutable versioning falls out of this for free: a new gameBuild for the
 * same trainerId produces different bytes, therefore a different SHA-256,
 * therefore a brand-new row — the prior version's row is never touched.
 */
import { createHash } from 'crypto';
import db from '../database/index.js';
import type { RegisterTrainerArtifactInput, TrainerArtifact, TrainerArtifactKind, TrainerArtifactRightsClass } from './types.js';

interface TrainerArtifactRow {
  artifactHash: string;
  trainerId: string;
  gameId: string | null;
  gameBuild: string | null;
  kind: string;
  sizeBytes: number;
  localPath: string | null;
  rightsClass: string;
  firstSeenAt: string;
  lastReferencedAt: string;
}

function rowToArtifact(row: TrainerArtifactRow): TrainerArtifact {
  return {
    artifactHash: row.artifactHash,
    trainerId: row.trainerId,
    kind: row.kind as TrainerArtifactKind,
    sizeBytes: row.sizeBytes,
    rightsClass: row.rightsClass as TrainerArtifactRightsClass,
    firstSeenAt: row.firstSeenAt,
    lastReferencedAt: row.lastReferencedAt,
    ...(row.gameId != null ? { gameId: row.gameId } : {}),
    ...(row.gameBuild != null ? { gameBuild: row.gameBuild } : {}),
    ...(row.localPath != null ? { localPath: row.localPath } : {}),
  };
}

/** Real SHA-256 of the artifact bytes — the content-addressing identity for the whole store. */
export function computeArtifactHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Registers a trainer artifact. Dedups strictly by `artifactHash`:
 * - New hash: inserts a full new row.
 * - Existing hash: updates only `lastReferencedAt` (see file-level doc for why).
 *
 * Never performs an in-place content overwrite of an existing hash row's
 * `localPath`/`sizeBytes`/`trainerId`/`gameBuild` — a changed artifact must
 * arrive under its own (different) hash instead.
 */
export function registerTrainerArtifact(input: RegisterTrainerArtifactInput): TrainerArtifact {
  const existing = getTrainerArtifact(input.artifactHash);
  if (existing) {
    db.prepare(`UPDATE trainer_artifacts SET lastReferencedAt = datetime('now') WHERE artifactHash = ?`).run(input.artifactHash);
    return getTrainerArtifact(input.artifactHash)!;
  }

  db.prepare(
    `INSERT INTO trainer_artifacts (artifactHash, trainerId, gameId, gameBuild, kind, sizeBytes, localPath, rightsClass)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.artifactHash,
    input.trainerId,
    input.gameId ?? null,
    input.gameBuild ?? null,
    input.kind ?? 'native-package',
    input.sizeBytes,
    input.localPath ?? null,
    input.rightsClass ?? 'user-provided',
  );
  return getTrainerArtifact(input.artifactHash)!;
}

export function getTrainerArtifact(artifactHash: string): TrainerArtifact | null {
  const row = db.prepare(`SELECT * FROM trainer_artifacts WHERE artifactHash = ?`).get(artifactHash) as TrainerArtifactRow | undefined;
  return row ? rowToArtifact(row) : null;
}

export function listTrainerArtifactsByTrainer(trainerId: string): TrainerArtifact[] {
  const rows = db.prepare(`SELECT * FROM trainer_artifacts WHERE trainerId = ? ORDER BY firstSeenAt ASC`).all(trainerId) as TrainerArtifactRow[];
  return rows.map(rowToArtifact);
}
