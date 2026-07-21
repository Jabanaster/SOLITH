import type { CtZipCatalogEntry, CtZipCatalogIndex } from '../registry/compile-ct-zip.js';

export type CtLibrarySourceKind = 'single-ct' | 'zip-archive' | 'directory';

export interface CtLibrarySource {
  kind: CtLibrarySourceKind;
  path: string;
  sha256?: string;
}

export interface CtLibraryGameSummary {
  gameId: string;
  displayName: string;
  tableCount: number;
  cheatCount: number;
  pointerCount: number;
  scriptCount: number;
  aobSignatureCount: number;
  warningCount: number;
  rejectionCount: number;
  sourceTables: string[];
}

export interface CtLibraryIndex {
  schemaVersion: 1;
  source: CtLibrarySource;
  generatedAt: string;
  safety: {
    executableScripts: false;
    memoryWrites: false;
    processAttach: false;
    certificationLevel: 'L0';
    verificationStatus: 'metadata-only';
  };
  totals: CtZipCatalogIndex['totals'];
  games: CtLibraryGameSummary[];
  tables: CtZipCatalogEntry[];
}

export interface CtLibrarySummaryIndex extends Omit<CtLibraryIndex, 'tables'> {
  shardDirectory?: string;
  shards?: Array<{
    gameId: string;
    displayName: string;
    tableCount: number;
    cheatCount: number;
    path: string;
  }>;
}
