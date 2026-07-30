import fs from 'fs';
import path from 'path';
import {
  TrainerAdapter,
  ReadValueResult,
  DryRunResult,
  BuildOutputResult,
  ValidationResult
} from './contract';
import { ParsedDocument, ParserDiagnostic } from '../../shared/types';
import { buildParsedDocument } from '../saves/normalization';

/**
 * Narrow, evidence-driven adapter for the Drill Core (Hungry Couch, GameMaker)
 * `settings.json` configuration file.
 *
 * Scope is intentionally minimal: the ONLY writable target authorized by this
 * adapter is the top-level `master_volume` numeric setting (integer 0–100).
 *
 * Unlike the generic JSON adapter, this adapter performs a byte-preserving
 * targeted token replacement so that GameMaker's real-number serialization
 * (e.g. `100.0`) and single-line layout are preserved and the diff is limited
 * to the one selected numeric token. This avoids reserializing the entire file
 * (which would rewrite every `N.0` value).
 *
 * This is NOT a generic JSON editor. Any path other than `master_volume` is
 * rejected, as are wrong filenames, missing/duplicate keys, non-numeric values,
 * fractional/out-of-range proposals, malformed JSON, and BOM-prefixed content.
 */

export const DRILL_CORE_SETTINGS_FILE = 'settings.json';
export const DRILL_CORE_TARGET = 'master_volume';
export const DRILL_CORE_MIN = 0;
export const DRILL_CORE_MAX = 100;

export interface MasterVolumeToken {
  /** Byte/char offset where the numeric token starts. */
  start: number;
  /** Length of the numeric token. */
  length: number;
  /** The raw numeric token text (e.g. "100.0" or "100"). */
  raw: string;
  /** Parsed numeric value. */
  value: number;
  /** Whether the original token used real/decimal formatting. */
  decimal: boolean;
}

export interface ApplyMasterVolumeResult {
  success: boolean;
  content?: string;
  error?: string;
  evidence?: {
    originalToken: string;
    replacementToken: string;
    originalSpan: [number, number];
    modifiedSpan: [number, number];
    changedRegions: number;
    prefixEqual: boolean;
    suffixEqual: boolean;
  };
}

function hasBom(raw: string): boolean {
  return raw.charCodeAt(0) === 0xfeff;
}

/** Strictly validate the full document is JSON and return the parsed object. */
function strictParseObject(raw: string): { ok: true; data: any } | { ok: false; error: string } {
  if (hasBom(raw)) {
    return { ok: false, error: 'Unexpected BOM in Drill Core settings file.' };
  }
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `Malformed JSON: ${String(e)}` };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Drill Core settings root must be a JSON object.' };
  }
  return { ok: true, data };
}

/**
 * Locate exactly one top-level `master_volume` numeric token in the raw text.
 * Returns an error if zero or more than one candidate token is present, or if
 * the key is nested rather than top-level.
 */
export function findMasterVolumeToken(raw: string): { ok: true; token: MasterVolumeToken } | { ok: false; error: string } {
  const parsed = strictParseObject(raw);
  if (parsed.ok === false) return { ok: false, error: parsed.error };

  if (!Object.prototype.hasOwnProperty.call(parsed.data, DRILL_CORE_TARGET)) {
    return { ok: false, error: `Top-level "${DRILL_CORE_TARGET}" key not found.` };
  }
  const semanticValue = parsed.data[DRILL_CORE_TARGET];
  if (typeof semanticValue !== 'number' || !Number.isFinite(semanticValue)) {
    return { ok: false, error: `"${DRILL_CORE_TARGET}" must be a finite number.` };
  }

  // Match `"master_volume" : <number>` capturing the label and the numeric token.
  const re = /("master_volume"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const matches: Array<{ start: number; length: number; raw: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    matches.push({ start: m.index + m[1].length, length: m[2].length, raw: m[2] });
  }
  if (matches.length === 0) {
    return { ok: false, error: 'Could not locate the master_volume numeric token.' };
  }
  if (matches.length > 1) {
    return { ok: false, error: 'Ambiguous master_volume token: more than one candidate found.' };
  }

  const only = matches[0];
  const tokenValue = Number(only.raw);
  if (!Number.isFinite(tokenValue) || tokenValue !== semanticValue) {
    return { ok: false, error: 'Token value does not match parsed semantic value.' };
  }

  return {
    ok: true,
    token: {
      start: only.start,
      length: only.length,
      raw: only.raw,
      value: tokenValue,
      decimal: only.raw.includes('.')
    }
  };
}

/** Validate a proposed master_volume value: finite integer within 0–100. */
export function validateMasterVolume(value: unknown): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    const coerced = Number(value);
    if (!Number.isFinite(coerced)) {
      return { ok: false, error: 'master_volume must be a finite number.' };
    }
    value = coerced;
  }
  const n = value as number;
  if (!Number.isInteger(n)) {
    return { ok: false, error: 'master_volume must be an integer (no fractional values).' };
  }
  if (n < DRILL_CORE_MIN || n > DRILL_CORE_MAX) {
    return { ok: false, error: `master_volume must be within ${DRILL_CORE_MIN}–${DRILL_CORE_MAX}.` };
  }
  return { ok: true, value: n };
}

