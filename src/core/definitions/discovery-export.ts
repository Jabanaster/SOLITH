import type { DiscoveryResult } from '../../shared/types/index.js';
import { slugifyDefinitionToken } from './slug.js';
import {
  SOLITH_DEFINITION_SCHEMA_VERSION,
  type SaveFieldFeatureV1,
  type SaveFormatType,
  type SolithDefinitionV1,
} from './schema.v1.js';

export interface DiscoveryExportContext {
  gameId: string;
  gameName: string;
  executables?: string[];
  /** Save file used for the discovery comparison (after state). */
  saveFilePath: string;
  candidate: DiscoveryResult;
  author?: string;
}

function inferSaveFormat(saveFilePath: string): SaveFormatType {
  const lower = saveFilePath.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.xml')) return 'xml';
  if (lower.endsWith('.db') || lower.endsWith('.sqlite') || lower.endsWith('.sqlite3')) return 'sqlite';
  return 'binary';
}

function inferSaveExtension(saveFilePath: string): string {
  const normalized = saveFilePath.replace(/\\/g, '/');
  const name = normalized.split('/').pop() ?? 'save';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot) : '.dat';
}

/** Human-friendly directory placeholder derived from a real save path. */
export function inferSaveDirectoryHint(saveFilePath: string): string {
  const normalized = saveFilePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  parts.pop();
  const dir = parts.join('/');
  if (dir.includes('AppData/Roaming')) {
    return '%APPDATA%\\' + dir.split('AppData/Roaming/')[1]?.replace(/\//g, '\\');
  }
  if (dir.includes('Saved Games')) {
    return '%USERPROFILE%\\Saved Games\\' + dir.split('Saved Games/')[1]?.replace(/\//g, '\\');
  }
  return dir.replace(/\//g, '\\');
}

function mapValueType(candidate: DiscoveryResult): string {
  const vt = candidate.valueType ?? typeof candidate.newValue;
  if (vt === 'boolean') return 'boolean';
  if (vt === 'number') return 'number';
  if (vt === 'string') return 'string';
  return 'string';
}

export function discoveryResultToSaveField(candidate: DiscoveryResult): SaveFieldFeatureV1 {
  const label = candidate.suggestedName?.trim() || candidate.path.split('.').pop() || candidate.path;
  return {
    id: slugifyDefinitionToken(label),
    name: label,
    category: candidate.suggestedCategory ?? 'Discovered',
    dataType: mapValueType(candidate),
    mapping: {
      searchKey: candidate.path,
    },
  };
}

/**
 * Build a schema.v1 definition from a Discovery Lab candidate.
 * Produces a saveEditor block — advisory only until reviewed and compiled.
 */
export function discoveryResultToDefinition(context: DiscoveryExportContext): SolithDefinitionV1 {
  const executables =
    context.executables && context.executables.length > 0
      ? context.executables
      : [`${slugifyDefinitionToken(context.gameName)}.exe`];

  return {
    schemaVersion: SOLITH_DEFINITION_SCHEMA_VERSION,
    id: `custom_${slugifyDefinitionToken(context.gameId || context.gameName)}`,
    title: context.gameName,
    gameVersion: '*',
    executableHashPrefixes: [],
    author: context.author ?? 'discovery-lab',
    safety: {
      requiresApproval: true,
      requiresOfflineConfirm: true,
      verificationStatus: 'community',
    },
    target: {
      executables,
      arch: 'x64',
    },
    saveEditor: {
      defaultDirectory: inferSaveDirectoryHint(context.saveFilePath),
      extension: inferSaveExtension(context.saveFilePath),
      format: inferSaveFormat(context.saveFilePath),
      saveFields: [discoveryResultToSaveField(context.candidate)],
    },
  };
}

export function definitionExportFilename(definition: Pick<SolithDefinitionV1, 'id'>): string {
  return `${definition.id}.yml`;
}
