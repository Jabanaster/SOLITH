import fs from 'fs';

const MAX_INI_SAVE_FILE_BYTES = 2 * 1024 * 1024;

export interface IniSaveFieldReadResult {
  value: string | null;
  found: boolean;
}

function assertSimpleIniFieldPath(field: string): { section: string | null; key: string } {
  const parts = field.split('.');
  if (
    parts.length < 1 ||
    parts.length > 2 ||
    parts.some(part => !/^[A-Za-z0-9_$-]+$/.test(part))
  ) {
    throw new Error('ini_field_path_unsupported: expected key or section.key without arrays');
  }

  return parts.length === 1
    ? { section: null, key: parts[0] }
    : { section: parts[0], key: parts[1] };
}

function readIniText(filePath: string): string {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error('save_path_not_file');
  }
  if (stat.size > MAX_INI_SAVE_FILE_BYTES) {
    throw new Error(`Save file is too large to parse safely (${stat.size} bytes > ${MAX_INI_SAVE_FILE_BYTES} bytes; limit 2.0 MiB).`);
  }

  let raw = fs.readFileSync(filePath, 'utf-8');
  if (raw.charCodeAt(0) === 0xFEFF) {
    raw = raw.slice(1);
  }
  return raw;
}

function parseIni(text: string): Map<string, Map<string, string>> {
  const rootSection = '';
  const sections = new Map<string, Map<string, string>>([[rootSection, new Map()]]);
  let currentSection = rootSection;

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^\[([A-Za-z0-9_$-]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (!sections.has(currentSection)) sections.set(currentSection, new Map());
      continue;
    }

    const separatorIndex = line.search(/[=:]/);
    if (separatorIndex <= 0) {
      throw new Error(`ini_parse_error: malformed INI data at line ${index + 1}`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!/^[A-Za-z0-9_$-]+$/.test(key)) {
      throw new Error(`ini_parse_error: unsupported key at line ${index + 1}`);
    }

    const section = sections.get(currentSection);
    if (!section) throw new Error('ini_parse_error: malformed INI data');
    if (section.has(key)) {
      throw new Error(`ini_parse_error: duplicate key "${key}"`);
    }
    section.set(key, value);
  }

  return sections;
}

export function readIniSaveField(filePath: string, field: string): IniSaveFieldReadResult {
  const target = assertSimpleIniFieldPath(field);
  const sections = parseIni(readIniText(filePath));
  const section = sections.get(target.section ?? '');
  if (!section || !section.has(target.key)) {
    return { value: null, found: false };
  }
  return { value: section.get(target.key) ?? null, found: true };
}

export function validateIniSaveFieldProposal(
  filePath: string,
  field: string,
  expectedCurrentValue: string,
  proposedValue: string,
): { currentValue: string; proposedValue: string; preview: string } {
  const readResult = readIniSaveField(filePath, field);
  if (!readResult.found || readResult.value === null) throw new Error('field_not_found');
  if (readResult.value !== String(expectedCurrentValue)) {
    throw new Error(`value_mismatch: current=${readResult.value} expected=${expectedCurrentValue}`);
  }
  return {
    currentValue: readResult.value,
    proposedValue: String(proposedValue),
    preview: `Preview ${field}: ${readResult.value} -> ${String(proposedValue)} (INI write execution is not supported)`,
  };
}
