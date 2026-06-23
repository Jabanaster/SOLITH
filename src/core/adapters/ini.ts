import fs from 'fs';
import { TrainerAdapter, ReadValueResult, DryRunResult, BuildOutputResult, ValidationResult } from './contract';
import { ParsedDocument, ParserDiagnostic } from '../../shared/types';
import { buildParsedDocument } from '../saves/normalization';

function parseIniLine(line: string): { key: string; value: string; delimiter: string } | null {
  const cleanLine = line.replace(/\s*[;#].*$/, '').trim();
  const eqIdx = cleanLine.indexOf('=');
  const colIdx = cleanLine.indexOf(':');
  
  let delimIdx = -1;
  let delimiter = '';
  if (eqIdx !== -1 && colIdx !== -1) {
    delimIdx = Math.min(eqIdx, colIdx);
    delimiter = cleanLine[delimIdx];
  } else if (eqIdx !== -1) {
    delimIdx = eqIdx;
    delimiter = '=';
  } else if (colIdx !== -1) {
    delimIdx = colIdx;
    delimiter = ':';
  }
  
  if (delimIdx === -1) return null;
  
  const key = cleanLine.slice(0, delimIdx).trim();
  const value = cleanLine.slice(delimIdx + 1).trim();
  return { key, value, delimiter };
}

function parseIni(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  let currentSection = '';
  
  const lines = content.split(/\r?\n/);
  lines.forEach(line => {
    line = line.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) return;
    
    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1).trim();
      result[currentSection] = result[currentSection] || {};
    } else {
      const parsedLine = parseIniLine(line);
      if (parsedLine) {
        const { key, value: cleanValue } = parsedLine;
        
        let parsedValue: any = cleanValue;
        if (cleanValue.toLowerCase() === 'true') parsedValue = true;
        else if (cleanValue.toLowerCase() === 'false') parsedValue = false;
        else if (!isNaN(Number(cleanValue)) && cleanValue !== '') parsedValue = Number(cleanValue);
        
        const target = currentSection ? (result[currentSection] = result[currentSection] || {}) : result;
        
        if (target[key] !== undefined) {
          if (Array.isArray(target[key])) {
            target[key].push(parsedValue);
          } else {
            target[key] = [target[key], parsedValue];
          }
        } else {
          target[key] = parsedValue;
        }
      }
    }
  });
  
  return result;
}

function parseIniPath(pathStr: string): { section: string; key: string; index?: number } {
  const match = pathStr.match(/^(?:([^.\[\]]+)\.)?([^.\[\]]+)(?:\[(\d+)\])?$/);
  if (!match) {
    return { section: '', key: pathStr };
  }
  const section = match[1] || '';
  const key = match[2];
  const index = match[3] !== undefined ? parseInt(match[3]) : undefined;
  return { section, key, index };
}

export class IniAdapter implements TrainerAdapter {
  readonly id = 'ini-adapter';
  readonly version = '1.0.0';

  supports(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return lower.endsWith('.ini') || lower.endsWith('.cfg') || lower.endsWith('.conf');
  }

  async readCurrentValue(filePath: string, pathStr: string): Promise<ReadValueResult> {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, value: null, error: 'File does not exist' };
      }
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseIni(raw);
      const { section, key, index } = parseIniPath(pathStr);
      
      const targetObj = section ? parsed[section] : parsed;
      if (!targetObj) return { success: false, value: null, error: `Section "${section}" not found` };
      
      const val = targetObj[key];
      if (val === undefined) return { success: false, value: null, error: `Key "${key}" not found` };
      
      if (Array.isArray(val)) {
        const idx = index !== undefined ? index : 0;
        if (idx >= val.length) return { success: false, value: null, error: `Key index ${idx} out of bounds` };
        return { success: true, value: val[idx] };
      } else {
        if (index !== undefined && index !== 0) return { success: false, value: null, error: `Key index ${index} out of bounds (key is not duplicated)` };
        return { success: true, value: val };
      }
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
        return { success: false, error: `Path "${pathStr}" not found in INI` };
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
      const raw = fs.readFileSync(filePath, 'utf-8');
      const lines = raw.split(/\r?\n/);
      const newLines: string[] = [];
      let found = false;
      
      const { section, key, index } = parseIniPath(pathStr);
      const targetIndex = index !== undefined ? index : 0;
      let currentIndex = 0;
      
      let currentSection = '';
      
      for (let line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          currentSection = trimmed.slice(1, -1).trim();
          newLines.push(line);
          continue;
        }
        
        const parsed = parseIniLine(line);
        if (parsed && parsed.key === key && (section === '' || currentSection === section)) {
          if (currentIndex === targetIndex) {
            const match = line.match(/^(\s*)([^=:]+?)(\s*[:=]\s*)([^;#\r\n]*?)(\s*[;#].*)?$/);
            if (match) {
              const leadingWs = match[1];
              const keyName = match[2];
              const delimAndSpacing = match[3];
              const comment = match[5] || '';
              newLines.push(`${leadingWs}${keyName}${delimAndSpacing}${String(newValue)}${comment}`);
              found = true;
            } else {
              newLines.push(`${parsed.key}${parsed.delimiter}${String(newValue)}`);
              found = true;
            }
          } else {
            newLines.push(line);
          }
          currentIndex++;
        } else {
          newLines.push(line);
        }
      }
      
      if (!found) {
        return { success: false, content: '', error: `Path "${pathStr}" not found in INI to update` };
      }
      
      return { success: true, content: newLines.join('\n') };
    } catch (e) {
      return { success: false, content: '', error: String(e) };
    }
  }

  async validateContent(content: string, filePath: string): Promise<ValidationResult> {
    try {
      parseIni(content);
      return { valid: true };
    } catch (e) {
      return { valid: false, error: String(e) };
    }
  }

  async parseAndNormalize(filePath: string): Promise<ParsedDocument> {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseIni(raw);
    const diagnostics: ParserDiagnostic[] = [];
    return buildParsedDocument(this.id, this.version, filePath, 'ini', parsed, diagnostics, true);
  }
}
