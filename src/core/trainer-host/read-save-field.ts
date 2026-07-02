/**
 * readSaveField capability: reads a single string value from an XML save file.
 *
 * This is the only capability the TrainerHost exposes in Milestone C.
 * It is read-only — no writes are performed. Path approval is enforced
 * by the main-process supervisor BEFORE this function is called; this
 * module runs inside the child process and has no access to the approved-
 * locations database, so it re-runs validateXmlSafety as a defensive layer.
 *
 * The `field` parameter uses xml2js dot-notation matching XmlAdapter:
 *   "SaveGame.player.money" → xml["SaveGame"]["player"]["money"]
 */

import { XmlAdapter, validateXmlSafety } from '../adapters/xml';
import { readJsonSaveField } from '../saves/json-save-field';
import { readIniSaveField } from '../saves/ini-save-field';
import { assertPathSaveFormatSupportsOperation, detectSaveFormatFromPath } from '../saves/save-format';
import fs from 'fs';

export interface ReadSaveFieldParams {
  filePath: string;
  field: string;
}

export interface ReadSaveFieldResult {
  value: string | null;
  found: boolean;
}

const adapter = new XmlAdapter();

export async function readSaveField(params: unknown): Promise<ReadSaveFieldResult> {
  if (!isValidParams(params)) {
    throw new Error('invalid_params: expected { filePath: string, field: string }');
  }

  const { filePath, field } = params;

  if (!fs.existsSync(filePath)) {
    return { value: null, found: false };
  }
  assertPathSaveFormatSupportsOperation(filePath, 'save_field_read');

  const format = detectSaveFormatFromPath(filePath);
  if (format === 'json') {
    const result = readJsonSaveField(filePath, field);
    if (!result.found) {
      return { value: null, found: false };
    }
    return { value: String(result.value), found: true };
  }
  if (format === 'ini') {
    const result = readIniSaveField(filePath, field);
    if (!result.found) {
      return { value: null, found: false };
    }
    return { value: String(result.value), found: true };
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const safety = validateXmlSafety(raw);
  if (!safety.safe) {
    throw new Error(`xml_safety: ${safety.error}`);
  }

  const result = await adapter.readCurrentValue(filePath, field);
  if (!result.success) {
    throw new Error(`read_error: ${result.error}`);
  }

  if (result.value === undefined || result.value === null) {
    return { value: null, found: false };
  }

  // xml2js wraps leaf values in single-element arrays: ['5000'] → '5000'
  const unwrapped = Array.isArray(result.value) && result.value.length === 1
    ? result.value[0]
    : result.value;

  return { value: String(unwrapped), found: true };
}

function isValidParams(p: unknown): p is ReadSaveFieldParams {
  return (
    typeof p === 'object' &&
    p !== null &&
    typeof (p as ReadSaveFieldParams).filePath === 'string' &&
    (p as ReadSaveFieldParams).filePath.length > 0 &&
    typeof (p as ReadSaveFieldParams).field === 'string' &&
    (p as ReadSaveFieldParams).field.length > 0
  );
}
