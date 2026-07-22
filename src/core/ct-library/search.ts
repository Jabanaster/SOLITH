import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CtLibraryGameSummary, CtLibrarySummaryIndex } from './types.js';
import type { CtZipCatalogEntry } from '../registry/compile-ct-zip.js';

export interface CtLibraryPaths {
  summaryPath: string;
}

export interface CtLibrarySearchOptions {
  query?: string;
  gameId?: string;
  kind?: 'all' | 'pointer' | 'script' | 'aob';
  limit?: number;
  offset?: number;
}

export interface CtLibrarySearchResult {
  id: string;
  gameId: string;
  gameDisplayName: string;
  tableName: string;
  archivePath: string;
  sourceSha256: string;
  type: 'pointer' | 'script' | 'aob';
  title: string;
  executable: false;
  certificationLevel: 'L0';
}

export interface CtLibrarySearchResponse {
  available: boolean;
  summary?: CtLibrarySummaryIndex;
  total: number;
  results: CtLibrarySearchResult[];
  error?: string;
}

export interface CtLibraryGameDetail {
  available: boolean;
  game?: CtLibraryGameSummary;
  tables: CtZipCatalogEntry[];
  error?: string;
}

export function defaultCtLibraryPaths(projectRoot: string): CtLibraryPaths {
  return {
    summaryPath: path.join(projectRoot, 'data', 'ct-library', 'personal-ct-library.summary.json'),
  };
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.min(200, Math.max(1, Math.trunc(limit ?? 50)));
}

function clampOffset(offset: number | undefined): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.trunc(offset ?? 0));
}

function includesText(fields: Array<string | undefined>, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return fields.some((field) => (field ?? '').toLowerCase().includes(needle));
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function shardPathForGame(summary: CtLibrarySummaryIndex, gameId: string): string | null {
  const shard = summary.shards?.find((candidate) => candidate.gameId === gameId);
  if (!shard) return null;
  return path.isAbsolute(shard.path) ? shard.path : path.resolve(shard.path);
}

async function readGameTables(summary: CtLibrarySummaryIndex, gameId: string): Promise<CtZipCatalogEntry[]> {
  const shardPath = shardPathForGame(summary, gameId);
  if (!shardPath) return [];
  const shard = await readJsonFile<{ tables?: CtZipCatalogEntry[] }>(shardPath);
  return Array.isArray(shard?.tables) ? shard.tables : [];
}

function entryResults(game: CtLibraryGameSummary, table: CtZipCatalogEntry): CtLibrarySearchResult[] {
  return table.cheats.map((cheat) => ({
    id: `${game.gameId}:${table.sourceSha256}:${cheat.id}`,
    gameId: game.gameId,
    gameDisplayName: game.displayName,
    tableName: table.tableName,
    archivePath: table.archivePath,
    sourceSha256: table.sourceSha256,
    type: cheat.kind,
    title: cheat.name,
    executable: false,
    certificationLevel: 'L0',
  }));
}

function cheatForResult(game: CtLibraryGameSummary, table: CtZipCatalogEntry, result: CtLibrarySearchResult): CtZipCatalogEntry['cheats'][number] | null {
  return table.cheats.find((cheat) => `${game.gameId}:${table.sourceSha256}:${cheat.id}` === result.id) ?? null;
}

export async function loadCtLibrarySummary(paths: CtLibraryPaths): Promise<CtLibrarySummaryIndex | null> {
  return readJsonFile<CtLibrarySummaryIndex>(paths.summaryPath);
}

export async function searchCtLibrary(
  paths: CtLibraryPaths,
  options: CtLibrarySearchOptions = {},
): Promise<CtLibrarySearchResponse> {
  const summary = await loadCtLibrarySummary(paths);
  if (!summary) {
    return { available: false, total: 0, results: [], error: 'ct_library_not_imported' };
  }

  const query = (options.query ?? '').trim();
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);
  const kind = options.kind ?? 'all';
  const games = summary.games.filter((game) => {
    if (options.gameId && game.gameId !== options.gameId) return false;
    return true;
  });

  const all: CtLibrarySearchResult[] = [];
  for (const game of games) {
    const tables = await readGameTables(summary, game.gameId);
    for (const table of tables) {
      const tableMatchesQuery = includesText([table.tableName, table.archivePath, table.game], query);
      for (const result of entryResults(game, table)) {
        if (kind !== 'all' && result.type !== kind) continue;
        const cheat = cheatForResult(game, table, result);
        if (
          query &&
          !includesText([game.displayName, game.gameId], query) &&
          !tableMatchesQuery &&
          !includesText([
            result.title,
            result.type,
            cheat?.metadata?.moduleName,
            cheat?.metadata?.pattern,
            cheat?.metadata?.scanType,
          ], query)
        ) continue;
        all.push(result);
      }
    }
  }

  all.sort((a, b) =>
    a.gameDisplayName.localeCompare(b.gameDisplayName) ||
    a.tableName.localeCompare(b.tableName) ||
    a.type.localeCompare(b.type) ||
    a.title.localeCompare(b.title),
  );

  return {
    available: true,
    summary,
    total: all.length,
    results: all.slice(offset, offset + limit),
  };
}

export async function getCtLibraryGameDetail(paths: CtLibraryPaths, gameId: string): Promise<CtLibraryGameDetail> {
  const summary = await loadCtLibrarySummary(paths);
  if (!summary) return { available: false, tables: [], error: 'ct_library_not_imported' };
  const game = summary.games.find((candidate) => candidate.gameId === gameId);
  if (!game) return { available: true, tables: [], error: 'game_not_found' };
  return { available: true, game, tables: await readGameTables(summary, gameId) };
}
