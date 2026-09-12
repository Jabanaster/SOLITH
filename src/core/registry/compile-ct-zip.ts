import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import yauzl from 'yauzl';
import { parseCheatTableXml } from '../definitions/ct-import.js';
import { extractAOBsFromCatalog } from '../script-research/aob-parser.js';
import { extractCheatTableRawScriptCatalog } from '../script-research/ct-script-research.js';
import { extractVersionHint } from './version-hint.js';
import {
  DEFAULT_MAX_CT_BYTES,
  compileSolithCtRegistryFromXml,
} from './compile-ct-registry.js';

export interface CtZipCatalogEntry {
  archivePath: string;
  game: string;
  tableName: string;
  sourceSha256: string;
  sourceBytes: number;
  /**
   * Mission 17 — optional, non-authoritative hint pulled from the table's
   * filename/path (a version number, date, or platform tag) when visibly
   * present. Never claims compatibility and never affects resolver
   * eligibility; purely for display/provenance. Absent when nothing
   * recognizable was found — that is the common case, not an error.
   */
  versionHint?: { kind: 'explicit_version' | 'date' | 'platform_only'; hint: string };
  counts: {
    pointers: number;
    scripts: number;
    aobSignatures: number;
    rejections: number;
    warnings: number;
    duplicates: number;
  };
  rejectedEntries?: Array<{
    name: string;
    reason: string;
    rejection_reason?: string;
  }>;
  cheats: Array<{
    id: string;
    name: string;
    kind: 'pointer' | 'script' | 'aob';
    executable: false;
    certificationLevel: 'L0';
    metadata?: {
      dataType?: string;
      moduleName?: string;
      rawAddress?: string;
      baseOffset?: string;
      pointerChain?: number[];
      liveResolution?: string;
      showAsHex?: boolean;
      scriptType?: string;
      scriptExcerpt?: string;
      symbol?: string;
      scanType?: string;
      pattern?: string;
      sourceEntry?: string;
      lineNumber?: number;
      warnings?: string[];
      completeness?: string;
    };
  }>;
}

export interface CtZipRejectedEntry {
  archivePath: string;
  reason: string;
}

export interface CtZipCatalogIndex {
  schemaVersion: 1;
  sourceArchive: {
    path: string;
    filename: string;
    sha256: string;
  };
  generatedAt: string;
  totals: {
    ctFiles: number;
    compiledTables: number;
    rejectedTables: number;
    pointers: number;
    scripts: number;
    aobSignatures: number;
    cheats: number;
  };
  tables: CtZipCatalogEntry[];
  rejected: CtZipRejectedEntry[];
}

export interface CompileCtZipOptions {
  outputJsonPath?: string;
  outputRegistriesDir?: string;
  compiledAt?: string;
  maxCtBytes?: number;
  maxArchiveBytes?: number;
  limit?: number;
  signal?: AbortSignal;
  onProgress?: (progress: CtZipImportProgress) => void;
  tempRoot?: string;
  cleanupTempOnAbort?: boolean;
}

const DEFAULT_MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;

export type CtZipImportPhase =
  | 'hashing-source'
  | 'extracting-archive'
  | 'parsing-xml'
  | 'scraping-signatures'
  | 'writing-output'
  | 'complete'
  | 'cancelled'
  | 'failed';

export interface CtZipImportProgress {
  phase: CtZipImportPhase;
  label: string;
  archivePath?: string;
  processedTables: number;
  totalTables?: number;
}

export class CtZipImportAbortError extends Error {
  readonly code = 'ABORT_ERR';

  constructor(message = 'CT import cancelled by user.') {
    super(message);
    this.name = 'CtZipImportAbortError';
  }
}

