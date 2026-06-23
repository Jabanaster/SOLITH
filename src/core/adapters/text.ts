import fs from 'fs';
import { TrainerAdapter, ReadValueResult, DryRunResult, BuildOutputResult, ValidationResult } from './contract';
import { ParsedDocument, ParserDiagnostic } from '../../shared/types';
import { buildParsedDocument } from '../saves/normalization';

function parseKeyValue(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = content.split(/\r?\n/);
  
  lines.forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) return;
    
    const delimiterMatch = line.match(/[:=]/);
    if (delimiterMatch) {
      const delimiter = delimiterMatch[0];
      const parts = line.split(delimiter);
      const key = parts[0].trim();
      const value = parts.slice(1).join(delimiter).trim();
      
      // Strip inline comments
      const commentIndex = value.search(/\s*[;#]/);
      const cleanValue = commentIndex !== -1 ? value.slice(0, commentIndex).trim() : value;
      
      let parsedValue: any = cleanValue;
      if (cleanValue.toLowerCase() === 'true') parsedValue = true;
      else if (cleanValue.toLowerCase() === 'false') parsedValue = false;
      else if (!isNaN(Number(cleanValue)) && cleanValue !== '') parsedValue = Number(cleanValue);
      
      if (result[key] !== undefined) {
        if (Array.isArray(result[key])) {
          result[key].push(parsedValue);
        } else {
          result[key] = [result[key], parsedValue];
        }
      } else {
        result[key] = parsedValue;
      }
    }
  });
  
  return result;
}

function parseTextPath(pathStr: string): { key: string; index?: number } {
  const match = pathStr.match(/^([^\[\]]+)(?:\[(\d+)\])?$/);
  if (!match) {
    return { key: pathStr };
  }
  const key = match[1];
  const index = match[2] !== undefined ? parseInt(match[2]) : undefined;
  return { key, index };
}

export class TextAdapter implements TrainerAdapter {
  readonly id = 'text-adapter';
  readonly version = '1.0.0';

  supports(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.txt');
  }

  async readCurrentValue(filePath: string, pathStr: string): Promise<ReadValueResult> {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, value: null, error: 'File does not exist' };
      }
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseKeyValue(raw);
      const { key, index } = parseTextPath(pathStr);
      
      const val = parsed[key];
      if (val === undefined) return { success: false, value: null, error: `Key "${key}" not found` };
      
      if (Array.isArray(val)) {
        const idx = index !== undefined ? index : 0;
        if (idx >= val.length) return { success: false, value: null, error: `Key index ${idx} out of bounds` };
        return { success: true, value: val[idx] };
      } else {
        if (index !== undefined && index !== 0) return { success: false, value: null, error: `Key index ${index} out of bounds (key not duplicated)` };
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
        return { success: false, error: `Path "${pathStr}" not found in Text` };
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
      
      const { key, index } = parseTextPath(pathStr);
      const targetIndex = index !== undefined ? index : 0;
      let currentIndex = 0;
      
      for (let line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
          newLines.push(line);
          continue;
        }
        
        const delimiterMatch = line.match(/[:=]/);
        if (delimiterMatch) {
          const delimiter = delimiterMatch[0];
          const parts = line.split(delimiter);
          const currentKey = parts[0].trim();
          
          if (currentKey === key) {
            if (currentIndex === targetIndex) {
              const partsVal = parts.slice(1).join(delimiter);
              const commentIndex = partsVal.search(/\s*[;#]/);
              const comment = commentIndex !== -1 ? partsVal.slice(commentIndex) : '';
              newLines.push(`${parts[0].split(/[#;]/)[0].split(/[:=]/)[0]}${delimiter} ${String(newValue)}${comment}`);
              found = true;
            } else {
              newLines.push(line);
            }
            currentIndex++;
          } else {
            newLines.push(line);
          }
        } else {
          newLines.push(line);
        }
      }
      
      if (!found) {
        return { success: false, content: '', error: `Path "${pathStr}" not found in Text to update` };
      }
      
      return { success: true, content: newLines.join('\n') };
    } catch (e) {
      return { success: false, content: '', error: String(e) };
    }
  }

  async validateContent(content: string, filePath: string): Promise<ValidationResult> {
    try {
      parseKeyValue(content);
      return { valid: true };
    } catch (e) {
      return { valid: false, error: String(e) };
    }
  }

  async parseAndNormalize(filePath: string): Promise<ParsedDocument> {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseKeyValue(raw);
    const diagnostics: ParserDiagnostic[] = [];
    return buildParsedDocument(this.id, this.version, filePath, 'text', parsed, diagnostics, true);
  }
}
