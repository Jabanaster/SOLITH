import fs from 'fs';
import { TrainerAdapter, ReadValueResult, DryRunResult, BuildOutputResult, ValidationResult } from './contract';
import { ParsedDocument, ParserDiagnostic } from '../../shared/types';
import { buildParsedDocument } from '../saves/normalization';

function parseTypedValue(val: string): any {
  const trimmed = val.trim();
  if (trimmed.toLowerCase() === 'true') return true;
  if (trimmed.toLowerCase() === 'false') return false;
  if (!isNaN(Number(trimmed)) && trimmed !== '') return Number(trimmed);
  return trimmed;
}

export function parseCSV(content: string, delimiter: string = ','): any[][] {
  const result: any[][] = [];
  let row: any[] = [];
  let inQuotes = false;
  let currentVal = '';
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];
    
    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentVal += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentVal += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        row.push(currentVal);
        currentVal = '';
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        row.push(currentVal);
        result.push(row.map(cell => parseTypedValue(cell)));
        row = [];
        currentVal = '';
        if (char === '\r') i++;
      } else {
        currentVal += char;
      }
    }
  }
  
  if (currentVal || row.length > 0) {
    row.push(currentVal);
    result.push(row.map(cell => parseTypedValue(cell)));
  }
  
  return result.filter(r => r.length > 0);
}

function detectDelimiter(content: string, filePath: string): string {
  if (filePath.toLowerCase().endsWith('.tsv')) return '\t';
  const firstLine = content.split(/\r?\n/)[0] || '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  return tabCount > commaCount ? '\t' : ',';
}

interface CsvSelector {
  rowIndex?: number;
  colIndex?: number;
  keyColName?: string;
  keyVal?: string;
  targetColName?: string;
}

export function parseCsvPath(pathStr: string, headers: string[] = []): CsvSelector {
  // Try matching [rowIndex][colIndex]
  const idxMatch = pathStr.match(/^\[(\d+)\]\[(\d+)\]$/);
  if (idxMatch) {
    return { rowIndex: parseInt(idxMatch[1]), colIndex: parseInt(idxMatch[2]) };
  }
  
  // Try matching [keyColName=keyVal].targetColName
  const keyMatch = pathStr.match(/^\[([^=]+)=([^\]]+)\]\.([a-zA-Z0-9_\-]+)$/);
  if (keyMatch) {
    return { keyColName: keyMatch[1], keyVal: keyMatch[2], targetColName: keyMatch[3] };
  }

  return {};
}

export class CsvAdapter implements TrainerAdapter {
  readonly id = 'csv-adapter';
  readonly version = '1.0.0';

  supports(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return lower.endsWith('.csv') || lower.endsWith('.tsv');
  }