function slugId(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function titleFromArchivePath(archivePath: string): string {
  const base = path.basename(archivePath, path.extname(archivePath)).replace(/[_-]+/g, ' ').trim();
  return base || 'Imported Cheat Table';
}

function gameFromArchivePath(archivePath: string): string {
  const normalized = archivePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const fileTitle = titleFromArchivePath(archivePath);
  if (parts.length <= 2) return fileTitle;
  const parent = parts[parts.length - 2]?.replace(/[_-]+/g, ' ').trim();
  if (!parent || /^(ct-files|cheat-tables-master|ce-examples-master)$/i.test(parent)) return fileTitle;
  return parent;
}

export function validateZipEntryPath(entryName: string): string | null {
  const normalized = entryName.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    return 'absolute zip entry paths are rejected';
  }
  if (normalized.split('/').some((part) => part === '..')) {
    return 'zip entry path traversal is rejected';
  }
  if (normalized.includes('\0')) {
    return 'zip entry contains NUL byte';
  }
  return null;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CtZipImportAbortError();
  }
}

function emitProgress(options: CompileCtZipOptions, progress: CtZipImportProgress): void {
  options.onProgress?.(progress);
}

async function createTempSandbox(options: CompileCtZipOptions): Promise<string> {
  const tempRoot = options.tempRoot ? path.resolve(options.tempRoot) : os.tmpdir();
  await fs.mkdir(tempRoot, { recursive: true });
  return fs.mkdtemp(path.join(tempRoot, 'solith-ct-import-'));
}

async function cleanupTempSandbox(tempSandboxPath: string | null): Promise<void> {
  if (!tempSandboxPath) return;
  await fs.rm(tempSandboxPath, { recursive: true, force: true });
}

function streamToString(stream: NodeJS.ReadableStream, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      if ('destroy' in stream && typeof stream.destroy === 'function') {
        stream.destroy(new CtZipImportAbortError());
      }
      rejectOnce(new CtZipImportAbortError());
    };

    if (signal?.aborted) {
      rejectOnce(new CtZipImportAbortError());
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    stream.on('data', (chunk) => {
      if (signal?.aborted) {
        onAbort();
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('error', rejectOnce);
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) reject(error ?? new Error('Failed to open zip archive.'));
      else resolve(zipFile);
    });
  });
}

function openReadStream(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error(`Failed to read ${entry.fileName}.`));
      else resolve(stream);
    });
  });
}

async function tableEntryFromXml(
  archivePath: string,
  xmlText: string,
  options: CompileCtZipOptions = {},
  processedTables = 0,
): Promise<CtZipCatalogEntry> {
  const game = gameFromArchivePath(archivePath);
  const tableName = titleFromArchivePath(archivePath);
  const sourceSha256 = crypto.createHash('sha256').update(xmlText, 'utf8').digest('hex');
  throwIfAborted(options.signal);
  emitProgress(options, {
    phase: 'parsing-xml',
    label: 'Parsing XML...',
    archivePath,
    processedTables,
  });
  const pointers = await parseCheatTableXml(xmlText, { title: tableName });
  throwIfAborted(options.signal);
  const scripts = await extractCheatTableRawScriptCatalog(xmlText, {
    title: tableName,
    sourceNote: 'Raw Cheat Engine script text extracted as inert Solith metadata. Scripts are never executed.',
  });
  throwIfAborted(options.signal);
  emitProgress(options, {
    phase: 'scraping-signatures',
    label: 'Scraping Signatures...',
    archivePath,
    processedTables,
  });
  const aobReport = extractAOBsFromCatalog(scripts);
  const pointerCheats = pointers.accepted.map((pointer) => ({
    id: `ptr-${pointer.id}`,
    name: pointer.name,
    kind: 'pointer' as const,
    executable: false as const,
    certificationLevel: 'L0' as const,
    metadata: {
      dataType: pointer.dataType,
      moduleName: pointer.moduleName,
      rawAddress: pointer.rawAddress,
      baseOffset: pointer.baseOffset,
      pointerChain: pointer.pointerChain,
      liveResolution: pointer.liveResolution,
      showAsHex: pointer.showAsHex,
    },
  }));
  const scriptCheats = scripts.scripts.map((script, index) => ({
    id: `script-${index}-${slugId(script.name, 'script')}`,
    name: script.name,
    kind: 'script' as const,
    executable: false as const,
    certificationLevel: 'L0' as const,
    metadata: {
      scriptType: script.type,
      scriptExcerpt: script.script_excerpt,
    },
  }));
  const aobCheats = aobReport.signatures.map((signature, index) => ({
    id: `aob-${index}-${slugId(signature.symbol, 'signature')}`,
    name: signature.symbol,
    kind: 'aob' as const,
    executable: false as const,
    certificationLevel: 'L0' as const,
    metadata: {
      symbol: signature.symbol,
      moduleName: signature.module,
      scanType: signature.scanType,
      pattern: signature.pattern,
      sourceEntry: signature.sourceEntry,
      lineNumber: signature.lineNumber,
      warnings: signature.warnings,
      completeness: signature.completeness,
    },
  }));
  const cheats = [...pointerCheats, ...scriptCheats, ...aobCheats];
  const versionHintResult = extractVersionHint(tableName, archivePath);
  return {
    archivePath,
    game,
    tableName,
    sourceSha256,
    sourceBytes: Buffer.byteLength(xmlText, 'utf8'),
    ...(versionHintResult.kind !== 'none'
      ? { versionHint: { kind: versionHintResult.kind, hint: versionHintResult.hint! } }
      : {}),
    counts: {
      pointers: pointers.accepted.length,
      scripts: scripts.scripts.length,
      aobSignatures: aobReport.signatures.length,
      rejections: pointers.rejected.length,
      warnings: aobReport.warnings.length,
      duplicates: aobReport.duplicateSignatures,
    },
    rejectedEntries: pointers.rejected.map((rejection) => ({
      name: rejection.name,
      reason: rejection.reason,
      rejection_reason: rejection.reason,
    })),
    cheats,
  };
}

