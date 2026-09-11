/**
 * ROADMAP §online-foundation Mission 8 — content-addressed trainer artifact model.
 *
 * Mirrors the `trainer_artifacts` table 1:1 (see src/core/database/index.ts
 * applySchema()). `artifactHash` (SHA-256 hex of the artifact bytes) is the
 * primary key and the content-addressing identity: two uploads with identical
 * bytes always resolve to the same row, regardless of filename or which
 * trainerId/gameBuild context registered them first.
 */

/** Kind of blob this artifact row represents. 'native-package' covers the common trainer .exe/.dll bundle case. */
export type TrainerArtifactKind = 'native-package' | 'script-package' | 'shared-dependency';

/**
 * Rights classification, following the artwork-cache precedent
 * (src/core/artwork-cache/types.ts#ArtworkRightsClass): governs provenance
 * trust, not upload mechanics. 'user-provided' is the default for anything
 * a user has supplied directly (e.g. via CT import or manual add).
 */
export type TrainerArtifactRightsClass = 'solith-owned' | 'explicitly-licensed' | 'user-provided' | 'community-submitted' | 'remote-unverified-rights';

export interface TrainerArtifact {
  /** SHA-256 hex digest of the artifact bytes — content-addressing primary key. */
  artifactHash: string;
  /**
   * The trainerId that first registered this artifact. Because the same
   * blob can legitimately back multiple trainer/game contexts (e.g. a
   * shared engine DLL check reused across trainers), this is NOT a foreign
   * key of exclusive ownership — see store.ts registerTrainerArtifact()
   * dedup semantics for the exact rule.
   */
  trainerId: string;
  gameId?: string;
  gameBuild?: string;
  kind: TrainerArtifactKind;
  sizeBytes: number;
  localPath?: string;
  rightsClass: TrainerArtifactRightsClass;
  firstSeenAt: string;
  lastReferencedAt: string;
}

/** Fields required to register a new artifact (or refresh lastReferencedAt on a dedup hit). */
export interface RegisterTrainerArtifactInput {
  artifactHash: string;
  trainerId: string;
  gameId?: string;
  gameBuild?: string;
  kind?: TrainerArtifactKind;
  sizeBytes: number;
  localPath?: string;
  rightsClass?: TrainerArtifactRightsClass;
}
