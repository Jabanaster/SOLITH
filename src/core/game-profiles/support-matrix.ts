import fs from 'node:fs';
import path from 'node:path';
import {
  getBundledGameProfileCatalog,
  type GameProfileCatalogEntry,
  type ProfileSupportStatus,
  type ProfileWriteSupportStatus,
} from './catalog.js';
import { reviewGameProfileExchange } from './review.js';

export type SupportMatrixFormat = 'markdown' | 'json';
export type BackupRollbackReadiness = 'verified' | 'not-verified' | 'not-applicable';

export interface SupportMatrixFixtureCoverage {
  totalReferences: number;
  presentReferences: number;
  missingReferences: string[];
}

export interface SupportMatrixRow {
  profileId: string;
  gameName: string;
  supportStatus: ProfileSupportStatus;
  readableFormats: string[];
  executableWriteSupportStatus: ProfileWriteSupportStatus;
  executableWriteSupported: boolean;
  evidenceLevel: string;
  unsupportedReasons: string[];
  fixtureCoverage: SupportMatrixFixtureCoverage;
  backupRollbackReadiness: BackupRollbackReadiness;
}

export interface SupportMatrixReport {
  reportType: 'resourceforge-support-matrix';
  reportVersion: '1.0.0';
  localOnly: true;
  offlineOnly: true;
  singlePlayerOnly: true;
  profileCount: number;
  rows: SupportMatrixRow[];
}

const STATUS_ORDER: Record<ProfileSupportStatus, number> = {
  supported: 0,
  'preview-only': 1,
  'read-only': 2,
  'needs-review': 3,
  blocked: 4,
};

function toRow(entry: GameProfileCatalogEntry): SupportMatrixRow {
  const fixtureCoverage: SupportMatrixFixtureCoverage = {
    totalReferences: entry.fixtureReferences.length,
    presentReferences: 0,
    missingReferences: [],
  };

  for (const fixtureReference of [...entry.fixtureReferences].sort((a, b) => a.localeCompare(b))) {
    const fixturePath = path.resolve(fixtureReference);
    if (fs.existsSync(fixturePath)) {
      fixtureCoverage.presentReferences++;
    } else {
      fixtureCoverage.missingReferences.push(fixtureReference);
    }
  }

  const review = reviewGameProfileExchange(entry, { fixturePath: entry.fixtureReferences[0] });
  const readableFormats = review.importSupported
    ? [...entry.supportedFormats].sort((a, b) => a.localeCompare(b))
    : [];
  const executableWriteSupported = review.exportSupported && entry.writeSupportStatus === 'supported';
  const executableWriteSupportStatus: ProfileWriteSupportStatus = executableWriteSupported
    ? 'supported'
    : entry.writeSupportStatus === 'supported'
      ? 'needs-review'
      : entry.writeSupportStatus;
  const backupRollbackReadiness: BackupRollbackReadiness = executableWriteSupported
    ? (entry.evidenceLevel === 'backup-rollback-verified' ? 'verified' : 'not-verified')
    : 'not-applicable';

  return {
    profileId: entry.catalogId,
    gameName: entry.displayName,
    supportStatus: entry.supportStatus,
    readableFormats,
    executableWriteSupportStatus,
    executableWriteSupported,
    evidenceLevel: entry.evidenceLevel,
    unsupportedReasons: [...entry.unsupportedReasons].sort((a, b) => a.localeCompare(b)),
    fixtureCoverage,
    backupRollbackReadiness,
  };
}

export function createSupportMatrixReport(
  entries: readonly GameProfileCatalogEntry[] = getBundledGameProfileCatalog(),
): SupportMatrixReport {
  const rows = [...entries]
    .sort((a, b) => {
      const byStatus = STATUS_ORDER[a.supportStatus] - STATUS_ORDER[b.supportStatus];
      if (byStatus !== 0) return byStatus;
      const byName = a.displayName.localeCompare(b.displayName);
      if (byName !== 0) return byName;
      return a.catalogId.localeCompare(b.catalogId);
    })
    .map(toRow);

  return {
    reportType: 'resourceforge-support-matrix',
    reportVersion: '1.0.0',
    localOnly: true,
    offlineOnly: true,
    singlePlayerOnly: true,
    profileCount: rows.length,
    rows,
  };
}

export function renderSupportMatrixJson(report: SupportMatrixReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderSupportMatrixMarkdown(report: SupportMatrixReport): string {
  const lines: string[] = [
    '# ResourceForge Support Matrix Report',
    '',
    '- Scope: local-only, offline-only, single-player-only',
    `- Profiles: ${report.profileCount}`,
    '',
    '| Profile ID | Game | Support | Readable Formats | Executable Write | Evidence | Unsupported Reasons | Fixture Coverage | Backup/Rollback |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const row of report.rows) {
    const readableFormats = row.readableFormats.length > 0 ? row.readableFormats.join(', ') : 'none';
    const unsupportedReasons = row.unsupportedReasons.length > 0 ? row.unsupportedReasons.join(', ') : 'none';
    const fixtureCoverage = `${row.fixtureCoverage.presentReferences}/${row.fixtureCoverage.totalReferences}`;
    const executableWrite = row.executableWriteSupported
      ? `${row.executableWriteSupportStatus} (yes)`
      : `${row.executableWriteSupportStatus} (no)`;
    lines.push(
      `| ${row.profileId} | ${row.gameName} | ${row.supportStatus} | ${readableFormats} | ${executableWrite} | ${row.evidenceLevel} | ${unsupportedReasons} | ${fixtureCoverage} | ${row.backupRollbackReadiness} |`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

export function renderSupportMatrix(report: SupportMatrixReport, format: SupportMatrixFormat): string {
  return format === 'json'
    ? renderSupportMatrixJson(report)
    : renderSupportMatrixMarkdown(report);
}
