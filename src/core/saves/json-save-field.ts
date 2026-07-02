import fs from 'fs';

const MAX_JSON_SAVE_FILE_BYTES = 8 * 1024 * 1024;

export interface JsonSaveFieldReadResult {
  value: unknown;
  found: boolean;
}

function stripJsonComments(jsonString: string): string {
  return jsonString.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? '' : m);
}

function assertSimpleJsonFieldPath(field: string): string[] {
  const parts = field.split('.');
  if (
    parts.length === 0 ||
    parts.some(part => !/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(part))
  ) {
    throw new Error('json_field_path_unsupported: expected simple dot notation without arrays');
  }
  return parts;
}

function readJsonDocument(filePath: string): unknown {
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
