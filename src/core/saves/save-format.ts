import path from 'path';
import { listBinarySaveProfiles } from './binary-formats/index.js';

export type SaveFormatId = 'xml' | 'json' | 'ini' | 'binary' | 'unknown' | 'unsupported';

export type SaveFormatOperation =
  | 'save_field_read'
  | 'save_field_propose'
  | 'save_field_write'
  | 'save_field_rollback'
  | 'inspect';

export interface SaveFormatCapability {
  id: SaveFormatId;
  label: string;
  recognized: boolean;
  canInspect: boolean;
  canReadSaveField: boolean;
  canProposeSaveField: boolean;
  canWriteSaveField: boolean;
}

const CAPABILITIES: Record<SaveFormatId, SaveFormatCapability> = {
  xml: {
    id: 'xml',
    label: 'XML',
    recognized: true,
    canInspect: true,
    canReadSaveField: true,
    canProposeSaveField: true,
    canWriteSaveField: true,
  },
  json: {
    id: 'json',
    label: 'JSON',
    recognized: true,
    canInspect: true,
    canReadSaveField: true,
    canProposeSaveField: true,
    canWriteSaveField: true,
  },
  ini: {
    id: 'ini',
    label: 'INI/config',
    recognized: true,
    canInspect: true,
    canReadSaveField: true,
    canProposeSaveField: true,
    canWriteSaveField: true,
  },
  binary: {
    id: 'binary',
    label: 'Structured binary',
    recognized: true,
    canInspect: true,
    canReadSaveField: true,
    canProposeSaveField: true,
    canWriteSaveField: true,
  },
  unknown: {
    id: 'unknown',
    label: 'Unknown',
    recognized: false,
    canInspect: false,
    canReadSaveField: false,
    canProposeSaveField: false,
    canWriteSaveField: false,
  },
  unsupported: {
    id: 'unsupported',
    label: 'Unsupported',
    recognized: false,
    canInspect: false,
    canReadSaveField: false,
    canProposeSaveField: false,
    canWriteSaveField: false,
  },
};

const DECLARED_FORMATS = new Set<SaveFormatId>(['xml', 'json', 'ini', 'binary']);

const BINARY_EXTENSIONS = new Set(
  listBinarySaveProfiles()
    .filter((p) => p.canWrite)
    .map((p) => p.extension.toLowerCase()),
);

export class UnsupportedSaveFormatError extends Error {
  readonly code = 'unsupported_save_format';
  readonly format: SaveFormatId;
  readonly operation: SaveFormatOperation;
  readonly targetName: string;

  constructor(format: SaveFormatId, operation: SaveFormatOperation, targetPath?: string) {
    const targetName = targetPath ? path.basename(targetPath) : 'selected file';
    super(`unsupported_save_format: ${operation} is not supported for ${format} save data (target: ${targetName}).`);
    this.name = 'UnsupportedSaveFormatError';
    this.format = format;
    this.operation = operation;
    this.targetName = targetName;
  }
}

export function normalizeDeclaredSaveFormat(format: unknown): SaveFormatId {
  if (typeof format !== 'string') return 'unknown';
  const normalized = format.trim().toLowerCase();
  if (DECLARED_FORMATS.has(normalized as SaveFormatId)) {
    return normalized as SaveFormatId;
  }
  if (normalized === 'unknown' || normalized === 'unsupported') {
    return normalized;
  }
  return 'unsupported';
}

export function detectSaveFormatFromPath(filePath: string): SaveFormatId {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.xml') return 'xml';
  if (extension === '.json') return 'json';
  if (extension === '.ini' || extension === '.cfg' || extension === '.conf') return 'ini';
  if (BINARY_EXTENSIONS.has(extension)) return 'binary';
  if (!extension) return 'unknown';
  return 'unsupported';
}

export function getSaveFormatCapability(format: SaveFormatId): SaveFormatCapability {
  return CAPABILITIES[format] ?? CAPABILITIES.unsupported;
}

export function getDeclaredSaveFormatCapability(format: unknown): SaveFormatCapability {
  return getSaveFormatCapability(normalizeDeclaredSaveFormat(format));
}

export function getDetectedSaveFormatCapability(filePath: string): SaveFormatCapability {
  return getSaveFormatCapability(detectSaveFormatFromPath(filePath));
}

export function assertSaveFormatSupportsOperation(
  format: SaveFormatId,
  operation: SaveFormatOperation,
  targetPath?: string,
): void {
  const capability = getSaveFormatCapability(format);
  const supported =
    operation === 'inspect'
      ? capability.canInspect
      : operation === 'save_field_read'
        ? capability.canReadSaveField
        : operation === 'save_field_propose'
          ? capability.canProposeSaveField
        : capability.canWriteSaveField;

  if (!supported) {
    throw new UnsupportedSaveFormatError(format, operation, targetPath);
  }
}

export function assertPathSaveFormatSupportsOperation(
  filePath: string,
  operation: SaveFormatOperation,
): void {
  assertSaveFormatSupportsOperation(detectSaveFormatFromPath(filePath), operation, filePath);
}