  async readCurrentValue(filePath: string, pathStr: string): Promise<ReadValueResult> {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, value: null, error: 'File does not exist' };
      }
      const raw = fs.readFileSync(filePath, 'utf-8');
      const delimiter = detectDelimiter(raw, filePath);
      const parsed = parseCSV(raw, delimiter);
      
      if (parsed.length === 0) return { success: false, value: null, error: 'CSV file is empty' };
      
      const headers = parsed[0].map(h => String(h).trim());
      const selector = parseCsvPath(pathStr, headers);
      
      if (selector.rowIndex !== undefined && selector.colIndex !== undefined) {
        if (selector.rowIndex >= parsed.length || selector.colIndex >= parsed[selector.rowIndex].length) {
          return { success: false, value: null, error: 'CSV indices out of bounds' };
        }
        return { success: true, value: parsed[selector.rowIndex][selector.colIndex] };
      }
      
      if (selector.keyColName && selector.keyVal && selector.targetColName) {
        const keyColIdx = headers.findIndex(h => h.toLowerCase() === selector.keyColName!.toLowerCase());
        const targetColIdx = headers.findIndex(h => h.toLowerCase() === selector.targetColName!.toLowerCase());
        
        if (keyColIdx === -1 || targetColIdx === -1) {
          return { success: false, value: null, error: `Columns not found: ${selector.keyColName} or ${selector.targetColName}` };
        }
        
        for (let r = 1; r < parsed.length; r++) {
          if (String(parsed[r][keyColIdx]).trim() === selector.keyVal) {
            return { success: true, value: parsed[r][targetColIdx] };
          }
        }
        return { success: false, value: null, error: `Row with ${selector.keyColName}=${selector.keyVal} not found` };
      }
      
      return { success: false, value: null, error: 'Invalid CSV path format' };
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
        return { success: false, error: `Path "${pathStr}" not found in CSV` };
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
      const delimiter = detectDelimiter(raw, filePath);
      const parsed = parseCSV(raw, delimiter);
      
      if (parsed.length === 0) return { success: false, content: '', error: 'CSV file is empty' };
      
      const headers = parsed[0].map(h => String(h).trim());
      const selector = parseCsvPath(pathStr, headers);
      
      let targetRowIdx = -1;
      let targetColIdx = -1;
      
      if (selector.rowIndex !== undefined && selector.colIndex !== undefined) {
        targetRowIdx = selector.rowIndex;
        targetColIdx = selector.colIndex;
      } else if (selector.keyColName && selector.keyVal && selector.targetColName) {
        const keyColIdx = headers.findIndex(h => h.toLowerCase() === selector.keyColName!.toLowerCase());
        const tColIdx = headers.findIndex(h => h.toLowerCase() === selector.targetColName!.toLowerCase());
        
        if (keyColIdx === -1 || tColIdx === -1) {
          return { success: false, content: '', error: `Columns not found: ${selector.keyColName} or ${selector.targetColName}` };
        }
        
        targetColIdx = tColIdx;
        for (let r = 1; r < parsed.length; r++) {
          if (String(parsed[r][keyColIdx]).trim() === selector.keyVal) {
            targetRowIdx = r;
            break;
          }
        }
      }
      
      if (targetRowIdx === -1 || targetColIdx === -1) {
        return { success: false, content: '', error: `Target cell not found for path "${pathStr}"` };
      }
      
      parsed[targetRowIdx][targetColIdx] = newValue;
      
      // Serialize back to CSV/TSV preserving quotes if necessary
      const output = parsed.map(row => {
        return row.map(cell => {
          const str = String(cell);
          if (str.includes(delimiter) || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(delimiter);
      }).join('\n');
      
      return { success: true, content: output };
    } catch (e) {
      return { success: false, content: '', error: String(e) };
    }
  }

  async validateContent(content: string, filePath: string): Promise<ValidationResult> {
    try {
      const delimiter = detectDelimiter(content, filePath);
      parseCSV(content, delimiter);
      return { valid: true };
    } catch (e) {
      return { valid: false, error: String(e) };
    }
  }

  async parseAndNormalize(filePath: string): Promise<ParsedDocument> {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const delimiter = detectDelimiter(raw, filePath);
    const parsed = parseCSV(raw, delimiter);
    const diagnostics: ParserDiagnostic[] = [];
    
    // Convert 2D CSV array to a normalized key-value or row-column object structure
    const rootData: any = {};
    if (parsed.length > 0) {
      const headers = parsed[0].map(h => String(h).trim());
      // Check if there is an id/name column for stable row selection
      const keyColName = headers.find(h => ['id', 'name', 'key', 'item_id', 'uuid'].includes(h.toLowerCase()));
      
      if (keyColName) {
        const keyColIdx = headers.indexOf(keyColName);
        for (let r = 1; r < parsed.length; r++) {
          const rowKey = String(parsed[r][keyColIdx]).trim();
          if (rowKey) {
            rootData[`[${keyColName}=${rowKey}]`] = {};
            headers.forEach((h, colIdx) => {
              if (colIdx !== keyColIdx) {
                rootData[`[${keyColName}=${rowKey}]`][h] = parsed[r][colIdx];
              }
            });
          }
        }
      } else {
        // Fallback to row index representation
        parsed.forEach((row, rowIndex) => {
          rootData[`[${rowIndex}]`] = {};
          row.forEach((cell, colIndex) => {
            rootData[`[${rowIndex}]`][`[${colIndex}]`] = cell;
          });
        });
      }
    }

    const doc = buildParsedDocument(this.id, this.version, filePath, 'csv', rootData, diagnostics, true, (key, parentPath) => {
      if (parentPath === '') {
        return key;
      }
      // If parent path is [id=1], subpath is [id=1].damage
      if (parentPath.startsWith('[')) {
        if (key.startsWith('[')) {
          return `${parentPath}${key}`; // [rowIndex][colIndex]
        }
        return `${parentPath}.${key}`; // [id=1].damage
      }
      return `${parentPath}.${key}`;
    });

    return doc;
  }
}
