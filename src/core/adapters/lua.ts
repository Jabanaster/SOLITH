import fs from 'fs';
import { TrainerAdapter, ReadValueResult, DryRunResult, BuildOutputResult, ValidationResult } from './contract';
import { parseSaveFile } from '../saves/index';
import { getDeepValue, setDeepValue } from './json';
import { ParsedDocument, ParserDiagnostic } from '../../shared/types';
import { buildParsedDocument } from '../saves/normalization';

export function isSafeLuaTable(content: string): { safe: boolean; error?: string } {
  const lower = content.toLowerCase();
  const forbiddenKeywords = [
    'function', 'require', 'dofile', 'loadfile', 'load', 'os.', 'io.',
    'package.', 'coroutine.', 'debug.', 'setmetatable', 'getmetatable',
    'repeat', 'until', 'while', 'for ', 'if ', 'then', 'else', 'elseif'
  ];

  for (const kw of forbiddenKeywords) {
    if (lower.includes(kw)) {
      return { safe: false, error: `Lua content contains blocked executable pattern: "${kw}"` };
    }
  }

  const clean = content.replace(/--.*/g, '').trim();
  if (!clean.startsWith('{') && !clean.includes('=')) {
    return { safe: false, error: 'Lua content does not match static table structure' };
  }

  return { safe: true };
}

function serializeLuaTable(obj: any): string {
  if (typeof obj !== 'object' || obj === null) {
    if (typeof obj === 'string') return `"${obj}"`;
    return String(obj);
  }
  if (Array.isArray(obj)) {
    return `{ ` + obj.map(v => serializeLuaTable(v)).join(', ') + ` }`;
  }
  const parts = Object.entries(obj).map(([k, v]) => `${k} = ${serializeLuaTable(v)}`);
  return `{ ` + parts.join(', ') + ` }`;
}

export class LuaAdapter implements TrainerAdapter {
  readonly id = 'lua-adapter';
  readonly version = '1.0.0';

  supports(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.lua')) return true;
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        return content.startsWith('{') && content.includes('=');
      }
    } catch (error) {
      console.error(`Lua adapter support probe failed for "${filePath}":`, error);
    }
    return false;
  }

  async readCurrentValue(filePath: string, pathStr: string): Promise<ReadValueResult> {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, value: null, error: 'File does not exist' };
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      const safety = isSafeLuaTable(content);
      if (!safety.safe) {
        return { success: false, value: null, error: safety.error };
      }

      const parsed = parseSaveFile(filePath);
      if (!parsed || parsed.format !== 'lua') {
        return { success: false, value: null, error: 'Failed to parse Lua file' };
      }
      const val = getDeepValue(parsed.data, pathStr);
      return { success: true, value: val };
    } catch (e) {
      return { success: false, value: null, error: String(e) };
    }
  }

  async dryRun(filePath: string, pathStr: string, expectedOldValue?: any): Promise<DryRunResult> {
    try {
      const res = await this.readCurrentValue(filePath, pathStr);
      if (!res.success) return { success: false, error: res.error };
      if (res.value === undefined) {
        return { success: false, error: `Path "${pathStr}" not found in Lua` };
      }
      if (expectedOldValue !== undefined && String(res.value) !== String(expectedOldValue)) {
        return { success: false, error: `Value mismatch: current ${res.value} !== expected ${expectedOldValue}` };
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
      const content = fs.readFileSync(filePath, 'utf-8');
      const safety = isSafeLuaTable(content);
      if (!safety.safe) {
        return { success: false, content: '', error: safety.error };
      }

      const parsed = parseSaveFile(filePath);
      if (!parsed || parsed.format !== 'lua') {
        return { success: false, content: '', error: 'Failed to parse Lua file' };
      }
      
      // Prevent type mismatch
      const existing = getDeepValue(parsed.data, pathStr);
      if (existing !== undefined && typeof existing !== typeof newValue) {
        // Allow basic numeric coercion
        if (typeof existing === 'number' && !isNaN(Number(newValue))) {
          // OK
        } else {
          return { success: false, content: '', error: `Type mismatch: expected ${typeof existing}, got ${typeof newValue}` };
        }
      }

      setDeepValue(parsed.data, pathStr, typeof existing === 'number' ? Number(newValue) : newValue);
      const output = serializeLuaTable(parsed.data);
      return { success: true, content: output };
    } catch (e) {
      return { success: false, content: '', error: String(e) };
    }
  }

  async validateContent(content: string, filePath: string): Promise<ValidationResult> {
    const safety = isSafeLuaTable(content);
    if (!safety.safe) {
      return { valid: false, error: safety.error };
    }
    return { valid: content.trim().startsWith('{') };
  }

  async parseAndNormalize(filePath: string): Promise<ParsedDocument> {
    const diagnostics: ParserDiagnostic[] = [];
    let parsed: any = {};
    let isEditable = true;

    try {
      if (!fs.existsSync(filePath)) {
        diagnostics.push({ severity: 'error', message: 'File does not exist' });
      } else {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const safety = isSafeLuaTable(raw);
        if (!safety.safe) {
          diagnostics.push({ severity: 'error', message: safety.error || 'Blocked dynamic Lua structure' });
          isEditable = false;
        } else {
          const res = parseSaveFile(filePath);
          if (res && res.format === 'lua') {
            parsed = res.data;
          } else {
            diagnostics.push({ severity: 'error', message: 'Failed to parse static Lua table' });
          }
        }
      }
    } catch (err: any) {
      diagnostics.push({ severity: 'error', message: err.message });
    }

    return buildParsedDocument(this.id, this.version, filePath, 'lua', parsed, diagnostics, isEditable);
  }
}
