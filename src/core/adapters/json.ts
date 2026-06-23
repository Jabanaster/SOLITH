import fs from 'fs';
import { TrainerAdapter, ReadValueResult, DryRunResult, BuildOutputResult, ValidationResult } from './contract';

import { ParsedDocument, ParserDiagnostic } from '../../shared/types';
import { buildParsedDocument } from '../saves/normalization';

function stripJSONComments(jsonString: string): string {
  return jsonString.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m);
}

export function setDeepValue(obj: any, pathStr: string, val: any) {
  const parts = pathStr.split(/[.\[\]]/).filter(Boolean);
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const index = parseInt(part);
    if (!isNaN(index) && Array.isArray(current)) {
      if (current[index] === undefined) current[index] = {};
      current = current[index];
    } else {
      if (current[part] === undefined) current[part] = {};
      current = current[part];
    }
  }
  const lastPart = parts[parts.length - 1];
  const lastIndex = parseInt(lastPart);
  if (!isNaN(lastIndex) && Array.isArray(current)) {
    current[lastIndex] = val;
  } else {
    current[lastPart] = val;
  }
}

export function getDeepValue(obj: any, pathStr: string): any {
  const parts = pathStr.split(/[.\[\]]/).filter(Boolean);
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    const idx = parseInt(part);
    current = (!isNaN(idx) && Array.isArray(current)) ? current[idx] : current[part];
  }
  return current;
}

export class JsonAdapter implements TrainerAdapter {
  readonly id = 'json-adapter';
  readonly version = '1.0.0';

  supports(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.json');
  }

  async readCurrentValue(filePath: string, pathStr: string): Promise<ReadValueResult> {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, value: null, error: 'File does not exist' };
      }
      let raw = fs.readFileSync(filePath, 'utf-8');
      if (raw.charCodeAt(0) === 0xFEFF) {
        raw = raw.slice(1);
      }
      const clean = stripJSONComments(raw);
      const parsed = JSON.parse(clean);
      const val = getDeepValue(parsed, pathStr);
      return { success: true, value: val };
    } catch (e) {
      return { success: false, value: null, error: String(e) };
    }
  }

  async dryRun(filePath: string, pathStr: string, expectedOldValue?: any): Promise<DryRunResult> {
    try {
      const res = await this.readCurrentValue(filePath, pathStr);
      if (!res.success) {
        return { success: false, error: res.error };
      }
      if (res.value === undefined) {
        return { success: false, error: `Path "${pathStr}" not found in JSON (disappeared)` };
      }
      if (expectedOldValue !== undefined && String(res.value) !== String(expectedOldValue)) {
        return { success: false, error: `Value mismatch: current value ${res.value} !== expected value ${expectedOldValue} (stale edit)` };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  async buildOutput(filePath: string, pathStr: string, newValue: any): Promise<BuildOutputResult> {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, content: '', error: 'File does not exist' };
      }
      let raw = fs.readFileSync(filePath, 'utf-8');
      const hasBOM = raw.charCodeAt(0) === 0xFEFF;
      if (hasBOM) {
        raw = raw.slice(1);
      }
      const clean = stripJSONComments(raw);
      const parsed = JSON.parse(clean);
      
      const existingValue = getDeepValue(parsed, pathStr);
      if (existingValue === undefined) {
        return { success: false, content: '', error: `Path "${pathStr}" not found in JSON` };
      }

      // Detect type mismatch
      const existingType = typeof existingValue;
      let sanitizedValue = newValue;
      if (existingType === 'number') {
        const num = Number(newValue);
        if (isNaN(num)) {
          return { success: false, content: '', error: `Type mismatch: expected number, got ${typeof newValue}` };
        }
        sanitizedValue = num;
      } else if (existingType === 'boolean') {
        if (typeof newValue !== 'boolean') {
          if (String(newValue).toLowerCase() === 'true') sanitizedValue = true;
          else if (String(newValue).toLowerCase() === 'false') sanitizedValue = false;
          else {
            return { success: false, content: '', error: `Type mismatch: expected boolean, got ${typeof newValue}` };
          }
        }
      } else if (existingType === 'string') {
        sanitizedValue = String(newValue);
      }

      setDeepValue(parsed, pathStr, sanitizedValue);
      let output = JSON.stringify(parsed, null, 2);
      if (hasBOM) {
        output = '\uFEFF' + output;
      }
      return { success: true, content: output };
    } catch (e) {
      return { success: false, content: '', error: String(e) };
    }
  }

  async validateContent(content: string, filePath: string): Promise<ValidationResult> {
    try {
      let clean = content;
      if (clean.charCodeAt(0) === 0xFEFF) {
        clean = clean.slice(1);
      }
      clean = stripJSONComments(clean);
      JSON.parse(clean);
      return { valid: true };
    } catch (e) {
      return { valid: false, error: String(e) };
    }
  }

  async parseAndNormalize(filePath: string): Promise<ParsedDocument> {
    let raw = fs.readFileSync(filePath, 'utf-8');
    const diagnostics: ParserDiagnostic[] = [];
    const hasBOM = raw.charCodeAt(0) === 0xFEFF;
    if (hasBOM) {
      raw = raw.slice(1);
    }
    const clean = stripJSONComments(raw);
    let parsed: any = {};
    try {
      parsed = JSON.parse(clean);
    } catch (err: any) {
      diagnostics.push({ severity: 'error', message: err.message });
    }
    return buildParsedDocument(this.id, this.version, filePath, 'json', parsed, diagnostics, true);
  }
}
