import type { TrainerCatalogEntry } from '../trainer-catalog/types.js';

/** ROADMAP §5.5 signed-catalog-update record kinds. */
export type CatalogUpdateRecordKind =
  | 'add'
  | 'correct'
  | 'launcher-release-addition'
  | 'eligibility-change'
  | 'trainer-availability'
  | 'artwork-metadata'
  | 'merge-alias'
  | 'blocked-revoked';

export interface CatalogUpdateRecord {
  kind: CatalogUpdateRecordKind;
  catalogGameId: string;
  /**
   * Fields to set on the catalog entry. Undefined fields preserve the
   * existing value — same evidence-only discipline as the rest of
   * trainer-catalog (never a silent overwrite-to-unknown). Required in full
   * (all fields TrainerCatalogEntry needs) for kind='add' on a brand-new
   * catalogGameId — enforced by manifest-schema.ts at the boundary.
   *
   * A record's patch is intentionally the ONLY way artwork URLs/metadata
   * enter through Phase 5 (ROADMAP §5.10): it can set headerUrl/coverUrl/
   * iconUrl (source-URL *references*), but has no field for the Phase 4
   * artwork-rights class — a signed catalog record can never mark itself
   * 'solith-owned' or 'explicitly-licensed'. That classification lives
   * entirely in src/core/artwork-cache, which this module never writes to.
   */
  patch?: Partial<TrainerCatalogEntry>;
  /** kind='merge-alias' only — the canonical catalogGameId this record's catalogGameId becomes an alias of. */
  mergeIntoCatalogGameId?: string;
}

export interface CatalogUpdateManifest {
  /** Monotonic sequence number — the sole replay/downgrade defense (see version-gate.ts). */
  version: number;
  createdAt: string;
  /** ROADMAP §5.5 user-facing notice, e.g. "Catalog updated — 12 games added, 4 records corrected." */
  notice: string;
  records: CatalogUpdateRecord[];
}

export interface SignedCatalogUpdatePackage {
  manifest: CatalogUpdateManifest;
  /** base64 Ed25519 signature over the canonicalized manifest — see signing.ts. */
  signature: string;
}

export type CatalogUpdateApplyStatus = 'applied' | 'rejected' | 'rolled-back';

export interface CatalogUpdateHistoryEntry {
  id: number;
  version: number;
  appliedAt: string;
  recordCount: number;
  notice: string;
  status: CatalogUpdateApplyStatus;
  rejectReason?: string;
}

export interface CatalogUpdateState {
  currentVersion: number;
  lastSuccessAt: string | null;
  lastCheckAt: string | null;
  autoUpdateEnabled: boolean;
  /** ROADMAP §5.6 "bundled snapshot only" — when true, no signed-update fetch/apply may run at all. */
  bundledSnapshotOnly: boolean;
  /** ROADMAP §5.6 separate artwork-network opt-out — distinct from the catalog-update network toggle. */
  artworkNetworkOptOut: boolean;
}

export interface ApplyCatalogUpdateResult {
  status: CatalogUpdateApplyStatus;
  version: number;
  recordCount: number;
  rejectReason?: string;
}
