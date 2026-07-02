import fs from 'fs';

const MAX_JSON_SAVE_FILE_BYTES = 8 * 1024 * 1024;

export interface JsonSaveFieldReadResult {
  value: unknown;
  found: boolean;
}

export interface JsonSaveFieldProposal {
  currentValue: string;
  currentType: 'string' | 'number' | 'boolean';
  proposedValue: string;
  proposedTypedValue: string | number | boolean;
  preview: string;
}

function stripJsonComments(jsonString: string): string {
  return jsonString.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? '' : m);
}

export function assertSimpleJsonFieldPath(field: string): string[] {
  const parts = field.split('.');
  if (
    parts.length === 0 ||
    parts.some(part => !/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(part))
  ) {
    throw new Error('json_field_path_unsupported: expected simple dot notation without arrays');
  }
  return parts;
}

export function readJsonDocument(filePath: string): unknown {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error('save_path_not_file');
  }
  if (stat.size > MAX_JSON_SAVE_FILE_BYTES) {
    throw new Error(`Save file is too large to parse safely (${stat.size} bytes > ${MAX_JSON_SAVE_FILE_BYTES} bytes; limit 8.0 MiB).`);
  }

  let raw = fs.readFileSync(filePath, 'utf-8');
  if (raw.charCodeAt(0) === 0xFEFF) {
    raw = raw.slice(1);
  }

  try {
    return JSON.parse(stripJsonComments(raw));
  } catch {
    throw new Error('json_parse_error: malformed JSON save data');
  }
}

export function readJsonSaveField(filePath: string, field: string): JsonSaveFieldReadResult {
  const parts = assertSimpleJsonFieldPath(field);
  let current = readJsonDocument(filePath);

  for (const part of parts) {
    if (
      current === null ||
      typeof current !== 'object' ||
      Array.isArray(current) ||
      !Object.prototype.hasOwnProperty.call(current, part)
    ) {
      return { value: null, found: false };
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (current === undefined || typeof current === 'object') {
    return { value: null, found: false };
  }

  return { value: current, found: true };
}

function scalarType(value: unknown): 'string' | 'number' | 'boolean' | null {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return null;
}

function parseProposedScalar(rawValue: string, targetType: 'string' | 'number' | 'boolean'): string | number | boolean {
  if (targetType === 'string') return rawValue;
  if (targetType === 'number') {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      throw new Error('json_proposal_type_mismatch: proposed value must be a finite number');
    }
    return parsed;
  }
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error('json_proposal_type_mismatch: proposed value must be true or false');
}

export function validateJsonSaveFieldProposal(
  filePath: string,
  field: string,
  expectedCurrentValue: string,
  proposedValue: string,
): JsonSaveFieldProposal {
  const readResult = readJsonSaveField(filePath, field);
  if (!readResult.found) throw new Error('field_not_found');

  const currentType = scalarType(readResult.value);
  if (!currentType) {
    throw new Error('json_proposal_type_unsupported: only string, number, and boolean fields can be previewed');
  }

  const currentValue = String(readResult.value);
  if (currentValue !== String(expectedCurrentValue)) {
    throw new Error(`value_mismatch: current=${currentValue} expected=${expectedCurrentValue}`);
  }

  const proposedTypedValue = parseProposedScalar(String(proposedValue), currentType);
  return {
    currentValue,
    currentType,
    proposedValue: String(proposedValue),
    proposedTypedValue,
    preview: `Preview ${field}: ${currentValue} -> ${String(proposedValue)} (${currentType}; JSON write execution is not supported)`,
  };
}