export async function compileCtZipArchive(
  zipPath: string,
  options: CompileCtZipOptions = {},
): Promise<CtZipCatalogIndex> {
  const sourceArchivePath = path.resolve(zipPath);
  const tempSandboxPath = await createTempSandbox(options);
  let shouldCleanupTempSandbox = true;
  try {
  throwIfAborted(options.signal);
  const archiveStats = await fs.stat(sourceArchivePath);
  const maxArchiveBytes = options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
  if (archiveStats.size > maxArchiveBytes) {
    throw new Error(`CT archive exceeds ${maxArchiveBytes} byte import cap.`);
  }
  emitProgress(options, {
    phase: 'hashing-source',
    label: 'Hashing Source...',
    processedTables: 0,
  });
  throwIfAborted(options.signal);
  const archiveBytes = await fs.readFile(sourceArchivePath);
  throwIfAborted(options.signal);
  const sourceArchiveSha256 = crypto.createHash('sha256').update(archiveBytes).digest('hex');
  const generatedAt = options.compiledAt ?? new Date().toISOString();
  const index: CtZipCatalogIndex = {
    schemaVersion: 1,
    sourceArchive: {
      path: sourceArchivePath,
      filename: path.basename(sourceArchivePath),
      sha256: sourceArchiveSha256,
    },
    generatedAt,
    totals: {
      ctFiles: 0,
      compiledTables: 0,
      rejectedTables: 0,
      pointers: 0,
      scripts: 0,
      aobSignatures: 0,
      cheats: 0,
    },
    tables: [],
    rejected: [],
  };

  try {
    emitProgress(options, {
      phase: 'extracting-archive',
      label: 'Extracting Archive...',
      processedTables: 0,
    });
    throwIfAborted(options.signal);
    const zipFile = await openZip(sourceArchivePath);
    const maxCtBytes = options.maxCtBytes ?? DEFAULT_MAX_CT_BYTES;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        zipFile.close();
        reject(new CtZipImportAbortError());
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      zipFile.on('entry', (entry) => {
        void (async () => {
          throwIfAborted(options.signal);
          if (!/\.ct$/i.test(entry.fileName)) {
            zipFile.readEntry();
            return;
          }
          if (typeof options.limit === 'number' && index.totals.ctFiles >= options.limit) {
            resolve();
            zipFile.close();
            return;
          }
          index.totals.ctFiles += 1;
          const unsafePathReason = validateZipEntryPath(entry.fileName);
          if (unsafePathReason) {
            index.rejected.push({ archivePath: entry.fileName, reason: unsafePathReason });
            index.totals.rejectedTables += 1;
            zipFile.readEntry();
            return;
          }
          if (entry.uncompressedSize > maxCtBytes) {
            index.rejected.push({ archivePath: entry.fileName, reason: `CT file exceeds ${maxCtBytes} byte import cap.` });
            index.totals.rejectedTables += 1;
            zipFile.readEntry();
            return;
          }
          try {
            const stream = await openReadStream(zipFile, entry);
            const xmlText = await streamToString(stream, options.signal);
            const table = await tableEntryFromXml(entry.fileName, xmlText, options, index.totals.compiledTables);
            index.tables.push(table);
            index.totals.compiledTables += 1;
            index.totals.pointers += table.counts.pointers;
            index.totals.scripts += table.counts.scripts;
            index.totals.aobSignatures += table.counts.aobSignatures;
            index.totals.cheats += table.cheats.length;
            if (options.outputRegistriesDir) {
              const outputPath = path.join(
                options.outputRegistriesDir,
                `${slugId(table.game, 'game')}__${slugId(table.tableName, 'table')}__${table.sourceSha256.slice(0, 12)}.registry.json`,
              );
              await compileSolithCtRegistryFromXml(xmlText, {
                sourceFile: path.basename(entry.fileName),
                sourcePath: `${sourceArchivePath}#${entry.fileName}`,
                game: table.game,
                title: table.tableName,
                outputJsonPath: outputPath,
                compiledAt: generatedAt,
                maxCtBytes,
                sourceKind: 'ct-zip-entry',
              });
            }
          } catch (error) {
            if (error instanceof CtZipImportAbortError) {
              throw error;
            }
            index.rejected.push({
              archivePath: entry.fileName,
              reason: error instanceof Error ? error.message : String(error),
            });
            index.totals.rejectedTables += 1;
          }
          zipFile.readEntry();
        })().catch(reject);
      });
      zipFile.on('end', () => {
        options.signal?.removeEventListener('abort', onAbort);
        resolve();
      });
      zipFile.on('error', (error) => {
        options.signal?.removeEventListener('abort', onAbort);
        reject(error);
      });
      zipFile.readEntry();
    });
    zipFile.close();
  } catch (error) {
    if (error instanceof CtZipImportAbortError) {
      emitProgress(options, {
        phase: 'cancelled',
        label: 'Import Cancelled.',
        processedTables: index.totals.compiledTables,
      });
    } else {
      emitProgress(options, {
        phase: 'failed',
        label: 'Import Failed.',
        processedTables: index.totals.compiledTables,
      });
    }
    throw error;
  }

  index.tables.sort((a, b) => a.archivePath.localeCompare(b.archivePath));
  index.rejected.sort((a, b) => a.archivePath.localeCompare(b.archivePath));

  if (options.outputJsonPath) {
    emitProgress(options, {
      phase: 'writing-output',
      label: 'Writing Output...',
      processedTables: index.totals.compiledTables,
      totalTables: index.totals.ctFiles,
    });
    throwIfAborted(options.signal);
    await fs.mkdir(path.dirname(options.outputJsonPath), { recursive: true });
    await fs.writeFile(options.outputJsonPath, JSON.stringify(index, null, 2), 'utf8');
  }

  emitProgress(options, {
    phase: 'complete',
    label: 'Import Complete.',
    processedTables: index.totals.compiledTables,
    totalTables: index.totals.ctFiles,
  });
  await cleanupTempSandbox(tempSandboxPath);
  shouldCleanupTempSandbox = false;
  return index;
  } finally {
    if (shouldCleanupTempSandbox) {
      await cleanupTempSandbox(tempSandboxPath);
    }
  }
}
