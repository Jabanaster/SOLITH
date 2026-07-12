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
    preview: `Preview ${field}: ${readResult.value} -> ${String(proposedValue)} (backup + atomic write on approval)`,
  };
}

export interface IniSaveFieldWriteResult {
  verifiedValue: string;
  backupPath: string;
}

/**
 * Replaces a single INI key value in-place (preserving comments, section order, and separators).
 */
export function writeIniSaveField(
  filePath: string,
  field: string,
  expectedCurrentValue: string,
  proposedValue: string,
): IniSaveFieldWriteResult {
  const proposal = validateIniSaveFieldProposal(filePath, field, expectedCurrentValue, proposedValue);
  const target = assertSimpleIniFieldPath(field);
  const raw = readIniText(filePath);
  const lines = raw.split(/\r?\n/);
  let currentSection = '';
  let replaced = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;

    const sectionMatch = trimmed.match(/^\[([A-Za-z0-9_$-]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!;
      continue;
    }

    const separatorIndex = line.search(/[=:]/);
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    const sectionMatches = (target.section ?? '') === currentSection;
    if (!sectionMatches || key !== target.key) continue;

    const liveValue = line.slice(separatorIndex + 1).trim();
    if (liveValue !== proposal.currentValue) {
      throw new Error(`value_changed_since_proposal: current=${liveValue} expected=${proposal.currentValue}`);
    }

    lines[index] = `${line.slice(0, separatorIndex + 1)}${String(proposedValue)}`;
    replaced = true;
    break;
  }

  if (!replaced) throw new Error('field_not_found');

  const backupPath = filePath + '.trainer-backup';
  fs.copyFileSync(filePath, backupPath);

  const tmpPath = filePath + '.trainer-tmp';
  const output = lines.join('\n');
  fs.writeFileSync(tmpPath, output.endsWith('\n') ? output : `${output}\n`, 'utf-8');
  fs.renameSync(tmpPath, filePath);

  const verify = readIniSaveField(filePath, field);
  if (!verify.found || verify.value === null) throw new Error('verify_field_not_found');
  if (verify.value !== String(proposedValue)) {
    throw new Error(`verify_mismatch: current=${verify.value} expected=${proposedValue}`);
  }

  return { verifiedValue: verify.value, backupPath };
}
