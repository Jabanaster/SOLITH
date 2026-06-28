import fs from 'fs';
import xml2js from 'xml2js';
import crypto from 'crypto';
import { ParsedSave, SaveValue } from '../../shared/types';
import { SAFE_KEYWORDS, RISKY_KEYWORDS } from '../../shared/constants';

export const MAX_SAVE_FILE_BYTES = 8 * 1024 * 1024;

export class SaveFileTooLargeError extends Error {
  constructor(sizeBytes: number, maxBytes: number = MAX_SAVE_FILE_BYTES) {
    super(`Save file is too large to parse safely (${sizeBytes} bytes > ${maxBytes} bytes; limit ${formatBytes(maxBytes)}).`);
    this.name = 'SaveFileTooLargeError';
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} bytes`;
}

function assertFileSizeWithinLimit(filePath: string): void {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error('Save path is not a file.');
  }
  if (stat.size > MAX_SAVE_FILE_BYTES) {
    throw new SaveFileTooLargeError(stat.size);
  }
}

// Helper to strip JSON comments safely
function stripJSONComments(jsonString: string): string {
  return jsonString.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m);
}

// INI/CFG parser supporting comments, sections, and root-level keys
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
    } else if (line.includes('=')) {
      const parts = line.split('=');
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      
      // Try to parse values as numbers/booleans
      let parsedValue: any = value;
      if (value.toLowerCase() === 'true') parsedValue = true;
      else if (value.toLowerCase() === 'false') parsedValue = false;
      else if (!isNaN(Number(value)) && value !== '') parsedValue = Number(value);
      
      if (currentSection) {
        result[currentSection][key] = parsedValue;
      } else {
        result[key] = parsedValue;
      }
    }
  });
  
  return result;
}

// CSV/TSV parser
function parseCSV(content: string, delimiter: string = ','): any[] {
  const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
  return lines.map((line, rowIndex) => {
    const values = line.split(delimiter).map(v => {
      const trimmed = v.trim();
      if (trimmed.toLowerCase() === 'true') return true;
      if (trimmed.toLowerCase() === 'false') return false;
      if (!isNaN(Number(trimmed)) && trimmed !== '') return Number(trimmed);
      return trimmed;
    });
    return values;
  });
}

// Key-Value text parser (e.g. key: value or key = value)
function parseKeyValue(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = content.split(/\r?\n/);
  
  lines.forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) return;
    
    const parts = line.split(/[:=]/);
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      
      let parsedValue: any = value;
      if (value.toLowerCase() === 'true') parsedValue = true;
      else if (value.toLowerCase() === 'false') parsedValue = false;
      else if (!isNaN(Number(value)) && value !== '') parsedValue = Number(value);
      
      result[key] = parsedValue;
    }
  });
  
  return result;
}

// Safe Regex-based Lua-like table parser (without evaluating code)
function parseLuaLikeTable(content: string): Record<string, any> {
  const clean = content.replace(/--.*/g, '').trim();
  const result: Record<string, any> = {};
  
  // Regex to match keys and values in format: key = value
  const regex = /(\w+)\s*=\s*(("[^"]*")|('[^']*')|(\d+\.?\d*)|(true|false)|(\{[\s\S]*?\}))/g;
  let match;
  while ((match = regex.exec(clean)) !== null) {
    const key = match[1];
    const valStr = match[2].trim();
    
    if ((valStr.startsWith('"') && valStr.endsWith('"')) || (valStr.startsWith("'") && valStr.endsWith("'"))) {
      result[key] = valStr.slice(1, -1);
    } else if (valStr === 'true') {
      result[key] = true;
    } else if (valStr === 'false') {
      result[key] = false;
    } else if (valStr.startsWith('{')) {
      // Parse nested table
      result[key] = parseLuaLikeTable(valStr.slice(1, -1));
    } else {
      const num = Number(valStr);
      result[key] = isNaN(num) ? valStr : num;
    }
  }
  return result;
}

// Extracts printable strings from binary buffers (ASCII length >= 4)
export function extractStringsFromBinary(buffer: Buffer): string[] {
  const strings: string[] = [];
  let currentString = '';
  
  for (let i = 0; i < buffer.length; i++) {
    const charCode = buffer[i];
    // Printable ASCII characters (32 to 126) plus tab and newline
    if ((charCode >= 32 && charCode <= 126) || charCode === 9 || charCode === 10 || charCode === 13) {
      currentString += String.fromCharCode(charCode);
    } else {
      if (currentString.length >= 4) {
        strings.push(currentString.trim());
      }
      currentString = '';
    }
  }
  if (currentString.length >= 4) {
    strings.push(currentString.trim());
  }
  return [...new Set(strings)]; // return unique strings
}

export function parseSaveFile(filePath: string): ParsedSave | null {
  try {
    return parseSaveFileStrict(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse save file.';
    console.error(`Parse error: ${message}`);
    return null;
  }
}

export function parseSaveFileStrict(filePath: string): ParsedSave {
  if (!fs.existsSync(filePath)) {
    throw new Error('Save file not found.');
  }
  assertFileSizeWithinLimit(filePath);

  const lowerName = filePath.toLowerCase();
  
  // Check if it is a binary file extension
  const isBinaryExt = lowerName.endsWith('.sav') || lowerName.endsWith('.dat') || lowerName.endsWith('.bin');
  
  // Read buffer only after the size guard passes.
  const buffer = fs.readFileSync(filePath);
  
  // If it's a binary file extension or contains NULL bytes, treat it as binary save
  const hasNullBytes = buffer.slice(0, 1024).includes(0x00);
  
  if (isBinaryExt || hasNullBytes) {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const extracted = extractStringsFromBinary(buffer);
    return {
      format: 'binary',
      path: filePath,
      data: {
        isBinary: true,
        size: buffer.length,
        hash,
        strings: extracted,
        rawBase64: buffer.toString('base64')
      }
    };
  }

  const content = buffer.toString('utf-8');

  if (lowerName.endsWith('.json')) {
    const cleanContent = stripJSONComments(content);
    return { data: JSON.parse(cleanContent), format: 'json', path: filePath };
  } else if (lowerName.endsWith('.xml')) {
    let parseResult: any = null;
    let parseError: any = null;
    const parser = new xml2js.Parser({ async: false });
    parser.parseString(content, (err: any, result: any) => {
      parseError = err;
      parseResult = result;
    });
    if (parseError) throw parseError;
    return { data: parseResult, format: 'xml', path: filePath };
  } else if (lowerName.endsWith('.ini') || lowerName.endsWith('.cfg') || lowerName.endsWith('.conf')) {
    return { data: parseIni(content), format: 'ini', path: filePath };
  } else if (lowerName.endsWith('.csv')) {
    return { data: parseCSV(content, ','), format: 'csv', path: filePath };
  } else if (lowerName.endsWith('.tsv')) {
    return { data: parseCSV(content, '\t'), format: 'tsv', path: filePath };
  } else if (content.trim().startsWith('{') && content.trim().includes('=')) {
    // Looks like a Lua table
    return { data: parseLuaLikeTable(content), format: 'lua', path: filePath };
  } else {
    // Plain text - key-value
    return { data: parseKeyValue(content), format: 'text', path: filePath };
  }
}

export function extractSafeValues(parsedSave: ParsedSave): SaveValue[] {
  const values: SaveValue[] = [];
  
  if (parsedSave.format === 'binary') {
    // For binary, we only extract strings and metadata as read-only values
    const strings = parsedSave.data.strings || [];
    strings.forEach((str: string, index: number) => {
      // Only include values that look gameplay-relevant to reduce noise
      const lower = str.toLowerCase();
      const isRelevant = SAFE_KEYWORDS.some(kw => lower.includes(kw));
      if (isRelevant) {
        values.push({
          path: `strings[${index}]`,
          value: str,
          type: 'string',
          risk: 'Caution' // Binary string extraction is read-only caution
        });
      }
    });
    
    // Add file metadata
    values.push({
      path: 'meta.hash',
      value: parsedSave.data.hash,
      type: 'string',
      risk: 'Blocked'
    });
    values.push({
      path: 'meta.size',
      value: parsedSave.data.size,
      type: 'number',
      risk: 'Blocked'
    });
    return values;
  }

  function traverse(obj: any, path: string = ''): void {
    if (obj === null || obj === undefined) return;
    
    if (typeof obj === 'object') {
      if (Array.isArray(obj)) {
        obj.forEach((item, index) => traverse(item, `${path}[${index}]`));
      } else {
        Object.keys(obj).forEach(key => {
          traverse(obj[key], path ? `${path}.${key}` : key);
        });
      }
    } else if (typeof obj === 'number' || typeof obj === 'string' || typeof obj === 'boolean') {
      const fullPath = path || 'root';
      const lowerPath = fullPath.toLowerCase();
      const lowerValue = String(obj).toLowerCase();
      
      let risk: 'Safe' | 'Caution' | 'Risky' | 'Blocked' = 'Safe';
      let isSafe = false;
      
      // Check for risky keywords
      for (const pattern of RISKY_KEYWORDS) {
        if (lowerPath.includes(pattern) || lowerValue.includes(pattern)) {
          risk = 'Risky';
          break;
        }
      }
      
      // Check for safe keywords (boost confidence)
      for (const keyword of SAFE_KEYWORDS) {
        if (lowerPath.includes(keyword) || lowerValue.includes(keyword)) {
          isSafe = true;
          break;
        }
      }
      
      if (!isSafe && risk === 'Safe') {
        risk = 'Caution'; // Mark as caution if not explicitly safe
      }
      
      let valueType: 'number' | 'string' | 'boolean' | 'array' | 'object' = 'string';
      if (typeof obj === 'number') valueType = 'number';
      else if (typeof obj === 'boolean') valueType = 'boolean';
      
      values.push({
        path: fullPath,
        value: obj,
        type: valueType,
        risk
      });
    }
  }
  
  traverse(parsedSave.data);
  return values;
}