/**
 * Produce a byte-preserving edit of `raw`, changing only the master_volume
 * numeric token. Preserves the original numeric style (e.g. `100.0` → `75.0`).
 */
export function applyMasterVolume(
  raw: string,
  newValue: number,
  expectedOldValue?: number
): ApplyMasterVolumeResult {
  const valueCheck = validateMasterVolume(newValue);
  if (valueCheck.ok === false) return { success: false, error: valueCheck.error };

  const found = findMasterVolumeToken(raw);
  if (found.ok === false) return { success: false, error: found.error };
  const token = found.token;

  if (expectedOldValue !== undefined && token.value !== expectedOldValue) {
    return {
      success: false,
      error: `Stale value: current master_volume ${token.value} !== expected ${expectedOldValue}.`
    };
  }

  // Preserve GameMaker numeric style.
  const replacement = token.decimal ? `${valueCheck.value}.0` : `${valueCheck.value}`;

  const prefix = raw.slice(0, token.start);
  const suffix = raw.slice(token.start + token.length);
  const content = prefix + replacement + suffix;

  // Prove only the selected region changed.
  const newToken = findMasterVolumeToken(content);
  const prefixEqual = content.slice(0, token.start) === prefix;
  const suffixEqual = content.slice(token.start + replacement.length) === suffix;

  return {
    success: true,
    content,
    evidence: {
      originalToken: token.raw,
      replacementToken: replacement,
      originalSpan: [token.start, token.start + token.length],
      modifiedSpan: [token.start, token.start + replacement.length],
      changedRegions: 1,
      prefixEqual,
      suffixEqual: suffixEqual && (newToken.ok ? newToken.token.value === valueCheck.value : false)
    }
  };
}

export class DrillCoreSettingsAdapter implements TrainerAdapter {
  readonly id = 'drill-core-settings';
  readonly version = '1.0.0';

  supports(filePath: string): boolean {
    return path.basename(filePath).toLowerCase() === DRILL_CORE_SETTINGS_FILE;
  }

  private isAuthorizedTarget(pathStr: string): boolean {
    return pathStr === DRILL_CORE_TARGET;
  }

  async readCurrentValue(filePath: string, pathStr: string): Promise<ReadValueResult> {
    try {
      if (!this.isAuthorizedTarget(pathStr)) {
        return { success: false, value: null, error: `Unsupported target "${pathStr}" (only ${DRILL_CORE_TARGET}).` };
      }
      if (!fs.existsSync(filePath)) {
        return { success: false, value: null, error: 'File does not exist' };
      }
      const raw = fs.readFileSync(filePath, 'utf-8');
      const found = findMasterVolumeToken(raw);
      if (found.ok === false) return { success: false, value: null, error: found.error };
      return { success: true, value: found.token.value };
    } catch (e) {
      return { success: false, value: null, error: String(e) };
    }
  }

  async dryRun(filePath: string, pathStr: string, expectedOldValue?: any): Promise<DryRunResult> {
    if (!this.isAuthorizedTarget(pathStr)) {
      return { success: false, error: `Unsupported target "${pathStr}" (only ${DRILL_CORE_TARGET}).` };
    }
    const res = await this.readCurrentValue(filePath, pathStr);
    if (!res.success) return { success: false, error: res.error };
    if (expectedOldValue !== undefined && String(res.value) !== String(expectedOldValue)) {
      return { success: false, error: `Value mismatch: current ${res.value} !== expected ${expectedOldValue} (stale edit)` };
    }
    return { success: true };
  }

  async buildOutput(filePath: string, pathStr: string, newValue: any): Promise<BuildOutputResult> {
    try {
      if (!this.isAuthorizedTarget(pathStr)) {
        return { success: false, content: '', error: `Unsupported target "${pathStr}" (only ${DRILL_CORE_TARGET}).` };
      }
      if (!fs.existsSync(filePath)) {
        return { success: false, content: '', error: 'File does not exist' };
      }
      const raw = fs.readFileSync(filePath, 'utf-8');
      const current = findMasterVolumeToken(raw);
      if (current.ok === false) return { success: false, content: '', error: current.error };

      const result = applyMasterVolume(raw, Number(newValue), current.token.value);
      if (!result.success || result.content === undefined) {
        return { success: false, content: '', error: result.error || 'Failed to build output' };
      }
      if (!result.evidence || !result.evidence.prefixEqual || !result.evidence.suffixEqual) {
        return { success: false, content: '', error: 'Byte-preservation check failed.' };
      }
      return { success: true, content: result.content };
    } catch (e) {
      return { success: false, content: '', error: String(e) };
    }
  }

  async validateContent(content: string, _filePath: string): Promise<ValidationResult> {
    const parsed = strictParseObject(content);
    if (parsed.ok === false) return { valid: false, error: parsed.error };
    return { valid: true };
  }

  async parseAndNormalize(filePath: string): Promise<ParsedDocument> {
    let raw = fs.readFileSync(filePath, 'utf-8');
    const diagnostics: ParserDiagnostic[] = [];
    if (hasBom(raw)) {
      raw = raw.slice(1);
      diagnostics.push({ severity: 'warning', message: 'BOM stripped during normalization' });
    }
    let parsed: any = {};
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      diagnostics.push({ severity: 'error', message: err.message });
    }
    return buildParsedDocument(this.id, this.version, filePath, 'json', parsed, diagnostics, true);
  }
}
